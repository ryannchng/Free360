// Pure, UI-agnostic snap/height decisions for the draggable map member sheet.
// No React Native imports so this file is unit-testable with plain node.
//
// Model: the sheet rests at a collapsed ("half", ~52% of the map container)
// height and can be dragged up to an expanded height. The expanded height is
// bounded so the member top header stays accessible and a short exposed map
// strip remains above the sheet. Dragging down only snaps back to collapsed;
// it never dismisses (close stays on the header back button).

/** Collapsed sheet height as a fraction of the map container height. */
export const MEMBER_SHEET_COLLAPSED_FRACTION = 0.52;

/** Ideal expanded sheet height as a fraction of the map container height. */
export const MEMBER_SHEET_EXPANDED_FRACTION = 0.85;

/**
 * Vertical reserve (px) kept above an expanded sheet: room for the floating
 * member header plus a short exposed map strip so the map stays pannable.
 */
export const MEMBER_SHEET_TOP_RESERVE_PX = 156;

/** Minimum expanded-minus-collapsed gap (px) for expansion to be offered. */
export const MEMBER_SHEET_MIN_EXPAND_DELTA_PX = 96;

/** Drag distance (px) past which release snaps to the other state. */
export const MEMBER_SHEET_SNAP_DRAG_THRESHOLD_PX = 48;

/**
 * Fling velocity (px/ms, matches PanResponder gestureState vx/vy units) past
 * which release snaps in the fling direction regardless of distance.
 */
export const MEMBER_SHEET_FLING_VELOCITY = 0.5;

export type MemberSheetHeights = { collapsed: number; expanded: number };

/** Circle list: rest low to expose more map, expand below the map header. */
export function resolveCircleSheetHeights(
    containerHeight: number,
    topInset: number,
): MemberSheetHeights {
    if (!Number.isFinite(containerHeight) || containerHeight <= 0) {
        return { collapsed: 280, expanded: 280 };
    }
    const safeTop = Number.isFinite(topInset) && topInset > 0 ? topInset : 0;
    const collapsed = Math.min(
        Math.max(280, containerHeight * 0.34),
        containerHeight * 0.6,
    );
    const available = Math.min(
        containerHeight * 0.88,
        containerHeight - safeTop - 84,
    );
    const expanded = available - collapsed >= 24 ? available : collapsed;
    return { collapsed, expanded };
}

/**
 * Resolve collapsed/expanded sheet heights (px) for the actual map container
 * height and top safe-area inset. The expanded height is the smaller of the
 * ideal fraction and the container minus the top reserve, so the header and
 * an exposed map strip survive expansion on any container/orientation. On
 * degenerate containers the two snaps coincide (callers then offer no drag).
 */
export function resolveMemberSheetHeights(
    containerHeight: number,
    topInset: number,
): MemberSheetHeights {
    if (!Number.isFinite(containerHeight) || containerHeight <= 0) {
        return { collapsed: 0, expanded: 0 };
    }
    const safeTop = Number.isFinite(topInset) && topInset > 0 ? topInset : 0;
    const collapsed = Math.round(
        containerHeight * MEMBER_SHEET_COLLAPSED_FRACTION,
    );
    const desired = Math.round(
        containerHeight * MEMBER_SHEET_EXPANDED_FRACTION,
    );
    const bounded = Math.min(
        desired,
        containerHeight - safeTop - MEMBER_SHEET_TOP_RESERVE_PX,
    );
    if (bounded - collapsed < MEMBER_SHEET_MIN_EXPAND_DELTA_PX) {
        return { collapsed, expanded: collapsed };
    }
    return { collapsed, expanded: Math.round(bounded) };
}

/** Clamp a live drag height into the current snap range. */
export function clampMemberSheetHeight(
    value: number,
    collapsed: number,
    expanded: number,
): number {
    if (!Number.isFinite(value)) return collapsed;
    if (value < collapsed) return collapsed;
    if (value > expanded) return expanded;
    return value;
}

export type MemberSheetSnapInput = {
    /** Snap state at drag start. */
    expanded: boolean;
    /** Accumulated gesture dy (px, negative = dragged up). */
    dragDy: number;
    /** Release velocity vy (px/ms, negative = upward fling). */
    velocityY: number;
};

/**
 * Release decision: fast flings win over distance; past the drag threshold
 * the sheet changes state, otherwise it springs back to the start state.
 * Non-finite input keeps the current state (safe no-op).
 */
export function nextMemberSheetExpanded(input: MemberSheetSnapInput): boolean {
    const { expanded, dragDy, velocityY } = input;
    if (!Number.isFinite(dragDy) || !Number.isFinite(velocityY))
        return expanded;
    if (velocityY <= -MEMBER_SHEET_FLING_VELOCITY) return true;
    if (velocityY >= MEMBER_SHEET_FLING_VELOCITY) return false;
    if (dragDy <= -MEMBER_SHEET_SNAP_DRAG_THRESHOLD_PX) return true;
    if (dragDy >= MEMBER_SHEET_SNAP_DRAG_THRESHOLD_PX) return false;
    return expanded;
}
