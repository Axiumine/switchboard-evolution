import { describe, expect, it } from '@jest/globals';

import type { HistoryRow } from '@/git/history';
import { badgeTexts, estimateTextWidth } from '@/git/row-width';

const row = (over: Partial<HistoryRow> = {}): HistoryRow => ({
  kind: 'commit', hash: 'a'.repeat(40), shortHash: 'aaaaaaaa', parents: [],
  authorName: 'Ada', authorEmail: '', authorDate: '2026-11-18T10:00:00Z', commitDate: '2026-11-18T10:00:00Z',
  subject: 'Fix it', ...over,
});

describe('the width of a history row', () => {
  it('names every ref in full: heads, then remotes as remote/name, then tags', () => {
    const refs = { heads: ['main', 'chore/strip-analysis-pipeline'], remotes: [{ remote: 'origin', name: 'chore/strip-analysis-pipeline' }], tags: ['v1.4.2'] };
    expect(badgeTexts(row({ refs }))).toEqual(['main', 'chore/strip-analysis-pipeline', 'origin/chore/strip-analysis-pipeline', 'v1.4.2']);
    expect(badgeTexts(row())).toEqual([]);
  });

  it('grows with the subject', () => {
    const short = estimateTextWidth(row({ subject: 'Fix it' }));
    const long = estimateTextWidth(row({ subject: 'Merge #774 (chore/remove-n8n-workflows-from-the-repository-and-docs)' }));
    expect(long).toBeGreaterThan(short);
    // At least a few dp a character at 14 dp: a long subject is never squeezed into a phone's width.
    expect(long).toBeGreaterThan(68 * 6);
  });

  it('adds every badge in front of the subject', () => {
    const plain = estimateTextWidth(row({ subject: 'Merge pull request #786' }));
    const withRefs = estimateTextWidth(row({
      subject: 'Merge pull request #786',
      refs: { heads: ['feat/internal-rules-registry'], remotes: [{ remote: 'origin', name: 'feat/internal-rules-registry' }], tags: [] },
    }));
    expect(withRefs).toBeGreaterThan(plain + 2 * 'feat/internal-rules-registry'.length * 5);
  });

  it('widens for the repository name that starts the line under the subject, stashes and uncommitted changes included', () => {
    const name = 'a-repository-with-a-long-name';
    expect(estimateTextWidth(row({ subject: 'x' }), name)).toBeGreaterThan(estimateTextWidth(row({ subject: 'x' })));
    expect(estimateTextWidth(row({ kind: 'uncommitted', subject: 'x' }), name)).toBeGreaterThan(name.length * 5);
    expect(estimateTextWidth(row({ subject: 'x' }), '')).toBe(estimateTextWidth(row({ subject: 'x' })));
  });

  it('is never narrower than the line under the subject', () => {
    const author = 'An author with a really rather long name indeed';
    expect(estimateTextWidth(row({ subject: 'x', authorName: author }))).toBeGreaterThan(author.length * 5);
    // Stashes and uncommitted changes have no such line.
    expect(estimateTextWidth(row({ kind: 'stash', subject: 'x', authorName: author }))).toBeLessThan(author.length * 5);
  });
});
