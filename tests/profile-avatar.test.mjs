import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

function transpile(path) {
  const source = readFileSync(new URL(path, import.meta.url), 'utf8');
  return ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext } }).outputText;
}

async function importJs(javascript) {
  return import(`data:text/javascript;base64,${Buffer.from(javascript).toString('base64')}`);
}

const format = await importJs(transpile('../src/lib/avatar-format.ts'));
const {
  AVATAR_DATA_PREFIX,
  AVATAR_BASE64_MAX_CHARS,
  AVATAR_STRING_MAX_CHARS,
  AVATAR_SIZE_PX,
  ENVELOPE_CIPHERTEXT_MAX_CHARS,
  ENVELOPE_JSON_MAX_BYTES,
  normalizeAvatar,
  ciphertextCharsForPlaintextBytes,
  worstCaseSnapshotEnvelope,
} = format;

const circleSource = readFileSync(new URL('../src/lib/circle.ts', import.meta.url), 'utf8');

function extractFunction(source, name) {
  const start = source.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `${name} found in circle.ts`);
  const brace = source.indexOf('{', start);
  let depth = 0;
  for (let i = brace; i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}') {
      depth--;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  throw new Error(`unbalanced braces in ${name}`);
}

// parseProfile depends on local isRecord + normalizeAvatar; evaluate it with
// the real validator in scope.
const isRecordSrc = 'function isRecord(value) { return value !== null && typeof value === "object" && !Array.isArray(value); }\n';
const parseJs = ts.transpileModule(isRecordSrc + extractFunction(circleSource, 'parseProfile'), {
  compilerOptions: { module: ts.ModuleKind.ESNext },
}).outputText;
const formatJs = transpile('../src/lib/avatar-format.ts');
const { parseProfile } = await importJs(`${formatJs}\n${parseJs}\nexport const parseProfile = ${'parseProfile'};`.replace(
  'export const parseProfile = parseProfile;',
  'export { parseProfile };',
));

const validAvatar = `${AVATAR_DATA_PREFIX}${'A'.repeat(100).padEnd(100, 'B')}`;
const maxAvatar = `${AVATAR_DATA_PREFIX}${'A'.repeat(AVATAR_BASE64_MAX_CHARS)}`;

test('avatar constants keep thumbnails small enough for the envelope', () => {
  assert.equal(AVATAR_DATA_PREFIX, 'data:image/jpeg;base64,');
  assert.equal(AVATAR_STRING_MAX_CHARS, AVATAR_DATA_PREFIX.length + AVATAR_BASE64_MAX_CHARS);
  assert.equal(AVATAR_SIZE_PX, 128);
  assert.ok(AVATAR_BASE64_MAX_CHARS <= 5000);
});

test('normalizeAvatar accepts absent and well-formed values', () => {
  assert.equal(normalizeAvatar(null), null);
  assert.equal(normalizeAvatar(undefined), null);
  assert.equal(normalizeAvatar(validAvatar), validAvatar);
  assert.equal(normalizeAvatar(maxAvatar), maxAvatar);
});

test('normalizeAvatar rejects oversize, wrong-type, and malformed values', () => {
  assert.equal(normalizeAvatar(`${AVATAR_DATA_PREFIX}${'A'.repeat(AVATAR_BASE64_MAX_CHARS + 4)}`), null);
  assert.equal(normalizeAvatar('data:image/png;base64,AAAA'), null);
  assert.equal(normalizeAvatar('https://example.com/photo.jpg'), null);
  assert.equal(normalizeAvatar(`${AVATAR_DATA_PREFIX}***`), null);
  assert.equal(normalizeAvatar(`${AVATAR_DATA_PREFIX}ABC`), null); // bad padding
  assert.equal(normalizeAvatar(42), null);
  assert.equal(normalizeAvatar(''), null);
});

test('worst-case snapshot envelope stays within backend budgets with margin', () => {
  const worst = worstCaseSnapshotEnvelope();
  assert.ok(worst.ciphertextChars <= ENVELOPE_CIPHERTEXT_MAX_CHARS - 500, `ciphertext ${worst.ciphertextChars} leaves margin below 8192`);
  assert.ok(worst.envelopeBytes <= ENVELOPE_JSON_MAX_BYTES - 1000, `envelope ${worst.envelopeBytes}B leaves margin below 12000`);
});

test('worst case holds for multibyte names and full coordinates', () => {
  const payload = JSON.stringify({
    type: 'location',
    latitude: -90,
    longitude: -180,
    accuracy: 9999.99,
    recordedAt: '2026-10-03T00:00:00.000Z',
    profile: { name: '人'.repeat(40), home: { latitude: 90, longitude: 180, radius: 1000 }, battery: 100, avatar: maxAvatar },
  });
  const bytes = new TextEncoder().encode(payload).length;
  assert.ok(ciphertextCharsForPlaintextBytes(bytes) <= ENVELOPE_CIPHERTEXT_MAX_CHARS - 500);
});

