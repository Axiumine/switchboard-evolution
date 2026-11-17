import { useQuery } from '@tanstack/react-query';
import { Stack, useIsFocused, useLocalSearchParams } from 'expo-router';
import { useRef, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View, type ScrollViewInstance } from 'react-native';

import { plainOutput, runStateLabel, type TaskRun } from '@/processes/model';
import { shortProjectPath } from '@/sessions/model';
import { request, useConnection } from '@/store/connection';
import { colors, spacing } from '@/theme';

type RunAnswer = TaskRun | { error: string } | null;

/**
 * One task's output, as the desktop's task log shows it (from the Task
 * Manager's Open): plain text, read again every 2 s while on screen, with Stop
 * and Restart. Follows the end of the output unless you scroll up.
 */
export default function TaskLogScreen() {
  const { projectPath, label } = useLocalSearchParams<{ projectPath: string; label: string }>();
  const online = useConnection((s) => s.status.state === 'online');
  const focused = useIsFocused();
  const scroller = useRef<ScrollViewInstance>(null);
  const following = useRef(true);
  const [busy, setBusy] = useState(false);

  const run = useQuery({
    queryKey: ['task-run', projectPath, label],
    queryFn: () => request<RunAnswer>('get-task-run', [projectPath, label]),
    enabled: online && !!projectPath && !!label,
    refetchInterval: focused ? 2000 : false,
    // It polls: no SyncBar for it.
    meta: { quiet: true },
  });
  const answer = run.data;
  const refused = answer && 'error' in answer && !('label' in answer) ? answer.error : null;
  const data = answer && !refused ? (answer as TaskRun) : null;

  const act = async (method: 'stop-task' | 'restart-task') => {
    setBusy(true);
    try {
      const result = await request<{ error?: string } | null>(method, [projectPath, label]);
      if (result && typeof result === 'object' && result.error) Alert.alert('That did not work', result.error);
    } catch (err: any) {
      Alert.alert('That did not work', err.message);
    } finally {
      setBusy(false);
      following.current = true;
      run.refetch();
    }
  };

  const output = data ? plainOutput(data.output) : '';

  return (
    <View style={styles.screen}>
      <Stack.Screen options={{ title: label || 'Task' }} />
      <View style={styles.bar}>
        <View style={styles.flex}>
          <Text style={[styles.state, data?.running && styles.running]} numberOfLines={1}>{data ? runStateLabel(data) : refused || ' '}</Text>
          <Text style={styles.meta} numberOfLines={1}>{projectPath ? shortProjectPath(projectPath) : ''}</Text>
        </View>
        {data?.running
          ? <Button label="Stop" danger disabled={busy || data.stopRequested} onPress={() => act('stop-task')} />
          : null}
        {data ? <Button label="Restart" disabled={busy} onPress={() => act('restart-task')} /> : null}
      </View>
      {!answer && run.isLoading ? <ActivityIndicator color={colors.accent} style={styles.loading} /> : null}
      {answer === null && !run.isLoading ? <Text style={styles.empty}>This task has not run since the computer started.</Text> : null}
      {data ? (
        <ScrollView
          ref={scroller}
          style={styles.output}
          contentContainerStyle={styles.outputContent}
          onScrollBeginDrag={() => { following.current = false; }}
          onScroll={(e) => {
            const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent;
            if (contentOffset.y + layoutMeasurement.height >= contentSize.height - 24) following.current = true;
          }}
          scrollEventThrottle={64}
          onContentSizeChange={() => { if (following.current) scroller.current?.scrollToEnd({ animated: false }); }}
        >
          <Text style={styles.outputText} selectable>{output || 'No output yet.'}</Text>
        </ScrollView>
      ) : null}
    </View>
  );
}

function Button({ label, onPress, disabled, danger }: { label: string; onPress: () => void; disabled?: boolean; danger?: boolean }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityState={{ disabled: !!disabled }}
      style={({ pressed }) => [styles.button, danger && styles.buttonDanger, pressed && styles.pressed, disabled && styles.disabled]}
    >
      <Text style={[styles.buttonText, danger && styles.buttonTextDanger]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  flex: { flex: 1, minWidth: 0 },
  bar: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border, backgroundColor: colors.surface,
  },
  state: { color: colors.text, fontSize: 14, fontWeight: '600' },
  running: { color: colors.running },
  meta: { color: colors.textFaint, fontSize: 12, marginTop: 1 },
  loading: { marginTop: spacing.xl },
  empty: { color: colors.textFaint, fontSize: 14, textAlign: 'center', padding: spacing.xl },
  output: { flex: 1 },
  outputContent: { padding: spacing.md },
  outputText: { color: colors.text, fontSize: 12, lineHeight: 17, fontFamily: 'monospace' },
  button: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 8, backgroundColor: 'rgba(255,255,255,0.06)' },
  buttonDanger: { backgroundColor: 'rgba(224,108,117,0.14)' },
  buttonText: { color: colors.text, fontSize: 13.5, fontWeight: '600' },
  buttonTextDanger: { color: colors.danger },
  pressed: { opacity: 0.6 },
  disabled: { opacity: 0.45 },
});
