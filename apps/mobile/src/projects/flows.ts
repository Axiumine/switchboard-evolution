// The desktop's project flows that ask first (public/projects-view.js in
// switchboard): marking a project done, detaching a folder, finishing or
// deleting a track, removing the project. Shared by the Settings tab and the
// project's menu.

import { Alert, type AlertButton } from 'react-native';

import { queryClient } from '@/remote/query';
import { sessionTitle } from '@/sessions/model';
import { request, useConnection } from '@/store/connection';
import { projectSessions, type Project, type ProjectFolder, type Track } from './model';
import { act } from './queries';
import { detachQuestion, markDoneQuestion, trackDoneQuestion, type DoneWorktree, type FolderGit, type RunningWork } from './settings';

/** Read the projects again: the event that would say so can come late. */
function refreshProjects() {
  queryClient.invalidateQueries({ queryKey: ['project-tree'] });
  queryClient.invalidateQueries({ queryKey: ['worktrees'] });
}

async function attempt(what: string, fn: () => Promise<unknown>) {
  try {
    await fn();
  } catch (err: any) {
    Alert.alert(`Could not ${what}`, err?.message || String(err));
  }
  refreshProjects();
}

/** What is still alive in a project: its running sessions, and the tasks running in any folder it works in. */
async function runningWork(project: Project): Promise<RunningWork> {
  const live = useConnection.getState().live;
  const seen = new Set<string>();
  const sessions = projectSessions(project)
    .filter((s) => {
      const state = live[s.sessionId];
      if (!state || state.exited || seen.has(s.sessionId)) return false;
      seen.add(s.sessionId);
      return true;
    })
    .map((s) => ({ sessionId: s.sessionId, title: sessionTitle(s), busy: !!live[s.sessionId]?.busy }));
  const paths = [...new Set([project.root, ...project.folders.map((f) => f.path)])];
  const lists = await Promise.all(paths.map((projectPath) => request<{ tasks?: { label: string; run?: { running?: boolean } | null }[] }>('list-project-tasks', [projectPath])
    .then((result) => (result?.tasks || []).filter((t) => t.run?.running).map((t) => ({ projectPath, label: t.label })))
    .catch(() => [])));
  return { sessions, tasks: lists.flat() };
}

/** The project's worktrees, each marked dirty when git reports uncommitted changes right now. */
async function worktreesWithState(project: Project): Promise<DoneWorktree[]> {
  const worktrees = project.folders.filter((f) => f.mode === 'worktree');
  if (!worktrees.length) return [];
  let byPath: Record<string, FolderGit> = {};
  try { byPath = (await request<{ byPath?: Record<string, FolderGit> }>('get-project-git-status', [project.id, { force: true }]))?.byPath || {}; } catch {}
  return worktrees.map((f) => ({ path: f.path, branch: f.branch || '', dirty: !!(byPath[f.path]?.git && byPath[f.path].dirty) }));
}

/**
 * Reopening is one tap. Marking done asks once, and only when there is
 * something to ask about: running work, schedules, or worktrees. Keeping the
 * worktrees is the default, so the project can be reopened as it was.
 */
export async function toggleProjectDone(project: Project): Promise<void> {
  if (project.status === 'done') {
    await attempt('reopen the project', () => act('update-project', [project.id, { status: 'active' }]));
    return;
  }
  const [running, worktrees] = await Promise.all([runningWork(project), worktreesWithState(project)]);
  const schedules = project.schedules.filter((s) => s.enabled);

  const markDone = (deleteWorktrees: boolean) => attempt('mark the project as done', async () => {
    for (const session of running.sessions) await request('stop-session', [session.sessionId]).catch(() => {});
    for (const task of running.tasks) await request('stop-task', [task.projectPath, task.label]).catch(() => {});
    await act('update-project', [project.id, { status: 'done' }]);
    useConnection.getState().refreshLive();
    if (!deleteWorktrees) return;
    // Only the ones shown as dirty are forced: one that picked up changes since is kept, not wiped.
    const kept: string[] = [];
    for (const wt of worktrees) {
      const result = await request<{ error?: string; dirty?: boolean }>('detach-project-folder', [project.id, wt.path, { removeWorktree: true, force: wt.dirty }])
        .catch((err: any) => ({ error: err?.message || String(err), dirty: false }));
      if (result?.error) kept.push(`${wt.path}\n  ${result.dirty ? 'It has uncommitted changes.' : result.error}`);
    }
    if (kept.length) {
      Alert.alert(`${project.name} is done`, `${kept.length === 1 ? 'One worktree was' : `${kept.length} worktrees were`} not deleted and ${kept.length === 1 ? 'stays' : 'stay'} on disk:\n\n${kept.join('\n\n')}`);
    }
  });

  const question = markDoneQuestion(project, { running, schedules, worktrees });
  if (!question) { await markDone(false); return; }
  const buttons: AlertButton[] = [{ text: 'Cancel', style: 'cancel' }];
  if (question.deleteLabel) buttons.push({ text: question.deleteLabel, style: 'destructive', onPress: () => { markDone(true); } });
  buttons.push({ text: 'Mark as done', onPress: () => { markDone(false); } });
  Alert.alert(question.title, question.message, buttons);
}

