import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';

import type { CursorAction } from '@/editor/bridge';
import { colors, spacing } from '@/theme';

const mono = Platform.select({ ios: 'Menlo', default: 'monospace' });

/** The bar's buttons: VS Code's multiple cursors, for a finger. */
export const CURSOR_BUTTONS: { action: CursorAction; label: string; hint: string }[] = [
  { action: 'next', label: 'Next', hint: 'Add the next occurrence' },
  { action: 'all', label: 'All', hint: 'Select every occurrence' },
  { action: 'above', label: 'Cursor ↑', hint: 'Add a cursor above' },
  { action: 'below', label: 'Cursor ↓', hint: 'Add a cursor below' },
  { action: 'one', label: 'One', hint: 'Back to one cursor' },
];

/**
 * The row over the keyboard while a file is edited: the occurrence the
 * cursor is in, or the selection, the next time (Next) or every time (All),
 * a cursor on the line above or below, and back to one cursor, which is only
 * on with several. `cursors` is how many there are, shown beside One.
 */
export function CursorBar({ cursors, onAction }: { cursors: number; onAction: (action: CursorAction) => void }) {
  return (
    <View style={styles.bar} accessibilityRole="toolbar" accessibilityLabel="Cursors">
      {CURSOR_BUTTONS.map(({ action, label, hint }) => {
        const disabled = action === 'one' && cursors < 2;
        return (
          <Pressable
            key={action}
            onPress={() => onAction(action)}
            disabled={disabled}
            style={({ pressed }) => [styles.button, pressed && styles.pressed]}
            accessibilityRole="button"
            accessibilityLabel={action === 'one' && cursors > 1 ? `${hint}, ${cursors} now` : hint}
            accessibilityState={{ disabled }}
          >
            <Text style={[styles.label, disabled && styles.off]} numberOfLines={1}>
              {action === 'one' && cursors > 1 ? `${label} (${cursors})` : label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { flexDirection: 'row', gap: 4, paddingHorizontal: spacing.sm, paddingVertical: 6, backgroundColor: colors.surface, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  button: { flex: 1, minWidth: 0, height: 40, borderRadius: 8, backgroundColor: colors.raised, alignItems: 'center', justifyContent: 'center' },
  pressed: { backgroundColor: colors.border },
  label: { color: colors.text, fontSize: 13, fontFamily: mono },
  off: { opacity: 0.35 },
});
