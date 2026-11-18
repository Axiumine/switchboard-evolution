import { beforeEach, describe, expect, it, jest } from '@jest/globals';

import { readEditFile, saveEditFile } from '../stage-requests';

const mockRequest = jest.fn<(method: string, params?: unknown[]) => Promise<unknown>>();

jest.mock('@/store/connection', () => ({
  request: (method: string, params?: unknown[]) => mockRequest(method, params),
  useCapability: () => true,
}));

const VERSION = 'a'.repeat(40);

describe('editing a changed file from its diff', () => {
  beforeEach(() => { mockRequest.mockReset(); });

  it('reads the text, the staged copy and the version', async () => {
    mockRequest.mockResolvedValue({ ok: true, content: 'a\nb\n', base: 'a\n', version: VERSION });
    await expect(readEditFile('p', '/repo', 'src/a.js')).resolves.toEqual({ content: 'a\nb\n', base: 'a\n', version: VERSION });
    expect(mockRequest).toHaveBeenCalledWith('read-project-git-edit-file', ['p', '/repo', 'src/a.js']);
  });

  it('says why a file cannot be opened', async () => {
    mockRequest.mockResolvedValue({ error: 'A binary file cannot be edited' });
    await expect(readEditFile('p', '/repo', 'logo.png')).rejects.toThrow('A binary file cannot be edited');
  });

  it('saves against the version read, or over anything with none', async () => {
    mockRequest.mockResolvedValue({ ok: true, version: 'b'.repeat(40) });
    await expect(saveEditFile('p', '/repo', 'a.js', 'text', VERSION)).resolves.toEqual({ ok: true, version: 'b'.repeat(40) });
    expect(mockRequest).toHaveBeenLastCalledWith('save-project-git-edit-file', ['p', '/repo', 'a.js', 'text', VERSION]);
    await saveEditFile('p', '/repo', 'a.js', 'text', null);
    expect(mockRequest).toHaveBeenLastCalledWith('save-project-git-edit-file', ['p', '/repo', 'a.js', 'text']);
  });

  it('tells a file changed on the computer from any other refusal', async () => {
    mockRequest.mockResolvedValue({ ok: false, code: 'CHANGED', error: 'The file changed on disk after it was opened', version: 'c'.repeat(40) });
    await expect(saveEditFile('p', '/repo', 'a.js', 'text', VERSION)).resolves.toEqual({ ok: false, changed: true, error: 'The file changed on disk after it was opened' });
    mockRequest.mockResolvedValue({ error: 'The file is not on disk' });
    await expect(saveEditFile('p', '/repo', 'a.js', 'text', VERSION)).resolves.toEqual({ ok: false, changed: false, error: 'The file is not on disk' });
  });
});
