import { expect, test } from '@jest/globals';

import { chooseFolder, folderLabel, impactArgs, linkableFolders, worktreeNote } from '@/knowledge/model';
import { KNOWLEDGE_VIEWS, parseKnowledgeView, parseTab, PROJECT_TABS } from '@/projects/tabs';

test('the project page has Node Knowledge between Git and Env, and Env right before Settings', () => {
  const keys = PROJECT_TABS.map((t) => t.key);
  expect(keys.indexOf('knowledge')).toBe(keys.indexOf('git') + 1);
  expect(keys.indexOf('env')).toBe(keys.indexOf('knowledge') + 1);
  expect(keys.indexOf('settings')).toBe(keys.indexOf('env') + 1);
  expect(parseTab('knowledge')).toBe('knowledge');
  expect(parseTab('env')).toBe('env');
});

test('the phone has every view of the desktop but the Lens', () => {
  expect(KNOWLEDGE_VIEWS.map((v) => v.key)).toEqual(['overview', 'search', 'trace', 'impact', 'query', 'adr', 'coverage', 'compare', 'settings']);
  expect(parseKnowledgeView('lens')).toBe('overview');
  expect(parseKnowledgeView('trace')).toBe('trace');
});

test('Impact asks for uncommitted work against HEAD, a branch against its base, or since a ref', () => {
  expect(impactArgs({ against: 'uncommitted' })).toMatchObject({ since: 'HEAD', scope: 'impact', via: true });
  expect(impactArgs({ against: 'branch', ref: ' main ' })).toMatchObject({ base_branch: 'main' });
  expect(impactArgs({ against: 'branch' }).base_branch).toBeUndefined();
  expect(impactArgs({ against: 'since', ref: 'v1.0.0', scope: 'tests', depth: 50 })).toMatchObject({ since: 'v1.0.0', scope: 'tests', depth: 8 });
});

test('the folder shown: the one picked while attached, else the first indexed, else the first', () => {
  const folders = [{ path: '/work/web', indexed: false }, { path: '/work/api', indexed: true }];
  expect(chooseFolder(folders, '/work/web')).toBe('/work/web');
  expect(chooseFolder(folders, '/gone')).toBe('/work/api');
  expect(chooseFolder([{ path: '/work/web' }], undefined)).toBe('/work/web');
  expect(chooseFolder([], undefined)).toBeNull();
});

test('a worktree is named as one, with its repository and branch; other folders are not', () => {
  const wt = { path: '/work/api.worktrees/feat-login', mode: 'worktree', sourcePath: '/work/api', branch: 'feat/login' };
  expect(folderLabel(wt)).toBe('feat-login · worktree');
  expect(folderLabel({ path: '/work/api/', mode: 'in-place' })).toBe('api');
  expect(worktreeNote(wt)).toBe('Worktree of api, branch feat/login. Its code graph is its own, deleted when it leaves the project.');
  expect(worktreeNote({ path: '/w', mode: 'worktree' })).toBe('Worktree. Its code graph is its own, deleted when it leaves the project.');
  expect(worktreeNote({ path: '/work/api', mode: 'in-place' })).toBeNull();
});

test('the project folder is listed as such, the tab opens on the code, and Link now leaves it out', () => {
  const root = { path: '/work/proj', mode: 'project', indexed: true };
  const api = { path: '/work/api', mode: 'in-place', indexed: false };
  const web = { path: '/work/web', mode: 'in-place', indexed: true };
  expect(folderLabel(root)).toBe('Project folder');
  expect(chooseFolder([root, api, web], undefined)).toBe('/work/web');
  expect(chooseFolder([root, api], undefined)).toBe('/work/proj');
  expect(chooseFolder([{ ...root, indexed: false }, api], undefined)).toBe('/work/api');
  expect(chooseFolder([{ ...root, indexed: false }], undefined)).toBe('/work/proj');
  expect(linkableFolders([root, api, web]).map((f) => f.path)).toEqual(['/work/api', '/work/web']);
  expect(worktreeNote(root)).toBeNull();
});
