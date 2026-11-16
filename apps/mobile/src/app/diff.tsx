import Ionicons from '@expo/vector-icons/Ionicons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { lineDiff } from '@/git/history';
import { diffLines, type DiffLine } from '@/git/model';
import { refreshGit, stageFiles, stageLines, useCanStage } from '@/git/stage-requests';
import {
  diffRows, hunkPick, linesLabel, NO_PICKS, pickedLines, stageVerb, toggleHunk, toggleLine, wholeFileOnlyReason, type DiffRow, type Picked, type Side,
} from '@/git/staging';
import { changedLineIndices, parseUnifiedDiff } from '@/shared/vendor/git-diff-model';
import { request, useConnection } from '@/store/connection';
import { colors, spacing } from '@/theme';

const mono = Platform.select({ ios: 'Menlo', default: 'monospace' });

const LINE_STYLES: Record<DiffLine['kind'], object> = {
  meta: { color: colors.textFaint },
  hunk: { color: colors.accent },
  add: { color: '#8fd19e', backgroundColor: 'rgba(76,175,143,0.12)' },
  del: { color: '#f19aa1', backgroundColor: 'rgba(224,108,117,0.12)' },
  context: { color: colors.text },
};

type SideDiff = { ok?: boolean; diff?: string; truncated?: boolean; diffId?: string; error?: string };

/**
 * One file's diff: a changed file against HEAD (get-project-git-diff), or a
 * file between two revisions of the Git Graph (from, to). Opened from the
 * Git tab's Staged Changes or Changes (`side`), the computer's diff of that
 * side is shown with the means to stage or unstage a hunk, picked lines, or
 * the whole file.
 */
export default function DiffScreen() {
  const { projectId, folder, path, oldPath, side: sideParam, from, to } = useLocalSearchParams<{
    projectId: string; folder: string; path: string; oldPath?: string; side?: string; from?: string; to?: string;
  }>();
  const online = useConnection((s) => s.status.state === 'online');
  const canStage = useCanStage();
  const side: Side | null = !from && canStage && (sideParam === 'staged' || sideParam === 'unstaged') ? sideParam : null;
  const result = useQuery({
    queryKey: ['diff', projectId, folder, path, from, to, side],
    queryFn: () => from
      // The Git Graph sends both versions; the diff is worked out here.
      ? request<{ oldContent?: string; newContent?: string; error?: string }>('get-git-graph-file-diff-between', [projectId, folder, from, to || null, path])
      : request<SideDiff>('get-project-git-diff', [projectId, folder, path, ...(side ? [side] : [])]),
    enabled: online && !!projectId && !!folder && !!path,
    refetchOnMount: 'always',
  });
  const lines = useMemo(() => {
    const data: any = result.data;
    if (!data || data.error || side) return [];
    return from ? lineDiff(data.oldContent || '', data.newContent || '') : diffLines(data.diff || '');
  }, [result.data, from, side]);
  const empty = !result.isLoading && !result.data?.error && !lines.length;

  return (
    <View style={styles.screen}>
      <Stack.Screen options={{ title: (path || '').split('/').pop() || 'Diff' }} />
      {result.isLoading ? <ActivityIndicator style={{ margin: spacing.xl }} color={colors.accent} /> : null}
      {result.data?.error ? <Text style={styles.empty}>{result.data.error}</Text> : null}
      {side && !result.isLoading && !result.data?.error ? (
        <StagingDiff projectId={projectId} folder={folder} path={path} oldPath={oldPath} side={side} data={result.data as SideDiff} />
      ) : (
        <>
          {empty ? <Text style={styles.empty}>No differences.</Text> : null}
          <ScrollView>
            <ScrollView horizontal contentContainerStyle={styles.content}>
              <View>
                {lines.map((line, i) => <Text key={i} style={[styles.line, LINE_STYLES[line.kind]]}>{line.text || ' '}</Text>)}
              </View>
            </ScrollView>
          </ScrollView>
        </>
      )}
    </View>
  );
}

