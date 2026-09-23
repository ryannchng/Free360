import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';
import { fromByteArray, toByteArray } from 'base64-js';
import nacl from 'tweetnacl';

const CIRCLE_STORAGE_KEY = 'free360.circle.v1';
const PENDING_SNAPSHOT_KEY = 'free360.pending-snapshot.v1';
const PROTOCOL_VERSION = 1;
const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

export type CircleConfig = {
  version: 1;
  circleId: string;
  deviceId: string;
  deviceToken: string;
  encryptionKey: string;
  relayUrl: string;
  circleName: string;
  isOwner: boolean;
};

export type InvitePayload = {
  version: 1;
  relayUrl: string;
  circleId: string;
  inviteId: string;
  encryptionKey: string;
  circleName: string;
};

export type RelayEnvelope = {
  version: 1;
  nonce: string;
  ciphertext: string;
};

export type SharedLocation = {
  type: 'location';
  latitude: number;
  longitude: number;
  accuracy: number | null;
  recordedAt: string;
};

export type SharingPaused = { type: 'paused'; recordedAt: string };
export type CheckIn = { type: 'checkin'; id: string; message: string; recordedAt: string };
export type CircleSnapshot = SharedLocation | SharingPaused;
export type CirclePayload = CircleSnapshot | CheckIn;

export type RelaySubscription = {
  close: () => void;
};

export type CircleUpdate =
  | { kind: 'snapshot'; deviceId: string; payload: CircleSnapshot }
  | { kind: 'checkin'; deviceId: string; payload: CheckIn };

type RelayResponse = {
  type: string;
  requestId?: string;
  code?: string;
  message?: string;
  [key: string]: unknown;
};

function randomBytes(length: number) {
  return Crypto.getRandomValues(new Uint8Array(length));
}

function randomSecret() {
  return fromByteArray(randomBytes(nacl.secretbox.keyLength));
}

function randomId() {
  return Crypto.randomUUID().replaceAll('-', '_');
}

function getKey(key: string) {
  const keyBytes = toByteArray(key);
  if (keyBytes.length !== nacl.secretbox.keyLength) throw new Error('Invalid circle encryption key.');
  return keyBytes;
}

function toUrlSafeBase64(value: string) {
  return fromByteArray(textEncoder.encode(value)).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/g, '');
}

