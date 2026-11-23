import Ionicons from '@expo/vector-icons/Ionicons';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { LINE_STYLES, mono } from '@/components/git/diff-style';
import { diffLines } from '@/git/model';
import { FILE_TOOLS, fileLetter, fileRows, noPatchText, type PullRequestFile } from '@/pulls/model';
import { setPullFileView, useCommitFiles, usePullFileView, usePullRequestFiles, type PullRef } from '@/pulls/queries';
import { colors, spacing } from '@/theme';

// How far each level of the tree goes in, and how long a tool's name stays up.
const INDENT = 14;
const HINT_MS = 1600;

type Viewed = Record<string, 'VIEWED' | 'DISMISSED'>;

/**
 * A pull request's changed files (Files changed), as a tree or a list, every
 * diff closed at first; with `viewed`, a box on each file marks it as viewed,
 * as on GitHub, and a viewed file's diff closes.
 */
export function PullRequestFiles({ projectId, folder, remote, number, headOid, viewed, onToggleViewed }: {
  projectId: string; folder: string; remote: string | undefined; number: number; headOid: string;
  viewed?: Viewed; onToggleViewed?: (file: PullRequestFile, on: boolean) => void;
}) {
  const files = usePullRequestFiles(projectId, folder, remote, number, headOid);
  return (
    <FileList
      loading={files.isLoading}
      error={files.data && !files.data.ok ? (files.data.error || 'The changed files could not be read.') : null}
      files={files.data?.files}
      truncated={!!files.data?.truncated}
      onRetry={() => files.refetch()}
      viewed={viewed}
      onToggleViewed={onToggleViewed}
    />
  );
}

/** One commit's files, opened in the Commits tab. */
export function CommitFiles({ pullRef, sha }: { pullRef: PullRef; sha: string }) {
  const files = useCommitFiles(pullRef, sha);
  return (
    <FileList
      loading={files.isLoading}
      error={files.data && !files.data.ok ? (files.data.error || 'The commit\'s files could not be read.') : null}
      files={files.data?.files}
      truncated={!!files.data?.truncated}
      onRetry={() => files.refetch()}
    />
  );
}

