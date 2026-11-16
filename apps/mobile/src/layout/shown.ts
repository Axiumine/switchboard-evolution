import { useIsFocused } from 'expo-router';
import { createContext, useContext } from 'react';

/**
 * Whether a tab is on screen, where focus does not say it: on a Surface Duo
 * open across both screens two tabs show at once (DuoTabs), and the tab in
 * use on the left stays in sight while another screen is open on the right.
 * Null outside DuoTabs.
 */
export const TabShown = createContext<boolean | null>(null);

/** On screen now: DuoTabs says so on a Duo, focus does anywhere else. */
export function useShown(): boolean {
  const shown = useContext(TabShown);
  const focused = useIsFocused();
  return shown ?? focused;
}
