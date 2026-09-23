import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Alert, Pressable, SafeAreaView, StyleSheet, Text, View } from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import { createInvite, loadCircle } from '../lib/circle';

const ink = '#16233B';
const muted = '#718099';
const coral = '#FF6E61';

export default function InviteRoute() {
  const router = useRouter();
  const [qrValue, setQrValue] = useState<string | null>(null);
  const [expiresAt, setExpiresAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const generate = async () => {
    setLoading(true);
    try {
      const circle = await loadCircle();
      if (!circle) throw new Error('Create or join a circle before making an invitation.');
      if (!circle.isOwner) throw new Error('Only the device that created this circle can make invitations.');
      const invite = await createInvite(circle);
      setQrValue(invite.qrValue);
      setExpiresAt(invite.expiresAt);
    } catch (error) {
      Alert.alert('Could not make an invitation', error instanceof Error ? error.message : 'Try again.');
      router.back();
    } finally {
      setLoading(false);
    }
  };

  return <SafeAreaView style={styles.root}><View style={styles.content}><Pressable style={styles.close} onPress={() => router.back()}><Ionicons name="close" size={22} color={ink} /></Pressable><View style={styles.icon}><Ionicons name="person-add-outline" size={30} color={coral} /></View><Text style={styles.title}>Invite a trusted person</Text><Text style={styles.body}>Have them scan this code in the Free360 build configured for your group. It works once and expires after 15 minutes.</Text><View style={styles.qrCard}>{loading ? <ActivityIndicator size="large" color={coral} /> : qrValue ? <QRCode value={qrValue} size={226} color={ink} backgroundColor="#FFF" /> : <Pressable style={styles.generatePrompt} onPress={() => void generate()}><Ionicons name="qr-code-outline" size={35} color={coral} /><Text style={styles.generatePromptText}>Create one-time QR</Text></Pressable>}</View>{expiresAt && <View style={styles.expiry}><Ionicons name="time-outline" size={16} color="#C88313" /><Text style={styles.expiryText}>Expires {new Date(expiresAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</Text></View>}<View style={styles.step}><View style={styles.stepNumber}><Text style={styles.stepNumberText}>1</Text></View><Text style={styles.stepText}>They open Free360 and choose “I have an invitation QR”.</Text></View><View style={styles.step}><View style={styles.stepNumber}><Text style={styles.stepNumberText}>2</Text></View><Text style={styles.stepText}>They scan this code. Their device creates an anonymous session and joins your circle.</Text></View><Pressable disabled={loading} style={styles.refresh} onPress={() => void generate()}><Ionicons name={qrValue ? 'refresh' : 'add'} size={18} color={coral} /><Text style={styles.refreshText}>{qrValue ? 'Create a new code' : 'Create invitation code'}</Text></Pressable></View></SafeAreaView>;
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#F6F8FB' },
  content: { flex: 1, alignItems: 'center', padding: 22 },
  close: { alignSelf: 'flex-end', width: 40, height: 40, borderRadius: 13, backgroundColor: '#FFF', alignItems: 'center', justifyContent: 'center' },
  icon: { width: 66, height: 66, borderRadius: 22, backgroundColor: '#FFF0EE', alignItems: 'center', justifyContent: 'center', marginTop: 14, marginBottom: 14 },
  title: { color: ink, fontSize: 25, fontWeight: '800', letterSpacing: -0.5 },
  body: { color: muted, fontSize: 12.5, lineHeight: 19, textAlign: 'center', marginTop: 8, paddingHorizontal: 25 },
  qrCard: { width: 270, height: 270, borderRadius: 24, backgroundColor: '#FFF', alignItems: 'center', justifyContent: 'center', marginTop: 26, shadowColor: ink, shadowOpacity: 0.07, shadowRadius: 12, shadowOffset: { width: 0, height: 4 }, elevation: 2 },
  generatePrompt: { alignItems: 'center', gap: 11 },
  generatePromptText: { color: coral, fontWeight: '800', fontSize: 13 },
  expiry: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 13, backgroundColor: '#FFF5DC', paddingHorizontal: 10, paddingVertical: 7, borderRadius: 99 },
  expiryText: { color: '#A87014', fontWeight: '700', fontSize: 10.5 },
  step: { flexDirection: 'row', alignItems: 'center', width: '100%', marginTop: 17, gap: 10 },
  stepNumber: { width: 25, height: 25, borderRadius: 9, backgroundColor: '#EDF4FF', alignItems: 'center', justifyContent: 'center' },
  stepNumberText: { color: '#4386F4', fontWeight: '800', fontSize: 11 },
  stepText: { flex: 1, color: muted, fontSize: 11, lineHeight: 16 },
  refresh: { height: 48, borderRadius: 14, backgroundColor: '#FFF0EE', paddingHorizontal: 20, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: 24 },
  refreshText: { color: coral, fontWeight: '800', fontSize: 13 },
});