/** The diff of one side, by hunk and line, with the buttons that stage it. */
function StagingDiff({ projectId, folder, path, oldPath, side, data }: {
  projectId: string; folder: string; path: string; oldPath?: string; side: Side; data: SideDiff;
}) {
  const queryClient = useQueryClient();
  const insets = useSafeAreaInsets();
  const diff = data?.diff ?? '';
  const diffId = data?.diffId ?? '';
  const parsed = useMemo(() => parseUnifiedDiff(diff), [diff]);
  const rows = useMemo(() => diffRows(parsed), [parsed]);
  const reason = wholeFileOnlyReason(parsed, !!data?.truncated);
  const canPick = !reason && !!diffId;
  const [busy, setBusy] = useState(false);
  // The picks are lines of one diff: another diff (the file changed) starts with none.
  const [picks, setPicks] = useState<{ diffId: string; set: Picked }>({ diffId: '', set: NO_PICKS });
  const picked = picks.diffId === diffId ? picks.set : NO_PICKS;
  const setPicked = (set: Picked) => setPicks({ diffId, set });
  const verb = stageVerb(side);
  const count = pickedLines(parsed, picked).length;

  /** Read the changes and the diff again, whatever happened. */
  const refresh = () => refreshGit(queryClient, projectId);

  const applyLines = async (lines: number[]) => {
    if (!lines.length || busy) return;
    setBusy(true);
    try {
      const outcome = await stageLines(projectId, folder, path, side, diffId, lines);
      setPicks({ diffId: '', set: NO_PICKS });
      if (!outcome.ok) {
        if (outcome.stale) Alert.alert('The file changed', `It changed after this diff was read, so nothing was ${verb === 'Stage' ? 'staged' : 'unstaged'}. The diff is read again: pick the lines once more.`);
        else Alert.alert(`Could not ${verb.toLowerCase()}`, outcome.error);
      }
    } finally {
      await refresh();
      setBusy(false);
    }
  };

  const applyFile = async () => {
    if (busy) return;
    setBusy(true);
    try {
      // Unstaging a renamed file names the old path too, or the deletion would stay staged.
      await stageFiles(projectId, folder, side === 'staged' && oldPath ? [path, oldPath] : [path], side === 'unstaged');
      setPicks({ diffId: '', set: NO_PICKS });
    } catch (err: any) {
      Alert.alert(`Could not ${verb.toLowerCase()}`, err?.message || String(err));
    } finally {
      await refresh();
      setBusy(false);
    }
  };

  const renderRow = (row: DiffRow) => {
    if (row.kind === 'meta') return <Text key={row.key} style={[styles.line, styles.meta]}>{row.text || ' '}</Text>;
    if (row.kind === 'hunk') {
      const state = hunkPick(parsed, row.hunk, picked);
      return (
        <View key={row.key} style={styles.hunk}>
          <Text style={styles.hunkText} numberOfLines={1}>{row.text}</Text>
          {canPick ? (
            <View style={styles.hunkButtons}>
              <SmallButton
                label={state === 'all' ? 'Unselect' : 'Select'}
                icon={state === 'all' ? 'checkmark-circle' : state === 'some' ? 'remove-circle-outline' : 'ellipse-outline'}
                onPress={() => setPicked(toggleHunk(parsed, row.hunk, picked))}
                accessibilityLabel={`${state === 'all' ? 'Unselect' : 'Select'} the lines of this hunk`}
              />
              <SmallButton
                label={`${verb} Hunk`}
                icon={side === 'unstaged' ? 'add' : 'remove'}
                primary
                disabled={busy}
                onPress={() => applyLines(changedLineIndices(parsed, row.hunk))}
                accessibilityLabel={`${verb} this hunk`}
              />
            </View>
          ) : null}
        </View>
      );
    }
    const changed = row.lineKind === 'add' || row.lineKind === 'remove';
    const on = changed && picked.has(row.index);
    const style = row.lineKind === 'add' ? LINE_STYLES.add : row.lineKind === 'remove' ? LINE_STYLES.del : row.lineKind === 'eof' ? LINE_STYLES.meta : LINE_STYLES.context;
    const content = (
      <>
        <View style={styles.gutter}>
          {canPick && changed ? <Ionicons name={on ? 'checkmark-circle' : 'ellipse-outline'} size={15} color={on ? colors.accent : colors.textFaint} /> : null}
        </View>
        <Text style={[styles.lineText, style]}>{row.text || ' '}</Text>
      </>
    );
    return canPick && changed ? (
      <Pressable
        key={row.key}
        onPress={() => setPicked(toggleLine(picked, row.index))}
        style={[styles.lineRow, style, on && styles.picked]}
        accessibilityRole="checkbox"
        accessibilityState={{ checked: on }}
        accessibilityLabel={row.text}
      >
        {content}
      </Pressable>
    ) : <View key={row.key} style={[styles.lineRow, style]}>{content}</View>;
  };

  if (!rows.length) return <Text style={styles.empty}>{side === 'staged' ? 'Nothing is staged in this file.' : 'Nothing left to stage in this file.'}</Text>;

  return (
    <>
      <ScrollView style={styles.body}>
        <ScrollView horizontal contentContainerStyle={styles.content}>
          <View>{rows.map(renderRow)}</View>
        </ScrollView>
      </ScrollView>
      <View style={[styles.bar, { paddingBottom: insets.bottom + spacing.md }]}>
        {reason ? <Text style={styles.reason}>{reason}</Text> : null}
        <View style={styles.barButtons}>
          {count > 0 ? (
            <>
              <BarButton label={linesLabel(side, count)} primary disabled={busy} onPress={() => applyLines(pickedLines(parsed, picked))} />
              <BarButton label="Clear" disabled={busy} onPress={() => setPicked(NO_PICKS)} />
            </>
          ) : null}
          <BarButton label={`${verb} file`} disabled={busy} onPress={applyFile} />
          {busy ? <ActivityIndicator size="small" color={colors.accent} /> : null}
        </View>
      </View>
    </>
  );
}

