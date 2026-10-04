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

/** Geographic bounding box in degrees. */
export type FitBounds = { south: number; north: number; west: number; east: number };

/** Bounding box of every usable coordinate, or null when there is nothing to frame. */
export function groupFitBounds(coordinates: readonly unknown[]): FitBounds | null {
  let south = Infinity, north = -Infinity, west = Infinity, east = -Infinity;
  let count = 0;
  for (const value of coordinates) {
    if (!isValidCoordinate(value)) continue;
    count += 1;
    if (value.latitude < south) south = value.latitude;
    if (value.latitude > north) north = value.latitude;
    if (value.longitude < west) west = value.longitude;
    if (value.longitude > east) east = value.longitude;
  }
  if (count === 0) return null;
  return { south, north, west, east };
}

/**
 * Region that centers and fits every usable coordinate: the span zooms out
 * for far-apart members, while a single (or coincident) member falls back to
 * the bounded near delta instead of zooming to the maximum. A 20% margin
 * keeps edge markers off the exact viewport edge. Returns null when there is
 * nothing to frame so callers never reset to a default view.
 */
export function regionForCoordinates(coordinates: readonly unknown[]): Region | null {
  const bounds = groupFitBounds(coordinates);
  if (!bounds) return null;
  const latitudeDelta = Math.max((bounds.north - bounds.south) * 1.2, MAP_NEAR_DELTA);
  const longitudeDelta = Math.max((bounds.east - bounds.west) * 1.2, MAP_NEAR_DELTA);
  return {
    latitude: (bounds.south + bounds.north) / 2,
    longitude: (bounds.west + bounds.east) / 2,
    latitudeDelta,
    longitudeDelta,
  };
}

/** Bounding box described by a region (inverse of regionForCoordinates framing). */
export function boundsForRegion(region: Region): FitBounds {
  return {
    south: region.latitude - region.latitudeDelta / 2,
    north: region.latitude + region.latitudeDelta / 2,
    west: region.longitude - region.longitudeDelta / 2,
    east: region.longitude + region.longitudeDelta / 2,
  };
}

/**
 * True when the group has a usable coordinate that falls outside the last
 * fitted view (expanded by `marginFrac` of its span as hysteresis, so edge
 * jitter does not flap). A null fit means nothing has been framed yet, so any
 * non-empty group needs framing; an empty group never needs framing.
 */
export function isGroupOutsideFit(
  coordinates: readonly unknown[],
  fit: FitBounds | null,
  marginFrac = 0.1,
): boolean {
  const bounds = groupFitBounds(coordinates);
  if (!bounds) return false;
  if (!fit) return true;
  const latMargin = Math.max((fit.north - fit.south) * marginFrac, MAP_NEAR_DELTA * marginFrac);
  const lngMargin = Math.max((fit.east - fit.west) * marginFrac, MAP_NEAR_DELTA * marginFrac);
  return (
    bounds.south < fit.south - latMargin ||
    bounds.north > fit.north + latMargin ||
    bounds.west < fit.west - lngMargin ||
    bounds.east > fit.east + lngMargin
  );
}
