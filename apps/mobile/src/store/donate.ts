import { useEffect } from 'react';
import { AppState } from 'react-native';
import { create } from 'zustand';

import {
  addDonateUsage, closeDonateBox, donateBoxDue, donateState, markDonated, type DonateState,
} from '@/shared/vendor/donate';
import { loadPrefs, savePrefs } from '@/store/prefs';

// The donation box, as the desktop has it (donate.js has the rule): the one
// under the projects list shows after an hour of use, its X puts it away for
// another hour, and once Donate was pressed (there or in Settings) it does not
// come back. The time of use is the app's in the foreground, kept in prefs.json
// with the rest.

type DonateStore = DonateState & {
  addUsage(ms: number): void;
  /** The X of the box under the projects list. */
  close(): void;
  /** Donate was pressed. */
  recordDonation(): void;
};

export const useDonate = create<DonateStore>((set, get) => {
  const change = (step: (state: DonateState) => DonateState) => {
    const { usageMs, showAtMs, donated } = get();
    const next = step({ usageMs, showAtMs, donated });
    set(next);
    savePrefs({ donate: next });
  };
  return {
    ...donateState(loadPrefs().donate),
    addUsage: (ms) => change((state) => addDonateUsage(state, ms)),
    close: () => change(closeDonateBox),
    recordDonation: () => change(markDonated),
  };
});

/** Whether the box under the projects list shows. */
export const useDonateBoxDue = () => useDonate((state) => donateBoxDue(state));

const STEP_MS = 60 * 1000;

/**
 * Counts the time the app is in the foreground: a minute at a time, and what
 * is left when it goes to the background. Mounted once, by the root layout.
 */
export function useDonateUsage() {
  useEffect(() => {
    let since: number | null = AppState.currentState === 'active' ? Date.now() : null;
    const flush = () => {
      if (since === null) return;
      const now = Date.now();
      useDonate.getState().addUsage(now - since);
      since = now;
    };
    const timer = setInterval(flush, STEP_MS);
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        if (since === null) since = Date.now();
      } else {
        flush();
        since = null;
      }
    });
    return () => {
      clearInterval(timer);
      subscription.remove();
      flush();
    };
  }, []);
}
