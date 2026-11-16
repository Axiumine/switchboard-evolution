import Ionicons from '@expo/vector-icons/Ionicons';
import { ActivityIndicator, Pressable, StyleSheet } from 'react-native';

import { colors } from '@/theme';

/** The round Send button of a composer: 44pt, accent, an arrow up; a spinner while `busy`. */
export function SendButton({ onPress, disabled, busy, accessibilityLabel = 'Send' }: { onPress: () => void; disabled?: boolean; busy?: boolean; accessibilityLabel?: string }) {
  const off = disabled || busy;
  return (
    <Pressable
      onPress={onPress}
      disabled={off}
      style={({ pressed }) => [styles.button, off && styles.off, pressed && styles.pressed]}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled: !!off, busy: !!busy }}
    >
      {busy ? <ActivityIndicator color={colors.text} size="small" /> : <Ionicons name="arrow-up" size={22} color="#fff" />}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center' },
  off: { backgroundColor: colors.raised },
  stop: { backgroundColor: 'rgba(224,108,117,0.16)', borderWidth: 1.5, borderColor: colors.danger },
  pressed: { opacity: 0.8 },
});

/** Send's place while the session works and the composer is empty: a red ring with ✕ that interrupts (Esc). */
export function StopButton({ onPress }: { onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.button, styles.stop, pressed && styles.pressed]}
      accessibilityRole="button"
      accessibilityLabel="Stop"
      accessibilityHint="Interrupts the session, like Esc"
    >
      <Ionicons name="close" size={22} color={colors.danger} />
    </Pressable>
  );
}
