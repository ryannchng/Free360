import 'react-native-url-polyfill/auto';
import 'expo-sqlite/localStorage/install';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { AppState, Platform } from 'react-native';

const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
const key = process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

let client: SupabaseClient | null = null;
let signIn: Promise<string> | null = null;

export function isSupabaseConfigured() {
  return Boolean(url && key && /^https:\/\//.test(url) && !url.includes('your-project-ref') && key !== 'your-publishable-key');
}

export function getSupabase() {
  if (!isSupabaseConfigured()) {
    throw new Error('This Free360 build needs EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY. See README.md.');
  }
  if (!client) {
    client = createClient(url!, key!, {
      auth: {
        storage: localStorage,
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: false,
      },
    });
    if (Platform.OS !== 'web') {
      const current = client;
      AppState.addEventListener('change', (state) => {
        if (state === 'active') current.auth.startAutoRefresh();
        else current.auth.stopAutoRefresh();
      });
      if (AppState.currentState !== 'active') current.auth.stopAutoRefresh();
    }
  }
  return client;
}

export function getProjectUrl() {
  getSupabase();
  return url!.replace(/\/$/, '');
}

export async function ensureDeviceSession() {
  if (signIn) return signIn;
  signIn = (async () => {
    const supabase = getSupabase();
    const { data, error } = await supabase.auth.getSession();
    if (error) throw error;
    if (data.session?.user.id) return data.session.user.id;
    const created = await supabase.auth.signInAnonymously();
    if (created.error) throw created.error;
    if (!created.data.user) throw new Error('Supabase did not create a device session.');
    return created.data.user.id;
  })();
  try {
    return await signIn;
  } finally {
    signIn = null;
  }
}
