import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, AppState } from 'react-native';

import type { CodeEditorHandle } from '@/components/files/CodeEditor';
import type { EditorState } from '@/editor/bridge';
import { useProject } from '@/projects/queries';
import { ConnectionError } from '@/remote/client';
import { request, useConnection } from '@/store/connection';
import { AUTOSAVE_MS, NOTE_FILE, NOTE_NEEDS_NEWER, saveOutcome } from './model';
import type { NoteFlush } from './panel';

export type NoteLoad =
  | { phase: 'loading' }
  | { phase: 'error'; message: string }
  | { phase: 'ready'; text: string };

type FileAnswer = { ok?: boolean; error?: string; content?: string; version?: string };

const CLEAN: EditorState = { dirty: false, canUndo: false, canRedo: false, cursors: 1 };

/**
 * A project's note: note.md made on first use, read, kept in the editor and
 * saved to the computer by itself shortly after the typing stops, and on
 * request (`flush`: closing, popping out, another note replacing this one).
 *
 * Each save carries the version the last one returned. When the file changed
 * on the computer meanwhile (CHANGED) and the editor holds nothing new it is
 * read again; otherwise the user chooses between the computer's version and
 * this one.
 */
export function useNote(projectId: string) {
  const { project, isLoading: projectLoading } = useProject(projectId);
  const root = project?.root;
  const online = useConnection((s) => s.status.state === 'online');
  const editor = useRef<CodeEditorHandle>(null);
  const [note, setNote] = useState<NoteLoad>({ phase: 'loading' });
  const [edit, setEdit] = useState<EditorState>(CLEAN);
  const [saving, setSaving] = useState(false);
  /** What the last failed save said; none once one works. */
  const [problem, setProblem] = useState<string | null>(null);
  const ready = useRef(false);
  const dirty = useRef(false);
  const version = useRef<string | undefined>(undefined);
  /** The text as the computer has it (read or saved last): a save of the same text has nothing to say. */
  const onDisk = useRef('');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const queue = useRef<Promise<'saved' | 'failed'>>(Promise.resolve('saved'));

  const read = useCallback(async (): Promise<string> => {
    const file = await request<FileAnswer>('read-project-file', [root, NOTE_FILE]);
    if (!file?.ok || typeof file.content !== 'string') throw new Error(file?.error || 'Could not open the note.');
    version.current = file.version;
    onDisk.current = file.content;
    return file.content;
  }, [root]);

  const load = useCallback(async () => {
    if (!root) return;
    setNote({ phase: 'loading' });
    try {
      let made: { ok?: boolean; error?: string } | undefined;
      try {
        made = await request('create-project-file', [projectId, NOTE_FILE]);
      } catch (err: any) {
        // The computer answered with a refusal: an older one does not know note.md. No answer is another matter.
        if (err instanceof ConnectionError) throw err;
        throw new Error(NOTE_NEEDS_NEWER);
      }
      if (made && (made.ok === false || made.error)) throw new Error(made.error || 'Could not make the note.');
      const text = await read();
      ready.current = true;
      setNote({ phase: 'ready', text });
    } catch (err: any) {
      setNote({ phase: 'error', message: err?.message || 'Could not open the note.' });
    }
  }, [projectId, root, read]);

  // Once, when the computer is there: a reconnect must not read over what is being typed.
  useEffect(() => {
    if (online && root && !ready.current) load();
  }, [online, root, load]);

  /** The computer's version replaces what is in the editor. */
  const reload = useCallback(async () => {
    const before = onDisk.current;
    const text = await read();
    dirty.current = false;
    setNote({ phase: 'ready', text });
    // The same text does not reach the editor as news: drop the edits there.
    if (text === before) editor.current?.revert();
  }, [read]);

  /** Sends `text`; 'saved' also when there was a CHANGED the user settled. */
  const send = useCallback(async (text: string, expected: string | undefined): Promise<'saved' | 'failed'> => {
    let base = expected;
    for (;;) {
      let result: unknown;
      try {
        result = await request('save-project-file', [root, NOTE_FILE, text, ...(base ? [base] : [])]);
      } catch (err: any) {
        setProblem(err?.message || 'That did not work');
        return 'failed';
      }
      const outcome = saveOutcome(result);
      if (outcome.kind === 'saved') {
        version.current = outcome.version ?? version.current;
        onDisk.current = text;
        setProblem(null);
        editor.current?.saved(text);
        return 'saved';
      }
      if (outcome.kind === 'failed') {
        setProblem(outcome.message);
        return 'failed';
      }
      // CHANGED: the file is not as this save last saw it. Nothing new here: read it again.
      let overwrite = false;
      if (text !== onDisk.current) {
        overwrite = await new Promise<boolean>((resolve) => {
          Alert.alert(
            'The note changed on the computer',
            'Keep the computer’s version and lose your edits, or overwrite it with this one?',
            [
              { text: 'Keep the computer’s', onPress: () => resolve(false) },
              { text: 'Overwrite', style: 'destructive', onPress: () => resolve(true) },
            ],
            { cancelable: false },
          );
        });
      }
      if (overwrite) {
        // The same text again, on the version that is there now.
        base = outcome.version;
        continue;
      }
      try {
        await reload();
        setProblem(null);
        return 'saved';
      } catch (err: any) {
        setProblem(err?.message || 'Could not read the note');
        return 'failed';
      }
    }
  }, [root, reload]);

  const write = useCallback(async (): Promise<'saved' | 'failed'> => {
    if (!ready.current || !dirty.current || !editor.current) return 'saved';
    setSaving(true);
    try {
      const text = await editor.current.getText();
      // The editor has not told yet that the last save made it clean.
      if (text === onDisk.current) return 'saved';
      return await send(text, version.current);
    } catch (err: any) {
      setProblem(err?.message || 'That did not work');
      return 'failed';
    } finally {
      setSaving(false);
    }
  }, [send]);

  /** Saves what is unsaved, after the save in progress (one at a time). */
  const flush: NoteFlush = useCallback(() => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    const next = queue.current.then(write);
    queue.current = next;
    return next;
  }, [write]);

  // Every edit puts the save off by a second: it comes when the typing stops.
  const onChange = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => { timer.current = null; flush(); }, AUTOSAVE_MS);
  }, [flush]);

  const onState = useCallback((state: EditorState) => {
    dirty.current = state.dirty;
    setEdit(state);
  }, []);

  // Leaving the app must not lose the last second of typing.
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => { if (state !== 'active') flush(); });
    return () => subscription.remove();
  }, [flush]);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const error = note.phase === 'error' ? note
    : note.phase === 'loading' && !project && !projectLoading && online ? { phase: 'error' as const, message: 'This project is gone.' }
    : null;

  return { project, note: error ?? note, retry: load, editor, edit, saving, problem, onState, onChange, flush };
}
