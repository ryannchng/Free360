// Pure, testable map-region helpers. No React Native imports.

export type LatLng = { latitude: number; longitude: number };
export type Region = LatLng & { latitudeDelta: number; longitudeDelta: number };

export const MAP_NEAR_DELTA = 0.024;
/** Broad fallback so the map always has something sane to show (continental US view). */
export const MAP_FALLBACK_REGION: Region = {
  latitude: 39.5,
  longitude: -98.35,
  latitudeDelta: 45,
  longitudeDelta: 45,
};

export function isValidCoordinate(value: unknown): value is LatLng {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const candidate = value as { latitude?: unknown; longitude?: unknown };
  return (
    typeof candidate.latitude === 'number' &&
    Number.isFinite(candidate.latitude) &&
    Math.abs(candidate.latitude) <= 90 &&
    typeof candidate.longitude === 'number' &&
    Number.isFinite(candidate.longitude) &&
    Math.abs(candidate.longitude) <= 180
  );
}

export function firstValidCoordinate(values: readonly unknown[]): LatLng | null {
  for (const value of values) {
    if (isValidCoordinate(value)) return { latitude: value.latitude, longitude: value.longitude };
  }
  return null;
}

export type MapCenterInput = {
  /** Live device coordinate (only honoured when sharing is enabled). */
  currentCoordinate?: unknown;
  locationEnabled?: boolean;
  /** Ordered shared member coordinates; first valid wins. */
  sharedCoordinates?: readonly unknown[];
  /** Saved home coordinate (no location request needed to show it). */
  home?: unknown;
};

export type MapCenterResult = { center: LatLng; source: 'live' | 'shared' | 'home' | 'fallback' };

/**
 * Priority: live device location (when sharing) -> first valid shared member location
 * -> saved home -> broad fallback. Never requests/enables location; purely derives
 * from already-available values.
 */
export function resolveMapCenter(input: MapCenterInput): MapCenterResult {
  const { currentCoordinate, locationEnabled, sharedCoordinates, home } = input;
  if (locationEnabled && isValidCoordinate(currentCoordinate)) {
    return {
      center: { latitude: currentCoordinate.latitude, longitude: currentCoordinate.longitude },
      source: 'live',
    };
  }
  const shared = firstValidCoordinate(sharedCoordinates ?? []);
  if (shared) return { center: shared, source: 'shared' };
  if (isValidCoordinate(home)) {
    return { center: { latitude: home.latitude, longitude: home.longitude }, source: 'home' };
  }
  return {
    center: { latitude: MAP_FALLBACK_REGION.latitude, longitude: MAP_FALLBACK_REGION.longitude },
    source: 'fallback',
  };
}

/** Expand a center into a renderable region. Fallback uses a broad delta, real locations use near delta. */
export function regionForCenter(center: LatLng, source: MapCenterResult['source']): Region {
  if (source === 'fallback') return { ...MAP_FALLBACK_REGION };
  return { ...center, latitudeDelta: MAP_NEAR_DELTA, longitudeDelta: MAP_NEAR_DELTA };
}

/** Convenience: resolve center + region in one call. */
export function resolveInitialRegion(input: MapCenterInput): Region & { source: MapCenterResult['source'] } {
  const resolved = resolveMapCenter(input);
  return { ...regionForCenter(resolved.center, resolved.source), source: resolved.source };
}
