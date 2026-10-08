import {
    forwardRef,
    useCallback,
    useEffect,
    useImperativeHandle,
    useRef,
    useState,
} from "react";
import { OPENSTREETMAP_HTML } from "../lib/openstreetmap-document";
import { isValidCoordinate } from "../lib/map-region";
import {
    decideViewCommand,
    initialAutoFrameState,
    markInteracted,
    requestFitGroup,
    type AutoFrameState,
} from "../lib/map-autoframe";
import type {
    MapCommand,
    MapMessage,
    OpenStreetMapHandle,
    OpenStreetMapProps,
} from "./OpenStreetMap";
import type { LatLng } from "../lib/map-region";

function validCoordinates(values: readonly LatLng[]): LatLng[] {
    return values.filter(isValidCoordinate);
}

export const OpenStreetMap = forwardRef<
    OpenStreetMapHandle,
    OpenStreetMapProps
>(function OpenStreetMap({ data, onOpenMember }, ref) {
    const frame = useRef<HTMLIFrameElement>(null);
    const [ready, setReady] = useState(false);
    const view = useRef<AutoFrameState>(initialAutoFrameState);
    const readyRef = useRef(ready);
    readyRef.current = ready;
    const dataRef = useRef(data);
    dataRef.current = data;
    const send = useCallback((command: MapCommand) => {
        frame.current?.contentWindow?.postMessage(
            { free360Command: command },
            "*",
        );
    }, []);
    const applyView = useCallback(() => {
        const decided = decideViewCommand(view.current, {
            ready: readyRef.current,
            members: validCoordinates(
                dataRef.current.members.map((member) => member.coordinate),
            ),
            trail: validCoordinates(dataRef.current.trail),
        });
        view.current = decided.state;
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
                view.current = requestFitGroup(view.current);
                applyViewRef.current();
            },
        }),
        [],
    );
    useEffect(() => {
        const receive = (event: MessageEvent) => {
            if (event.source !== frame.current?.contentWindow) return;
            const message: MapMessage | undefined = event.data?.free360Map;
            if (message?.type === "ready") setReady(true);
            if (message?.type === "interacted")
                view.current = markInteracted(view.current);
            if (message?.type === "member" && typeof message.id === "string")
                onOpenMember(message.id);
        };
        window.addEventListener("message", receive);
        return () => window.removeEventListener("message", receive);
    }, [onOpenMember]);
    const payload = JSON.stringify(data);
    const trail = JSON.stringify(data.trail);
    useEffect(() => {
        if (ready) send({ type: "render", data: JSON.parse(payload) });
    }, [ready, payload, send]);
    useEffect(() => {
        applyView();
    }, [ready, payload, trail, applyView]);
    return (
        <iframe
            ref={frame}
            title="Circle locations on OpenStreetMap"
            srcDoc={OPENSTREETMAP_HTML}
            onLoad={() => setReady(true)}
            sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox"
            style={{
                position: "absolute",
                inset: 0,
                width: "100%",
                height: "100%",
                border: 0,
            }}
        />
    );
});
