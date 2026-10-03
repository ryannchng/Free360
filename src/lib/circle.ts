import * as Crypto from 'expo-crypto';
import { secureStorage as SecureStore } from './secure-storage';
import { fromByteArray, toByteArray } from 'base64-js';
import nacl from 'tweetnacl';
import { FunctionsHttpError } from '@supabase/supabase-js';
import { getBackendUrl, isSelfHosted } from './backend';
import { claimSelfHostedInvite, createSelfHostedCircle, createSelfHostedInvite, ensureSelfHostedSession, fetchSelfHostedHistory, fetchSelfHostedSnapshots, isSelfHostedMember, publishSelfHostedEnvelope, subscribeSelfHosted } from './self-hosted';
import { ensureDeviceSession, getSupabase } from './supabase';
import { normalizeSetupCode } from './setup-code';
import { isCreateCircleSuccess, resolveCreateCircleFailureMessage } from './create-circle-result';
import * as Battery from 'expo-battery';
import { normalizeAvatar } from './avatar-format';

const CIRCLE_STORAGE_KEY = 'free360.circle.v2';
const PENDING_SNAPSHOT_KEY = 'free360.pending-snapshot.v2';
const PROTOCOL_VERSION = 2;
const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

export type CircleConfig = {
  version: 2;
  circleId: string;
  deviceId: string;
  encryptionKey: string;
  projectUrl: string;
  circleName: string;
  isOwner: boolean;
  pending?: boolean;
};

export type InvitePayload = {
  version: 2;
  projectUrl: string;
  circleId: string;
  inviteId: string;
  inviteSecret: string;
  encryptionKey: string;
  circleName: string;
};

export type EncryptedEnvelope = {
  version: 1;
  nonce: string;
  ciphertext: string;
};

export type Home = { latitude: number; longitude: number; radius: number };
export type DeviceProfile = { name: string; home: Home | null; battery: number | null; avatar?: string | null };
export type SharedLocation = { type: 'location'; latitude: number; longitude: number; accuracy: number | null; recordedAt: string; profile?: DeviceProfile };
export type SharingPaused = { type: 'paused'; recordedAt: string; profile?: DeviceProfile };
export type CheckIn = { type: 'checkin'; id: string; message: string; recordedAt: string };
export type CircleSnapshot = SharedLocation | SharingPaused;
export type CirclePayload = CircleSnapshot | CheckIn;
export type CircleSubscription = { close: () => void };
export type CircleUpdate =
  | { kind: 'snapshot'; deviceId: string; payload: CircleSnapshot }
  | { kind: 'checkin'; deviceId: string; payload: CheckIn };
export type HistoryPoint = { latitude: number; longitude: number; recordedAt: string };

export const LOCATION_HISTORY_RETENTION_MS = 24 * 60 * 60 * 1000;
const HISTORY_MIN_INTERVAL_MS = 5 * 60 * 1000;
const HISTORY_MIN_MOVE_METERS = 25;
const HISTORY_JUMP_METERS = 1000;

function randomBytes(length: number) {
  return Crypto.getRandomValues(new Uint8Array(length));
}

function randomSecret() {
  return fromByteArray(randomBytes(nacl.secretbox.keyLength));
}

function randomId() {
  return Crypto.randomUUID();
}

function getKey(key: string) {
  const bytes = toByteArray(key);
  if (bytes.length !== nacl.secretbox.keyLength) throw new Error('Invalid circle encryption key.');
  return bytes;
}

function toUrlSafeBase64(value: string) {
  return fromByteArray(textEncoder.encode(value)).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/g, '');
}

