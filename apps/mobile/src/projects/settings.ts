// The project's Settings tab as the desktop builds it (renderSettings and the
// flows around it in public/projects-view.js in switchboard): the folder
// choices, the track colors, what each folder says, and the questions asked
// before a folder, a track or the whole project goes.

import { basename } from '@/worktrees/model';
import type { Project, ProjectFolder, Schedule, Track } from './model';

export type Choice = { key: string; label: string };

/** A folder's git state, as get-project-git-status reports it. */
export type FolderGit = { git: boolean; branch?: string; dirty?: boolean };

/** The same hue the desktop gives a project, from its id. */
export function projectHue(id: string): number {
  let h = 0;
  for (let i = 0; i < String(id).length; i++) h = (h * 31 + String(id).charCodeAt(i)) >>> 0;
  return h % 360;
}

/**
 * One color per track, spread around the wheel from the project's own hue so
 * two tracks in a project never share one.
 */
export function trackColor(project: Pick<Project, 'id' | 'tracks'>, track: Pick<Track, 'id'>): string {
  const index = Math.max(0, project.tracks.findIndex((t) => t.id === track.id));
  const h = Math.round((projectHue(project.id) + 40 + index * 137.5) % 360);
  return `hsl(${h}, 78%, 72%)`;
}

/**
 * "Sessions start in": the default first ('' clears the choice), then any
 * extra choices, the attached folders, and the current folder if it is none
 * of those.
 */
export function cwdChoices(project: Pick<Project, 'folders'>, current: string | null | undefined, firstLabel: string, extra: Choice[] = []): Choice[] {
  const choices: Choice[] = [{ key: '', label: firstLabel }, ...extra];
  for (const folder of project.folders) {
    if (!choices.some((c) => c.key === folder.path)) choices.push({ key: folder.path, label: basename(folder.path) });
  }
  if (current && !choices.some((c) => c.key === current)) choices.push({ key: current, label: current });
  return choices;
}

/** The project's own "Sessions start in". */
export function projectCwdChoices(project: Pick<Project, 'root' | 'folders' | 'defaultCwd'>): Choice[] {
  return cwdChoices(project, project.defaultCwd, `Project folder (${basename(project.root)})`);
}

/** A track's: the project's default, or the project folder itself when the default is elsewhere. */
export function trackCwdChoices(project: Pick<Project, 'root' | 'folders' | 'defaultCwd'>, track: Pick<Track, 'cwd'>): Choice[] {
  const inherited = project.defaultCwd || project.root;
  return cwdChoices(
    project,
    track.cwd,
    `Project default (${basename(inherited)})`,
    project.defaultCwd ? [{ key: project.root, label: `Project folder (${basename(project.root)})` }] : [],
  );
}

/** The CLI a track's new sessions use: none (ask each time), the enabled ones, and the current one if it is gone. */
export function cliChoices(harnesses: { id: string; label: string; enabled?: boolean }[] | undefined, current: string | null | undefined): Choice[] {
  const list = (harnesses || []).filter((h) => h.enabled !== false);
  const choices: Choice[] = [{ key: '', label: 'Ask each time' }, ...(list.length ? list : [{ id: 'claude', label: 'Claude' }]).map((h) => ({ key: h.id, label: h.label }))];
  if (current && !choices.some((c) => c.key === current)) choices.push({ key: current, label: current });
  return choices;
}

/** The branch a project's worktrees use, or null when each names its own. */
export function projectBranchName(project: Pick<Project, 'sharedBranch' | 'branchName' | 'slug'>): string | null {
  return project.sharedBranch === false ? null : (project.branchName || project.slug || null);
}

export function branchHelp(shared: boolean): string {
  return shared ? 'Every new worktree checks out this branch.' : 'Each worktree names its own branch when you attach it.';
}

/** A folder's line: its branch and whether it is modified, then where it came from or lives. */
export function folderDetail(folder: ProjectFolder, git: FolderGit | null | undefined): string {
  const dirty = git?.git && git.dirty ? ' · modified' : '';
  if (folder.mode === 'worktree') return `on ${folder.branch || ''}${dirty} · from ${folder.sourcePath || ''}`;
  return git?.git ? `on ${git.branch}${dirty} · ${folder.path}` : folder.path;
}

