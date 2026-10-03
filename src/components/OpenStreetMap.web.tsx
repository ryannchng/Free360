import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { OPENSTREETMAP_HTML } from '../lib/openstreetmap-document';
import type { MapCommand, MapMessage, OpenStreetMapHandle, OpenStreetMapProps } from './OpenStreetMap';
import type { LatLng } from '../lib/map-region';

export const OpenStreetMap = forwardRef<OpenStreetMapHandle, OpenStreetMapProps>(function OpenStreetMap({ data, region, onOpenMember }, ref) {
  const frame = useRef<HTMLIFrameElement>(null);
  const [ready, setReady] = useState(false);
  const send = useCallback((command: MapCommand) => {
    frame.current?.contentWindow?.postMessage({ free360Command: command }, '*');
  }, []);
  useImperativeHandle(ref, () => ({ animateToRegion: (next) => { if (ready) send({ type: 'center', region: next }); } }), [ready, send]);
  useEffect(() => {
    const receive = (event: MessageEvent) => {
      if (event.source !== frame.current?.contentWindow) return;
      const message: MapMessage | undefined = event.data?.free360Map;
      if (message?.type === 'ready') setReady(true);
      if (message?.type === 'member' && typeof message.id === 'string') onOpenMember(message.id);
    };
    window.addEventListener('message', receive);
    return () => window.removeEventListener('message', receive);
  }, [onOpenMember]);
  const payload = JSON.stringify(data);
  const center = JSON.stringify(region);
  const trail = JSON.stringify(data.trail);
  useEffect(() => { if (ready) send({ type: 'render', data: JSON.parse(payload) }); }, [ready, payload, send]);
  useEffect(() => {
    if (!ready) return;
    const coordinates: LatLng[] = JSON.parse(trail);
    if (coordinates.length > 1) send({ type: 'trail', coordinates });
    else send({ type: 'center', region: JSON.parse(center) });
  }, [ready, center, trail, send]);
  return <iframe ref={frame} title="Circle locations on OpenStreetMap" srcDoc={OPENSTREETMAP_HTML} onLoad={() => setReady(true)}
    sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', border: 0 }} />;
});
