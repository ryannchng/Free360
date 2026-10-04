export type Activity = 'stationary' | 'walking' | 'running' | 'biking' | 'driving';
export type Movement = { speed: number | null; activity: Activity | null; activitySource: 'sensor' | 'speed' | null };
export const MOVEMENT_MAX_AGE_MS = 90_000;
export const EMPTY_MOVEMENT: Movement = { speed: null, activity: null, activitySource: null };

export function validSpeed(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 100 ? value : null;
}

export function parseMovement(value: { speed?: unknown; activity?: unknown; activitySource?: unknown }): Movement {
  const speed = validSpeed(value.speed);
  const activity = ['stationary', 'walking', 'running', 'biking', 'driving'].includes(String(value.activity)) ? value.activity as Activity : null;
  const activitySource = activity && (value.activitySource === 'sensor' || value.activitySource === 'speed') ? value.activitySource : null;
  return { speed, activity: activitySource ? activity : null, activitySource };
}

type Fix = { latitude: number; longitude: number; accuracy: number | null; speed?: number | null; timestamp: number };
function accurate(fix: Fix) {
  return fix.accuracy !== null && Number.isFinite(fix.accuracy) && fix.accuracy >= 0 && fix.accuracy <= 50;
}

export function estimateSpeed(current: Fix, previous?: Fix): number | null {
  if (!accurate(current)) return null;
  const gps = validSpeed(current.speed);
  if (gps !== null) return gps;
  if (!previous || !accurate(previous)) return null;
  const seconds = (current.timestamp - previous.timestamp) / 1000;
  if (!Number.isFinite(seconds) || seconds < 3 || seconds > 120) return null;
  const radians = Math.PI / 180;
  const lat = (current.latitude - previous.latitude) * radians;
  const lon = (current.longitude - previous.longitude) * radians;
  const a = Math.sin(lat / 2) ** 2 + Math.cos(previous.latitude * radians) * Math.cos(current.latitude * radians) * Math.sin(lon / 2) ** 2;
  const distance = 6371000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(Math.max(0, 1 - a)));
  // Small displacements may be GPS drift; don't claim the person is moving or stopped.
  if (distance <= Math.max(5, current.accuracy! + previous.accuracy!)) return null;
  return validSpeed(distance / seconds);
}

type Motion = { timestamp: number; activities: Record<string, { detected: boolean; confidence: number }> };
export function detectMovement(speed: number | null, timestamp: number, motion?: Motion | null): Movement {
  if (motion && timestamp >= motion.timestamp && timestamp - motion.timestamp <= 60_000) {
    const types = [['automotive', 'driving'], ['cycling', 'biking'], ['running', 'running'], ['walking', 'walking'], ['stationary', 'stationary']] as const;
    for (const [key, activity] of types) {
      const state = motion.activities[key];
      if (state?.detected && state.confidence >= 1) return { speed, activity, activitySource: 'sensor' };
    }
  }
  if (speed === null) return { ...EMPTY_MOVEMENT };
  const kmh = speed * 3.6;
  return { speed, activity: kmh < 1 ? 'stationary' : kmh < 9 ? 'walking' : kmh < 35 ? 'biking' : 'driving', activitySource: 'speed' };
}

export function freshMovement(movement: Movement, recordedAt: string | undefined, now: number): Movement {
  const age = now - Date.parse(recordedAt ?? '');
  return Number.isFinite(age) && age >= -5000 && age <= MOVEMENT_MAX_AGE_MS ? movement : EMPTY_MOVEMENT;
}

/**
 * Stationary criterion for hiding movement indicators: the classified activity
 * is stationary (under 1 km/h by the speed fallback, GPS standstill, or a
 * confident stationary sensor reading). Speed value is irrelevant here — a
 * stationary member shows no pause icon or km/h bubble whether speed reads
 * zero or unknown. Unknown (null-activity) movement is not stationary.
 */
export function isStationaryMovement(movement: Movement | null | undefined): boolean {
  return movement?.activity === 'stationary';
}