/** Files and their diffs, with Expand all, Collapse all, Tree and List (the names show on a long press). */
export function FileList({ loading, error, files: list, truncated, onRetry, viewed, onToggleViewed }: {
  loading: boolean; error: string | null; files: PullRequestFile[] | undefined; truncated: boolean; onRetry: () => void;
  viewed?: Viewed; onToggleViewed?: (file: PullRequestFile, on: boolean) => void;
}) {
  const view = usePullFileView((s) => s.view);
  // Every diff starts closed; folders start open, so every file is in sight.
  const [opened, setOpened] = useState<ReadonlySet<string>>(() => new Set());
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set());
  // A tool's name, shown for a moment in place of the summary after a long press.
  const [hint, setHint] = useState<string | null>(null);
  useEffect(() => {
    if (!hint) return undefined;
    const timer = setTimeout(() => setHint(null), HINT_MS);
    return () => clearTimeout(timer);
  }, [hint]);
  const rows = useMemo(() => (list ? fileRows(list, view, collapsed) : []), [list, view, collapsed]);
  const flip = (set: ReadonlySet<string>, key: string) => {
    const next = new Set(set);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  };

  if (loading) return <View style={styles.filesNote}><ActivityIndicator size="small" color={colors.accent} /><Text style={styles.footerText}>Reading the changed files…</Text></View>;
  if (error || !list) {
    return (
      <View style={styles.filesNote}>
        <Text style={[styles.footerText, { color: colors.danger, flex: 1 }]}>{error || 'The changed files could not be read.'}</Text>
        <Pressable onPress={onRetry} accessibilityRole="button"><Text style={styles.link}>Try again</Text></Pressable>
      </View>
    );
  }
  if (!list.length) return <View style={styles.filesNote}><Text style={styles.footerText}>No files changed.</Text></View>;
  const insertions = list.reduce((n, file) => n + (file.insertions || 0), 0);
  const deletions = list.reduce((n, file) => n + (file.deletions || 0), 0);
  const viewedCount = viewed ? list.filter((file) => viewed[file.path] === 'VIEWED').length : 0;
  // Expand all opens every folder and every diff; Collapse all closes the diffs only.
  const expandAll = () => { setCollapsed(new Set()); setOpened(new Set(list.map((file) => file.path))); };
  const collapseAll = () => setOpened(new Set());
  return (
    <View style={styles.files}>
      <View style={styles.filesHead}>
        <Text style={[styles.filesSummary, hint ? styles.filesHint : null]} numberOfLines={1} accessibilityLiveRegion="polite">
          {hint ?? <>{list.length} file{list.length === 1 ? '' : 's'}  <Text style={styles.add}>+{insertions}</Text> <Text style={styles.del}>−{deletions}</Text>{viewed ? `  ${viewedCount}/${list.length} viewed` : ''}</>}
        </Text>
        <View style={styles.toolGroup}>
          <ToolButton icon="chevron-expand-outline" label={FILE_TOOLS.expandAll} onPress={expandAll} onHint={setHint} />
          <ToolButton icon="chevron-collapse-outline" label={FILE_TOOLS.collapseAll} onPress={collapseAll} onHint={setHint} />
        </View>
        <View style={styles.toolGroup}>
          <ToolButton icon="folder-open-outline" label={FILE_TOOLS.tree} selected={view === 'tree'} onPress={() => setPullFileView('tree')} onHint={setHint} />
          <ToolButton icon="list-outline" label={FILE_TOOLS.list} selected={view === 'list'} onPress={() => setPullFileView('list')} onHint={setHint} />
        </View>
      </View>
      {truncated ? <Text style={styles.filesWarn}>GitHub lists the first 3000 files.</Text> : null}
      {rows.map((row) => (row.kind === 'folder' ? (
        <Pressable
          key={`d:${row.key}`}
          onPress={() => setCollapsed((previous) => flip(previous, row.key))}
          style={({ pressed }) => [styles.folder, { paddingLeft: spacing.lg + row.depth * INDENT }, pressed && styles.pressed]}
          accessibilityRole="button"
          accessibilityState={{ expanded: !row.collapsed }}
          accessibilityLabel={`Folder ${row.key}, ${row.count} file${row.count === 1 ? '' : 's'}`}
        >
          <Ionicons name={row.collapsed ? 'chevron-forward' : 'chevron-down'} size={12} color={colors.textFaint} />
          <Ionicons name={row.collapsed ? 'folder-outline' : 'folder-open-outline'} size={14} color={colors.textDim} />
          {/* A compacted chain loses its start first: the deepest folder says the most. */}
          <Text style={styles.folderName} numberOfLines={1} ellipsizeMode="head">{row.name}</Text>
          <Text style={styles.folderCount}>{row.count}</Text>
        </Pressable>
      ) : (
        <FileDiff
          key={`f:${row.key}`}
          file={row.item}
          tree={view === 'tree'}
          depth={row.depth}
          open={opened.has(row.item.path)}
          onToggle={() => setOpened((previous) => flip(previous, row.item.path))}
          viewed={viewed ? viewed[row.item.path] ?? null : undefined}
          onToggleViewed={onToggleViewed ? (on) => {
            // A viewed file's diff closes, as on GitHub.
            if (on) setOpened((previous) => { const next = new Set(previous); next.delete(row.item.path); return next; });
            onToggleViewed(row.item, on);
          } : undefined}
        />
      )))}
    </View>
  );
}

/** An icon for a tool over the files; a long press shows its name, as the desktop's tooltip does. */
function ToolButton({ icon, label, selected, onPress, onHint }: {
  icon: keyof typeof Ionicons.glyphMap; label: string; selected?: boolean; onPress: () => void; onHint: (label: string) => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      onLongPress={() => onHint(label)}
      hitSlop={4}
      style={({ pressed }) => [styles.tool, selected && styles.toolOn, pressed && styles.pressed]}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={selected === undefined ? undefined : { selected }}
    >
      <Ionicons name={icon} size={17} color={selected ? colors.accent : colors.textDim} />
    </Pressable>
  );
}

