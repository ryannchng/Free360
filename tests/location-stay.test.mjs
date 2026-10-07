import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import ts from 'typescript';

// Pin local time so DST/midnight cases are deterministic.
process.env.TZ = 'America/New_York';

const require = createRequire(import.meta.url);

function loadModule(relativePath, localRequire) {
  const source = readFileSync(new URL(relativePath, import.meta.url), 'utf8');
  const javascript = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  const module = { exports: {} };
  new Function('exports', 'module', 'require', javascript)(module.exports, module, localRequire);
  return module.exports;
}

const region = loadModule('../src/lib/map-region.ts', require);
const stay = loadModule('../src/lib/location-stay.ts', (path) => {
  if (path === './map-region') return region;
  return require(path);
});

const at = (latitude, longitude, timestamp, accuracy = 5, moving = false) => ({ latitude, longitude, timestamp, accuracy, moving });
const T0 = new Date(2025, 4, 12, 15, 24, 0).getTime();

test('stay duration uses elapsed minutes and handles missing, future and invalid times', () => {
  assert.equal(stay.stayDurationLabel(T0, T0 + (5 * 60 + 49) * 60000), '5 hrs, 49 mins');
  assert.equal(stay.stayDurationLabel(T0, T0 + 60 * 60000), '1 hr');
  assert.equal(stay.stayDurationLabel(T0, T0 + 61000), '1 min');
  assert.equal(stay.stayDurationLabel(T0 + 60000, T0), 'Less than a minute');
  assert.equal(stay.stayDurationLabel(null, T0), null);
  assert.equal(stay.stayDurationLabel(NaN, T0), null);
  assert.equal(stay.stayDurationLabel(T0, 0), null);
});

test('remote stay uses contiguous observations and stops at relocation or missing history', () => {
  const point = (latitude, minute) => ({ latitude, longitude: -79, recordedAt: new Date(T0 + minute * 60000).toISOString() });
  assert.equal(stay.observedStaySince([point(43, 10), point(43.0001, 0), point(43, 5)]), T0);
  assert.equal(stay.observedStaySince([point(44, 0), point(43, 5), point(43, 10)]), T0 + 5 * 60000);
  assert.equal(stay.observedStaySince([point(43, 0), point(43, 20)]), T0 + 20 * 60000);
  assert.equal(stay.observedStaySince([]), null);
  assert.equal(stay.observedStaySince([point(91, 0)]), null);
});

test('first fix starts the stay; jitter inside tolerance keeps the original start', () => {
  let state = stay.updateStay(null, at(43.0, -79.0, T0));
  assert.deepEqual(state, { latitude: 43.0, longitude: -79.0, accuracy: 5, sinceMs: T0 });
  // ~50m jitter with decent accuracy: same stay, original start kept.
  state = stay.updateStay(state, at(43.0004, -79.0003, T0 + 30_000));
  assert.equal(state.sinceMs, T0);
  state = stay.updateStay(state, at(42.9997, -79.0002, T0 + 60_000));
  assert.equal(state.sinceMs, T0);
});

test('actual relocation beyond tolerance starts a fresh stay', () => {
  const first = stay.updateStay(null, at(43.0, -79.0, T0));
  const moved = stay.updateStay(first, at(43.01, -79.0, T0 + 300_000));
  assert.equal(moved.sinceMs, T0 + 300_000);
  assert.equal(moved.latitude, 43.01);
});

test('poor accuracy widens tolerance; moving fixes clear the stay', () => {
  const first = stay.updateStay(null, at(43.0, -79.0, T0, 150));
  // 200m away but accuracies sum to 300m: still the same stay.
  const noisy = stay.updateStay(first, at(43.0018, -79.0, T0 + 30_000, 150));
  assert.equal(noisy.sinceMs, T0);
  // Classified movement clears the stay even without displacement.
  assert.equal(stay.updateStay(first, at(43.0, -79.0, T0 + 60_000, 5, true)), null);
  // Unknown movement keeps the stay; the next stationary fix re-anchors after travel.
  const kept = stay.updateStay(first, at(43.0, -79.0, T0 + 60_000, null, false));
  assert.equal(kept.sinceMs, T0);
  const afterTravel = stay.updateStay(null, at(44.0, -79.0, T0 + 120_000, 5, false));
  assert.equal(afterTravel.sinceMs, T0 + 120_000);
});

