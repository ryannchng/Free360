import { useState } from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import { avatarUriFor, initialsForName } from '../lib/member-display';

type MemberAvatarProps = {
  name?: string | null;
  initials?: string | null;
  avatar?: string | null | unknown;
  color?: string;
  size?: number;
  accessibilityLabel?: string;
  /** Optional small caption rendered under the avatar (e.g. battery "82%"). */
  badgeText?: string | null;
  /** Called when the underlying Image starts/finishes loading (used by map markers). */
  onLoadingChange?: (loading: boolean) => void;
};

/**
 * Central avatar: renders the photo via RN <Image> when the stored value is a
 * valid data URI, otherwise falls back to initials. Handles async load failure
 * by falling back to initials so a corrupt payload never shows a broken image.
 */
export function MemberAvatar({
  name,
  initials,
  avatar,
  color = '#7944D5',
  size = 48,
  accessibilityLabel,
  badgeText,
  onLoadingChange,
}: MemberAvatarProps) {
  const uri = avatarUriFor(avatar);
  const label = initials && initials.trim() ? initials.trim().toUpperCase().slice(0, 2) : initialsForName(name ?? '');
  const [failed, setFailed] = useState(false);
  const showPhoto = Boolean(uri) && !failed;

  return (
    <View accessible accessibilityLabel={accessibilityLabel ?? (name ? `${name} avatar` : 'Member avatar')}>
      <View
        style={[
          styles.circle,
          { width: size, height: size, borderRadius: size / 2, backgroundColor: color },
        ]}
      >
        {showPhoto ? (
          <Image
            source={{ uri: uri as string }}
            style={{ width: size, height: size, borderRadius: size / 2 }}
            resizeMode="cover"
            accessibilityIgnoresInvertColors
            onError={() => {
              setFailed(true);
              onLoadingChange?.(false);
            }}
            onLoadStart={() => onLoadingChange?.(true)}
            onLoadEnd={() => onLoadingChange?.(false)}
          />
        ) : (
          <Text style={[styles.initials, { fontSize: size * 0.31 }]}>{label}</Text>
        )}
      </View>
      {badgeText ? <Text style={styles.badge}>{badgeText}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  circle: {
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: '#FFFFFF',
    overflow: 'hidden',
    position: 'relative',
  },
  initials: { color: '#FFFFFF', fontWeight: '800', letterSpacing: -0.5 },
  badge: { fontSize: 11, textAlign: 'center', color: '#718099', marginTop: 2 },
});
