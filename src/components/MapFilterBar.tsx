import FontAwesome5 from '@expo/vector-icons/FontAwesome5';
import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { COLORS, FONTS, SHADOWS } from '../theme';

export type MapFilter = 'people' | 'pets' | 'items' | 'places';
const FILTERS: { id: MapFilter; icon: string; label: string }[] = [
  { id: 'people', icon: 'user-friends', label: 'People' },
  { id: 'pets', icon: 'paw', label: 'Pets' },
  { id: 'items', icon: 'key', label: 'Items' },
  { id: 'places', icon: 'building', label: 'Places' },
];

export function MapFilterBar({ value, onChange, compact = false }: { value: MapFilter; onChange: (value: MapFilter) => void; compact?: boolean }) {
  const [tooltip, setTooltip] = useState<MapFilter | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  const showTooltip = (id: MapFilter) => {
    if (timer.current) clearTimeout(timer.current);
    setTooltip(id);
    timer.current = setTimeout(() => setTooltip(null), 2200);
  };
  return (
    <View style={[styles.bar, compact && styles.compact]} accessibilityRole="tablist">
      {FILTERS.map(filter => (
        <View key={filter.id} style={[styles.wrapper, value === filter.id && styles.activeWrapper]}>
          {tooltip === filter.id ? <View style={styles.tooltip} pointerEvents="none"><Text style={styles.tooltipText}>{filter.label}</Text><View style={styles.tooltipArrow} /></View> : null}
          <Pressable
            accessibilityRole="tab" accessibilityLabel={filter.label} accessibilityState={{ selected: value === filter.id }}
            accessibilityHint={`Show ${filter.label.toLowerCase()} in your circle. Hold for label.`}
            onPress={() => { setTooltip(null); onChange(filter.id); }} onLongPress={() => showTooltip(filter.id)}
            onHoverIn={() => showTooltip(filter.id)} onHoverOut={() => setTooltip(null)}
            onFocus={() => showTooltip(filter.id)} onBlur={() => setTooltip(null)}
            style={({ pressed }) => [styles.button, value === filter.id && styles.active, pressed && styles.pressed]}
          ><FontAwesome5 name={filter.icon} solid size={23} color={value === filter.id ? COLORS.white : COLORS.ink} /></Pressable>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { flexDirection: 'row', gap: 10, marginTop: 16, marginBottom: 24, zIndex: 2 },
  compact: { marginTop: 10, marginBottom: 12 },
  wrapper: { flex: 1 },
  activeWrapper: { flex: 2 },
  button: { minHeight: 46, borderRadius: 18, backgroundColor: COLORS.white, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#EEECEF', ...SHADOWS.floating },
  active: { backgroundColor: COLORS.charcoal, borderColor: '#625B69', boxShadow: '0 2px 7px #2015252B, inset 0 2px 3px #FFFFFF24' },
  pressed: { opacity: 0.75 },
  tooltip: { position: 'absolute', bottom: 56, alignSelf: 'center', borderRadius: 12, paddingHorizontal: 12, paddingVertical: 7, backgroundColor: COLORS.deepPurple, ...SHADOWS.floating },
  tooltipText: { fontFamily: FONTS.medium, color: COLORS.white, fontSize: 12 },
  tooltipArrow: { position: 'absolute', width: 8, height: 8, bottom: -4, alignSelf: 'center', backgroundColor: COLORS.deepPurple, transform: [{ rotate: '45deg' }] },
});
