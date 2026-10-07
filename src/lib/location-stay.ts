// Pure, testable current-place status: stay tracking, "since" labels, street
// addresses and the self status line. No React Native imports.
//
// "Since" semantics (observation-based approximation, never exact verified
// arrival): a stay starts at the timestamp of the first fix observed within
// GPS-noise tolerance of its anchor point and ends when a later fix lands
// outside that tolerance. Moving fixes (classified walking/running/biking/
// driving) clear the stay so travel never reads as arrival; the next
// stationary fix starts a fresh stay. Across app restarts the persisted stay
// is re-adopted only when the new fix is still within tolerance of it.

import { isValidCoordinate, type LatLng } from './map-region';

/** Radius floor for belonging to the same stay; poor accuracy widens it. */
export const STAY_RADIUS_M = 150;

/** Scoped SecureStore key for the self stay (tiny JSON, survives restarts). */
export const SELF_STAY_KEY = 'free360.self-stay.v1';

export type StayFix = {
  latitude: number;
  longitude: number;
  /** Fix time as epoch milliseconds. */
  timestamp: number;
  /** Meters, or null when the fix carries no accuracy. */
  accuracy: number | null;
  /** True when the fix is classified as moving (not stationary/unknown). */
  moving: boolean;
};

export type StayState = {
  latitude: number;
  longitude: number;
  accuracy: number | null;
  /** Epoch milliseconds of the first fix observed in this stay. */
  sinceMs: number;
} | null;

export function haversineM(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const radians = Math.PI / 180;
  const dLat = (bLat - aLat) * radians;
  const dLng = (bLng - aLng) * radians;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(aLat * radians) * Math.cos(bLat * radians) * Math.sin(dLng / 2) ** 2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(Math.max(0, 1 - a)));
}

function validFix(fix: StayFix): boolean {
  return (
    isValidCoordinate({ latitude: fix.latitude, longitude: fix.longitude }) &&
    Number.isFinite(fix.timestamp)
  );
}

/**
 * Fold one fix into the stay. Moving fixes clear the stay; the first fix (or
 * the first after travel) starts a new one; fixes inside tolerance keep the
 * original start so "since" never becomes the latest GPS timestamp.
 */
export function updateStay(state: StayState, fix: StayFix): StayState {
  if (!validFix(fix)) return state;
  if (fix.moving) return null;
  if (!state) {
    return { latitude: fix.latitude, longitude: fix.longitude, accuracy: fix.accuracy, sinceMs: fix.timestamp };
  }
  if (fix.timestamp < state.sinceMs) return state;
  const tolerance = Math.max(STAY_RADIUS_M, (state.accuracy ?? 0) + (fix.accuracy ?? 0));
  if (haversineM(state.latitude, state.longitude, fix.latitude, fix.longitude) <= tolerance) return state;
  return { latitude: fix.latitude, longitude: fix.longitude, accuracy: fix.accuracy, sinceMs: fix.timestamp };
}

