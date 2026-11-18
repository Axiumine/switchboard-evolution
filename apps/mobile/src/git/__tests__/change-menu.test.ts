import { describe, expect, it } from '@jest/globals';

import { discardQuestion, ignorePattern } from '@/shared/vendor/git-change-actions';

import { changeMenu, sectionChangesIn } from '../change-menu';
import type { Change } from '../model';
import { stagingSections } from '../staging';

const change = (path: string, code: string): Change => ({
  path, code, indexStatus: code[0], worktreeStatus: code[1], status: code === '??' ? 'untracked' : code === 'UU' ? 'conflicted' : 'modified', staged: code[0] !== ' ' && code[0] !== '?',
});

const all = [change('src/a.js', ' M'), change('src/new.txt', '??'), change('b.js', 'M '), change('c.txt', 'UU')];
const sections = Object.fromEntries(stagingSections(all).map((section) => [section.key, section]));
const can = { stage: true, discard: true, ignore: true };
const labels = (entries: { label: string }[]) => entries.map((entry) => entry.label);

describe('changeMenu', () => {
  it('offers Discard in Changes and the .gitignore entry that fits', () => {
    expect(labels(changeMenu(sections.changes, { path: 'src/new.txt', dir: false }, all, can))).toEqual(['Stage Changes', 'Discard Changes…', 'Add to .gitignore']);
    expect(labels(changeMenu(sections.changes, { path: 'src/a.js', dir: false }, all, can))).toEqual(['Stage Changes', 'Discard Changes…', 'Add to .gitignore and Remove from Git…']);
    expect(labels(changeMenu(sections.changes, { path: 'src', dir: true }, all, can)))
      .toEqual(['Stage Changes', 'Discard Changes…', 'Add to .gitignore', 'Add to .gitignore and Remove from Git…']);
  });

  it('has no Discard in Staged Changes and nothing but staging on a conflict', () => {
    expect(labels(changeMenu(sections.staged, { path: 'b.js', dir: false }, all, can))).toEqual(['Unstage Changes', 'Add to .gitignore and Remove from Git…']);
    expect(labels(changeMenu(sections.merge, { path: 'c.txt', dir: false }, all, can))).toEqual(['Stage (Mark as Resolved)']);
  });

  it('keeps to what an older computer can do', () => {
    expect(labels(changeMenu(sections.changes, { path: 'src', dir: true }, all, { stage: true, discard: false, ignore: false }))).toEqual(['Stage Changes']);
  });

  it('marks what loses work as destructive', () => {
    const entries = changeMenu(sections.changes, { path: 'src', dir: true }, all, can);
    expect(entries.filter((entry) => entry.destructive).map((entry) => entry.action)).toEqual(['discard', 'untrack']);
  });
});

describe('sectionChangesIn', () => {
  it('takes the files of a folder from its own section only', () => {
    expect(sectionChangesIn(sections.changes, { path: 'src', dir: true }).map((item) => item.path)).toEqual(['src/a.js', 'src/new.txt']);
    expect(sectionChangesIn(sections.staged, { path: 'src', dir: true })).toEqual([]);
  });
});

describe('the shared rules, as the phone reads them', () => {
  it('asks the same question as the desktop and writes the same line', () => {
    expect(discardQuestion([change('src/new.txt', '??')]).confirm).toBe('Move to Trash');
    expect(ignorePattern('dist', true)).toBe('/dist/');
  });
});