test('malformed and out-of-order fixes never corrupt the stay', () => {
  const first = stay.updateStay(null, at(43.0, -79.0, T0));
  assert.equal(first.sinceMs, T0);
  assert.deepEqual(stay.updateStay(first, at(NaN, -79.0, T0 + 10_000)), first);
  assert.deepEqual(stay.updateStay(first, at(43.0, -79.0, Infinity)), first);
  assert.deepEqual(stay.updateStay(first, at(91, -79.0, T0 + 10_000)), first);
  assert.deepEqual(stay.updateStay(first, at(44.0, -79.0, T0 - 10_000)), first);
  assert.equal(stay.updateStay(null, at(43.0, -79.0, NaN)), null);
});

test('persisted stays rehydrate only when valid', () => {
  assert.deepEqual(stay.parseStay({ latitude: 43, longitude: -79, accuracy: 5, sinceMs: T0 }), { latitude: 43, longitude: -79, accuracy: 5, sinceMs: T0 });
  assert.equal(stay.parseStay(null), null);
  assert.equal(stay.parseStay([]), null);
  assert.equal(stay.parseStay({ latitude: 43, longitude: -79 }), null);
  assert.equal(stay.parseStay({ latitude: 91, longitude: -79, sinceMs: T0 }), null);
  assert.equal(stay.parseStay({ latitude: 43, longitude: -79, sinceMs: 'soon' }), null);
  assert.deepEqual(stay.parseStay({ latitude: 43, longitude: -79, accuracy: -2, sinceMs: T0 }), { latitude: 43, longitude: -79, accuracy: null, sinceMs: T0 });
});

test('since labels use local 12-hour time with today/yesterday/date fallback', () => {
  const now = new Date(2025, 4, 12, 15, 30, 0).getTime();
  assert.equal(stay.sinceLabel(new Date(2025, 4, 12, 15, 24, 0).getTime(), now), 'since 3:24 PM today');
  assert.equal(stay.sinceLabel(new Date(2025, 4, 12, 0, 5, 0).getTime(), now), 'since 12:05 AM today');
  assert.equal(stay.sinceLabel(new Date(2025, 4, 12, 12, 0, 0).getTime(), now), 'since 12:00 PM today');
  assert.equal(stay.sinceLabel(new Date(2025, 4, 11, 23, 55, 0).getTime(), now), 'since 11:55 PM yesterday');
  assert.equal(stay.sinceLabel(new Date(2025, 4, 3, 11, 5, 0).getTime(), now), 'since 11:05 AM May 3');
  assert.equal(stay.sinceLabel(new Date(2024, 11, 31, 9, 0, 0).getTime(), now), 'since 9:00 AM Dec 31, 2024');
  // Midnight boundary: just after midnight, late evening is yesterday.
  const justAfterMidnight = new Date(2025, 0, 2, 0, 5, 0).getTime();
  assert.equal(stay.sinceLabel(new Date(2025, 0, 1, 23, 55, 0).getTime(), justAfterMidnight), 'since 11:55 PM yesterday');
  // Future starts (clock skew) clamp to now instead of inventing tomorrow.
  assert.equal(stay.sinceLabel(now + 3_600_000, now), 'since 3:30 PM today');
});

test('since labels stay correct across the spring-forward DST transition', () => {
  // US DST started Mar 9, 2025: Mar 9 is only 23 hours long.
  const morningAfter = new Date(2025, 2, 10, 10, 0, 0).getTime();
  assert.equal(stay.sinceLabel(new Date(2025, 2, 9, 10, 0, 0).getTime(), morningAfter), 'since 10:00 AM yesterday');
  assert.equal(stay.sinceLabel(new Date(2025, 2, 8, 10, 0, 0).getTime(), morningAfter), 'since 10:00 AM Mar 8');
});

