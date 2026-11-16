import { router } from 'expo-router';
import { CommonActions, TabActions } from 'expo-router/react-navigation';
import { createContext, useCallback, useContext } from 'react';

import { isDuoModel } from '@/layout/hinge';
import { queryClient } from '@/remote/query';
import { useListUi } from './list-ui';
import { projectSessions, type Project } from './model';
import type { SessionView } from './tabs';

// Opening a session that belongs to a project keeps you in the project, as on
// the desktop: the project page shows it on its Session tab, under its header
// and tabs. The Sessions tab, the Task Manager and notices still open the
// session on its own screen (on a Surface Duo, chat and terminal side by side).

export const PROJECT_ROUTE = 'project/[id]/index';

type Route = { key: string; name: string; params?: Record<string, unknown> };
type StackState = { index: number; routes: Route[]; routeNames?: string[] };
/** What these need of a screen's navigation (any navigator's, typed loosely). */
type Navigator = { getState(): unknown; getParent(): unknown; dispatch(action: any): void };

const stateOf = (nav: Navigator) => nav.getState() as StackState | undefined;

/** The project page's params that put one session on its Session tab. */
export function sessionTabParams(sessionId: string, view?: SessionView) {
  return { tab: 'session', session: sessionId, ...(view ? { view } : {}) };
}

/** The stack the project pages live in, from any screen's navigation. */
function projectStack(navigation: Navigator | undefined): Navigator | undefined {
  let nav = navigation;
  while (nav) {
    if (stateOf(nav)?.routeNames?.includes(PROJECT_ROUTE)) return nav;
    nav = nav.getParent() as Navigator | undefined;
  }
  return undefined;
}

/**
 * The route to change rather than push: the screen in front, when it already
 * is this project (on a Surface Duo, the right screen beside the list).
 */
export function projectInFront(state: StackState | undefined, projectId: string): Route | null {
  const top = state?.routes[state.index];
  return top?.name === PROJECT_ROUTE && top.params?.id === projectId ? top : null;
}

/** From outside the project page (the Projects list): the project, on its Session tab. */
export function openInProject(navigation: Navigator | undefined, projectId: string, sessionId: string, view?: SessionView): void {
  const stack = projectStack(navigation);
  const front = projectInFront(stack && stateOf(stack), projectId);
  if (stack && front) {
    stack.dispatch({ ...CommonActions.setParams(sessionTabParams(sessionId, view)), source: front.key });
    return;
  }
  router.push({ pathname: '/project/[id]', params: { id: projectId, ...sessionTabParams(sessionId, view) } });
}

/**
 * After a screen pushed over a project page (New session): when the screen
 * just below is that project, show the session there and go back to it.
 * False when it is not, and the caller opens the session its own way.
 */
export function returnToProject(navigation: Navigator, projectId: string | null | undefined, sessionId: string, view?: SessionView): boolean {
  const state = stateOf(navigation);
  const below = state?.routes[state.index - 1];
  if (!projectId || below?.name !== PROJECT_ROUTE || below.params?.id !== projectId) return false;
  navigation.dispatch({ ...CommonActions.setParams(sessionTabParams(sessionId, view)), source: below.key });
  navigation.dispatch(CommonActions.goBack());
  return true;
}

/** Set by a project page: its tabs open sessions on its own Session tab. */
export const ProjectSessionContext = createContext<((sessionId: string, view?: SessionView) => void) | null>(null);

/**
 * How a screen opens a session: on the project page's Session tab inside a
 * project page, on the session's own screen anywhere else.
 */
export function useOpenSession(): (sessionId: string, view?: SessionView) => void {
  const inProject = useContext(ProjectSessionContext);
  return useCallback((sessionId: string, view?: SessionView) => {
    if (inProject) inProject(sessionId, view);
    else router.push({ pathname: '/session/[id]', params: { id: sessionId, ...(view ? { tab: view } : {}) } });
  }, [inProject]);
}

/**
 * Open a session from a list of the tabs (Projects, Sessions, the Task
 * Manager). The Projects list highlights it, its project's drawer open. On a
 * Surface Duo the left screen turns to Projects (DuoTabs) and the session opens
 * on the right: on its project's Session tab when it has a project, else on
 * its own screen, never across both screens unless asked for (Split screen).
 * Anywhere else a session of the Sessions tab opens on its own screen, as before.
 */
export function openSessionFromTabs(
  navigation: Navigator | undefined,
  session: { sessionId: string; projectPath?: string | null },
  projectId: string | null | undefined,
  { inProject = isDuoModel() }: { inProject?: boolean } = {},
): void {
  const project = projectId ?? projectOfSession(session.sessionId);
  // From a tab: on a Surface Duo the left screen turns to Projects first, then
  // the session opens, a frame later, so the two never move at once.
  const tabs = tabsOf(navigation);
  if (isDuoModel() && tabs) {
    const state = stateOf(tabs);
    // A jump: a navigate would bring the tabs to the front and close what is open on the right.
    if (state?.routes[state.index]?.name !== 'projects') tabs.dispatch(TabActions.jumpTo('projects'));
  }
  useListUi.getState().reveal({ sessionId: session.sessionId, projectId: project, projectPath: session.projectPath });
  requestAnimationFrame(() => {
    if (project && inProject) openInProject(navigation, project, session.sessionId);
    else router.push({ pathname: '/session/[id]', params: { id: session.sessionId } });
  });
}

/** The tabs (the navigator with Projects and Sessions), from a screen inside them. */
function tabsOf(navigation: Navigator | undefined): Navigator | undefined {
  let nav = navigation;
  while (nav) {
    const names = stateOf(nav)?.routeNames;
    if (names?.includes('projects') && names.includes('index')) return nav;
    nav = nav.getParent() as Navigator | undefined;
  }
  return undefined;
}

/** The project a session belongs to, from the project tree already read (useProjectTree), or null. */
function projectOfSession(sessionId: string): string | null {
  const tree = queryClient.getQueryData<{ projects: Project[] }>(['project-tree']);
  return tree?.projects.find((p) => projectSessions(p).some((s) => s.sessionId === sessionId))?.id ?? null;
}
