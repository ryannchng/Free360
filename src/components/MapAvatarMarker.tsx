import { useCallback, useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Marker } from 'react-native-maps';
import { MemberAvatar } from './MemberAvatar';

type MapAvatarMarkerProps = {
  coordinate: { latitude: number; longitude: number };
  name: string;
  initials: string;
  avatar?: string | null | unknown;
  color: string;
  stale?: boolean;
  battery?: number | null;
  markerKey: string;
  onPress?: () => void;
};

/**
 * Map marker with a photo avatar. react-native-maps custom markers need
 * tracksViewChanges while the async <Image> loads, otherwise the photo never
 * appears; leaving it on permanently is a perf cost, so tracking is enabled
 * only while loading (plus a short settle pass) and disabled afterwards.
 * Works on Android/iOS; coordinate is always validated by the caller.
 */
export function MapAvatarMarker({
  coordinate,
  name,
  initials,
  avatar,
  color,
  stale,
  battery,
  markerKey,
  onPress,
}: MapAvatarMarkerProps) {
  const hasPhoto = typeof avatar === 'string' && avatar.startsWith('data:image/');
  // Start tracking when a photo must async-load so it actually appears; the
  // safety timeout below (plus onLoadEnd) drops back to false — no permanent
  // tracking perf cost. New photos re-trigger via Image onLoadStart.
  const [tracking, setTracking] = useState(hasPhoto);

  const handleLoadingChange = useCallback((loading: boolean) => {
    setTracking(loading);
  }, []);

  // Safety net: never leave per-marker view tracking on (Android/iOS perf).
  useEffect(() => {
    if (!tracking) return;
    const timer = setTimeout(() => setTracking(false), 1500);
    return () => clearTimeout(timer);
  }, [tracking]);

  return (
    <Marker
      key={markerKey}
      coordinate={coordinate}
      anchor={{ x: 0.5, y: 0.5 }}
      onPress={onPress}
      tracksViewChanges={tracking}
    >
      <View>
        <View style={[styles.marker, stale && styles.stale, { backgroundColor: color, borderColor: '#FFFFFF' }]}>
          <MemberAvatar
            name={name}
            initials={initials}
            avatar={avatar}
            color={color}
            size={58}
            onLoadingChange={handleLoadingChange}
          />
        </View>
        {battery != null && <Text style={styles.battery}>{battery}%</Text>}
      </View>
    </Marker>
  );
}

const styles = StyleSheet.create({
  marker: {
    width: 66,
    height: 66,
    borderRadius: 33,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 4,
    shadowColor: '#28154D',
    shadowOpacity: 0.24,
    shadowRadius: 7,
    shadowOffset: { width: 0, height: 3 },
    elevation: 7,
    overflow: 'hidden',
  },
  stale: { opacity: 0.52 },
  battery: { backgroundColor: 'white', textAlign: 'center', fontSize: 11 },
});