function fromUrlSafeBase64(value: string) {
  return textDecoder.decode(toByteArray(value.replaceAll('-', '+').replaceAll('_', '/') + '='.repeat((4 - value.length % 4) % 4)));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function requireString(value: unknown, label: string) {
  if (typeof value !== 'string' || !value) throw new Error(`Invitation is missing ${label}.`);
  return value;
}

function requireProject(projectUrl: string) {
  if (projectUrl !== getBackendUrl()) throw new Error('This invitation belongs to another Free360 group server. Install the app build configured for that group.');
}

function ensureBackendSession() {
  return isSelfHosted() ? ensureSelfHostedSession() : ensureDeviceSession();
}

export function encryptCirclePayload(payload: CirclePayload, encryptionKey: string): EncryptedEnvelope {
  const nonce = randomBytes(nacl.secretbox.nonceLength);
  const ciphertext = nacl.secretbox(textEncoder.encode(JSON.stringify(payload)), nonce, getKey(encryptionKey));
  return { version: 1, nonce: fromByteArray(nonce), ciphertext: fromByteArray(ciphertext) };
}

export function decryptCirclePayload(envelope: EncryptedEnvelope, encryptionKey: string): CirclePayload | null {
  try {
    if (envelope.version !== 1) return null;
    const opened = nacl.secretbox.open(toByteArray(envelope.ciphertext), toByteArray(envelope.nonce), getKey(encryptionKey));
    if (!opened) return null;
    const parsed: unknown = JSON.parse(textDecoder.decode(opened));
    if (!isRecord(parsed) || typeof parsed.recordedAt !== 'string' || !Number.isFinite(Date.parse(parsed.recordedAt))) return null;
    const profile = parseProfile(parsed.profile);
    if (parsed.type === 'paused') return { type: 'paused', recordedAt: parsed.recordedAt, profile };
    if (parsed.type === 'checkin' && typeof parsed.id === 'string' && typeof parsed.message === 'string' && parsed.message.length <= 500) {
      return { type: 'checkin', id: parsed.id, message: parsed.message, recordedAt: parsed.recordedAt };
    }
    if (parsed.type !== 'location' || typeof parsed.latitude !== 'number' || !Number.isFinite(parsed.latitude) || Math.abs(parsed.latitude) > 90 || typeof parsed.longitude !== 'number' || !Number.isFinite(parsed.longitude) || Math.abs(parsed.longitude) > 180) return null;
    return { type: 'location', latitude: parsed.latitude, longitude: parsed.longitude, accuracy: typeof parsed.accuracy === 'number' ? parsed.accuracy : null, recordedAt: parsed.recordedAt, profile };
  } catch {
    return null;
  }
}

export function encodeInvite(payload: InvitePayload) {
  return `free360://invite/${toUrlSafeBase64(JSON.stringify(payload))}`;
}

export function decodeInvite(value: string): InvitePayload {
  const match = value.trim().match(/^free360:\/\/invite\/([A-Za-z0-9_-]+)$/);
  if (!match) throw new Error('This is not a Free360 invitation QR code.');
  let parsed: unknown;
  try { parsed = JSON.parse(fromUrlSafeBase64(match[1])); }
  catch { throw new Error('This invitation QR code is damaged.'); }
  if (!isRecord(parsed) || parsed.version !== PROTOCOL_VERSION) throw new Error('This invitation uses an unsupported Free360 version.');
  const invite: InvitePayload = {
    version: 2,
    projectUrl: requireString(parsed.projectUrl, 'project URL'),
    circleId: requireString(parsed.circleId, 'circle ID'),
    inviteId: requireString(parsed.inviteId, 'invite ID'),
    inviteSecret: requireString(parsed.inviteSecret, 'invite secret'),
    encryptionKey: requireString(parsed.encryptionKey, 'encryption key'),
    circleName: requireString(parsed.circleName, 'circle name'),
  };
  getKey(invite.encryptionKey);
  requireProject(invite.projectUrl);
  return invite;
}

export async function createCircle(circleName: string, setupCode: string): Promise<CircleConfig> {
  const name = circleName.trim();
  if (!name) throw new Error('Enter a circle name.');
  const deviceId = await ensureBackendSession();
  const circleId = randomId();
  const config: CircleConfig = {
    version: 2, circleId, deviceId, encryptionKey: randomSecret(), projectUrl: getBackendUrl(),
    circleName: name, isOwner: true,
  };
  await saveCircle({ ...config, pending: true });
  try {
    if (isSelfHosted()) await createSelfHostedCircle(circleId, setupCode.trim());
    else await createSupabaseCircleViaFunction(circleId, setupCode);
  } catch (error) {
    if (await recoverPendingCircle(config)) return config;
    throw error;
  }
  await saveCircle(config);
  return config;
}

async function createSupabaseCircleViaFunction(circleId: string, setupCode: string) {
  const normalized = normalizeSetupCode(setupCode);
  if (!/^[0-9]{16}$/.test(normalized)) {
    throw new Error('Enter the 16-digit setup code from your server setup.');
  }
  const { data, error } = await getSupabase().functions.invoke('create-circle', {
    body: { circleId, setupCode: normalized },
  });
  if (error) throw await toCreateCircleError(error);
  if (isCreateCircleSuccess(data)) return;
  throw new Error(resolveCreateCircleFailureMessage(data, undefined));
}

function asFunctionsHttpError(error: unknown): FunctionsHttpError | null {
  if (error instanceof FunctionsHttpError) return error;
  if (isRecord(error) && error.name === 'FunctionsHttpError' && 'context' in error) {
    return error as unknown as FunctionsHttpError;
  }
  return null;
}

async function readFunctionPayload(context: unknown): Promise<unknown> {
  try {
    if (isRecord(context) && typeof (context as { json?: unknown }).json === 'function') {
      return await (context as unknown as Response).json();
    }
    if (isRecord(context)) return context;
  } catch {
    // Fall through to status-based messaging below.
  }
  return null;
}

async function toCreateCircleError(error: unknown): Promise<Error> {
  const httpError = asFunctionsHttpError(error);
  if (httpError) {
    const status = (httpError.context as unknown as Response | undefined)?.status;
    const payload = await readFunctionPayload(httpError.context);
    return new Error(resolveCreateCircleFailureMessage(payload, status));
  }
  if (error instanceof Error) {
    if (error.name === 'FunctionsFetchError' || error.name === 'FunctionsRelayError') {
      return new Error('Could not reach the group server. Check your connection and try again.');
    }
    return error;
  }
  return new Error('Could not create the circle. Check your group server setup and try again.');
}

export async function createInvite(config: CircleConfig) {
  await ensureMatchingSession(config);
  const inviteId = randomId();
  const inviteSecret = fromByteArray(randomBytes(32));
  let expiresAt: string;
  if (isSelfHosted()) expiresAt = await createSelfHostedInvite(inviteId, inviteSecret);
  else {
    const { data, error } = await getSupabase().rpc('free360_create_invite', { p_invite_id: inviteId, p_secret: inviteSecret });
    if (error) throw error;
    expiresAt = String(data);
  }
  const payload: InvitePayload = {
    version: 2, projectUrl: config.projectUrl, circleId: config.circleId, inviteId, inviteSecret,
    encryptionKey: config.encryptionKey, circleName: config.circleName,
  };
  return { qrValue: encodeInvite(payload), expiresAt };
}

export async function joinCircle(qrValue: string): Promise<CircleConfig> {
  const invite = decodeInvite(qrValue);
  const deviceId = await ensureBackendSession();
  const config: CircleConfig = {
    version: 2, circleId: invite.circleId, deviceId, encryptionKey: invite.encryptionKey,
    projectUrl: invite.projectUrl, circleName: invite.circleName, isOwner: false,
  };
  await saveCircle({ ...config, pending: true });
  let claimedCircleId: string;
  try {
    if (isSelfHosted()) claimedCircleId = await claimSelfHostedInvite(invite.inviteId, invite.inviteSecret, invite.circleId);
    else {
      const { data, error } = await getSupabase().rpc('free360_claim_invite', { p_invite_id: invite.inviteId, p_secret: invite.inviteSecret, p_circle_id: invite.circleId });
      if (error) throw error;
      claimedCircleId = data;
    }
  } catch (error) {
    if (await recoverPendingCircle(config)) return config;
    throw error;
  }
  if (claimedCircleId !== invite.circleId) throw new Error('This invitation does not match the circle.');
  await saveCircle(config);
  return config;
}

async function recoverPendingCircle(config: CircleConfig) {
  try {
    await ensureMatchingSession(config);
    if (isSelfHosted()) {
      if (!await isSelfHostedMember(config.circleId)) return false;
    } else {
      const { data, error } = await getSupabase().rpc('free360_is_member', { p_circle_id: config.circleId });
      if (error || data !== true) return false;
    }
    await saveCircle({ ...config, pending: false });
    return true;
  } catch {
    return false;
  }
}

async function ensureMatchingSession(config: CircleConfig) {
  requireProject(config.projectUrl);
  const deviceId = await ensureBackendSession();
  if (deviceId !== config.deviceId) throw new Error('This device session changed. Restore its original app data or ask the circle owner for a new invitation.');
}

type PendingSnapshot = { circleId: string; deviceId: string; id: string; envelope: EncryptedEnvelope };
let snapshotQueue: Promise<void> = Promise.resolve();

function serializeSnapshot<T>(operation: () => Promise<T>): Promise<T> {
  const result = snapshotQueue.then(operation, operation);
  snapshotQueue = result.then(() => undefined, () => undefined);
  return result;
}

async function sendEnvelope(config: CircleConfig, envelope: EncryptedEnvelope, type: 'snapshot' | 'event' | 'history') {
  await ensureMatchingSession(config);
  if (isSelfHosted()) await publishSelfHostedEnvelope(envelope, type);
  else {
    const rpc = type === 'snapshot' ? 'free360_publish_snapshot' : type === 'event' ? 'free360_publish_event' : 'free360_publish_history';
    const { error } = await getSupabase().rpc(rpc, { p_envelope: envelope });
    if (error) throw error;
  }
}

async function flushPendingSnapshotInner(config: CircleConfig) {
  const raw = await SecureStore.getItemAsync(PENDING_SNAPSHOT_KEY);
  if (!raw) return;
  const pending: PendingSnapshot = JSON.parse(raw);
  if (pending.circleId !== config.circleId || pending.deviceId !== config.deviceId) {
    await SecureStore.deleteItemAsync(PENDING_SNAPSHOT_KEY);
    return;
  }
  await sendEnvelope(config, pending.envelope, 'snapshot');
  const current = await SecureStore.getItemAsync(PENDING_SNAPSHOT_KEY);
  if (current && (JSON.parse(current) as PendingSnapshot).id === pending.id) await SecureStore.deleteItemAsync(PENDING_SNAPSHOT_KEY);
}

export function flushPendingSnapshot(config: CircleConfig) {
  return serializeSnapshot(() => flushPendingSnapshotInner(config));
}

async function publishSnapshotInner(config: CircleConfig, snapshot: CircleSnapshot) {
  const profile = await loadDeviceProfile();
  const level = await Battery.getBatteryLevelAsync().catch(() => -1);
  profile.battery = level >= 0 ? Math.round(level * 100) : null;
  const payload: CircleSnapshot = { ...snapshot, profile };
  await SecureStore.setItemAsync('free360.last-snapshot.v1', JSON.stringify(payload));
  const pending: PendingSnapshot = { circleId: config.circleId, deviceId: config.deviceId, id: randomId(), envelope: encryptCirclePayload(payload, config.encryptionKey) };
  await SecureStore.setItemAsync(PENDING_SNAPSHOT_KEY, JSON.stringify(pending));
  await flushPendingSnapshotInner(config);
}

export function publishSnapshot(config: CircleConfig, payload: CircleSnapshot) {
  return serializeSnapshot(() => publishSnapshotInner(config, payload));
}

function parseProfile(value: unknown): DeviceProfile | undefined {
  if (!isRecord(value) || typeof value.name !== 'string' || !value.name.trim() || value.name.length > 40) return undefined;
  let home: Home | null = null;
  if (isRecord(value.home)) {
    const { latitude, longitude, radius } = value.home;
    if (typeof latitude === 'number' && Number.isFinite(latitude) && Math.abs(latitude) <= 90 && typeof longitude === 'number' && Number.isFinite(longitude) && Math.abs(longitude) <= 180 && typeof radius === 'number' && Number.isFinite(radius) && radius >= 100 && radius <= 1000) home = { latitude, longitude, radius };
  }
  const battery = typeof value.battery === 'number' && Number.isFinite(value.battery) && value.battery >= 0 && value.battery <= 100 ? Math.round(value.battery) : null;
  // An invalid photo strips only the avatar, never the rest of the profile,
  // so old clients and corrupt values stay backward compatible.
  const avatar = normalizeAvatar(value.avatar);
  return { name: value.name.trim(), home, battery, avatar };
}

export async function loadDeviceProfile(): Promise<DeviceProfile> {
  const raw = await SecureStore.getItemAsync('free360.profile.v1');
  try { return parseProfile(raw ? JSON.parse(raw) : null) ?? { name: 'This device', home: null, battery: null }; }
  catch { return { name: 'This device', home: null, battery: null }; }
}

export async function saveDeviceProfile(profile: DeviceProfile) {
  const validated = parseProfile(profile);
  if (!validated) throw new Error('Enter a name with 1–40 characters.');
  await SecureStore.setItemAsync('free360.profile.v1', JSON.stringify(validated));
  // The local save above is durable. A queued/offline snapshot publish must
  // not misreport it as a total failure: the pending envelope stays stored
  // and flushes on reconnect.
  try {
    await refreshDeviceSnapshot();
  } catch (error) {
    console.warn('[Free360] Profile saved locally; snapshot queued:', error);
  }
}

export async function refreshDeviceSnapshot() {
  const config = await loadCircle();
  if (config) {
    const raw = await SecureStore.getItemAsync('free360.last-snapshot.v1');
    const snapshot: CircleSnapshot = raw ? JSON.parse(raw) : { type: 'paused', recordedAt: new Date().toISOString() };
    await publishSnapshot(config, snapshot);
  }
}

function distanceMeters(a: { latitude: number; longitude: number }, b: { latitude: number; longitude: number }) {
  const radians = Math.PI / 180;
  const x = (b.longitude - a.longitude) * radians * Math.cos(((a.latitude + b.latitude) / 2) * radians);
  const y = (b.latitude - a.latitude) * radians;
  return Math.hypot(x, y) * 6371000;
}

// Appends a trail point when the device has moved meaningfully: at the five-minute
// refresh cadence after any movement, or immediately on jumps of a kilometer or more.
// A stationary device keeps refreshing its snapshot without adding duplicate points.
let lastHistoryPoint: { recordedAt: number; latitude: number; longitude: number } | null = null;

function shouldStoreHistoryPoint(location: { latitude: number; longitude: number }, recordedAt: string) {
  const last = lastHistoryPoint;
  const moved = last ? distanceMeters(last, location) : Infinity;
  const elapsed = last ? Date.parse(recordedAt) - last.recordedAt : Infinity;
  if (!last || (elapsed >= HISTORY_MIN_INTERVAL_MS && moved >= HISTORY_MIN_MOVE_METERS) || moved >= HISTORY_JUMP_METERS) {
    lastHistoryPoint = { recordedAt: Date.parse(recordedAt), latitude: location.latitude, longitude: location.longitude };
    return true;
  }
  return false;
}

export function publishLocation(config: CircleConfig, location: Omit<SharedLocation, 'type' | 'recordedAt'>, recordedAt = new Date().toISOString()) {
  return serializeSnapshot(async () => {
    const payload: SharedLocation = { type: 'location', ...location, recordedAt };
    await publishSnapshotInner(config, payload);
    if (shouldStoreHistoryPoint(location, recordedAt)) {
      try {
        await sendEnvelope(config, encryptCirclePayload(payload, config.encryptionKey), 'history');
      } catch (error) {
        console.warn('[Free360] History point skipped:', error);
      }
    }
  });
}

export function publishPaused(config: CircleConfig) {
  return publishSnapshot(config, { type: 'paused', recordedAt: new Date().toISOString() });
}

export async function publishCheckIn(config: CircleConfig, message: string, id = randomId(), recordedAt = new Date().toISOString()): Promise<CheckIn> {
  const payload: CheckIn = { type: 'checkin', id, message: message.trim().slice(0, 500), recordedAt };
  await sendEnvelope(config, encryptCirclePayload(payload, config.encryptionKey), 'event');
  return payload;
}

function decodePayloadRow(row: { device_id: unknown; envelope: unknown }, encryptionKey: string): { deviceId: string; payload: CirclePayload } | null {
  if (typeof row.device_id !== 'string' || !isRecord(row.envelope)) return null;
  const envelope = row.envelope;
  if (envelope.version !== 1 || typeof envelope.nonce !== 'string' || typeof envelope.ciphertext !== 'string') return null;
  const payload = decryptCirclePayload({ version: 1, nonce: envelope.nonce, ciphertext: envelope.ciphertext }, encryptionKey);
  return payload ? { deviceId: row.device_id, payload } : null;
}

export async function fetchCircleSnapshots(config: CircleConfig): Promise<Record<string, CircleSnapshot>> {
  const rows: { device_id: unknown; envelope: unknown }[] = isSelfHosted()
    ? await fetchSelfHostedSnapshots(config.circleId)
    : await (async () => {
        const { data, error } = await getSupabase().from('free360_snapshots').select('device_id,envelope').eq('circle_id', config.circleId);
        if (error) throw error;
        return data ?? [];
      })();
  const snapshots: Record<string, CircleSnapshot> = {};
  for (const row of rows) {
    const decoded = decodePayloadRow(row, config.encryptionKey);
    if (decoded && decoded.payload.type !== 'checkin') snapshots[decoded.deviceId] = decoded.payload;
  }
  return snapshots;
}

export async function fetchLocationHistory(config: CircleConfig): Promise<Record<string, HistoryPoint[]>> {
  const cutoff = Date.now() - LOCATION_HISTORY_RETENTION_MS;
  const rows: { device_id: unknown; envelope: unknown }[] = isSelfHosted()
    ? await fetchSelfHostedHistory(config.circleId)
    : await (async () => {
        const { data, error } = await getSupabase().from('free360_history').select('device_id,envelope').eq('circle_id', config.circleId).gte('received_at', new Date(cutoff).toISOString()).order('received_at');
        if (error) throw error;
        return data ?? [];
      })();
  const history: Record<string, HistoryPoint[]> = {};
  for (const row of rows) {
    const decoded = decodePayloadRow(row, config.encryptionKey);
    if (!decoded || decoded.payload.type !== 'location' || Date.parse(decoded.payload.recordedAt) < cutoff) continue;
    const point: HistoryPoint = { latitude: decoded.payload.latitude, longitude: decoded.payload.longitude, recordedAt: decoded.payload.recordedAt };
    const points = history[decoded.deviceId] ?? [];
    points.push(point);
    history[decoded.deviceId] = points;
  }
  for (const points of Object.values(history)) points.sort((a, b) => Date.parse(a.recordedAt) - Date.parse(b.recordedAt));
  return history;
}

function receiveEncryptedUpdate(row: Record<string, unknown>, encryptionKey: string, onUpdate: (update: CircleUpdate) => void) {
  if (typeof row.device_id !== 'string' || !isRecord(row.envelope)) return;
  const envelope = row.envelope;
  if (envelope.version !== 1 || typeof envelope.nonce !== 'string' || typeof envelope.ciphertext !== 'string') return;
  const payload = decryptCirclePayload({ version: 1, nonce: envelope.nonce, ciphertext: envelope.ciphertext }, encryptionKey);
  if (payload?.type === 'checkin') onUpdate({ kind: 'checkin', deviceId: row.device_id, payload });
  else if (payload) onUpdate({ kind: 'snapshot', deviceId: row.device_id, payload });
}

export function subscribeToCircle(config: CircleConfig, onUpdate: (update: CircleUpdate) => void, onConnectionChange: (connected: boolean) => void): CircleSubscription {
  if (isSelfHosted()) return subscribeSelfHosted(config, (rows) => {
    for (const row of rows) receiveEncryptedUpdate(row, config.encryptionKey, onUpdate);
  }, onConnectionChange, () => {
    void flushPendingSnapshot(config).catch((error) => console.warn('[Free360] Queued snapshot waiting for server:', error));
  });
  let closed = false;
  let channel: ReturnType<ReturnType<typeof getSupabase>['channel']> | null = null;
  const start = async () => {
    try {
      await ensureMatchingSession(config);
      if (closed) return;
      const supabase = getSupabase();
      channel = supabase.channel(`free360:${config.circleId}`)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'free360_snapshots', filter: `circle_id=eq.${config.circleId}` }, ({ new: row }) => {
          if (isRecord(row)) receiveEncryptedUpdate(row, config.encryptionKey, onUpdate);
        })
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'free360_events', filter: `circle_id=eq.${config.circleId}` }, ({ new: row }) => {
          if (isRecord(row)) receiveEncryptedUpdate(row, config.encryptionKey, onUpdate);
        })
        .subscribe((status) => {
          if (closed) return;
          if (status !== 'SUBSCRIBED') { onConnectionChange(false); return; }
          void (async () => {
            const [snapshots, events] = await Promise.all([
              supabase.from('free360_snapshots').select('device_id,envelope').eq('circle_id', config.circleId),
              supabase.from('free360_events').select('device_id,envelope').eq('circle_id', config.circleId).order('received_at', { ascending: false }).limit(100),
            ]);
            if (snapshots.error) throw snapshots.error;
            if (events.error) throw events.error;
            if (closed) return;
            for (const row of snapshots.data ?? []) receiveEncryptedUpdate(row, config.encryptionKey, onUpdate);
            for (const row of events.data ?? []) receiveEncryptedUpdate(row, config.encryptionKey, onUpdate);
            onConnectionChange(true);
            void flushPendingSnapshot(config).catch((error) => console.warn('[Free360] Queued snapshot waiting for Supabase:', error));
          })().catch((error) => { console.warn('[Free360] Could not load circle updates:', error); onConnectionChange(false); });
        });
    } catch (error) {
      console.warn('[Free360] Could not subscribe to circle:', error);
      if (!closed) onConnectionChange(false);
    }
  };
  void start();
  return { close: () => { closed = true; if (channel) void getSupabase().removeChannel(channel); onConnectionChange(false); } };
}

