import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useCallback, useMemo, useState, type ReactNode } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, View } from 'react-native';

import { HeaderButton } from '@/components/HeaderButton';
import { FolderChips } from '@/components/project/FolderChips';
import type { Rename } from '@/components/project/actions';
import { ProjectActions } from '@/components/project/ProjectActions';
import { ProjectTabBar } from '@/components/project/ProjectTabBar';
import { SwipeTabs } from '@/components/project/SwipeTabs';
import { FilesTab } from '@/components/project/tabs/FilesTab';
import { GitTab } from '@/components/project/tabs/GitTab';
import { KnowledgeTab } from '@/components/project/tabs/KnowledgeTab';
import { EnvTab } from '@/components/project/tabs/EnvTab';
import { folderChips } from '@/files/model';
import { useGitInfo } from '@/git/info-query';
import { useKnowledgeSupported } from '@/knowledge/queries';
import { useEnvSupported } from '@/env/queries';
import { OverviewTab } from '@/components/project/tabs/OverviewTab';
import { PlanTab } from '@/components/project/tabs/PlanTab';
import { SessionTab } from '@/components/project/tabs/SessionTab';
import { SettingsTab } from '@/components/project/tabs/SettingsTab';
import { STATE_COLORS } from '@/components/SessionRow';
import { useProjectTab } from '@/components/project/useProjectTab';
import { RenamePrompt } from '@/components/project/RenamePrompt';
import { Sheet } from '@/components/Sheet';
import { openNote } from '@/notes/panel';
import { PROJECT_TABS, planTabMeta, type ProjectTab } from '@/projects/tabs';
import { ProjectSessionContext } from '@/projects/open-session';
import { act, useMinute, useProject, useProjectPlan } from '@/projects/queries';
import { rowState } from '@/sessions/model';
import { useConnection } from '@/store/connection';
import { colors } from '@/theme';
import { openWindow, useCanOpenWindows } from '@/windows/open';
import { WINDOW_TABS } from '@/windows/window-spec';

/**
 * One project, on the desktop's tabs: Overview, Session, Plan, Todos, Files, Git
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
  const [folderSheet, setFolderSheet] = useState(false);
  // The header's ⋯ on the Session tab: the session's actions (Split screen among them).
  const [sessionActions, setSessionActions] = useState(false);
  // A track's name, from the Overview tab's track sheet.
  const [rename, setRename] = useState<Rename | null>(null);

  const refresh = useCallback(() => Promise.all([refetch(), plan.refetch()]), [refetch, plan]);
  // Node Knowledge only when the computer offers it (a desktop older than it does not).
  const knowledge = useKnowledgeSupported();
  // Env too (useEnvSupported).
  const env = useEnvSupported();
  const tabs = useMemo(
    () => PROJECT_TABS.filter(({ key }) => (key !== 'session' || !!sessionId) && (key !== 'knowledge' || knowledge) && (key !== 'env' || env)),
    [sessionId, knowledge, env],
  );
  // The folders button's chips: the branch git reports, else the one the project stored (what is cached is enough here).
  const gitInfo = useGitInfo(id, false);
  const chips = useMemo(() => (project ? folderChips(project, gitInfo.data?.repositories) : []), [project, gitInfo.data?.repositories]);
  const run = async (method: string, params: unknown[], after?: () => void) => {
    try { await act(method, params); after?.(); } catch (err: any) { Alert.alert('That did not work', err.message); }
    refresh();
  };

  if (!project) {
    return <View style={styles.center}>{isLoading ? <ActivityIndicator color={colors.accent} /> : <Text style={styles.empty}>This project is gone.</Text>}</View>;
  }

  const meta = planTabMeta(plan.data);

  const attachFolder = () => router.push({ pathname: '/folders', params: { projectId: project.id } });

  const bodies: Record<ProjectTab, ReactNode> = {
    overview: <OverviewTab project={project} now={now} run={run} onRename={setRename} onRefresh={refresh} />,
    plan: <PlanTab project={project} part="plan" plan={plan.data} loading={plan.isLoading} onChanged={() => plan.refetch()} onRefresh={refresh} />,
    todos: <PlanTab project={project} part="todos" plan={plan.data} loading={plan.isLoading} onChanged={() => plan.refetch()} onRefresh={refresh} />,
    files: <FilesTab project={project} />,
    git: <GitTab project={project} active={tab === 'git'} />,
    knowledge: <KnowledgeTab project={project} active={tab === 'knowledge'} />,
    env: <EnvTab project={project} active={tab === 'env'} />,
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
          // The name, then the folders button: how many folders are attached, and a sheet with each and its branch.
          headerTitle: ({ children }) => (
            <View style={styles.titleRow}>
              <Text style={styles.title} numberOfLines={1}>{children}</Text>
              <Pressable
                onPress={() => setFolderSheet(true)}
                hitSlop={8}
                style={({ pressed }) => [styles.foldersButton, pressed && styles.foldersPressed]}
                accessibilityRole="button"
                accessibilityLabel={`Folders, ${project.folders.length} attached`}
              >
                <Ionicons name="folder-outline" size={15} color={colors.textDim} />
                <Text style={styles.foldersCount}>{project.folders.length}</Text>
              </Pressable>
            </View>
          ),
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

      <ProjectActions project={actions ? project : null} now={now} onClose={() => setActions(false)} onSettings={() => selectTab('settings')} onRemoved={() => router.back()} />
      <Sheet visible={folderSheet} title="Folders" onClose={() => setFolderSheet(false)}>
        <FolderChips chips={chips} onAttach={() => { setFolderSheet(false); attachFolder(); }} />
      </Sheet>
      <RenamePrompt rename={rename} run={run} onClose={() => setRename(null)} />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background },
  headerButtons: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 10, maxWidth: '100%' },
  title: { flexShrink: 1, color: colors.text, fontSize: 17, fontWeight: '600' },
  foldersButton: { flexDirection: 'row', alignItems: 'center', gap: 4, height: 28, paddingHorizontal: 8, borderRadius: 8, backgroundColor: 'rgba(255,255,255,0.06)' },
  foldersPressed: { opacity: 0.6 },
  foldersCount: { color: colors.textDim, fontSize: 13, fontWeight: '600' },
  pane: { flex: 1 },
  hidden: { display: 'none' },
  empty: { color: colors.textFaint, fontSize: 13, paddingVertical: 8 },
});
