import Ionicons from '@expo/vector-icons/Ionicons';
import { useQuery } from '@tanstack/react-query';
import { router, useLocalSearchParams, useNavigation } from 'expo-router';
import { CommonActions, useNavigationState, useRoute } from 'expo-router/react-navigation';
import { memo, useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';

import { DiffStat } from '@/components/git/CommitDetails';
import { mono } from '@/components/git/diff-style';
import { FileViewToggle, type FileView } from '@/components/git/FileViewToggle';
import { StepDiffPager } from '@/components/git/StepDiffPager';
import { diffRouteAfter, parseSubjects, type FileChange } from '@/git/compare';
import { splitParam, stepTitle, useCompareSteps } from '@/git/compare-queries';
import { STATUS_COLORS, statusLetter, treeRows, type TreeRow } from '@/git/model';
import { useAreaWidth } from '@/layout/size';
import { request, useConnection } from '@/store/connection';
import { colors, spacing } from '@/theme';

// From this width the table and the diff sit side by side (an open Duo, a big tablet).
const TWO_COLUMNS = 700;
const INDENT = 14;

type Chosen = { path: string; step: number };
type Row = { path: string; cells: (FileChange | null)[] };

/**
 * The files two to four commits of the Git Graph differ in, as a table of files
 * × steps (A→B, B→C, …). A cell opens that file's diff in that step: beside the
 * table when there is room, on its own screen otherwise.
 */
export default function CompareScreen() {
  const { projectId, folder, hashes, labels: labelsParam, subjects: subjectsParam } = useLocalSearchParams<{
    projectId: string; folder: string; hashes: string; labels: string; subjects?: string;
  }>();
  const labels = splitParam(labelsParam);
  const subjects = parseSubjects(subjectsParam);
  const width = useAreaWidth();
  const wide = width >= TWO_COLUMNS;
  const online = useConnection((s) => s.status.state === 'online');
  const { steps, matrix, loading, error } = useCompareSteps(projectId, folder, hashes);
  const [chosen, setChosen] = useState<Chosen | null>(null);
  // Always opens as a tree; the desktop's own choice is not the phone's here.
  const [view, setView] = useState<FileView>('tree');
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  // Same query as the Git Graph screen's: the desktop's choice of compact folders.
  const prefs = useQuery({
    queryKey: ['git-graph-preferences'],
    queryFn: () => request<{ preferences?: { compactFolders?: boolean } }>('get-git-graph-global-preferences'),
    enabled: online,
  });
  const compact = prefs.data?.preferences?.compactFolders !== false;

  // On a Surface Duo the diff of the last cell is on the other screen, right after this one:
  // another cell changes that screen's params. Pushing a new one would slide this table
  // back to the right while it arrives.
  const route = useRoute();
  const navigation = useNavigation();
  const diffKey = useNavigationState((state) => diffRouteAfter(state.routes, route.key)?.key ?? null);

  // The chosen cell stays marked, whether the diff opens beside the table or on its own screen.
  const choose = (path: string, step: number) => {
    setChosen({ path, step });
    if (wide) return;
    // The time says it is a new choice even when it is the same file and step: the pager starts over.
    const params = { path, step: String(step), n: String(Date.now()) };
    if (diffKey) navigation.dispatch({ ...CommonActions.setParams(params), source: diffKey });
    else router.push({ pathname: '/compare-diff', params: { projectId, folder, hashes, labels: labelsParam, ...params } });
  };
  const chosenRow = chosen ? matrix.find((row) => row.path === chosen.path) : undefined;

  const rows: TreeRow<Row>[] = useMemo(() => (view === 'tree'
    ? treeRows(matrix, { collapsed, compact })
    : matrix.map((row) => ({ kind: 'file', key: row.path, depth: 0, name: row.path, item: row }))), [matrix, view, collapsed, compact]);
  const toggleFolder = (key: string) => setCollapsed((previous) => {
    const next = new Set(previous);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });

  if (!steps.length) return <Text style={styles.message}>Pick two to four commits to compare.</Text>;
  if (loading) return <ActivityIndicator style={styles.spinner} color={colors.accent} />;
  if (error) return <Text style={[styles.message, styles.error]}>{error}</Text>;

  const table = (
    <FlatList
      data={rows}
      keyExtractor={(row) => `${row.kind === 'folder' ? 'd' : 'f'}:${row.key}`}
      extraData={chosen}
      stickyHeaderIndices={[0]}
      ListHeaderComponent={(
        <View style={styles.head}>
          {labels.map((label, i) => (
            <View key={`${i}:${label}`} style={styles.commit}>
              <Text style={styles.sha} numberOfLines={1}>{label}</Text>
              <Text style={styles.subject} numberOfLines={1}>{subjects[i] || ''}</Text>
            </View>
          ))}
          <View style={styles.summaryLine}>
            <Text style={styles.summary}>
              {matrix.length ? `${matrix.length} file${matrix.length === 1 ? '' : 's'} changed across ${steps.length} step${steps.length === 1 ? '' : 's'}` : 'No files changed'}
            </Text>
            {matrix.length ? <FileViewToggle view={view} onChange={setView} /> : null}
          </View>
          <View style={styles.cells}>
            {steps.map((step, i) => <Text key={`${step.from}:${step.to}`} style={styles.column} numberOfLines={1}>{stepTitle(labels, i)}</Text>)}
          </View>
        </View>
      )}
      renderItem={({ item }) => (item.kind === 'folder' ? (
        <Pressable
          onPress={() => toggleFolder(item.key)}
          style={({ pressed }) => [styles.folder, { paddingLeft: spacing.md + item.depth * INDENT }, pressed && styles.pressed]}
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
        <FileRow row={item.item} name={item.name} indent={view === 'tree' ? item.depth * INDENT + 16 : 0} chosenStep={chosen?.path === item.item.path ? chosen.step : null} onOpen={choose} />
      ))}
    />
  );

  if (!wide) return <View style={styles.screen}>{table}</View>;
  return (
    <View style={[styles.screen, styles.columns]}>
      <View style={styles.tablePane}>{table}</View>
      <View style={styles.diffPane}>
        {chosen && chosenRow ? (
          <StepDiffPager
            projectId={projectId}
            folder={folder}
            path={chosenRow.path}
            steps={steps}
            labels={labels}
            cells={chosenRow.cells}
            step={chosen.step}
            onStep={(step) => setChosen({ path: chosenRow.path, step })}
          />
        ) : <Text style={styles.message}>Pick a file and a step to see its diff.</Text>}
      </View>
    </View>
  );
}

const FileRow = memo(function FileRow({ row, name, indent, chosenStep, onOpen }: {
  row: Row; name: string; indent: number; chosenStep: number | null; onOpen: (path: string, step: number) => void;
}) {
  // The name opens the first step where the file changed.
  const first = Math.max(0, row.cells.findIndex((cell) => cell));
  return (
    <View style={styles.row}>
      <Pressable onPress={() => onOpen(row.path, first)} accessibilityRole="button" accessibilityHint="Opens the diff" style={({ pressed }) => [{ paddingLeft: indent }, pressed && styles.pressed]}>
        <Text style={styles.path} numberOfLines={1} ellipsizeMode="middle">{name}</Text>
      </Pressable>
      <View style={styles.cells}>
        {row.cells.map((cell, step) => (
          <Pressable
            key={step}
            onPress={() => onOpen(row.path, step)}
            style={({ pressed }) => [styles.cell, chosenStep === step && styles.chosen, pressed && styles.pressed]}
            accessibilityRole="button"
            accessibilityState={{ selected: chosenStep === step }}
            accessibilityHint="Opens the diff"
          >
            {cell ? (
              <>
                <Text style={[styles.letter, { color: STATUS_COLORS[cell.status] }]}>{statusLetter(cell)}</Text>
                <DiffStat file={cell} />
              </>
            ) : <Text style={styles.none} accessibilityLabel="No change in this step">·</Text>}
          </Pressable>
        ))}
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  columns: { flexDirection: 'row' },
  tablePane: { flex: 1, minWidth: 0, borderRightWidth: StyleSheet.hairlineWidth, borderRightColor: colors.border },
  diffPane: { flex: 1.4, minWidth: 0 },
  spinner: { margin: spacing.xl },
  message: { color: colors.textFaint, textAlign: 'center', marginTop: spacing.xl, paddingHorizontal: spacing.lg },
  error: { color: colors.danger },
  head: { backgroundColor: colors.surface, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, gap: spacing.xs, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  commit: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  sha: { width: 64, color: colors.accent, fontFamily: mono, fontSize: 11 },
  subject: { flex: 1, color: colors.text, fontSize: 12 },
  summaryLine: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
  summary: { flexShrink: 1, color: colors.textDim, fontSize: 12, fontWeight: '700' },
  folder: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 32, paddingRight: spacing.md, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  folderName: { flex: 1, color: colors.textDim, fontSize: 13, fontFamily: mono },
  count: { color: colors.textFaint, fontSize: 11 },
  cells: { flexDirection: 'row', gap: spacing.xs },
  column: { flex: 1, color: colors.text, fontFamily: mono, fontSize: 11, textAlign: 'center' },
  row: { paddingHorizontal: spacing.md, paddingVertical: spacing.sm, gap: spacing.xs, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  path: { color: colors.text, fontSize: 13, fontFamily: mono },
  cell: { flex: 1, minHeight: 32, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, borderRadius: 6, backgroundColor: 'rgba(255,255,255,0.04)' },
  chosen: { backgroundColor: 'rgba(128,136,255,0.28)' },
  pressed: { opacity: 0.6 },
  letter: { fontFamily: mono, fontSize: 12, fontWeight: '700' },
  none: { color: colors.textFaint, fontSize: 14 },
});
