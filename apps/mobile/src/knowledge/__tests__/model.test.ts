import { expect, test } from '@jest/globals';

import { chooseFolder, impactArgs } from '@/knowledge/model';
import { KNOWLEDGE_VIEWS, parseKnowledgeView, parseTab, PROJECT_TABS } from '@/projects/tabs';

test('the project page has Node Knowledge between Git and Settings', () => {
  const keys = PROJECT_TABS.map((t) => t.key);
  expect(keys.indexOf('knowledge')).toBe(keys.indexOf('git') + 1);
  expect(keys.indexOf('settings')).toBe(keys.indexOf('knowledge') + 1);
  expect(parseTab('knowledge')).toBe('knowledge');
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
