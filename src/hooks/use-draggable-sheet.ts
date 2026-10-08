import { useCallback, useEffect, useRef, useState } from "react";
import {
    Animated,
    Easing,
    PanResponder,
    type PanResponderInstance,
} from "react-native";
import {
    clampMemberSheetHeight,
    nextMemberSheetExpanded,
    type MemberSheetHeights,
} from "../lib/member-sheet";

export function useDraggableSheet({ collapsed, expanded }: MemberSheetHeights) {
    const [height] = useState(() => new Animated.Value(collapsed));
    const [isExpanded, setIsExpanded] = useState(false);
    const [settledHeight, setSettledHeight] = useState(collapsed);
    const [panResponder, setPanResponder] =
        useState<PanResponderInstance | null>(null);
    const bounds = useRef({ collapsed, expanded });
    const expandedRef = useRef(false);
    const liveHeight = useRef(collapsed);
    const dragStart = useRef(collapsed);
    const animation = useRef<Animated.CompositeAnimation | null>(null);
    const canExpand = expanded > collapsed;

    useEffect(() => {
        const listener = height.addListener(({ value }) => {
            liveHeight.current = value;
        });
        return () => {
            height.removeListener(listener);
        };
    }, [height]);

    // First measurement and rotation preserve the selected snap with fresh bounds.
    useEffect(() => {
        animation.current?.stop();
        animation.current = null;
        bounds.current = { collapsed, expanded };
        expandedRef.current = expandedRef.current && expanded > collapsed;
        const target = expandedRef.current ? expanded : collapsed;
        liveHeight.current = target;
        dragStart.current = target;
        height.setValue(target);
        setIsExpanded(expandedRef.current);
        setSettledHeight(target);
    }, [collapsed, expanded, height]);

    useEffect(
        () => () => {
            animation.current?.stop();
            animation.current = null;
        },
        [],
    );

    const snapTo = useCallback(
        (expand: boolean) => {
            const snaps = bounds.current;
            const nextExpanded = expand && snaps.expanded > snaps.collapsed;
            const target = nextExpanded ? snaps.expanded : snaps.collapsed;
            animation.current?.stop();
            expandedRef.current = nextExpanded;
            setIsExpanded(nextExpanded);
            const next = Animated.timing(height, {
                toValue: target,
                duration: 240,
                easing: Easing.out(Easing.cubic),
                useNativeDriver: false,
            });
            animation.current = next;
            next.start(({ finished }) => {
                if (finished && animation.current === next) {
                    animation.current = null;
                    // Update map padding once per snap, not on every gesture frame.
                    setSettledHeight(target);
                }
            });
        },
        [height],
    );

    const toggle = useCallback(() => snapTo(!expandedRef.current), [snapTo]);

    useEffect(() => {
        const shouldDrag = (_: unknown, gesture: { dx: number; dy: number }) =>
            bounds.current.expanded > bounds.current.collapsed &&
            Math.abs(gesture.dy) > 6 &&
            Math.abs(gesture.dy) > Math.abs(gesture.dx);
        setPanResponder(
            PanResponder.create({
                onStartShouldSetPanResponder: () => false,
                onMoveShouldSetPanResponder: shouldDrag,
                onMoveShouldSetPanResponderCapture: shouldDrag,
                onPanResponderGrant: () => {
                    // Re-grabbing during a snap continues from the visible height.
                    animation.current?.stop();
                    animation.current = null;
                    dragStart.current = liveHeight.current;
                },
                onPanResponderMove: (_, gesture) => {
                    const snaps = bounds.current;
                    height.setValue(
                        clampMemberSheetHeight(
                            dragStart.current - gesture.dy,
                            snaps.collapsed,
                            snaps.expanded,
                        ),
                    );
                },
                onPanResponderRelease: (_, gesture) => {
                    snapTo(
                        nextMemberSheetExpanded({
                            expanded: expandedRef.current,
                            dragDy: gesture.dy,
                            velocityY: gesture.vy,
                        }),
                    );
                },
                onPanResponderTerminationRequest: () => true,
                onPanResponderTerminate: () => snapTo(expandedRef.current),
            }),
        );
    }, [height, snapTo]);

    return {
        height,
        settledHeight,
        isExpanded,
        canExpand,
        panHandlers: panResponder?.panHandlers ?? {},
        snapTo,
        toggle,
    };
}
