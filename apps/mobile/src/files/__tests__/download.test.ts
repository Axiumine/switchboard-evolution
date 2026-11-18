import { afterEach, describe, expect, it, jest } from '@jest/globals';

import { ConnectionError } from '@/remote/client';
import { useConnection } from '@/store/connection';

import { CHANGED, DownloadCancelled, freeName, localFileName, readFileChunks, useDownload, waitForComputer } from '../download';

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

  it('asks again for the piece that got no answer, from the same place, once the computer is back', async () => {
    const bytes = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const desktop = fakeDesktop(bytes);
    let dropped = false;
    // The phone slept while the second piece came over.
    const request = <T,>(method: string, params?: unknown[]) => {
      if (desktop.calls.length === 1 && !dropped) {
        dropped = true;
        return Promise.reject(new ConnectionError('The connection was lost'));
      }
      return desktop.request<T>(method, params);
    };
    const written: string[] = [];
    const waiting: boolean[] = [];
    let waits = 0;
    const size = await readFileChunks('/r', 'a.bin', async (piece) => { written.push(piece); }, {
      request, waitForConnection: async () => { waits += 1; }, onWaiting: (on) => waiting.push(on),
    });
    expect(size).toBe(10);
    expect(waits).toBe(1);
    expect(waiting).toEqual([true, false]);
    expect(desktop.calls.map((params) => params[2])).toEqual([0, 4, 8]);
    expect(decode(written)).toEqual(bytes);
  });

  it('stops on a dropped connection when it cannot wait, and on an error the computer sent back', async () => {
    const dropped = async <T,>(): Promise<T> => { throw new ConnectionError('Not connected to the computer'); };
    await expect(readFileChunks('/r', 'a.bin', async () => {}, { request: dropped })).rejects.toBeInstanceOf(ConnectionError);
    let waits = 0;
    const refused = async <T,>(): Promise<T> => { throw new Error('read-project-file-chunk is not allowed'); };
    await expect(readFileChunks('/r', 'a.bin', async () => {}, { request: refused, waitForConnection: async () => { waits += 1; } }))
      .rejects.toThrow('read-project-file-chunk is not allowed');
    expect(waits).toBe(0);
  });

  it('stops when cancelled while it waits for the computer', async () => {
    let cancel = false;
    const dropped = async <T,>(): Promise<T> => { throw new ConnectionError('The connection was lost'); };
    const reading = readFileChunks('/r', 'a.bin', async () => {}, {
      request: dropped, cancelled: () => cancel, waitForConnection: async () => { cancel = true; },
    });
    await expect(reading).rejects.toBeInstanceOf(DownloadCancelled);
  });
});

describe('waitForComputer', () => {
  const download = { name: 'a.bin', received: 4, size: 10, cancelled: false, waiting: true };
  const hello = { methods: [] } as any;

  afterEach(() => {
    jest.useRealTimers();
    useDownload.setState({ current: null });
    useConnection.setState({ status: { state: 'closed' } });
  });

  it('resolves once the computer is back, not before a moment has passed', async () => {
    jest.useFakeTimers();
    useDownload.setState({ current: download });
    useConnection.setState({ status: { state: 'offline', retryInMs: 1000, error: 'The connection was lost' } });
    let done = false;
    const waiting = waitForComputer().then(() => { done = true; });
    jest.advanceTimersByTime(5000);
    await Promise.resolve();
    expect(done).toBe(false);
    useConnection.setState({ status: { state: 'online', address: '192.0.2.1', hello } });
    await waiting;
    expect(done).toBe(true);
  });

  it('waits a moment even when still connected, so a slow piece is not asked for in a tight loop', async () => {
    jest.useFakeTimers();
    useDownload.setState({ current: download });
    useConnection.setState({ status: { state: 'online', address: '192.0.2.1', hello } });
    let done = false;
    const waiting = waitForComputer().then(() => { done = true; });
    await Promise.resolve();
    expect(done).toBe(false);
    jest.advanceTimersByTime(1000);
    await waiting;
    expect(done).toBe(true);
  });

  it('resolves at once when the download is cancelled, and rejects when the computer is gone for good', async () => {
    useDownload.setState({ current: download });
    useConnection.setState({ status: { state: 'offline', retryInMs: 1000, error: 'x' } });
    const cancelled = waitForComputer();
    useDownload.setState({ current: { ...download, cancelled: true } });
    await expect(cancelled).resolves.toBeUndefined();

    useDownload.setState({ current: download });
    const revoked = waitForComputer();
    useConnection.setState({ status: { state: 'rejected', reason: 'revoked', message: 'This phone was removed on the computer.' } });
    await expect(revoked).rejects.toThrow('This phone was removed on the computer.');
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
