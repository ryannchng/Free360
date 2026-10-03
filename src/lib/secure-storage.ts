import * as SecureStore from 'expo-secure-store';

// Background location and geofence tasks must read keys while iOS is locked.
const WRITE_OPTIONS = { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY };

// Every SecureStore item is UTF-8 byte-bounded (single items above ~2KB are
// unreliable on iOS keychains), so values are byte-split on code-point
// boundaries: multi-byte characters and surrogate pairs are never torn.
// Small values commit inline inside one manifest write; larger values commit
// via an atomic manifest pointer to copy-on-write generation keys.
//
// Crash/failure safety: chunk keys are unique per write (generation id), the
// manifest is written LAST, and superseded data is deleted only AFTER the new
// manifest commits. A failure before commit leaves the previous manifest (and
// value) untouched; staging leftovers are deleted best-effort and stay
// bounded. Readers never see mixed generations: a manifest always names one
// complete generation, and readers retry against a fresh manifest when chunks
// disagree with it.
//
// Concurrency: all get/set/delete for the same key are serialized through a
// per-key in-process mutex. Across JS runtimes (background tasks) the mutex
// cannot apply; safety there comes from the COW + atomic-commit +
// reader-retry scheme, with last-writer-wins on simultaneous writes and
// bounded orphan staging on cross-runtime crashes (see report).
const CHUNK_BYTES = 1800;
const MANIFEST_BYTES = 1700;
const MAX_CHUNKS = 12;
const MAX_VALUE_BYTES = CHUNK_BYTES * MAX_CHUNKS;
const READ_RETRIES = 3;

const manifestKey = (key: string) => `${key}.chunks`;
const chunkKey = (key: string, generation: string, index: number) => `${key}.g${generation}.c${index}`;
const legacyChunkKey = (key: string, index: number) => `${key}.c${index}`;

type ManifestState =
  | { kind: 'absent' }
  | { kind: 'invalid' }
  | { kind: 'inline'; inline: string }
  | { kind: 'chunks'; generation: string; count: number; bytes: number }
  | { kind: 'legacy'; count: number };

function utf8ByteLength(value: string): number {
  let bytes = 0;
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code < 0x80) bytes += 1;
    else if (code < 0x800) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff && i + 1 < value.length) {
      const next = value.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) { bytes += 4; i++; }
      else bytes += 3;
    } else bytes += 3;
  }
  return bytes;
}

// Splits on code-point boundaries so no character (including surrogate
// pairs and 4-byte emoji) is ever torn; every piece is <= maxBytes UTF-8.
function splitUtf8Bytes(value: string, maxBytes: number): string[] {
  const chunks: string[] = [];
  let current = '';
  let currentBytes = 0;
  for (const char of value) {
    const code = char.codePointAt(0) ?? 0;
    const size = code < 0x80 ? 1 : code < 0x800 ? 2 : code < 0x10000 ? 3 : 4;
    if (currentBytes + size > maxBytes && current !== '') {
      chunks.push(current);
      current = '';
      currentBytes = 0;
    }
    current += char;
    currentBytes += size;
  }
  chunks.push(current);
  return chunks;
}

function parseManifest(raw: string | null): ManifestState {
  if (raw === null) return { kind: 'absent' };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { kind: 'invalid' };
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return { kind: 'invalid' };
  const record = parsed as Record<string, unknown>;
  if (record.v === 1) {
    if (typeof record.inline === 'string') return { kind: 'inline', inline: record.inline };
    if (
      typeof record.generation === 'string' && /^[0-9a-z]{1,16}$/.test(record.generation) &&
      typeof record.count === 'number' && Number.isInteger(record.count) && record.count >= 1 && record.count <= MAX_CHUNKS &&
      typeof record.bytes === 'number' && Number.isInteger(record.bytes) && record.bytes >= 0 && record.bytes <= MAX_VALUE_BYTES
    ) {
      return { kind: 'chunks', generation: record.generation, count: record.count, bytes: record.bytes };
    }
    return { kind: 'invalid' };
  }
  // Pre-generational chunked format ({count} + `.cN` keys): still readable.
  if (
    record.v === undefined && typeof record.count === 'number' &&
    Number.isInteger(record.count) && record.count >= 1 && record.count <= MAX_CHUNKS
  ) {
    return { kind: 'legacy', count: record.count };
  }
  return { kind: 'invalid' };
}

