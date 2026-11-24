import Ionicons from '@expo/vector-icons/Ionicons';
import { Stack } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { durationMs, errorTitle, formatDuration, isActive, missingStepLog, stateOf, type Job, type Step } from '@/actions/model';
import { editActions, useJob, useRun, useStepLog, useWorkflows, type ActionsRef } from '@/actions/queries';
import { usePullRefresh } from '@/components/PullRefresh';
import { relativeTime } from '@/sessions/model';
import { colors, spacing } from '@/theme';
import { actionStyles as s, openGitHubHere, StateIcon, StepLog, useNow } from './parts';

/** The steps a job opens on, as GitHub does: the failed ones, and the one running now. */
export function initialOpenSteps(job: Pick<Job, 'steps'>): Set<number> {
  return new Set(job.steps.filter((step) => step.conclusion === 'failure' || step.status === 'in_progress').map((step) => step.number));
}

/**
 * A job on a screen of its own, as GitHub's job page shows it: how it went,
 * its runner, its annotations and its steps, each opening on its log. GitHub
 * gives a step's log once the step has finished, while the job still runs: the
 * job is read again every 5 s and each step's log comes as the step ends. The
 * step running now has "Follow live on GitHub".
 */
export function JobView({ actionsRef, jobId, runId, title }: { actionsRef: ActionsRef; jobId: number; runId: number | null; title?: string }) {
  const job = useJob(actionsRef, jobId);
  const run = useRun(actionsRef, runId ?? 0, null);
  const workflows = useWorkflows(actionsRef);
  const canWrite = !!(workflows.data?.ok && workflows.data.repo.canWrite);
  const [open, setOpen] = useState<Set<number> | null>(null);
  const [search, setSearch] = useState('');
  const [timestamps, setTimestamps] = useState(false);
  const pull = usePullRefresh(() => job.refetch());
  const answer = job.data;

  const now = useNow(1_000);
  // Opened once on the steps GitHub opens; then the running step follows along (state derived while rendering, as GitTab does).
  const running = answer?.ok ? answer.job.steps.find((step) => step.status === 'in_progress')?.number : undefined;
  const [followed, setFollowed] = useState<number | undefined>(undefined);
  if (answer?.ok && open === null) setOpen(initialOpenSteps(answer.job));
  if (open && running !== followed) {
    setFollowed(running);
    if (running && !open.has(running)) setOpen(new Set([...open, running]));
  }

  if (!answer) {
    return <View style={s.center}><Stack.Screen options={{ title: title || 'Job' }} /><ActivityIndicator color={colors.accent} /><Text style={s.emptyText}>Reading the job…</Text></View>;
  }
  if (!answer.ok) {
    return (
      <View style={s.center}>
        <Stack.Screen options={{ title: title || 'Job' }} />
        <Text style={s.emptyTitle}>{errorTitle(answer.code)}</Text>
        <Text style={s.emptyText}>{answer.error || 'The job could not be read.'}</Text>
        <Pressable onPress={() => job.refetch()} accessibilityRole="button"><Text style={s.link}>Try again</Text></Pressable>
      </View>
    );
  }

  const j = answer.job;
  const state = stateOf(j);
  const active = isActive(j.status);
  const took = formatDuration(durationMs(j.startedAt, j.completedAt, now));
  const runDone = run.data?.ok ? !isActive(run.data.run.status) : false;
  const shown = open ?? new Set<number>();
  const toggle = (n: number) => {
    const next = new Set(shown);
    if (next.has(n)) next.delete(n); else next.add(n);
    setOpen(next);
  };
  const rerun = () => {
    const go = async (debug: boolean) => {
      const result = await editActions(actionsRef, { kind: 'rerun-job', jobId: j.id, debug });
      Alert.alert(result.ok ? 'Re-running the job' : 'GitHub did not do it', result.ok ? `${j.name} and the jobs that need it run again.` : result.error || 'Try again.');
    };
    Alert.alert(`Re-run ${j.name}?`, 'It runs again with the run\'s commit, ref and actor, with the jobs that need it.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'With debug logging', onPress: () => go(true) },
      { text: 'Re-run job', onPress: () => go(false) },
    ]);
  };

  return (
    <View style={s.screen}>
      <Stack.Screen options={{ title: j.name }} />
      <ScrollView refreshControl={pull} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <View style={styles.head}>
          <StateIcon state={state} size={22} />
          <View style={s.flex}>
            <Text style={styles.title}>{j.name}</Text>
            <Text style={s.faint}>{active ? `${state.verb}${took ? ` for ${took}` : ''}` : `${state.verb} ${relativeTime(j.completedAt || j.startedAt)}${took ? ` in ${took}` : ''}`}</Text>
            {j.runnerName ? <Text style={s.faint}>Runner: {j.runnerName}{j.runnerGroup ? ` · ${j.runnerGroup}` : ''}{j.labels.length ? ` · ${j.labels.join(', ')}` : ''}</Text> : null}
          </View>
        </View>
        <View style={[s.buttons, styles.pad]}>
          {canWrite && !active && runDone ? (
            <Pressable onPress={rerun} style={({ pressed }) => [s.button, pressed && s.pressed]} accessibilityRole="button">
              <Ionicons name="refresh" size={14} color={colors.textDim} /><Text style={s.buttonText}>Re-run this job</Text>
            </Pressable>
          ) : null}
          <Pressable onPress={() => setTimestamps(!timestamps)} style={({ pressed }) => [s.button, timestamps && s.primary, pressed && s.pressed]} accessibilityRole="switch" accessibilityState={{ checked: timestamps }}>
            <Ionicons name="time-outline" size={14} color={timestamps ? colors.accent : colors.textDim} /><Text style={[s.buttonText, timestamps && s.primaryText]}>Timestamps</Text>
          </Pressable>
          <Pressable onPress={() => openGitHubHere(j.url, j.name)} style={({ pressed }) => [s.button, pressed && s.pressed]} accessibilityRole="button">
            <Ionicons name="globe-outline" size={14} color={colors.textDim} /><Text style={s.buttonText}>GitHub</Text>
          </Pressable>
        </View>

        {answer.annotations.length ? (
          <View style={s.section}>
            <Text style={s.sectionTitle}>Annotations</Text>
            {answer.annotations.map((a, i) => (
              <View key={i} style={[styles.annotation, { borderLeftColor: a.level === 'failure' ? colors.danger : a.level === 'warning' ? colors.attention : '#8fa7e8' }]}>
                {a.title ? <Text style={s.faint}>{a.title}</Text> : null}
                <Text style={s.text} numberOfLines={8}>{a.message}</Text>
                {a.path && a.path !== '.github' ? <Text style={s.mono}>{a.path}{a.startLine ? `#L${a.startLine}` : ''}</Text> : null}
              </View>
            ))}
          </View>
        ) : null}

        <View style={styles.searchRow}>
          <Ionicons name="search" size={14} color={colors.textFaint} />
          <TextInput value={search} onChangeText={setSearch} placeholder="Search logs" placeholderTextColor={colors.textFaint} autoCapitalize="none" autoCorrect={false} style={styles.searchInput} accessibilityLabel="Search the logs of the steps shown" />
        </View>

        <View style={styles.steps}>
          {j.steps.length ? j.steps.map((step) => (
            <StepBlock key={step.number} actionsRef={actionsRef} job={j} step={step} now={now} open={shown.has(step.number)} onToggle={() => toggle(step.number)} search={search} timestamps={timestamps} />
          )) : <Text style={[s.faint, styles.pad]}>{state.bucket === 'skipped' ? 'This job was skipped: it ran no steps.' : active ? 'This job has not started its steps yet.' : 'This job has no steps.'}</Text>}
        </View>
      </ScrollView>
    </View>
  );
}

