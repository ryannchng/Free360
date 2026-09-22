import { createServer } from 'node:http';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { WebSocket, WebSocketServer } from 'ws';

const PORT = Number.parseInt(process.env.PORT ?? '8080', 10);
const HOST = process.env.HOST ?? '0.0.0.0';
const STATE_PATH = process.env.RELAY_DATA_PATH ?? '/data/relay-state.json';
const MAX_PAYLOAD_BYTES = 32 * 1024;
const MAX_DEVICES_PER_CIRCLE = 20;
const MAX_INVITE_TTL_SECONDS = 24 * 60 * 60;

/**
 * The relay deliberately stores only opaque E2EE envelopes. It never receives
 * a group encryption key or unencrypted location data.
 */
let state = { version: 1, circles: {} };
let persistence = Promise.resolve();
const connections = new Map();

const identifierPattern = /^[a-zA-Z0-9_-]{8,120}$/;
const tokenPattern = /^[a-zA-Z0-9_-]{20,200}$/;

function hash(value) {
  return createHash('sha256').update(value).digest('base64url');
}

function newToken() {
  return randomBytes(32).toString('base64url');
}

function safeEqual(a, b) {
  const first = Buffer.from(a);
  const second = Buffer.from(b);
  return first.length === second.length && timingSafeEqual(first, second);
}

function isValidId(value) {
  return typeof value === 'string' && identifierPattern.test(value);
}

