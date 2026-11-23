import Ionicons from '@expo/vector-icons/Ionicons';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useDeferredValue, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text } from 'react-native';

import { ErrorText, Field, formStyles, PrimaryButton } from '@/components/form';
import { labelColor, sideChange, type Label, type Person } from '@/pulls/model';
import { editPullRequest, setPullNotice, useCandidates, useConversation, type PullRef } from '@/pulls/queries';
import { useConnection } from '@/store/connection';
import { colors, spacing } from '@/theme';

type Side = 'reviewers' | 'assignees' | 'labels';
type Option = { key: string; label: string; color?: string; sub?: string };
const TITLES: Record<Side, string> = { reviewers: 'Reviewers', assignees: 'Assignees', labels: 'Labels' };

/**
 * One section of GitHub's sidebar: who is asked to review, who is assigned,
 * which labels the pull request has. Saving changes what was ticked, as
 * GitHub's own picker does when it closes.
 */
export default function SidebarScreen() {
  const { projectId, folder, remote, number, side: rawSide } = useLocalSearchParams<{ projectId: string; folder: string; remote?: string; number: string; side: Side }>();
  const side: Side = TITLES[rawSide] ? rawSide : 'labels';
  const ref: PullRef = { projectId, folder, remote: remote || undefined, number: Number(number) };
  const conversation = useConversation(ref);
  const head = conversation.data?.pages[0]?.pr;
  const current = useMemo((): Option[] => {
    if (!head) return [];
    if (side === 'labels') return head.labels.map((l) => ({ key: l.id, label: l.name, color: l.color }));
    if (side === 'assignees') return head.assignees.map((a) => ({ key: a.id, label: a.login }));
    return head.reviewers.filter((r) => r.kind !== 'team').map((r) => ({ key: r.login, label: r.login }));
  }, [head, side]);
  const [chosen, setChosen] = useState<Set<string> | null>(null);
  const picked = useMemo(() => chosen ?? new Set(current.map((c) => c.key)), [chosen, current]);
  const [query, setQuery] = useState('');
  const search = useDeferredValue(query.trim());
  const candidates = useCandidates(ref, side === 'labels' ? 'labels' : 'users', search);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const online = useConnection((s) => s.status.state === 'online');

  const options = useMemo((): Option[] => {
    // GitHub ignores a review asked of the pull request's own author: not offered.
    const offered = (candidates.data?.items || []).filter((item) => side !== 'reviewers' || (item as Person).login !== head?.author);
    const found = offered.map((item): Option => (side === 'labels'
      ? { key: (item as Label).id, label: (item as Label).name, color: (item as Label).color }
      : { key: side === 'reviewers' ? (item as Person).login : (item as Person).id, label: (item as Person).login, sub: (item as Person).name || '' }));
    // What is ticked stays listed even when the search does not find it.
    const missing = current.filter((c) => picked.has(c.key) && !found.some((f) => f.key === c.key));
    return [...missing, ...found];
  }, [candidates.data, current, picked, side, head?.author]);

  const flip = (key: string) => {
    const next = new Set(picked);
    if (next.has(key)) next.delete(key); else next.add(key);
    setChosen(next);
  };

  const save = async () => {
    if (!head) return;
    const params = sideChange(side, head, picked);
    if (!params) { router.back(); return; }
    setBusy(true);
    setError('');
    const answer = await editPullRequest(ref, params);
    setBusy(false);
    if (!answer.ok) { setError(answer.error || 'GitHub did not take the change.'); return; }
    setPullNotice(projectId, { kind: 'ok', text: answer.message || 'Saved.' });
    router.back();
  };

  return (
    <ScrollView style={formStyles.screen} contentContainerStyle={formStyles.content} keyboardShouldPersistTaps="handled">
      <Stack.Screen options={{ title: TITLES[side] }} />
      <Field value={query} onChangeText={setQuery} placeholder={side === 'labels' ? 'Filter labels' : 'Type a name'} returnKeyType="search" accessibilityLabel="Filter" />
      {candidates.isLoading || !head ? <ActivityIndicator color={colors.accent} style={{ marginTop: spacing.md }} /> : null}
      {candidates.data && !candidates.data.ok ? <ErrorText>{candidates.data.error}</ErrorText> : null}
      {options.map((option) => (
        <Pressable key={option.key} onPress={() => flip(option.key)} style={styles.option} accessibilityRole="checkbox" accessibilityState={{ checked: picked.has(option.key) }}>
          <Ionicons name={picked.has(option.key) ? 'checkbox' : 'square-outline'} size={20} color={picked.has(option.key) ? colors.accent : colors.textDim} />
          <Text style={[styles.label, option.color ? { color: labelColor(option.color) } : null]} numberOfLines={1}>{option.label}</Text>
          {option.sub ? <Text style={styles.sub} numberOfLines={1}>{option.sub}</Text> : null}
        </Pressable>
      ))}
      {candidates.data?.ok && !options.length ? <Text style={formStyles.empty}>{side === 'reviewers' && !search ? 'No one else to ask: GitHub takes no review from the pull request\'s author.' : 'Nothing found.'}</Text> : null}
      <ErrorText>{error}</ErrorText>
      <PrimaryButton label="Save" busyLabel="Saving…" busy={busy} disabled={!online || !head} onPress={save} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  option: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: 46, paddingHorizontal: spacing.sm },
  label: { color: colors.text, fontSize: 15, flexShrink: 1 },
  sub: { color: colors.textFaint, fontSize: 12.5, flexShrink: 1 },
});
