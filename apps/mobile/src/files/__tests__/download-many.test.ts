import { beforeEach, describe, expect, it, jest } from '@jest/globals';

import { downloadProjectFiles, useDownload } from '../download';

// A fake phone: what is in each folder (by URI), and the folder the picker gives.
const mockFolders = new Map<string, string[]>();
let mockPicked: (() => Promise<{ uri: string }>) = async () => ({ uri: 'picked' });
const mockRequest = jest.fn<(method: string, params?: unknown[]) => Promise<unknown>>();

jest.mock('expo-file-system', () => {
  const uriOf = (part: unknown) => (typeof part === 'string' ? part : (part as { uri: string }).uri);
  const contents = (uri: string) => {
    if (!mockFolders.has(uri)) mockFolders.set(uri, []);
    return mockFolders.get(uri)!;
  };
  class Directory {
    uri: string;
    exists = false;
    constructor(...parts: unknown[]) { this.uri = parts.map(uriOf).join('/'); }
    get name() { return this.uri.split('/').pop()!; }
    static pickDirectoryAsync = async () => new Directory((await mockPicked()).uri);
    delete() { this.exists = false; }
    create() { this.exists = true; }
    list() {
      return contents(this.uri).map((name) => (name.endsWith('/') ? new Directory(this.uri, name.slice(0, -1)) : new File(this.uri, name)));
    }
    createDirectory(name: string) {
      contents(this.uri).push(`${name}/`);
      return new Directory(this.uri, name);
    }
  }
  class File {
    uri: string;
    constructor(...parts: unknown[]) { this.uri = parts.map(uriOf).join('/'); }
    get name() { return this.uri.split('/').pop()!; }
    create() {}
    async write() {}
    rename(name: string) { this.uri = `${this.uri.slice(0, this.uri.lastIndexOf('/'))}/${name}`; }
    async copy(to: Directory) { contents(to.uri).push(this.name); }
  }
  return { Directory, File, Paths: { cache: { uri: 'cache' } } };
});

jest.mock('@/store/connection', () => ({ request: (method: string, params?: unknown[]) => mockRequest(method, params) }));

const piece = { ok: true, size: 3, modified: 1, base64: 'AAEC' };

beforeEach(() => {
  mockFolders.clear();
  mockPicked = async () => ({ uri: 'picked' });
  mockRequest.mockReset();
  useDownload.setState({ current: null });
});

describe('downloadProjectFiles', () => {
  it('saves each file in the folder picked, in folders named as on the computer, under free names', async () => {
    mockFolders.set('picked', ['a.md', 'docs/']);
    mockFolders.set('picked/docs', []);
    mockRequest.mockResolvedValue(piece);
    const outcome = await downloadProjectFiles('/code/web', [
      { relativePath: 'a.md', name: 'a.md', folders: [] },
      { relativePath: 'docs/b.md', name: 'b.md', folders: ['docs'] },
      { relativePath: 'docs/img/c.png', name: 'c.png', folders: ['docs', 'img'] },
    ]);
    expect(outcome).toEqual({ done: 3, failed: [], cancelled: false });
    expect(mockRequest.mock.calls.map(([, params]) => (params as unknown[])[1])).toEqual(['a.md', 'docs/b.md', 'docs/img/c.png']);
    expect(mockFolders.get('picked')).toEqual(['a.md', 'docs/', 'a (1).md']);
    // The folder already there is used, the one missing is made.
    expect(mockFolders.get('picked/docs')).toEqual(['b.md', 'img/']);
    expect(mockFolders.get('picked/docs/img')).toEqual(['c.png']);
    expect(useDownload.getState().current).toBeNull();
  });

  it('goes on past a file that fails, and says why', async () => {
    mockRequest.mockImplementation(async (_method, params) => ((params as unknown[])[1] === 'gone.md' ? { ok: false, error: 'The file does not exist' } : piece));
    const outcome = await downloadProjectFiles('/r', [
      { relativePath: 'gone.md', name: 'gone.md', folders: [] },
      { relativePath: 'here.md', name: 'here.md', folders: [] },
    ]);
    expect(outcome).toEqual({ done: 1, failed: [{ rel: 'gone.md', error: 'The file does not exist' }], cancelled: false });
    expect(mockFolders.get('picked')).toEqual(['here.md']);
  });

  it('stops every file once Cancel is tapped, and does nothing when no folder is picked', async () => {
    mockRequest.mockImplementation(async () => {
      useDownload.setState((s) => (s.current ? { current: { ...s.current, cancelled: true } } : s));
      return piece;
    });
    const outcome = await downloadProjectFiles('/r', [
      { relativePath: 'one.md', name: 'one.md', folders: [] },
      { relativePath: 'two.md', name: 'two.md', folders: [] },
    ]);
    expect(outcome).toEqual({ done: 0, failed: [], cancelled: true });
    expect(mockRequest).toHaveBeenCalledTimes(1);

    mockPicked = async () => { throw new Error('closed'); };
    await expect(downloadProjectFiles('/r', [{ relativePath: 'one.md', name: 'one.md', folders: [] }])).resolves.toBeNull();
    expect(mockRequest).toHaveBeenCalledTimes(1);
  });
});
