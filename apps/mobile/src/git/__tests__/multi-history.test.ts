import { describe, expect, it } from '@jest/globals';

import type { GraphCommit } from '../history';
import {
  commonFolder, grownLimits, initialLimit, MAX_COMMITS, mergeSlices, morePlan, plainRow, rankOf, repoKey, sliceInfo, sliceRows, sliceTag, splitKey,
  type GraphData, type Slice,
} from '../multi-history';

const commit = (hash: string, parents: string[], date: string, extra: Partial<GraphCommit> = {}): GraphCommit => ({
  hash, shortHash: hash.slice(0, 7), parents, authorName: 'dev-one', authorEmail: '', authorDate: date, commitDate: date, subject: `Change ${hash}`, ...extra,
});

function data(commits: GraphCommit[], extra: Partial<GraphData> = {}): GraphData {
  return { ok: true, hasMore: false, commits, stashes: [], uncommitted: null, refs: null, ...extra };
}

const slice = (folder: string, answer: GraphData | undefined, limit = 100): Slice => ({ folder, data: answer, limit });

describe('keys', () => {
  it('put a hash under its folder\'s tag and take it back', () => {
    expect(repoKey('r1', 'abc')).toBe('r1:abc');
    expect(repoKey(null, 'abc')).toBe('abc');
    expect(splitKey('r12:abc')).toEqual({ tag: 'r12', sha: 'abc' });
    expect(splitKey('r0:#uncommitted')).toEqual({ tag: 'r0', sha: '#uncommitted' });
  });

  it('read a plain hash or #uncommitted as having no tag', () => {
    expect(splitKey('abc123')).toEqual({ tag: null, sha: 'abc123' });
    expect(splitKey('#uncommitted')).toEqual({ tag: null, sha: '#uncommitted' });
  });

  it('tag only when there are several folders', () => {
    expect(sliceTag(0, 1)).toBeNull();
    expect(sliceTag(2, 3)).toBe('r2');
  });
});

describe('what each folder is asked for', () => {
  it('gives one folder the whole first page and several a share, never under 100', () => {
    expect(initialLimit(1)).toBe(300);
    expect(initialLimit(2)).toBe(150);
    expect(initialLimit(3)).toBe(100);
    expect(initialLimit(8)).toBe(100);
  });

  it('grows only the planned folders, up to the most the computer sends', () => {
    expect(grownLimits({ '/a': 150 }, ['/a', '/b'], 150, 100)).toEqual({ '/a': 250, '/b': 250 });
    expect(grownLimits({ '/a': MAX_COMMITS - 10 }, ['/a'], 150)).toEqual({ '/a': MAX_COMMITS });
    expect(grownLimits({}, [], 150)).toEqual({});
  });
});

describe('the rows of one folder', () => {
  const answer = data(
    [commit('b2', ['a1'], '2026-03-02T10:00:00Z', { isHead: true }), commit('a1', [], '2026-03-01T10:00:00Z')],
    { uncommitted: { changeCount: 2 }, stashes: [{ hash: 's1', index: 0, message: 'wip', date: '2026-03-02T09:00:00Z', baseCommitHash: 'a1' }] },
  );

  it('namespaces hashes and parents, the Uncommitted Changes and a stash\'s base included, and keeps git\'s hash in sha', () => {
    const rows = sliceRows(slice('/work/app', answer), 'r1');
    expect(rows.map((row) => row.hash)).toEqual(['r1:#uncommitted', 'r1:b2', 'r1:s1', 'r1:a1']);
    expect(rows.map((row) => row.sha)).toEqual(['#uncommitted', 'b2', 's1', 'a1']);
    expect(rows[0].parents).toEqual(['r1:b2']);
    expect(rows.find((row) => row.sha === 's1')?.parents).toEqual(['r1:a1']);
    expect(rows.every((row) => row.folder === '/work/app')).toBe(true);
  });

  it('leaves them as they are without a tag', () => {
    const rows = sliceRows(slice('/work/app', answer), null);
    expect(rows.map((row) => row.hash)).toEqual(['#uncommitted', 'b2', 's1', 'a1']);
    expect(rows[1].parents).toEqual(['a1']);
  });

  it('is empty before the answer, and for an error', () => {
    expect(sliceRows(slice('/work/app', undefined), 'r0')).toEqual([]);
    expect(sliceRows(slice('/work/app', data([], { error: 'not a repository' })), 'r0')).toEqual([]);
  });

  it('plainRow gives back what the computer knows', () => {
    const row = sliceRows(slice('/work/app', answer), 'r1')[1];
    expect(plainRow(row)).toMatchObject({ hash: 'b2', parents: ['a1'], folder: '/work/app', sha: 'b2' });
    const first = sliceRows(slice('/work/app', answer), 'r1')[0];
    expect(plainRow(first).parents).toEqual(['b2']);
  });
});

