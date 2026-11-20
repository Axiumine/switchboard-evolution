import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, StyleSheet, Text } from 'react-native';

import { colors } from '@/theme';

/** How far the visible edge of a header button sits from the screen edge. */
export const HEADER_EDGE = 16;

/**
 * Navigators position `headerLeft` / `headerRight` themselves and add no
 * inset, so buttons touched the screen edge. Put these in a navigator's
 * `screenOptions` and the visible edge of the buttons lands at 16pt.
 */
export const headerEdgeOptions = {
  headerLeftContainerStyle: { paddingStart: HEADER_EDGE },
  headerRightContainerStyle: { paddingEnd: HEADER_EDGE },
} as const;

// The visible button is 36pt tall; hitSlop grows the touch target to 44 without growing the layout.
const VISIBLE = 36;
const HIT_SLOP = { top: 4, bottom: 4, left: 4, right: 4 };

/**
 * A button for a screen header. `chip` is an icon on a quiet square (secondary
 * actions); `primary` is the accent pill with icon and label (the screen's main action).
 */
export function HeaderButton({ icon, text, label, onPress, accessibilityLabel, disabled, variant = 'chip' }: {
  icon?: keyof typeof Ionicons.glyphMap;
  /** Letters on a chip instead of an icon (A− and A+). */
  text?: string;
  label?: string;
  onPress: () => void;
  accessibilityLabel: string;
  disabled?: boolean;
  variant?: 'chip' | 'primary';
}) {
  const primary = variant === 'primary';
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      hitSlop={HIT_SLOP}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled: !!disabled }}
      style={({ pressed }) => [primary ? styles.primary : styles.chip, pressed && styles.pressed, disabled && styles.disabled]}
    >
      {text ? <Text style={styles.text}>{text}</Text> : icon ? <Ionicons name={icon} size={primary ? 16 : 20} color={primary ? colors.accent : colors.text} /> : null}
      {primary && label ? <Text style={styles.label}>{label}</Text> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  chip: { width: VISIBLE, height: VISIBLE, borderRadius: 11, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.06)' },
  primary: {
    height: VISIBLE, borderRadius: 18, paddingStart: 11, paddingEnd: 14, flexDirection: 'row', alignItems: 'center', gap: 5,
    backgroundColor: 'rgba(128,136,255,0.14)',
  },
  text: { color: colors.text, fontSize: 15, fontWeight: '600' },
  label: { color: colors.accent, fontSize: 15, fontWeight: '600' },
  pressed: { opacity: 0.6 },
  disabled: { opacity: 0.4 },
});
