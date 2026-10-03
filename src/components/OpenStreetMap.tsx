import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { Linking, StyleSheet, Text, View } from 'react-native';
import { WebView } from 'react-native-webview';
import type { LatLng, Region } from '../lib/map-region';
import { OPENSTREETMAP_HTML } from '../lib/openstreetmap-document';

export type MapMember = {
  id: string; coordinate: LatLng; name: string; initials: string; color: string;
  avatar: unknown; stale: boolean; battery?: number | null; movement: string; description: string;
};
export type MapData = { members: MapMember[]; homes: { coordinate: LatLng; name: string }[]; trail: LatLng[]; trailColor: string };
export type OpenStreetMapHandle = { animateToRegion: (region: Region) => void };
export type MapCommand = { type: 'render'; data: MapData } | { type: 'center'; region: Region } | { type: 'trail'; coordinates: LatLng[] };
export type MapMessage = { type: 'ready' } | { type: 'member'; id: string };
export type OpenStreetMapProps = { data: MapData; region: Region; onOpenMember: (id: string) => void };
const SOURCE = { html: OPENSTREETMAP_HTML, baseUrl: 'https://free360.local/' };

export const OpenStreetMap = forwardRef<OpenStreetMapHandle, OpenStreetMapProps>(function OpenStreetMap({ data, region, onOpenMember }, ref) {
  const webview = useRef<WebView>(null);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const send = useCallback((command: MapCommand) => {
    webview.current?.injectJavaScript(`window.free360Receive && window.free360Receive(${JSON.stringify(command)}); true;`);
  }, []);
  useImperativeHandle(ref, () => ({ animateToRegion: (next) => { if (ready) send({ type: 'center', region: next }); } }), [ready, send]);
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
  return <View style={StyleSheet.absoluteFill}>
    <WebView ref={webview} style={styles.map} source={SOURCE} originWhitelist={['*']}
      applicationNameForUserAgent="Free360/1.0" javaScriptEnabled domStorageEnabled={false}
      setSupportMultipleWindows={false} onShouldStartLoadWithRequest={({ url }) => {
        if (url === 'https://www.openstreetmap.org/copyright') void Linking.openURL(url).catch(() => {});
        return url === 'about:blank' || url === SOURCE.baseUrl;
      }}
      onLoadStart={() => { setReady(false); setFailed(false); }} onError={() => setFailed(true)}
      onMessage={({ nativeEvent }) => {
        try {
          const message: MapMessage = JSON.parse(nativeEvent.data);
          if (message.type === 'ready') setReady(true);
          if (message.type === 'member' && typeof message.id === 'string') onOpenMember(message.id);
        } catch { /* Ignore malformed messages. */ }
      }} />
    {failed && <View style={styles.error}><Text>Map unavailable. Check your connection and reopen the map.</Text></View>}
  </View>;
});

const styles = StyleSheet.create({ map: { flex: 1, backgroundColor: '#E6EAF0' }, error: { position: 'absolute', inset: 0, alignItems: 'center', justifyContent: 'center', padding: 24, backgroundColor: '#E6EAF0' } });
