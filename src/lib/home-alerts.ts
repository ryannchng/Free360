import * as Location from 'expo-location';
import * as Notifications from 'expo-notifications';
import { secureStorage as SecureStore } from './secure-storage';
import * as Crypto from 'expo-crypto';
import * as TaskManager from 'expo-task-manager';
import Constants from 'expo-constants';
import { Platform } from 'react-native';
import { isSelfHosted } from './backend';
import { getSupabase, ensureDeviceSession } from './supabase';
import { selfHostedRequest } from './self-hosted';
import { loadCircle, loadDeviceProfile, publishCheckIn, type CircleSnapshot, type Home } from './circle';
import { homeTransition, isInsideHome } from './home-transition';

export const HOME_TASK = 'free360-home-geofences';
type SavedHome = Home & { name: string; deviceId: string };
const HOMES_KEY = 'free360.homes.v1';
const STATES_KEY = 'free360.home-states.v1';
const QUEUE_KEY = 'free360.home-alert-queue.v1';
type PendingAlert = { circleId: string; id: string; message: string; recordedAt: string; published: boolean };

Notifications.setNotificationHandler({ handleNotification: async () => ({ shouldPlaySound: true, shouldSetBadge: false, shouldShowBanner: true, shouldShowList: true }) });

export async function enableNotifications() {
  if (Platform.OS === 'web') throw new Error('Notifications require the mobile app.');
  if (Platform.OS === 'android') await Notifications.setNotificationChannelAsync('homes', { name: 'Home arrivals and departures', importance: Notifications.AndroidImportance.DEFAULT });
  const permission = await Notifications.requestPermissionsAsync();
  if (!permission.granted) throw new Error('Allow notifications in your phone settings.');
  const projectId = Constants.easConfig?.projectId ?? Constants.expoConfig?.extra?.eas?.projectId;
  if (!projectId) throw new Error('Link an EAS project and install a development build to enable push notifications.');
  const token = (await Notifications.getExpoPushTokenAsync({ projectId })).data;
  if (isSelfHosted()) await selfHostedRequest('/v1/push-token', 'POST', { token });
  else {
    await ensureDeviceSession();
    const { error } = await getSupabase().rpc('free360_register_push', { p_token: token });
    if (error) throw error;
  }
}

// Cache decrypted homes only on the phone, never in backend tables.
export async function syncHomes(snapshots: Record<string, CircleSnapshot>) {
  const work = monitoring.then(() => syncHomesInner(snapshots));
  monitoring = work.catch(() => {});
  return work;
}

let monitoring: Promise<void> = Promise.resolve();
async function syncHomesInner(snapshots: Record<string, CircleSnapshot>) {
  const circle = await loadCircle();
  if (!circle || Platform.OS === 'web') return;
  const profile = await loadDeviceProfile();
  const homes: SavedHome[] = Object.entries(snapshots).flatMap(([deviceId, snapshot]) => snapshot.profile?.home ? [{ ...snapshot.profile.home, name: snapshot.profile.name, deviceId }] : []);
  if (profile.home) homes.push({ ...profile.home, name: profile.name, deviceId: circle.deviceId });
  const raw = JSON.stringify({ circleId: circle.circleId, homes });
  if (raw === await SecureStore.getItemAsync(HOMES_KEY)) {
    if (!await Location.hasStartedGeofencingAsync(HOME_TASK)) await refreshHomeMonitoring();
    return;
  }
  await SecureStore.setItemAsync(HOMES_KEY, raw);
  await SecureStore.deleteItemAsync(STATES_KEY);
  await refreshHomeMonitoring();
}

