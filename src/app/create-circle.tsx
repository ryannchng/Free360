import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Alert, KeyboardAvoidingView, Platform, Pressable, SafeAreaView, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { createCircle } from '../lib/circle';
import { isBackendConfigured, isSelfHosted } from '../lib/backend';

const ink = '#16233B';
const muted = '#718099';
const coral = '#FF6E61';

export default function CreateCircleRoute() {
  const router = useRouter();
  const [circleName, setCircleName] = useState('My Circle');
  const [setupCode, setSetupCode] = useState('');
  const [saving, setSaving] = useState(false);

  const create = async () => {
    setSaving(true);
    try {
      await createCircle(circleName, setupCode);
      router.replace('/map');
    } catch (error) {
      Alert.alert('Could not create the circle', error instanceof Error ? error.message : 'Check your group server setup and try again.');
    } finally {
      setSaving(false);
    }
  };

  return <SafeAreaView style={styles.root}><KeyboardAvoidingView style={styles.root} behavior={Platform.OS === 'ios' ? 'padding' : undefined}><ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled"><Pressable style={styles.back} onPress={() => router.back()}><Ionicons name="arrow-back" size={20} color={ink} /></Pressable><View style={styles.icon}><Ionicons name="server-outline" size={31} color={coral} /></View><Text style={styles.title}>Create your circle</Text><Text style={styles.body}>This Free360 build connects to one group’s server. Your location and check-ins are encrypted on your device before they are stored there.</Text><View style={styles.notice}><Ionicons name="shield-checkmark-outline" size={19} color="#27B89A" /><Text style={styles.noticeText}>{isBackendConfigured() ? `Your ${isSelfHosted() ? 'self-hosted' : 'Supabase'} group server is configured. One circle can be created here.` : 'This build needs a group server. Follow the setup instructions in README.md before creating a circle.'}</Text></View><Text style={styles.label}>CIRCLE NAME</Text><TextInput value={circleName} onChangeText={setCircleName} style={styles.input} placeholder="My Circle" placeholderTextColor="#9AA6B8" maxLength={40} /><Text style={styles.label}>GROUP SETUP CODE</Text><TextInput autoCapitalize="none" autoCorrect={false} secureTextEntry value={setupCode} onChangeText={setSetupCode} style={styles.input} placeholder="Code from your server setup" placeholderTextColor="#9AA6B8" /><Pressable disabled={saving || !setupCode.trim() || !isBackendConfigured()} style={[styles.primary, (saving || !setupCode.trim() || !isBackendConfigured()) && styles.disabled]} onPress={() => void create()}>{saving ? <ActivityIndicator color="#FFF" /> : <><Text style={styles.primaryText}>Create private circle</Text><Ionicons name="arrow-forward" size={18} color="#FFF" /></>}</Pressable><Pressable style={styles.secondary} onPress={() => router.push('/join')}><Ionicons name="qr-code-outline" size={20} color={coral} /><Text style={styles.secondaryText}>I have an invitation QR</Text></Pressable><Text style={styles.footnote}>The device that creates the circle becomes its owner. It can make one-time QR invitations for other phones.</Text></ScrollView></KeyboardAvoidingView></SafeAreaView>;
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
  primary: { height: 53, borderRadius: 15, backgroundColor: coral, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 9, marginTop: 27 },
  primaryText: { color: '#FFF', fontWeight: '800', fontSize: 14 },
  disabled: { opacity: 0.65 },
  secondary: { height: 52, borderRadius: 15, backgroundColor: '#FFF0EE', alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 8, marginTop: 11 },
  secondaryText: { color: coral, fontWeight: '800', fontSize: 13 },
  footnote: { color: '#9AA6B8', fontSize: 11, lineHeight: 17, textAlign: 'center', marginTop: 19, paddingHorizontal: 12 },
});
