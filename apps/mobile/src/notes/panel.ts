import { Alert } from 'react-native';
import { create } from 'zustand';

import { loadPrefs, savePrefs } from '@/store/prefs';
import { parseRect, type Rect } from './model';

// The floating note panel's state: whose note is open, and where the panel
// sits. The panel is one, at the app's root (NoteFloating), so it floats over
// every screen and outlives navigation. Where it sat when closed is kept
// between runs, as the sidebar's width is.

type PanelStore = {
  /** The project whose note is open, or none. */
  projectId: string | null;
  /** Where the panel was last put; null before it ever was (it then starts at a default place). */
  rect: Rect | null;
  setRect(rect: Rect): void;
};

export const useNotePanel = create<PanelStore>((set) => ({
  projectId: null,
  rect: parseRect(loadPrefs().notePanel),
  setRect: (rect) => {
    set({ rect });
    savePrefs({ notePanel: rect });
  },
}));

/** What the open note does when asked to let go: save, and say whether it is safe to close it. */
export type NoteFlush = () => Promise<'saved' | 'failed'>;

let flusher: NoteFlush | null = null;

/** The open note's panel (or window) registers how to save it; returns the way to unregister. */
export function registerNoteFlush(flush: NoteFlush): () => void {
  flusher = flush;
  return () => { if (flusher === flush) flusher = null; };
}

/**
 * Saves the open note. True when it can be closed or replaced; when it could
 * not be saved, the user chooses between staying with it and losing the edit.
 */
export async function settleNote(): Promise<boolean> {
  if ((await flusher?.()) !== 'failed') return true;
  return new Promise<boolean>((resolve) => {
    Alert.alert(
      'The note was not saved',
      'Its latest edits could not be saved to the computer.',
      [
        { text: 'Keep editing', style: 'cancel', onPress: () => resolve(false) },
        { text: 'Discard edits', style: 'destructive', onPress: () => resolve(true) },
      ],
      { cancelable: false },
    );
  });
}

/** Opens `projectId`'s note; the one open (another project's) is saved first and replaced. */
export async function openNote(projectId: string): Promise<void> {
  const open = useNotePanel.getState().projectId;
  if (open === projectId) return;
  if (open && !(await settleNote())) return;
  useNotePanel.setState({ projectId });
}

/** Saves the note, then closes the panel. False when the user kept editing. */
export async function closeNote(): Promise<boolean> {
  if (!(await settleNote())) return false;
  useNotePanel.setState({ projectId: null });
  return true;
}
