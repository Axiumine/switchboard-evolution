import { describe, expect, it } from '@jest/globals';

import { invertSelection, selectAll, trashQuestion } from '@/shared/vendor/file-selection';

import { afterTrash, trashPicked } from '../selection';

describe('trashPicked', () => {
  it('sends the shallowest ticks in one call to a computer that can take them', async () => {
    const calls: unknown[][] = [];
    const call = async <T,>(method: string, params: unknown[], options?: { timeoutMs?: number }) => {
      calls.push([method, params, options?.timeoutMs]);
      return { ok: true, removed: ['docs', 'b.md'], failed: [] } as T;
    };
    const outcome = await trashPicked({ root: '/work/app', picked: ['docs/a.md', 'docs', 'b.md'], canTrashMany: true, call });
    expect(calls).toEqual([['trash-project-entries', ['/work/app', ['b.md', 'docs']], 120000]]);
    expect(outcome).toEqual({ removed: ['docs', 'b.md'], failed: [] });
  });

  it('trashes one entry at a time on an older computer, keeping what failed', async () => {
    const calls: string[] = [];
    const call = async <T,>(method: string, params: unknown[]) => {
      const rel = (params as string[])[1];
      calls.push(`${method} ${rel}`);
      if (rel === 'c.md') throw new Error('No longer exists');
      return { ok: true } as T;
    };
    const outcome = await trashPicked({ root: '/work/app', picked: new Set(['a.md', 'c.md']), canTrashMany: false, call });
    expect(calls).toEqual(['manage-project-entry a.md', 'manage-project-entry c.md']);
    expect(outcome).toEqual({ removed: ['a.md'], failed: [{ rel: 'c.md', error: 'No longer exists' }] });
  });

  it('asks nothing of the computer when nothing is ticked', async () => {
    const outcome = await trashPicked({ root: '/r', picked: [], canTrashMany: true, call: async () => { throw new Error('called'); } });
    expect(outcome).toEqual({ removed: [], failed: [] });
  });
});

describe('afterTrash', () => {
  it('closes the removed folders and the file that was inside them', () => {
    expect(afterTrash(['docs', 'docs/deep', 'src'], 'docs/deep/x.md', ['docs'])).toEqual({ expanded: ['src'], selected: null });
    expect(afterTrash(['src'], 'src/a.ts', ['b.md'])).toEqual({ expanded: ['src'], selected: 'src/a.ts' });
  });
});

describe('the shared selection helpers on the phone', () => {
  it('select all, invert and the question work on the loaded rows', () => {
    const visible = ['docs', 'docs/a.md', 'b.md'];
    expect([...selectAll(visible)]).toEqual(visible);
    expect([...invertSelection(visible, new Set(['docs']))]).toEqual(['docs/a.md', 'b.md']);
    expect(trashQuestion([{ rel: 'docs', isDir: true }, { rel: 'b.md', isDir: false }]).title).toBe('Move 2 items to the Trash?');
  });
});
