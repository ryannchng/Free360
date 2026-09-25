import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { createServer } from 'node:http';
import { DatabaseSync } from 'node:sqlite';

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const tokenPattern = /^[A-Za-z0-9_-]{43}$/;
const sessionLimit = 1000;

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

function hash(value) { return createHash('sha256').update(value, 'utf8').digest(); }
function validUuid(value) { return typeof value === 'string' && uuidPattern.test(value); }
function requireUuid(value, label) {
  if (!validUuid(value)) throw new HttpError(400, `Invalid ${label}.`);
  return value;
}
function equalSecret(value, stored) {
  if (typeof value !== 'string' || !stored) return false;
  return timingSafeEqual(hash(value), Buffer.from(stored, 'hex'));
}
function validEnvelope(value) {
  return value && typeof value === 'object' && !Array.isArray(value) && value.version === 1 &&
    typeof value.nonce === 'string' && value.nonce.length >= 20 && value.nonce.length <= 100 &&
    typeof value.ciphertext === 'string' && value.ciphertext.length >= 1 && value.ciphertext.length <= 8192 &&
    Buffer.byteLength(JSON.stringify(value)) <= 12000;
}
function transaction(db, work) {
  db.exec('BEGIN IMMEDIATE');
  try { const result = work(); db.exec('COMMIT'); return result; }
  catch (error) { db.exec('ROLLBACK'); throw error; }
}
async function readJson(req) {
  let length = 0;
  const chunks = [];
  for await (const chunk of req) {
    length += chunk.length;
    if (length > 12000) throw new HttpError(413, 'Request body is too large.');
    chunks.push(chunk);
  }
  try {
    const value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
    return value;
  } catch { throw new HttpError(400, 'Invalid JSON body.'); }
}
function send(res, status, data) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS',
  });
  res.end(JSON.stringify(data));
}

