import { useCallback } from 'react';
import { create } from 'zustand';

import type { GitView, ProjectTab, ScrollKey, SessionView } from './tabs';

/**
 * What a project page remembers while the app runs: the tab it was on and
 * each tab's scroll offset. Later tabs add their own fields (selected file,
 * repository, ...), so this type is meant to grow.
 */
export type ProjectUi = {
  tab: ProjectTab;
  /** The Git tab's view: Changes, History or Worktrees. */
  gitView?: GitView;
  /** The session the Session tab shows; it outlives a switch to another tab, as on the desktop. */
  session?: string | null;
  /** Whether the Session tab opened on the chat or the terminal. */
  sessionView?: SessionView;
  scroll: Partial<Record<ScrollKey, number>>;
  /** Files tab: the folder whose tab is open, and per folder the open subfolders and the file shown. */
  files?: FilesUi;
};

export type FilesUi = { root?: string; expanded?: Record<string, string[]>; selected?: Record<string, string | null> };

const DEFAULT_UI: ProjectUi = Object.freeze({ tab: 'overview', scroll: Object.freeze({}) }) as ProjectUi;

type ProjectUiStore = {
  byProject: Record<string, ProjectUi>;
  /** A project's state, or the defaults for one never opened. */
  get(projectId: string): ProjectUi;
  /** Shallow-merge `partial` into a project's state; other projects are untouched. */
  patch(projectId: string, partial: Partial<ProjectUi>): void;
};

export const useProjectUiStore = create<ProjectUiStore>((set, getState) => ({
  byProject: {},
  get: (projectId) => getState().byProject[projectId] ?? DEFAULT_UI,
  patch: (projectId, partial) =>
    set((state) => ({ byProject: { ...state.byProject, [projectId]: { ...(state.byProject[projectId] ?? DEFAULT_UI), ...partial } } })),
}));

/**
 * A project's remembered UI state and the function that updates it. Pass a
 * `selector` to subscribe to only what you render: the component then
 * re-renders when that value changes, not on every patch (scroll offsets,
 * other tabs' fields).
 */
export function useProjectUi(projectId: string): [ProjectUi, (partial: Partial<ProjectUi>) => void];
export function useProjectUi<T>(projectId: string, selector: (ui: ProjectUi) => T): [T, (partial: Partial<ProjectUi>) => void];
export function useProjectUi(projectId: string, selector?: (ui: ProjectUi) => unknown): [unknown, (partial: Partial<ProjectUi>) => void] {
  const value = useProjectUiStore((s) => {
    const ui = s.byProject[projectId] ?? DEFAULT_UI;
    return selector ? selector(ui) : ui;
  });
  const patch = useProjectUiStore((s) => s.patch);
  const patchProject = useCallback((partial: Partial<ProjectUi>) => patch(projectId, partial), [patch, projectId]);
  return [value, patchProject];
}

/** Remember how far a tab is scrolled, without disturbing the other tabs' offsets. */
export function rememberScroll(projectId: string, tab: ScrollKey, offset: number): void {
  const { get, patch } = useProjectUiStore.getState();
  patch(projectId, { scroll: { ...get(projectId).scroll, [tab]: offset } });
}