export async function refreshHomeMonitoring() {
  if (Platform.OS === 'web') return;
  const sharing = await Location.hasStartedLocationUpdatesAsync('free360-background-location');
  const permission = await Location.getBackgroundPermissionsAsync();
  const raw = await SecureStore.getItemAsync(HOMES_KEY);
  const saved = raw ? JSON.parse(raw) as { circleId: string; homes: SavedHome[] } : null;
  const circle = await loadCircle();
  if (!sharing || !permission.granted || !saved?.homes.length || saved.circleId !== circle?.circleId) {
    if (await Location.hasStartedGeofencingAsync(HOME_TASK)) await Location.stopGeofencingAsync(HOME_TASK);
    return;
  }
  const rawStates = await SecureStore.getItemAsync(STATES_KEY);
  const states: Record<string, { inside: boolean; at: number }> = rawStates ? JSON.parse(rawStates) : {};
  if (saved.homes.some(home => !states[home.deviceId])) {
    const position = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
    for (const home of saved.homes) if (!states[home.deviceId]) states[home.deviceId] = { inside: isInsideHome(home, position.coords), at: Date.now() };
    await SecureStore.setItemAsync(STATES_KEY, JSON.stringify(states));
  }
  if (await Location.hasStartedLocationUpdatesAsync('free360-background-location')) await Location.startGeofencingAsync(HOME_TASK, saved.homes.slice(0, 20).map(home => ({ identifier: home.deviceId, latitude: home.latitude, longitude: home.longitude, radius: home.radius, notifyOnEnter: true, notifyOnExit: true })));
}

let transitions: Promise<void> = Promise.resolve();
export function handleHomeTransition(deviceId: string, inside: boolean) {
  const work = transitions.then(async () => {
    const circle = await loadCircle();
    if (!circle || !await Location.hasStartedLocationUpdatesAsync('free360-background-location')) return;
    const raw = await SecureStore.getItemAsync(HOMES_KEY);
    const saved = raw ? JSON.parse(raw) as { circleId: string; homes: SavedHome[] } : null;
    if (saved?.circleId !== circle.circleId) return;
    const home = saved.homes.find(item => item.deviceId === deviceId);
    if (!home) return;
    const stateRaw = await SecureStore.getItemAsync(STATES_KEY);
    const states: Record<string, { inside: boolean; at: number }> = stateRaw ? JSON.parse(stateRaw) : {};
    const previous = states[deviceId];
    const transition = homeTransition(previous, inside, Date.now());
    states[deviceId] = transition.state;
    await SecureStore.setItemAsync(STATES_KEY, JSON.stringify(states));
    // Initial OS callbacks establish a baseline; suppress boundary chatter for two minutes.
    if (!transition.notify) return;
    const profile = await loadDeviceProfile();
    const message = `${profile.name} ${inside ? 'arrived at' : 'left'} ${home.name}'s home.`;
    const queueRaw = await SecureStore.getItemAsync(QUEUE_KEY);
    const queue: PendingAlert[] = queueRaw ? JSON.parse(queueRaw) : [];
    queue.push({ circleId: circle.circleId, id: Crypto.randomUUID(), message, recordedAt: new Date().toISOString(), published: false });
    await SecureStore.setItemAsync(QUEUE_KEY, JSON.stringify(queue.slice(-20)));
    await flushAlertsInner();
  });
  transitions = work.catch(() => {});
  return work;
}

async function flushAlertsInner() {
  const circle = await loadCircle();
  if (!circle) return;
  const raw = await SecureStore.getItemAsync(QUEUE_KEY);
  const queue: PendingAlert[] = (raw ? JSON.parse(raw) : []).filter((item: PendingAlert) => item.circleId === circle.circleId);
  while (queue.length) {
    const alert = queue[0];
    if (!alert.published) {
      await publishCheckIn(circle, alert.message, alert.id, alert.recordedAt);
      alert.published = true;
      await SecureStore.setItemAsync(QUEUE_KEY, JSON.stringify(queue));
    }
    // The push body is generic so names and addresses stay encrypted.
    if (isSelfHosted()) await selfHostedRequest('/v1/notify', 'POST', {});
    else {
      const { error } = await getSupabase().functions.invoke('notify-circle', { body: {} });
      if (error) throw error;
    }
    queue.shift();
    await SecureStore.setItemAsync(QUEUE_KEY, JSON.stringify(queue));
  }
}

export function flushHomeAlerts() {
  const work = transitions.then(flushAlertsInner);
  transitions = work.catch(() => {});
  return work;
}

TaskManager.defineTask<{ eventType: Location.GeofencingEventType; region: Location.LocationRegion }>(HOME_TASK, async ({ data, error }) => {
  if (error || !data?.region.identifier) return;
  try { await handleHomeTransition(data.region.identifier, data.eventType === Location.GeofencingEventType.Enter); }
  catch (failure) { console.warn('[Free360] Home alert delivery failed:', failure); }
});
