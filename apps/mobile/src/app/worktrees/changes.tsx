import Ionicons from '@expo/vector-icons/Ionicons';
import { useQuery } from '@tanstack/react-query';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useMemo, useState, type ReactNode } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { FileIcon } from '@/components/files/FileIcon';
import { LINE_STYLES, mono } from '@/components/git/diff-style';
import { usePullRefresh } from '@/components/PullRefresh';
import { diffLines, STATUS_COLORS, statusLetter, type Change } from '@/git/model';
import { act } from '@/projects/queries';
import { relativeTime } from '@/sessions/model';
import { useConnection } from '@/store/connection';
import { colors, spacing } from '@/theme';
import {
  changesMeta, changeState, changesVerdict, commitStat, unpushedSummary, type FileDiff, type UnpushedCommit, type WorktreeChanges,
} from '@/worktrees/changes';
import { shortPath } from '@/worktrees/model';
import { LIST_TIMEOUT_MS, reloadWorktrees, useProjectWorktrees } from '@/worktrees/queries';

/**
 * What removing a worktree would lose, as the desktop's panel shows it: its
 * uncommitted files (a tap shows a file's diff against HEAD) and the commits
 * no remote has, under a note that says what removing it does to each.
 * Read-only; Remove… goes on to the usual screen.
 */
export default function WorktreeChangesScreen() {
  const { projectId, path } = useLocalSearchParams<{ projectId: string; path: string }>();
  const online = useConnection((s) => s.status.state === 'online');
  const listing = useProjectWorktrees(projectId);
  const homeDir = listing.data?.homeDir || '';
  const result = useQuery({
    queryKey: ['worktree-changes', projectId, path],
    queryFn: () => act<WorktreeChanges>('worktree-changes', [projectId, path], { timeoutMs: LIST_TIMEOUT_MS }),
    enabled: online && !!projectId && !!path,
    refetchOnMount: 'always',
  });
  // The list may have been read before the last change: catch up with it too.
  const pull = usePullRefresh(() => Promise.all([result.refetch(), reloadWorktrees(projectId)]));
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const info = result.data;
  const verdict = useMemo(() => (info ? changesVerdict(info) : null), [info]);
  const title = info ? (info.detached ? `Detached at ${info.head}` : info.branch) : (path || '').split('/').pop() || 'Worktree';

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content} refreshControl={pull}>
      <Stack.Screen options={{ title: 'Uncommitted and unpushed' }} />
      <View style={styles.titleRow}>
        <Ionicons name="git-network-outline" size={18} color={colors.accent} />
        <Text style={styles.title} numberOfLines={1}>{title}</Text>
      </View>
      <Text style={styles.path} numberOfLines={2} ellipsizeMode="head">{shortPath(path || '', homeDir)}</Text>

      {result.isLoading ? <ActivityIndicator style={{ margin: spacing.xl }} color={colors.accent} /> : null}
      {result.error ? <Text style={styles.error}>{(result.error as Error).message}</Text> : null}

      {info && verdict ? (
        <>
          {info.lastCommit?.subject ? (
            <Text style={styles.where} numberOfLines={1}>
              <Text style={styles.mono}>{info.head}</Text> {info.lastCommit.subject}
            </Text>
          ) : null}
          <View style={[styles.verdict, verdict.safe ? styles.verdictSafe : styles.verdictWarn]} accessibilityRole="summary">
            {verdict.lines.map((line) => (
              <Text key={line} style={[styles.verdictText, { color: verdict.safe ? colors.running : colors.attention }]}>{line}</Text>
            ))}
          </View>

          <Section title="Uncommitted changes" meta={changesMeta(info)}>
            {info.changes.length ? info.changes.map((change) => (
              <FileRow
                key={change.path}
                change={change}
                open={!!open[change.path]}
                onToggle={() => setOpen({ ...open, [change.path]: !open[change.path] })}
                projectId={projectId}
                worktreePath={info.path}
              />
            )) : <Text style={styles.empty}>Nothing to commit: the working tree is clean.</Text>}
            {info.changesTotal > info.changes.length ? <Text style={styles.empty}>The first {info.changes.length} of {info.changesTotal} are listed.</Text> : null}
          </Section>

          <Section title="Unpushed commits" meta={unpushedSummary(info).meta}>
            {info.unpushed.commits.length
              ? info.unpushed.commits.map((commit) => <CommitRow key={commit.hash} commit={commit} />)
              : <Text style={styles.empty}>{unpushedSummary(info).empty}</Text>}
            {info.unpushed.truncated ? <Text style={styles.empty}>The latest {info.unpushed.commits.length} of {info.unpushed.total} are listed.</Text> : null}
          </Section>

          {info.isMain ? null : (
            <Pressable
              onPress={() => router.push({ pathname: '/worktrees/remove', params: { projectId, path: info.path } })}
              style={({ pressed }) => [styles.remove, pressed && styles.pressed]}
              accessibilityRole="button"
            >
              <Ionicons name="trash-outline" size={16} color={colors.danger} />
              <Text style={styles.removeText}>Remove worktree…</Text>
            </Pressable>
          )}
        </>
      ) : null}
    </ScrollView>
  );
}

function Section({ title, meta, children }: { title: string; meta: string; children: ReactNode }) {
  return (
    <View style={styles.section}>
      <View style={styles.sectionHead}>
        <Text style={styles.sectionTitle}>{title}</Text>
        <Text style={styles.sectionMeta} numberOfLines={1}>{meta}</Text>
      </View>
      {children}
    </View>
  );
}

