import { router, useLocalSearchParams } from 'expo-router';
import { memo, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';

import { DiffStat } from '@/components/git/CommitDetails';
import { mono } from '@/components/git/diff-style';
import { StepDiffPager } from '@/components/git/StepDiffPager';
import { type FileChange } from '@/git/compare';
import { splitParam, stepTitle, useCompareSteps } from '@/git/compare-queries';
import { STATUS_COLORS, statusLetter } from '@/git/model';
import { useAreaWidth } from '@/layout/size';
import { colors, spacing } from '@/theme';

// From this width the table and the diff sit side by side (an open Duo, a big tablet).
const TWO_COLUMNS = 700;

type Chosen = { path: string; step: number };
type Row = { path: string; cells: (FileChange | null)[] };

/**
 * The files two to four commits of the Git Graph differ in, as a table of files
 * × steps (A→B, B→C, …). A cell opens that file's diff in that step: beside the
 * table when there is room, on its own screen otherwise.
 */
export default function CompareScreen() {
  const { projectId, folder, hashes, labels: labelsParam } = useLocalSearchParams<{ projectId: string; folder: string; hashes: string; labels: string }>();
  const labels = splitParam(labelsParam);
  const width = useAreaWidth();
  const wide = width >= TWO_COLUMNS;
  const { steps, matrix, loading, error } = useCompareSteps(projectId, folder, hashes);
  const [chosen, setChosen] = useState<Chosen | null>(null);

  // The chosen cell stays marked, whether the diff opens beside the table or on its own screen.
  const choose = (path: string, step: number) => {
    setChosen({ path, step });
    if (!wide) router.push({ pathname: '/compare-diff', params: { projectId, folder, hashes, labels: labelsParam, path, step: String(step) } });
  };
  const chosenRow = chosen ? matrix.find((row) => row.path === chosen.path) : undefined;

  if (!steps.length) return <Text style={styles.message}>Pick two to four commits to compare.</Text>;
  if (loading) return <ActivityIndicator style={styles.spinner} color={colors.accent} />;
  if (error) return <Text style={[styles.message, styles.error]}>{error}</Text>;

  const table = (
    <FlatList
      data={matrix}
      keyExtractor={(row) => row.path}
      extraData={chosen}
      stickyHeaderIndices={[0]}
      ListHeaderComponent={(
        <View style={styles.head}>
          <Text style={styles.summary}>
            {matrix.length ? `${matrix.length} file${matrix.length === 1 ? '' : 's'} changed across ${steps.length} step${steps.length === 1 ? '' : 's'}` : 'No files changed'}
          </Text>
          <View style={styles.cells}>
            {steps.map((step, i) => <Text key={`${step.from}:${step.to}`} style={styles.column} numberOfLines={1}>{stepTitle(labels, i)}</Text>)}
          </View>
        </View>
      )}
      renderItem={({ item }) => <FileRow row={item} chosenStep={chosen?.path === item.path ? chosen.step : null} onOpen={choose} />}
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

const FileRow = memo(function FileRow({ row, chosenStep, onOpen }: { row: Row; chosenStep: number | null; onOpen: (path: string, step: number) => void }) {
  // The name opens the first step where the file changed.
  const first = Math.max(0, row.cells.findIndex((cell) => cell));
  return (
    <View style={styles.row}>
      <Pressable onPress={() => onOpen(row.path, first)} accessibilityRole="button" accessibilityHint="Opens the diff" style={({ pressed }) => pressed && styles.pressed}>
        <Text style={styles.path} numberOfLines={1} ellipsizeMode="middle">{row.path}</Text>
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
  summary: { color: colors.textDim, fontSize: 12, fontWeight: '700' },
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
