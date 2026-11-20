import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { Alert } from 'react-native';

import { closeNote, openNote, registerNoteFlush, useNotePanel } from '../panel';

afterEach(() => {
  useNotePanel.setState({ projectId: null });
  jest.restoreAllMocks();
});

describe('the note panel', () => {
  it('opens a note, and a second open of the same one changes nothing', async () => {
    await openNote('p1');
    expect(useNotePanel.getState().projectId).toBe('p1');
    await openNote('p1');
    expect(useNotePanel.getState().projectId).toBe('p1');
  });

  it('saves the open note before another project\'s replaces it', async () => {
    const flush = jest.fn(async () => 'saved' as const);
    registerNoteFlush(flush);
    await openNote('p1');
    await openNote('p2');
    expect(flush).toHaveBeenCalledTimes(1);
    expect(useNotePanel.getState().projectId).toBe('p2');
  });

  it('saves on close', async () => {
    const flush = jest.fn(async () => 'saved' as const);
    const unregister = registerNoteFlush(flush);
    await openNote('p1');
    expect(await closeNote()).toBe(true);
    expect(flush).toHaveBeenCalledTimes(1);
    expect(useNotePanel.getState().projectId).toBeNull();
    unregister();
  });

  it('stays open when the save failed and the user keeps editing, closes when they discard', async () => {
    const unregister = registerNoteFlush(async () => 'failed');
    const choose = (label: string) => jest.spyOn(Alert, 'alert').mockImplementation((_t, _m, buttons) => { buttons?.find((b) => b.text === label)?.onPress?.(); });
    await openNote('p1');
    choose('Keep editing');
    expect(await closeNote()).toBe(false);
    expect(useNotePanel.getState().projectId).toBe('p1');
    jest.restoreAllMocks();
    choose('Discard edits');
    expect(await closeNote()).toBe(true);
    expect(useNotePanel.getState().projectId).toBeNull();
    unregister();
  });
});
