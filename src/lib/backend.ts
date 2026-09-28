import { getProjectUrl, isSupabaseConfigured } from './supabase';

const backend = process.env.EXPO_PUBLIC_BACKEND || 'supabase';
const selfHostedUrl = process.env.EXPO_PUBLIC_SELF_HOSTED_URL?.replace(/\/$/, '');

export function isSelfHosted() {
  return backend === 'self-hosted';
}

export function isBackendConfigured() {
  if (isSelfHosted()) return Boolean(selfHostedUrl && /^https:\/\//.test(selfHostedUrl) && !selfHostedUrl.includes('group.example.com'));
  return backend === 'supabase' && isSupabaseConfigured();
}

export function getBackendUrl() {
  if (isSelfHosted()) {
    if (!isBackendConfigured()) throw new Error('This build needs EXPO_PUBLIC_SELF_HOSTED_URL set to your group server HTTPS URL.');
    return selfHostedUrl!;
  }
  if (backend !== 'supabase') throw new Error(`Unsupported Free360 backend: ${backend}`);
  return getProjectUrl();
}
