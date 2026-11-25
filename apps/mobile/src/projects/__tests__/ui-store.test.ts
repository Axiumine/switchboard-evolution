import { beforeEach, describe, expect, it } from '@jest/globals';

import { rememberScroll, useProjectUiStore } from '../ui-store';

beforeEach(() => useProjectUiStore.setState({ byProject: {} }));

describe('project UI store', () => {
  it('gives an unknown project the defaults', () => {
    expect(useProjectUiStore.getState().get('p1')).toEqual({ tab: 'overview', scroll: {} });
  });

  it('merges a patch into what is already there', () => {
    const { patch, get } = useProjectUiStore.getState();
    patch('p1', { tab: 'plan' });
    patch('p1', { scroll: { plan: 120 } });
    expect(get('p1')).toEqual({ tab: 'plan', scroll: { plan: 120 } });
  });

  it('keeps projects independent', () => {
    const { patch, get } = useProjectUiStore.getState();
    patch('p1', { tab: 'git' });
    expect(get('p1').tab).toBe('git');
    expect(get('p2')).toEqual({ tab: 'overview', scroll: {} });
    patch('p2', { tab: 'files' });
    expect(get('p1').tab).toBe('git');
  });
});

describe('selecting from the store', () => {
  it('does not notify a tab subscriber when only a scroll offset changes', () => {
    const { patch } = useProjectUiStore.getState();
    patch('p1', { tab: 'plan' });
    const seen: string[] = [];
    let last = useProjectUiStore.getState().get('p1').tab;
    const unsubscribe = useProjectUiStore.subscribe((state) => {
      const tab = state.byProject.p1?.tab ?? 'overview';
      if (tab !== last) { last = tab; seen.push(tab); }
    });
    rememberScroll('p1', 'plan', 300);
    rememberScroll('p1', 'overview', 40);
    expect(seen).toEqual([]);
    patch('p1', { tab: 'git' });
    expect(seen).toEqual(['git']);
    expect(useProjectUiStore.getState().get('p1').scroll).toEqual({ plan: 300, overview: 40 });
    unsubscribe();
  });
});

describe('the Git tab repository', () => {
  it('is remembered per project, beside the view', () => {
    const { patch, get } = useProjectUiStore.getState();
    patch('p1', { gitView: 'history', gitRepo: '/work/app' });
    patch('p1', { gitView: 'changes' });
    expect(get('p1').gitRepo).toBe('/work/app');
    expect(get('p2').gitRepo).toBeUndefined();
  });

  it('remembers every repository shown together beside the primary one', () => {
    const { patch, get } = useProjectUiStore.getState();
    patch('p1', { gitRepo: '/work/app', gitRepos: ['/work/app', '/work/lib'] });
    patch('p1', { gitView: 'pulls' });
    expect(get('p1').gitRepos).toEqual(['/work/app', '/work/lib']);
    expect(get('p2').gitRepos).toBeUndefined();
  });
});
