import { COLORS, FONTS, RADII, SHADOWS } from '../theme';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import QRCode from 'react-native-qrcode-svg';
import { createInvite, loadCircle } from '../lib/circle';

const ink = COLORS.ink;
const muted = COLORS.muted;
const coral = COLORS.purple;

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

  return <SafeAreaView style={styles.root}><View style={styles.content}><Pressable style={styles.close} onPress={() => router.back()}><Ionicons name="close" size={22} color={ink} /></Pressable><View style={styles.icon}><Ionicons name="person-add-outline" size={30} color={coral} /></View><Text style={styles.title}>Invite a trusted person</Text><Text style={styles.body}>Have them scan this code in Free360. The code configures their server connection automatically. It works once and expires after 15 minutes.</Text><View style={styles.qrCard}>{loading ? <ActivityIndicator size="large" color={coral} /> : qrValue ? <QRCode value={qrValue} size={226} color={ink} backgroundColor={COLORS.white} /> : <Pressable style={styles.generatePrompt} onPress={() => void generate()}><Ionicons name="qr-code-outline" size={35} color={coral} /><Text style={styles.generatePromptText}>Create one-time QR</Text></Pressable>}</View>{expiresAt && <View style={styles.expiry}><Ionicons name="time-outline" size={16} color={COLORS.yellow} /><Text style={styles.expiryText}>Expires {new Date(expiresAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</Text></View>}<View style={styles.step}><View style={styles.stepNumber}><Text style={styles.stepNumberText}>1</Text></View><Text style={styles.stepText}>They open Free360 and choose “I have an invitation QR”.</Text></View><View style={styles.step}><View style={styles.stepNumber}><Text style={styles.stepNumberText}>2</Text></View><Text style={styles.stepText}>They scan this code. Their device saves your server settings and joins your circle.</Text></View><Pressable disabled={loading} style={styles.refresh} onPress={() => void generate()}><Ionicons name={qrValue ? 'refresh' : 'add'} size={18} color={coral} /><Text style={styles.refreshText}>{qrValue ? 'Create a new code' : 'Create invitation code'}</Text></Pressable></View></SafeAreaView>;
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.canvas },
  content: { flex: 1, alignItems: 'center', padding: 22 },
  close: { alignSelf: 'flex-end', width: 48, height: 48, borderRadius: RADII.card, backgroundColor: COLORS.white, alignItems: 'center', justifyContent: 'center', ...SHADOWS.floating },
  icon: { width: 66, height: 66, borderRadius: RADII.card, backgroundColor: COLORS.purpleSoft, alignItems: 'center', justifyContent: 'center', marginTop: 14, marginBottom: 14 },
  title: { fontFamily: FONTS.heavy, color: ink, fontSize: 25, fontWeight: 'normal', letterSpacing: -0.5 },
  body: { fontFamily: FONTS.regular, color: muted, fontSize: 12.5, lineHeight: 19, textAlign: 'center', marginTop: 8, paddingHorizontal: 25 },
  qrCard: { width: 270, height: 270, borderRadius: RADII.card, backgroundColor: COLORS.white, alignItems: 'center', justifyContent: 'center', marginTop: 26, ...SHADOWS.card },
  generatePrompt: { alignItems: 'center', gap: 11 },
  generatePromptText: { fontFamily: FONTS.heavy, color: coral, fontWeight: 'normal', fontSize: 13 },
  expiry: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 13, backgroundColor: COLORS.yellowSoft, paddingHorizontal: 10, paddingVertical: 7, borderRadius: RADII.pill },
  expiryText: { fontFamily: FONTS.bold, color: COLORS.yellow, fontWeight: 'normal', fontSize: 10.5 },
  step: { flexDirection: 'row', alignItems: 'center', width: '100%', marginTop: 17, gap: 10 },
  stepNumber: { width: 25, height: 25, borderRadius: 9, backgroundColor: COLORS.blueSoft, alignItems: 'center', justifyContent: 'center' },
  stepNumberText: { fontFamily: FONTS.heavy, color: COLORS.purple, fontWeight: 'normal', fontSize: 11 },
  stepText: { fontFamily: FONTS.regular, flex: 1, color: muted, fontSize: 11, lineHeight: 16 },
  refresh: { minHeight: 48, height: 48, borderRadius: RADII.pill, backgroundColor: COLORS.purpleSoft, paddingHorizontal: 20, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: 24, ...SHADOWS.card },
  refreshText: { fontFamily: FONTS.heavy, color: coral, fontWeight: 'normal', fontSize: 13 },
});