test('street addresses prefer number plus name, then fall back honestly', () => {
  assert.equal(stay.formatAddress({ streetNumber: '506', street: 'Manhattan Drive' }), '506 Manhattan Drive');
  assert.equal(stay.formatAddress({ streetNumber: '  ', street: 'Manhattan Drive' }), 'Manhattan Drive');
  assert.equal(stay.formatAddress({ street: 'Manhattan Drive' }), 'Manhattan Drive');
  assert.equal(stay.formatAddress({ city: 'Chicago' }), 'Chicago');
  assert.equal(stay.formatAddress({}), null);
  assert.equal(stay.formatAddress({ streetNumber: '506' }), null);
  assert.equal(stay.formatAddress(null), null);
});

test('address buckets absorb jitter; the resolver caches, shares and isolates lookups', async () => {
  assert.equal(stay.addressBucket({ latitude: 43.12344, longitude: -79.00061 }), stay.addressBucket({ latitude: 43.12346, longitude: -79.00062 }));
  assert.notEqual(stay.addressBucket({ latitude: 43.123, longitude: -79.0 }), stay.addressBucket({ latitude: 44.123, longitude: -79.0 }));
  let calls = 0;
  const resolver = stay.createAddressResolver(async (coordinate) => {
    calls += 1;
    return [{ streetNumber: '506', street: 'Manhattan Drive', city: 'Toronto' }];
  });
  const home = { latitude: 43.6532, longitude: -79.3832 };
  assert.equal(await resolver.resolve(home), '506 Manhattan Drive');
  assert.equal(await resolver.resolve({ latitude: 43.65325, longitude: -79.38325 }), '506 Manhattan Drive');
  assert.equal(calls, 1);
  // Concurrent resolves for one bucket share a single lookup.
  let releases = [];
  const slow = stay.createAddressResolver(() => new Promise((resolve) => { releases.push(resolve); }));
  const first = slow.resolve(home);
  const second = slow.resolve(home);
  // Lookups run deferred; let the shared lookup start before releasing it.
  await new Promise((resolve) => setImmediate(resolve));
  releases.forEach((release) => release([{ street: 'Slow Street' }]));
  assert.deepEqual(await Promise.all([first, second]), ['Slow Street', 'Slow Street']);
  // Overlapping lookups resolve their own buckets even out of order.
  const order = [];
  const racy = stay.createAddressResolver(async (coordinate) => {
    order.push(coordinate.latitude);
    await new Promise((resolve) => setTimeout(resolve, coordinate.latitude < 44 ? 20 : 0));
    return [{ street: coordinate.latitude < 44 ? 'First Street' : 'Second Street' }];
  });
  const [a, b] = await Promise.all([
    racy.resolve({ latitude: 43.0, longitude: -79.0 }),
    racy.resolve({ latitude: 45.0, longitude: -79.0 }),
  ]);
  assert.deepEqual([a, b], ['First Street', 'Second Street']);
  // Failures resolve to null without throwing and are cached.
  let failures = 0;
  const flaky = stay.createAddressResolver(async () => { failures += 1; throw new Error('rate limited'); });
  assert.equal(await flaky.resolve(home), null);
  assert.equal(await flaky.resolve(home), null);
  assert.equal(failures, 1);
});

test('self status line never claims arrival while moving, disabled or unfixed', () => {
  const coord = { latitude: 43.0, longitude: -79.0 };
  const settled = { locationEnabled: true, coordinate: coord, activity: 'stationary', staySinceMs: T0, address: '506 Manhattan Drive', nowMs: new Date(2025, 4, 12, 15, 30, 0).getTime() };
  assert.deepEqual(stay.selfStatusLine(settled), { status: 'At 506 Manhattan Drive', lastSeen: 'since 3:24 PM today' });
  assert.deepEqual(
    stay.selfStatusLine({ ...settled, activity: null, address: null }),
    { status: 'At current location', lastSeen: 'since 3:24 PM today' },
  );
  // Moving members keep the address but never a "since".
  assert.deepEqual(
    stay.selfStatusLine({ ...settled, activity: 'walking' }),
    { status: 'At 506 Manhattan Drive', lastSeen: 'Walking' },
  );
  assert.deepEqual(
    stay.selfStatusLine({ ...settled, activity: 'driving', address: null }),
    { status: 'At current location', lastSeen: 'In a vehicle' },
  );
  // No stay and no classification: moving, not arrived.
  assert.deepEqual(
    stay.selfStatusLine({ ...settled, activity: null, staySinceMs: null }),
    { status: 'At 506 Manhattan Drive', lastSeen: 'On the move' },
  );
  // Disabled or missing fix: no "At" line at all.
  assert.deepEqual(
    stay.selfStatusLine({ ...settled, locationEnabled: false }),
    { status: 'Location disabled', lastSeen: 'No live location' },
  );
  assert.deepEqual(
    stay.selfStatusLine({ ...settled, coordinate: null, staySinceMs: null, address: null }),
    { status: 'Location enabled', lastSeen: 'No live location' },
  );
});