test('parseProfile keeps a valid avatar and strips only an invalid one', () => {
  const base = { name: 'Ada', home: { latitude: 1, longitude: 2, radius: 150 }, battery: 80 };
  assert.equal(parseProfile({ ...base, avatar: validAvatar })?.avatar, validAvatar);
  assert.equal(parseProfile(base)?.avatar, null);
  assert.equal(parseProfile({ ...base, avatar: null })?.avatar, null);
  const stripped = parseProfile({ ...base, avatar: 'not-a-photo' });
  assert.equal(stripped?.avatar, null);
  assert.equal(stripped?.name, 'Ada');
  assert.deepEqual(stripped?.home, base.home);
  assert.equal(stripped?.battery, 80);
  const oversize = parseProfile({ ...base, avatar: `${AVATAR_DATA_PREFIX}${'A'.repeat(AVATAR_BASE64_MAX_CHARS + 4)}` });
  assert.equal(oversize?.avatar, null);
  assert.equal(oversize?.name, 'Ada');
});

test('DeviceProfile carries an optional avatar; history envelopes carry no profile', () => {
  assert.match(circleSource, /avatar\?: string \| null/);
  assert.ok(
    circleSource.includes("await sendEnvelope(config, encryptCirclePayload(payload, config.encryptionKey), 'history');"),
    'history reuses the pre-profile payload so photos never duplicate into history rows',
  );
});

test('saveDeviceProfile persists locally before attempting the snapshot publish', () => {
  const start = circleSource.indexOf('export async function saveDeviceProfile');
  assert.notEqual(start, -1);
  const end = circleSource.indexOf('\n}\n', start);
  const body = circleSource.slice(start, end);
  assert.ok(body.indexOf("setItemAsync('free360.profile.v1'") < body.indexOf('refreshDeviceSnapshot()'));
  assert.match(body, /try \{\s*\n?.*refreshDeviceSnapshot\(\);\s*\n?.*\} catch/);
});

// secure-storage with the native module replaced by an in-memory mock that
// supports write/delete failure injection for crash-path tests.
const storageSource = readFileSync(new URL('../src/lib/secure-storage.ts', import.meta.url), 'utf8');
const mockPrelude = `
const __mock = { backend: new Map(), failOnSet: null, failOnDelete: null, onRead: null };
globalThis.__ssMock = __mock;
const SecureStore = {
  AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY: 1,
  async getItemAsync(k) { if (__mock.onRead) await __mock.onRead(k); return __mock.backend.has(k) ? __mock.backend.get(k) : null; },
  async setItemAsync(k, v) { if (__mock.failOnSet && k.includes(__mock.failOnSet)) throw new Error('mock write failure'); __mock.backend.set(k, v); },
  async deleteItemAsync(k) { if (__mock.failOnDelete && k.includes(__mock.failOnDelete)) throw new Error('mock delete failure'); __mock.backend.delete(k); },
};
`;
const storageJs = ts.transpileModule(
  storageSource.replace("import * as SecureStore from 'expo-secure-store';", mockPrelude),
  { compilerOptions: { module: ts.ModuleKind.ESNext } },
).outputText;
const { secureStorage, secureStorageLimits } = await importJs(storageJs);
const mock = globalThis.__ssMock;
const LARGE_KEY = 'free360.profile.v1';

function backendKeys() {
  return [...mock.backend.keys()].sort();
}

function resetMock() {
  mock.backend.clear();
  mock.failOnSet = null;
  mock.failOnDelete = null;
  mock.onRead = null;
}

function utf8Bytes(value) {
  return new TextEncoder().encode(value).length;
}

function manifestOf(key = LARGE_KEY) {
  return JSON.parse(mock.backend.get(`${key}.chunks`));
}

test('small values commit atomically inside one manifest write', async () => {
  resetMock();
  await secureStorage.setItemAsync(LARGE_KEY, '{"name":"Ada"}');
  assert.equal(await secureStorage.getItemAsync(LARGE_KEY), '{"name":"Ada"}');
  assert.deepEqual(backendKeys(), [`${LARGE_KEY}.chunks`]);
  const manifest = manifestOf();
  assert.equal(manifest.v, 1);
  assert.equal(manifest.inline, '{"name":"Ada"}');
  // Empty string is a value, not absence.
  await secureStorage.setItemAsync(LARGE_KEY, '');
  assert.equal(await secureStorage.getItemAsync(LARGE_KEY), '');
});

