import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { terminalSend, uploadHint } from '@/sessions/attachments';
import { useCapability, useConnection } from '@/store/connection';
import { colors, spacing } from '@/theme';
import { AttachButton } from './AttachButton';
import { AttachmentStrip } from './AttachmentStrip';
import { ComposerField } from './ComposerField';
import { SendButton } from './SendButton';
import { TerminalKeys } from './TerminalKeys';
import { useAttachments } from './useAttachments';

/**
 * The terminal's bottom block: the key row, the attachments, then a field
 * whose Send types the text, pastes the attachments' paths on the computer
 * and presses Enter.
 */
export function TerminalComposer({ sessionId, send, placeholder = 'Type a command or reply…' }: { sessionId: string; send: (data: string) => void; placeholder?: string }) {
  const [text, setText] = useState('');
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

  return (
    <View style={styles.container}>
      <TerminalKeys send={send} />
      {canAttach ? <AttachmentStrip attachments={attachments} hint={uploadHint(attachments.items, computer)} /> : null}
      <View style={styles.row}>
        {canAttach ? <AttachButton attachments={attachments} /> : null}
        <ComposerField value={text} onChangeText={setText} placeholder={placeholder} minHeight={48} />
        <SendButton onPress={submit} disabled={!canSend} busy={uploading} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { backgroundColor: colors.surface, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  row: { flexDirection: 'row', alignItems: 'flex-end', gap: spacing.sm, paddingHorizontal: spacing.sm, paddingBottom: spacing.sm },
});
