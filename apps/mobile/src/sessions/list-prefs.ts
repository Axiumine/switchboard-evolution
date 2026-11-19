import { create } from 'zustand';

import type { PinFilter, SessionOrder, StatusFilter } from './model';

export type SessionListPrefs = {
  status: StatusFilter;
  pinned: PinFilter;
  order: SessionOrder;
  groupByFolders: boolean;
};

export const DEFAULT_LIST_PREFS: SessionListPrefs = { status: 'all', pinned: 'all', order: 'recent', groupByFolders: false };

type Store = SessionListPrefs & {
  setStatus(status: StatusFilter): void;
  setPinned(pinned: PinFilter): void;
  setOrder(order: SessionOrder): void;
  setGroupByFolders(groupByFolders: boolean): void;
};

/** What the Sessions tab's combos and checkbox are set to; in memory for now, lost when the app closes. */
export const useSessionListPrefs = create<Store>((set) => ({
  ...DEFAULT_LIST_PREFS,
  setStatus: (status) => set({ status }),
  setPinned: (pinned) => set({ pinned }),
  setOrder: (order) => set({ order }),
  setGroupByFolders: (groupByFolders) => set({ groupByFolders }),
}));
