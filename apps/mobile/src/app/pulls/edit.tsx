import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { ChatMarkdown } from '@/components/chat/ChatMarkdown';
import { Chips, ErrorText, Field, formStyles, Hint, PrimaryButton } from '@/components/form';
import { useAreaWidth } from '@/layout/size';
import { editPullRequest, runPullRequestAction, setPullDraft, setPullNotice, usePullDraft, type PullRef } from '@/pulls/queries';
import { useConnection } from '@/store/connection';
import { colors, spacing } from '@/theme';

type Mode = 'comment' | 'reply' | 'description' | 'edit';

const TITLES: Record<Mode, string> = { comment: 'Comment', reply: 'Reply', description: 'Edit description', edit: 'Edit comment' };
const BUTTONS: Record<Mode, string> = { comment: 'Comment', reply: 'Reply', description: 'Update description', edit: 'Update comment' };

/**
 * Writing on a pull request: a new comment (with Close or Reopen with comment
 * where GitHub allows), a reply to a review thread, an edit of the description
 * or of a comment. Write and Preview, as on GitHub; the text stays a draft
 * until it is sent, so leaving and coming back keeps it.
 */
export default function PullRequestEditScreen() {
  const params = useLocalSearchParams<{
    projectId: string; folder: string; remote?: string; number: string; mode: Mode; draftKey: string;
    pullRequestId?: string; id?: string; type?: 'issue' | 'review-comment' | 'review'; threadId?: string; close?: string; reopen?: string;
  }>();
  const mode: Mode = TITLES[params.mode] ? params.mode : 'comment';
  const ref: PullRef = { projectId: params.projectId, folder: params.folder, remote: params.remote || undefined, number: Number(params.number) };
  const draft = usePullDraft((s) => s.drafts[params.draftKey] ?? '');
  const [text, setText] = useState(draft);
  const [tab, setTab] = useState<'write' | 'preview'>('write');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');
  const online = useConnection((s) => s.status.state === 'online');
  const width = useAreaWidth();

  const change = (value: string) => {
    setText(value);
    setPullDraft(params.draftKey, value);
    setError('');
  };

  const done = (message: string | undefined) => {
    setPullDraft(params.draftKey, null);
    if (message) setPullNotice(ref.projectId, { kind: 'ok', text: message });
    router.back();
  };

  const send = async (action: 'send' | 'close' | 'reopen') => {
    if (busy) return;
    const body = text;
    if (mode !== 'description' && !(mode === 'edit' && params.type === 'review') && !body.trim() && action === 'send') { setError('Write something first.'); return; }
    setBusy(action);
    setError('');
    try {
      if (mode === 'reply') {
        const answer = await editPullRequest(ref, { kind: 'thread-reply', threadId: params.threadId || '', body });
        if (!answer.ok) { setError(answer.error || 'GitHub did not take the reply.'); return; }
        done(answer.message);
      } else if (mode === 'description') {
        const answer = await editPullRequest(ref, { kind: 'body', pullRequestId: params.pullRequestId || '', body });
        if (!answer.ok) { setError(answer.error || 'GitHub did not take the description.'); return; }
        done(answer.message);
      } else if (mode === 'edit') {
        const answer = await editPullRequest(ref, { kind: 'comment-edit', type: params.type || 'issue', id: params.id || '', body });
        if (!answer.ok) { setError(answer.error || 'GitHub did not take the change.'); return; }
        done(answer.message);
      } else {
        if (body.trim()) {
          const answer = await editPullRequest(ref, { kind: 'comment', pullRequestId: params.pullRequestId || '', body });
          if (!answer.ok) { setError(answer.error || 'GitHub did not take the comment.'); return; }
          setPullDraft(params.draftKey, null);
          if (action === 'send') { done(answer.message); return; }
        }
        if (action === 'send') return;
        const result = await runPullRequestAction(ref.projectId, ref.folder, ref.remote, { number: ref.number, action });
        if (!result.ok) { setError(result.error || 'GitHub did not do it.'); return; }
        done(result.message);
      }
    } finally {
      setBusy(null);
    }
  };

  return (
    <ScrollView style={formStyles.screen} contentContainerStyle={formStyles.content} keyboardShouldPersistTaps="handled">
      <Stack.Screen options={{ title: TITLES[mode] }} />
      <Chips items={[{ key: 'write', label: 'Write' }, { key: 'preview', label: 'Preview' }]} selected={tab} onSelect={setTab} />
      {tab === 'write' ? (
        <Field
          value={text}
          onChangeText={change}
          multiline
          autoFocus
          autoCapitalize="sentences"
          autoCorrect
          spellCheck
          placeholder={mode === 'description' ? 'Describe the change' : 'Leave a comment'}
          style={styles.input}
          accessibilityLabel={TITLES[mode]}
        />
      ) : (
        <View style={styles.preview}>
          {text.trim() ? <ChatMarkdown text={text} width={width - spacing.lg * 2 - spacing.md * 2} /> : <Text style={formStyles.empty}>Nothing to preview.</Text>}
        </View>
      )}
      <Hint>Markdown is supported. It shows on GitHub as GitHub renders it.</Hint>
      <ErrorText>{error}</ErrorText>
      <PrimaryButton label={BUTTONS[mode]} busyLabel="Sending…" busy={busy === 'send'} disabled={!online || !!busy} onPress={() => send('send')} />
      {mode === 'comment' && params.close === '1' ? (
        <Pressable onPress={() => send('close')} disabled={!online || !!busy} style={styles.secondary} accessibilityRole="button">
          <Text style={[styles.secondaryText, { color: colors.danger }]}>{busy === 'close' ? 'Closing…' : text.trim() ? 'Close with comment' : 'Close pull request'}</Text>
        </Pressable>
      ) : null}
      {mode === 'comment' && params.reopen === '1' ? (
        <Pressable onPress={() => send('reopen')} disabled={!online || !!busy} style={styles.secondary} accessibilityRole="button">
          <Text style={styles.secondaryText}>{busy === 'reopen' ? 'Reopening…' : text.trim() ? 'Reopen with comment' : 'Reopen pull request'}</Text>
        </Pressable>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  input: { minHeight: 220, fontSize: 15, lineHeight: 21 },
  preview: { minHeight: 220, backgroundColor: colors.surface, borderRadius: 8, padding: spacing.md },
  secondary: { alignItems: 'center', paddingVertical: 13, borderRadius: 10, borderWidth: 1, borderColor: colors.border, marginTop: spacing.sm },
  secondaryText: { color: colors.text, fontSize: 15, fontWeight: '600' },
});
