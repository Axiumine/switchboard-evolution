import { describe, expect, it } from '@jest/globals';

import { repoColorMap } from '@/shared/vendor/repo-colors';

import { carryRepoPatch, chooseRepo, chooseRepos, historyRepos, repoColors, repoLabel, selectionPatch, showRepoChips } from '../repo-choice';

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

describe('chooseRepos', () => {
  const repos = [app, lib, { path: '/work/tools', git: true }];

  it('keeps what is remembered, in the project order, with the primary among it', () => {
    expect(chooseRepos(repos, ['/work/tools', '/work/app'], '/work/tools')).toEqual({ primary: '/work/tools', paths: ['/work/app', '/work/tools'] });
    expect(chooseRepos(repos, undefined, '/work/lib')).toEqual({ primary: '/work/lib', paths: ['/work/lib'] });
  });

  it('adds the primary when the list lacks it, and drops paths that are gone', () => {
    expect(chooseRepos(repos, ['/work/app', '/work/gone'], '/work/lib')).toEqual({ primary: '/work/lib', paths: ['/work/app', '/work/lib'] });
  });

  it('shows what chooseRepo would when nothing remembered is still there', () => {
    expect(chooseRepos([docs, lib], undefined, undefined)).toEqual({ primary: '/work/lib', paths: ['/work/lib'] });
    expect(chooseRepos(repos, ['/work/gone'], '/work/gone2')).toEqual({ primary: '/work/app', paths: ['/work/app'] });
    expect(chooseRepos([], ['/work/app'], '/work/app')).toEqual({ primary: null, paths: [] });
  });
});

describe('carryRepoPatch', () => {
  it('keeps the selection when it shows the repository, with it as primary', () => {
    expect(carryRepoPatch({ gitRepo: '/work/app', gitRepos: ['/work/app', '/work/lib'] }, '/work/lib')).toEqual({ gitRepo: '/work/lib', gitRepos: ['/work/app', '/work/lib'] });
  });

  it('takes the repository alone otherwise', () => {
    expect(carryRepoPatch({ gitRepo: '/work/app', gitRepos: ['/work/app', '/work/lib'] }, '/work/docs')).toEqual({ gitRepo: '/work/docs', gitRepos: ['/work/docs'] });
    expect(carryRepoPatch({}, '/work/app')).toEqual({ gitRepo: '/work/app', gitRepos: ['/work/app'] });
  });
});

describe('selectionPatch', () => {
  it('remembers the primary and every path', () => {
    expect(selectionPatch({ primary: '/work/lib', paths: ['/work/app', '/work/lib'] })).toEqual({ gitRepo: '/work/lib', gitRepos: ['/work/app', '/work/lib'] });
    expect(selectionPatch({ primary: null, paths: [] })).toEqual({ gitRepos: [] });
  });
});

describe('repoColors', () => {
  const project = { root: '/work/project', folders: [{ path: '/work/app' }, { path: '/work/lib' }] };

  it('gives each folder a color, the same as the desktop (repoColorMap over the folders in order)', () => {
    const colors = repoColors(project);
    expect(colors).toEqual({ ...repoColorMap(['/work/app', '/work/lib', '/work/project']) });
    expect(colors['/work/app']).not.toBe(colors['/work/lib']);
  });

  it('keeps a folder\'s color when paths are appended', () => {
    const base = repoColors(project);
    const more = repoColors(project, ['/work/nested']);
    expect(more['/work/app']).toBe(base['/work/app']);
    expect(more['/work/lib']).toBe(base['/work/lib']);
    expect(more['/work/nested']).toBeDefined();
  });

  it('copes with no folders', () => {
    expect(repoColors({ folders: [] })).toEqual({});
  });
});
