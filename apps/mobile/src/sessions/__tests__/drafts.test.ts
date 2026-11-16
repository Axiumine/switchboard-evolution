import { beforeEach, describe, expect, it } from '@jest/globals';

import { clearDraft, getDraft, sendDraft, setDraftText, updateDraftAttachments, useDrafts, type AttachmentItem } from '../drafts';

const photo = (id: string, state: AttachmentItem['state'], path?: string): AttachmentItem => ({ id, state, path, uri: `file:///cache/${id}.jpg`, name: `${id}.jpg`, mimeType: 'image/jpeg' });

/** A terminal that records what is written, and a pause that does not wait. */
function fakeTerminal() {
  const writes: string[] = [];
  const pauses: number[] = [];
  return {
    writes,
    pauses,
    write: async (data: string) => { writes.push(data); },
    wait: async (ms: number) => { pauses.push(ms); },
  };
}

beforeEach(() => useDrafts.setState({ bySession: {} }));

describe('drafts', () => {
  it('keeps the text and attachments of each session apart', () => {
    setDraftText('s1', 'Look at the header');
    setDraftText('s2', 'Run the tests');
    updateDraftAttachments('s1', (items) => [...items, photo('a1', 'done', '/data/attachments/s1/a1.jpg')]);
    expect(getDraft('s1')).toMatchObject({ text: 'Look at the header', attachments: [{ id: 'a1' }] });
    expect(getDraft('s2')).toEqual({ text: 'Run the tests', attachments: [] });
    expect(getDraft('s3')).toEqual({ text: '', attachments: [] });
    clearDraft('s1');
    expect(getDraft('s1')).toEqual({ text: '', attachments: [] });
    expect(getDraft('s2').text).toBe('Run the tests');
  });

  it('sends the text, then the paths as a paste, then Enter, and is empty afterwards', async () => {
    setDraftText('s1', 'What is wrong here?');
    updateDraftAttachments('s1', () => [photo('a1', 'done', '/data/attachments/s1/a1.jpg')]);
    setDraftText('s2', 'untouched');
    const terminal = fakeTerminal();
    await expect(sendDraft('s1', terminal.write, { wait: terminal.wait })).resolves.toBe(true);
    expect(terminal.writes).toEqual(['What is wrong here? ', '\x1b[200~/data/attachments/s1/a1.jpg\x1b[201~', '\r']);
    expect(terminal.pauses).toEqual([300]);
    expect(getDraft('s1')).toEqual({ text: '', attachments: [] });
    expect(getDraft('s2').text).toBe('untouched');
  });

  it('sends nothing while an attachment uploads or failed, or when there is nothing to send', async () => {
    const terminal = fakeTerminal();
    expect(await sendDraft('s1', terminal.write, { wait: terminal.wait })).toBe(false);
    setDraftText('s1', '   ');
    expect(await sendDraft('s1', terminal.write, { wait: terminal.wait })).toBe(false);
    setDraftText('s1', 'with a photo');
    updateDraftAttachments('s1', () => [photo('a1', 'uploading')]);
    expect(await sendDraft('s1', terminal.write, { wait: terminal.wait })).toBe(false);
    updateDraftAttachments('s1', () => [photo('a1', 'failed')]);
    expect(await sendDraft('s1', terminal.write, { wait: terminal.wait })).toBe(false);
    expect(terminal.writes).toEqual([]);
    expect(getDraft('s1').text).toBe('with a photo');
  });

  it('keeps the draft when the computer cannot be reached', async () => {
    setDraftText('s1', 'hello');
    const failing = async () => { throw new Error('Not connected'); };
    await expect(sendDraft('s1', failing, { wait: async () => {} })).rejects.toThrow('Not connected');
    expect(getDraft('s1').text).toBe('hello');
  });

  it('keeps what was typed or attached while the message went out', async () => {
    setDraftText('s1', 'first');
    const terminal = fakeTerminal();
    const write = async (data: string) => {
      await terminal.write(data);
      if (data === 'first') {
        setDraftText('s1', 'second');
        updateDraftAttachments('s1', (items) => [...items, photo('a2', 'uploading')]);
      }
    };
    await sendDraft('s1', write, { wait: terminal.wait });
    expect(getDraft('s1')).toMatchObject({ text: 'second', attachments: [{ id: 'a2' }] });
  });

  it('leaves attachments alone when the computer takes none', async () => {
    setDraftText('s1', 'just text');
    updateDraftAttachments('s1', () => [photo('a1', 'failed')]);
    const terminal = fakeTerminal();
    expect(await sendDraft('s1', terminal.write, { attach: false, wait: terminal.wait })).toBe(true);
    expect(terminal.writes).toEqual(['just text', '\r']);
    expect(getDraft('s1')).toMatchObject({ text: '', attachments: [{ id: 'a1' }] });
  });
});