function isValidToken(value) {
  return typeof value === 'string' && tokenPattern.test(value);
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function now() {
  return new Date().toISOString();
}

async function loadState() {
  try {
    const raw = await readFile(STATE_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    if (parsed?.version === 1 && isPlainObject(parsed.circles)) state = parsed;
  } catch (error) {
    if (error?.code !== 'ENOENT') console.warn('[relay] Could not read state:', error.message);
  }
}

function persistState() {
  const snapshot = JSON.stringify(state);
  persistence = persistence
    .catch(() => undefined)
    .then(async () => {
      await mkdir(dirname(STATE_PATH), { recursive: true });
      const temporaryPath = `${STATE_PATH}.tmp`;
      await writeFile(temporaryPath, snapshot, { mode: 0o600 });
      await rename(temporaryPath, STATE_PATH);
    })
    .catch((error) => console.error('[relay] Could not persist state:', error.message));
  return persistence;
}

function send(socket, message) {
  if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
}

function reply(socket, requestId, type, payload = {}) {
  send(socket, { type, requestId, ...payload });
}

function fail(socket, requestId, code, message) {
  reply(socket, requestId, 'error', { code, message });
}

function getCircle(circleId) {
  return state.circles[circleId];
}

function cleanExpiredInvites(circle) {
  const currentTime = Date.now();
  for (const [inviteId, invite] of Object.entries(circle.invites)) {
    if (Date.parse(invite.expiresAt) <= currentTime || invite.claimedAt) delete circle.invites[inviteId];
  }
}

function broadcast(circleId, message, exceptSocket) {
  for (const [socket, session] of connections.entries()) {
    if (socket !== exceptSocket && session.circleId === circleId) send(socket, message);
  }
}

function sessionFor(socket) {
  return connections.get(socket);
}

function assertAuthenticated(socket, message) {
  const session = sessionFor(socket);
  if (!session?.circleId || !session?.deviceId) {
    fail(socket, message.requestId, 'not_authenticated', 'Authenticate with a circle before sending this message.');
    return null;
  }
  return session;
}

async function createCircle(socket, message) {
  const { requestId, circleId, deviceId } = message;
  if (!isValidId(circleId) || !isValidId(deviceId)) {
    fail(socket, requestId, 'invalid_request', 'circleId and deviceId must be URL-safe identifiers.');
    return;
  }
  if (getCircle(circleId)) {
    fail(socket, requestId, 'circle_exists', 'That circle already exists on this relay.');
    return;
  }

  const deviceToken = newToken();
  state.circles[circleId] = {
    createdAt: now(),
    ownerDeviceId: deviceId,
    devices: {
      [deviceId]: { tokenHash: hash(deviceToken), joinedAt: now() },
    },
    invites: {},
    snapshots: {},
  };
  connections.set(socket, { circleId, deviceId, isOwner: true });
  await persistState();
  reply(socket, requestId, 'circle_created', { circleId, deviceToken });
}

async function authenticate(socket, message) {
  const { requestId, circleId, deviceId, deviceToken } = message;
  const circle = getCircle(circleId);
  const device = circle?.devices?.[deviceId];
  if (!circle || !device || !isValidToken(deviceToken) || !safeEqual(device.tokenHash, hash(deviceToken))) {
    fail(socket, requestId, 'invalid_credentials', 'The saved device credential is not valid for this relay.');
    return;
  }

  connections.set(socket, { circleId, deviceId, isOwner: circle.ownerDeviceId === deviceId });
  reply(socket, requestId, 'authenticated', {
    circleId,
    isOwner: circle.ownerDeviceId === deviceId,
    snapshots: Object.entries(circle.snapshots).map(([senderDeviceId, snapshot]) => ({ senderDeviceId, ...snapshot })),
  });
}

async function createInvite(socket, message) {
  const session = assertAuthenticated(socket, message);
  if (!session) return;
  const circle = getCircle(session.circleId);
  if (!session.isOwner) {
    fail(socket, message.requestId, 'not_owner', 'Only the circle owner can create invitations.');
    return;
  }

  const suppliedTtl = Number(message.ttlSeconds ?? 900);
  const ttlSeconds = Number.isFinite(suppliedTtl)
    ? Math.max(60, Math.min(Math.floor(suppliedTtl), MAX_INVITE_TTL_SECONDS))
    : 900;
  const inviteId = newToken();
  const expiresAt = new Date(Date.now() + ttlSeconds * 1000).toISOString();
  cleanExpiredInvites(circle);
  circle.invites[inviteId] = { expiresAt, createdAt: now() };
  await persistState();
  reply(socket, message.requestId, 'invite_created', { inviteId, expiresAt });
}

async function claimInvite(socket, message) {
  const { requestId, circleId, inviteId, deviceId } = message;
  const circle = getCircle(circleId);
  const invite = circle?.invites?.[inviteId];
  if (!circle || !isValidId(deviceId) || !isValidToken(inviteId) || !invite || Date.parse(invite.expiresAt) <= Date.now()) {
    fail(socket, requestId, 'invalid_invite', 'This invitation is invalid, expired, or has already been used.');
    return;
  }
  if (circle.devices[deviceId]) {
    fail(socket, requestId, 'device_exists', 'This phone is already a member of the circle.');
    return;
  }
  if (Object.keys(circle.devices).length >= MAX_DEVICES_PER_CIRCLE) {
    fail(socket, requestId, 'circle_full', `This relay supports up to ${MAX_DEVICES_PER_CIRCLE} devices per circle.`);
    return;
  }

  const deviceToken = newToken();
  circle.devices[deviceId] = { tokenHash: hash(deviceToken), joinedAt: now() };
  delete circle.invites[inviteId];
  connections.set(socket, { circleId, deviceId, isOwner: false });
  await persistState();
  reply(socket, requestId, 'invite_claimed', {
    circleId,
    deviceToken,
    snapshots: Object.entries(circle.snapshots).map(([senderDeviceId, snapshot]) => ({ senderDeviceId, ...snapshot })),
  });
  broadcast(circleId, { type: 'member_joined', senderDeviceId: deviceId, at: now() }, socket);
}

async function publish(socket, message) {
  const session = assertAuthenticated(socket, message);
  if (!session) return;
  const { requestId, envelope } = message;
  if (!isPlainObject(envelope) || envelope.version !== 1 || typeof envelope.nonce !== 'string' || typeof envelope.ciphertext !== 'string' || envelope.nonce.length > 100 || envelope.ciphertext.length > MAX_PAYLOAD_BYTES) {
    fail(socket, requestId, 'invalid_envelope', 'The relay accepts only a small opaque encrypted envelope.');
    return;
  }

  const circle = getCircle(session.circleId);
  const snapshot = { envelope, receivedAt: now() };
  circle.snapshots[session.deviceId] = snapshot;
  await persistState();
  broadcast(session.circleId, { type: 'event', senderDeviceId: session.deviceId, ...snapshot }, socket);
  reply(socket, requestId, 'published', { receivedAt: snapshot.receivedAt });
}

async function removeDevice(socket, message) {
  const session = assertAuthenticated(socket, message);
  if (!session) return;
  const { requestId, deviceId } = message;
  const circle = getCircle(session.circleId);
  if (!session.isOwner || !isValidId(deviceId) || deviceId === session.deviceId || !circle.devices[deviceId]) {
    fail(socket, requestId, 'invalid_request', 'Only the owner can remove another current member.');
    return;
  }
  delete circle.devices[deviceId];
  delete circle.snapshots[deviceId];
  await persistState();
  for (const [peer, peerSession] of connections.entries()) {
    if (peerSession.circleId === session.circleId && peerSession.deviceId === deviceId) {
      send(peer, { type: 'removed', message: 'This device was removed from the circle.' });
      peer.close(4003, 'Removed from circle');
    }
  }
  broadcast(session.circleId, { type: 'member_removed', senderDeviceId: deviceId, at: now() }, socket);
  reply(socket, requestId, 'device_removed', { deviceId });
}

async function handleMessage(socket, raw) {
  if (raw.length > MAX_PAYLOAD_BYTES) {
    socket.close(1009, 'Message too large');
    return;
  }
  let message;
  try {
    message = JSON.parse(raw.toString());
  } catch {
    fail(socket, undefined, 'invalid_json', 'Messages must be valid JSON.');
    return;
  }
  if (!isPlainObject(message) || typeof message.type !== 'string') {
    fail(socket, message?.requestId, 'invalid_request', 'A message type is required.');
    return;
  }

  switch (message.type) {
    case 'create_circle': return createCircle(socket, message);
    case 'authenticate': return authenticate(socket, message);
    case 'create_invite': return createInvite(socket, message);
    case 'claim_invite': return claimInvite(socket, message);
    case 'publish': return publish(socket, message);
    case 'remove_device': return removeDevice(socket, message);
    case 'ping': return reply(socket, message.requestId, 'pong', { at: now() });
    default: return fail(socket, message.requestId, 'unknown_message', 'This relay does not recognize that message type.');
  }
}

await loadState();

const server = createServer((request, response) => {
  const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`);
  if (request.method === 'GET' && url.pathname === '/healthz') {
    response.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    response.end(JSON.stringify({ status: 'ok', protocol: 1 }));
    return;
  }
  response.writeHead(404, { 'content-type': 'application/json' });
  response.end(JSON.stringify({ error: 'Not found' }));
});

const websocket = new WebSocketServer({ noServer: true, maxPayload: MAX_PAYLOAD_BYTES });
server.on('upgrade', (request, socket, head) => {
  const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`);
  if (url.pathname !== '/ws') {
    socket.write('HTTP/1.1 404 Not Found\r\n\r\n');
    socket.destroy();
    return;
  }
  websocket.handleUpgrade(request, socket, head, (client) => websocket.emit('connection', client, request));
});

websocket.on('connection', (socket) => {
  connections.set(socket, {});
  send(socket, { type: 'ready', protocol: 1 });
  socket.on('message', (raw, isBinary) => {
    if (isBinary) {
      socket.close(1003, 'Text messages only');
      return;
    }
    void handleMessage(socket, raw);
  });
  socket.on('close', () => connections.delete(socket));
  socket.on('error', () => connections.delete(socket));
});

server.listen(PORT, HOST, () => {
  console.log(`[relay] Free360 relay listening on ${HOST}:${PORT}`);
});