test('legacy direct values keep reading; first write migrates them', async () => {
  resetMock();
  mock.backend.set('free360.circle.v2', '{"version":2}');
  assert.equal(await secureStorage.getItemAsync('free360.circle.v2'), '{"version":2}');
  await secureStorage.setItemAsync('free360.circle.v2', '{"version":2,"x":1}');
  assert.equal(await secureStorage.getItemAsync('free360.circle.v2'), '{"version":2,"x":1}');
  assert.ok(!mock.backend.has('free360.circle.v2'), 'legacy direct slot cleaned after commit');
});

test('pre-generational chunked values ({count} + .cN) keep reading', async () => {
  resetMock();
  const big = `x${'y'.repeat(secureStorageLimits.CHUNK_BYTES + 50)}`;
  const half = Math.ceil(big.length / 2);
  mock.backend.set(`${LARGE_KEY}.chunks`, JSON.stringify({ count: 2 }));
  mock.backend.set(`${LARGE_KEY}.c0`, big.slice(0, half));
  mock.backend.set(`${LARGE_KEY}.c1`, big.slice(half));
  assert.equal(await secureStorage.getItemAsync(LARGE_KEY), big);
  await secureStorage.setItemAsync(LARGE_KEY, 'migrated');
  assert.equal(await secureStorage.getItemAsync(LARGE_KEY), 'migrated');
  assert.ok(!backendKeys().some((k) => /\.c\d+$/.test(k)), 'legacy chunks cleaned after commit');
});

test('large multilingual values round-trip in UTF-8 byte-bounded chunks', async () => {
  resetMock();
  const boundary = `${'a'.repeat(1799)}😀${'人'.repeat(3000)}🎉${'z'.repeat(500)}`;
  await secureStorage.setItemAsync(LARGE_KEY, boundary);
  assert.equal(await secureStorage.getItemAsync(LARGE_KEY), boundary);
  const manifest = manifestOf();
  assert.ok(manifest.count >= 2 && manifest.count <= secureStorageLimits.MAX_CHUNKS);
  assert.equal(manifest.bytes, utf8Bytes(boundary));
  for (let i = 0; i < manifest.count; i++) {
    const chunk = [...mock.backend.entries()].find(([k]) => k.endsWith(`.c${i}`));
    assert.ok(chunk, `chunk ${i} present under the committed generation`);
    assert.ok(utf8Bytes(chunk[1]) <= secureStorageLimits.CHUNK_BYTES, `chunk ${i} within byte bound`);
  }
  assert.ok(!mock.backend.has(LARGE_KEY), 'no legacy direct twin of a chunked value');
});

test('byte bound is exact: 21600 multibyte bytes fit, 21601 do not', async () => {
  resetMock();
  const exact = '人'.repeat(7200); // 21600 bytes
  assert.equal(utf8Bytes(exact), secureStorageLimits.MAX_VALUE_BYTES);
  await secureStorage.setItemAsync(LARGE_KEY, exact);
  assert.equal(await secureStorage.getItemAsync(LARGE_KEY), exact);
  assert.equal(manifestOf().count, secureStorageLimits.MAX_CHUNKS);
  await assert.rejects(() => secureStorage.setItemAsync(LARGE_KEY, `${exact}x`), /above the .* bound/);
});

test('large->large with partial chunk failure leaves the original untouched', async () => {
  resetMock();
  const original = `o${'riginal'.repeat(600)}`;
  await secureStorage.setItemAsync(LARGE_KEY, original);
  const before = backendKeys();
  const manifestBefore = mock.backend.get(`${LARGE_KEY}.chunks`);
  mock.failOnSet = '.g'; // fail staged generation chunk writes
  await assert.rejects(
    () => secureStorage.setItemAsync(LARGE_KEY, `n${'ew-value'.repeat(600)}`),
    /mock write failure/,
  );
  mock.failOnSet = null;
  assert.equal(await secureStorage.getItemAsync(LARGE_KEY), original);
  assert.equal(mock.backend.get(`${LARGE_KEY}.chunks`), manifestBefore);
  assert.deepEqual(backendKeys(), before, 'staging cleaned, no mixed generations');
});

test('manifest commit failure leaves the original untouched', async () => {
  resetMock();
  const original = `o${'riginal'.repeat(600)}`;
  await secureStorage.setItemAsync(LARGE_KEY, original);
  const manifestBefore = mock.backend.get(`${LARGE_KEY}.chunks`);
  mock.failOnSet = '.chunks'; // fail the atomic commit itself
  await assert.rejects(() => secureStorage.setItemAsync(LARGE_KEY, 'small'), /mock write failure/);
  mock.failOnSet = null;
  assert.equal(await secureStorage.getItemAsync(LARGE_KEY), original);
  assert.equal(mock.backend.get(`${LARGE_KEY}.chunks`), manifestBefore);
});