let circleStorageMigrated = false;
export async function loadCircle() {
  const raw = await SecureStore.getItemAsync(CIRCLE_STORAGE_KEY);
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed) || parsed.version !== PROTOCOL_VERSION) return null;
    const config: CircleConfig = {
      version: 2,
      circleId: requireString(parsed.circleId, 'circle ID'),
      deviceId: requireString(parsed.deviceId, 'device ID'),
      encryptionKey: requireString(parsed.encryptionKey, 'encryption key'),
      projectUrl: requireString(parsed.projectUrl, 'project URL'),
      circleName: requireString(parsed.circleName, 'circle name'),
      isOwner: Boolean(parsed.isOwner),
      pending: Boolean(parsed.pending),
    };
    getKey(config.encryptionKey);
    requireProject(config.projectUrl);
    if (config.pending) {
      if (!await recoverPendingCircle(config)) return null;
      return { ...config, pending: false };
    }
    if (!circleStorageMigrated) { await saveCircle(config); circleStorageMigrated = true; }
    return config;
  } catch { return null; }
}

export function saveCircle(config: CircleConfig) {
  return SecureStore.setItemAsync(CIRCLE_STORAGE_KEY, JSON.stringify(config));
}

export function clearCircle() {
  return SecureStore.deleteItemAsync(CIRCLE_STORAGE_KEY);
}
