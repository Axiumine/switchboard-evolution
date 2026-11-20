import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useCallback, useMemo, useState, type ReactNode } from 'react';
import { ActivityIndicator, Alert, StyleSheet, Text, View } from 'react-native';

import { HeaderButton } from '@/components/HeaderButton';
import type { Rename } from '@/components/project/actions';
import { ProjectTabBar } from '@/components/project/ProjectTabBar';
import { SwipeTabs } from '@/components/project/SwipeTabs';
import { FilesTab } from '@/components/project/tabs/FilesTab';
import { GitTab } from '@/components/project/tabs/GitTab';
import { OverviewTab } from '@/components/project/tabs/OverviewTab';
import { PlanTab } from '@/components/project/tabs/PlanTab';
import { SessionTab } from '@/components/project/tabs/SessionTab';
import { SettingsTab } from '@/components/project/tabs/SettingsTab';
import { STATE_COLORS } from '@/components/SessionRow';
import { useProjectTab } from '@/components/project/useProjectTab';
import { Sheet, type SheetOption } from '@/components/Sheet';
import { TextPrompt } from '@/components/TextPrompt';
import { openNote } from '@/notes/panel';
import { PROJECT_TABS, type ProjectTab } from '@/projects/tabs';
import { removeProject, toggleProjectDone } from '@/projects/flows';
import { ProjectSessionContext } from '@/projects/open-session';
import { act, useMinute, useProject, useProjectPlan } from '@/projects/queries';
import { rowState } from '@/sessions/model';
import { projectSnoozed, resolveSnoozePresets } from '@/shared/vendor/snooze';
import { useConnection } from '@/store/connection';
import { colors } from '@/theme';
import { openWindow, useCanOpenWindows } from '@/windows/open';
import { WINDOW_TABS } from '@/windows/window-spec';

/**
 * One project, on the desktop's tabs: Overview, Session, Plan, Files, Git
 * (Changes, History, Worktrees) and Settings. A session opened in the project
 * shows on the Session tab, under the project's header and tabs. A sideways
 * swipe goes to the tab next to the open one (SwipeTabs).
 */
