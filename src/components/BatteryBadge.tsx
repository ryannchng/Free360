import { StyleSheet, Text, View } from 'react-native';
import { batteryDisplay } from '../lib/battery-display';
import { COLORS, FONTS, SHADOWS } from '../theme';

export function BatteryBadge({ value }: { value: number | null | undefined }) {
  const battery = batteryDisplay(value);
  if (!battery) return null;
  return (
    <View style={styles.battery} accessible accessibilityLabel={`${battery.percent}% battery`}>
      <View style={[styles.body, { borderColor: battery.color }]}>
        <View style={[styles.fill, { width: `${battery.percent}%`, backgroundColor: battery.color }]} />
        <Text style={styles.label} maxFontSizeMultiplier={1.2}>{battery.label}</Text>
      </View>
      <View style={[styles.cap, { backgroundColor: battery.color }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  battery: { width: 42, height: 22, backgroundColor: COLORS.white, borderRadius: 5, ...SHADOWS.card },
  body: { flex: 1, borderWidth: 2, borderRadius: 5, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  fill: { position: 'absolute', top: 0, bottom: 0, left: 0, opacity: 0.2 },
  label: { fontFamily: FONTS.bold, fontSize: 10, lineHeight: 15, color: COLORS.ink, includeFontPadding: false, fontVariant: ['tabular-nums'] },
  cap: { position: 'absolute', right: -3, top: 7, width: 3, height: 8, borderTopRightRadius: 2, borderBottomRightRadius: 2 },
});
