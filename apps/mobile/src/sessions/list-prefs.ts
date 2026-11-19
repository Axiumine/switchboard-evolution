import { create } from 'zustand';

import { loadPrefs, savePrefs } from '@/store/prefs';

import { PIN_FILTERS, SESSION_ORDERS, STATUS_FILTERS, type PinFilter, type SessionOrder, type StatusFilter } from './model';

export type SessionListPrefs = {
  status: StatusFilter;
  pinned: PinFilter;
  order: SessionOrder;
  groupByFolders: boolean;
};

export const DEFAULT_LIST_PREFS: SessionListPrefs = { status: 'all', pinned: 'all', order: 'recent', groupByFolders: false };

const offered = <K extends string>(choices: readonly { key: K }[], value: unknown, fallback: K): K =>
  choices.some((c) => c.key === value) ? (value as K) : fallback;

/** The choices as saved, each one checked: one no longer offered is its default again. */
export function listPrefsFrom(saved: unknown): SessionListPrefs {
  const s = (saved && typeof saved === 'object' ? saved : {}) as Record<string, unknown>;
  return {
    status: offered(STATUS_FILTERS, s.status, DEFAULT_LIST_PREFS.status),
    pinned: offered(PIN_FILTERS, s.pinned, DEFAULT_LIST_PREFS.pinned),
    order: offered(SESSION_ORDERS, s.order, DEFAULT_LIST_PREFS.order),
    groupByFolders: typeof s.groupByFolders === 'boolean' ? s.groupByFolders : DEFAULT_LIST_PREFS.groupByFolders,
  };
}

type Store = SessionListPrefs & {
  setStatus(status: StatusFilter): void;
  setPinned(pinned: PinFilter): void;
  setOrder(order: SessionOrder): void;
  setGroupByFolders(groupByFolders: boolean): void;
};

/** What the Sessions tab's combos and checkbox are set to, kept between runs (src/store/prefs.ts). */
export const useSessionListPrefs = create<Store>((set, get) => {
  const change = (patch: Partial<SessionListPrefs>) => {
    set(patch);
    const { status, pinned, order, groupByFolders } = get();
    savePrefs({ sessionList: { status, pinned, order, groupByFolders } });
  };
  return {
    ...listPrefsFrom(loadPrefs().sessionList),
    setStatus: (status) => change({ status }),
    setPinned: (pinned) => change({ pinned }),
    setOrder: (order) => change({ order }),
    setGroupByFolders: (groupByFolders) => change({ groupByFolders }),
  };
});
