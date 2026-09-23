import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';
import { fromByteArray, toByteArray } from 'base64-js';
import nacl from 'tweetnacl';
import { ensureDeviceSession, getProjectUrl, getSupabase } from './supabase';

const CIRCLE_STORAGE_KEY = 'free360.circle.v2';
const PENDING_SNAPSHOT_KEY = 'free360.pending-snapshot.v2';
const PROTOCOL_VERSION = 2;
const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

export type CircleConfig = {
  version: 2;
  circleId: string;
  deviceId: string;
  encryptionKey: string;
  projectUrl: string;
  circleName: string;
  isOwner: boolean;
  pending?: boolean;
};

export type InvitePayload = {
  version: 2;
  projectUrl: string;
  circleId: string;
  inviteId: string;
  inviteSecret: string;
  encryptionKey: string;
  circleName: string;
};

export type EncryptedEnvelope = {
  version: 1;
  nonce: string;
  ciphertext: string;
};

export type SharedLocation = { type: 'location'; latitude: number; longitude: number; accuracy: number | null; recordedAt: string };
export type SharingPaused = { type: 'paused'; recordedAt: string };
export type CheckIn = { type: 'checkin'; id: string; message: string; recordedAt: string };
export type CircleSnapshot = SharedLocation | SharingPaused;
export type CirclePayload = CircleSnapshot | CheckIn;
export type CircleSubscription = { close: () => void };
export type CircleUpdate =
  | { kind: 'snapshot'; deviceId: string; payload: CircleSnapshot }
  | { kind: 'checkin'; deviceId: string; payload: CheckIn };

function randomBytes(length: number) {
  return Crypto.getRandomValues(new Uint8Array(length));
}

function randomSecret() {
  return fromByteArray(randomBytes(nacl.secretbox.keyLength));
}

function randomId() {
  return Crypto.randomUUID();
}

function getKey(key: string) {
  const bytes = toByteArray(key);
  if (bytes.length !== nacl.secretbox.keyLength) throw new Error('Invalid circle encryption key.');
  return bytes;
}

function toUrlSafeBase64(value: string) {
  return fromByteArray(textEncoder.encode(value)).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/g, '');
}