function newGeneration(): string {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`.slice(0, 16);
}

// Per-key in-process mutex: chains operations FIFO so concurrent callers on
// this runtime can neither interleave nor orphan each other's data.
const tails = new Map<string, Promise<void>>();
function locked<T>(key: string, operation: () => Promise<T>): Promise<T> {
  const previous = tails.get(key) ?? Promise.resolve();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  tails.set(key, gate);
  const result = previous.then(operation, operation);
  result.then(release, release);
  void gate.then(() => { if (tails.get(key) === gate) tails.delete(key); });
  return result;
}

async function bestEffortDelete(keys: string[]) {
  await Promise.all(keys.map((key) => SecureStore.deleteItemAsync(key).catch(() => undefined)));
}

async function readChunks(key: string, generation: string, count: number, bytes: number): Promise<string | null> {
  const parts = await Promise.all(
    Array.from({ length: count }, (_, index) => SecureStore.getItemAsync(chunkKey(key, generation, index))),
  );
  if (parts.some((part) => typeof part !== 'string')) return null;
  const joined = (parts as string[]).join('');
  return utf8ByteLength(joined) === bytes ? joined : null;
}

async function readKey(key: string): Promise<string | null> {
  const first = parseManifest(await SecureStore.getItemAsync(manifestKey(key)));
  if (first.kind === 'inline') return first.inline;
  if (first.kind === 'chunks' || first.kind === 'legacy') {
    let target = first;
    for (let attempt = 0; attempt < READ_RETRIES; attempt++) {
      const value = target.kind === 'legacy'
        ? await readLegacyChunks(key, target.count)
        : await readChunks(key, target.generation, target.count, target.bytes);
      if (value !== null) return value;
      // Chunks disagree with the manifest: another writer may have committed
      // and cleaned up mid-read. Follow the fresh manifest, if any.
      const fresh = parseManifest(await SecureStore.getItemAsync(manifestKey(key)));
      if (fresh.kind === 'inline') return fresh.inline;
      if (fresh.kind === 'chunks' || fresh.kind === 'legacy') { target = fresh; continue; }
      if (fresh.kind === 'absent') return null;
      break;
    }
    throw new Error(`Stored value for ${key} is incomplete or corrupt; refusing to treat it as absent.`);
  }
  // No (or unparseable) manifest: deliberate legacy-direct fallback, so
  // pre-avatar installs and foreign values keep reading as before.
  return SecureStore.getItemAsync(key);
}

async function readLegacyChunks(key: string, count: number): Promise<string | null> {
  const parts = await Promise.all(
    Array.from({ length: count }, (_, index) => SecureStore.getItemAsync(legacyChunkKey(key, index))),
  );
  return parts.some((part) => typeof part !== 'string') ? null : (parts as string[]).join('');
}

async function cleanupSuperseded(key: string, previous: ManifestState) {
  const stale: string[] = [key];
  if (previous.kind === 'chunks') {
    for (let index = 0; index < previous.count; index++) stale.push(chunkKey(key, previous.generation, index));
  } else if (previous.kind === 'legacy') {
    for (let index = 0; index < previous.count; index++) stale.push(legacyChunkKey(key, index));
  }
  await bestEffortDelete(stale);
}

async function writeKey(key: string, value: string): Promise<void> {
  const totalBytes = utf8ByteLength(value);
  if (totalBytes > MAX_VALUE_BYTES) throw new Error(`Value for ${key} is ${totalBytes} bytes, above the ${MAX_VALUE_BYTES}-byte secure storage bound.`);
  const previous = parseManifest(await SecureStore.getItemAsync(manifestKey(key)));
  const inlineCandidate = JSON.stringify({ v: 1, inline: value });
  if (utf8ByteLength(inlineCandidate) <= MANIFEST_BYTES) {
    // Single atomic commit: the manifest write alone determines the value.
    await SecureStore.setItemAsync(manifestKey(key), inlineCandidate, WRITE_OPTIONS);
  } else {
    const generation = newGeneration();
    const chunks = splitUtf8Bytes(value, CHUNK_BYTES);
    try {
      await Promise.all(
        chunks.map((chunk, index) => SecureStore.setItemAsync(chunkKey(key, generation, index), chunk, WRITE_OPTIONS)),
      );
      // Atomic commit: readers trust a generation only once this exists.
      // A crash before this line leaves the previous manifest (and value).
      await SecureStore.setItemAsync(
        manifestKey(key),
        JSON.stringify({ v: 1, generation, count: chunks.length, bytes: totalBytes }),
        WRITE_OPTIONS,
      );
    } catch (error) {
      await bestEffortDelete(chunks.map((_, index) => chunkKey(key, generation, index)));
      throw error;
    }
  }
  // Superseded data is removed only after the new manifest committed.
  await cleanupSuperseded(key, previous);
}

async function deleteKey(key: string): Promise<void> {
  const previous = parseManifest(await SecureStore.getItemAsync(manifestKey(key)).catch(() => null));
  // Manifest first: the deletion commits here; stragglers then observe absence.
  await SecureStore.deleteItemAsync(manifestKey(key));
  await cleanupSuperseded(key, previous);
}

function getItemAsync(key: string): Promise<string | null> {
  return locked(key, () => readKey(key));
}

function setItemAsync(key: string, value: string): Promise<void> {
  return locked(key, () => writeKey(key, value));
}

function deleteItemAsync(key: string): Promise<void> {
  return locked(key, () => deleteKey(key));
}

export const secureStorage = { getItemAsync, setItemAsync, deleteItemAsync };
export const secureStorageLimits = { CHUNK_BYTES, MANIFEST_BYTES, MAX_CHUNKS, MAX_VALUE_BYTES, READ_RETRIES };
