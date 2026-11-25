import Ionicons from '@expo/vector-icons/Ionicons';
import { useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { router, Stack } from 'expo-router';
import { Fragment, memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Animated, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Circle, Path } from 'react-native-svg';

import { CommitDetails, type FileView } from '@/components/git/CommitDetails';
import { usePullRefresh } from '@/components/PullRefresh';
import { Sheet, type SheetOption } from '@/components/Sheet';
import { TextPrompt } from '@/components/TextPrompt';
import { COMPARE_MAX, compareBase, compareLabel, compareOrder, compareParams } from '@/git/compare';
import { forceRetry, pushAction, rowActions, type GraphAction } from '@/git/actions';
import { graphRows, laneColour, LANE_WIDTH, ROW_HEIGHT, type GraphRow } from '@/git/graph';
import type { HistoryRow } from '@/git/history';
import {
  commonFolder, grownLimits, initialLimit, mergeSlices, morePlan, plainRow, repoKey, sliceInfo, splitKey, type GraphData, type RepoRow, type Slice,
} from '@/git/multi-history';
import { repoLabel } from '@/git/repo-choice';
import { badgeTexts, BADGE_GAP, BADGE_PADDING, BADGE_SIZE, estimateTextWidth, META_SIZE, SUBJECT_SIZE } from '@/git/row-width';
import { relativeTime, shortProjectPath } from '@/sessions/model';
import { onDesktopEvent, request, useConnection } from '@/store/connection';
import { colors, spacing } from '@/theme';

// The desktop's default palette (git-graph-service.js graphColours), until its preferences arrive.
const DEFAULT_COLOURS = [
  '#69c47c', '#df7180', '#e0aa63', '#8992dc',
  '#5fb3d9', '#c77dd1', '#9fd15a', '#e08fb0',
  '#6fa8e0', '#d1a5e0', '#7fd1b8', '#e0c05f',
];
// The tick box before the graph in each row.
const CHECK_WIDTH = 24;
// A row's padding on the left and right, and the gap between the graph and the text.
const ROW_LEFT = spacing.sm;
const ROW_RIGHT = spacing.md;
const TEXT_GAP = spacing.sm;
// A push or a fetch may take the computer up to two minutes.
const ACTION_TIMEOUT_MS = 130_000;

/**
 * The Git Graph of one repository of a project, or of several at once: their
 * commits merged into one list, newest first, each row starting its line under
 * the subject with the repository's name in its color. On its own page (the
 * default) the actions sit in the header; `embedded`, as a view of the Git tab,
 * they are a row above the list, and the page's header is left alone.
 *
 * Every request goes to the folder of the row it is about; the toolbar's
 * (fetch, push, the sheet's title) goes to `primary`, the first folder unless
 * the Git tab says otherwise. `onReviewChanges` replaces the push to the Git
 * screen for "Review changes".
 */
export function GitGraphView({ projectId, folders, primary: primaryFolder, repoColors, embedded = false, onReviewChanges }: {
  projectId: string; folders: readonly string[]; primary?: string; repoColors?: Record<string, string>; embedded?: boolean; onReviewChanges?: () => void;
}) {
  const online = useConnection((s) => s.status.state === 'online');
  const multi = folders.length > 1;
  const primary = primaryFolder && folders.includes(primaryFolder) ? primaryFolder : folders[0];
  const initial = initialLimit(folders.length);
  // How many commits each folder is asked for: Load more grows only the folders the merge needs more of.
  const [limits, setLimits] = useState<Record<string, number>>({});
  const [selected, setSelected] = useState<RepoRow | null>(null);
  const [naming, setNaming] = useState<{ action: GraphAction; folder: string } | null>(null);
  const [toolbar, setToolbar] = useState(false);
  const [running, setRunning] = useState<{ label: string; actionId: string; folder: string; progress: string } | null>(null);
  // The row whose details are open under it, as on the desktop; the files as a tree or a list (for that row
  // only: the next one opens in the desktop's default again); the file opened last.
  const [expanded, setExpanded] = useState<string | null>(null);
  const [fileView, setFileView] = useState<FileView | null>(null);
  const [lastViewed, setLastViewed] = useState<string | null>(null);
  // The commits ticked for Compare, once Enable Selection (in "•••") shows the checkboxes.
  const [selecting, setSelecting] = useState(false);
  const [checked, setChecked] = useState<ReadonlySet<string>>(new Set());
  const list = useRef<FlatList<RepoRow>>(null);
  const queryClient = useQueryClient();
  const insets = useSafeAreaInsets();

  // One query per folder: the computer's API is per folder.
  const graphs = useQueries({
    queries: folders.map((folder) => {
      const limit = limits[folder] ?? initial;
      return {
        queryKey: ['git-graph', projectId, folder, limit],
        queryFn: () => request<GraphData>('get-project-git-graph', [projectId, folder, {
          limit, order: 'date', branches: 'all', showRemote: true, showTags: true, showStashes: true, showUncommittedChanges: true,
        }]),
        enabled: online && !!projectId && !!folder,
        placeholderData: (previous: GraphData | undefined) => previous,
        refetchOnMount: 'always' as const,
      };
    }),
    combine: (results) => ({
      datas: results.map((result) => result.data),
      errors: results.map((result) => result.data?.error ?? result.error?.message ?? null),
      loading: results.some((result) => result.isLoading),
      fetching: results.some((result) => result.isFetching),
    }),
  });
  const { datas, errors, loading, fetching } = graphs;
  const refetchFolder = useCallback((folder: string) => queryClient.invalidateQueries({ queryKey: ['git-graph', projectId, folder] }), [projectId, queryClient]);
  const prefs = useQuery({
    queryKey: ['git-graph-preferences'],
    queryFn: () => request<{ preferences?: { graphColours?: string[]; fileViewType?: FileView; compactFolders?: boolean } }>('get-git-graph-global-preferences'),
    enabled: online,
  });
  // The repository watcher does not see the git config, where remotes live: read them when a menu opens. The
  // remotes of the row's folder while its menu is open, else the toolbar's.
  const remotesFolder = selected?.folder ?? primary;
  const remotes = useQuery({ queryKey: ['git-remotes', projectId, remotesFolder], queryFn: () => request<{ remotes?: { name: string }[] }>('get-git-graph-remotes', [projectId, remotesFolder]), enabled: online && !!remotesFolder, refetchOnMount: 'always' });
  const palette = prefs.data?.preferences?.graphColours?.length ? prefs.data.preferences.graphColours : DEFAULT_COLOURS;
  const remoteNames = (remotes.data?.remotes || []).map((r) => r.name);
  // The desktop's choices until one is made for the open row; the phone cannot change the desktop's.
  const view: FileView = fileView || (prefs.data?.preferences?.fileViewType === 'list' ? 'list' : 'tree');
  const compact = prefs.data?.preferences?.compactFolders !== false;

  const slices = useMemo<Slice[]>(
    () => folders.map((folder, index) => ({ folder, data: datas[index], limit: limits[folder] ?? initial })),
    [folders, datas, limits, initial],
  );
  const infos = useMemo(() => Object.fromEntries(slices.map((slice) => [slice.folder, sliceInfo(slice.data)])), [slices]);
  const merged = useMemo(() => mergeSlices(slices), [slices]);
  const history = merged.rows;
  const more = useMemo(() => morePlan(slices, merged.held), [slices, merged.held]);
  const { layout, lanes } = useMemo(() => {
    const { rows, lanes } = graphRows(history);
    return { layout: rows, lanes };
  }, [history]);
  const byKey = useMemo(() => new Map(history.map((row) => [row.hash, row])), [history]);
  // The repository's name and color before each row's line under the subject, with several shown.
  const repoTags = useMemo(
    () => (multi ? Object.fromEntries(folders.map((folder) => [folder, { name: repoLabel(folder), color: repoColors?.[folder] }])) : {}),
    [multi, folders, repoColors],
  );
  // A row dropped or reset away takes its details with it.
  const open = expanded && byKey.has(expanded) ? expanded : null;
  const openRow = open ? byKey.get(open) ?? null : null;
  const openPlain = useMemo(() => (openRow ? plainRow(openRow) : null), [openRow]);
  // A row dropped or reset away is no longer ticked (like the open row, it is read against what is loaded).
  const ticked = useMemo(() => new Set([...checked].filter((hash) => byKey.has(hash))), [checked, byKey]);
  const extraData = useMemo(() => ({ open, view, lastViewed, ticked, selecting, repoTags }), [open, view, lastViewed, ticked, selecting, repoTags]);
  const primaryInfo = infos[primary] ?? sliceInfo(undefined);

  // Sideways the list is as wide as its widest row, guessed for every loaded row and measured for the ones drawn,
  // so a long subject and every branch on it can be read. The open row's details stay in sight as it scrolls.
  const foldersKey = folders.join('\n');
  const [viewport, setViewport] = useState(0);
  const [measured, setMeasured] = useState({ key: foldersKey, width: 0 });
  const [scrollX] = useState(() => new Animated.Value(0));
  const onScrollX = useMemo(() => Animated.event([{ nativeEvent: { contentOffset: { x: scrollX } } }], { useNativeDriver: true }), [scrollX]);
  const onRowWidth = useCallback((width: number) => {
    setMeasured((m) => (m.key === foldersKey && width <= m.width + 0.5 ? m : { key: foldersKey, width: Math.max(m.key === foldersKey ? m.width : 0, width) }));
  }, [foldersKey]);
  const graphWidth = Math.max(lanes, 1) * LANE_WIDTH;
  const guessed = useMemo(() => history.reduce((widest, row) => Math.max(widest, estimateTextWidth(row, repoTags[row.folder]?.name)), 0), [history, repoTags]);
  const chrome = ROW_LEFT + (selecting ? CHECK_WIDTH : 0) + graphWidth + TEXT_GAP + ROW_RIGHT;
  const contentWidth = Math.ceil(Math.max(viewport, chrome + guessed, measured.key === foldersKey ? measured.width : 0));


  // The repository changed (here, on the computer, or from a terminal), and the progress of a network action.
  useEffect(() => onDesktopEvent((event, args) => {
    if (event === 'git-graph-repo-changed' && folders.includes(args[0])) {
      // Only that folder is read again.
      refetchFolder(args[0]);
      queryClient.invalidateQueries({ queryKey: ['git-graph-details', projectId, args[0], '#uncommitted'] });
    }
    if (event === 'git-graph-action-progress' && folders.includes(args[0]?.folderPath)) {
      setRunning((r) => (r && r.actionId === args[0].actionId && r.folder === args[0].folderPath ? { ...r, progress: args[0].text } : r));
    }
  }), [folders, projectId, queryClient, refetchFolder]);

  /** Brings a row to the top of the list, or as far up as the list goes. */
  function scrollToRow(hash: string) {
    const index = history.findIndex((row) => row.hash === hash);
    // Every row above the open one is a plain row: its offset needs no measuring.
    if (index >= 0) requestAnimationFrame(() => list.current?.scrollToOffset({ offset: index * ROW_HEIGHT, animated: true }));
  }

  /** Opens a row's details under it (or closes them), and brings the row to the top so they show. */
  function toggle(hash: string) {
    if (open === hash) { setExpanded(null); return; }
    setExpanded(hash);
    setFileView(null);
    setLastViewed(null);
    scrollToRow(hash);
  }

  // Compare with, as on the desktop: the commit open, else the only one ticked.
  const base = compareBase(open, ticked);
  const toggleCheck = (hash: string) => {
    // Ticking from the long-press menu turns the selection on, so the tick is in sight.
    setSelecting(true);
    setChecked((previous) => {
      const next = new Set(previous);
      if (next.has(hash)) next.delete(hash); else next.add(hash);
      return next;
    });
  };
  const loadedHashes = history.map((row) => row.hash);
  const selectionOptions: SheetOption[] = selecting
    ? [
      { label: 'Select All', hint: `${loadedHashes.length} loaded`, onPress: () => setChecked(new Set(loadedHashes)) },
      ...(ticked.size ? [{ label: 'Deselect All', onPress: () => setChecked(new Set()) }] : []),
      { label: 'Invert Selection', onPress: () => setChecked(new Set(loadedHashes.filter((hash) => !ticked.has(hash)))) },
      { label: 'Cancel Selection', onPress: () => { setSelecting(false); setChecked(new Set()); } },
    ]
    : [{ label: 'Enable Selection', hint: 'tick commits to compare them', onPress: () => setSelecting(true) }];

  // Commits compare within one repository: ticked from several, Compare is off.
  const tickedFolder = commonFolder(history.filter((row) => ticked.has(row.hash)));
  const mixed = ticked.size > 1 && tickedFolder === null;
  const canCompare = ticked.size <= COMPARE_MAX && !mixed;

  /** Opens the comparison of these commits, oldest first, in their repository. */
  function compare(hashes: Iterable<string>) {
    const rows = compareOrder(history, hashes).map((hash) => byKey.get(hash)).filter((row): row is RepoRow => !!row).map(plainRow);
    const folder = commonFolder(rows);
    if (!folder) return;
    router.push({ pathname: '/compare', params: { projectId, folder, ...compareParams(rows, rows.map((row) => row.hash)) } });
  }

  async function run(action: GraphAction, folder: string) {
    setRunning({ label: action.label, actionId: action.actionId, folder, progress: '' });
    try {
      const result = await request<{ ok?: boolean; error?: string }>('run-git-graph-action', [projectId, folder, action.actionId, action.params], { timeoutMs: ACTION_TIMEOUT_MS });
      if (result?.error) {
        const retry = forceRetry(action, result.error);
        if (retry) confirmThen(retry, (item) => run(item, folder));
        else Alert.alert(action.label, result.error);
      }
    } catch (err: any) {
      Alert.alert(action.label, err.message);
    } finally {
      setRunning(null);
      refetchFolder(folder);
    }
  }

  const choose = (action: GraphAction, folder: string) => {
    if (action.prompt) setNaming({ action, folder });
    else confirmThen(action, (item) => run(item, folder));
  };

  const pushCurrent = primaryInfo.currentBranch ? pushAction(primaryInfo.currentBranch, primaryInfo.upstreams[primaryInfo.currentBranch], remoteNames) : null;
  const toolbarOptions: SheetOption[] = [
    ...selectionOptions,
    ...(remoteNames.length ? [{ label: multi ? `Fetch ${repoLabel(primary)} from all remotes` : 'Fetch from all remotes', onPress: () => run({ label: 'Fetch', actionId: 'fetchAllRemotes', params: {} }, primary) }] : []),
    ...(pushCurrent ? [{ label: pushCurrent.label, onPress: () => run(pushCurrent, primary) }] : []),
    { label: 'Review changes', onPress: onReviewChanges ?? (() => router.push({ pathname: '/git', params: { projectId } })) },
  ];
  /** What a long press on a row offers: compare, tick, and the actions of its repository (its branch, remotes, upstreams). */
  const rowOptions = (row: RepoRow): SheetOption[] => {
    const info = infos[row.folder] ?? sliceInfo(undefined);
    const baseRow = base ? byKey.get(base) : undefined;
    return [
      // Only against a commit of the same repository.
      ...(baseRow && baseRow.hash !== row.hash && baseRow.folder === row.folder
        ? [{ label: `Compare with ${compareLabel(baseRow)}`, onPress: () => { setExpanded(null); compare([baseRow.hash, row.hash]); } }]
        : []),
      { label: ticked.has(row.hash) ? 'Unselect for Compare' : 'Select for Compare', onPress: () => toggleCheck(row.hash) },
      ...rowActions(plainRow(row), { currentBranch: info.currentBranch, remotes: remoteNames, upstreams: info.upstreams })
        .map((action) => ({ label: action.label, destructive: action.destructive, onPress: () => choose(action, row.folder) })),
    ];
  };
  const pull = usePullRefresh(() => Promise.all(folders.map((folder) => queryClient.refetchQueries({ queryKey: ['git-graph', projectId, folder], type: 'active' }))));

  // "On main", one per repository in its color with several shown (the desktop's HEAD chips).
  const branches = folders.map((folder) => {
    const info = infos[folder];
    const text = info?.currentBranch ? `On ${info.currentBranch}` : info?.headHash ? `Detached at ${info.headHash.slice(0, 7)}` : null;
    return text ? { folder, text, color: repoColors?.[folder] } : null;
  }).filter((item): item is { folder: string; text: string; color: string | undefined } => !!item);
  const branchLine = multi
    ? branches.map((item, index) => <Text key={item.folder} style={item.color ? { color: item.color } : undefined}>{index ? '  ·  ' : ''}{item.text}</Text>)
    : branches[0]?.text;
  const hasBranch = branches.length > 0;
  const actions = (
    <View style={styles.headerButtons}>
      {selecting ? <Text style={styles.selectedCount}>{ticked.size} selected</Text> : null}
      <Pressable onPress={() => { remotes.refetch(); setToolbar(true); }} hitSlop={10} accessibilityLabel="Selection and repository actions">
        <Text style={styles.headerButton}>•••</Text>
      </Pressable>
    </View>
  );

  return (
    <View style={styles.screen}>
      {embedded ? (
        <View style={styles.actionRow}>
          {hasBranch ? <Text style={styles.branchInRow} numberOfLines={1}>{branchLine}</Text> : <View style={styles.fill} />}
          {actions}
        </View>
      ) : (
        <>
          <Stack.Screen options={{ title: shortProjectPath(primary || ''), headerRight: () => actions }} />
          {hasBranch ? <Text style={styles.branch} numberOfLines={1}>{branchLine}</Text> : null}
        </>
      )}
      {running ? (
        <View style={styles.running}>
          <ActivityIndicator color={colors.accent} />
          <Text style={styles.runningText} numberOfLines={2}>{running.progress || `${running.label}…`}</Text>
          <Pressable onPress={() => request('cancel-git-graph-action', [projectId, running.folder, running.actionId]).catch(() => {})} hitSlop={10}>
            <Text style={styles.cancel}>Cancel</Text>
          </Pressable>
        </View>
      ) : null}
      {/* A repository that failed does not blank the others: one line each, with a way to try again. */}
      {errors.map((error, index) => (error ? (
        <View key={folders[index]} style={multi ? styles.errorRow : undefined}>
          <Text style={multi ? styles.errorText : styles.empty}>{multi ? `${repoLabel(folders[index])}: ${error}` : error}</Text>
          {multi ? (
            <Pressable onPress={() => refetchFolder(folders[index])} hitSlop={8} accessibilityRole="button" accessibilityLabel={`Try ${repoLabel(folders[index])} again`}>
              <Text style={styles.retry}>Retry</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null))}
      <Animated.ScrollView
        horizontal
        style={styles.fill}
        onLayout={(e) => setViewport(e.nativeEvent.layout.width)}
        onScroll={onScrollX}
        scrollEventThrottle={16}
        showsHorizontalScrollIndicator
      >
      <FlatList
        ref={list}
        style={{ width: contentWidth }}
        data={history}
        keyExtractor={(row) => row.hash}
        extraData={extraData}
        renderItem={({ item, index }) => {
          const { tag } = splitKey(item.hash);
          return (
          <Fragment>
            <CommitRow
              row={item}
              geometry={layout[index]}
              lanes={lanes}
              palette={palette}
              repo={repoTags[item.folder]}
              selected={item.hash === open}
              selecting={selecting}
              checked={ticked.has(item.hash)}
              onToggleCheck={() => toggleCheck(item.hash)}
              onPress={() => toggle(item.hash)}
              onLongPress={() => { queryClient.invalidateQueries({ queryKey: ['git-remotes', projectId, item.folder] }); setSelected(item); }}
              onWidth={onRowWidth}
            />
            {item.hash === open && openPlain ? (
              <Animated.View style={{ width: viewport || undefined, transform: [{ translateX: scrollX }] }}>
              <CommitDetails
                key={item.hash}
                projectId={projectId}
                folder={item.folder}
                row={openPlain}
                headHash={infos[item.folder]?.headHash ?? null}
                below={layout[index].below}
                graphWidth={graphWidth}
                leading={selecting ? CHECK_WIDTH : 0}
                colour={(i) => laneColour(palette, i)}
                fileView={view}
                onFileView={setFileView}
                compact={compact}
                lastViewed={lastViewed}
                onViewed={setLastViewed}
                // Its parents are git's hashes: they are in this repository's rows.
                isLoaded={(sha) => byKey.has(repoKey(tag, sha))}
                onOpenCommit={(sha) => { const key = repoKey(tag, sha); if (key !== open) toggle(key); }}
                onClose={() => setExpanded(null)}
                // Near the end of the list the details only fit once they are there.
                onShown={() => scrollToRow(item.hash)}
              />
              </Animated.View>
            ) : null}
          </Fragment>
          );
        }}
        // With a row open the heights differ: the list measures them itself.
        getItemLayout={open ? undefined : (_, index) => ({ length: ROW_HEIGHT, offset: ROW_HEIGHT * index, index })}
        initialNumToRender={25}
        windowSize={11}
        refreshControl={pull}
        onEndReached={() => { if (more.length && !fetching) setLimits((l) => grownLimits(l, more, initial)); }}
        onEndReachedThreshold={0.5}
        ListEmptyComponent={loading ? <ActivityIndicator style={{ margin: spacing.xl }} color={colors.accent} /> : <Text style={styles.empty}>No commits.</Text>}
        ListFooterComponent={merged.hasMore && more.length ? <ActivityIndicator style={{ margin: spacing.lg }} color={colors.textFaint} /> : undefined}
      />
      </Animated.ScrollView>
      {ticked.size >= 2 ? (
        <View style={[styles.compareBar, { paddingBottom: (embedded ? 0 : insets.bottom) + spacing.md }]}>
          <Text style={styles.compareText}>
            {mixed ? 'Compare commits of one repository' : ticked.size > COMPARE_MAX ? `Compare up to ${COMPARE_MAX} commits` : `${ticked.size} selected`}
          </Text>
          <Pressable
            onPress={() => compare(ticked)}
            disabled={!canCompare}
            style={({ pressed }) => [styles.compareButton, !canCompare && styles.compareDisabled, pressed && styles.compareDisabled]}
            accessibilityRole="button"
            accessibilityState={{ disabled: !canCompare }}
          >
            <Text style={styles.compareButtonText}>Compare</Text>
          </Pressable>
        </View>
      ) : null}
      <Sheet
        visible={!!selected}
        title={selected ? `${multi ? `${repoLabel(selected.folder)} · ` : ''}${selected.shortHash ? `${selected.shortHash} · ` : ''}${selected.subject}` : ''}
        options={selected ? rowOptions(selected) : []}
        onClose={() => setSelected(null)}
      />
      <Sheet visible={toolbar} title={shortProjectPath(primary || '')} options={toolbarOptions} onClose={() => setToolbar(false)} />
      <TextPrompt
        visible={!!naming}
        title={naming?.action.prompt?.title || ''}
        initialValue={naming?.action.prompt?.initial || ''}
        confirm="OK"
        onClose={() => setNaming(null)}
        onSubmit={(value) => {
          const { action, folder } = naming ?? {};
          if (action?.prompt && folder && value && value !== action.prompt.initial) run({ ...action, params: { ...action.params, [action.prompt.key]: value } }, folder);
        }}
      />
    </View>
  );
}

/** Ask "Are you sure?" first when the desktop does. */
function confirmThen(action: GraphAction, run: (action: GraphAction) => void) {
  if (!action.confirm) { run(action); return; }
  Alert.alert('Are you sure?', action.confirm, [
    { text: 'Cancel', style: 'cancel' },
    { text: 'Continue', style: action.destructive ? 'destructive' : 'default', onPress: () => run(action) },
  ]);
}

const CommitRow = memo(function CommitRow({ row, geometry, lanes, palette, repo, selected, selecting, checked, onToggleCheck, onPress, onLongPress, onWidth }: {
  row: HistoryRow; geometry: GraphRow; lanes: number; palette: string[];
  /** The repository the row is from, when several are shown: its name starts the line under the subject, in its color. */
  repo?: { name: string; color?: string };
  selected: boolean; selecting: boolean; checked: boolean;
  onToggleCheck: () => void; onPress: () => void; onLongPress: () => void;
  /** The width the row needs, once its text is drawn: the list widens to the widest. */
  onWidth: (width: number) => void;
}) {
  const colour = (index: number) => laneColour(palette, index);
  const refs = row.refs || { heads: [], remotes: [], tags: [] };
  // Every ref in full, in badgeTexts' order: branches, remote branches, tags.
  const kinds = [...refs.heads.map(() => styles.badgeHead), ...refs.remotes.map(() => styles.badgeRemote), ...refs.tags.map(() => styles.badgeTag)];
  const badges = badgeTexts(row).map((text, i) => ({ key: `${i}:${text}`, text, style: kinds[i] }));
  const special = row.kind !== 'commit';
  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      style={({ pressed }) => [styles.row, selected && styles.selected, pressed && styles.pressed]}
      accessibilityRole="button"
      accessibilityState={{ expanded: selected }}
      accessibilityHint="Shows the files it changed. Long press for actions."
    >
      {/* Only with the selection on; its own press: ticking a row does not open it. */}
      {selecting ? (
        <Pressable
          onPress={onToggleCheck}
          hitSlop={{ top: 4, bottom: 4, left: 8, right: 0 }}
          style={styles.check}
          accessibilityRole="checkbox"
          accessibilityState={{ checked }}
          accessibilityLabel="Select for Compare"
        >
          <Ionicons name={checked ? 'checkbox' : 'square-outline'} size={20} color={checked ? colors.accent : colors.textFaint} />
        </Pressable>
      ) : null}
      <Svg width={Math.max(lanes, 1) * LANE_WIDTH} height={ROW_HEIGHT}>
        {geometry.segments.map((segment, i) => <Path key={i} d={segment.d} stroke={colour(segment.colorIndex)} strokeWidth={2} fill="none" />)}
        <Circle
          cx={geometry.node.x} cy={ROW_HEIGHT / 2} r={row.isHead ? 5 : 4}
          fill={special ? colors.background : colour(geometry.node.colorIndex)}
          stroke={colour(geometry.node.colorIndex)} strokeWidth={special || row.isHead ? 2 : 0}
        />
      </Svg>
      {/* As wide as its text: the list is wider than the screen when a row needs it, and scrolls sideways. */}
      <View style={styles.text} onLayout={(e) => onWidth(e.nativeEvent.layout.x + e.nativeEvent.layout.width + ROW_RIGHT)}>
        <View style={styles.subjectLine}>
          {badges.map((badge) => <Text key={badge.key} style={[styles.badge, badge.style]} numberOfLines={1}>{badge.text}</Text>)}
          <Text style={[styles.subject, special && styles.special]} numberOfLines={1}>{row.subject}</Text>
        </View>
        {row.kind === 'commit' || repo ? (
          <Text style={styles.meta} numberOfLines={1}>
            {repo ? <Text style={[styles.repoName, repo.color ? { color: repo.color } : null]}>{repo.name}</Text> : null}
            {repo && row.kind === 'commit' ? ' · ' : ''}
            {row.kind === 'commit' ? `${row.shortHash} · ${row.authorName} · ${relativeTime(row.commitDate)}` : ''}
          </Text>
        ) : null}
      </View>
    </Pressable>
  );
});

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  fill: { flex: 1 },
  actionRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md, paddingHorizontal: spacing.lg, minHeight: 40, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  branchInRow: { flex: 1, color: colors.textDim, fontSize: 12 },
  headerButtons: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  headerButton: { color: colors.text, fontSize: 18, paddingHorizontal: spacing.sm },
  branch: { color: colors.textDim, fontSize: 12, paddingHorizontal: spacing.lg, paddingVertical: spacing.xs },
  running: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, backgroundColor: colors.surface },
  runningText: { flex: 1, color: colors.text, fontSize: 12, fontFamily: 'Menlo' },
  cancel: { color: colors.danger, fontSize: 14 },
  empty: { color: colors.textFaint, textAlign: 'center', marginTop: spacing.xl, paddingHorizontal: spacing.lg },
  row: { flexDirection: 'row', alignItems: 'center', height: ROW_HEIGHT, paddingLeft: ROW_LEFT, paddingRight: ROW_RIGHT },
  pressed: { backgroundColor: colors.surface },
  check: { width: CHECK_WIDTH, height: ROW_HEIGHT, alignItems: 'center', justifyContent: 'center' },
  selectedCount: { color: colors.accent, fontSize: 12.5, fontWeight: '600' },
  selected: { backgroundColor: colors.raised },
  text: { flexShrink: 0, marginLeft: TEXT_GAP, gap: 1 },
  subjectLine: { flexDirection: 'row', alignItems: 'center', gap: BADGE_GAP },
  subject: { color: colors.text, fontSize: SUBJECT_SIZE },
  special: { color: colors.textDim, fontStyle: 'italic' },
  meta: { color: colors.textFaint, fontSize: META_SIZE },
  repoName: { fontWeight: '600' },
  errorRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.lg, paddingVertical: spacing.xs },
  errorText: { flex: 1, color: colors.danger, fontSize: 12.5 },
  retry: { color: colors.accent, fontSize: 13, fontWeight: '600' },
  badge: { fontSize: BADGE_SIZE, paddingHorizontal: BADGE_PADDING, paddingVertical: 1, borderRadius: 4, overflow: 'hidden', color: colors.text },
  badgeHead: { backgroundColor: 'rgba(128,136,255,0.3)' },
  badgeRemote: { backgroundColor: 'rgba(255,255,255,0.1)', color: colors.textDim },
  badgeTag: { backgroundColor: 'rgba(224,160,80,0.3)' },
  compareBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md, paddingHorizontal: spacing.lg, paddingTop: spacing.md, backgroundColor: colors.surface, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  compareText: { flex: 1, color: colors.text, fontSize: 14 },
  compareButton: { minHeight: 40, paddingHorizontal: spacing.lg, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(128,136,255,0.22)' },
  compareDisabled: { opacity: 0.4 },
  compareButtonText: { color: '#e4e4fa', fontSize: 14.5, fontWeight: '600' },
});
