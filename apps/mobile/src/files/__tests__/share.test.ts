import { beforeEach, describe, expect, it, jest } from '@jest/globals';

import { shareProjectFile } from '../download';

// What the fake file system and share sheet saw.
const mockWrites: { uri: string; content: string; options?: { encoding?: string; append?: boolean } }[] = [];
const mockShared: string[] = [];
let mockShareSheet: () => Promise<void> = async () => {};
const mockRequest = jest.fn<(method: string, params?: unknown[]) => Promise<unknown>>();

jest.mock('expo-file-system', () => {
  const uriOf = (part: unknown) => (typeof part === 'string' ? part : (part as { uri: string }).uri);
  class Directory {
    uri: string;
    exists = false;
    constructor(...parts: unknown[]) { this.uri = parts.map(uriOf).join('/'); }
    delete() { this.exists = false; }
    create() { this.exists = true; }
  }
  class File {
    uri: string;
    name: string;
    constructor(...parts: unknown[]) { this.uri = parts.map(uriOf).join('/'); this.name = this.uri.split('/').pop()!; }
    create() {}
    async write(content: string, options?: { encoding?: string; append?: boolean }) { mockWrites.push({ uri: this.uri, content, options }); }
  }
  return { Directory, File, Paths: { cache: { uri: 'cache' } } };
});

jest.mock('expo-sharing', () => ({
  isAvailableAsync: async () => true,
  shareAsync: async (uri: string) => { mockShared.push(uri); await mockShareSheet(); },
}));

jest.mock('@/store/connection', () => ({ request: (method: string, params?: unknown[]) => mockRequest(method, params) }));

beforeEach(() => {
  mockWrites.length = 0;
  mockShared.length = 0;
  mockShareSheet = async () => {};
  mockRequest.mockReset();
});

describe('shareProjectFile', () => {
  it('shares the text on screen under the file name, without asking the computer again', async () => {
    await expect(shareProjectFile('/code/web', 'docs/plan.md', 'plan.md', { text: '# Plan\n' })).resolves.toBe('shared');
    expect(mockWrites).toEqual([{ uri: 'cache/shared/plan.md', content: '# Plan\n', options: undefined }]);
    expect(mockShared).toEqual(['cache/shared/plan.md']);
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it('writes an image on screen as bytes', async () => {
    await shareProjectFile('/code/web', 'logo.png', 'logo.png', { base64: 'AAEC' });
    expect(mockWrites).toEqual([{ uri: 'cache/shared/logo.png', content: 'AAEC', options: { encoding: 'base64' } }]);
    expect(mockShared).toEqual(['cache/shared/logo.png']);
  });

  it('downloads any other file from the computer before sharing it', async () => {
    mockRequest.mockResolvedValue({ ok: true, size: 3, modified: 1, base64: 'AAEC' });
    await shareProjectFile('/code/web', 'docs/spec.pdf', 'spec.pdf');
    expect(mockRequest).toHaveBeenCalledWith('read-project-file-chunk', ['/code/web', 'docs/spec.pdf', 0]);
    expect(mockWrites).toEqual([{ uri: 'cache/shared/spec.pdf', content: 'AAEC', options: { encoding: 'base64', append: true } }]);
    expect(mockShared).toEqual(['cache/shared/spec.pdf']);
  });

  it('refuses a second share while the share sheet is still open, then takes the next one', async () => {
    let close: (() => void) | undefined;
    mockShareSheet = () => new Promise<void>((resolve) => { close = resolve; });
    const first = shareProjectFile('/code/web', 'a.md', 'a.md', { text: 'a' });
    // Until the share sheet is open.
    for (let i = 0; i < 50 && !close; i++) await new Promise<void>((resolve) => setImmediate(() => resolve()));
    expect(close).toBeDefined();
    await expect(shareProjectFile('/code/web', 'b.md', 'b.md', { text: 'b' })).rejects.toThrow('Another download is still running.');
    close!();
    await expect(first).resolves.toBe('shared');
    mockShareSheet = async () => {};
    await expect(shareProjectFile('/code/web', 'b.md', 'b.md', { text: 'b' })).resolves.toBe('shared');
  });
});
