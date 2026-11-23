import Ionicons from '@expo/vector-icons/Ionicons';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { ErrorText, Field, formStyles, Label, PrimaryButton } from '@/components/form';
import { reviewChoices, reviewProblem, type ReviewEvent } from '@/pulls/model';
import { editPullRequest, setPullNotice, type PullRef } from '@/pulls/queries';
import { useConnection } from '@/store/connection';
import { colors, spacing } from '@/theme';

/**
 * Review changes, as GitHub's own box: what the review says, then Comment,
 * Approve or Request changes (the last two not on one's own pull request).
 * A review started on GitHub and left pending is the one submitted.
 */
export default function ReviewScreen() {
  const { projectId, folder, remote, number, id, pending, mine } = useLocalSearchParams<{ projectId: string; folder: string; remote?: string; number: string; id: string; pending?: string; mine?: string }>();
  const ref: PullRef = { projectId, folder, remote: remote || undefined, number: Number(number) };
  const own = mine === '1';
  const [body, setBody] = useState('');
  const [event, setEvent] = useState<ReviewEvent>('COMMENT');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const online = useConnection((s) => s.status.state === 'online');

  const go = async () => {
    setBusy(true);
    setError('');
    const answer = await editPullRequest(ref, { kind: 'review', pullRequestId: id, event, ...(body.trim() ? { body } : {}), ...(pending ? { pendingReviewId: pending } : {}) });
    setBusy(false);
    if (!answer.ok) { setError(answer.error || 'GitHub did not take the review.'); return; }
    setPullNotice(projectId, { kind: 'ok', text: answer.message || 'Review submitted.' });
    router.back();
  };

  const submit = () => {
    const problem = reviewProblem(event, body, own);
    if (problem) { setError(problem); return; }
    const label = reviewChoices(own).find((c) => c.key === event)?.label || 'Review';
    Alert.alert(`${label}: #${number}?`, body.trim() ? body.trim().slice(0, 200) : 'Without a comment.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Submit review', onPress: go },
    ]);
  };

  return (
    <ScrollView style={formStyles.screen} contentContainerStyle={formStyles.content} keyboardShouldPersistTaps="handled">
      <Stack.Screen options={{ title: `Review #${number}` }} />
      <Label>Your review</Label>
      <Field value={body} onChangeText={(value) => { setBody(value); setError(''); }} multiline autoCapitalize="sentences" autoCorrect spellCheck placeholder="Leave a comment" style={styles.input} />
      {reviewChoices(own).map((choice) => (
        <Pressable
          key={choice.key}
          onPress={() => setEvent(choice.key)}
          disabled={choice.disabled}
          style={[styles.choice, event === choice.key && styles.choiceOn, choice.disabled && { opacity: 0.45 }]}
          accessibilityRole="radio"
          accessibilityState={{ selected: event === choice.key, disabled: choice.disabled }}
        >
          <Ionicons name={event === choice.key ? 'radio-button-on' : 'radio-button-off'} size={18} color={event === choice.key ? colors.accent : colors.textDim} />
          <View style={styles.flex}>
            <Text style={styles.choiceLabel}>{choice.label}</Text>
            <Text style={styles.choiceHelp}>{choice.help}</Text>
          </View>
        </Pressable>
      ))}
      {own ? <Text style={formStyles.warn}>GitHub does not let you approve or request changes on your own pull request.</Text> : null}
      <ErrorText>{error}</ErrorText>
      <PrimaryButton label="Submit review" busyLabel="Submitting…" busy={busy} disabled={!online} onPress={submit} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  input: { minHeight: 140, fontSize: 15, lineHeight: 21 },
  choice: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm, padding: spacing.md, borderRadius: 8 },
  choiceOn: { backgroundColor: 'rgba(128,136,255,0.12)' },
  choiceLabel: { color: colors.text, fontSize: 15, fontWeight: '600' },
  choiceHelp: { color: colors.textFaint, fontSize: 12.5, marginTop: 2 },
});
