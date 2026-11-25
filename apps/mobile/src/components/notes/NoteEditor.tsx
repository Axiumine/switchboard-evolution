import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { CodeEditor } from '@/components/files/CodeEditor';
import { FindBar } from '@/components/files/FindBar';
import { FontSizeButtons } from '@/components/files/FontSizeButtons';
import { MarkdownPreview } from '@/components/files/MarkdownPreview';
import { ShareButton } from '@/components/files/ShareButton';
import { HeaderButton } from '@/components/HeaderButton';
import type { FindResult } from '@/editor/bridge';
import { NOTE_FILE } from '@/notes/model';
import { registerNoteFlush } from '@/notes/panel';
import { useNote } from '@/notes/useNote';
import { colors, spacing } from '@/theme';

/**
 * A project's note (note.md) in the editor, editable at once, wrapped, saved
 * by itself (useNote). Its buttons are the file view's: text size, formatted
 * or raw Markdown, share, undo, redo, save. In the floating panel (`floating`)
 * it is what closing the panel, popping it out and another note replacing it
 * save first; a window of its own saves by itself only.
 */
export function NoteEditor({ projectId, floating = false }: { projectId: string; floating?: boolean }) {
  const { project, note, retry, editor, edit, saving, problem, onState, onChange, flush } = useNote(projectId);
  const [raw, setRaw] = useState(true);
  const [findOpen, setFindOpen] = useState(false);
  const [found, setFound] = useState<FindResult | null>(null);
  const closeFind = () => { setFindOpen(false); setFound(null); };
  /** The text shown formatted: taken from the editor when the toggle is pressed. */
  const [preview, setPreview] = useState('');
  const root = project?.root;

  useEffect(() => (floating ? registerNoteFlush(flush) : undefined), [floating, flush]);

  const toggle = async () => {
    if (raw) {
      try { setPreview(await editor.current?.getText() ?? ''); } catch { return; }
    }
    setRaw(!raw);
  };
  const canSave = edit.dirty && !saving;

  if (note.phase !== 'ready') {
    return (
      <View style={styles.center}>
        {note.phase === 'loading' ? <ActivityIndicator color={colors.accent} /> : (
          <>
            <Text style={styles.error}>{note.message}</Text>
            <Pressable onPress={retry} accessibilityRole="button"><Text style={styles.retry}>Try again</Text></Pressable>
          </>
        )}
      </View>
    );
  }

  return (
    <View style={styles.fill}>
      <View style={styles.toolbar}>
        <FontSizeButtons />
        <HeaderButton
          icon={raw ? 'code-slash-outline' : 'document-text-outline'}
          accessibilityLabel={raw ? 'Show formatted' : 'Show raw Markdown'}
          onPress={toggle}
        />
        {raw ? <HeaderButton icon="search-outline" accessibilityLabel={findOpen ? 'Close find' : 'Find in note'} onPress={() => (findOpen ? closeFind() : setFindOpen(true))} /> : null}
        {root ? <ShareButton root={root} path={NOTE_FILE} name={NOTE_FILE} known={async () => ({ text: await editor.current?.getText() ?? '' })} /> : null}
        <HeaderButton icon="arrow-undo-outline" accessibilityLabel="Undo" onPress={() => editor.current?.undo()} disabled={!raw || !edit.canUndo} />
        <HeaderButton icon="arrow-redo-outline" accessibilityLabel="Redo" onPress={() => editor.current?.redo()} disabled={!raw || !edit.canRedo} />
        <HeaderButton icon="save-outline" accessibilityLabel="Save" onPress={() => { flush(); }} disabled={!canSave} />
      </View>
      {problem ? <Text style={styles.problem} numberOfLines={2}>Not saved: {problem}</Text> : null}
      <View style={styles.fill}>
        {/* Kept while the formatted text shows, with its edits and history. */}
        <View style={[styles.fill, !raw && styles.hidden]}>
          {findOpen && raw ? <FindBar editor={editor} result={found} canReplace textLength={note.text.length} onClose={closeFind} /> : null}
          <CodeEditor ref={editor} text={note.text} filename={NOTE_FILE} editable wrap onState={onState} onChange={onChange} onFind={setFound} onOpenFind={() => setFindOpen(true)} />
        </View>
        {raw ? null : <MarkdownPreview root={root ?? ''} path={NOTE_FILE} content={preview} />}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: colors.background },
  hidden: { display: 'none' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.md, padding: spacing.lg },
  error: { color: colors.textDim, textAlign: 'center' },
  retry: { color: colors.accent, fontSize: 15, fontWeight: '600' },
  toolbar: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: spacing.sm, paddingVertical: 6, backgroundColor: colors.surface, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  problem: { color: colors.attention, fontSize: 12, paddingHorizontal: spacing.md, paddingVertical: 4, backgroundColor: colors.surface },
});