test('large->small with interrupted cleanup still commits; system keeps working', async () => {
  resetMock();
  await secureStorage.setItemAsync(LARGE_KEY, `b${'ig'.repeat(1200)}`);
  const oldGen = manifestOf().generation;
  mock.failOnDelete = '.g'; // crash between commit and cleanup
  await secureStorage.setItemAsync(LARGE_KEY, 'small');
  mock.failOnDelete = null;
  assert.equal(await secureStorage.getItemAsync(LARGE_KEY), 'small');
  assert.ok(backendKeys().some((k) => k.includes(`.g${oldGen}.`)), 'superseded generation orphaned by the failed cleanup');
  await secureStorage.setItemAsync(LARGE_KEY, 'small-again');
  assert.equal(await secureStorage.getItemAsync(LARGE_KEY), 'small-again');
});

test('concurrent same-key operations serialize FIFO with no torn reads', async () => {
  resetMock();
  await secureStorage.setItemAsync(LARGE_KEY, 'v0');
  const big = `B${'ig'.repeat(1500)}`;
  const seen = [];
  const p1 = secureStorage.setItemAsync(LARGE_KEY, big);
  const p2 = secureStorage.setItemAsync(LARGE_KEY, 'v2');
  const p3 = secureStorage.getItemAsync(LARGE_KEY).then((v) => { seen.push(v); });
  const p4 = secureStorage.deleteItemAsync(LARGE_KEY);
  const p5 = secureStorage.getItemAsync(LARGE_KEY).then((v) => { seen.push(v); });
  await Promise.all([p1, p2, p3, p4, p5]);
  assert.ok(seen[0] === 'v2' || seen[0] === big, `in-flight read sees one complete value, got ${String(seen[0]).length} chars`);
  assert.equal(seen[1], null, 'read after queued delete sees absence');
  assert.equal(await secureStorage.getItemAsync(LARGE_KEY), null);
});

test('stale-manifest read follows a fresh cross-runtime commit instead of tearing', async () => {
  resetMock();
  const bigA = `A${'lpha'.repeat(500)}`;
  const bigB = `B${'eta!'.repeat(500)}`;
  await secureStorage.setItemAsync(LARGE_KEY, bigA);
  const stale = manifestOf();
  await secureStorage.setItemAsync(LARGE_KEY, bigB);
  const fresh = manifestOf();
  assert.notEqual(stale.generation, fresh.generation);
  // Rewind to the stale pointer whose chunks are already cleaned up, then
  // commit the fresh pointer mid-read like a racing runtime would.
  mock.backend.set(`${LARGE_KEY}.chunks`, JSON.stringify(stale));
  let flipped = false;
  mock.onRead = async (key) => {
    if (!flipped && key.endsWith('.c0')) {
      flipped = true;
      mock.backend.set(`${LARGE_KEY}.chunks`, JSON.stringify(fresh));
    }
  };
  assert.equal(await secureStorage.getItemAsync(LARGE_KEY), bigB);
  mock.onRead = null;
});

test('missing or tampered chunks throw; they never look like absence', async () => {
  resetMock();
  await secureStorage.setItemAsync(LARGE_KEY, `b${'ig'.repeat(1200)}`);
  const manifestKey = `${LARGE_KEY}.chunks`;
  const gen = manifestOf().generation;
  mock.backend.delete(`${LARGE_KEY}.g${gen}.c0`);
  await assert.rejects(() => secureStorage.getItemAsync(LARGE_KEY), /incomplete or corrupt/);
  await secureStorage.setItemAsync(LARGE_KEY, `b${'ig'.repeat(1200)}`);
  const gen2 = manifestOf().generation;
  mock.backend.set(`${LARGE_KEY}.g${gen2}.c0`, 'tampered-short');
  await assert.rejects(() => secureStorage.getItemAsync(LARGE_KEY), /incomplete or corrupt/);
  assert.ok(mock.backend.has(manifestKey), 'failing reads do not delete the manifest');
});

test('unparseable manifest deliberately falls back to legacy direct; true absence is null', async () => {
  resetMock();
  mock.backend.set(`${LARGE_KEY}.chunks`, 'not-json{{{');
  mock.backend.set(LARGE_KEY, 'legacy-direct');
  assert.equal(await secureStorage.getItemAsync(LARGE_KEY), 'legacy-direct');
  resetMock();
  assert.equal(await secureStorage.getItemAsync(LARGE_KEY), null);
});

test('delete removes manifest, chunks, and direct slots together', async () => {
  resetMock();
  await secureStorage.setItemAsync(LARGE_KEY, `b${'ig'.repeat(1200)}`);
  await secureStorage.deleteItemAsync(LARGE_KEY);
  assert.equal(backendKeys().length, 0);
  assert.equal(await secureStorage.getItemAsync(LARGE_KEY), null);
  await secureStorage.deleteItemAsync('missing-key');
});
