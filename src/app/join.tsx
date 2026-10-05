import { COLORS, FONTS, RADII, SHADOWS } from '../theme';
import { Ionicons } from '@expo/vector-icons';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { joinCircle, loadDeviceProfile, saveDeviceProfile, publishPaused } from '../lib/circle';

const ink = COLORS.ink;
const coral = COLORS.purple;

export default function JoinRoute() {
  const router = useRouter();
  const [permission, requestPermission] = useCameraPermissions();
  const [joining, setJoining] = useState(false);
  const [scanned, setScanned] = useState(false);
  const [name, setName] = useState('');
  const [named, setNamed] = useState(false);

  const claim = async (value: string) => {
    if (scanned || joining) return;
    setScanned(true);
    setJoining(true);
    try {
      const circle = await joinCircle(value);
      await saveDeviceProfile({ ...await loadDeviceProfile(), name: name.trim() });
      await publishPaused(circle).catch(() => {});
      router.replace('/map');
    } catch (error) {
      Alert.alert('Could not join this circle', error instanceof Error ? error.message : 'Ask the owner to create a new invitation QR code.');
      setScanned(false);
    } finally {
      setJoining(false);
    }
  };

  if (!named) return <SafeAreaView style={styles.permissionRoot}><View style={styles.permissionContent}><Text style={styles.permissionTitle}>What is your name?</Text><TextInput accessibilityLabel="Your name" value={name} onChangeText={setName} maxLength={40} placeholder="Your name" style={styles.nameInput} /><Pressable disabled={!name.trim()} style={styles.allow} onPress={() => setNamed(true)}><Text style={styles.allowText}>Continue to invitation scanner</Text></Pressable></View></SafeAreaView>;
  if (!permission) return <View style={styles.loading}><ActivityIndicator color={coral} /></View>;
  if (!permission.granted) return <SafeAreaView style={styles.permissionRoot}><View style={styles.permissionContent}><View style={styles.permissionIcon}><Ionicons name="camera-outline" size={33} color={coral} /></View><Text style={styles.permissionTitle}>Scan a private invitation</Text><Text style={styles.permissionText}>Free360 only uses the camera to read the invitation QR code.</Text><Pressable style={styles.allow} onPress={() => void requestPermission()}><Text style={styles.allowText}>Allow camera access</Text></Pressable><Pressable style={styles.cancel} onPress={() => router.back()}><Text style={styles.cancelText}>Not now</Text></Pressable></View></SafeAreaView>;

  return <View style={styles.cameraRoot}><CameraView style={StyleSheet.absoluteFill} facing="back" barcodeScannerSettings={{ barcodeTypes: ['qr'] }} onBarcodeScanned={scanned ? undefined : ({ data }) => void claim(data)} /><SafeAreaView style={styles.overlay}><View style={styles.top}><Pressable style={styles.close} onPress={() => router.back()}><Ionicons name="close" size={22} color={COLORS.white} /></Pressable><Text style={styles.scanTitle}>Scan invitation QR</Text><View style={styles.close} /></View><View style={styles.center}><View style={styles.scanFrame}><View style={[styles.corner, styles.topLeft]} /><View style={[styles.corner, styles.topRight]} /><View style={[styles.corner, styles.bottomLeft]} /><View style={[styles.corner, styles.bottomRight]} /></View><Text style={styles.scanBody}>Point your camera at the code shown by your circle owner. Your server connection is set up automatically.</Text></View>{joining && <View style={styles.joining}><ActivityIndicator color={COLORS.white} /><Text style={styles.joiningText}>Joining private circle…</Text></View>}</SafeAreaView></View>;
}

const styles = StyleSheet.create({
  nameInput: { width: '100%', minHeight: 56, backgroundColor: COLORS.white, borderRadius: RADII.card, padding: 16, marginTop: 20, color: COLORS.ink, fontFamily: FONTS.regular, ...SHADOWS.card },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: COLORS.canvas },
  permissionRoot: { flex: 1, backgroundColor: COLORS.canvas },
  permissionContent: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 28 },
  permissionIcon: { width: 70, height: 70, borderRadius: RADII.card, backgroundColor: COLORS.purpleSoft, alignItems: 'center', justifyContent: 'center', marginBottom: 20 },
  permissionTitle: { fontFamily: FONTS.heavy, color: ink, fontSize: 25, fontWeight: 'normal', textAlign: 'center' },
  permissionText: { fontFamily: FONTS.regular, color: COLORS.muted, fontSize: 13, lineHeight: 19, textAlign: 'center', marginTop: 9 },
  allow: { minHeight: 48, height: 52, borderRadius: RADII.pill, backgroundColor: coral, width: '100%', alignItems: 'center', justifyContent: 'center', marginTop: 28, ...SHADOWS.card },
  allowText: { fontFamily: FONTS.heavy, color: COLORS.white, fontWeight: 'normal' },
  cancel: { padding: 17 },
  cancelText: { fontFamily: FONTS.bold, color: COLORS.muted, fontWeight: 'normal' },
  cameraRoot: { flex: 1, backgroundColor: '#000' },
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.28)' },
  top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingTop: 8 },
  close: { width: 48, height: 48, borderRadius: RADII.card, backgroundColor: 'rgba(0,0,0,0.35)', alignItems: 'center', justifyContent: 'center', ...SHADOWS.floating },
  scanTitle: { fontFamily: FONTS.heavy, color: COLORS.white, fontWeight: 'normal', fontSize: 16 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  scanFrame: { width: 244, height: 244, position: 'relative' },
  corner: { position: 'absolute', width: 44, height: 44, borderColor: COLORS.white },
  topLeft: { top: 0, left: 0, borderTopWidth: 4, borderLeftWidth: 4, borderTopLeftRadius: 18 },
  topRight: { top: 0, right: 0, borderTopWidth: 4, borderRightWidth: 4, borderTopRightRadius: 18 },
  bottomLeft: { bottom: 0, left: 0, borderBottomWidth: 4, borderLeftWidth: 4, borderBottomLeftRadius: 18 },
  bottomRight: { bottom: 0, right: 0, borderBottomWidth: 4, borderRightWidth: 4, borderBottomRightRadius: 18 },
  scanBody: { fontFamily: FONTS.regular, color: COLORS.white, textAlign: 'center', fontSize: 12, lineHeight: 18, marginTop: 28, paddingHorizontal: 54 },
  joining: { alignSelf: 'center', position: 'absolute', bottom: 44, borderRadius: RADII.card, paddingVertical: 13, paddingHorizontal: 17, backgroundColor: 'rgba(22,35,59,0.93)', flexDirection: 'row', alignItems: 'center', gap: 9 },
  joiningText: { fontFamily: FONTS.bold, color: COLORS.white, fontWeight: 'normal', fontSize: 12 },
});
