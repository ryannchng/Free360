import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Alert, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { createCircle, loadDeviceProfile, saveDeviceProfile, publishPaused } from '../lib/circle';
import { isBackendConfigured, isSelfHosted } from '../lib/backend';
import { formatSetupCode, isSetupCodeValid, SETUP_CODE_INPUT_MAX_LENGTH } from '../lib/setup-code';

const ink = '#16233B';
const muted = '#718099';
const coral = '#FF6E61';

export default function CreateCircleRoute() {
  const router = useRouter();
  const [circleName, setCircleName] = useState('');
  const [setupCode, setSetupCode] = useState('');
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState('');
  const selfHostedMode = isSelfHosted();
  const configured = isBackendConfigured();
  const codeValid = selfHostedMode ? setupCode.trim().length > 0 : isSetupCodeValid(setupCode);
  const canCreate = !saving && configured && Boolean(name.trim()) && Boolean(circleName.trim()) && codeValid;

  const handleSetupCodeChange = (next: string) => {
    if (selfHostedMode) {
      setSetupCode(next);
      return;
    }
    setSetupCode(formatSetupCode(next));
  };

  const create = async () => {
    setSaving(true);
    try {
      if (!name.trim()) throw new Error('Enter your name.');
      await saveDeviceProfile({ ...await loadDeviceProfile(), name: name.trim() });
      const circle = await createCircle(circleName, setupCode);
      await publishPaused(circle).catch(() => {});
      router.replace('/map');
    } catch (error) {
      Alert.alert('Could not create the circle', error instanceof Error ? error.message : 'Check your group server setup and try again.');
    } finally {
      setSaving(false);
    }
  };

  return <SafeAreaView style={styles.root}><KeyboardAvoidingView style={styles.root} behavior={Platform.OS === 'ios' ? 'padding' : undefined}><ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled"><Pressable style={styles.back} onPress={() => router.back()}><Ionicons name="arrow-back" size={20} color={ink} /></Pressable><View style={styles.icon}><Ionicons name="server-outline" size={31} color={coral} /></View><Text style={styles.title}>Create your circle</Text><Text style={styles.body}>This Free360 build connects to your configured server. Your location and check-ins are encrypted on your device before they are stored there.</Text><View style={styles.notice}><Ionicons name="shield-checkmark-outline" size={19} color="#27B89A" /><Text style={styles.noticeText}>{configured ? `Your ${selfHostedMode ? 'self-hosted' : 'Supabase'} group server is configured. ${selfHostedMode ? "One circle can be created here." : "Multiple circles can use this project."}` : 'This build needs a group server. Follow the setup instructions in README.md before creating a circle.'}</Text></View><Text style={styles.label}>YOUR NAME</Text><TextInput accessibilityLabel="Your name" value={name} onChangeText={setName} style={styles.input} placeholder="Your name" maxLength={40} /><Text style={styles.label}>CIRCLE NAME</Text><TextInput value={circleName} onChangeText={setCircleName} style={styles.input} placeholder="My Circle" placeholderTextColor="#9AA6B8" maxLength={40} /><Text style={styles.label}>GROUP SETUP CODE</Text>{selfHostedMode ? <TextInput autoCapitalize="none" autoCorrect={false} secureTextEntry value={setupCode} onChangeText={setSetupCode} style={styles.input} placeholder="Code from your server setup" placeholderTextColor="#9AA6B8" /> : <><TextInput accessibilityLabel="16-digit setup code" accessibilityHint="Enter the 16 digits from your server setup. Each code expires after it is used." value={setupCode} onChangeText={handleSetupCodeChange} style={styles.input} placeholder="1234 5678 9012 3456" placeholderTextColor="#9AA6B8" keyboardType="number-pad" autoCapitalize="none" autoCorrect={false} autoComplete="one-time-code" textContentType="oneTimeCode" returnKeyType="done" maxLength={SETUP_CODE_INPUT_MAX_LENGTH} /><Text style={styles.help}>Enter the 16 digits from your server setup. Each code can be used once and expires after use.</Text></>}<Pressable disabled={!canCreate} style={[styles.primary, !canCreate && styles.disabled]} onPress={() => void create()}>{saving ? <ActivityIndicator color="#FFF" /> : <><Text style={styles.primaryText}>Create private circle</Text><Ionicons name="arrow-forward" size={18} color="#FFF" /></>}</Pressable><Pressable style={styles.secondary} onPress={() => router.push('/join')}><Ionicons name="qr-code-outline" size={20} color={coral} /><Text style={styles.secondaryText}>I have an invitation QR</Text></Pressable><Text style={styles.footnote}>The device that creates the circle becomes its owner. It can make one-time QR invitations for other phones.</Text></ScrollView></KeyboardAvoidingView></SafeAreaView>;
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#F6F8FB' },
  content: { padding: 22, paddingBottom: 44 },
  back: { width: 40, height: 40, borderRadius: 13, backgroundColor: '#FFF', alignItems: 'center', justifyContent: 'center', marginBottom: 28 },
  icon: { width: 68, height: 68, borderRadius: 23, backgroundColor: '#FFF0EE', alignItems: 'center', justifyContent: 'center', marginBottom: 18 },
  title: { color: ink, fontWeight: '800', fontSize: 29, letterSpacing: -0.8 },
  body: { color: muted, fontSize: 13, lineHeight: 20, marginTop: 10 },
  notice: { flexDirection: 'row', gap: 10, backgroundColor: '#E7F8F3', borderRadius: 16, padding: 14, marginTop: 21, marginBottom: 26 },
  noticeText: { flex: 1, color: '#357469', fontSize: 11, lineHeight: 16 },
  label: { color: '#9AA6B8', fontSize: 10, letterSpacing: 1.1, fontWeight: '800', marginBottom: 8, marginTop: 14 },
  input: { height: 53, borderRadius: 14, borderWidth: 1, borderColor: '#E6EAF0', backgroundColor: '#FFF', color: ink, paddingHorizontal: 14, fontSize: 14 },
  help: { color: '#9AA6B8', fontSize: 11, lineHeight: 16, marginTop: 8 },
  primary: { height: 53, borderRadius: 15, backgroundColor: coral, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 9, marginTop: 27 },
  primaryText: { color: '#FFF', fontWeight: '800', fontSize: 14 },
  disabled: { opacity: 0.65 },
  secondary: { height: 52, borderRadius: 15, backgroundColor: '#FFF0EE', alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 8, marginTop: 11 },
  secondaryText: { color: coral, fontWeight: '800', fontSize: 13 },
  footnote: { color: '#9AA6B8', fontSize: 11, lineHeight: 17, textAlign: 'center', marginTop: 19, paddingHorizontal: 12 },
});
