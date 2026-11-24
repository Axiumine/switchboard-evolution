import Ionicons from '@expo/vector-icons/Ionicons';
import { router, Stack } from 'expo-router';
import { useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import {
  errorTitle, eventWords, formatBytes, formatDuration, graphLayout, isActive, runDuration, shortSha, stateOf, triggerText, usageRows,
  type Annotation, type EditParams, type GraphNode,
} from '@/actions/model';
import { editActions, useRun, useWorkflows, type ActionsRef } from '@/actions/queries';
import { usePullRefresh } from '@/components/PullRefresh';
import { openInAppBrowser } from '@/components/pulls/PullRequestWebPage';
import { Sheet, type SheetOption } from '@/components/Sheet';
import { relativeTime } from '@/sessions/model';
import { colors, spacing } from '@/theme';
import { actionStyles as s, openGitHubHere, openJob, refParams, StateIcon, useNow } from './parts';

type Menu = 'attempt' | 'rerun' | 'more';

/**
 * A workflow run on a screen of its own, as GitHub's summary page shows it:
 * its state and attempt, Re-run jobs and Cancel workflow, what started it,
 * what it waits for (a review of its deployments, a fork's approval, its
 * concurrency group), the graph of its jobs as stages, the annotations, the
 * artifacts and each job's run time. Read again every 5 s while it runs.
 */
export function RunView({ actionsRef, runId, title }: { actionsRef: ActionsRef; runId: number; title?: string }) {
  const [attempt, setAttempt] = useState<number | null>(null);
  const [menu, setMenu] = useState<Menu | null>(null);
  const [open, setOpen] = useState<Set<string>>(() => new Set());
  const [busy, setBusy] = useState('');
  const run = useRun(actionsRef, runId, attempt);
  const workflows = useWorkflows(actionsRef);
  const canWrite = !!(workflows.data?.ok && workflows.data.repo.canWrite);
  const answer = run.data;
  const now = useNow(2_000);
  const pull = usePullRefresh(() => run.refetch());
  const graph = useMemo(() => (answer?.ok ? graphLayout(answer.workflow.jobs, answer.jobs, now, !isActive(answer.run.status)) : null), [answer, now]);

  const change = async (text: string, params: EditParams, after?: () => void) => {
    setBusy(text);
    const result = await editActions(actionsRef, params);
    setBusy('');
    if (!result.ok) { Alert.alert('GitHub did not do it', result.error || 'Try again.'); return; }
    if (after) after();
  };
  const confirm = (heading: string, text: string, button: string, destructive: boolean, params: EditParams, after?: () => void) => {
    Alert.alert(heading, text, [
      { text: 'Cancel', style: 'cancel' },
      { text: button, style: destructive ? 'destructive' : 'default', onPress: () => change(`${button}…`, params, after) },
    ]);
  };

  if (!answer || (run.isLoading && !answer)) {
    return <View style={s.center}><Stack.Screen options={{ title: title || 'Workflow run' }} /><ActivityIndicator color={colors.accent} /><Text style={s.emptyText}>Reading the workflow run…</Text></View>;
  }
  if (!answer.ok) {
    return (
      <View style={s.center}>
        <Stack.Screen options={{ title: title || 'Workflow run' }} />
        <Text style={s.emptyTitle}>{errorTitle(answer.code)}</Text>
        <Text style={s.emptyText}>{answer.error || 'The workflow run could not be read.'}</Text>
        <Pressable onPress={() => run.refetch()} accessibilityRole="button"><Text style={s.link}>Try again</Text></Pressable>
      </View>
    );
  }

  const r = answer.run;
  const state = stateOf(r);
  const active = isActive(r.status);
  const failed = answer.jobs.some((j) => ['failure', 'cancelled', 'timed_out'].includes(String(j.conclusion)));
  const who = r.triggeringActor || r.actor;
  const pr = r.pullRequests[0];

  const sheetOptions = (): SheetOption[] | undefined => {
    if (menu === 'attempt') {
      return Array.from({ length: answer.attempts }, (_, i) => answer.attempts - i).map((n) => ({
        label: n === answer.attempts ? `Latest #${n}` : `Attempt #${n}`,
        hint: n === answer.attempt ? 'shown' : undefined,
        onPress: () => setAttempt(n === answer.attempts ? null : n),
      }));
    }
    if (menu === 'rerun') {
      const options: SheetOption[] = [
        { label: 'Re-run all jobs', onPress: () => change('Re-running…', { kind: 'rerun', runId: r.id, failedOnly: false }) },
        { label: 'Re-run all jobs with debug logging', onPress: () => change('Re-running…', { kind: 'rerun', runId: r.id, failedOnly: false, debug: true }) },
      ];
      if (failed) options.push({ label: 'Re-run failed jobs', onPress: () => change('Re-running…', { kind: 'rerun', runId: r.id, failedOnly: true }) });
      return options;
    }
    if (menu === 'more') {
      const options: SheetOption[] = [];
      if (!answer.workflow.dynamic) options.push({ label: 'View workflow file', onPress: () => router.push({ pathname: '/actions/file', params: { ...refParams(actionsRef), path: r.path, ref: r.sha, title: r.path.split('/').pop() || 'Workflow file' } }) });
      options.push({ label: 'Open on GitHub here', onPress: () => openGitHubHere(r.url, `${r.workflow} #${r.number}`) });
      options.push({ label: 'Open in the browser', onPress: () => openInAppBrowser(r.url) });
      if (canWrite && active) options.push({ label: 'Force cancel workflow', destructive: true, onPress: () => confirm('Force cancel?', 'Force cancel stops the run even past steps that run always(). Use it when Cancel does not stop it.', 'Force cancel', true, { kind: 'force-cancel', runId: r.id }) });
      if (canWrite && !active) {
        options.push({ label: 'Delete all logs', destructive: true, onPress: () => confirm('Delete all logs?', 'Every log of this run is deleted on GitHub. This cannot be undone.', 'Delete logs', true, { kind: 'delete-logs', runId: r.id }) });
        options.push({ label: 'Delete workflow run', destructive: true, onPress: () => confirm('Delete workflow run?', 'Are you sure you want to permanently delete this workflow run? This cannot be undone.', 'Delete', true, { kind: 'delete-run', runId: r.id }, () => router.back()) });
      }
      return options;
    }
    return undefined;
  };

  const toggle = (key: string) => {
    const next = new Set(open);
    if (next.has(key)) next.delete(key); else next.add(key);
    setOpen(next);
  };

  const node = (n: GraphNode) => {
    if (!n.group) {
      const job = n.jobs[0];
      return (
        <Pressable key={n.key} disabled={!job} onPress={() => job && openJob(actionsRef, r.id, job.id, job.name)} style={({ pressed }) => [styles.node, !job && styles.idle, pressed && s.pressed]} accessibilityRole="button">
          <StateIcon state={n.state} />
          <Text style={styles.nodeName} numberOfLines={1}>{n.name}</Text>
          <Text style={s.faint}>{n.durationMs !== null ? formatDuration(n.durationMs) : job ? '' : 'Not started'}</Text>
          {job ? <Ionicons name="chevron-forward" size={14} color={colors.textFaint} /> : null}
        </Pressable>
      );
    }
    const shown = open.has(n.key);
    return (
      <View key={n.key} style={styles.group}>
        <Pressable onPress={() => toggle(n.key)} style={({ pressed }) => [styles.node, styles.groupHead, pressed && s.pressed]} accessibilityRole="button" accessibilityState={{ expanded: shown }}>
          <StateIcon state={n.state} />
          <View style={s.flex}>
            <Text style={styles.nodeName} numberOfLines={1}>{n.kind === 'reusable' ? n.name : `Matrix: ${n.name}`}</Text>
            <Text style={s.faint}>{n.jobs.length ? `${n.done} of ${n.jobs.length} job${n.jobs.length === 1 ? '' : 's'} completed` : 'Not started'}</Text>
          </View>
          <Ionicons name={shown ? 'chevron-down' : 'chevron-forward'} size={14} color={colors.textFaint} />
        </Pressable>
        {shown ? n.jobs.map((job) => (
          <Pressable key={job.id} onPress={() => openJob(actionsRef, r.id, job.id, job.name)} style={({ pressed }) => [styles.child, pressed && s.pressed]} accessibilityRole="button">
            <StateIcon state={stateOf(job)} size={14} />
            <Text style={styles.childName} numberOfLines={1}>{job.name}</Text>
          </Pressable>
        )) : null}
      </View>
    );
  };

  const annotations: { job: string; jobId: number; item: Annotation }[] = [];
  for (const job of answer.jobs) for (const item of answer.annotations[job.id]?.items || []) annotations.push({ job: job.name, jobId: job.id, item });
  const usage = usageRows(answer.jobs, now);

  return (
    <View style={s.screen}>
      <Stack.Screen options={{ title: `${r.workflow} #${r.number}` }} />
      <ScrollView refreshControl={pull} contentContainerStyle={styles.content}>
        <View style={styles.head}>
          <StateIcon state={state} size={22} />
          <View style={s.flex}>
            <Text style={styles.title}>{r.title || r.workflow}</Text>
            <Text style={s.faint}>{state.label}{answer.attempts > 1 ? ` · attempt #${answer.attempt} of ${answer.attempts}` : ''}</Text>
          </View>
        </View>
        <View style={[s.buttons, styles.pad]}>
          {answer.attempts > 1 ? <Btn icon="layers-outline" label={answer.attempt === answer.attempts ? `Latest #${answer.attempts}` : `Attempt #${answer.attempt}`} onPress={() => setMenu('attempt')} /> : null}
          {canWrite && !active ? <Btn icon="refresh" label="Re-run jobs" onPress={() => setMenu('rerun')} /> : null}
          {canWrite && active ? <Btn icon="stop-circle-outline" label="Cancel workflow" danger onPress={() => confirm(`Cancel ${r.workflow} #${r.number}?`, 'Steps that run always() still run. If it does not stop, Force cancel is in "…".', 'Cancel workflow', true, { kind: 'cancel', runId: r.id })} /> : null}
          <Btn icon="ellipsis-horizontal" label="More" onPress={() => setMenu('more')} />
        </View>
        {busy ? <View style={styles.busy}><ActivityIndicator size="small" color={colors.accent} /><Text style={s.faint}>{busy}</Text></View> : null}

        <View style={[s.card, styles.pad]}>
          <Text style={s.faint}>Triggered via {eventWords(r.event)} {relativeTime(r.createdAt)}</Text>
          <Text style={s.text}>
            {r.event === 'push' ? `${who} pushed ${shortSha(r.sha)}` : pr ? `${who} · #${pr.number}` : triggerText(r)}
            {r.branch ? <Text style={s.mono}>  {r.branch}</Text> : null}
          </Text>
          <View style={styles.facts}>
            <Fact label="Status" value={state.label} />
            <Fact label="Total duration" value={formatDuration(runDuration(r, now, answer.jobs)) || '–'} />
            <Fact label="Artifacts" value={answer.artifacts.length ? String(answer.artifacts.length) : '–'} />
          </View>
        </View>

        {r.conclusion === 'action_required' ? (
          <View style={s.banner}>
            <Text style={s.text}>{'This workflow run needs a maintainer\'s approval: it comes from a fork of a first-time contributor.'}</Text>
            {canWrite ? <Pressable onPress={() => confirm('Approve and run', 'Read the pull request\'s changes before its workflows run with this repository\'s settings.', 'Approve and run', false, { kind: 'approve-fork', runId: r.id })} accessibilityRole="button"><Text style={s.link}>Approve and run</Text></Pressable> : null}
          </View>
        ) : null}
        {answer.pendingDeployments.length ? (
          <View style={s.banner}>
            <Text style={s.text}>{answer.pendingDeployments.map((p) => p.environment.name).join(', ')} {answer.pendingDeployments.length === 1 ? 'needs' : 'need'} approval to start deploying changes.</Text>
            {answer.pendingDeployments.map((p) => (
              <Text key={p.environment.name} style={s.faint}>{p.environment.name}{p.reviewers.length ? ` · reviewers: ${p.reviewers.map((x) => x.name).join(', ')}` : ''}{p.waitTimer ? ` · wait timer ${p.waitTimer} min` : ''}</Text>
            ))}
            {answer.pendingDeployments.some((p) => p.canApprove)
              ? <Pressable onPress={() => router.push({ pathname: '/actions/review', params: { ...refParams(actionsRef), runId: String(r.id) } })} accessibilityRole="button"><Text style={s.link}>Review deployments</Text></Pressable>
              : <Text style={s.faint}>You are not one of their reviewers.</Text>}
          </View>
        ) : null}
        {answer.approvals.map((a, i) => <Text key={i} style={[s.faint, styles.pad]}>{a.user} {a.state} {a.environments.join(', ')}{a.comment ? `: ${a.comment}` : ''}</Text>)}
        {answer.concurrency.map((g) => {
          const me = g.members.find((m) => m.runId === r.id);
          return <Text key={g.name} style={[s.faint, styles.pad]}>Waiting in the concurrency group {g.name}{me && me.position !== null ? ` (position ${me.position + 1} of ${g.members.length})` : ''}.</Text>;
        })}

        {graph && graph.nodes.length ? (
          <View style={s.section}>
            <Text style={s.sectionTitle}>Jobs</Text>
            {answer.workflow.error ? <Text style={s.faint}>{answer.workflow.error}</Text> : null}
            {graph.columns.map((column, i) => (
              <View key={i} style={styles.stage}>
                <Text style={styles.stageHead}>{column.some((n) => n.other) ? 'Other jobs' : graph.columns.length > 1 ? `Stage ${i + 1}` : ''}</Text>
                {column.map(node)}
              </View>
            ))}
          </View>
        ) : null}

        {annotations.length ? (
          <View style={s.section}>
            <Text style={s.sectionTitle}>Annotations</Text>
            {annotations.map(({ job, jobId, item }, i) => (
              <Pressable key={i} onPress={() => openJob(actionsRef, r.id, jobId, job)} style={[styles.annotation, { borderLeftColor: item.level === 'failure' ? colors.danger : item.level === 'warning' ? colors.attention : '#8fa7e8' }]} accessibilityRole="button">
                <Text style={s.faint}>{job}{item.title ? ` · ${item.title}` : ''}</Text>
                <Text style={s.text} numberOfLines={6}>{item.message}</Text>
                {item.path && item.path !== '.github' ? <Text style={s.mono}>{item.path}{item.startLine ? `#L${item.startLine}` : ''}</Text> : null}
              </Pressable>
            ))}
          </View>
        ) : null}

        {answer.artifacts.length ? (
          <View style={s.section}>
            <Text style={s.sectionTitle}>Artifacts</Text>
            {answer.artifacts.map((a) => (
              <View key={a.id} style={styles.artifact}>
                <View style={s.flex}>
                  <Text style={s.text}>{a.name}</Text>
                  <Text style={s.faint}>{formatBytes(a.size)}{a.digest ? ` · ${a.digest.slice(0, 19)}…` : ''}{a.expiresAt ? ` · expires ${relativeTime(a.expiresAt)}` : ''}</Text>
                </View>
                <Pressable onPress={() => openInAppBrowser(r.url)} hitSlop={6} accessibilityRole="button" accessibilityLabel={`Download ${a.name} on GitHub`}><Ionicons name="download-outline" size={20} color={colors.textDim} /></Pressable>
                {canWrite ? <Pressable onPress={() => confirm(`Delete ${a.name}?`, 'The artifact is deleted on GitHub. This cannot be undone.', 'Delete', true, { kind: 'delete-artifact', artifactId: a.id })} hitSlop={6} accessibilityRole="button" accessibilityLabel={`Delete ${a.name}`}><Ionicons name="trash-outline" size={19} color={colors.danger} /></Pressable> : null}
              </View>
            ))}
            <Text style={s.faint}>{'Downloads open the run\'s page on GitHub, where the files come down to the phone.'}</Text>
          </View>
        ) : null}

        <View style={s.section}>
          <Text style={s.sectionTitle}>Usage</Text>
          {usage.rows.map((row) => (
            <View key={row.id} style={styles.usage}>
              <StateIcon state={row.state} size={14} />
              <Text style={[s.text, s.flex]} numberOfLines={1}>{row.name}</Text>
              <Text style={s.faint}>{row.ms === null ? '–' : formatDuration(row.ms)}</Text>
            </View>
          ))}
          <Text style={s.faint}>{`Total ${formatDuration(usage.total) || '0s'} · billable minutes are not in GitHub's API any more.`}</Text>
          <Pressable onPress={() => openGitHubHere(r.url, `${r.workflow} #${r.number}`)} accessibilityRole="button"><Text style={s.link}>View job summaries on GitHub</Text></Pressable>
        </View>
      </ScrollView>
      <Sheet visible={!!menu} title={menu === 'attempt' ? 'Attempts' : menu === 'rerun' ? 'Re-run jobs' : `${r.workflow} #${r.number}`} options={sheetOptions()} onClose={() => setMenu(null)} />
    </View>
  );
}

function Btn({ icon, label, danger, onPress }: { icon: keyof typeof Ionicons.glyphMap; label: string; danger?: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [s.button, danger && s.danger, pressed && s.pressed]} accessibilityRole="button">
      <Ionicons name={icon} size={14} color={danger ? colors.danger : colors.textDim} />
      <Text style={[s.buttonText, danger && s.dangerText]}>{label}</Text>
    </Pressable>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <View style={s.flex}>
      <Text style={s.faint}>{label}</Text>
      <Text style={styles.factValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  content: { paddingBottom: 48 },
  pad: { marginHorizontal: spacing.lg, marginTop: spacing.md },
  head: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm, paddingHorizontal: spacing.lg, paddingTop: spacing.lg },
  title: { color: colors.text, fontSize: 18, fontWeight: '700', lineHeight: 24 },
  busy: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.lg, paddingTop: spacing.sm },
  facts: { flexDirection: 'row', gap: spacing.md, marginTop: spacing.sm },
  factValue: { color: colors.text, fontSize: 14, fontWeight: '600', marginTop: 2 },
  stage: { gap: spacing.xs },
  stageHead: { color: colors.textFaint, fontSize: 11.5, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5 },
  node: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: 44, paddingHorizontal: spacing.md, borderRadius: 8, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border, backgroundColor: colors.surface },
  idle: { opacity: 0.6, borderStyle: 'dashed' },
  nodeName: { flex: 1, color: colors.text, fontSize: 14, fontWeight: '600' },
  group: { borderRadius: 8, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border, backgroundColor: colors.surface, overflow: 'hidden' },
  groupHead: { borderWidth: 0, paddingVertical: spacing.sm },
  child: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: 40, paddingLeft: spacing.xl + spacing.sm, paddingRight: spacing.md, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  childName: { flex: 1, color: colors.text, fontSize: 13.5 },
  annotation: { padding: spacing.sm, paddingLeft: spacing.md, borderLeftWidth: 3, borderRadius: 6, backgroundColor: colors.surface, gap: 2 },
  artifact: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.sm, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  usage: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: 6 },
});