/** Validate a persisted stay before re-adopting it after a restart. */
export function parseStay(raw: unknown): StayState {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const candidate = raw as { latitude?: unknown; longitude?: unknown; accuracy?: unknown; sinceMs?: unknown };
  if (!isValidCoordinate({ latitude: candidate.latitude, longitude: candidate.longitude })) return null;
  if (typeof candidate.sinceMs !== 'number' || !Number.isFinite(candidate.sinceMs)) return null;
  const accuracy = candidate.accuracy;
  return {
    latitude: candidate.latitude as number,
    longitude: candidate.longitude as number,
    accuracy: typeof accuracy === 'number' && Number.isFinite(accuracy) && accuracy >= 0 ? accuracy : null,
    sinceMs: candidate.sinceMs,
  };
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function time12h(date: Date): string {
  let hours = date.getHours();
  const suffix = hours < 12 ? 'AM' : 'PM';
  hours %= 12;
  if (hours === 0) hours = 12;
  return `${hours}:${String(date.getMinutes()).padStart(2, '0')} ${suffix}`;
}

function dayLabel(since: Date, now: Date): string {
  if (
    since.getFullYear() === now.getFullYear() &&
    since.getMonth() === now.getMonth() &&
    since.getDate() === now.getDate()
  ) {
    return 'today';
  }
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  if (
    since.getFullYear() === yesterday.getFullYear() &&
    since.getMonth() === yesterday.getMonth() &&
    since.getDate() === yesterday.getDate()
  ) {
    return 'yesterday';
  }
  const dated = `${MONTHS[since.getMonth()]} ${since.getDate()}`;
  return since.getFullYear() === now.getFullYear() ? dated : `${dated}, ${since.getFullYear()}`;
}

/** Local 12-hour label, e.g. "since 3:24 PM today". Future starts clamp to now. */
export function sinceLabel(sinceMs: number, nowMs: number): string {
  const start = new Date(Math.min(sinceMs, nowMs));
  const now = new Date(nowMs);
  return `since ${time12h(start)} ${dayLabel(start, now)}`;
}

/** Elapsed observed stay for the map bubble; unknown times never become zero. */
export function stayDurationLabel(sinceMs: number | null | undefined, nowMs: number): string | null {
  if (sinceMs == null || !Number.isFinite(sinceMs) || !Number.isFinite(nowMs) || nowMs <= 0) return null;
  const minutes = Math.floor(Math.max(0, nowMs - sinceMs) / 60000);
  if (minutes === 0) return 'Less than a minute';
  if (minutes < 60) return `${minutes} ${minutes === 1 ? 'min' : 'mins'}`;
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return `${hours} ${hours === 1 ? 'hr' : 'hrs'}${remainder ? `, ${remainder} ${remainder === 1 ? 'min' : 'mins'}` : ''}`;
}

/** Consecutive observations at the current place, bounded by gaps in history. */
export function observedStaySince(points: readonly (LatLng & { recordedAt: string })[]): number | null {
  const ordered = points.filter(point => isValidCoordinate(point) && Number.isFinite(Date.parse(point.recordedAt)))
    .toSorted((a, b) => Date.parse(b.recordedAt) - Date.parse(a.recordedAt));
  const latest = ordered[0];
  if (!latest) return null;
  let since = Date.parse(latest.recordedAt);
  for (const point of ordered.slice(1)) {
    const time = Date.parse(point.recordedAt);
    if (since - time > 10 * 60 * 1000 || haversineM(latest.latitude, latest.longitude, point.latitude, point.longitude) > STAY_RADIUS_M) break;
    since = time;
  }
  return since;
}

export type AddressParts = {
  streetNumber?: unknown;
  street?: unknown;
  city?: unknown;
};

function cleanText(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

/**
 * Best-effort street address, never falsely guaranteed: "506 Manhattan
 * Drive", then street alone, then city alone, else null. Structured fields
 * only — provider POI names are ignored so a venue never reads as an address.
 */
export function formatAddress(parts: AddressParts | null | undefined): string | null {
  if (!parts) return null;
  const street = cleanText(parts.street);
  if (street) {
    const number = cleanText(parts.streetNumber);
    return number ? `${number} ${street}` : street;
  }
  return cleanText(parts.city);
}

/** Cache bucket (~110m) so GPS jitter does not repeat native lookups. */
export function addressBucket(coordinate: LatLng): string {
  return `${coordinate.latitude.toFixed(3)},${coordinate.longitude.toFixed(3)}`;
}

/**
 * Cooldown before a failed/empty bucket is looked up again. Stationary
 * recovery depends on this: without it a null stays cached forever and the
 * row can never leave "current location".
 */
export const ADDRESS_FAILURE_RETRY_MS = 60_000;

export type AddressLookup = (coordinate: LatLng) => Promise<AddressParts[] | null | undefined>;

/**
 * Native lookup with per-bucket caching, in-flight sharing and failure
 * capture. Successes stay cached permanently; failures/empty results are
 * served from cache only until the retry cooldown elapses, then looked up
 * again, so an initial error can recover to a real address on the same
 * bucket. Each call resolves its own bucket, so overlapping lookups cannot
 * cross-contaminate; callers ignore results for superseded buckets.
 */
export function createAddressResolver(
  lookup: AddressLookup,
  options?: { maxEntries?: number; failureRetryMs?: number; now?: () => number },
) {
  const maxEntries = options?.maxEntries ?? 50;
  const failureRetryMs = options?.failureRetryMs ?? ADDRESS_FAILURE_RETRY_MS;
  const now = options?.now ?? Date.now;
  const cache = new Map<string, { text: string | null; failedAt: number | null }>();
  const inflight = new Map<string, Promise<string | null>>();
  function remember(bucket: string, text: string | null): string | null {
    cache.set(bucket, { text, failedAt: text === null ? now() : null });
    while (cache.size > maxEntries) {
      const oldest = cache.keys().next();
      if (oldest.done) break;
      cache.delete(oldest.value);
    }
    return text;
  }
  return {
    resolve(coordinate: LatLng): Promise<string | null> {
      const bucket = addressBucket(coordinate);
      const cached = cache.get(bucket);
      if (cached !== undefined) {
        if (cached.text !== null || now() - (cached.failedAt ?? 0) < failureRetryMs) {
          return Promise.resolve(cached.text);
        }
      }
      const running = inflight.get(bucket);
      if (running) return running;
      const task = Promise.resolve()
        .then(() => lookup(coordinate))
        .then((results) => formatAddress(Array.isArray(results) ? results[0] : null))
        .catch(() => null)
        .then((text) => {
          inflight.delete(bucket);
          return remember(bucket, text);
        });
      inflight.set(bucket, task);
      return task;
    },
    cacheSize(): number {
      return cache.size;
    },
  };
}

export type SelfStatusInput = {
  locationEnabled: boolean;
  coordinate: LatLng | null;
  /** Classified activity of the current movement, if any. */
  activity: 'stationary' | 'walking' | 'running' | 'biking' | 'driving' | null;
  staySinceMs: number | null;
  address: string | null;
  nowMs: number;
};

const MOVING_LABELS = { walking: 'Walking', running: 'Running', biking: 'Biking', driving: 'In a vehicle' } as const;

/**
 * Bottom-map self row copy. Only the enabled-with-fix branch shows "At";
 * disabled, missing-fix and moving states never claim a stationary arrival.
 */
export function selfStatusLine(input: SelfStatusInput): { status: string; lastSeen: string } {
  if (!input.locationEnabled) return { status: 'Location disabled', lastSeen: 'No live location' };
  if (!input.coordinate) return { status: 'Location enabled', lastSeen: 'No live location' };
  const status = `At ${input.address ?? 'current location'}`;
  if (input.activity && input.activity !== 'stationary') return { status, lastSeen: MOVING_LABELS[input.activity] };
  if (input.staySinceMs == null) return { status, lastSeen: 'On the move' };
  return { status, lastSeen: sinceLabel(input.staySinceMs, input.nowMs) };
}
