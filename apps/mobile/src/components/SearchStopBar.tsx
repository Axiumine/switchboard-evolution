import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';

import type { Session } from '@/sessions/model';
import { stopQuestion } from '@/sessions/search-stop';
import { request, useConnection } from '@/store/connection';
import { colors, spacing } from '@/theme';

type Props = { shown: number; running: Session[]; leftOut: number; query: string; onRestore: () => void };

/**
 * Under a search: how many sessions show, what was left out (tap to bring
 * them back), and Stop for the running ones. It asks once, then stops them;
 * they stay in the list.
 */
export function SearchStopBar({ shown, running, leftOut, query, onRestore }: Props) {
  const live = useConnection((s) => s.live);
  const stop = () => {
    const busy = new Set(running.filter((s) => live[s.sessionId]?.busy).map((s) => s.sessionId));
    const { title, message } = stopQuestion(running, busy, query);
    Alert.alert(title, message, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Stop',
        style: 'destructive',
        onPress: async () => {
          for (const session of running) await request('stop-session', [session.sessionId]).catch(() => {});
          useConnection.getState().refreshLive();
        },
      },
    ]);
  };
  const n = running.length;
  return (
    <View style={styles.bar}>
      <Text style={styles.count}>{shown} session{shown === 1 ? '' : 's'}</Text>
      {leftOut ? (
        <Pressable onPress={onRestore} style={styles.button} accessibilityRole="button" accessibilityLabel={`Bring back ${leftOut} left out`}>
          <Text style={styles.buttonText}>{leftOut} left out</Text>
        </Pressable>
      ) : null}
      <Pressable
        onPress={stop}
        disabled={!n}
        style={[styles.button, n ? styles.stop : null]}
        accessibilityRole="button"
        accessibilityState={{ disabled: !n }}
        accessibilityLabel={n ? `Stop ${n} running` : 'None running'}
      >
        <Text style={[styles.buttonText, n ? styles.stopText : styles.off]}>{n ? `Stop ${n} running` : 'None running'}</Text>
      </Pressable>
    </View>
  );
}

/** The X on a search result: leaves it out of this search only. */
export function LeaveOutButton({ onPress, label }: { onPress: () => void; label: string }) {
  return (
    <Pressable onPress={onPress} hitSlop={10} style={styles.x} accessibilityRole="button" accessibilityLabel={`Leave ${label} out of this search`}>
      <Text style={styles.xText}>×</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  bar: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  count: { flex: 1, color: colors.textDim, fontSize: 13 },
  button: { paddingHorizontal: spacing.md, paddingVertical: 5, borderRadius: 14, borderWidth: 1, borderColor: colors.border },
  buttonText: { color: colors.textDim, fontSize: 13 },
  stop: { borderColor: colors.danger },
  stopText: { color: colors.danger },
  off: { color: colors.textFaint },
  x: { paddingHorizontal: spacing.sm, paddingVertical: 2 },
  xText: { color: colors.textFaint, fontSize: 20, lineHeight: 22 },
});