/** A changed file; a tap shows its diff under it. */
function FileRow({ change, open, onToggle, projectId, worktreePath }: {
  change: Change; open: boolean; onToggle: () => void; projectId: string; worktreePath: string;
}) {
  const name = change.path.split('/').pop() || change.path;
  const slash = change.path.lastIndexOf('/');
  const dir = slash > 0 ? change.path.slice(0, slash) : '';
  const state = changeState(change);
  return (
    <View>
      <Pressable
        onPress={onToggle}
        style={({ pressed }) => [styles.file, open && styles.fileOpen, pressed && styles.pressed]}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={`${change.path}, ${state}`}
        accessibilityHint={open ? 'Hides its diff' : 'Shows its diff'}
      >
        <Ionicons name={open ? 'chevron-down' : 'chevron-forward'} size={12} color={colors.textFaint} />
        <Text style={[styles.letter, { color: STATUS_COLORS[change.status] }]}>{statusLetter(change)}</Text>
        <FileIcon name={name} size={16} />
        <View style={styles.flex}>
          <Text style={styles.fileName} numberOfLines={1}>{name}</Text>
          {dir ? <Text style={styles.fileDir} numberOfLines={1} ellipsizeMode="head">{dir}</Text> : null}
        </View>
        <Text style={styles.fileState}>{state}</Text>
      </Pressable>
      {open ? <FileDiffView projectId={projectId} worktreePath={worktreePath} path={change.path} /> : null}
    </View>
  );
}

function FileDiffView({ projectId, worktreePath, path }: { projectId: string; worktreePath: string; path: string }) {
  const online = useConnection((s) => s.status.state === 'online');
  const diff = useQuery({
    queryKey: ['worktree-file-diff', projectId, worktreePath, path],
    queryFn: () => act<FileDiff>('worktree-file-diff', [projectId, worktreePath, path]),
    enabled: online,
  });
  const lines = useMemo(() => diffLines(diff.data?.diff || ''), [diff.data]);
  if (diff.isLoading) return <ActivityIndicator style={{ margin: spacing.md }} color={colors.accent} />;
  if (diff.error) return <Text style={styles.error}>{(diff.error as Error).message}</Text>;
  if (!lines.length) return <Text style={styles.empty}>No textual diff is available.</Text>;
  return (
    <ScrollView horizontal style={styles.diff} contentContainerStyle={styles.diffContent}>
      <View>
        {lines.map((line, i) => <Text key={i} style={[styles.line, LINE_STYLES[line.kind]]}>{line.text || ' '}</Text>)}
      </View>
    </ScrollView>
  );
}

function CommitRow({ commit }: { commit: UnpushedCommit }) {
  const when = commit.time ? relativeTime(new Date(commit.time).toISOString()) : '';
  return (
    <View style={styles.commit} accessible accessibilityLabel={`${commit.subject}, ${commit.shortHash}, ${commit.author}, ${when}`}>
      <Text style={styles.hash}>{commit.shortHash}</Text>
      <View style={styles.flex}>
        <Text style={styles.subject} numberOfLines={2}>{commit.subject || '(no message)'}</Text>
        <Text style={styles.commitMeta} numberOfLines={1}>{[commit.author, when, commitStat(commit)].filter(Boolean).join(' · ')}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.lg, gap: spacing.md, paddingBottom: spacing.xl * 2 },
  flex: { flex: 1, minWidth: 0 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  title: { flex: 1, color: colors.text, fontSize: 17, fontWeight: '600', fontFamily: mono },
  path: { color: colors.textFaint, fontSize: 12, fontFamily: mono, marginTop: -spacing.sm },
  where: { color: colors.textDim, fontSize: 12.5 },
  mono: { fontFamily: mono, color: colors.textDim },
  error: { color: colors.danger, fontSize: 13, padding: spacing.sm },
  verdict: { borderRadius: 8, padding: spacing.md, gap: 4 },
  verdictSafe: { backgroundColor: 'rgba(76,175,143,0.12)' },
  verdictWarn: { backgroundColor: 'rgba(224,160,80,0.12)' },
  verdictText: { fontSize: 13.5, lineHeight: 19 },
  section: { borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border, borderRadius: 8, overflow: 'hidden' },
  sectionHead: { flexDirection: 'row', alignItems: 'baseline', gap: spacing.sm, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, backgroundColor: colors.surface },
  sectionTitle: { color: colors.textDim, fontSize: 12, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5 },
  sectionMeta: { flex: 1, textAlign: 'right', color: colors.textFaint, fontSize: 11.5, fontFamily: mono },
  empty: { color: colors.textFaint, fontSize: 13, padding: spacing.md },
  file: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.md, minHeight: 48 },
  fileOpen: { backgroundColor: 'rgba(128,136,255,0.08)' },
  letter: { width: 14, textAlign: 'center', fontFamily: mono, fontSize: 12.5, fontWeight: '700' },
  fileName: { color: colors.text, fontSize: 14 },
  fileDir: { color: colors.textFaint, fontSize: 11.5, fontFamily: mono },
  fileState: { color: colors.textFaint, fontSize: 11.5 },
  diff: { backgroundColor: '#14141a' },
  diffContent: { paddingVertical: spacing.sm },
  line: { fontFamily: mono, fontSize: 11.5, lineHeight: 17, paddingHorizontal: spacing.md },
  commit: { flexDirection: 'row', gap: spacing.sm, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  hash: { color: colors.attention, fontFamily: mono, fontSize: 12.5, paddingTop: 1 },
  subject: { color: colors.text, fontSize: 14, lineHeight: 19 },
  commitMeta: { color: colors.textFaint, fontSize: 12, marginTop: 2 },
  remove: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm, minHeight: 46, borderRadius: 8, borderWidth: 1, borderColor: 'rgba(224,108,117,0.4)' },
  removeText: { color: colors.danger, fontSize: 15, fontWeight: '600' },
  pressed: { backgroundColor: colors.raised },
});
