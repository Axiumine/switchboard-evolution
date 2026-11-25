import Ionicons from '@expo/vector-icons/Ionicons';
import type { ReactNode } from 'react';
import { Platform, Pressable, StyleSheet } from 'react-native';

import { colors, spacing } from '@/theme';

const mono = Platform.select({ ios: 'Menlo', default: 'monospace' });

/**
 * The pieces of a search box, as VS Code draws them: an option that is on
 * or off inside the field (Aa, ab, .*, AB), and a small icon button. The
 * Files tab's Search (SearchPanel) and the editor's find bar (FindBar) share them.
 */
export function SearchToggle({ on, label, onPress, children }: { on: boolean; label: string; onPress: () => void; children: ReactNode }) {
  return (
    <Pressable
      onPress={onPress}
      hitSlop={4}
      style={[searchStyles.toggle, on && searchStyles.toggleOn]}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected: on }}
    >
      {children}
    </Pressable>
  );
}

export function SearchIconButton({ icon, label, onPress, small, active, disabled }: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
  small?: boolean;
  active?: boolean;
  disabled?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      hitSlop={small ? 4 : 6}
      style={({ pressed }) => [small ? searchStyles.iconSmall : searchStyles.icon, active && searchStyles.toggleOn, pressed && searchStyles.pressed, disabled && searchStyles.disabled]}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!disabled }}
    >
      <Ionicons name={icon} size={small ? 16 : 18} color={active ? colors.accent : colors.textDim} />
    </Pressable>
  );
}

export const searchStyles = StyleSheet.create({
  field: { flex: 1, flexDirection: 'row', alignItems: 'center', minHeight: 38, paddingRight: 4, gap: 2, borderRadius: 8, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  fieldError: { borderColor: colors.danger },
  input: { flex: 1, minWidth: 0, color: colors.text, fontSize: 14.5, paddingHorizontal: spacing.md, paddingVertical: 6 },
  toggle: { width: 28, height: 28, borderRadius: 6, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: 'transparent' },
  toggleOn: { backgroundColor: 'rgba(128,136,255,0.2)', borderColor: 'rgba(128,136,255,0.5)' },
  toggleText: { color: colors.textDim, fontSize: 13, fontWeight: '600' },
  toggleTextOn: { color: '#e4e4fa' },
  underline: { textDecorationLine: 'underline' },
  mono: { fontFamily: mono },
  icon: { width: 40, height: 40, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  iconSmall: { width: 30, height: 30, borderRadius: 6, alignItems: 'center', justifyContent: 'center' },
  pressed: { backgroundColor: colors.surface },
  disabled: { opacity: 0.4 },
});