test('failed buckets recover after the cooldown, never before', async () => {
  let nowMs = 1_000_000;
  let calls = 0;
  const resolver = stay.createAddressResolver(
    async () => {
      calls += 1;
      if (calls === 1) throw new Error('rate limited');
      return [{ streetNumber: '506', street: 'Manhattan Drive' }];
    },
    { now: () => nowMs, failureRetryMs: 60_000 },
  );
  const home = { latitude: 43.6532, longitude: -79.3832 };
  assert.equal(await resolver.resolve(home), null);
  assert.equal(calls, 1);
  nowMs += 59_999;
  assert.equal(await resolver.resolve(home), null);
  assert.equal(calls, 1);
  nowMs += 1;
  assert.equal(await resolver.resolve(home), '506 Manhattan Drive');
  assert.equal(calls, 2);
  // Success is permanent: far future, no new lookup.
  nowMs += 3_600_000;
  assert.equal(await resolver.resolve(home), '506 Manhattan Drive');
  assert.equal(calls, 2);
});

test('empty geocoder results recover after the cooldown', async () => {
  let nowMs = 0;
  let calls = 0;
  const resolver = stay.createAddressResolver(
    async () => {
      calls += 1;
      return calls === 1 ? [] : [{ street: 'Second Street' }];
    },
    { now: () => nowMs },
  );
  const coord = { latitude: 43.0, longitude: -79.0 };
  assert.equal(await resolver.resolve(coord), null);
  nowMs += stay.ADDRESS_FAILURE_RETRY_MS - 1;
  assert.equal(await resolver.resolve(coord), null);
  assert.equal(calls, 1);
  nowMs += 1;
  assert.equal(await resolver.resolve(coord), 'Second Street');
  assert.equal(calls, 2);
});

test('a slow failure cannot overwrite a newer success on another bucket', async () => {
  const releases = new Map();
  const resolver = stay.createAddressResolver(
    (coordinate) => new Promise((resolve) => { releases.set(stay.addressBucket(coordinate), resolve); }),
  );
  const a = { latitude: 43.0, longitude: -79.0 };
  const b = { latitude: 45.0, longitude: -79.0 };
  const pendingA = resolver.resolve(a);
  const pendingB = resolver.resolve(b);
  await new Promise((resolve) => setImmediate(resolve));
  releases.get(stay.addressBucket(b))([{ street: 'Second Street' }]);
  assert.equal(await pendingB, 'Second Street');
  releases.get(stay.addressBucket(a))(new Error('timeout'));
  assert.equal(await pendingA, null);
  assert.equal(await resolver.resolve(b), 'Second Street');
});

test('app address effect clears stale streets, retries on cooldown and cleans up', () => {
  const app = readFileSync(new URL('../App.tsx', import.meta.url), 'utf8');
  // Old address is cleared the moment the coordinate bucket changes.
  assert.match(app, /lastAddressBucket\.current = addressBucket\(coordinate\)/);
  assert.match(app, /setSelfAddress\(null\)/);
  // Retry is scheduled only for null results, after the resolver cooldown.
  assert.match(app, /ADDRESS_FAILURE_RETRY_MS/);
  assert.match(app, /if \(text == null\)/);
  // Disable/unmount/bucket change stops timers and ignores late resolutions.
  assert.match(app, /clearTimeout\(retryTimer\)/);
  // No retry storm on denied/disabled/web: the effect bails before scheduling.
  assert.match(app, /if \(!locationEnabled[^)]*\) return;/);
});
