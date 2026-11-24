import { describe, expect, it } from '@jest/globals';

import {
  countText, deploymentState, dispatchFields, graphLayout, logLines, parseQuery, pollDelay, RUN_MENU_LABELS, runMenu, setQualifier,
  STATE_ICONS, stateOf, triggerText, validateDispatch,
} from '../model';

const run = (extra: Record<string, unknown> = {}) => ({ status: 'completed', conclusion: 'success', ...extra });

describe('a run\'s "…" on the phone', () => {
  it('offers only what the account may do, as the desktop', () => {
    expect(runMenu(run(), false)).toEqual(['view-file', 'web', 'browser']);
    expect(runMenu(run(), true)).toEqual(['view-file', 'rerun', 'web', 'browser', 'delete']);
    expect(runMenu(run({ conclusion: 'failure' }), true)).toEqual(['view-file', 'rerun', 'rerun-failed', 'web', 'browser', 'delete']);
    expect(runMenu(run({ status: 'in_progress', conclusion: null }), true)).toEqual(['view-file', 'cancel', 'web', 'browser']);
    expect(runMenu(run({ conclusion: 'action_required' }), true)).toContain('approve');
    for (const key of runMenu(run({ conclusion: 'failure' }), true)) expect(RUN_MENU_LABELS[key]).toBeTruthy();
  });
});

describe('the words and icons of the list', () => {
  it('counts runs as GitHub does', () => {
    expect(countText(31000, false)).toBe('2,500+ workflow runs');
    expect(countText(1, false)).toBe('1 workflow run');
    expect(countText(4, true)).toBe('4 workflow run results');
  });

  it('has an icon for every state', () => {
    for (const state of [run(), run({ conclusion: 'failure' }), run({ status: 'queued', conclusion: null }), run({ status: 'waiting', conclusion: null }), run({ conclusion: 'action_required' })]) {
      expect(STATE_ICONS[stateOf(state).bucket]).toBeTruthy();
    }
  });

  it('says what started a run, from the shared model', () => {
    expect(triggerText({ event: 'push', sha: 'abcdef1234', actor: 'dev-one' })).toBe('Commit abcdef1 pushed by dev-one');
    expect(setQualifier(parseQuery('flaky').text, 'is', 'failure')).toBe('is:failure flaky');
  });

  it('reads a deployment\'s state', () => {
    expect(deploymentState({ state: 'active', status: 'success' })).toEqual({ bucket: 'success', label: 'Active' });
    expect(deploymentState({ state: 'inactive', status: 'in_progress' })).toEqual({ bucket: 'running', label: 'In progress' });
  });
});

describe('reading again by itself', () => {
  it('every 30 s for a list, every 5 s for a running run, never past GitHub\'s budget', () => {
    expect(pollDelay(undefined, false, true)).toBe(30_000);
    expect(pollDelay({ ok: true }, true)).toBe(5_000);
    expect(pollDelay({ ok: true }, false)).toBe(false);
    expect(pollDelay({ ok: true, rate: { limit: 5000, remaining: 120, resetAt: null } }, true)).toBe(false);
    expect(pollDelay({ error: 'x' }, true)).toBe(5_000);
  });
});

describe('the shared model on the phone', () => {
  it('builds the graph and the "Run workflow" fields as the desktop', () => {
    const graph = graphLayout([{ key: 'build', matrix: true }, { key: 'test', needs: ['build'] }], [{ id: 1, name: 'build (a)', status: 'completed', conclusion: 'success' }]);
    expect(graph.columns.map((c) => c.map((n) => n.key))).toEqual([['build'], ['test']]);
    const fields = dispatchFields({ dry: { type: 'boolean', default: true } });
    expect(validateDispatch(fields, { dry: 'false' })).toEqual({ inputs: { dry: 'false' } });
    expect(logLines('2026-01-01T10:00:00.000Z ##[error]boom')[0]).toEqual({ kind: 'error', text: 'boom', group: null, time: '2026-01-01T10:00:00.000Z' });
  });
});
