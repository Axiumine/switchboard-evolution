import { expect, test } from '@jest/globals';

import { hasCommandCatalog, runCommand } from '@/catalog/queries';
import { appendToLine, applyToDraft, canRun, insertionFor, suggestionsFor, typedCommand, type CommandDoc } from '@/shared/vendor/command-catalog-model';

const compact: CommandDoc = { id: 'claude:slash:compact', cli: 'claude', kind: 'slash', command: '/compact', name: 'compact', description: 'Summarize', source: 'official-docs' };

test('the "/" button shows for a session whose CLI has a catalog, and for a plain terminal', () => {
  expect(hasCommandCatalog(['claude'], { type: 'cli', runtime: 'claude' })).toBe(true);
  // Rows written before the runtime column are Claude's.
  expect(hasCommandCatalog(['claude'], { type: 'cli', runtime: null })).toBe(true);
  expect(hasCommandCatalog(['claude'], { type: 'cli', runtime: 'codex' })).toBe(false);
  expect(hasCommandCatalog(['claude'], { type: 'terminal' })).toBe(true);
  // An older desktop: no catalog at all.
  expect(hasCommandCatalog([], { type: 'terminal' })).toBe(false);
  expect(hasCommandCatalog(['claude'], null)).toBe(false);
});

test('Run writes the command, waits, then Enter on its own', async () => {
  const writes: string[] = [];
  const waits: number[] = [];
  await runCommand((data) => { writes.push(data); }, '/compact ', async (ms) => { waits.push(ms); });
  expect(writes).toEqual(['/compact', '\r']);
  expect(waits).toEqual([80]);
});

test('a pick goes in front of a chat draft, at the end of a shell line', () => {
  const text = insertionFor(compact, { target: 'agent' })!.text;
  expect(text).toBe('/compact ');
  expect(applyToDraft('keep the tests', text)).toBe('/compact keep the tests');
  expect(appendToLine('claude', '--model ')).toBe('claude --model ');
  // The phone's session states: a subagent at work counts as busy.
  expect(canRun(compact, { target: 'agent', state: 'subagent' }).ok).toBe(false);
  expect(canRun(compact, { target: 'agent', state: 'running' }).ok).toBe(true);
});

test('typing "/", "$" or "@" at the start suggests the commands of the session\'s CLI', () => {
  const skill: CommandDoc = { id: 'opencode:skill:review', cli: 'opencode', kind: 'skill', command: '@review', name: 'review', description: 'Review', source: 'project' };
  const opencode = { target: 'agent' as const, entries: [{ ...compact, cli: 'opencode' as const }, skill] };
  expect(typedCommand('/co')).toEqual({ sigil: '/', query: 'co' });
  expect(typedCommand('/compact now')).toBeNull();
  expect(suggestionsFor(opencode, '@re').map((e) => e.command)).toEqual(['@review']);
  expect(suggestionsFor(opencode, '/co').map((e) => e.command)).toEqual(['/compact']);
  expect(suggestionsFor({ target: 'agent', entries: [compact] }, '@re')).toEqual([]);
});