function FileDiff({ file, tree, depth, open, onToggle, viewed, onToggleViewed }: {
  file: PullRequestFile; tree: boolean; depth: number; open: boolean; onToggle: () => void;
  viewed?: 'VIEWED' | 'DISMISSED' | null; onToggleViewed?: (on: boolean) => void;
}) {
  const name = file.path.split('/').pop() || file.path;
  const dir = file.path.slice(0, Math.max(0, file.path.length - name.length - 1));
  // In the tree the folders say where a file is; the list says it under the name.
  const where = [tree ? '' : dir, file.oldPath ? `from ${file.oldPath}` : ''].filter(Boolean).join('  ');
  const lines = useMemo(() => (open && file.patch ? diffLines(file.patch) : []), [open, file.patch]);
  const isViewed = viewed === 'VIEWED';
  return (
    <View>
      <View style={styles.fileLine}>
        <Pressable
          onPress={onToggle}
          style={({ pressed }) => [styles.file, styles.flex, { paddingLeft: spacing.lg + (tree ? depth * INDENT : 0) }, open && styles.fileOpen, pressed && styles.pressed]}
          accessibilityRole="button"
          accessibilityState={{ expanded: open }}
          accessibilityLabel={`${file.path}, ${file.status}${isViewed ? ', viewed' : ''}`}
        >
          <Ionicons name={open ? 'chevron-down' : 'chevron-forward'} size={12} color={colors.textFaint} />
          <Text style={[styles.fileLetter, { color: FILE_COLORS[file.status] }]}>{fileLetter(file)}</Text>
          <View style={styles.flex}>
            <Text style={[styles.fileName, isViewed && { color: colors.textDim }]} numberOfLines={1}>{name}</Text>
            {where ? <Text style={styles.fileDir} numberOfLines={1}>{where}</Text> : null}
          </View>
          <Text style={styles.fileStats}><Text style={styles.add}>+{file.insertions}</Text> <Text style={styles.del}>−{file.deletions}</Text></Text>
        </Pressable>
        {onToggleViewed ? (
          <Pressable
            onPress={() => onToggleViewed(!isViewed)}
            hitSlop={6}
            style={({ pressed }) => [styles.viewed, viewed === 'DISMISSED' && styles.viewedDismissed, pressed && styles.pressed]}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: isViewed }}
            accessibilityLabel={viewed === 'DISMISSED' ? 'Viewed, changed since' : 'Viewed'}
          >
            <Ionicons name={isViewed ? 'checkbox' : 'square-outline'} size={18} color={isViewed ? colors.accent : viewed === 'DISMISSED' ? colors.attention : colors.textDim} />
          </Pressable>
        ) : null}
      </View>
      {open ? (
        file.patch ? (
          <ScrollView horizontal style={styles.diff} contentContainerStyle={styles.diffContent}>
            <View>
              {lines.map((line, i) => <Text key={i} style={[styles.line, LINE_STYLES[line.kind]]}>{line.text || ' '}</Text>)}
            </View>
          </ScrollView>
        ) : <Text style={styles.noPatch}>{noPatchText(file)}</Text>
      ) : null}
    </View>
  );
}

const FILE_COLORS: Record<PullRequestFile['status'], string> = { added: colors.running, modified: colors.attention, deleted: colors.danger, renamed: colors.accent };

const styles = StyleSheet.create({
  flex: { flex: 1, minWidth: 0 },
  add: { color: colors.running },
  del: { color: colors.danger },
  link: { color: colors.accent, fontSize: 14, paddingVertical: spacing.sm },
  footerText: { color: colors.textFaint, fontSize: 12.5, flexShrink: 1 },
  files: { backgroundColor: 'rgba(0,0,0,0.15)', borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  filesNote: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.lg, paddingVertical: spacing.md, backgroundColor: 'rgba(0,0,0,0.15)' },
  filesWarn: { color: colors.attention, fontSize: 12, paddingHorizontal: spacing.lg, paddingTop: spacing.sm },
  filesHead: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingLeft: spacing.lg, paddingRight: spacing.md, paddingVertical: spacing.xs,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border,
  },
  filesSummary: { flex: 1, minWidth: 0, color: colors.textDim, fontSize: 12.5 },
  filesHint: { color: colors.text, fontWeight: '600' },
  toolGroup: { flexDirection: 'row', borderRadius: 8, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border, overflow: 'hidden' },
  tool: { width: 36, height: 34, alignItems: 'center', justifyContent: 'center' },
  toolOn: { backgroundColor: 'rgba(128,136,255,0.16)' },
  folder: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingRight: spacing.md, paddingVertical: spacing.sm, minHeight: 40 },
  folderName: { flexShrink: 1, color: colors.textDim, fontSize: 13, fontFamily: mono },
  folderCount: { color: colors.textFaint, fontSize: 11.5 },
  fileLine: { flexDirection: 'row', alignItems: 'center' },
  file: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingRight: spacing.md, paddingVertical: spacing.sm, minHeight: 44 },
  fileOpen: { backgroundColor: 'rgba(128,136,255,0.07)' },
  fileLetter: { width: 14, fontFamily: mono, fontSize: 12, fontWeight: '700', textAlign: 'center' },
  fileName: { color: colors.text, fontSize: 13.5, fontFamily: mono },
  fileDir: { color: colors.textFaint, fontSize: 11 },
  fileStats: { fontSize: 11.5, fontFamily: mono },
  viewed: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  viewedDismissed: { opacity: 0.9 },
  diff: { backgroundColor: '#14141a' },
  diffContent: { paddingVertical: spacing.xs, paddingHorizontal: spacing.sm },
  line: { fontFamily: mono, fontSize: 11.5, lineHeight: 16, paddingHorizontal: 4 },
  noPatch: { color: colors.textFaint, fontSize: 12.5, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm },
  pressed: { backgroundColor: colors.surface },
});
