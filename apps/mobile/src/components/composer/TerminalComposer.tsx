import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { terminalSend, uploadHint } from '@/sessions/attachments';
import type { Session, SessionState } from '@/sessions/model';
import { appendToLine, applyToDraft } from '@/shared/vendor/command-catalog-model';
import { useCapability, useConnection } from '@/store/connection';
import { encode, holdsAny, insertedText, type Modifiers } from '@/terminal/keys';
import { TERMINAL_BUTTONS } from '@/terminal/terminal-buttons.generated';
import { colors, spacing } from '@/theme';
import { AttachButton } from './AttachButton';
import { AttachmentStrip } from './AttachmentStrip';
import { CommandsButton } from './CommandsButton';
import { CommandSuggestions } from './CommandSuggestions';
import { ComposerField } from './ComposerField';
import { SendButton } from './SendButton';
import { TerminalKeys } from './TerminalKeys';
import { useAttachments } from './useAttachments';

/**
 * The terminal's bottom block: the key bar, the attachments, then a field
 * whose Send types the text, pastes the attachments' paths on the computer
 * and presses Enter. While a modifier of the bar is lit, the next character
 * typed in the field goes straight to the terminal with it (Ctrl and c is
 * Ctrl+C) instead of into the field. "/" beside Attach lists the CLI's
 * commands: a pick fills the field (at the end of a shell's line); in a CLI's
 * session a command being typed shows the ones that complete it.
 */
export function TerminalComposer({ sessionId, send, session, state = 'idle', placeholder = 'Type a command or reply…' }: {
  sessionId: string;
  send: (data: string) => void;
  /** The session, for its CLI's command catalog. */
  session?: Pick<Session, 'type' | 'runtime'> | null;
  state?: SessionState;
  placeholder?: string;
}) {
  const [text, setText] = useState('');
  const [held, setHeld] = useState<Modifiers>({});
  const attachments = useAttachments(sessionId);
  // An older computer cannot take files from the phone.
  const canAttach = useCapability('save-session-attachment');
  const computer = useConnection((s) => s.desktop?.name);
  const paths = canAttach ? attachments.paths : [];
  // Only what is shown holds Send back.
  const uploading = canAttach && attachments.uploading;
  const canSend = (!!text || paths.length > 0) && !uploading && !(canAttach && attachments.failed);

  const submit = () => {
    if (!canSend) return;
    const { writes, enterAfterMs } = terminalSend(text, paths);
    for (const data of writes) send(data);
    setTimeout(() => send('\r'), enterAfterMs);
    setText('');
    if (canAttach) attachments.clear();
  };

  const onChangeText = (next: string) => {
    const typed = holdsAny(held) ? insertedText(text, next) : null;
    if (typed) {
      send(encode({ kind: 'text', text: typed, mods: {} }, held, TERMINAL_BUTTONS.fn));
      setHeld({});
    } else {
      setText(next);
    }
  };

  return (
    <View style={styles.container}>
      <TerminalKeys sessionId={sessionId} send={send} held={held} onHeldChange={setHeld} />
      {canAttach ? <AttachmentStrip attachments={attachments} hint={uploadHint(attachments.items, computer)} /> : null}
      <CommandSuggestions sessionId={sessionId} session={session} text={text} onPick={setText} />
      <View style={styles.row}>
        {canAttach ? <AttachButton attachments={attachments} /> : null}
        <CommandsButton
          sessionId={sessionId}
          session={session}
          state={state}
          write={send}
          onInsert={(pick) => setText((prev) => (session?.type === 'terminal' ? appendToLine(prev, pick) : applyToDraft(prev, pick)))}
        />
        <ComposerField value={text} onChangeText={onChangeText} placeholder={placeholder} minHeight={48} />
        <SendButton onPress={submit} disabled={!canSend} busy={uploading} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { backgroundColor: colors.surface, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  row: { flexDirection: 'row', alignItems: 'flex-end', gap: spacing.sm, paddingHorizontal: spacing.sm, paddingBottom: spacing.sm },
});
