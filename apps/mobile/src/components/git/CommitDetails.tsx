import Ionicons from '@expo/vector-icons/Ionicons';
import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useRef, useState, type ReactNode } from 'react';
import { ActivityIndicator, Platform, Pressable, StyleSheet, Text, View } from 'react-native';

import type { FileChange } from '@/git/compare';
import type { Passing } from '@/git/graph';
import type { HistoryRow } from '@/git/history';
import { STATUS_COLORS, statusLetter, treeRows, type TreeRow } from '@/git/model';
import { useAreaWidth } from '@/layout/size';
import { request, useConnection } from '@/store/connection';
import { colors, spacing } from '@/theme';

export type FileView = 'tree' | 'list';

type CommitInfo = {
  hash: string; shortHash: string; parents: string[];
  authorName: string; authorEmail: string; authorDate: string;
  committerName: string; committerEmail: string; commitDate: string;
  subject: string; body: string;
};
type Detail = { ok?: boolean; error?: string; commit?: CommitInfo; files?: FileChange[] };

// What a root commit is compared with, as on the desktop (git-graph-service.js getGitGraphCommitDetail).
const EMPTY_TREE = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';
// The panel is not virtualized: past this many rows, the rest waits for "Show all".
const MAX_ROWS = 200;
// From this width the details and the files sit side by side, as on the desktop.
const TWO_COLUMNS = 700;
const INDENT = 14;
const mono = Platform.select({ ios: 'Menlo', default: 'monospace' });

/**
 * A row of the Git Graph, opened under it as on the desktop
 * (project-git-graph-view.js gitGraphDetailsBodyHtml): the commit, then the
 * files it changed as a tree or a list, each opening its diff. The graph's
 * lines go on beside it.
 */
