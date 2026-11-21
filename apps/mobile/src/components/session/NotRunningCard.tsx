import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, spacing } from '@/theme';

/**
 * In place of the composer when the session is not running: resume it, resume
 * it with options, or fork it. A plain terminal that ended has nothing to resume.
 */
export function NotRunningCard({ terminal, starting, forkable = true, onResume, onOptions, onFork }: {
  terminal: boolean;
  starting: boolean;
  /** False for a CLI whose sessions cannot be forked yet (OpenCode). */
  forkable?: boolean;
  onResume: () => void;
  onOptions: () => void;
  onFork: () => void;
}) {
  if (terminal) {
    return (
      <View style={styles.card}>
        <Text style={styles.title}>This terminal has ended.</Text>
      </View>
    );
  }
  return (
    <View style={styles.card}>
      <Text style={styles.title}>Not running</Text>
      <Text style={styles.text}>{forkable ? 'Resume it to continue, or fork it into a new session.' : 'Resume it to continue.'}</Text>
      {starting ? <ActivityIndicator color={colors.accent} style={styles.spinner} /> : (
        <View style={styles.actions}>
          <Pressable onPress={onResume} style={({ pressed }) => [styles.button, styles.primary, pressed && styles.pressed]} accessibilityRole="button">
            <Text style={styles.primaryText}>Resume</Text>
          </Pressable>
          <Pressable onPress={onOptions} style={({ pressed }) => [styles.button, styles.secondary, pressed && styles.pressed]} accessibilityRole="button">
            <Text style={styles.secondaryText}>Resume with options…</Text>
          </Pressable>
          {forkable ? (
            <Pressable onPress={onFork} style={({ pressed }) => [styles.button, styles.secondary, pressed && styles.pressed]} accessibilityRole="button">
              <Text style={styles.secondaryText}>Fork</Text>
            </Pressable>
          ) : null}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { margin: spacing.lg, padding: spacing.lg, gap: spacing.xs, backgroundColor: colors.surface, borderRadius: 12, borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.14)' },
  title: { color: colors.text, fontSize: 15, fontWeight: '600' },
  text: { color: colors.textFaint, fontSize: 13, lineHeight: 18 },
  spinner: { marginTop: spacing.md, alignSelf: 'flex-start' },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.md },
  button: { minHeight: 44, borderRadius: 10, paddingHorizontal: spacing.lg, alignItems: 'center', justifyContent: 'center' },
  primary: { backgroundColor: colors.accent },
  secondary: { backgroundColor: colors.raised, borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.14)' },
  pressed: { opacity: 0.75 },
  primaryText: { color: '#fff', fontSize: 15, fontWeight: '600' },
  secondaryText: { color: colors.text, fontSize: 15, fontWeight: '600' },
});
