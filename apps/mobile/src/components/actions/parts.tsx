import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { memo, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { mono } from '@/components/git/diff-style';
import { formatDuration, logLines, logTime, runDuration, STATE_ICONS, stateOf, triggerText, type Run } from '@/actions/model';
import type { ActionsRef, Notice } from '@/actions/queries';
import { relativeTime } from '@/sessions/model';
import type { RunStateInfo } from '@/shared/vendor/actions-model';
import { colors, spacing } from '@/theme';

/** The time now, moved on every `everyMs`: what a running duration is counted to. */
export function useNow(everyMs = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), everyMs);
    return () => clearInterval(timer);
  }, [everyMs]);
  return now;
}

/** A run's, a job's or a step's state, as an icon with its words for a screen reader. */
export function StateIcon({ state, size = 16 }: { state: RunStateInfo; size?: number }) {
  const icon = STATE_ICONS[state.bucket] ?? STATE_ICONS.queued;
  return <Ionicons name={icon.name} size={size} color={icon.color} accessibilityLabel={state.a11y || state.label} />;
}

/** The params every Actions screen takes: where it reads. */
export function refParams(ref: ActionsRef): Record<string, string> {
  return { projectId: ref.projectId, folder: ref.folder, remote: ref.remote ?? '' };
}

export function refFrom(params: { projectId?: string; folder?: string; remote?: string }): ActionsRef | null {
  if (!params.projectId || !params.folder) return null;
  return { projectId: params.projectId, folder: params.folder, remote: params.remote || undefined };
}

export function openRun(ref: ActionsRef, runId: number, title = '') {
  router.push({ pathname: '/actions/run/[id]', params: { id: String(runId), ...refParams(ref), title } });
}

export function openJob(ref: ActionsRef, runId: number | null, jobId: number, title = '') {
  router.push({ pathname: '/actions/job/[id]', params: { id: String(jobId), runId: String(runId ?? ''), ...refParams(ref), title } });
}

