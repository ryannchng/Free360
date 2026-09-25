import * as SecureStore from 'expo-secure-store';
import { getBackendUrl } from './backend';
import type { CircleConfig, EncryptedEnvelope } from './circle';

const SESSION_STORAGE_KEY = 'free360.self-hosted-session.v1';
type Session = { serverUrl: string; deviceId: string; token: string };
type EncryptedRow = { device_id: string; envelope: EncryptedEnvelope };
type Updates = { revision: number; snapshots: EncryptedRow[]; events: EncryptedRow[] };
let creatingSession: Promise<Session> | null = null;

async function request<T>(path: string, options: { method?: string; body?: unknown; token?: string } = {}): Promise<T> {
  const response = await fetch(`${getBackendUrl()}${path}`, {
    method: options.method ?? 'GET',
    headers: {
      'Content-Type': 'application/json',
      ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const data: unknown = await response.json();
  if (!response.ok) {
    const message = data && typeof data === 'object' && 'error' in data && typeof data.error === 'string' ? data.error : `Server returned ${response.status}.`;
    throw new Error(message);
  }
  return data as T;
}

async function getSession(): Promise<Session> {
  const raw = await SecureStore.getItemAsync(SESSION_STORAGE_KEY);
  if (raw) {
    try {
      const saved: Session = JSON.parse(raw);
      if (saved.serverUrl === getBackendUrl() && saved.deviceId && saved.token) return saved;
    } catch { /* Create a fresh device session below. */ }
  }
  if (!creatingSession) {
    creatingSession = (async () => {
      const created = await request<{ deviceId: string; token: string }>('/v1/sessions', { method: 'POST' });
      const session = { serverUrl: getBackendUrl(), ...created };
      await SecureStore.setItemAsync(SESSION_STORAGE_KEY, JSON.stringify(session));
      return session;
    })();
  }
  try { return await creatingSession; }
  finally { creatingSession = null; }
}

async function authed<T>(path: string, method?: string, body?: unknown) {
  const session = await getSession();
  return request<T>(path, { method, body, token: session.token });
}

export async function ensureSelfHostedSession() {
  return (await getSession()).deviceId;
}

export async function createSelfHostedCircle(circleId: string, setupCode: string) {
  await authed('/v1/circle', 'POST', { circleId, setupCode });
}

export async function createSelfHostedInvite(inviteId: string, secret: string) {
  const result = await authed<{ expiresAt: string }>('/v1/invites', 'POST', { inviteId, secret });
  return result.expiresAt;
}

export async function claimSelfHostedInvite(inviteId: string, secret: string, circleId: string) {
  const result = await authed<{ circleId: string }>('/v1/invites/claim', 'POST', { inviteId, secret, circleId });
  return result.circleId;
}

export async function isSelfHostedMember(circleId: string) {
  const result = await authed<{ member: boolean }>(`/v1/member?circleId=${encodeURIComponent(circleId)}`);
  return result.member;
}

export async function publishSelfHostedEnvelope(envelope: EncryptedEnvelope, type: 'snapshot' | 'event') {
  await authed(type === 'snapshot' ? '/v1/snapshot' : '/v1/events', type === 'snapshot' ? 'PUT' : 'POST', { envelope });
}

export function subscribeSelfHosted(config: CircleConfig, onRows: (rows: EncryptedRow[]) => void, onConnectionChange: (connected: boolean) => void, onConnected: () => void) {
  let closed = false;
  let connected = false;
  let cursor = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const poll = async () => {
    try {
      const updates = await authed<Updates>(`/v1/updates?circleId=${encodeURIComponent(config.circleId)}&after=${cursor}`);
      if (closed) return;
      onRows([...updates.snapshots, ...updates.events]);
      cursor = updates.revision;
      onConnectionChange(true);
      if (!connected) onConnected();
      connected = true;
    } catch (error) {
      console.warn('[Free360] Could not load self-hosted updates:', error);
      if (!closed) { connected = false; onConnectionChange(false); }
    } finally {
      if (!closed) timer = setTimeout(() => void poll(), 5000);
    }
  };
  void poll();
  return { close: () => { closed = true; if (timer) clearTimeout(timer); onConnectionChange(false); } };
}
