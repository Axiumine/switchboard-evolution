// What a session search shows, and what its "Stop" button ends, as the
// desktop's search bar does it (public/search-results.js in switchboard).

import type { Project } from '@/projects/model';
import { projectSessions } from '@/projects/model';
import { sessionState, sessionTitle, type LiveState, type Session } from './model';

/**
 * Whether the title a session row shows contains the query. It catches the
 * sessions the computer's search index has not seen: terminals, and sessions
 * with no transcript yet, which are often the ones still running.
 */
export function titleMatches(session: Pick<Session, 'name' | 'aiTitle' | 'summary'>, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return false;
  return [session.name, session.aiTitle, session.summary].some((text) => typeof text === 'string' && text.toLowerCase().includes(q));
}

/** The search's matches: the index's hits, plus every session whose title matches. */
export function matchesWithTitles(hitIds: Iterable<string>, sessions: Session[], query: string): Set<string> {
  const ids = new Set(hitIds);
  for (const session of sessions) if (titleMatches(session, query)) ids.add(session.sessionId);
  return ids;
}

/** A session with a live process, whatever it is doing. */
export function isLive(live: LiveState | undefined): boolean {
  return sessionState(live) !== 'idle';
}

export type ProjectResult = { project: Project; sessions: Session[] };

/**
 * The Projects tab's results: each project the search found, with the
 * sessions to list under it. Those are the ones that match and, when the
 * project's own name matches, the ones running in it. Projects and sessions
 * left out of this search are gone; a project whose sessions were all left
 * out still shows, as it was found.
 */
export function projectSearchResults(
  projects: Project[],
  { query, matchIds, excludedProjects = new Set(), excludedSessions = new Set(), isRunning }:
  { query: string; matchIds: Set<string>; excludedProjects?: Set<string>; excludedSessions?: Set<string>; isRunning: (id: string) => boolean },
): ProjectResult[] {
  const q = query.trim().toLowerCase();
  const results: ProjectResult[] = [];
  for (const project of projects) {
    if (excludedProjects.has(project.id)) continue;
    const nameMatched = !!q && project.name.toLowerCase().includes(q);
    const all = projectSessions(project);
    if (!nameMatched && !all.some((s) => matchIds.has(s.sessionId))) continue;
    const sessions = all.filter((s) => !excludedSessions.has(s.sessionId)
      && (matchIds.has(s.sessionId) || (nameMatched && isRunning(s.sessionId))));
    results.push({ project, sessions });
  }
  return results;
}

/** The running sessions among those shown, once each: what "Stop" ends. */
export function runningAmong(sessions: Session[], isRunning: (id: string) => boolean): Session[] {
  const seen = new Set<string>();
  return sessions.filter((s) => {
    if (seen.has(s.sessionId) || !isRunning(s.sessionId)) return false;
    seen.add(s.sessionId);
    return true;
  });
}

/** The one question before Stop: how many, matching what, and which (mid-turn ones marked). */
export function stopQuestion(running: Session[], busy: Set<string>, query: string): { title: string; message: string } {
  const n = running.length;
  const working = running.filter((s) => busy.has(s.sessionId)).length;
  const lines = running.slice(0, 8).map((s) => `${sessionTitle(s)}${busy.has(s.sessionId) ? '  · working' : ''}`);
  if (n > 8) lines.push(`+ ${n - 8} more`);
  const note = working ? `${working} session${working === 1 ? ' is' : 's are'} mid-turn; stopping interrupts work in progress.\n\n` : '';
  return { title: `Stop ${n} running session${n === 1 ? '' : 's'} matching "${query.trim()}"?`, message: note + lines.join('\n') };
}
