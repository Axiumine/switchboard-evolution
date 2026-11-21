import { describe, expect, it } from '@jest/globals';

import { downloadQuestion, transferDoneText, transferFailures, uploadClashQuestion } from '../transfer-text';

describe('what the Files tab says around several files', () => {
  it('asks before downloading the folders ticked, with how much is in them', () => {
    expect(downloadQuestion(12, '3.4 MB')).toEqual({
      title: 'Download 12 files?',
      detail: '3.4 MB in all, into a folder you pick on this phone. What is in a folder goes into a folder of the same name.',
      confirm: 'Download',
    });
    expect(downloadQuestion(1, '4 B').title).toBe('Download 1 file?');
  });

  it('asks about names already in the folder, listing a few', () => {
    expect(uploadClashQuestion(['a.png']).title).toBe('“a.png” is already there');
    expect(uploadClashQuestion(['a.png']).detail).toMatch(/^Replace it \(the old one goes to the Trash/);
    const many = uploadClashQuestion(['1', '2', '3', '4', '5', '6', '7'], 5);
    expect(many.title).toBe('7 files are already there');
    expect(many.detail).toMatch(/\n\n1\n2\n3\n4\n5\n…and 2 more$/);
  });

  it('says how many arrived, and when Cancel stopped them', () => {
    expect(transferDoneText('download', { done: 3, failed: [], cancelled: false }, 3)).toBe('Saved 3 files');
    expect(transferDoneText('upload', { done: 1, failed: [], cancelled: false }, 1)).toBe('Uploaded 1 file');
    expect(transferDoneText('upload', { done: 2, failed: [], cancelled: true }, 5)).toBe('Uploaded 2 of 5 files, then cancelled');
    expect(transferDoneText('download', { done: 0, failed: [], cancelled: true }, 5)).toBe('Cancelled');
  });

  it('lists what did not go and why', () => {
    expect(transferFailures('upload', { done: 2, failed: [], cancelled: false }, 2)).toBeNull();
    expect(transferFailures('download', { done: 1, failed: [{ rel: 'docs/a.md', error: 'The file does not exist' }], cancelled: false }, 2)).toEqual({
      title: '1 of 2 files were not downloaded',
      detail: 'docs/a.md: The file does not exist',
    });
    expect(transferFailures('upload', { done: 0, failed: [{ rel: 'a.png', error: 'x' }], cancelled: false }, 1)?.title).toBe('Could not upload the file');
    const failed = Array.from({ length: 10 }, (_, i) => ({ rel: `f${i}`, error: 'x' }));
    expect(transferFailures('upload', { done: 0, failed, cancelled: false }, 10, 8)?.detail.split('\n').pop()).toBe('+ 2 more');
  });
});