function fromUrlSafeBase64(value: string) {
  return textDecoder.decode(toByteArray(value.replaceAll('-', '+').replaceAll('_', '/') + '='.repeat((4 - value.length % 4) % 4)));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function requireString(value: unknown, label: string) {
  if (typeof value !== 'string' || !value) throw new Error(`Invitation is missing ${label}.`);
  return value;
}

function requireProject(projectUrl: string) {
  if (projectUrl !== getProjectUrl()) throw new Error('This invitation belongs to another Free360 Supabase project. Install the app build configured for that group.');
}

export function encryptCirclePayload(payload: CirclePayload, encryptionKey: string): EncryptedEnvelope {
  const nonce = randomBytes(nacl.secretbox.nonceLength);
  const ciphertext = nacl.secretbox(textEncoder.encode(JSON.stringify(payload)), nonce, getKey(encryptionKey));
  return { version: 1, nonce: fromByteArray(nonce), ciphertext: fromByteArray(ciphertext) };
}

export function decryptCirclePayload(envelope: EncryptedEnvelope, encryptionKey: string): CirclePayload | null {
  try {
    if (envelope.version !== 1) return null;
    const opened = nacl.secretbox.open(toByteArray(envelope.ciphertext), toByteArray(envelope.nonce), getKey(encryptionKey));
    if (!opened) return null;
    const parsed: unknown = JSON.parse(textDecoder.decode(opened));
    if (!isRecord(parsed) || typeof parsed.recordedAt !== 'string' || !Number.isFinite(Date.parse(parsed.recordedAt))) return null;
    if (parsed.type === 'paused') return { type: 'paused', recordedAt: parsed.recordedAt };
    if (parsed.type === 'checkin' && typeof parsed.id === 'string' && typeof parsed.message === 'string' && parsed.message.length <= 500) {
      return { type: 'checkin', id: parsed.id, message: parsed.message, recordedAt: parsed.recordedAt };
    }
    if (parsed.type !== 'location' || typeof parsed.latitude !== 'number' || !Number.isFinite(parsed.latitude) || Math.abs(parsed.latitude) > 90 || typeof parsed.longitude !== 'number' || !Number.isFinite(parsed.longitude) || Math.abs(parsed.longitude) > 180) return null;
    return { type: 'location', latitude: parsed.latitude, longitude: parsed.longitude, accuracy: typeof parsed.accuracy === 'number' ? parsed.accuracy : null, recordedAt: parsed.recordedAt };
  } catch {
    return null;
  }
}

export function encodeInvite(payload: InvitePayload) {
  return `free360://invite/${toUrlSafeBase64(JSON.stringify(payload))}`;
}

export function decodeInvite(value: string): InvitePayload {
  const match = value.trim().match(/^free360:\/\/invite\/([A-Za-z0-9_-]+)$/);
  if (!match) throw new Error('This is not a Free360 invitation QR code.');
  let parsed: unknown;
  try { parsed = JSON.parse(fromUrlSafeBase64(match[1])); }
  catch { throw new Error('This invitation QR code is damaged.'); }
  if (!isRecord(parsed) || parsed.version !== PROTOCOL_VERSION) throw new Error('This invitation uses an unsupported Free360 version.');
  const invite: InvitePayload = {
    version: 2,
    projectUrl: requireString(parsed.projectUrl, 'project URL'),
    circleId: requireString(parsed.circleId, 'circle ID'),
    inviteId: requireString(parsed.inviteId, 'invite ID'),
    inviteSecret: requireString(parsed.inviteSecret, 'invite secret'),
    encryptionKey: requireString(parsed.encryptionKey, 'encryption key'),
    circleName: requireString(parsed.circleName, 'circle name'),
  };
  getKey(invite.encryptionKey);
  requireProject(invite.projectUrl);
  return invite;
}

export async function createCircle(circleName: string, setupCode: string): Promise<CircleConfig> {
  const deviceId = await ensureDeviceSession();
  const circleId = randomId();
  const config: CircleConfig = {
    version: 2, circleId, deviceId, encryptionKey: randomSecret(), projectUrl: getProjectUrl(),
    circleName: circleName.trim() || 'My Circle', isOwner: true,
  };
  await saveCircle({ ...config, pending: true });
  const { error } = await getSupabase().rpc('free360_create_circle', { p_circle_id: circleId, p_setup_code: setupCode.trim() });
  if (error) {
    if (await recoverPendingCircle(config)) return config;
    throw error;
  }
  await saveCircle(config);
  return config;
}

export async function createInvite(config: CircleConfig) {
  await ensureMatchingSession(config);
  const inviteId = randomId();
  const inviteSecret = fromByteArray(randomBytes(32));
  const { data, error } = await getSupabase().rpc('free360_create_invite', { p_invite_id: inviteId, p_secret: inviteSecret });
  if (error) throw error;
  const payload: InvitePayload = {
    version: 2, projectUrl: config.projectUrl, circleId: config.circleId, inviteId, inviteSecret,
    encryptionKey: config.encryptionKey, circleName: config.circleName,
  };
  return { qrValue: encodeInvite(payload), expiresAt: String(data) };
}

export async function joinCircle(qrValue: string): Promise<CircleConfig> {
  const invite = decodeInvite(qrValue);
  const deviceId = await ensureDeviceSession();
  const config: CircleConfig = {
    version: 2, circleId: invite.circleId, deviceId, encryptionKey: invite.encryptionKey,
    projectUrl: invite.projectUrl, circleName: invite.circleName, isOwner: false,
  };
  await saveCircle({ ...config, pending: true });
  const { data, error } = await getSupabase().rpc('free360_claim_invite', { p_invite_id: invite.inviteId, p_secret: invite.inviteSecret, p_circle_id: invite.circleId });
  if (error) {
    if (await recoverPendingCircle(config)) return config;
    throw error;
  }
  if (data !== invite.circleId) throw new Error('This invitation does not match the circle.');
  await saveCircle(config);
  return config;
}

async function recoverPendingCircle(config: CircleConfig) {
  try {
    await ensureMatchingSession(config);
    const { data, error } = await getSupabase().rpc('free360_is_member', { p_circle_id: config.circleId });
    if (error || data !== true) return false;
    await saveCircle({ ...config, pending: false });
    return true;
  } catch {
    return false;
  }
}

async function ensureMatchingSession(config: CircleConfig) {
  requireProject(config.projectUrl);
  const deviceId = await ensureDeviceSession();
  if (deviceId !== config.deviceId) throw new Error('This device session changed. Restore its original app data or ask the circle owner for a new invitation.');
}

type PendingSnapshot = { circleId: string; deviceId: string; id: string; envelope: EncryptedEnvelope };
let snapshotQueue: Promise<void> = Promise.resolve();

function serializeSnapshot<T>(operation: () => Promise<T>): Promise<T> {
  const result = snapshotQueue.then(operation, operation);
  snapshotQueue = result.then(() => undefined, () => undefined);
  return result;
}

async function sendEnvelope(config: CircleConfig, envelope: EncryptedEnvelope, type: 'snapshot' | 'event') {
  await ensureMatchingSession(config);
  const { error } = await getSupabase().rpc(type === 'snapshot' ? 'free360_publish_snapshot' : 'free360_publish_event', { p_envelope: envelope });
  if (error) throw error;
}

async function flushPendingSnapshotInner(config: CircleConfig) {
  const raw = await SecureStore.getItemAsync(PENDING_SNAPSHOT_KEY);
  if (!raw) return;
  const pending: PendingSnapshot = JSON.parse(raw);
  if (pending.circleId !== config.circleId || pending.deviceId !== config.deviceId) {
    await SecureStore.deleteItemAsync(PENDING_SNAPSHOT_KEY);
    return;
  }
  await sendEnvelope(config, pending.envelope, 'snapshot');
  const current = await SecureStore.getItemAsync(PENDING_SNAPSHOT_KEY);
  if (current && (JSON.parse(current) as PendingSnapshot).id === pending.id) await SecureStore.deleteItemAsync(PENDING_SNAPSHOT_KEY);
}

export function flushPendingSnapshot(config: CircleConfig) {
  return serializeSnapshot(() => flushPendingSnapshotInner(config));
}

export function publishSnapshot(config: CircleConfig, payload: CircleSnapshot) {
  return serializeSnapshot(async () => {
    const pending: PendingSnapshot = { circleId: config.circleId, deviceId: config.deviceId, id: randomId(), envelope: encryptCirclePayload(payload, config.encryptionKey) };
    await SecureStore.setItemAsync(PENDING_SNAPSHOT_KEY, JSON.stringify(pending));
    await flushPendingSnapshotInner(config);
  });
}

export function publishLocation(config: CircleConfig, location: Omit<SharedLocation, 'type' | 'recordedAt'>, recordedAt = new Date().toISOString()) {
  return publishSnapshot(config, { type: 'location', ...location, recordedAt });
}

export function publishPaused(config: CircleConfig) {
  return publishSnapshot(config, { type: 'paused', recordedAt: new Date().toISOString() });
}

export async function publishCheckIn(config: CircleConfig, message: string): Promise<CheckIn> {
  const payload: CheckIn = { type: 'checkin', id: randomId(), message: message.trim().slice(0, 500), recordedAt: new Date().toISOString() };
  await sendEnvelope(config, encryptCirclePayload(payload, config.encryptionKey), 'event');
  return payload;
}

function receiveEncryptedUpdate(row: Record<string, unknown>, encryptionKey: string, onUpdate: (update: CircleUpdate) => void) {
  if (typeof row.device_id !== 'string' || !isRecord(row.envelope)) return;
  const envelope = row.envelope;
  if (envelope.version !== 1 || typeof envelope.nonce !== 'string' || typeof envelope.ciphertext !== 'string') return;
  const payload = decryptCirclePayload({ version: 1, nonce: envelope.nonce, ciphertext: envelope.ciphertext }, encryptionKey);
  if (payload?.type === 'checkin') onUpdate({ kind: 'checkin', deviceId: row.device_id, payload });
  else if (payload) onUpdate({ kind: 'snapshot', deviceId: row.device_id, payload });
}

export function subscribeToCircle(config: CircleConfig, onUpdate: (update: CircleUpdate) => void, onConnectionChange: (connected: boolean) => void): CircleSubscription {
  let closed = false;
  let channel: ReturnType<ReturnType<typeof getSupabase>['channel']> | null = null;
  const start = async () => {
    try {
      await ensureMatchingSession(config);
      if (closed) return;
      const supabase = getSupabase();
      channel = supabase.channel(`free360:${config.circleId}`)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'free360_snapshots', filter: `circle_id=eq.${config.circleId}` }, ({ new: row }) => {
          if (isRecord(row)) receiveEncryptedUpdate(row, config.encryptionKey, onUpdate);
        })
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'free360_events', filter: `circle_id=eq.${config.circleId}` }, ({ new: row }) => {
          if (isRecord(row)) receiveEncryptedUpdate(row, config.encryptionKey, onUpdate);
        })
        .subscribe((status) => {
          if (closed) return;
          if (status !== 'SUBSCRIBED') { onConnectionChange(false); return; }
          void (async () => {
            const [snapshots, events] = await Promise.all([
              supabase.from('free360_snapshots').select('device_id,envelope').eq('circle_id', config.circleId),
              supabase.from('free360_events').select('device_id,envelope').eq('circle_id', config.circleId).order('received_at', { ascending: false }).limit(100),
            ]);
            if (snapshots.error) throw snapshots.error;
            if (events.error) throw events.error;
            if (closed) return;
            for (const row of snapshots.data ?? []) receiveEncryptedUpdate(row, config.encryptionKey, onUpdate);
            for (const row of events.data ?? []) receiveEncryptedUpdate(row, config.encryptionKey, onUpdate);
            onConnectionChange(true);
            void flushPendingSnapshot(config).catch((error) => console.warn('[Free360] Queued snapshot waiting for Supabase:', error));
          })().catch((error) => { console.warn('[Free360] Could not load circle updates:', error); onConnectionChange(false); });
        });
    } catch (error) {
      console.warn('[Free360] Could not subscribe to circle:', error);
      if (!closed) onConnectionChange(false);
    }
  };
  void start();
  return { close: () => { closed = true; if (channel) void getSupabase().removeChannel(channel); onConnectionChange(false); } };
}

export async function loadCircle() {
  const raw = await SecureStore.getItemAsync(CIRCLE_STORAGE_KEY);
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed) || parsed.version !== PROTOCOL_VERSION) return null;
    const config: CircleConfig = {
      version: 2,
      circleId: requireString(parsed.circleId, 'circle ID'),
      deviceId: requireString(parsed.deviceId, 'device ID'),
      encryptionKey: requireString(parsed.encryptionKey, 'encryption key'),
      projectUrl: requireString(parsed.projectUrl, 'project URL'),
      circleName: requireString(parsed.circleName, 'circle name'),
      isOwner: Boolean(parsed.isOwner),
      pending: Boolean(parsed.pending),
    };
    getKey(config.encryptionKey);
    requireProject(config.projectUrl);
    if (config.pending) {
      if (!await recoverPendingCircle(config)) return null;
      return { ...config, pending: false };
    }
    return config;
  } catch { return null; }
}

export function saveCircle(config: CircleConfig) {
  return SecureStore.setItemAsync(CIRCLE_STORAGE_KEY, JSON.stringify(config));
}

export function clearCircle() {
  return SecureStore.deleteItemAsync(CIRCLE_STORAGE_KEY);
}
