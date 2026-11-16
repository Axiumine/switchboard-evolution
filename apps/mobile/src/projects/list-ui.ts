import { create } from 'zustand';

import { DEFAULT_LIST_UI, drawerOpen, otherOpen, type GroupMode, type ListUi } from './drawer';

type ListUiStore = ListUi & {
  /** The session open on the right, highlighted in the list. */
  selectedSession: string | null;
  /** Counts the reveals: on a Surface Duo each turns the left screen to Projects (DuoTabs). */
  revealCount: number;
  /**
   * A session was opened: it is the one highlighted, and its project's
   * drawer (or its folder under "No project") opens so it is in sight.
   */
  reveal(target: { sessionId: string; projectId?: string | null; projectPath?: string | null }): void;
  setGroupMode(mode: GroupMode): void;
  /** The chevron before a project row; while searching it only overrides the search's choice. */
  toggleDrawer(projectId: string, searching: boolean): void;
  toggleSection(section: 'snoozed' | 'done' | 'other', searching: boolean): void;
  toggleFolder(projectPath: string, open: boolean): void;
  showWhole(listKey: string): void;
  toggleArchived(projectId: string): void;
  /** A search ended: its chevron choices go with it. */
  clearSearchOverrides(): void;
};

/**
 * What the Projects tab remembers while the app runs: the grouping, which
 * drawers and sections are open. The desktop keeps the same per window.
 */
export const useListUi = create<ListUiStore>((set, get) => ({
  ...DEFAULT_LIST_UI,
  selectedSession: null,
  revealCount: 0,
  reveal: ({ sessionId, projectId, projectPath }) => {
    const state = get();
    const revealCount = state.revealCount + 1;
    if (projectId) {
      set({ selectedSession: sessionId, revealCount, expanded: { ...state.expanded, [projectId]: true } });
    } else {
      set({
        selectedSession: sessionId,
        revealCount,
        otherOpen: true,
        ...(projectPath ? { otherFolders: { ...state.otherFolders, [projectPath]: true } } : {}),
      });
    }
  },
  setGroupMode: (groupMode) => set({ groupMode }),
  toggleDrawer: (projectId, searching) => {
    const state = get();
    const open = drawerOpen(state, projectId, searching);
    const expanded = { ...state.expanded };
    if (open) delete expanded[projectId];
    else expanded[projectId] = true;
    set({ expanded, ...(searching ? { searchOverride: { ...state.searchOverride, [projectId]: !open } } : {}) });
  },
  toggleSection: (section, searching) => {
    const state = get();
    if (section === 'snoozed') set({ snoozedOpen: !state.snoozedOpen });
    else if (section === 'done') set({ doneOpen: !state.doneOpen });
    else {
      const open = otherOpen(state, searching);
      set({ otherOpen: !open, ...(searching ? { searchOverride: { ...state.searchOverride, other: !open } } : {}) });
    }
  },
  toggleFolder: (projectPath, open) => set({ otherFolders: { ...get().otherFolders, [projectPath]: !open } }),
  showWhole: (listKey) => set({ expandedLists: { ...get().expandedLists, [listKey]: true } }),
  toggleArchived: (projectId) => {
    const archivedOpen = { ...get().archivedOpen };
    if (archivedOpen[projectId]) delete archivedOpen[projectId];
    else archivedOpen[projectId] = true;
    set({ archivedOpen });
  },
  clearSearchOverrides: () => { if (Object.keys(get().searchOverride).length) set({ searchOverride: {} }); },
}));
