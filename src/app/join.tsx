import { Ionicons } from '@expo/vector-icons';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Alert, Pressable, SafeAreaView, StyleSheet, Text, View } from 'react-native';
import { joinCircle } from '../lib/circle';

const ink = '#16233B';
const coral = '#FF6E61';

export default function JoinRoute() {
  const router = useRouter();
  const [permission, requestPermission] = useCameraPermissions();
  const [joining, setJoining] = useState(false);
  const [scanned, setScanned] = useState(false);

  const claim = async (value: string) => {
    if (scanned || joining) return;
    setScanned(true);
    setJoining(true);
    try {
      await joinCircle(value);
      router.replace('/map');
    } catch (error) {
      Alert.alert('Could not join this circle', error instanceof Error ? error.message : 'Ask the owner to create a new invitation QR code.');
      setScanned(false);
    } finally {
      setJoining(false);
    }
  };

  if (!permission) return <View style={styles.loading}><ActivityIndicator color={coral} /></View>;
  if (!permission.granted) return <SafeAreaView style={styles.permissionRoot}><View style={styles.permissionContent}><View style={styles.permissionIcon}><Ionicons name="camera-outline" size={33} color={coral} /></View><Text style={styles.permissionTitle}>Scan a private invitation</Text><Text style={styles.permissionText}>Free360 only uses the camera to read the invitation QR code.</Text><Pressable style={styles.allow} onPress={() => void requestPermission()}><Text style={styles.allowText}>Allow camera access</Text></Pressable><Pressable style={styles.cancel} onPress={() => router.back()}><Text style={styles.cancelText}>Not now</Text></Pressable></View></SafeAreaView>;

  return <View style={styles.cameraRoot}><CameraView style={StyleSheet.absoluteFill} facing="back" barcodeScannerSettings={{ barcodeTypes: ['qr'] }} onBarcodeScanned={scanned ? undefined : ({ data }) => void claim(data)} /><SafeAreaView style={styles.overlay}><View style={styles.top}><Pressable style={styles.close} onPress={() => router.back()}><Ionicons name="close" size={22} color="#FFF" /></Pressable><Text style={styles.scanTitle}>Scan invitation QR</Text><View style={styles.close} /></View><View style={styles.center}><View style={styles.scanFrame}><View style={[styles.corner, styles.topLeft]} /><View style={[styles.corner, styles.topRight]} /><View style={[styles.corner, styles.bottomLeft]} /><View style={[styles.corner, styles.bottomRight]} /></View><Text style={styles.scanBody}>Point your camera at the code shown by your circle owner.</Text></View>{joining && <View style={styles.joining}><ActivityIndicator color="#FFF" /><Text style={styles.joiningText}>Joining private circle…</Text></View>}</SafeAreaView></View>;
}

const styles = StyleSheet.create({
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#F6F8FB' },
  permissionRoot: { flex: 1, backgroundColor: '#F6F8FB' },
  permissionContent: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 28 },
  permissionIcon: { width: 70, height: 70, borderRadius: 23, backgroundColor: '#FFF0EE', alignItems: 'center', justifyContent: 'center', marginBottom: 20 },
  permissionTitle: { color: ink, fontSize: 25, fontWeight: '800', textAlign: 'center' },
  permissionText: { color: '#718099', fontSize: 13, lineHeight: 19, textAlign: 'center', marginTop: 9 },
  allow: { height: 52, borderRadius: 15, backgroundColor: coral, width: '100%', alignItems: 'center', justifyContent: 'center', marginTop: 28 },
  allowText: { color: '#FFF', fontWeight: '800' },
  cancel: { padding: 17 },
  cancelText: { color: '#718099', fontWeight: '700' },
  cameraRoot: { flex: 1, backgroundColor: '#000' },
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.28)' },
  top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingTop: 8 },
  close: { width: 42, height: 42, borderRadius: 14, backgroundColor: 'rgba(0,0,0,0.35)', alignItems: 'center', justifyContent: 'center' },
  scanTitle: { color: '#FFF', fontWeight: '800', fontSize: 16 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  scanFrame: { width: 244, height: 244, position: 'relative' },
  corner: { position: 'absolute', width: 44, height: 44, borderColor: '#FFF' },
  topLeft: { top: 0, left: 0, borderTopWidth: 4, borderLeftWidth: 4, borderTopLeftRadius: 18 },
  topRight: { top: 0, right: 0, borderTopWidth: 4, borderRightWidth: 4, borderTopRightRadius: 18 },
  bottomLeft: { bottom: 0, left: 0, borderBottomWidth: 4, borderLeftWidth: 4, borderBottomLeftRadius: 18 },
  bottomRight: { bottom: 0, right: 0, borderBottomWidth: 4, borderRightWidth: 4, borderBottomRightRadius: 18 },
  scanBody: { color: '#FFF', textAlign: 'center', fontSize: 12, lineHeight: 18, marginTop: 28, paddingHorizontal: 54 },
  joining: { alignSelf: 'center', position: 'absolute', bottom: 44, borderRadius: 16, paddingVertical: 13, paddingHorizontal: 17, backgroundColor: 'rgba(22,35,59,0.93)', flexDirection: 'row', alignItems: 'center', gap: 9 },
  joiningText: { color: '#FFF', fontWeight: '700', fontSize: 12 },
});