/** GitHub's own page, inside the app (the pull requests' web screen). */
export function openGitHubHere(url: string, title: string) {
  if (!/^https:\/\//i.test(url)) return;
  router.push({ pathname: '/pulls/web', params: { url, title } });
}

/** A run of the list: its state, title, what started it, branch, when and how long. */
export const RunRow = memo(function RunRow({ run, now, onPress, onMore }: { run: Run; now: number; onPress: (run: Run) => void; onMore: (run: Run) => void }) {
  const state = stateOf(run);
  const duration = state.bucket === 'queued' || state.bucket === 'waiting'
    ? state.label
    : formatDuration(runDuration(run, now)) || (state.bucket === 'running' ? 'In progress' : '');
  return (
    <Pressable onPress={() => onPress(run)} style={({ pressed }) => [styles.row, pressed && styles.pressed]} accessibilityRole="button" accessibilityLabel={`${state.a11y}: ${run.title}`}>
      <View style={styles.rowIcon}><StateIcon state={state} size={18} /></View>
      <View style={styles.flex}>
        <Text style={styles.title} numberOfLines={2}>{run.title || run.workflow}</Text>
        <Text style={styles.meta} numberOfLines={2}>{run.workflow} #{run.number}: {triggerText(run)}</Text>
        <View style={styles.line}>
          {run.branch && run.event !== 'merge_group' ? <Text style={styles.branch} numberOfLines={1}>{run.fromFork && run.headRepository ? `${run.headRepository.split('/')[0]}:${run.branch}` : run.branch}</Text> : null}
          <Text style={styles.meta}>{relativeTime(run.createdAt, now)}{duration ? ` · ${duration}` : ''}</Text>
        </View>
      </View>
      <Pressable onPress={() => onMore(run)} hitSlop={6} style={({ pressed }) => [styles.more, pressed && styles.pressedButton]} accessibilityRole="button" accessibilityLabel={`More actions for workflow run ${run.number}`}>
        <Ionicons name="ellipsis-horizontal" size={18} color={colors.textDim} />
      </Pressable>
    </Pressable>
  );
});

export function NoticeBar({ notice, onClose }: { notice: Notice; onClose: () => void }) {
  const tone = notice.kind === 'error' ? colors.danger : notice.kind === 'ok' ? colors.running : colors.accent;
  return (
    <View style={[styles.notice, { borderLeftColor: tone }]} accessibilityRole="alert" accessibilityLiveRegion="polite">
      {notice.kind === 'busy' ? <ActivityIndicator size="small" color={colors.accent} /> : null}
      <Text style={styles.noticeText}>{notice.text}</Text>
      {notice.kind === 'busy' ? null : (
        <Pressable onPress={onClose} hitSlop={10} accessibilityRole="button" accessibilityLabel="Dismiss">
          <Ionicons name="close" size={16} color={colors.textFaint} />
        </Pressable>
      )}
    </View>
  );
}

const SHOWN_LINES = 1500;

/**
 * A step's log: numbered lines, GitHub's marks coloured, each group a line
 * that opens on its lines (closed at first, open where the search finds
 * something). Of a very long log, the end. It scrolls in its own box.
 */
export function StepLog({ text, truncated, search, timestamps }: { text: string; truncated: boolean; search: string; timestamps: boolean }) {
  const [open, setOpen] = useState<Set<number>>(() => new Set());
  const lines = useMemo(() => logLines(text), [text]);
  const needle = search.trim().toLowerCase();
  const hits = useMemo(() => {
    const found = new Set<number>();
    if (!needle) return found;
    lines.forEach((line, i) => {
      if (line.text.toLowerCase().includes(needle)) { found.add(i); if (line.group !== null) found.add(-1 - line.group); }
    });
    return found;
  }, [lines, needle]);
  const start = Math.max(0, lines.length - SHOWN_LINES);
  const toggle = (i: number) => {
    const next = new Set(open);
    if (next.has(i)) next.delete(i); else next.add(i);
    setOpen(next);
  };
  const rows = [];
  for (let i = start; i < lines.length; i++) {
    const line = lines[i];
    if (line.group !== null && !open.has(line.group) && !hits.has(-1 - line.group)) continue;
    const isGroup = line.kind === 'group';
    const groupOpen = isGroup && (open.has(i) || hits.has(-1 - i));
    const tone = line.kind === 'error' ? colors.danger : line.kind === 'warning' ? colors.attention : (line.kind === 'command' || line.kind === 'notice') ? '#8fa7e8' : isGroup ? colors.accent : colors.text;
    const body = (
      <Text style={[styles.logLine, { color: tone }, isGroup && styles.logGroup, hits.has(i) && styles.logHit]}>
        <Text style={styles.logNum}>{String(i + 1).padStart(4, ' ')}  </Text>
        {timestamps && line.time ? <Text style={styles.logNum}>{logTime(line.time)}  </Text> : null}
        {line.group !== null ? '  ' : ''}{isGroup ? `${groupOpen ? '▾' : '▸'} ` : ''}{line.text || ' '}
      </Text>
    );
    rows.push(isGroup ? <Pressable key={i} onPress={() => toggle(i)} accessibilityRole="button" accessibilityState={{ expanded: groupOpen }}>{body}</Pressable> : <View key={i}>{body}</View>);
  }
  return (
    <View>
      {start > 0 || truncated ? <Text style={styles.logNote}>Only the end of the log is shown.</Text> : null}
      {needle ? <Text style={styles.logNote}>{hits.size ? `${[...hits].filter((h) => h >= 0).length} lines match` : 'Nothing matches here'}</Text> : null}
      <ScrollView nestedScrollEnabled style={styles.log}>
        <ScrollView horizontal nestedScrollEnabled contentContainerStyle={styles.logContent}>
          <View>{rows}</View>
        </ScrollView>
      </ScrollView>
    </View>
  );
}

export const actionStyles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl, gap: spacing.sm },
  section: { paddingHorizontal: spacing.lg, paddingTop: spacing.lg, gap: spacing.sm },
  sectionTitle: { color: colors.textDim, fontSize: 12.5, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5 },
  card: { borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border, borderRadius: 10, backgroundColor: colors.surface, padding: spacing.md, gap: spacing.xs },
  emptyTitle: { color: colors.text, fontSize: 15, fontWeight: '600', textAlign: 'center' },
  emptyText: { color: colors.textFaint, fontSize: 13, lineHeight: 18, textAlign: 'center' },
  text: { color: colors.text, fontSize: 14, lineHeight: 20 },
  faint: { color: colors.textFaint, fontSize: 12.5, lineHeight: 17 },
  link: { color: colors.accent, fontSize: 14, paddingVertical: spacing.xs },
  mono: { fontFamily: mono, fontSize: 12, color: colors.textDim },
  button: { flexDirection: 'row', alignItems: 'center', gap: 5, height: 36, paddingHorizontal: spacing.md, borderRadius: 8, borderWidth: 1, borderColor: colors.border },
  buttonText: { color: colors.text, fontSize: 13, fontWeight: '600' },
  primary: { borderColor: 'rgba(128,136,255,0.4)', backgroundColor: 'rgba(128,136,255,0.12)' },
  primaryText: { color: colors.accent },
  danger: { borderColor: 'rgba(224,108,117,0.4)' },
  dangerText: { color: colors.danger },
  buttons: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  rowLine: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.lg, paddingVertical: spacing.md, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  pressed: { backgroundColor: colors.surface },
  flex: { flex: 1, minWidth: 0 },
  loading: { alignItems: 'center', gap: spacing.sm, padding: spacing.xl },
  banner: { marginHorizontal: spacing.lg, marginTop: spacing.md, padding: spacing.md, borderRadius: 10, borderWidth: 1, borderColor: 'rgba(217,180,92,0.35)', backgroundColor: 'rgba(217,180,92,0.07)', gap: spacing.sm },
});

const styles = StyleSheet.create({
  flex: { flex: 1, minWidth: 0 },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm, paddingLeft: spacing.md, paddingRight: spacing.sm, paddingVertical: spacing.md, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  rowIcon: { paddingTop: 1 },
  title: { color: colors.text, fontSize: 15, fontWeight: '600', lineHeight: 20 },
  meta: { color: colors.textFaint, fontSize: 12, marginTop: 3, flexShrink: 1 },
  line: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flexWrap: 'wrap' },
  branch: { color: '#9aa0e0', fontSize: 11.5, fontFamily: mono, marginTop: 3, maxWidth: 200 },
  more: { width: 40, height: 34, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  pressed: { backgroundColor: colors.surface },
  pressedButton: { backgroundColor: colors.raised },
  notice: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginHorizontal: spacing.lg, marginTop: spacing.sm, padding: spacing.sm, paddingLeft: spacing.md, borderRadius: 8, backgroundColor: colors.surface, borderLeftWidth: 3 },
  noticeText: { flex: 1, color: colors.text, fontSize: 13, lineHeight: 18 },
  log: { maxHeight: 420, backgroundColor: '#101015', borderRadius: 8 },
  logContent: { padding: spacing.sm },
  logLine: { fontFamily: mono, fontSize: 11.5, lineHeight: 17 },
  logNum: { color: '#55556a' },
  logGroup: { fontWeight: '700' },
  logHit: { backgroundColor: 'rgba(217,180,92,0.25)' },
  logNote: { color: colors.textFaint, fontSize: 12, paddingVertical: 4 },
});