function SmallButton({ label, icon, primary, disabled, onPress, accessibilityLabel }: {
  label: string; icon: keyof typeof Ionicons.glyphMap; primary?: boolean; disabled?: boolean; onPress: () => void; accessibilityLabel: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      hitSlop={4}
      style={({ pressed }) => [styles.small, primary && styles.smallPrimary, disabled && styles.disabled, pressed && styles.pressed]}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
    >
      <Ionicons name={icon} size={14} color={primary ? colors.accent : colors.textDim} />
      <Text style={[styles.smallText, primary && styles.smallTextPrimary]}>{label}</Text>
    </Pressable>
  );
}

function BarButton({ label, primary, disabled, onPress }: { label: string; primary?: boolean; disabled?: boolean; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [styles.barButton, primary && styles.barPrimary, disabled && styles.disabled, pressed && styles.pressed]}
      accessibilityRole="button"
    >
      <Text style={[styles.barText, primary && styles.barTextPrimary]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  body: { flex: 1 },
  content: { paddingVertical: spacing.md },
  line: { fontFamily: mono, fontSize: 12, lineHeight: 17, paddingHorizontal: spacing.md },
  meta: { color: colors.textFaint },
  empty: { color: colors.textFaint, textAlign: 'center', marginTop: spacing.xl, paddingHorizontal: spacing.lg },
  hunk: { paddingHorizontal: spacing.md, paddingTop: spacing.sm, paddingBottom: 4, gap: 6, marginTop: spacing.sm, backgroundColor: 'rgba(128,136,255,0.07)' },
  hunkText: { fontFamily: mono, fontSize: 12, lineHeight: 17, color: colors.accent },
  hunkButtons: { flexDirection: 'row', gap: spacing.sm },
  lineRow: { flexDirection: 'row', alignItems: 'center' },
  gutter: { width: 28, alignItems: 'center', justifyContent: 'center' },
  lineText: { fontFamily: mono, fontSize: 12, lineHeight: 19, paddingRight: spacing.md },
  picked: { backgroundColor: 'rgba(128,136,255,0.28)' },
  small: { flexDirection: 'row', alignItems: 'center', gap: 5, height: 30, paddingHorizontal: spacing.md, borderRadius: 8, backgroundColor: 'rgba(255,255,255,0.06)' },
  smallPrimary: { backgroundColor: 'rgba(128,136,255,0.16)' },
  smallText: { color: colors.textDim, fontSize: 13, fontWeight: '600' },
  smallTextPrimary: { color: colors.accent },
  disabled: { opacity: 0.4 },
  pressed: { opacity: 0.6 },
  bar: { gap: spacing.sm, padding: spacing.md, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border, backgroundColor: colors.surface },
  reason: { color: colors.textFaint, fontSize: 12 },
  barButtons: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: spacing.sm },
  barButton: { minHeight: 40, paddingHorizontal: spacing.lg, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.08)' },
  barPrimary: { backgroundColor: 'rgba(128,136,255,0.22)' },
  barText: { color: colors.text, fontSize: 14.5, fontWeight: '600' },
  barTextPrimary: { color: '#e4e4fa' },
});
