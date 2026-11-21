import { describe, expect, it } from '@jest/globals';

import { ConnectionError } from '@/remote/client';

import { DownloadCancelled } from '../download';
import { sendFile, UPLOAD_CHUNK_BYTES, type PieceReader } from '../upload';

const decode = (base64: string) => [...atob(base64)].map((c) => c.charCodeAt(0));

/** A file of the phone, `bytes` long, read from the start as sendFile does. */
function fakeFile(bytes: number[]): PieceReader {
  let at = 0;
  return {
    size: bytes.length,
    async read(length) {
      const piece = Uint8Array.from(bytes.slice(at, at + length));
      at += piece.length;
      return piece;
    },
  };
}

/** A computer that takes the pieces as upload-project-file-chunk does, or answers what `answer` says. */
function fakeComputer(answer?: (piece: any, call: number) => unknown) {
  const calls: any[][] = [];
  const request = async <T,>(method: string, params: unknown[] = []): Promise<T> => {
    expect(method).toBe('upload-project-file-chunk');
    calls.push(params);
    const piece = params[3] as any;
    const own = answer?.(piece, calls.length);
    if (own !== undefined) return own as T;
    const received = piece.offset + decode(piece.base64).length;
    return (piece.last ? { ok: true, received, relativePath: `docs/${params[2]}`, name: params[2] } : { ok: true, received }) as T;
  };
  return { request, calls };
}

const target = { root: '/code/web', folder: 'docs', name: 'report.pdf', conflict: 'keep-both' as const, upload: 'upload-1' };

describe('sendFile', () => {
  it('sends each piece at its offset, and only the last one says where the file goes', async () => {
    const bytes = Array.from({ length: UPLOAD_CHUNK_BYTES * 2 + 5 }, (_, i) => i % 251);
    const { request, calls } = fakeComputer();
    const progress: number[] = [];
    const done = await sendFile(fakeFile(bytes), target, { request, onProgress: (sent) => progress.push(sent) });
    expect(done).toEqual({ relativePath: 'docs/report.pdf', name: 'report.pdf' });
    expect(calls.map((params) => params.slice(0, 3))).toEqual(Array(3).fill(['/code/web', 'docs', 'report.pdf']));
    expect(calls.map(([, , , piece]) => [piece.upload, piece.offset, piece.last, piece.conflict])).toEqual([
      ['upload-1', 0, undefined, undefined],
      ['upload-1', UPLOAD_CHUNK_BYTES, undefined, undefined],
      ['upload-1', UPLOAD_CHUNK_BYTES * 2, true, 'keep-both'],
    ]);
    expect(calls.flatMap(([, , , piece]) => decode(piece.base64))).toEqual(bytes);
    expect(progress).toEqual([UPLOAD_CHUNK_BYTES, UPLOAD_CHUNK_BYTES * 2, bytes.length]);
  });

  it('sends an empty file as one last piece, and passes on what the computer named it', async () => {
    const { request, calls } = fakeComputer(() => ({ ok: true, received: 0, relativePath: 'docs/report (1).pdf', name: 'report (1).pdf' }));
    const done = await sendFile(fakeFile([]), { ...target, conflict: 'replace' }, { request });
    expect(done).toEqual({ relativePath: 'docs/report (1).pdf', name: 'report (1).pdf' });
    expect(calls).toHaveLength(1);
    expect(calls[0][3]).toEqual({ upload: 'upload-1', offset: 0, base64: '', last: true, conflict: 'replace' });
  });

  it('sends a piece again, from the same offset, once the computer is back', async () => {
    const { request, calls } = fakeComputer((_piece, call) => {
      if (call === 1) throw new ConnectionError('The connection was lost');
      return undefined;
    });
    const waits: boolean[] = [];
    await sendFile(fakeFile([1, 2, 3]), target, { request, waitForConnection: async () => {}, onWaiting: (waiting) => waits.push(waiting) });
    expect(calls.map(([, , , piece]) => piece.offset)).toEqual([0, 0]);
    expect(waits).toEqual([true, false]);
  });

  it('stops on an error the computer sends back, or on a dropped connection with nothing to wait for', async () => {
    const refused = fakeComputer(() => ({ ok: false, error: 'A folder called "report.pdf" is already there' }));
    await expect(sendFile(fakeFile([1]), target, { request: refused.request })).rejects.toThrow('A folder called "report.pdf" is already there');
    const dropped = fakeComputer(() => { throw new ConnectionError('lost'); });
    await expect(sendFile(fakeFile([1]), target, { request: dropped.request })).rejects.toThrow('lost');
    expect(dropped.calls).toHaveLength(1);
  });

  it('stops before the next piece once cancelled', async () => {
    let cancelled = false;
    const { request, calls } = fakeComputer(() => { cancelled = true; return undefined; });
    const bytes = Array.from({ length: UPLOAD_CHUNK_BYTES + 1 }, () => 7);
    await expect(sendFile(fakeFile(bytes), target, { request, cancelled: () => cancelled })).rejects.toBeInstanceOf(DownloadCancelled);
    expect(calls).toHaveLength(1);
  });

  it('stops when the file got shorter on the phone than it said', async () => {
    const reader: PieceReader = { size: 10, read: async () => new Uint8Array(0) };
    await expect(sendFile(reader, target, { request: fakeComputer().request })).rejects.toThrow('The file changed on the phone');
  });
});