export function CommitDetails({
  projectId, folder, row, headHash, below, graphWidth, leading = 0, colour,
  fileView, onFileView, compact, lastViewed, onViewed, isLoaded, onOpenCommit, onClose, onShown,
}: {
  projectId: string; folder: string; row: HistoryRow; headHash: string | null;
  below: Passing[]; graphWidth: number; colour: (index: number) => string;
  /** Room taken before the graph (the checkboxes): the lines and the panel move over by it. */
  leading?: number;
  fileView: FileView; onFileView: (view: FileView) => void; compact: boolean;
  lastViewed: string | null; onViewed: (path: string) => void;
  isLoaded: (hash: string) => boolean; onOpenCommit: (hash: string) => void; onClose: () => void;
  /** Once, when the details are laid out in full: the list can now scroll to show all of them. */
  onShown?: () => void;
}) {
  const online = useConnection((s) => s.status.state === 'online');
  const width = useAreaWidth();
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const [all, setAll] = useState(false);
  const announced = useRef(false);
  const uncommitted = row.kind === 'uncommitted';
  const detail = useQuery({
    queryKey: ['git-graph-details', projectId, folder, row.hash],
    queryFn: () => (uncommitted
      // The working tree against HEAD, untracked files included.
      ? request<Detail>('get-git-graph-compare-detail', [projectId, folder, headHash, null])
      : request<Detail>('get-git-graph-commit-detail', [projectId, folder, row.hash])),
    enabled: online && (!uncommitted || !!headHash),
    // A commit never changes; the working tree does.
    staleTime: uncommitted ? 0 : Infinity,
  });
  const data = detail.data;
  const commit = data?.commit;
  const files = data?.files || [];
  const range = uncommitted
    ? (headHash ? { from: headHash } : null)
    : commit ? { from: commit.parents[0] || EMPTY_TREE, to: commit.hash } : null;

  const open = (file: FileChange) => {
    if (!range) return;
    onViewed(file.path);
    router.push({ pathname: '/diff', params: { projectId, folder, path: file.path, ...range } });
  };
  const toggleFolder = (key: string) => setCollapsed((previous) => {
    const next = new Set(previous);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });

  const rows: TreeRow<FileChange>[] = fileView === 'tree'
    ? treeRows(files, { collapsed, compact })
    : files.map((file) => ({ kind: 'file', key: file.path, depth: 0, name: file.oldPath && file.oldPath !== file.path ? `${file.oldPath} → ${file.path}` : file.path, item: file }));
  const shown = all ? rows : rows.slice(0, MAX_ROWS);

  let content: ReactNode;
  if (uncommitted && !headHash) content = <Text style={styles.dim}>There is no commit yet to compare the working tree with.</Text>;
  else if (detail.isLoading) content = <ActivityIndicator style={styles.loading} color={colors.accent} />;
  else if (detail.error || data?.error || !data?.ok) content = <Text style={styles.error}>{detail.error?.message || data?.error || 'Could not load the details.'}</Text>;
  else {
    content = (
      <View style={width >= TWO_COLUMNS ? styles.columns : styles.stack}>
        <View style={width >= TWO_COLUMNS ? styles.column : undefined}>
          {commit ? <CommitFields commit={commit} isLoaded={isLoaded} onOpenCommit={onOpenCommit} /> : (
            <>
              <Text style={styles.subject}>Working tree changes</Text>
              <Pressable onPress={() => router.push({ pathname: '/git', params: { projectId } })} hitSlop={6} accessibilityRole="link" style={styles.linkRow}>
                <Text style={styles.link}>Open in Git changes</Text>
              </Pressable>
            </>
          )}
        </View>
        <View style={width >= TWO_COLUMNS ? styles.column : styles.filesBelow}>
          <View style={styles.filesHeader}>
            <Text style={styles.heading}>{files.length ? `${files.length} file${files.length === 1 ? '' : 's'} changed` : 'No files changed'}</Text>
            {files.length ? (
              <View style={styles.toggle}>
                {(['tree', 'list'] as const).map((view) => (
                  <Pressable key={view} onPress={() => onFileView(view)} style={[styles.toggleButton, fileView === view && styles.toggleActive]} accessibilityRole="button" accessibilityState={{ selected: fileView === view }}>
                    <Text style={[styles.toggleText, fileView === view && styles.toggleTextActive]}>{view === 'tree' ? 'Tree' : 'List'}</Text>
                  </Pressable>
                ))}
              </View>
            ) : null}
          </View>
          {shown.map((item) => (item.kind === 'folder' ? (
            <Pressable
              key={`d:${item.key}`}
              onPress={() => toggleFolder(item.key)}
              style={({ pressed }) => [styles.treeRow, { paddingLeft: item.depth * INDENT }, pressed && styles.pressed]}
              accessibilityRole="button"
              accessibilityState={{ expanded: !item.collapsed }}
            >
              <Ionicons name={item.collapsed ? 'chevron-forward' : 'chevron-down'} size={12} color={colors.textFaint} />
              <Ionicons name={item.collapsed ? 'folder-outline' : 'folder-open-outline'} size={14} color={colors.textDim} />
              {/* A compacted chain loses its start first: the deepest folder says the most. */}
              <Text style={styles.folderName} numberOfLines={1} ellipsizeMode="head">{item.name}</Text>
              <Text style={styles.count}>{item.count}</Text>
            </Pressable>
          ) : (
            <Pressable
              key={`f:${item.key}`}
              onPress={() => open(item.item)}
              disabled={!range}
              style={({ pressed }) => [styles.treeRow, { paddingLeft: fileView === 'tree' ? item.depth * INDENT + 16 : 0 }, pressed && styles.pressed]}
              accessibilityRole="button"
              accessibilityHint="Opens the diff"
            >
              <Text style={[styles.letter, { color: STATUS_COLORS[item.item.status] }]}>{statusLetter(item.item)}</Text>
              <Text style={styles.fileName} numberOfLines={1} ellipsizeMode="middle">{item.name}</Text>
              {lastViewed === item.item.path ? <Text style={styles.eye} accessibilityLabel="Viewed last">◉</Text> : null}
              <DiffStat file={item.item} />
            </Pressable>
          )))}
          {shown.length < rows.length ? (
            <Pressable onPress={() => setAll(true)} style={styles.linkRow} accessibilityRole="button">
              <Text style={styles.link}>Show all {files.length} files</Text>
            </Pressable>
          ) : null}
        </View>
      </View>
    );
  }

  return (
    <View
      style={styles.wrap}
      onLayout={() => {
        if (announced.current || detail.isLoading) return;
        announced.current = true;
        onShown?.();
      }}
    >
      {below.map((line) => <View key={line.x} style={[styles.line, { left: spacing.sm + leading + line.x - 1, backgroundColor: colour(line.colorIndex) }]} />)}
      <View style={[styles.panel, { marginLeft: spacing.sm + leading + graphWidth + spacing.sm }]}>
        <Pressable onPress={onClose} hitSlop={10} style={styles.close} accessibilityRole="button" accessibilityLabel="Close the details">
          <Ionicons name="close" size={18} color={colors.textDim} />
        </Pressable>
        {content}
      </View>
    </View>
  );
}

