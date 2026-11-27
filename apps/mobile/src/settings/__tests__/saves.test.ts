import { beforeEach, describe, expect, it, jest } from '@jest/globals';

import { queryClient } from '@/remote/query';
import { saveKnowledgeConfig, type KnowledgeConfig } from '../knowledge';
import { saveGlobalSettings } from '../queries';

const mockRequest = jest.fn<(method: string, params?: unknown[]) => Promise<unknown>>();

// Hoisted above the imports by jest: the saves call the computer through this.
jest.mock('@/store/connection', () => ({
  request: (method: string, params?: unknown[]) => mockRequest(method, params),
  useCapability: () => true,
  useConnection: () => true,
}));

beforeEach(() => {
  mockRequest.mockReset();
  queryClient.clear();
});

describe('saveKnowledgeConfig', () => {
  it('keeps the settings the computer read after the save, and gives them back', async () => {
    const keys = { auto_index_limit: 'count' } as const;
    queryClient.setQueryData<KnowledgeConfig>(['knowledge-config'], { values: { auto_index_limit: '2147483647' }, keys });
    mockRequest.mockResolvedValue({ ok: true, values: { auto_index_limit: '2147483647' }, keys });
    await expect(saveKnowledgeConfig('auto_index_limit', '99999999999')).resolves.toEqual({ auto_index_limit: '2147483647' });
    expect(mockRequest).toHaveBeenCalledWith('set-knowledge-config', ['auto_index_limit', '99999999999']);
    expect(queryClient.getQueryData(['knowledge-config'])).toEqual({ values: { auto_index_limit: '2147483647' }, keys });
  });

  it('throws the computer\'s reason', async () => {
    mockRequest.mockResolvedValue({ error: 'auto_index_limit takes a whole number' });
    await expect(saveKnowledgeConfig('auto_index_limit', 'x')).rejects.toThrow('auto_index_limit takes a whole number');
  });
});

describe('saveGlobalSettings', () => {
  it('gives back the computer\'s answer: the settings as it stored them', async () => {
    const answer = { ok: true, settings: { disabledHarnesses: ['codex'] } };
    mockRequest.mockResolvedValue(answer);
    await expect(saveGlobalSettings({ disabledHarnesses: ['claude', 'codex'] })).resolves.toEqual(answer);
  });
});
