import { useCallback, useState } from 'react';
import { Alert, StyleSheet, View } from 'react-native';

import { CHAT_COLUMN } from '@/components/ChatView';
import { uploadHint } from '@/sessions/attachments';
import { draftReady, sendDraft, setDraftText, useDraft } from '@/sessions/drafts';
import type { Session, SessionState } from '@/sessions/model';
import { applyToDraft } from '@/shared/vendor/command-catalog-model';
import { request, useCapability, useConnection } from '@/store/connection';
import { colors, spacing } from '@/theme';
import { AttachButton } from './AttachButton';
import { AttachmentStrip } from './AttachmentStrip';
import { CommandsButton } from './CommandsButton';
import { CommandSuggestions } from './CommandSuggestions';
import { ComposerField } from './ComposerField';
import { SendButton, StopButton } from './SendButton';
import { StateStrip } from './StateStrip';
import { useAttachments } from './useAttachments';

const ESC = '\x1b';

/**
 * The chat's bottom block: what the session is doing, the attachments, then
 * Attach, a field that grows to five lines, and Send. Send types the text,
 * pastes the attachments' paths on the computer and presses Enter; while
 * the session works and nothing is written it is Stop (Esc). The draft
 * stays with the session until it is sent. No terminal keys here; "/" beside
 * Attach lists the CLI's commands, a pick going in front of the draft, and a
 * command being typed shows the ones that complete it.
 */
export function ChatComposer({ sessionId, session, cli, state, working, onOpenTerminal }: {
  sessionId: string;
  /** The session, for its CLI's command catalog. */
  session?: Pick<Session, 'type' | 'runtime'> | null;
  /** The CLI's name: "Claude", "Codex" or "OpenCode". */
  cli: string;
  state: SessionState;
  working?: string;
  onOpenTerminal: () => void;
}) {
  const draft = useDraft(sessionId);
  const attachments = useAttachments(sessionId);
  // An older computer cannot take files from the phone: no Attach, and what is attached is left out.
  const canAttach = useCapability('save-session-attachment');
  const computer = useConnection((s) => s.desktop?.name);
  const [sending, setSending] = useState(false);

  const write = useCallback((data: string) => request('terminal-input', [sessionId, data]), [sessionId]);
  const shown = canAttach ? attachments.items : [];
  const empty = !draft.text.trim() && shown.length === 0;
  const stop = state === 'busy' && empty;
  const canSend = !sending && draftReady(draft, canAttach);

  const submit = async () => {
    if (!canSend) return;
    setSending(true);
    try {
      await sendDraft(sessionId, write, { attach: canAttach });
    } catch (err: any) {
      Alert.alert('Could not send', err?.message || String(err));
    } finally {
      setSending(false);
    }
  };
  const interrupt = () => { write(ESC).catch((err: any) => Alert.alert('Could not stop', err?.message || String(err))); };

  return (
    <View style={styles.container}>
      <View style={styles.column}>
        <StateStrip state={state} cli={cli} working={working} stopShown={stop} onStop={interrupt} onOpenTerminal={onOpenTerminal} />
        {canAttach ? <AttachmentStrip attachments={attachments} hint={uploadHint(attachments.items, computer)} /> : null}
        <CommandSuggestions sessionId={sessionId} session={session} text={draft.text} onPick={(text) => setDraftText(sessionId, text)} />
        <View style={styles.row}>
          {canAttach ? <AttachButton attachments={attachments} /> : null}
          <CommandsButton
            sessionId={sessionId}
            session={session}
            state={state}
            write={write}
            onInsert={(text) => setDraftText(sessionId, applyToDraft(draft.text, text))}
            // A command that opens a picker shows it in the terminal.
            onRan={(entry) => { if (entry.flags?.includes('opensMenu')) onOpenTerminal(); }}
          />
          <ComposerField
            value={draft.text}
            onChangeText={(text) => setDraftText(sessionId, text)}
            placeholder={`Message ${cli}…`}
            minHeight={44}
            accessibilityLabel={`Message ${cli}`}
          />
          {stop ? <StopButton onPress={interrupt} /> : (
            <SendButton onPress={submit} disabled={!canSend} busy={sending || (canAttach && attachments.uploading)} />
          )}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { backgroundColor: colors.surface, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  // On a wide window, as wide as the conversation's column.
  column: { width: '100%', maxWidth: CHAT_COLUMN, alignSelf: 'center' },
  row: { flexDirection: 'row', alignItems: 'flex-end', gap: spacing.sm, padding: spacing.sm },
});
