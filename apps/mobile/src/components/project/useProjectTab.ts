import { useLocalSearchParams, useNavigation } from 'expo-router';
import type { NavigationProp } from 'expo-router/react-navigation';
import { useCallback, useEffect } from 'react';

import { useListUi } from '@/projects/list-ui';
import { parseGitView, parseSessionView, parseTab, type ProjectTab, type SessionView } from '@/projects/tabs';
import { useProjectUi } from '@/projects/ui-store';

type Params = { tab?: ProjectTab; session?: string; view?: SessionView };

export type ProjectNav = {
  tab: ProjectTab;
  /** The session the Session tab shows, or null when none was opened in this project. */
  sessionId: string | null;
  /** What the Session tab was asked to show first: the chat or the terminal. */
  view: SessionView | undefined;
  selectTab: (tab: ProjectTab) => void;
  /** Show a session on the Session tab, as opening one on the desktop keeps you in the project. */
  openSession: (sessionId: string, view?: SessionView) => void;
};

/**
 * The project page's tab and session, and the functions that change them.
 * Opened without a tab (from the list) the page is on the tab it was last on,
 * Overview the first time; a `tab` param picks one, a `session` param the
 * session the Session tab shows, and the project remembers both.
 *
 * Changing tab sets this screen's params instead of pushing, so Back leaves
 * the project in one press. It goes through the screen's own navigation, not
 * `router.setParams`: on a Surface Duo the project can be the left screen with
 * another screen in front on the right, and `router` changes the screen in front.
 */
export function useProjectTab(projectId: string): ProjectNav {
  const params = useLocalSearchParams<{ tab?: string; session?: string; view?: string }>();
  const tabParam = params.tab;
  const sessionParam = typeof params.session === 'string' && params.session ? params.session : undefined;
  const [remembered, patchUi] = useProjectUi(projectId, (ui) => ui.tab);
  const [rememberedSession] = useProjectUi(projectId, (ui) => ui.session ?? null);
  const navigation = useNavigation<NavigationProp<Record<string, Params>>>();

  const sessionId = sessionParam ?? rememberedSession;
  // A Session tab with nothing to show is Overview.
  const asked = tabParam === undefined ? remembered : parseTab(tabParam);
  const tab = asked === 'session' && !sessionId ? 'overview' : asked;
  useEffect(() => { if (tabParam !== undefined && tab !== remembered) patchUi({ tab }); }, [tabParam, tab, remembered, patchUi]);
  useEffect(() => { if (sessionParam && sessionParam !== rememberedSession) patchUi({ session: sessionParam }); }, [sessionParam, rememberedSession, patchUi]);
  // A link to an old tab (Git Graph, Worktrees) opens its view of the Git tab.
  useEffect(() => {
    const gitView = parseGitView(tabParam);
    if (gitView && parseTab(tabParam) === 'git') patchUi({ gitView });
  }, [tabParam, patchUi]);

  const selectTab = useCallback((next: ProjectTab) => navigation.setParams({ tab: next }), [navigation]);
  const openSession = useCallback((id: string, view?: SessionView) => {
    // Highlighted in the Projects list too (on a Surface Duo, the left screen).
    useListUi.getState().reveal({ sessionId: id, projectId });
    patchUi({ session: id, tab: 'session' });
    navigation.setParams({ tab: 'session', session: id, view });
  }, [navigation, patchUi, projectId]);
  return { tab, sessionId, view: parseSessionView(params.view), selectTab, openSession };
}
