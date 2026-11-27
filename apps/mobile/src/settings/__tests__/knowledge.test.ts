import { describe, expect, it } from '@jest/globals';

import { binaryText, knowledgeControl, knowledgeFields, type KnowledgeBinary } from '../knowledge';

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
