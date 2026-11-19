import { useCallback, useState } from 'react';
import { ActivityIndicator, Alert, StyleSheet, Text, View } from 'react-native';

import type { Rename } from '@/components/project/actions';
import { FilesTab } from '@/components/project/tabs/FilesTab';
import { GitTab } from '@/components/project/tabs/GitTab';
import { OverviewTab } from '@/components/project/tabs/OverviewTab';
import { PlanTab } from '@/components/project/tabs/PlanTab';
import { SettingsTab } from '@/components/project/tabs/SettingsTab';
import { TextPrompt } from '@/components/TextPrompt';
import { act, useMinute, useProject, useProjectPlan } from '@/projects/queries';
import { colors } from '@/theme';
import { openWindow } from '@/windows/open';
import type { WindowTab } from '@/windows/window-spec';

/**
 * One tab of a project in a window of its own, as the project page shows it
 * (src/app/project/[id]/index.tsx), without the other tabs. What it opens
 * (a session, a file's screen) opens in the main window, as on the desktop.
 */
export function ProjectWindow({ projectId, tab }: { projectId: string; tab: WindowTab }) {
  const { project, isLoading, refetch } = useProject(projectId);
  const plan = useProjectPlan(projectId);
  const now = useMinute();
  const [rename, setRename] = useState<Rename | null>(null);
  const refresh = useCallback(() => Promise.all([refetch(), plan.refetch()]), [refetch, plan]);
  const run = async (method: string, params: unknown[], after?: () => void) => {
    try { await act(method, params); after?.(); } catch (err: any) { Alert.alert('That did not work', err.message); }
    refresh();
  };

  if (!project) {
    return <View style={styles.center}>{isLoading ? <ActivityIndicator color={colors.accent} /> : <Text style={styles.empty}>This project is gone.</Text>}</View>;
  }

  const body = {
    overview: <OverviewTab project={project} now={now} run={run} onRename={setRename} onRefresh={refresh} />,
    plan: <PlanTab project={project} plan={plan.data} loading={plan.isLoading} onChanged={() => plan.refetch()} onRefresh={refresh} />,
    files: <FilesTab project={project} />,
    git: <GitTab project={project} active />,
    // Another tab chosen from here opens in a window of its own too.
    settings: <SettingsTab project={project} now={now} run={run} onSelectTab={(next) => { if (next !== 'session') openWindow({ kind: 'project', projectId, tab: next }, project.name); }} />,
  }[tab];

  return (
    <View style={styles.fill}>
      {body}
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
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  empty: { color: colors.textFaint },
});