function StepBlock({ actionsRef, job, step, now, open, onToggle, search, timestamps }: {
  actionsRef: ActionsRef; job: Job; step: Step; now: number; open: boolean; onToggle: () => void; search: string; timestamps: boolean;
}) {
  const state = stateOf(step);
  const done = step.status === 'completed';
  const log = useStepLog(actionsRef, job.id, step.number, open && done);
  const took = formatDuration(durationMs(step.startedAt, step.completedAt, now));
  let body = null;
  if (open) {
    if (!done) {
      body = (
        <View style={styles.live}>
          <Text style={s.faint}>{state.bucket === 'running' ? 'This step is running. GitHub gives its log once it has finished.' : 'This step has not started yet.'}</Text>
          {state.bucket === 'running' && job.url ? <Pressable onPress={() => openGitHubHere(job.url, job.name)} accessibilityRole="button"><Text style={s.link}>Follow live on GitHub</Text></Pressable> : null}
        </View>
      );
    } else if (!log.data) {
      body = <View style={styles.live}><ActivityIndicator size="small" color={colors.accent} /><Text style={s.faint}>Reading the log…</Text></View>;
    } else if (!log.data.ok) {
      body = <View style={styles.live}><Text style={[s.faint, { color: colors.danger }]}>{log.data.pending ? missingStepLog(isActive(job.status)) : log.data.error || 'The log could not be read.'}</Text><Pressable onPress={() => log.refetch()} accessibilityRole="button"><Text style={s.link}>Try again</Text></Pressable></View>;
    } else {
      body = <View style={styles.logBox}><StepLog text={log.data.text} truncated={log.data.truncated} search={search} timestamps={timestamps} /></View>;
    }
  }
  return (
    <View style={styles.step}>
      <Pressable onPress={onToggle} style={({ pressed }) => [styles.stepRow, pressed && s.pressed]} accessibilityRole="button" accessibilityState={{ expanded: open }}>
        <Ionicons name={open ? 'chevron-down' : 'chevron-forward'} size={13} color={colors.textFaint} />
        <StateIcon state={state} size={15} />
        <Text style={styles.stepName} numberOfLines={1}>{step.name}</Text>
        <Text style={s.faint}>{took}</Text>
      </Pressable>
      {body}
    </View>
  );
}

const styles = StyleSheet.create({
  content: { paddingBottom: 48 },
  pad: { marginHorizontal: spacing.lg, marginTop: spacing.md },
  head: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm, paddingHorizontal: spacing.lg, paddingTop: spacing.lg },
  title: { color: colors.text, fontSize: 18, fontWeight: '700', lineHeight: 24 },
  annotation: { padding: spacing.sm, paddingLeft: spacing.md, borderLeftWidth: 3, borderRadius: 6, backgroundColor: colors.surface, gap: 2 },
  searchRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginHorizontal: spacing.lg, marginTop: spacing.lg, paddingHorizontal: spacing.sm + 2, height: 38, borderRadius: 8, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  searchInput: { flex: 1, color: colors.text, fontSize: 14, paddingVertical: 0 },
  steps: { marginTop: spacing.md, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  step: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  stepRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: 46, paddingHorizontal: spacing.lg },
  stepName: { flex: 1, color: colors.text, fontSize: 14 },
  live: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: spacing.sm, paddingHorizontal: spacing.lg, paddingBottom: spacing.md },
  logBox: { paddingHorizontal: spacing.sm, paddingBottom: spacing.sm },
});
