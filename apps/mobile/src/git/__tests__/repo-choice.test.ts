import { describe, expect, it } from '@jest/globals';

import { chooseRepo, historyRepos, repoLabel, showRepoChips } from '../repo-choice';

const app = { path: '/work/app', git: true };
const docs = { path: '/work/docs', git: false };
const lib = { path: '/work/lib', git: true };

describe('repoLabel', () => {
  it('is the last part of the path', () => {
    expect(repoLabel('/work/app')).toBe('app');
    expect(repoLabel('/work/app/')).toBe('app');
    expect(repoLabel('C:\\work\\app')).toBe('app');
  });

  it('falls back to the whole path when there is no name', () => {
    expect(repoLabel('/')).toBe('/');
  });
});

describe('historyRepos', () => {
  it('leaves out what is not a git repository', () => {
    expect(historyRepos([docs, app, lib])).toEqual([app, lib]);
  });

  it('keeps everything when none is a git repository', () => {
    expect(historyRepos([docs])).toEqual([docs]);
  });

  it('keeps a repository whose status is not known yet', () => {
    const unknown = { path: '/work/new' };
    expect(historyRepos([unknown, docs])).toEqual([unknown]);
  });

  it('is empty for no repository', () => {
    expect(historyRepos([])).toEqual([]);
  });
});

describe('chooseRepo', () => {
  it('keeps the remembered repository', () => {
    expect(chooseRepo([app, docs, lib], '/work/lib')).toBe(lib);
    expect(chooseRepo([app, docs, lib], '/work/docs')).toBe(docs);
  });

  it('falls back to the first git repository when the remembered one is gone', () => {
    expect(chooseRepo([docs, app, lib], '/work/gone')).toBe(app);
    expect(chooseRepo([docs, app, lib], undefined)).toBe(app);
  });

  it('falls back to the first repository when none is a git repository', () => {
    expect(chooseRepo([docs], undefined)).toBe(docs);
  });

  it('is null when there is no repository', () => {
    expect(chooseRepo([], '/work/app')).toBeNull();
  });

  it('falls to the first git repository for one that History does not offer', () => {
    // Remembered in Changes, a folder that is not a git repository: History does not offer it.
    expect(chooseRepo(historyRepos([app, docs]), '/work/docs')).toBe(app);
  });
});

describe('showRepoChips', () => {
  it('needs more than one repository', () => {
    expect(showRepoChips([])).toBe(false);
    expect(showRepoChips([app])).toBe(false);
    expect(showRepoChips([app, lib])).toBe(true);
  });
});
