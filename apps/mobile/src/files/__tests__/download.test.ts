import { describe, expect, it } from '@jest/globals';

import { CHANGED, DownloadCancelled, freeName, localFileName, readFileChunks } from '../download';

const b64 = (bytes: number[]) => btoa(String.fromCharCode(...bytes));
const decode = (pieces: string[]) => pieces.flatMap((piece) => [...atob(piece)].map((c) => c.charCodeAt(0)));

/** A desktop that hands out `bytes` `chunk` at a time, as read-project-file-chunk does. */
function fakeDesktop(bytes: number[], { chunk = 4, modified = 1, changeAt = -1 }: { chunk?: number; modified?: number; changeAt?: number } = {}) {
  const calls: unknown[][] = [];
  const request = async <T,>(method: string, params: unknown[] = []): Promise<T> => {
    expect(method).toBe('read-project-file-chunk');
    calls.push(params);
    const offset = params[2] as number;
    const changed = changeAt >= 0 && calls.length > changeAt;
    return { ok: true, size: bytes.length, modified: changed ? modified + 1 : modified, base64: b64(bytes.slice(offset, offset + chunk)) } as T;
  };
  return { request, calls };
}

describe('readFileChunks', () => {
  it('asks for each piece at the offset it got to and writes them in order', async () => {
    const bytes = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 255];
    const { request, calls } = fakeDesktop(bytes);
    const written: string[] = [];
    const progress: [number, number][] = [];
    const size = await readFileChunks('/code/web', 'dist/app.zip', async (piece) => { written.push(piece); }, {
      request, onProgress: (received, total) => progress.push([received, total]),
    });
    expect(size).toBe(11);
    expect(calls).toEqual([['/code/web', 'dist/app.zip', 0], ['/code/web', 'dist/app.zip', 4], ['/code/web', 'dist/app.zip', 8]]);
    expect(decode(written)).toEqual(bytes);
    expect(progress).toEqual([[4, 11], [8, 11], [11, 11]]);
  });

  it('reads an empty file with one call and writes nothing', async () => {
    const { request, calls } = fakeDesktop([]);
    const written: string[] = [];
    expect(await readFileChunks('/r', 'empty.txt', async (piece) => { written.push(piece); }, { request })).toBe(0);
    expect(calls).toHaveLength(1);
    expect(written).toEqual([]);
  });

  it('stops when the file changes between pieces', async () => {
    const { request } = fakeDesktop([1, 2, 3, 4, 5, 6, 7, 8, 9], { changeAt: 1 });
    await expect(readFileChunks('/r', 'a.bin', async () => {}, { request })).rejects.toThrow(CHANGED);
  });

  it('stops when the file got shorter than it said', async () => {
    const request = async <T,>(): Promise<T> => ({ ok: true, size: 10, modified: 1, base64: '' }) as T;
    await expect(readFileChunks('/r', 'a.bin', async () => {}, { request })).rejects.toThrow(CHANGED);
  });

  it("passes on the computer's error", async () => {
    const request = async <T,>(): Promise<T> => ({ ok: false, error: 'Not a folder of a project' }) as T;
    await expect(readFileChunks('/r', 'a.bin', async () => {}, { request })).rejects.toThrow('Not a folder of a project');
  });

  it('stops after the piece on its way once cancelled, without writing it', async () => {
    const desktop = fakeDesktop([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    const written: string[] = [];
    let cancel = false;
    // Cancel pressed while the second piece comes over.
    const request = <T,>(method: string, params?: unknown[]) => {
      if (desktop.calls.length === 1) cancel = true;
      return desktop.request<T>(method, params);
    };
    const reading = readFileChunks('/r', 'a.bin', async (piece) => { written.push(piece); }, { request, cancelled: () => cancel });
    await expect(reading).rejects.toBeInstanceOf(DownloadCancelled);
    expect(desktop.calls).toHaveLength(2);
    expect(written).toHaveLength(1);
  });
});

describe('file names on the phone', () => {
  it('keeps an ordinary name and replaces what FAT and SAF refuse', () => {
    expect(localFileName('Report 2026 (final).pdf')).toBe('Report 2026 (final).pdf');
    expect(localFileName('a:b*c?.txt')).toBe('a_b_c_.txt');
    expect(localFileName('..')).toBe('download');
    expect(localFileName('   ')).toBe('download');
  });

  it('numbers a name already taken in the folder, before its extension', () => {
    expect(freeName('report.pdf', new Set(['other.pdf']))).toBe('report.pdf');
    expect(freeName('report.pdf', new Set(['report.pdf']))).toBe('report (1).pdf');
    expect(freeName('report.pdf', new Set(['report.pdf', 'report (1).pdf']))).toBe('report (2).pdf');
    expect(freeName('.env', new Set(['.env']))).toBe('.env (1)');
    expect(freeName('Makefile', new Set(['Makefile']))).toBe('Makefile (1)');
  });
});
