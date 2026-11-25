import { useQuery } from '@tanstack/react-query';
import { Redirect, router, Tabs, useNavigation } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, SectionList, StyleSheet, Text, TextInput, View } from 'react-native';

import { ConnectionBanner } from '@/components/ConnectionBanner';
import { HeaderButton } from '@/components/HeaderButton';
import { usePullRefresh } from '@/components/PullRefresh';
import { SearchStopBar } from '@/components/SearchStopBar';
import { SessionActions } from '@/components/SessionActions';
import { SessionListControls } from '@/components/SessionListControls';
import { SessionRow } from '@/components/SessionRow';
import { projectSessions } from '@/projects/model';
import { openSessionFromTabs } from '@/projects/open-session';
import { useProjectTree } from '@/projects/queries';
import { useSessionListPrefs } from '@/sessions/list-prefs';
import { buildSections, rowState, shortProjectPath, type Folder, type Session } from '@/sessions/model';
import { isLive, runningAmong } from '@/sessions/search-stop';
import { useSessionSearch } from '@/sessions/useSessionSearch';
import { request, useConnection } from '@/store/connection';
import { colors, spacing } from '@/theme';

export default function SessionsScreen() {
  const loaded = useConnection((s) => s.loaded);
  const desktop = useConnection((s) => s.desktop);
  const online = useConnection((s) => s.status.state === 'online');
  const live = useConnection((s) => s.live);
  const notices = useConnection((s) => s.notices);
  const diffs = useConnection((s) => s.diffs);
  // A change to review waits for you as much as a question does.
  const reviewing = useMemo(() => new Set(Object.values(diffs).map((d) => d.sessionId)), [diffs]);
  const status = useSessionListPrefs((s) => s.status);
  const pinned = useSessionListPrefs((s) => s.pinned);
  const order = useSessionListPrefs((s) => s.order);
  const groupByFolders = useSessionListPrefs((s) => s.groupByFolders);
  const [selected, setSelected] = useState<Session | null>(null);

  const projects = useQuery({
    queryKey: ['projects'],
    queryFn: () => request<Folder[]>('get-projects', [false]),
    enabled: online,
  });
  const allSessions = useMemo(() => (projects.data || []).flatMap((f) => f.sessions), [projects.data]);
  // Full-text search on the computer, over what was said, plus titles; the X leaves results out.
  const { query, setQuery, search, searching, matchIds, excludedSessions, leftOut, leaveOut, restore } = useSessionSearch('sessions', allSessions);
  const sections = useMemo(() => {
    const matches = matchIds ? new Set([...matchIds].filter((id) => !excludedSessions.has(id))) : null;
    return buildSections(projects.data || [], { status, pinned, order, groupByFolders, live, matches });
  }, [projects.data, status, pinned, order, groupByFolders, live, matchIds, excludedSessions]);
  const shown = useMemo(() => sections.flatMap((s) => s.data), [sections]);
  const running = useMemo(() => runningAmong(shown, (id) => isLive(live[id])), [shown, live]);

  // Which project each session belongs to: its row names it, and it opens on its project's Session tab.
  const navigation = useNavigation();
  const tree = useProjectTree();
  const projectOf = useMemo(() => {
    const map = new Map<string, { id: string; name: string }>();
    for (const project of tree.data?.projects || []) for (const s of projectSessions(project)) map.set(s.sessionId, { id: project.id, name: project.name });
    return map;
  }, [tree.data]);
  const open = useCallback((session: Session) => {
    openSessionFromTabs(navigation, session, projectOf.get(session.sessionId)?.id ?? session.projectId, { inProject: true });
  }, [navigation, projectOf]);
  const showActions = useCallback((session: Session) => setSelected(session), []);
  const leaveOutRow = useCallback((session: Session) => leaveOut({ sessionId: session.sessionId }), [leaveOut]);
  const renderItem = useCallback(
    ({ item }: { item: Session }) => (
      <SessionRow
        session={item}
        state={reviewing.has(item.sessionId) ? 'attention' : rowState(item.sessionId, live[item.sessionId], notices)}
        onPress={open}
        onLongPress={showActions}
        onLeaveOut={searching ? leaveOutRow : undefined}
        // No folder headers in the flat list, so each row says which folder it is in.
        folder={groupByFolders ? undefined : shortProjectPath(item.projectPath)}
        project={projectOf.get(item.sessionId)?.name}
      />
    ),
    [live, notices, reviewing, open, showActions, searching, leaveOutRow, groupByFolders, projectOf],
  );

  const pull = usePullRefresh(() => projects.refetch());

  if (!loaded) return <View style={styles.center}><ActivityIndicator color={colors.accent} /></View>;
  if (!desktop) return <Redirect href="/pair" />;

  return (
    <View style={styles.screen}>
      <Tabs.Screen
        options={{
          // Settings and the Task Manager are in the tab bar, as on the desktop's strip.
          headerRight: () => (
            <HeaderButton icon="add" label="New" variant="primary" accessibilityLabel="New session" onPress={() => router.push('/new')} />
          ),
        }}
      />
      <ConnectionBanner />
      <View style={styles.controls}>
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Search sessions…"
          placeholderTextColor={colors.textFaint}
          style={styles.search}
          autoCorrect={false}
          autoCapitalize="none"
          clearButtonMode="while-editing"
        />
        <SessionListControls />
        {searching ? <SearchStopBar shown={shown.length} running={running} leftOut={leftOut} query={search} onRestore={restore} /> : null}
      </View>
      <SectionList
        sections={sections}
        keyExtractor={(item) => item.sessionId}
        renderItem={renderItem}
        renderSectionHeader={({ section }) => (section.title ? <Text style={styles.sectionHeader} numberOfLines={1}>{section.title}</Text> : null)}
        stickySectionHeadersEnabled
        initialNumToRender={20}
        refreshControl={pull}
        ListEmptyComponent={
          <Text style={styles.empty}>
            {!online ? '' : projects.isLoading ? 'Loading sessions…' : searching ? 'No session matches.' : 'No sessions here.'}
          </Text>
        }
      />
      <SessionActions session={selected} onClose={() => setSelected(null)} />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background },
  controls: { paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: spacing.sm, gap: spacing.sm },
  search: {
    color: colors.text,
    backgroundColor: colors.surface,
    borderRadius: 8,
    paddingHorizontal: spacing.md,
    paddingVertical: 9,
    fontSize: 15,
  },
  sectionHeader: {
    color: colors.textDim,
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.4,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.xs,
    backgroundColor: colors.background,
  },
  empty: { color: colors.textFaint, textAlign: 'center', padding: spacing.xl },
});
