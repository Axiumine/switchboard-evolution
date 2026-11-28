import { create } from 'zustand';

import { loadPrefs, savePrefs } from './prefs';

// The phone's own choices about notifications (Settings › Computer).

type NotificationPrefs = {
  /** A notification when a session needs you or finishes. */
  enabled: boolean;
  /** Stay connected while the app is in the background (Android). */
  background: boolean;
  /** What the system says: null until it has been read. */
  allowed: boolean | null;
  setEnabled(enabled: boolean): void;
  setBackground(background: boolean): void;
  setAllowed(allowed: boolean): void;
};

const saved = loadPrefs();

export const useNotificationPrefs = create<NotificationPrefs>((set) => ({
  // Both on until turned off.
  enabled: saved.notifications !== false,
  background: saved.keepConnected !== false,
  allowed: null,
  setEnabled: (enabled) => {
    savePrefs({ notifications: enabled });
    set({ enabled });
  },
  setBackground: (background) => {
    savePrefs({ keepConnected: background });
    set({ background });
  },
  setAllowed: (allowed) => set({ allowed }),
}));
