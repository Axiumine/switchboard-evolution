import { describe, expect, test } from '@jest/globals';

import { canImprove, canUndo, changedMeanwhile, confirmText, engineOf, improveTimeoutMs, type ImproveStep } from '../model';
import { DEFAULT_SETTINGS, buildImproverInput, extractImproved, validateSettings } from '@/shared/vendor/prompt-improver-model';

const settings = { ...DEFAULT_SETTINGS, models: { ...DEFAULT_SETTINGS.models } };

describe('prompt improver on the phone', () => {
  test('only a CLI session, with the improver on', () => {
    expect(canImprove({ type: 'session', runtime: 'codex' }, settings)).toBe(true);
    expect(canImprove({ type: 'session', runtime: null }, settings)).toBe(true);
    expect(canImprove({ type: 'terminal', runtime: null }, settings)).toBe(false);
    expect(canImprove({ type: 'session', runtime: 'gemini' }, settings)).toBe(false);
    expect(canImprove({ type: 'session', runtime: 'claude' }, { ...settings, enabled: false })).toBe(false);
    expect(canImprove(null, settings)).toBe(false);
    expect(canImprove({ runtime: 'claude' }, null)).toBe(false);
  });

  test('Undo while the field holds the rewrite untouched', () => {
    const done: ImproveStep = { phase: 'done', original: 'fix it', improved: 'Fix the login bug.' };
    expect(canUndo(done, 'Fix the login bug.')).toBe(true);
    expect(canUndo(done, 'Fix the login bug. And more')).toBe(false);
    expect(canUndo({ phase: 'idle' }, 'x')).toBe(false);
    expect(canUndo({ phase: 'running', sent: 'x' }, 'x')).toBe(false);
  });

  test('a text changed during the run is not replaced without asking', () => {
    expect(changedMeanwhile('fix it', 'fix it')).toBe(false);
    expect(changedMeanwhile('fix it', 'fix it now')).toBe(true);
  });

  test('the phone waits a little longer than the computer', () => {
    expect(improveTimeoutMs({ timeoutSec: 120 })).toBe(140_000);
    expect(improveTimeoutMs(null)).toBe(140_000);
  });

  test('the engine and the question say which CLI rewrites, and that nothing is sent', () => {
    expect(engineOf({ engine: 'session' }, 'opencode')).toBe('opencode');
    expect(engineOf({ engine: 'codex' }, 'claude')).toBe('codex');
    expect(engineOf(null, undefined)).toBe('claude');
    const q = confirmText({ ...settings, engine: 'session', context: 'none' }, 'codex');
    expect(q.title).toBe('Improve this prompt?');
    expect(q.message).toMatch(/^Codex on the computer rewrites it with the prompt only, using your subscription\./);
    expect(q.message).toMatch(/nothing is sent/);
  });

  test('the shared model runs on the phone too', () => {
    expect(validateSettings({ engine: 'claude' }).ok).toBe(true);
    expect(validateSettings({ engine: 'gpt' }).ok).toBe(false);
    expect(extractImproved('<improved_prompt>ok</improved_prompt>')).toBe('ok');
    const input = buildImproverInput({ template: null, prompt: 'ciao', cli: 'claude', mode: 'none', entries: [{ kind: 'skill', command: '/tdd', name: 'tdd', description: 'Test first.' }] });
    expect(input).toContain('<user_prompt>\nciao\n</user_prompt>');
    expect(input).toContain('- /tdd — Test first.');
  });
});
