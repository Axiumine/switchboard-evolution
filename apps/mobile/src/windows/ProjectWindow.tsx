import { useCallback, useState, type ReactNode } from 'react';
import { ActivityIndicator, Alert, StyleSheet, Text, View } from 'react-native';

import type { Rename } from '@/components/project/actions';
import { FilesTab } from '@/components/project/tabs/FilesTab';
import { GitTab } from '@/components/project/tabs/GitTab';
import { KnowledgeTab } from '@/components/project/tabs/KnowledgeTab';
import { OverviewTab } from '@/components/project/tabs/OverviewTab';
import { PlanTab } from '@/components/project/tabs/PlanTab';
import { SettingsTab } from '@/components/project/tabs/SettingsTab';
import { TextPrompt } from '@/components/TextPrompt';
import { act, useMinute, useProject, useProjectPlan } from '@/projects/queries';
import { colors } from '@/theme';
import { WINDOW_TABS, type WindowTab } from '@/windows/window-spec';

/**
 * A tab of a project in a window of its own, as the project page shows it
 * (src/app/project/[id]/index.tsx), with no tab bar: the window's header has
 * the strip that changes `tab` (WindowTabs). A tab is built when first shown
 * and kept, as the project page keeps its tabs. What it opens (a session, a
 * file's screen) opens in the main window, as on the desktop.
 */
export function ProjectWindow({ projectId, tab, onTab }: { projectId: string; tab: WindowTab; onTab: (tab: WindowTab) => void }) {
  const { project, isLoading, refetch } = useProject(projectId);
  const plan = useProjectPlan(projectId);
  const now = useMinute();
  const [rename, setRename] = useState<Rename | null>(null);
  const [visited, setVisited] = useState<WindowTab[]>([tab]);
  if (!visited.includes(tab)) setVisited([...visited, tab]);
  const refresh = useCallback(() => Promise.all([refetch(), plan.refetch()]), [refetch, plan]);
  const run = async (method: string, params: unknown[], after?: () => void) => {
    try { await act(method, params); after?.(); } catch (err: any) { Alert.alert('That did not work', err.message); }
    refresh();
  };

  if (!project) {
    return <View style={styles.center}>{isLoading ? <ActivityIndicator color={colors.accent} /> : <Text style={styles.empty}>This project is gone.</Text>}</View>;
  }

  const bodies: Record<WindowTab, ReactNode> = {
    overview: <OverviewTab project={project} now={now} run={run} onRename={setRename} onRefresh={refresh} />,
    plan: <PlanTab project={project} part="plan" plan={plan.data} loading={plan.isLoading} onChanged={() => plan.refetch()} onRefresh={refresh} />,
    todos: <PlanTab project={project} part="todos" plan={plan.data} loading={plan.isLoading} onChanged={() => plan.refetch()} onRefresh={refresh} />,
    files: <FilesTab project={project} />,
    git: <GitTab project={project} active={tab === 'git'} />,
    knowledge: <KnowledgeTab project={project} active={tab === 'knowledge'} />,
    // Another tab chosen from here shows in this window; Session stays in the main one.
    settings: <SettingsTab project={project} now={now} run={run} onSelectTab={(next) => { if (next !== 'session') onTab(next); }} />,
  };

  return (
    <View style={styles.fill}>
      {WINDOW_TABS.filter((key) => key === tab || visited.includes(key)).map((key) => (
        <View key={key} style={[styles.fill, key !== tab && styles.hidden]}>{bodies[key]}</View>
      ))}
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
  fill: { flex: 1 },
  hidden: { display: 'none' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  empty: { color: colors.textFaint },
});