/** Wake a snoozed project now. */
export function wakeProject(project: Project) {
  return attempt('wake the project', () => act('update-project', [project.id, { snoozedUntil: null }]));
}

/**
 * Forget the project; its folder and sessions stay. `after` runs once it is
 * gone. Asked first by RemoveProjectPrompt, where "delete" has to be typed.
 */
export function removeProject(project: Project, after?: () => void) {
  return attempt('remove the project', async () => { await act('delete-project', [project.id]); after?.(); });
}

/**
 * Detach a folder from the project. A worktree can also lose its checkout
 * (keeping it is the default); a dirty one is asked about again.
 */
export function detachFolder(project: Project, folder: ProjectFolder) {
  const isWorktree = folder.mode === 'worktree';
  const go = (removeWorktree: boolean) => attempt('detach the folder', async () => {
    const result = await request<{ error?: string; dirty?: boolean }>('detach-project-folder', [project.id, folder.path, isWorktree ? { removeWorktree } : {}]);
    if (result?.dirty) {
      Alert.alert('The worktree has uncommitted changes', `${result.error || ''}\n\nRemove it anyway and lose those changes?`, [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Remove anyway', style: 'destructive', onPress: () => { attempt('remove the worktree', () => act('detach-project-folder', [project.id, folder.path, { removeWorktree: true, force: true }])); } },
      ]);
      return;
    }
    if (result?.error) throw new Error(result.error);
  });
  const { title, message } = detachQuestion(project, folder);
  const buttons: AlertButton[] = [{ text: 'Cancel', style: 'cancel' }];
  if (isWorktree) buttons.push({ text: 'Detach and delete', style: 'destructive', onPress: () => { go(true); } });
  buttons.push({ text: 'Detach', onPress: () => { go(false); } });
  Alert.alert(title, message, buttons);
}

/** Finish a track, or reopen it. Finishing one with schedules says they pause first. */
export function toggleTrackDone(project: Project, track: Track) {
  const status = track.status === 'done' ? 'active' : 'done';
  const go = () => attempt(status === 'done' ? 'finish the track' : 'reopen the track', () => act('update-track', [track.id, { status }]));
  const pausing = status === 'done' ? trackDoneQuestion(track, project.schedules) : null;
  if (!pausing) { go(); return; }
  Alert.alert(`Mark “${track.name}” as done?`, pausing, [
    { text: 'Cancel', style: 'cancel' },
    { text: 'Mark as done', onPress: () => { go(); } },
  ]);
}

/** Delete a track; its sessions stay in the project, archived too if asked. */
export function deleteTrack(project: Project, track: Track) {
  const go = (archiveSessions: boolean) => attempt('delete the track', () => act('delete-track', [track.id, { archiveSessions }]));
  Alert.alert(
    `Delete track ${track.name}?`,
    `Sessions stay in ${project.name} and keep their former track name.\n\nArchiving them as well stops the running ones and closes their terminals.`,
    [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete and archive sessions', style: 'destructive', onPress: () => { go(true); } },
      { text: 'Delete track', style: 'destructive', onPress: () => { go(false); } },
    ],
  );
}
