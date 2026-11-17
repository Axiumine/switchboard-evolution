import Ionicons from '@expo/vector-icons/Ionicons';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, ScrollView, StyleSheet, Text, View, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native';

import { LINE_STYLES, mono } from '@/components/git/diff-style';
import { compareTarget, UNCOMMITTED_HASH, type CompareStep, type FileChange } from '@/git/compare';
import { stepTitle } from '@/git/compare-queries';
import { lineDiff } from '@/git/history';
import { request, useConnection } from '@/store/connection';
import { colors, spacing } from '@/theme';

/**
 * One file's diff, one page per step of the comparison: swipe (or ‹ ›) to see
 * the same file in the step before or after. `cells` is the file's entry in each
 * step, or null where the step left it alone.
 */
export function StepDiffPager({ projectId, folder, path, steps, labels, cells, step, onStep }: {
  projectId: string; folder: string; path: string;
  steps: CompareStep[]; labels: string[]; cells: (FileChange | null)[];
  step: number; onStep: (step: number) => void;
}) {
  const [width, setWidth] = useState(0);
  const list = useRef<FlatList<CompareStep>>(null);
  // The page the list shows now: a swipe sets it, and a change of `step` from outside scrolls to it.
  const settled = useRef(step);
  const last = steps.length - 1;
  const current = Math.min(Math.max(step, 0), last);

  useEffect(() => {
    if (!width || settled.current === current) return;
    settled.current = current;
    list.current?.scrollToOffset({ offset: current * width, animated: true });
  }, [current, width]);

  const settle = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    if (!width) return;
    const index = Math.min(Math.max(Math.round(event.nativeEvent.contentOffset.x / width), 0), last);
    settled.current = index;
    if (index !== current) onStep(index);
  };

  return (
    <View style={styles.pager}>
      <View style={styles.header}>
        <View style={styles.title}>
          <Text style={styles.file} numberOfLines={1} ellipsizeMode="middle">{path}</Text>
          <Text style={styles.stepName} numberOfLines={1}>{stepTitle(labels, current)} · {current + 1}/{steps.length}</Text>
        </View>
        <StepButton icon="chevron-back" label="Previous step" disabled={current <= 0} onPress={() => onStep(current - 1)} />
        <StepButton icon="chevron-forward" label="Next step" disabled={current >= last} onPress={() => onStep(current + 1)} />
      </View>
      <View style={styles.pages} onLayout={(event) => setWidth(Math.round(event.nativeEvent.layout.width))}>
        {width ? (
          <FlatList
            // A new width (rotation, another screen of the Duo) lays the pages out again, at this step.
            key={width}
            ref={list}
            data={steps}
            horizontal
            pagingEnabled
            showsHorizontalScrollIndicator={false}
            keyExtractor={(item) => `${item.from}:${item.to}`}
            initialScrollIndex={current}
            getItemLayout={(_, index) => ({ length: width, offset: width * index, index })}
            onMomentumScrollEnd={settle}
            renderItem={({ item, index }) => (
              <View style={{ width }}>
                <Page projectId={projectId} folder={folder} path={path} step={item} changed={!!cells[index]} />
              </View>
            )}
          />
        ) : null}
      </View>
    </View>
  );
}

function StepButton({ icon, label, disabled, onPress }: { icon: keyof typeof Ionicons.glyphMap; label: string; disabled: boolean; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      hitSlop={6}
      style={({ pressed }) => [styles.stepButton, disabled && styles.disabled, pressed && styles.pressed]}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      <Ionicons name={icon} size={20} color={colors.text} />
    </Pressable>
  );
}

/** The diff of the file in one step, the same lines as the Git Graph's diff screen. */
function Page({ projectId, folder, path, step, changed }: { projectId: string; folder: string; path: string; step: CompareStep; changed: boolean }) {
  const online = useConnection((s) => s.status.state === 'online');
  const result = useQuery({
    queryKey: ['git-graph-diff-between', projectId, folder, step.from, step.to, path],
    // The Git Graph sends both versions; the diff is worked out here.
    queryFn: () => request<{ oldContent?: string; newContent?: string; error?: string }>('get-git-graph-file-diff-between', [projectId, folder, step.from, compareTarget(step.to), path]),
    enabled: online && changed && !!projectId && !!folder && !!path,
    staleTime: step.to === UNCOMMITTED_HASH ? 0 : Infinity,
  });
  const lines = useMemo(() => {
    const data = result.data;
    return !data || data.error ? [] : lineDiff(data.oldContent || '', data.newContent || '');
  }, [result.data]);

  if (!changed) return <Text style={styles.centered}>No change in this step</Text>;
  // Pending, not just loading: offline the query waits, disabled, and an empty answer would read as "No differences".
  if (result.isPending) return <ActivityIndicator style={styles.spinner} color={colors.accent} />;
  const error = result.error?.message || result.data?.error;
  if (error) return <Text style={styles.centered}>{error}</Text>;
  if (!lines.length) return <Text style={styles.centered}>No differences.</Text>;
  return (
    <ScrollView>
      <ScrollView horizontal contentContainerStyle={styles.content}>
        <View>
          {lines.map((line, i) => <Text key={i} style={[styles.line, LINE_STYLES[line.kind]]}>{line.text || ' '}</Text>)}
        </View>
      </ScrollView>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  pager: { flex: 1, backgroundColor: colors.background },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, backgroundColor: colors.surface, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  title: { flex: 1, minWidth: 0, gap: 1 },
  file: { color: colors.text, fontSize: 13, fontFamily: mono },
  stepName: { color: colors.textDim, fontSize: 12 },
  stepButton: { width: 36, height: 36, borderRadius: 8, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.06)' },
  disabled: { opacity: 0.3 },
  pressed: { opacity: 0.6 },
  pages: { flex: 1 },
  centered: { color: colors.textFaint, textAlign: 'center', marginTop: spacing.xl, paddingHorizontal: spacing.lg },
  spinner: { margin: spacing.xl },
  content: { paddingVertical: spacing.md },
  line: { fontFamily: mono, fontSize: 12, lineHeight: 17, paddingHorizontal: spacing.md },
});
