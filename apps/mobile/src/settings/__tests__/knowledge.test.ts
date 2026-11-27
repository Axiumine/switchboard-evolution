import { describe, expect, it, jest } from '@jest/globals';

import { binaryText, commitKnowledgeField, knowledgeControl, knowledgeFields, knowledgeTextAfterSave, type KnowledgeBinary } from '../knowledge';

const bin = (over: Partial<KnowledgeBinary> = {}): KnowledgeBinary => ({
  found: { version: '0.8.1', source: 'agents', path: '/Users/demo/.local/bin/codebase-memory-mcp', ok: true },
  minimum: '0.6.0',
  latest: null,
  updateAvailable: false,
  pinned: '0.8.1',
  installDir: '/Users/demo/.switchboard/bin',
  canDownload: true,
  ...over,
});

describe('knowledgeControl', () => {
  it('shows a boolean as a switch', () => expect(knowledgeControl('bool')).toBe('switch'));
  it('shows a list of values as chips', () => expect(knowledgeControl(['auto', 'on', 'off'])).toBe('chips'));
  it('shows a limit, a count and anything else as a field', () => {
    expect(knowledgeControl('limit')).toBe('field');
    expect(knowledgeControl('number')).toBe('field');
    expect(knowledgeControl('count')).toBe('field');
    expect(knowledgeControl(undefined)).toBe('field');
  });
});

describe('knowledgeFields', () => {
  it('keeps the catalog order, only the keys the computer lists, and never the Lens', () => {
    const keys = { ui_port: 'port', ui_enabled: 'bool', index_max_files: 'limit', auto_index: 'bool' } as const;
    expect(knowledgeFields(keys).map((f) => f.key)).toEqual(['auto_index', 'index_max_files']);
  });
});

describe('binaryText', () => {
  it('says version, source and path', () => {
    expect(binaryText(bin())).toEqual({ summary: '0.8.1, the one your agents use', problem: null, newer: null, path: '/Users/demo/.local/bin/codebase-memory-mcp' });
  });
  it('says too old and the newer one out', () => {
    const t = binaryText(bin({ found: { version: '0.5.0', source: 'installed', path: '/Users/demo/bin/cbm', ok: false }, latest: '0.9.0', updateAvailable: true }));
    expect(t.summary).toBe('0.5.0, installed on this computer');
    expect(t.problem).toBe('too old: 0.6.0 or later');
    expect(t.newer).toBe('0.9.0 is out');
  });
  it('says not found with the pinned version and the folder', () => {
    expect(binaryText(bin({ found: null }))).toEqual({
      summary: 'Not found. The Node Knowledge tab can download 0.8.1 into /Users/demo/.switchboard/bin.',
      problem: null,
      newer: null,
      path: null,
    });
  });
});

describe('commitKnowledgeField', () => {
  const run = (kind: 'limit' | 'count', key: string, raw: string, saved?: string, save = jest.fn(async (_k: string, _v: string) => {})) =>
    commitKnowledgeField(key, kind, raw, saved, save).then((result) => ({ result, save }));

  it('refuses an empty limit with the computer\'s words, sending nothing', async () => {
    const { result, save } = await run('limit', 'index_max_files', '  ', '5000');
    expect(result).toEqual({ saved: false, error: 'index_max_files takes a whole number or off' });
    expect(save).not.toHaveBeenCalled();
  });
  it('refuses an empty count with the count\'s words', async () => {
    const { result, save } = await run('count', 'auto_index_limit', '', '50000');
    expect(result).toEqual({ saved: false, error: 'auto_index_limit takes a whole number' });
    expect(save).not.toHaveBeenCalled();
  });
  it('sends off for a limit', async () => {
    const { result, save } = await run('limit', 'index_max_files', ' off ', '5000');
    expect(result).toEqual({ saved: true, error: null });
    expect(save).toHaveBeenCalledWith('index_max_files', 'off');
  });
  it('sends a number for a count', async () => {
    const { result, save } = await run('count', 'auto_index_limit', '12', '50000');
    expect(result).toEqual({ saved: true, error: null });
    expect(save).toHaveBeenCalledWith('auto_index_limit', '12');
  });
  it('sends nothing, and says nothing, for an unchanged value', async () => {
    for (const [kind, raw, saved] of [['count', ' 50000 ', '50000'], ['limit', '', undefined], ['limit', 'off', undefined]] as const) {
      const { result, save } = await run(kind, 'k', raw, saved);
      expect(result).toEqual({ saved: false, error: null });
      expect(save).not.toHaveBeenCalled();
    }
  });
  it('gives the computer\'s reason when it refuses the value', async () => {
    const save = jest.fn(async () => { throw new Error('index_max_files takes a whole number or off'); });
    const { result } = await run('limit', 'index_max_files', 'abc', '5', save);
    expect(result).toEqual({ saved: false, error: 'index_max_files takes a whole number or off' });
  });
});

describe('a field after its save', () => {
  it('commitKnowledgeField gives back the settings the computer read after the save', async () => {
    const values = { auto_index_limit: '2147483647' };
    const save = jest.fn(async (_k: string, _v: string) => values);
    expect(await commitKnowledgeField('auto_index_limit', 'count', '99999999999', '50000', save)).toEqual({ saved: true, error: null, values });
  });

  it('shows the value saved, not the one typed', () => {
    // Past CBM's int: capped, so the value read back is unchanged.
    expect(knowledgeTextAfterSave('auto_index_limit', { saved: true, error: null, values: { auto_index_limit: '2147483647' } }, '2147483647', false)).toBe('2147483647');
    // 007 is 7.
    expect(knowledgeTextAfterSave('auto_index_limit', { saved: true, error: null, values: { auto_index_limit: '7' } }, '50000', false)).toBe('7');
    // A limit turned off is not listed.
    expect(knowledgeTextAfterSave('index_max_files', { saved: true, error: null, values: {} }, '5000', false)).toBe('');
  });

  it('shows the value in force when nothing was saved, and leaves a field being typed in again', () => {
    expect(knowledgeTextAfterSave('index_max_files', { saved: false, error: 'index_max_files takes a whole number or off' }, '5000', false)).toBe('5000');
    expect(knowledgeTextAfterSave('index_max_files', { saved: true, error: null, values: { index_max_files: '9' } }, '5000', true)).toBeNull();
  });
});
