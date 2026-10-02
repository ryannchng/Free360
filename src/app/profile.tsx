import { useEffect, useState } from 'react';
import { Alert, Pressable, ScrollView, Text, TextInput, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import * as Location from 'expo-location';
import { loadDeviceProfile, saveDeviceProfile, type DeviceProfile } from '../lib/circle';
import { enableNotifications, refreshHomeMonitoring } from '../lib/home-alerts';

export default function ProfileRoute() {
  const router = useRouter();
  const [profile, setProfile] = useState<DeviceProfile>({ name: '', home: null, battery: null });
  const [busy, setBusy] = useState(false);
  const [latitude, setLatitude] = useState('');
  const [longitude, setLongitude] = useState('');
  useEffect(() => { void loadDeviceProfile().then(value => { setProfile(value); setLatitude(value.home ? String(value.home.latitude) : ''); setLongitude(value.home ? String(value.home.longitude) : ''); }); }, []);
  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    try { await action(); }
    catch (error) { Alert.alert('Could not save', error instanceof Error ? error.message : 'Please try again.'); }
    finally { setBusy(false); }
  };
  const save = async () => {
    let home = null;
    if (latitude.trim() || longitude.trim()) {
      const lat = Number(latitude), lon = Number(longitude);
      if (!latitude.trim() || !longitude.trim() || !Number.isFinite(lat) || Math.abs(lat) > 90 || !Number.isFinite(lon) || Math.abs(lon) > 180) throw new Error('Enter valid latitude and longitude, or clear both to remove your home.');
      home = { latitude: lat, longitude: lon, radius: 150 };
    }
    await saveDeviceProfile({ ...profile, name: profile.name.trim(), home });
    await refreshHomeMonitoring();
    router.back();
  };
  return <SafeAreaView style={styles.root}><ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
    <Pressable onPress={() => router.back()} accessibilityRole="button"><Text style={styles.link}>Back</Text></Pressable>
    <Text style={styles.title}>Your name and home</Text>
    <Text style={styles.body}>Your name is linked to this phone’s UUID. Your circle can see your name, home, and last reported battery level.</Text>
    <Text style={styles.label}>NAME</Text><TextInput accessibilityLabel="Your name" style={styles.input} value={profile.name} maxLength={40} onChangeText={name => setProfile(current => ({ ...current, name }))} placeholder="Your name" />
    <Text style={styles.label}>HOME LOCATION</Text>
    <Text style={styles.body}>Save your own residence. Arrival and departure monitoring uses a 150 metre radius. Clear both coordinates to remove it.</Text>
    <TextInput accessibilityLabel="Home latitude" style={styles.input} value={latitude} onChangeText={setLatitude} keyboardType="numbers-and-punctuation" placeholder="Latitude" />
    <TextInput accessibilityLabel="Home longitude" style={styles.input} value={longitude} onChangeText={setLongitude} keyboardType="numbers-and-punctuation" placeholder="Longitude" />
    <Pressable disabled={busy} onPress={() => void run(async () => {
      if (!(await Location.requestForegroundPermissionsAsync()).granted) throw new Error('Location permission is required.');
      const position = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
      setLatitude(String(position.coords.latitude)); setLongitude(String(position.coords.longitude));
    })}><Text style={styles.link}>Use my current location as home</Text></Pressable>
    <Pressable style={styles.button} disabled={busy || !profile.name.trim()} onPress={() => void run(save)}><Text style={styles.buttonText}>{busy ? 'Working…' : 'Save name and home'}</Text></Pressable>
    <Text style={styles.label}>HOME ALERTS</Text>
    <Text style={styles.body}>Enable push notifications to receive home activity alerts while the app is closed. Open the activity tab to see who arrived or left. Background location sharing must be enabled on the travelling phone.</Text>
    <Pressable style={styles.button} disabled={busy} onPress={() => void run(async () => { await enableNotifications(); Alert.alert('Notifications enabled', 'You will receive home activity alerts from your circle.'); })}><Text style={styles.buttonText}>Enable notifications</Text></Pressable>
  </ScrollView></SafeAreaView>;
}
const styles = StyleSheet.create({ root: { flex: 1, backgroundColor: '#F6F8FB' }, content: { padding: 24, gap: 14 }, title: { fontSize: 26, fontWeight: '800', color: '#16233B' }, body: { fontSize: 14, lineHeight: 21, color: '#718099' }, label: { fontSize: 12, fontWeight: '700', marginTop: 16 }, input: { backgroundColor: 'white', borderWidth: 1, borderColor: '#E6EAF0', padding: 16, borderRadius: 12, color: '#16233B' }, button: { backgroundColor: '#7944D5', borderRadius: 14, padding: 17, alignItems: 'center' }, buttonText: { color: 'white', fontWeight: '700' }, link: { color: '#7944D5', paddingVertical: 12, fontWeight: '700' } });