export default function ProjectScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { project, isLoading, refetch } = useProject(id);
  const plan = useProjectPlan(id);
  const now = useMinute();
  const nav = useProjectTab(id);
  const canPopOut = useCanOpenWindows();
  const { tab, selectTab, sessionId } = nav;
  const sessionState = useConnection((s) => (sessionId ? rowState(sessionId, s.live[sessionId], s.notices) : 'idle'));
  // A tab is built when first visited and kept, so its scroll, sheets and queries survive switching.
  const [visited, setVisited] = useState<ProjectTab[]>([tab]);
  if (!visited.includes(tab)) setVisited([...visited, tab]);

  const [actions, setActions] = useState(false);
  // The header's ⋯ on the Session tab: the session's actions (Split screen among them).
  const [sessionActions, setSessionActions] = useState(false);
  const [snoozing, setSnoozing] = useState(false);
  const [rename, setRename] = useState<Rename | null>(null);

  const refresh = useCallback(() => Promise.all([refetch(), plan.refetch()]), [refetch, plan]);
  const tabs = useMemo(() => PROJECT_TABS.filter(({ key }) => key !== 'session' || !!sessionId), [sessionId]);
  const run = async (method: string, params: unknown[], after?: () => void) => {
    try { await act(method, params); after?.(); } catch (err: any) { Alert.alert('That did not work', err.message); }
    refresh();
  };

  if (!project) {
    return <View style={styles.center}>{isLoading ? <ActivityIndicator color={colors.accent} /> : <Text style={styles.empty}>This project is gone.</Text>}</View>;
  }

  const snoozed = projectSnoozed(project, now);
  const meta = plan.data && !plan.data.error && plan.data.plan.total ? { plan: `${plan.data.plan.done}/${plan.data.plan.total}` } : undefined;

  const projectOptions: SheetOption[] = [
    { label: 'New session…', onPress: () => router.push({ pathname: '/new', params: { target: `p:${project.id}` } }) },
    { label: 'Rename…', onPress: () => setRename({ kind: 'project', id: project.id, name: project.name }) },
    { label: 'New track…', onPress: () => setRename({ kind: 'new-track', id: project.id, name: '' }) },
    { label: 'Note', onPress: () => { openNote(project.id); } },
    { label: 'Attach a folder…', onPress: () => router.push({ pathname: '/folders', params: { projectId: project.id } }) },
    ...(project.status === 'done' ? [] : snoozed
      ? [{ label: 'Wake now', onPress: () => run('update-project', [project.id, { snoozedUntil: null }]) }]
      : [{ label: 'Snooze…', onPress: () => setSnoozing(true) }]),
    // As on the desktop: marking done asks about running work, schedules and worktrees first.
    { label: project.status === 'done' ? 'Reopen' : 'Mark as done', onPress: () => { toggleProjectDone(project); } },
    { label: 'Settings', onPress: () => selectTab('settings') },
    { label: 'Remove project…', destructive: true, onPress: () => removeProject(project, () => router.back()) },
  ];

  const bodies: Record<ProjectTab, ReactNode> = {
    overview: <OverviewTab project={project} now={now} run={run} onRename={setRename} onRefresh={refresh} />,
    plan: <PlanTab project={project} plan={plan.data} loading={plan.isLoading} onChanged={() => plan.refetch()} onRefresh={refresh} />,
    files: <FilesTab project={project} />,
    git: <GitTab project={project} active={tab === 'git'} />,
    settings: <SettingsTab project={project} now={now} run={run} onSelectTab={selectTab} />,
    session: sessionId ? (
      <SessionTab
        sessionId={sessionId}
        view={nav.view}
        active={tab === 'session'}
        actionsOpen={sessionActions}
        onCloseActions={() => setSessionActions(false)}
        onProjectActions={() => setActions(true)}
        onSessionChange={nav.openSession}
      />
    ) : null,
  };

  return (
    <View style={styles.screen}>
      <Stack.Screen
        options={{
          title: project.name,
          // The note button is on every tab, beside the ⋯ (the desktop has it beside Tasks).
          headerRight: () => (
            <View style={styles.headerButtons}>
              <HeaderButton icon="reader-outline" accessibilityLabel="Note" onPress={() => { openNote(project.id); }} />
              {tab === 'session'
                ? <HeaderButton icon="ellipsis-horizontal" accessibilityLabel="Session actions" onPress={() => setSessionActions(true)} />
                : <HeaderButton icon="ellipsis-horizontal" accessibilityLabel="Project actions" onPress={() => setActions(true)} />}
            </View>
          ),
        }}
      />
      <ProjectTabBar
        tabs={tabs}
        active={tab}
        onChange={selectTab}
        meta={meta}
        dots={sessionState === 'idle' ? undefined : { session: STATE_COLORS[sessionState] }}
        // As on the desktop, every tab but Session opens in a window of its own (DeX, a tablet).
        popOut={WINDOW_TABS}
        onPopOut={canPopOut ? (key) => { if (key !== 'session') openWindow({ kind: 'project', projectId: project.id, tab: key }, project.name); } : undefined}
      />
      <ProjectSessionContext.Provider value={nav.openSession}>
        <SwipeTabs tabs={tabs} active={tab} onChange={selectTab}>
          {tabs.filter(({ key }) => key === tab || visited.includes(key)).map(({ key }) => (
            <View key={key} style={[styles.pane, key !== tab && styles.hidden]}>{bodies[key]}</View>
          ))}
        </SwipeTabs>
      </ProjectSessionContext.Provider>

      <Sheet visible={actions} title={project.name} options={projectOptions} onClose={() => setActions(false)} />
      <Sheet
        visible={snoozing}
        title="Snooze until"
        options={resolveSnoozePresets().map((preset) => ({ label: preset.label, hint: preset.whenLabel, onPress: () => run('update-project', [project.id, { snoozedUntil: preset.snoozedUntil }]) }))}
        onClose={() => setSnoozing(false)}
      />
      <TextPrompt
        visible={!!rename}
        title={rename?.kind === 'new-track' ? 'New track' : 'Rename'}
        initialValue={rename?.name || ''}
        confirm={rename?.kind === 'new-track' ? 'Create' : 'Rename'}
        onClose={() => setRename(null)}
        onSubmit={(name) => {
          if (!rename || !name || name === rename.name) return;
          if (rename.kind === 'project') run('update-project', [rename.id, { name }]);
          else if (rename.kind === 'track') run('update-track', [rename.id, { name }]);
          else run('create-track', [rename.id, { name }]);
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background },
  headerButtons: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  pane: { flex: 1 },
  hidden: { display: 'none' },
  empty: { color: colors.textFaint, fontSize: 13, paddingVertical: 8 },
});
