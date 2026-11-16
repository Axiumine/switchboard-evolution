import { describe, expect, it, jest } from '@jest/globals';

import { attachmentName, MAX_ATTACHMENT_BYTES, pasteText, terminalSend, uploadAttachment, uploadHint, type AttachmentIO } from '../attachments';

/** A desktop that answers save-session-attachment, and a file of `size` bytes. */
function fakeIO({ size = 4, base64 = 'aGk=', answer = { ok: true, path: '/data/attachments/s1/20261103-181333-b.png', bytes: 2 } as unknown } = {}) {
  const calls: { method: string; params: unknown[] }[] = [];
  const read = jest.fn(async () => base64);
  const io: AttachmentIO = {
    request: async (method, params = []) => {
      calls.push({ method, params });
      return answer as any;
    },
    readFile: () => ({ size, base64: read }),
  };
  return { io, calls, read };
}

describe('pasteText', () => {
  it('wraps a path in a bracketed paste', () => {
    expect(pasteText(['/a/b.png'])).toBe('\x1b[200~/a/b.png\x1b[201~');
  });

  it('single-quotes a path with a space or a shell character', () => {
    expect(pasteText(['/Users/me/Library/Application Support/b.png'])).toBe("\x1b[200~'/Users/me/Library/Application Support/b.png'\x1b[201~");
    expect(pasteText(['/a/$HOME.png'])).toBe("\x1b[200~'/a/$HOME.png'\x1b[201~");
  });

  it("escapes a ' inside a quoted path", () => {
    expect(pasteText(["/a/it's.png"])).toBe("\x1b[200~'/a/it'\\''s.png'\x1b[201~");
  });

  it('joins two paths with a space', () => {
    expect(pasteText(['/a/b.png', '/a/c d.pdf'])).toBe("\x1b[200~/a/b.png '/a/c d.pdf'\x1b[201~");
  });
});

describe('terminalSend', () => {
  it('types the text, then the paste, then Enter after a pause', () => {
    expect(terminalSend('what is in this', ['/a/b.png'])).toEqual({ writes: ['what is in this ', '\x1b[200~/a/b.png\x1b[201~'], enterAfterMs: 300 });
  });

  it('sends only the paste when there is no text', () => {
    expect(terminalSend('', ['/a/b.png'])).toEqual({ writes: ['\x1b[200~/a/b.png\x1b[201~'], enterAfterMs: 300 });
  });

  it('sends text alone as before', () => {
    expect(terminalSend('git status', [])).toEqual({ writes: ['git status'], enterAfterMs: 80 });
  });

  it('adds no second space after text that ends with one', () => {
    expect(terminalSend('see ', ['/a/b.png']).writes[0]).toBe('see ');
  });
});

describe('attachmentName', () => {
  it('keeps a plain name', () => {
    expect(attachmentName('IMG_1234.jpg')).toBe('IMG_1234.jpg');
  });

  it('replaces what the computer refuses in a name', () => {
    expect(attachmentName('a/b\\c\nd.png')).toBe('a_b_c_d.png');
    expect(attachmentName('   ')).toBe('attachment');
    expect(attachmentName('..')).toBe('attachment');
  });

  it('shortens a long name and keeps its extension', () => {
    const name = attachmentName(`${'x'.repeat(300)}.png`);
    expect(name.length).toBeLessThanOrEqual(120);
    expect(name.endsWith('.png')).toBe(true);
  });
});

describe('uploadAttachment', () => {
  it('sends the session, the name and the bytes, and returns the path on the computer', async () => {
    const { io, calls } = fakeIO();
    const path = await uploadAttachment('s1', { uri: 'file:///cache/b.png', name: 'b.png', mimeType: 'image/png', size: 2 }, io);
    expect(path).toBe('/data/attachments/s1/20261103-181333-b.png');
    expect(calls).toEqual([{ method: 'save-session-attachment', params: ['s1', 'b.png', 'aGk='] }]);
  });

  it("throws the computer's error", async () => {
    const { io } = fakeIO({ answer: { ok: false, error: 'The attachments folder is not usable' } });
    await expect(uploadAttachment('s1', { uri: 'file:///cache/b.png', name: 'b.png' }, io)).rejects.toThrow('The attachments folder is not usable');
  });

  it('refuses a file over 8 MiB without reading it or calling the computer', async () => {
    const { io, calls, read } = fakeIO({ size: MAX_ATTACHMENT_BYTES + 1 });
    await expect(uploadAttachment('s1', { uri: 'file:///cache/big.mov', name: 'big.mov' }, io)).rejects.toThrow('Too large (max 8 MB)');
    expect(read).not.toHaveBeenCalled();
    expect(calls).toEqual([]);
  });

  it('refuses a file the picker says is over 8 MiB', async () => {
    const { io, calls } = fakeIO();
    await expect(uploadAttachment('s1', { uri: 'file:///cache/big.mov', name: 'big.mov', size: MAX_ATTACHMENT_BYTES + 1 }, io)).rejects.toThrow('Too large (max 8 MB)');
    expect(calls).toEqual([]);
  });

  it('refuses bytes over 8 MiB when the size was not known up front', async () => {
    const big = 'A'.repeat(Math.ceil((MAX_ATTACHMENT_BYTES + 3) / 3) * 4);
    const { io, calls } = fakeIO({ size: 0, base64: big });
    await expect(uploadAttachment('s1', { uri: 'content://x', name: 'x.bin' }, io)).rejects.toThrow('Too large (max 8 MB)');
    expect(calls).toEqual([]);
  });

  it('refuses an empty file', async () => {
    const { io, calls } = fakeIO({ size: 0, base64: '' });
    await expect(uploadAttachment('s1', { uri: 'file:///cache/empty.txt', name: 'empty.txt' }, io)).rejects.toThrow('The file is empty');
    expect(calls).toEqual([]);
  });
});

describe('uploadHint', () => {
  it('counts the uploads to the computer', () => {
    expect(uploadHint([{ state: 'done' }, { state: 'uploading' }, { state: 'uploading' }], 'Test Mac')).toBe('Uploading 2 of 3 to Test Mac…');
  });

  it('says what to do about a failed upload', () => {
    expect(uploadHint([{ state: 'done' }, { state: 'failed' }], 'Test Mac')).toBe('1 attachment did not upload. Retry or remove it to send.');
    expect(uploadHint([{ state: 'failed' }, { state: 'failed' }], undefined)).toBe('2 attachments did not upload. Retry or remove them to send.');
  });

  it('only offers Retry when trying again can help', () => {
    expect(uploadHint([{ state: 'failed', retryable: false }], 'Test Mac')).toBe('1 attachment did not upload. Remove it to send.');
    expect(uploadHint([{ state: 'failed', retryable: false }, { state: 'failed', retryable: false }], 'Test Mac')).toBe('2 attachments did not upload. Remove them to send.');
    expect(uploadHint([{ state: 'failed', retryable: false }, { state: 'failed', retryable: true }], 'Test Mac')).toBe('2 attachments did not upload. Retry or remove them to send.');
  });

  it('says nothing once everything is uploaded', () => {
    expect(uploadHint([{ state: 'done' }], 'Test Mac')).toBe('');
    expect(uploadHint([], 'Test Mac')).toBe('');
  });
});