export function createFree360Server({ databasePath, setupCode }) {
  const db = new DatabaseSync(databasePath);
  db.exec(`
    PRAGMA foreign_keys = ON;
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS setup (id INTEGER PRIMARY KEY CHECK (id = 1), secret_hash TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, token_hash TEXT NOT NULL UNIQUE, created_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS circles (id TEXT PRIMARY KEY, singleton INTEGER NOT NULL UNIQUE DEFAULT 1 CHECK (singleton = 1), owner_id TEXT NOT NULL REFERENCES sessions(id), revision INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS members (user_id TEXT PRIMARY KEY REFERENCES sessions(id), circle_id TEXT NOT NULL REFERENCES circles(id), joined_at INTEGER NOT NULL);
    CREATE INDEX IF NOT EXISTS members_circle_idx ON members(circle_id);
    CREATE TABLE IF NOT EXISTS invites (id TEXT PRIMARY KEY, circle_id TEXT NOT NULL REFERENCES circles(id), secret_hash TEXT NOT NULL, expires_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS snapshots (circle_id TEXT NOT NULL REFERENCES circles(id), device_id TEXT NOT NULL REFERENCES sessions(id), envelope TEXT NOT NULL, revision INTEGER NOT NULL, received_at INTEGER NOT NULL, PRIMARY KEY (circle_id, device_id));
    CREATE TABLE IF NOT EXISTS events (id INTEGER PRIMARY KEY AUTOINCREMENT, circle_id TEXT NOT NULL REFERENCES circles(id), device_id TEXT NOT NULL REFERENCES sessions(id), envelope TEXT NOT NULL, revision INTEGER NOT NULL, received_at INTEGER NOT NULL);
    CREATE INDEX IF NOT EXISTS events_recent_idx ON events(circle_id, revision DESC);
  `);
  if (!db.prepare('SELECT id FROM circles LIMIT 1').get() && !db.prepare('SELECT id FROM setup WHERE id = 1').get()) {
    if (typeof setupCode !== 'string' || !/^[a-f0-9]{64}$/.test(setupCode)) throw new Error('FREE360_SETUP_CODE must be 64 lowercase hexadecimal characters on first start. Generate it with openssl rand -hex 32.');
    db.prepare('INSERT INTO setup (id, secret_hash) VALUES (1, ?)').run(hash(setupCode).toString('hex'));
  }

  const rateLimits = new Map();
  function limitSessionCreation(req) {
    const now = Date.now();
    const ip = req.socket.remoteAddress || 'unknown';
    if (rateLimits.size > 5000) for (const [key, entry] of rateLimits) if (entry.until < now) rateLimits.delete(key);
    const entry = rateLimits.get(ip);
    if (entry && entry.until > now && entry.count >= 60) throw new HttpError(429, 'Too many device sessions. Try again later.');
    rateLimits.set(ip, entry && entry.until > now ? { count: entry.count + 1, until: entry.until } : { count: 1, until: now + 3600000 });
  }
  function authenticatedUser(req) {
    const match = /^Bearer ([A-Za-z0-9_-]{43})$/.exec(req.headers.authorization || '');
    if (!match || !tokenPattern.test(match[1])) throw new HttpError(401, 'Device session required.');
    const row = db.prepare('SELECT id FROM sessions WHERE token_hash = ?').get(hash(match[1]).toString('hex'));
    if (!row) throw new HttpError(401, 'Invalid device session.');
    return row.id;
  }
  function membership(userId, circleId) {
    return db.prepare('SELECT 1 FROM members WHERE user_id = ? AND circle_id = ?').get(userId, circleId) !== undefined;
  }
  function ownCircle(userId) {
    const row = db.prepare('SELECT circle_id FROM members WHERE user_id = ?').get(userId);
    if (!row) throw new HttpError(403, 'This device is not a circle member.');
    return row.circle_id;
  }
  function nextRevision(circleId) {
    db.prepare('UPDATE circles SET revision = revision + 1 WHERE id = ?').run(circleId);
    return db.prepare('SELECT revision FROM circles WHERE id = ?').get(circleId).revision;
  }

  const server = createServer(async (req, res) => {
    try {
      if (req.method === 'OPTIONS') { send(res, 204, null); return; }
      const url = new URL(req.url, 'http://localhost');
      if (req.method === 'GET' && url.pathname === '/health') { send(res, 200, { ok: true }); return; }
      if (req.method === 'POST' && url.pathname === '/v1/sessions') {
        limitSessionCreation(req);
        const result = transaction(db, () => {
          if (db.prepare('SELECT COUNT(*) AS count FROM sessions').get().count >= sessionLimit) throw new HttpError(429, 'Device session limit reached.');
          const deviceId = randomUUID();
          const token = randomBytes(32).toString('base64url');
          db.prepare('INSERT INTO sessions (id, token_hash, created_at) VALUES (?, ?, ?)').run(deviceId, hash(token).toString('hex'), Date.now());
          return { deviceId, token };
        });
        send(res, 201, result); return;
      }

      const userId = authenticatedUser(req);
      if (req.method === 'POST' && url.pathname === '/v1/circle') {
        const body = await readJson(req);
        const circleId = requireUuid(body.circleId, 'circle ID');
        transaction(db, () => {
          if (db.prepare('SELECT 1 FROM circles').get()) throw new HttpError(409, 'This server already has a circle.');
          const setup = db.prepare('SELECT secret_hash FROM setup WHERE id = 1').get();
          if (!equalSecret(body.setupCode, setup?.secret_hash)) throw new HttpError(403, 'Invalid group setup code.');
          db.prepare('INSERT INTO circles (id, owner_id) VALUES (?, ?)').run(circleId, userId);
          db.prepare('INSERT INTO members (user_id, circle_id, joined_at) VALUES (?, ?, ?)').run(userId, circleId, Date.now());
          db.prepare('DELETE FROM setup').run();
        });
        send(res, 201, { circleId }); return;
      }
      if (req.method === 'GET' && url.pathname === '/v1/member') {
        const circleId = requireUuid(url.searchParams.get('circleId'), 'circle ID');
        send(res, 200, { member: membership(userId, circleId) }); return;
      }
      if (req.method === 'POST' && url.pathname === '/v1/invites') {
        const body = await readJson(req);
        const inviteId = requireUuid(body.inviteId, 'invitation ID');
        if (typeof body.secret !== 'string' || body.secret.length < 40 || body.secret.length > 100) throw new HttpError(400, 'Invalid invitation secret.');
        const expiry = transaction(db, () => {
          const circle = db.prepare('SELECT id FROM circles WHERE owner_id = ?').get(userId);
          if (!circle) throw new HttpError(403, 'Only the circle owner can invite people.');
          db.prepare('DELETE FROM invites WHERE expires_at <= ?').run(Date.now());
          if (db.prepare('SELECT COUNT(*) AS count FROM invites WHERE circle_id = ?').get(circle.id).count >= 20) throw new HttpError(409, 'Too many active invitations.');
          const expiresAt = Date.now() + 15 * 60 * 1000;
          db.prepare('INSERT INTO invites (id, circle_id, secret_hash, expires_at) VALUES (?, ?, ?, ?)').run(inviteId, circle.id, hash(body.secret).toString('hex'), expiresAt);
          return expiresAt;
        });
        send(res, 201, { expiresAt: new Date(expiry).toISOString() }); return;
      }
      if (req.method === 'POST' && url.pathname === '/v1/invites/claim') {
        const body = await readJson(req);
        const inviteId = requireUuid(body.inviteId, 'invitation ID');
        const circleId = requireUuid(body.circleId, 'circle ID');
        transaction(db, () => {
          if (db.prepare('SELECT 1 FROM members WHERE user_id = ?').get(userId)) throw new HttpError(409, 'This device already belongs to a circle.');
          const invite = db.prepare('SELECT circle_id, secret_hash, expires_at FROM invites WHERE id = ?').get(inviteId);
          if (!invite || invite.circle_id !== circleId || invite.expires_at <= Date.now() || !equalSecret(body.secret, invite.secret_hash)) throw new HttpError(403, 'Invitation expired, invalid, or already used.');
          if (db.prepare('SELECT COUNT(*) AS count FROM members WHERE circle_id = ?').get(circleId).count >= 20) throw new HttpError(409, 'This circle is full.');
          db.prepare('DELETE FROM invites WHERE id = ?').run(inviteId);
          db.prepare('INSERT INTO members (user_id, circle_id, joined_at) VALUES (?, ?, ?)').run(userId, circleId, Date.now());
        });
        send(res, 200, { circleId }); return;
      }
      if ((req.method === 'PUT' && url.pathname === '/v1/snapshot') || (req.method === 'POST' && url.pathname === '/v1/events')) {
        const body = await readJson(req);
        if (!validEnvelope(body.envelope)) throw new HttpError(400, 'Invalid encrypted envelope.');
        const circleId = ownCircle(userId);
        transaction(db, () => {
          const revision = nextRevision(circleId);
          const envelope = JSON.stringify(body.envelope);
          const now = Date.now();
          if (url.pathname === '/v1/snapshot') {
            db.prepare('INSERT INTO snapshots (circle_id, device_id, envelope, revision, received_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(circle_id, device_id) DO UPDATE SET envelope = excluded.envelope, revision = excluded.revision, received_at = excluded.received_at').run(circleId, userId, envelope, revision, now);
          } else {
            db.prepare('INSERT INTO events (circle_id, device_id, envelope, revision, received_at) VALUES (?, ?, ?, ?, ?)').run(circleId, userId, envelope, revision, now);
            db.prepare('DELETE FROM events WHERE circle_id = ? AND id NOT IN (SELECT id FROM events WHERE circle_id = ? ORDER BY id DESC LIMIT 100)').run(circleId, circleId);
          }
        });
        send(res, 200, { ok: true }); return;
      }
      if (req.method === 'GET' && url.pathname === '/v1/updates') {
        const circleId = requireUuid(url.searchParams.get('circleId'), 'circle ID');
        if (!membership(userId, circleId)) throw new HttpError(403, 'This device is not a circle member.');
        const after = Number(url.searchParams.get('after') || '0');
        if (!Number.isSafeInteger(after) || after < 0) throw new HttpError(400, 'Invalid update cursor.');
        const revision = db.prepare('SELECT revision FROM circles WHERE id = ?').get(circleId)?.revision ?? 0;
        const snapshots = db.prepare('SELECT device_id, envelope FROM snapshots WHERE circle_id = ? AND revision > ? ORDER BY revision').all(circleId, after).map((row) => ({ device_id: row.device_id, envelope: JSON.parse(row.envelope) }));
        const events = db.prepare('SELECT device_id, envelope FROM events WHERE circle_id = ? AND revision > ? ORDER BY revision').all(circleId, after).map((row) => ({ device_id: row.device_id, envelope: JSON.parse(row.envelope) }));
        send(res, 200, { revision, snapshots, events }); return;
      }
      throw new HttpError(404, 'Endpoint not found.');
    } catch (error) {
      if (!(error instanceof HttpError)) console.error('Request failed:', error);
      if (!res.headersSent) send(res, error instanceof HttpError ? error.status : 500, { error: error instanceof HttpError ? error.message : 'Internal server error.' });
    }
  });
  return { server, db };
}
