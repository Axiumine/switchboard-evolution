import { describe, expect, it } from '@jest/globals';

import { groupTools, timeLabel, toolKind, toolsSummary, withSeparators, type ChatRow } from '../chat-groups';
import type { ChatItem } from '../transcript';

type Tool = Extract<ChatItem, { kind: 'tool' }>;
const tool = (id: string, name: string, done = true, time?: string): Tool => ({ kind: 'tool', id, name, summary: id, ...(done ? { result: 'ok' } : {}), time });
const user = (id: string, text: string, time?: string): ChatItem => ({ kind: 'user', id, text, time });
const assistant = (id: string, text: string, time?: string): ChatItem => ({ kind: 'assistant', id, text, time });
const thinking = (id: string): ChatItem => ({ kind: 'thinking', id, text: 'hmm' });

/** A row as a short string, to compare whole lists. */
const shape = (row: ChatRow) => (row.kind === 'tools' ? `tools(${row.items.map((i) => i.id).join(',')})${row.running ? '*' : ''}`
  : row.kind === 'time' ? `time(${row.label})` : `${row.item.id}${row.running ? '*' : ''}`);

describe('groupTools', () => {
  it('folds consecutive tool calls into one group that says what they did', () => {
    const rows = groupTools([user('u', 'fix it'), tool('t1', 'Read'), tool('t2', 'Read'), tool('t3', 'Bash'), tool('t4', 'Edit'), assistant('a', 'Done.')]);
    expect(rows.map(shape)).toEqual(['u', 'tools(t1,t2,t3,t4)', 'a']);
    const group = rows[1] as Extract<ChatRow, { kind: 'tools' }>;
    expect(group.summary).toBe('Read 2 files, ran 1 command, edited 1 file');
    expect(group.tools.map((t) => t.id)).toEqual(['t1', 't2', 't3', 't4']);
  });

  it('keeps a single tool call as a plain row', () => {
    expect(groupTools([user('u', 'test'), tool('t1', 'Bash'), assistant('a', 'Passed.')]).map(shape)).toEqual(['u', 't1', 'a']);
  });

  it('starts a new group after a message', () => {
    const rows = groupTools([tool('t1', 'Read'), tool('t2', 'Grep'), assistant('a', 'Found it.'), tool('t3', 'Edit'), tool('t4', 'Bash'), user('u', 'thanks'), tool('t5', 'Read')]);
    expect(rows.map(shape)).toEqual(['tools(t1,t2)', 'a', 'tools(t3,t4)', 'u', 't5']);
  });

  it('folds the thinking between tool calls into their group and leaves the thinking around it outside', () => {
    const rows = groupTools([thinking('k1'), tool('t1', 'Read'), thinking('k2'), tool('t2', 'Read'), thinking('k3'), assistant('a', 'ok')]);
    expect(rows.map(shape)).toEqual(['k1', 'tools(t1,k2,t2)', 'k3', 'a']);
  });

  it('marks the last group running while its last tool has no result', () => {
    expect(groupTools([tool('t1', 'Read'), tool('t2', 'Bash', false)]).map(shape)).toEqual(['tools(t1,t2)*']);
    expect(groupTools([tool('t1', 'Read'), tool('t2', 'Bash')]).map(shape)).toEqual(['tools(t1,t2)']);
    // Only the last one: an older call without a result is not running.
    expect(groupTools([tool('t1', 'Read'), tool('t2', 'Bash', false), assistant('a', 'x'), tool('t3', 'Read'), tool('t4', 'Read')]).map(shape))
      .toEqual(['tools(t1,t2)', 'a', 'tools(t3,t4)']);
    expect(groupTools([user('u', 'go'), tool('t1', 'Bash', false)]).map(shape)).toEqual(['u', 't1*']);
  });
});

describe('tool kinds and summaries', () => {
  it('sorts tools by what they do', () => {
    expect(['Read', 'Grep', 'Glob', 'Bash', 'Edit', 'MultiEdit', 'Write', 'WebFetch', 'WebSearch', 'Task', 'exec_command', 'apply_patch', 'mcp__x__y'].map(toolKind))
      .toEqual(['read', 'search', 'search', 'command', 'edit', 'edit', 'write', 'fetch', 'websearch', 'agent', 'command', 'edit', 'other']);
  });

  it('counts each kind once, in the order they first ran', () => {
    expect(toolsSummary([tool('a', 'Grep'), tool('b', 'Write'), tool('c', 'TodoWrite'), tool('d', 'mcp__x__y'), tool('e', 'Glob')]))
      .toBe('Searched for 2 patterns, wrote 1 file, used 2 tools');
    expect(toolsSummary([tool('a', 'Bash'), tool('b', 'Bash')])).toBe('Ran 2 commands');
  });
});

describe('withSeparators', () => {
  const at = (day: number, hour: number, minute: number) => new Date(2026, 10, day, hour, minute).toISOString();
  const now = new Date(2026, 10, 3, 18, 0).getTime();

  it('puts the time above the first message, and again after more than 30 minutes', () => {
    const rows = withSeparators(groupTools([
      user('u1', 'a', at(3, 9, 12)),
      assistant('a1', 'b', at(3, 9, 40)),
      user('u2', 'c', at(3, 10, 11)),
      assistant('a2', 'd', at(3, 10, 12)),
    ]), now);
    expect(rows.map(shape)).toEqual(['time(Today, 09:12)', 'u1', 'a1', 'time(Today, 10:11)', 'u2', 'a2']);
  });

  it('puts the time above the first message of a new day, however short the gap', () => {
    const rows = withSeparators(groupTools([user('u1', 'a', at(2, 23, 50)), assistant('a1', 'b', at(3, 0, 5))]), now);
    expect(rows.map(shape)).toEqual(['time(Yesterday, 23:50)', 'u1', 'time(Today, 00:05)', 'a1']);
  });

  it('times a group by its first tool and skips rows without a time', () => {
    const rows = withSeparators(groupTools([user('u1', 'a'), tool('t1', 'Read', true, at(3, 9, 0)), tool('t2', 'Read', true, at(3, 9, 1))]), now);
    expect(rows.map(shape)).toEqual(['u1', 'time(Today, 09:00)', 'tools(t1,t2)']);
  });

  it('names older days by their date', () => {
    expect(timeLabel(new Date(2026, 10, 3, 7, 5).getTime(), now)).toBe('Today, 07:05');
    expect(timeLabel(new Date(2026, 9, 20, 14, 30).getTime(), now)).toMatch(/20.*14:30$/);
    expect(timeLabel(new Date(2025, 9, 20, 14, 30).getTime(), now)).toMatch(/2025.*14:30$/);
  });
});