function CommitFields({ commit, isLoaded, onOpenCommit }: { commit: CommitInfo; isLoaded: (hash: string) => boolean; onOpenCommit: (hash: string) => void }) {
  const authored = new Date(commit.authorDate).toLocaleString();
  const committed = new Date(commit.commitDate).toLocaleString();
  return (
    <View style={styles.fields}>
      <Field label="Commit"><Text style={styles.mono} selectable>{commit.hash}</Text></Field>
      <Field label="Parents">
        {commit.parents.length ? commit.parents.map((parent, i) => (
          <Text key={parent}>
            {i ? ', ' : ''}
            <Text
              style={[styles.mono, isLoaded(parent) && styles.link]}
              onPress={isLoaded(parent) ? () => onOpenCommit(parent) : undefined}
              accessibilityRole={isLoaded(parent) ? 'link' : undefined}
            >
              {parent.slice(0, 10)}
            </Text>
          </Text>
        )) : 'none (root commit)'}
      </Field>
      <Field label="Author"><Text selectable>{commit.authorName} &lt;{commit.authorEmail}&gt;</Text></Field>
      <Field label="Committer"><Text selectable>{commit.committerName}</Text></Field>
      <Field label="Date">{authored}{commit.commitDate && commit.commitDate !== commit.authorDate ? <Text style={styles.dim}> (committed {committed})</Text> : null}</Field>
      <Text style={styles.subject} selectable>{commit.subject}</Text>
      {commit.body.trim() ? <Text style={styles.body} selectable>{commit.body.trim()}</Text> : null}
    </View>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return <Text style={styles.field}><Text style={styles.label}>{label}: </Text>{children}</Text>;
}

/** "+N −M", each part only when it is not zero, as the desktop's gitGraphDiffStatHtml. */
export function DiffStat({ file }: { file: FileChange }) {
  if (!file.insertions && !file.deletions) return null;
  return (
    <Text style={styles.stat}>
      {file.insertions ? <Text style={styles.add}>+{file.insertions}</Text> : null}
      {file.insertions && file.deletions ? ' ' : null}
      {file.deletions ? <Text style={styles.del}>−{file.deletions}</Text> : null}
    </Text>
  );
}

const styles = StyleSheet.create({
  wrap: { paddingBottom: spacing.sm },
  line: { position: 'absolute', top: 0, bottom: 0, width: 2 },
  panel: {
    marginRight: spacing.md, padding: spacing.md, borderRadius: 8,
    backgroundColor: colors.surface, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border,
  },
  close: { position: 'absolute', top: spacing.sm, right: spacing.sm, zIndex: 1, padding: 2 },
  loading: { marginVertical: spacing.lg },
  error: { color: colors.danger, fontSize: 13, paddingRight: spacing.xl },
  dim: { color: colors.textFaint },
  stack: { gap: spacing.md },
  columns: { flexDirection: 'row', gap: spacing.lg },
  column: { flex: 1, minWidth: 0 },
  filesBelow: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border, paddingTop: spacing.sm },
  fields: { gap: 3, paddingRight: spacing.xl },
  field: { color: colors.text, fontSize: 12, lineHeight: 17 },
  label: { color: colors.textDim, fontWeight: '700' },
  mono: { fontFamily: mono, fontSize: 11.5 },
  subject: { color: colors.text, fontSize: 14, fontWeight: '600', marginTop: spacing.sm },
  body: { color: colors.textDim, fontSize: 13, lineHeight: 19, marginTop: spacing.xs },
  linkRow: { paddingVertical: spacing.sm, alignSelf: 'flex-start' },
  link: { color: colors.accent },
  filesHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm, marginBottom: spacing.xs, paddingRight: spacing.xl },
  heading: { color: colors.textDim, fontSize: 12, fontWeight: '700' },
  toggle: { flexDirection: 'row', borderRadius: 6, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border, overflow: 'hidden' },
  toggleButton: { paddingHorizontal: spacing.sm, paddingVertical: 3 },
  toggleActive: { backgroundColor: colors.raised },
  toggleText: { color: colors.textFaint, fontSize: 12 },
  toggleTextActive: { color: colors.text },
  treeRow: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 32 },
  pressed: { backgroundColor: colors.raised },
  folderName: { flex: 1, color: colors.textDim, fontSize: 13, fontFamily: mono },
  count: { color: colors.textFaint, fontSize: 11 },
  letter: { width: 12, fontFamily: mono, fontSize: 12, fontWeight: '700' },
  fileName: { flex: 1, color: colors.text, fontSize: 13, fontFamily: mono },
  eye: { color: colors.accent, fontSize: 11 },
  stat: { fontFamily: mono, fontSize: 11 },
  add: { color: colors.running },
  del: { color: colors.danger },
});
