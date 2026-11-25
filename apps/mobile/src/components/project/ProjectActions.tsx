import { router } from 'expo-router';
import { useState } from 'react';
import { Alert } from 'react-native';

import { Sheet, type SheetOption } from '@/components/Sheet';
import { openNote } from '@/notes/panel';
import { toggleProjectDone } from '@/projects/flows';
import { projectMenu, type ProjectMenuAction } from '@/projects/menu';
import type { Project } from '@/projects/model';
import { act } from '@/projects/queries';
import { queryClient } from '@/remote/query';
import { resolveSnoozePresets } from '@/shared/vendor/snooze';
import type { Rename, Run } from './actions';
import { RemoveProjectPrompt } from './RemoveProjectPrompt';
import { RenamePrompt } from './RenamePrompt';

/** Call the computer, say so when it failed, and read the projects again: the list and the project page both show them. */
const run: Run = async (method, params, after) => {
  try {
    await act(method, params);
    after?.();
  } catch (err: any) {
    Alert.alert('That did not work', err?.message || String(err));
  }
  queryClient.invalidateQueries({ queryKey: ['project-tree'] });
};

/**
 * A project's actions (projectMenu) and the prompts they lead to: the sheet
 * the ⋯ of the project page opens, and a long press on the project in the
 * Projects list.
 */
export function ProjectActions({ project, now, onClose, onSettings, onRemoved }: {
  /** The project whose actions show; null hides them. */
  project: Project | null;
  now: number;
  onClose: () => void;
  /** Settings. Without it the project page opens on its Settings tab. */
  onSettings?: () => void;
  /** Runs once Remove project… has removed it. */
  onRemoved?: () => void;
}) {
  // The project last shown: rename, snooze and remove ask once the sheet has closed.
  const [target, setTarget] = useState(project);
  if (project && project !== target) setTarget(project);
  const [snoozing, setSnoozing] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [rename, setRename] = useState<Rename | null>(null);
  if (!target) return null;

  const handlers: Record<ProjectMenuAction, () => void> = {
    'new-session': () => router.push({ pathname: '/new', params: { target: `p:${target.id}` } }),
    rename: () => setRename({ kind: 'project', id: target.id, name: target.name }),
    'new-track': () => setRename({ kind: 'new-track', id: target.id, name: '' }),
    note: () => { openNote(target.id); },
    'attach-folder': () => router.push({ pathname: '/folders', params: { projectId: target.id } }),
    star: () => run('update-project', [target.id, { starred: !target.starred }]),
    wake: () => run('update-project', [target.id, { snoozedUntil: null }]),
    snooze: () => setSnoozing(true),
    // As on the desktop: marking done asks about running work, schedules and worktrees first.
    done: () => { toggleProjectDone(target); },
    settings: onSettings ?? (() => router.push({ pathname: '/project/[id]', params: { id: target.id, tab: 'settings' } })),
    remove: () => setRemoving(true),
  };
  const options: SheetOption[] = projectMenu(target, now).map(({ action, label, destructive }) => ({ label, destructive, onPress: handlers[action] }));

  return (
    <>
      <Sheet visible={!!project} title={target.name} options={options} onClose={onClose} />
      <Sheet
        visible={snoozing}
        title="Snooze until"
        options={resolveSnoozePresets().map((preset) => ({ label: preset.label, hint: preset.whenLabel, onPress: () => run('update-project', [target.id, { snoozedUntil: preset.snoozedUntil }]) }))}
        onClose={() => setSnoozing(false)}
      />
      <RemoveProjectPrompt project={target} visible={removing} onClose={() => setRemoving(false)} after={onRemoved} />
      <RenamePrompt rename={rename} run={run} onClose={() => setRename(null)} />
    </>
  );
}