export type RunningWork = {
  sessions: { sessionId: string; title: string; busy: boolean }[];
  tasks: { projectPath: string; label: string }[];
};

/** Running sessions (mid-turn ones marked) and tasks, one line each. */
export function runningWorkLines(running: RunningWork): string[] {
  return [...running.sessions.map((s) => (s.busy ? `${s.title} · working` : s.title)), ...running.tasks.map((t) => t.label)];
}

/** Mid-turn sessions are called out, since stopping those interrupts work in progress. */
export function busyNote(running: RunningWork): string {
  const n = running.sessions.filter((s) => s.busy).length;
  return n ? `${n} session${n === 1 ? ' is' : 's are'} mid-turn; stopping interrupts work in progress.` : '';
}

export type DoneWorktree = { path: string; branch: string; dirty: boolean };

/** A short list for a dialog, capped at `max` lines. */
export function listLines(lines: string[], max = 8): string {
  const shown = lines.slice(0, max).map((line) => `• ${line}`);
  if (lines.length > max) shown.push(`+ ${lines.length - max} more`);
  return shown.join('\n');
}

/**
 * The one question before a project is marked done, as the desktop's dialog
 * asks it: what stops, what pauses, and the worktrees that can stay or go.
 * Null when there is nothing to ask about.
 */
export function markDoneQuestion(
  project: Pick<Project, 'name'>,
  { running, schedules, worktrees }: { running: RunningWork; schedules: Pick<Schedule, 'name'>[]; worktrees: DoneWorktree[] },
): { title: string; message: string; deleteLabel: string | null } | null {
  const stopLines = runningWorkLines(running);
  if (!stopLines.length && !schedules.length && !worktrees.length) return null;
  const parts = ['It moves to the Done list. Reopen it any time.'];
  if (stopLines.length) parts.push(['Stops now:', busyNote(running), listLines(stopLines)].filter(Boolean).join('\n'));
  if (schedules.length) parts.push(`Pauses until reopened:\n${listLines(schedules.map((s) => s.name))}`);
  const n = worktrees.length;
  if (n) {
    const lines = worktrees.map((w) => `${basename(w.path)}${w.branch ? ` · ${w.branch}` : ''}${w.dirty ? ' · uncommitted changes' : ''}`);
    const dirty = worktrees.filter((w) => w.dirty).length;
    parts.push([
      `${n === 1 ? 'Worktree' : `${n} worktrees`}:\n${listLines(lines)}`,
      `Keep ${n === 1 ? 'it' : 'them'} on disk to pick up where you left off, or delete ${n === 1 ? 'this folder' : 'these folders'}: branches and their commits stay.`,
      dirty ? `${dirty === n && n === 1 ? 'It has' : `${dirty} of them ${dirty === 1 ? 'has' : 'have'}`} uncommitted changes. Deleting loses them.` : '',
    ].filter(Boolean).join('\n'));
  }
  return {
    title: `Mark ${project.name} as done?`,
    message: parts.join('\n\n'),
    deleteLabel: n ? `Mark as done and delete ${n === 1 ? 'worktree' : 'worktrees'}` : null,
  };
}

/** The question before a track is marked done, when it would pause some of its schedules; null otherwise. */
export function trackDoneQuestion(track: Pick<Track, 'id' | 'name'>, schedules: Pick<Schedule, 'trackId' | 'enabled'>[]): string | null {
  const paused = schedules.filter((s) => s.trackId === track.id && s.enabled).length;
  if (!paused) return null;
  return `${paused} scheduled task${paused === 1 ? '' : 's'} in it will pause until the track is reopened.`;
}

/** What detaching a folder says: a worktree's checkout can go too, its branch stays. */
export function detachQuestion(project: Pick<Project, 'name'>, folder: ProjectFolder): { title: string; message: string } {
  const isWorktree = folder.mode === 'worktree';
  const lines = [isWorktree ? 'New sessions of the project stop working in it.' : 'New sessions of the project stop working in it. Nothing on disk changes.', folder.path];
  if (isWorktree) lines.push(folder.branch ? `If you delete the checkout too, the branch ${folder.branch} and its commits stay.` : 'If you delete the checkout too, its branch and commits stay.');
  return { title: `Detach ${basename(folder.path)} from ${project.name}?`, message: lines.join('\n\n') };
}
