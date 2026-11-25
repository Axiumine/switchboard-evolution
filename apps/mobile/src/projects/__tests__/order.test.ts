import { describe, expect, it } from '@jest/globals';

import type { Session } from '@/sessions/model';
import type { Project } from '../model';
import { pinnedGroup, pinnedProjectId, STARRED, withPinnedOrder, withStarredOrder } from '../order';

const s = (sessionId: string, extra: Partial<Session> = {}): Session => ({ sessionId, projectPath: '/code/app', ...extra });
const project = (id: string, extra: Partial<Project> = {}): Project => ({
  id, name: id, root: `/code/${id}`, status: 'active', snoozedUntil: null, defaultCwd: null,
  folders: [], tracks: [], schedules: [], sessions: [], ...extra,
});

describe('the order a drag gives', () => {
  it('names its group', () => {
    expect(pinnedProjectId(pinnedGroup('p1'))).toBe('p1');
    expect(pinnedProjectId(STARRED)).toBeNull();
  });

  it('ranks the starred projects in the order given, and no other', () => {
    const tree = { projects: [project('a', { starred: true }), project('b'), project('c', { starred: true })] };
    const next = withStarredOrder(tree, ['c', 'a', 'b']);
    expect(next.projects.map((p) => p.starRank)).toEqual([1, undefined, 0]);
    expect(tree.projects[0].starRank).toBeUndefined();
  });

  it("ranks a project's pinned sessions, in its tracks too, and leaves the other projects alone", () => {
    const tree = {
      projects: [
        project('p1', { sessions: [s('x', { starred: 1 }), s('loose')], tracks: [{ id: 't', name: 'T', status: 'active', cwd: null, cli: null, sessions: [s('y', { starred: 1 })] }] }),
        project('p2', { sessions: [s('z', { starred: 1 })] }),
      ],
    };
    const next = withPinnedOrder(tree, 'p1', ['y', 'x', 'loose', 'z']);
    expect(next.projects[0].sessions.map((x) => x.pinRank)).toEqual([1, undefined]);
    expect(next.projects[0].tracks[0].sessions[0].pinRank).toBe(0);
    expect(next.projects[1]).toBe(tree.projects[1]);
  });
});
