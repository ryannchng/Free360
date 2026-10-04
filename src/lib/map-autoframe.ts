// Pure, testable auto-framing policy for the map view. No React Native imports.
//
// Policy:
// - Markers always re-render on data updates; the *view* only moves when this
//   module emits a fit command, so routine location updates never reset it.
// - While auto-framing is active, the first valid group is fitted to include
//   every member, and later fits happen only when a member leaves the last
//   fitted view (roster growth, far moves, delayed first locations).
// - Any genuine user pan/zoom (reported by the map document) suspends
//   auto-framing; the existing recenter control resumes it via requestFitGroup.
// - An explicitly shown trail is a focused view: it fits once when shown,
//   suspends auto-framing while visible, and on hide restores the prior mode
//   (refitting the group only if auto-framing was active before).

import {
  boundsForRegion,
  groupFitBounds,
  isGroupOutsideFit,
  regionForCoordinates,
  type FitBounds,
  type LatLng,
  type Region,
} from './map-region';

export type AutoFrameState = {
  /** False after the user pans/zooms manually; true again after recenter. */
  autoFrame: boolean;
  /** View box of the last emitted fit; null until the first fit. */
  lastFit: FitBounds | null;
  /** Trail coordinate key of the last emitted trail fit. */
  lastTrailKey: string | null;
  /** Whether the trail view is currently shown. */
  trailActive: boolean;
  /** Auto-framing mode to restore when the trail view hides. */
  preTrailAuto: boolean;
};

export const initialAutoFrameState: AutoFrameState = {
  autoFrame: true,
  lastFit: null,
  lastTrailKey: null,
  trailActive: false,
  preTrailAuto: true,
};

export type ViewFitCommand =
  | { kind: 'none' }
  | { kind: 'center'; region: Region }
  | { kind: 'trail'; coordinates: LatLng[] };

export function trailKeyFor(coordinates: readonly LatLng[]): string {
  return JSON.stringify(coordinates);
}

export function decideViewCommand(
  state: AutoFrameState,
  input: { ready: boolean; members: readonly LatLng[]; trail: readonly LatLng[] },
): { command: ViewFitCommand; state: AutoFrameState } {
  if (!input.ready) return { command: { kind: 'none' }, state };
  const trailKey = trailKeyFor(input.trail);
  if (input.trail.length > 1) {
    if (state.lastTrailKey === trailKey) return { command: { kind: 'none' }, state };
    return {
      command: { kind: 'trail', coordinates: [...input.trail] },
      state: {
        ...state,
        autoFrame: false,
        lastFit: groupFitBounds(input.trail),
        lastTrailKey: trailKey,
        trailActive: true,
        preTrailAuto: state.trailActive ? state.preTrailAuto : state.autoFrame,
      },
    };
  }
  let next = state.trailActive
    ? { ...state, trailActive: false, lastTrailKey: null, autoFrame: state.preTrailAuto, lastFit: state.preTrailAuto ? null : state.lastFit }
    : state;
  if (!next.autoFrame) return { command: { kind: 'none' }, state: next };
  const group = regionForCoordinates(input.members);
  if (!group) return { command: { kind: 'none' }, state: next };
  if (next.lastFit && !isGroupOutsideFit(input.members, next.lastFit)) {
    return { command: { kind: 'none' }, state: next };
  }
  next = { ...next, lastFit: boundsForRegion(group) };
  return { command: { kind: 'center', region: group }, state: next };
}

/** A genuine user pan/zoom suspends auto-framing; programmatic fits never call this. */
export function markInteracted(state: AutoFrameState): AutoFrameState {
  if (!state.autoFrame) return state;
  return { ...state, autoFrame: false };
}

/** The existing recenter control resumes auto-framing and forces a group fit. */
export function requestFitGroup(state: AutoFrameState): AutoFrameState {
  return { ...state, autoFrame: true, lastFit: null };
}
