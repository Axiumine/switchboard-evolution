// The order you give by dragging: the Starred section ('starred') and each
// project's pinned sessions ('pinned:<project id>'). These put a new order
// into the project tree the phone holds, so it shows at once; the desktop
// keeps it (set-starred-order, set-pinned-order) and its next tree agrees.

import type { Session } from '@/sessions/model';
import type { Project } from './model';

export type OrderGroup = 'starred' | `pinned:${string}`;
type Tree = { projects: Project[] };

export const STARRED: OrderGroup = 'starred';
export const pinnedGroup = (projectId: string): OrderGroup => `pinned:${projectId}`;

/** The project whose pinned sessions a group orders; null for the Starred section. */
export function pinnedProjectId(group: OrderGroup): string | null {
  return group.startsWith('pinned:') ? group.slice('pinned:'.length) : null;
}

/** The Starred section in the order of `ids`, the first one 0. */
export function withStarredOrder<T extends Tree>(tree: T, ids: readonly string[]): T {
  const rank = new Map(ids.map((id, i) => [id, i]));
  return { ...tree, projects: tree.projects.map((p) => (rank.has(p.id) && p.starred ? { ...p, starRank: rank.get(p.id) } : p)) };
}

/** A project's pinned sessions in the order of `ids`, the first one 0. */
export function withPinnedOrder<T extends Tree>(tree: T, projectId: string, ids: readonly string[]): T {
  const rank = new Map(ids.map((id, i) => [id, i]));
  const ranked = (list: Session[]) => list.map((s) => (rank.has(s.sessionId) && s.starred ? { ...s, pinRank: rank.get(s.sessionId) } : s));
  return {
    ...tree,
    projects: tree.projects.map((p) => (p.id !== projectId ? p : {
      ...p,
      sessions: ranked(p.sessions),
      tracks: p.tracks.map((t) => ({ ...t, sessions: ranked(t.sessions) })),
    })),
  };
}
