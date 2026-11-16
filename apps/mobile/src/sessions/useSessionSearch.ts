import { useQuery } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { request, useConnection } from '@/store/connection';
import type { Session } from './model';
import { matchesWithTitles } from './search-stop';

/** Wait for typing to pause before searching. */
export function useDebounced<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(timer);
  }, [value, ms]);
  return debounced;
}

/**
 * A session search, as the Sessions and Projects tabs share it: the query,
 * the matching session ids (the computer's full-text search over what was
 * said, plus every session whose title matches), and what was left out of
 * this search with its X. A new query starts with nothing left out.
 */
export function useSessionSearch(scope: string, sessions: Session[]) {
  const online = useConnection((s) => s.status.state === 'online');
  const [query, setQuery] = useState('');
  const search = useDebounced(query.trim(), 300);
  const searching = search.length > 1;
  const ids = useMemo(() => sessions.map((s) => s.sessionId), [sessions]);
  const hits = useQuery({
    queryKey: ['search', scope, search, ids.length],
    queryFn: () => request<string[]>('search-session-ids', [search, ids]),
    enabled: online && searching && ids.length > 0,
  });
  const matchIds = useMemo(
    () => (searching ? matchesWithTitles(hits.data || [], sessions, search) : null),
    [searching, hits.data, sessions, search],
  );

  // What was left out belongs to the query it was left out of: another query sees none.
  const [left, setLeft] = useState<Excluded>(NONE);
  const current = left.query === search ? left : NONE;
  const leaveOut = useCallback(({ sessionId, projectId }: { sessionId?: string; projectId?: string }) => {
    setLeft((prev) => {
      const base = prev.query === search ? prev : { ...NONE, query: search };
      return {
        query: search,
        sessions: sessionId ? new Set(base.sessions).add(sessionId) : base.sessions,
        projects: projectId ? new Set(base.projects).add(projectId) : base.projects,
      };
    });
  }, [search]);
  const restore = useCallback(() => setLeft(NONE), []);
  // Typing another query, or clearing it, ends the search that things were left out of.
  const changeQuery = useCallback((text: string) => {
    setQuery(text);
    setLeft((prev) => (prev.query === null || prev.query === text.trim() ? prev : NONE));
  }, []);

  return {
    query, setQuery: changeQuery, search, searching, matchIds,
    excludedSessions: current.sessions, excludedProjects: current.projects,
    leftOut: current.sessions.size + current.projects.size,
    leaveOut, restore,
  };
}

type Excluded = { query: string | null; sessions: Set<string>; projects: Set<string> };
const NONE: Excluded = { query: null, sessions: new Set(), projects: new Set() };