describe('the merged history', () => {
  const app = slice('/work/app', data([commit('a3', ['a2'], '2026-03-05T10:00:00Z'), commit('a2', ['a1'], '2026-03-03T10:00:00Z'), commit('a1', [], '2026-03-01T10:00:00Z')]));
  const lib = slice('/work/lib', data([commit('b2', ['b1'], '2026-03-04T10:00:00Z'), commit('b1', [], '2026-03-02T10:00:00Z')]));

  it('is one list newest first, each folder keeping its own order', () => {
    const { rows, hasMore } = mergeSlices([app, lib]);
    expect(rows.map((row) => row.hash)).toEqual(['r0:a3', 'r1:b2', 'r0:a2', 'r1:b1', 'r0:a1']);
    expect(hasMore).toBe(false);
  });

  it('keeps the same commit of two repositories apart', () => {
    const same = commit('c1', [], '2026-03-01T10:00:00Z');
    const { rows } = mergeSlices([slice('/work/app', data([same])), slice('/work/lib', data([same]))]);
    expect(rows.map((row) => row.hash)).toEqual(['r0:c1', 'r1:c1']);
    expect(rows.map((row) => row.folder)).toEqual(['/work/app', '/work/lib']);
    expect(rows.map((row) => row.sha)).toEqual(['c1', 'c1']);
  });

  it('puts every Uncommitted Changes row on top, in the folders\' order', () => {
    const dirty = (folder: string, count: number, hash: string) => slice(folder, data([commit(hash, [], '2026-03-09T10:00:00Z', { isHead: true })], { uncommitted: { changeCount: count } }));
    const { rows } = mergeSlices([dirty('/work/app', 2, 'a1'), dirty('/work/lib', 5, 'b1')]);
    expect(rows.map((row) => row.hash)).toEqual(['r0:#uncommitted', 'r1:#uncommitted', 'r0:a1', 'r1:b1']);
    expect(rows.slice(0, 2).map((row) => row.kind)).toEqual(['uncommitted', 'uncommitted']);
    expect(rows[0].parents).toEqual(['r0:a1']);
  });

  it('stops where a folder with more to load runs out, and holds the rest', () => {
    // The app has 3 commits loaded and more to come; once its third is shown, an older commit of
    // the app could come before the lib's, so the lib's older ones wait.
    const moreApp = slice('/work/app', data([commit('a3', ['a2'], '2026-03-05T10:00:00Z'), commit('a2', ['a1'], '2026-03-03T10:00:00Z')], { hasMore: true }));
    const merged = mergeSlices([moreApp, lib]);
    expect(merged.rows.map((row) => row.hash)).toEqual(['r0:a3', 'r1:b2', 'r0:a2']);
    expect(merged.held).toEqual({ '/work/app': 0, '/work/lib': 1 });
    expect(merged.hasMore).toBe(true);
    // Load more asks the folder that stopped it, not the one that is only held.
    expect(morePlan([moreApp, lib], merged.held, 100)).toEqual(['/work/app']);
  });

  it('plans every folder with more that holds fewer than the page', () => {
    const a = slice('/work/app', data([commit('a2', ['a1'], '2026-03-05T10:00:00Z'), commit('a1', [], '2026-03-01T10:00:00Z')], { hasMore: true }));
    const b = slice('/work/lib', data([commit('b1', [], '2026-03-04T10:00:00Z')], { hasMore: true }));
    const merged = mergeSlices([a, b]);
    expect(morePlan([a, b], merged.held, 100)).toEqual(['/work/app', '/work/lib']);
  });

  it('plans nothing for a folder asked for the most there is, and drops its hasMore', () => {
    const maxed = slice('/work/app', data([commit('a1', [], '2026-03-01T10:00:00Z')], { hasMore: true }), MAX_COMMITS);
    const merged = mergeSlices([maxed, lib]);
    expect(merged.hasMore).toBe(false);
    expect(morePlan([maxed, lib], merged.held)).toEqual([]);
  });

  it('shows the folders that answered while one has an error or has not answered', () => {
    const broken = slice('/work/gone', data([], { error: 'not a repository' }));
    const waiting = slice('/work/new', undefined);
    const { rows } = mergeSlices([app, broken, waiting]);
    expect(rows.map((row) => row.hash)).toEqual(['r0:a3', 'r0:a2', 'r0:a1']);
  });

  it('is the folder\'s own rows, not namespaced, for a single folder', () => {
    const only = slice('/work/app', data([commit('a2', ['a1'], '2026-03-05T10:00:00Z'), commit('a1', [], '2026-03-01T10:00:00Z')], { hasMore: true }));
    const merged = mergeSlices([only]);
    expect(merged.rows.map((row) => row.hash)).toEqual(['a2', 'a1']);
    expect(merged.rows[0].parents).toEqual(['a1']);
    expect(merged.hasMore).toBe(true);
    expect(morePlan([only], merged.held)).toEqual(['/work/app']);
    expect(morePlan([{ ...only, data: data([], { hasMore: false }) }], {})).toEqual([]);
  });

  it('is empty for no folder', () => {
    expect(mergeSlices([])).toEqual({ rows: [], hasMore: false, held: {} });
  });
});

describe('ranking and helpers', () => {
  it('ranks the Uncommitted Changes above any date', () => {
    expect(rankOf({ kind: 'uncommitted', commitDate: '2000-01-01T00:00:00Z', authorDate: '' })).toBe(Infinity);
    expect(rankOf({ kind: 'commit', commitDate: '2026-03-01T00:00:00Z', authorDate: '' })).toBeGreaterThan(rankOf({ kind: 'commit', commitDate: '2026-02-01T00:00:00Z', authorDate: '' }));
  });

  it('finds the one folder some rows share', () => {
    expect(commonFolder([{ folder: '/work/app' }, { folder: '/work/app' }])).toBe('/work/app');
    expect(commonFolder([{ folder: '/work/app' }, { folder: '/work/lib' }])).toBeNull();
    expect(commonFolder([])).toBeNull();
  });

  it('reads the branch, upstreams and HEAD of an answer', () => {
    const answer = data([commit('h1', [], '2026-03-01T10:00:00Z', { isHead: true })], {
      refs: { heads: [{ name: 'main', hash: 'h1', isHead: true, upstream: 'origin/main' }, { name: 'dev', hash: 'h1', isHead: false, upstream: null }] },
    });
    expect(sliceInfo(answer)).toEqual({ headHash: 'h1', currentBranch: 'main', upstreams: { main: 'origin/main', dev: null } });
    expect(sliceInfo(undefined)).toEqual({ headHash: null, currentBranch: null, upstreams: {} });
  });
});