function fromUrlSafeBase64(value: string) {
  const padded = value.replaceAll('-', '+').replaceAll('_', '/') + '='.repeat((4 - (value.length % 4)) % 4);
  return textDecoder.decode(toByteArray(padded));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function requireString(value: unknown, name: string) {
  if (typeof value !== 'string' || !value) throw new Error(`Invite is missing ${name}.`);
  return value;
}

export function normalizeRelayUrl(value: string) {
  const trimmed = value.trim().replace(/\/+$/, '');
  if (!trimmed) throw new Error('Enter your relay URL first.');
  const withProtocol = /^[a-z]+:\/\//i.test(trimmed) ? trimmed : `wss://${trimmed}`;
  const url = new URL(withProtocol);
  if (!['ws:', 'wss:', 'http:', 'https:'].includes(url.protocol)) throw new Error('Use a ws://, wss://, http://, or https:// relay URL.');
  url.pathname = url.pathname === '/' ? '/ws' : url.pathname;
  if (!url.pathname.endsWith('/ws')) throw new Error('Relay URL must end in /ws.');
  if (url.protocol === 'http:') url.protocol = 'ws:';
  if (url.protocol === 'https:') url.protocol = 'wss:';
  return url.toString().replace(/\/$/, '');
}

export function encryptCirclePayload(payload: CirclePayload, encryptionKey: string): RelayEnvelope {
  const nonce = randomBytes(nacl.secretbox.nonceLength);
  const plaintext = textEncoder.encode(JSON.stringify(payload));
  const ciphertext = nacl.secretbox(plaintext, nonce, getKey(encryptionKey));
  return { version: PROTOCOL_VERSION, nonce: fromByteArray(nonce), ciphertext: fromByteArray(ciphertext) };
}

export function decryptCirclePayload(envelope: RelayEnvelope, encryptionKey: string): CirclePayload | null {
  try {
    if (envelope.version !== PROTOCOL_VERSION) return null;
    const decrypted = nacl.secretbox.open(toByteArray(envelope.ciphertext), toByteArray(envelope.nonce), getKey(encryptionKey));
    if (!decrypted) return null;
    const parsed: unknown = JSON.parse(textDecoder.decode(decrypted));
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
  try {
    parsed = JSON.parse(fromUrlSafeBase64(match[1]));
  } catch {
    throw new Error('This invitation QR code is damaged.');
  }
  if (!isRecord(parsed) || parsed.version !== PROTOCOL_VERSION) throw new Error('This invitation uses an unsupported Free360 version.');
  const invitation: InvitePayload = {
    version: PROTOCOL_VERSION,
    relayUrl: normalizeRelayUrl(requireString(parsed.relayUrl, 'relay URL')),
    circleId: requireString(parsed.circleId, 'circle ID'),
    inviteId: requireString(parsed.inviteId, 'invite ID'),
    encryptionKey: requireString(parsed.encryptionKey, 'encryption key'),
    circleName: requireString(parsed.circleName, 'circle name'),
  };
  getKey(invitation.encryptionKey);
  return invitation;
}

class RelaySocket {
  private readonly socket: WebSocket;
  private readonly pending = new Map<string, { resolve: (message: RelayResponse) => void; reject: (reason: Error) => void; timeout: ReturnType<typeof setTimeout> }>();
  private readonly listeners = new Set<(message: RelayResponse) => void>();
  private readonly closeListeners = new Set<() => void>();
  private requestNumber = 0;

  private constructor(socket: WebSocket) {
    this.socket = socket;
    socket.onmessage = (event) => {
      let message: RelayResponse;
      try {
        message = JSON.parse(String(event.data));
      } catch {
        return;
      }
      if (!message.requestId) {
        for (const listener of this.listeners) listener(message);
        return;
      }
      const pending = this.pending.get(message.requestId);
      if (!pending) return;
      this.pending.delete(message.requestId);
      clearTimeout(pending.timeout);
      if (message.type === 'error') pending.reject(new Error(message.message ?? message.code ?? 'The relay rejected the request.'));
      else pending.resolve(message);
    };
    socket.onerror = () => this.rejectAll(new Error('Could not connect to the self-hosted relay.'));
    socket.onclose = () => {
      this.rejectAll(new Error('The relay connection closed unexpectedly.'));
      for (const listener of this.closeListeners) listener();
    };
  }

  static connect(relayUrl: string) {
    return new Promise<RelaySocket>((resolve, reject) => {
      let settled = false;
      const socket = new WebSocket(normalizeRelayUrl(relayUrl));
      const timeout = setTimeout(() => {
        if (!settled) {
          settled = true;
          socket.close();
          reject(new Error('Timed out connecting to the self-hosted relay.'));
        }
      }, 8_000);
      socket.onopen = () => {
        if (!settled) {
          settled = true;
          clearTimeout(timeout);
          resolve(new RelaySocket(socket));
        }
      };
      socket.onerror = () => {
        if (!settled) {
          settled = true;
          clearTimeout(timeout);
          reject(new Error('Could not connect to the self-hosted relay. Check its URL and TLS setup.'));
        }
      };
    });
  }

  request(type: string, payload: Record<string, unknown> = {}) {
    return new Promise<RelayResponse>((resolve, reject) => {
      if (this.socket.readyState !== WebSocket.OPEN) {
        reject(new Error('The relay is disconnected.'));
        return;
      }
      const requestId = `mobile_${++this.requestNumber}_${Date.now()}`;
      const timeout = setTimeout(() => {
        this.pending.delete(requestId);
        reject(new Error('The self-hosted relay did not respond in time.'));
      }, 8_000);
      this.pending.set(requestId, { resolve, reject, timeout });
      this.socket.send(JSON.stringify({ type, requestId, ...payload }));
    });
  }

  close() {
    this.socket.close(1000, 'Request complete');
  }

  subscribe(listener: (message: RelayResponse) => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  onClose(listener: () => void) {
    this.closeListeners.add(listener);
    return () => this.closeListeners.delete(listener);
  }

  private rejectAll(error: Error) {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timeout);
      pending.reject(error);
    }
    this.pending.clear();
  }
}

async function withRelay<T>(relayUrl: string, operation: (relay: RelaySocket) => Promise<T>) {
  const relay = await RelaySocket.connect(relayUrl);
  try {
    return await operation(relay);
  } finally {
    relay.close();
  }
}

function readToken(response: RelayResponse) {
  if (typeof response.deviceToken !== 'string') throw new Error('The relay returned an invalid device credential.');
  return response.deviceToken;
}

export async function createCircle(relayInput: string, circleName: string): Promise<CircleConfig> {
  const relayUrl = normalizeRelayUrl(relayInput);
  const circleId = randomId();
  const deviceId = randomId();
  const response = await withRelay(relayUrl, (relay) => relay.request('create_circle', { circleId, deviceId }));
  const config: CircleConfig = {
    version: PROTOCOL_VERSION,
    circleId,
    deviceId,
    deviceToken: readToken(response),
    encryptionKey: randomSecret(),
    relayUrl,
    circleName: circleName.trim() || 'My Circle',
    isOwner: true,
  };
  await saveCircle(config);
  return config;
}

export async function createInvite(config: CircleConfig, ttlSeconds = 900) {
  const response = await withRelay(config.relayUrl, async (relay) => {
    await relay.request('authenticate', { circleId: config.circleId, deviceId: config.deviceId, deviceToken: config.deviceToken });
    return relay.request('create_invite', { ttlSeconds });
  });
  if (typeof response.inviteId !== 'string' || typeof response.expiresAt !== 'string') throw new Error('The relay returned an invalid invitation.');
  const payload: InvitePayload = {
    version: PROTOCOL_VERSION,
    relayUrl: config.relayUrl,
    circleId: config.circleId,
    inviteId: response.inviteId,
    encryptionKey: config.encryptionKey,
    circleName: config.circleName,
  };
  return { qrValue: encodeInvite(payload), expiresAt: response.expiresAt };
}

export async function joinCircle(qrValue: string): Promise<CircleConfig> {
  const invite = decodeInvite(qrValue);
  const deviceId = randomId();
  const response = await withRelay(invite.relayUrl, (relay) => relay.request('claim_invite', { circleId: invite.circleId, inviteId: invite.inviteId, deviceId }));
  const config: CircleConfig = {
    version: PROTOCOL_VERSION,
    circleId: invite.circleId,
    deviceId,
    deviceToken: readToken(response),
    encryptionKey: invite.encryptionKey,
    relayUrl: invite.relayUrl,
    circleName: invite.circleName,
    isOwner: false,
  };
  await saveCircle(config);
  return config;
}

type PendingSnapshot = { circleId: string; deviceId: string; id: string; envelope: RelayEnvelope };
let snapshotQueue: Promise<void> = Promise.resolve();

function serializeSnapshot<T>(operation: () => Promise<T>): Promise<T> {
  const result = snapshotQueue.then(operation, operation);
  snapshotQueue = result.then(() => undefined, () => undefined);
  return result;
}

async function sendEnvelope(config: CircleConfig, envelope: RelayEnvelope, type: 'publish' | 'publish_event') {
  await withRelay(config.relayUrl, async (relay) => {
    await relay.request('authenticate', { circleId: config.circleId, deviceId: config.deviceId, deviceToken: config.deviceToken });
    await relay.request(type, { envelope });
  });
}

async function flushPendingSnapshotInner(config: CircleConfig) {
  const raw = await SecureStore.getItemAsync(PENDING_SNAPSHOT_KEY);
  if (!raw) return;
  const pending: PendingSnapshot = JSON.parse(raw);
  if (pending.circleId !== config.circleId || pending.deviceId !== config.deviceId) {
    await SecureStore.deleteItemAsync(PENDING_SNAPSHOT_KEY);
    return;
  }
  await sendEnvelope(config, pending.envelope, 'publish');
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
  await sendEnvelope(config, encryptCirclePayload(payload, config.encryptionKey), 'publish_event');
  return payload;
}

function receiveEncryptedUpdate(message: Record<string, unknown>, encryptionKey: string, onUpdate: (update: CircleUpdate) => void) {
  if (typeof message.senderDeviceId !== 'string' || !isRecord(message.envelope)) return;
  const envelope = message.envelope;
  if (envelope.version !== PROTOCOL_VERSION || typeof envelope.nonce !== 'string' || typeof envelope.ciphertext !== 'string') return;
  const payload = decryptCirclePayload({ version: PROTOCOL_VERSION, nonce: envelope.nonce, ciphertext: envelope.ciphertext }, encryptionKey);
  if (payload?.type === 'checkin') onUpdate({ kind: 'checkin', deviceId: message.senderDeviceId, payload });
  else if (payload) onUpdate({ kind: 'snapshot', deviceId: message.senderDeviceId, payload });
}

export function subscribeToCircle(config: CircleConfig, onUpdate: (update: CircleUpdate) => void, onConnectionChange: (connected: boolean) => void): RelaySubscription {
  let closed = false;
  let relay: RelaySocket | null = null;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  let retryDelay = 1000;
  const reconnect = () => {
    if (closed) return;
    onConnectionChange(false);
    retryTimer = setTimeout(() => { void connect(); }, retryDelay);
    retryDelay = Math.min(retryDelay * 2, 30000);
  };
  const connect = async () => {
    if (closed) return;
    let next: RelaySocket | null = null;
    try {
      next = await RelaySocket.connect(config.relayUrl);
      if (closed) { next.close(); return; }
      relay = next;
      next.subscribe((message) => {
        if (message.type === 'event' || message.type === 'activity_event') receiveEncryptedUpdate(message, config.encryptionKey, onUpdate);
        if (message.type === 'removed') onConnectionChange(false);
      });
      next.onClose(() => { if (relay === next) relay = null; reconnect(); });
      const response = await next.request('authenticate', { circleId: config.circleId, deviceId: config.deviceId, deviceToken: config.deviceToken });
      if (closed) { next.close(); return; }
      if (Array.isArray(response.snapshots)) for (const snapshot of response.snapshots) if (isRecord(snapshot)) receiveEncryptedUpdate(snapshot, config.encryptionKey, onUpdate);
      if (Array.isArray(response.events)) for (const event of response.events) if (isRecord(event)) receiveEncryptedUpdate(event, config.encryptionKey, onUpdate);
      onConnectionChange(true);
      retryDelay = 1000;
      void flushPendingSnapshot(config).catch((error) => console.warn('[Free360] Queued snapshot still waiting for relay:', error));
    } catch (error) {
      console.warn('[Free360] Relay subscription failed:', error);
      if (next) next.close();
      else reconnect();
    }
  };
  void connect();
  return { close: () => { closed = true; if (retryTimer) clearTimeout(retryTimer); relay?.close(); onConnectionChange(false); } };
}

export async function loadCircle() {
  const raw = await SecureStore.getItemAsync(CIRCLE_STORAGE_KEY);
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed) || parsed.version !== PROTOCOL_VERSION) return null;
    const config: CircleConfig = {
      version: PROTOCOL_VERSION,
      circleId: requireString(parsed.circleId, 'circle ID'),
      deviceId: requireString(parsed.deviceId, 'device ID'),
      deviceToken: requireString(parsed.deviceToken, 'device credential'),
      encryptionKey: requireString(parsed.encryptionKey, 'encryption key'),
      relayUrl: normalizeRelayUrl(requireString(parsed.relayUrl, 'relay URL')),
      circleName: requireString(parsed.circleName, 'circle name'),
      isOwner: Boolean(parsed.isOwner),
    };
    getKey(config.encryptionKey);
    return config;
  } catch {
    return null;
  }
}

export function saveCircle(config: CircleConfig) {
  return SecureStore.setItemAsync(CIRCLE_STORAGE_KEY, JSON.stringify(config));
}

export function clearCircle() {
  return SecureStore.deleteItemAsync(CIRCLE_STORAGE_KEY);
}
