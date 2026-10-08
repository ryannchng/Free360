import { COLORS, FONTS } from "../theme";
import {
    forwardRef,
    useCallback,
    useEffect,
    useImperativeHandle,
    useRef,
    useState,
} from "react";
import { Linking, StyleSheet, Text, View } from "react-native";
import { WebView } from "react-native-webview";
import type { LatLng, Region } from "../lib/map-region";
import { isValidCoordinate } from "../lib/map-region";
import {
    decideViewCommand,
    initialAutoFrameState,
    markInteracted,
    requestFitGroup,
    type AutoFrameState,
} from "../lib/map-autoframe";
import { OPENSTREETMAP_HTML } from "../lib/openstreetmap-document";

export type MapMember = {
    id: string;
    coordinate: LatLng;
    name: string;
    initials: string;
    color: string;
    avatar: unknown;
    stale: boolean;
    battery?: number | null;
    movement: string;
    description: string;
    stayDuration?: string | null;
};
export type MapData = {
    members: MapMember[];
    homes: { coordinate: LatLng; name: string }[];
    trail: LatLng[];
    trailColor: string;
    bottomInset?: number;
    topInset?: number;
    highlightedMemberId?: string;
};
export type OpenStreetMapHandle = { fitGroup: () => void };
export type MapCommand =
    | { type: "render"; data: MapData }
    | { type: "center"; region: Region }
    | { type: "trail"; coordinates: LatLng[] };
export type MapMessage =
    { type: "ready" } | { type: "member"; id: string } | { type: "interacted" };
export type OpenStreetMapProps = {
    data: MapData;
    onOpenMember: (id: string) => void;
};
const SOURCE = { html: OPENSTREETMAP_HTML, baseUrl: "https://free360.local/" };

function validCoordinates(values: readonly LatLng[]): LatLng[] {
    return values.filter(isValidCoordinate);
}

export const OpenStreetMap = forwardRef<
    OpenStreetMapHandle,
    OpenStreetMapProps
>(function OpenStreetMap({ data, onOpenMember }, ref) {
    const webview = useRef<WebView>(null);
    const [ready, setReady] = useState(false);
    const [failed, setFailed] = useState(false);
    const frame = useRef<AutoFrameState>(initialAutoFrameState);
    const readyRef = useRef(ready);
    readyRef.current = ready;
    const dataRef = useRef(data);
    dataRef.current = data;
    const send = useCallback((command: MapCommand) => {
        webview.current?.injectJavaScript(
            `window.free360Receive && window.free360Receive(${JSON.stringify(command)}); true;`,
        );
    }, []);
    const applyView = useCallback(() => {
        const decided = decideViewCommand(frame.current, {
            ready: readyRef.current,
            members: validCoordinates(
                dataRef.current.members.map((member) => member.coordinate),
            ),
            trail: validCoordinates(dataRef.current.trail),
        });
        frame.current = decided.state;
        if (decided.command.kind === "center")
            send({ type: "center", region: decided.command.region });
        else if (decided.command.kind === "trail")
            send({ type: "trail", coordinates: decided.command.coordinates });
    }, [send]);
    const applyViewRef = useRef(applyView);
    applyViewRef.current = applyView;
    useImperativeHandle(
        ref,
        () => ({
            fitGroup: () => {
                frame.current = requestFitGroup(frame.current);
                applyViewRef.current();
            },
        }),
        [],
    );
    const payload = JSON.stringify(data);
    const trail = JSON.stringify(data.trail);
    useEffect(() => {
        if (ready) send({ type: "render", data: JSON.parse(payload) });
    }, [ready, payload, send]);
    useEffect(() => {
        applyView();
    }, [ready, payload, trail, applyView]);
    return (
        <View style={StyleSheet.absoluteFill}>
            <WebView
                ref={webview}
                style={styles.map}
                source={SOURCE}
                originWhitelist={["*"]}
                applicationNameForUserAgent="Free360/1.0"
                javaScriptEnabled
                domStorageEnabled={false}
                setSupportMultipleWindows={false}
                onShouldStartLoadWithRequest={({ url }) => {
                    if (url === "https://www.openstreetmap.org/copyright")
                        void Linking.openURL(url).catch(() => {});
                    return url === "about:blank" || url === SOURCE.baseUrl;
                }}
                onLoadStart={() => {
                    setReady(false);
                    setFailed(false);
                }}
                onError={() => setFailed(true)}
                onMessage={({ nativeEvent }) => {
                    try {
                        const message: MapMessage = JSON.parse(
                            nativeEvent.data,
                        );
                        if (message.type === "ready") setReady(true);
                        if (message.type === "interacted")
                            frame.current = markInteracted(frame.current);
                        if (
                            message.type === "member" &&
                            typeof message.id === "string"
                        )
                            onOpenMember(message.id);
                    } catch {
                        /* Ignore malformed messages. */
                    }
                }}
            />
            {failed && (
                <View style={styles.error}>
                    <Text style={styles.errorText}>
                        Map unavailable. Check your connection and reopen the
                        map.
                    </Text>
                </View>
            )}
        </View>
    );
});

const styles = StyleSheet.create({
    errorText: {
        fontFamily: FONTS.regular,
        color: COLORS.muted,
        textAlign: "center",
    },
    map: { flex: 1, backgroundColor: COLORS.mapLand },
    error: {
        position: "absolute",
        inset: 0,
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
        backgroundColor: COLORS.mapLand,
    },
});
