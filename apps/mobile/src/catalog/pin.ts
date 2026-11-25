import { create } from 'zustand';

import { loadPrefs, savePrefs } from '@/store/prefs';

type Store = { pinned: boolean; setPinned(pinned: boolean): void };

/**
 * The Commands panel pinned in the session's page (CommandsPanel 'docked'):
 * it stays open above the composer after a pick, until closed. Kept between
 * runs (src/store/prefs.ts), as the desktop keeps its palette's pin.
 */
export const useCommandsPin = create<Store>((set) => ({
  pinned: loadPrefs().commandsPinned === true,
  setPinned: (pinned) => {
    set({ pinned });
    savePrefs({ commandsPinned: pinned });
  },
}));
