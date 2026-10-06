/** Shared presentation tokens for native screens and the embedded map. */
export const COLORS = {
  ink: '#1D1B24',
  muted: '#6B6B7B',
  subtle: '#9693A3',
  border: '#EDEAF2',
  canvas: '#F7F5FA',
  white: '#FFFFFF',
  coral: '#6B4EE6',
  coralSoft: '#EEE9FC',
  mint: '#2F6F5E',
  mintSoft: '#DDF3E4',
  blue: '#8EC4DB',
  blueSoft: '#EAF4F9',
  yellow: '#B88635',
  yellowSoft: '#FFF5DC',
  purple: '#6B4EE6',
  purpleSoft: '#EEE9FC',
  deepPurple: '#2A0A4A',
  charcoal: '#29262F',
  mapLand: '#F0F5F1',
  mapPark: '#DDF3E4',
  mapWater: '#B8D7E3',
  handle: '#CEC9D5',
  danger: '#EB5B68',
  /* Member-detail tokens (centralized; existing names preserved).
     NOTE: COLORS.coral historically aliases the primary purple (#6B4EE6) and
     is referenced across map/circle/activity screens, so it is intentionally
     left unchanged. */
  lavender: '#F5F2FC',
  batteryOrange: '#E8833A',
  online: '#34C759',
};

export const FONTS = {
  regular: 'Poppins-Regular',
  medium: 'Poppins-SemiBold',
  bold: 'Poppins-Bold',
  heavy: 'Poppins-ExtraBold',
};

export const RADII = { card: 24, sheet: 32, sheetLarge: 40, pill: 999 };
export const AVATAR_COLORS = [COLORS.mint, COLORS.blue, COLORS.deepPurple];
export const SHADOWS = {
  floating: {
    shadowColor: COLORS.deepPurple,
    shadowOpacity: 0.1,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 4 },
    elevation: 4,
  },
  card: {
    shadowColor: COLORS.deepPurple,
    shadowOpacity: 0.06,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 2,
  },
  sheet: {
    shadowColor: COLORS.deepPurple,
    shadowOpacity: 0.12,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: -4 },
    elevation: 8,
  },
};
