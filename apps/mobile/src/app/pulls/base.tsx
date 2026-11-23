import Ionicons from '@expo/vector-icons/Ionicons';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useDeferredValue, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text } from 'react-native';

import { ErrorText, Field, formStyles, Hint, Label, PrimaryButton } from '@/components/form';
import { baseChoices } from '@/pulls/model';
import { editPullRequest, setPullNotice, useBranches, type PullRef } from '@/pulls/queries';
import { useConnection } from '@/store/connection';
import { colors, spacing } from '@/theme';

/**
 * Change base: the repository's branches, found as one types, the default
 * first; the current base and the head are left out. GitHub says what it may
 * do to the timeline before it is done.
 */
export default function ChangeBaseScreen() {
  const { projectId, folder, remote, number, id, head, base } = useLocalSearchParams<{ projectId: string; folder: string; remote?: string; number: string; id: string; head: string; base: string }>();
  const ref: PullRef = { projectId, folder, remote: remote || undefined, number: Number(number) };
  const [query, setQuery] = useState('');
  const search = useDeferredValue(query.trim());
  const branches = useBranches(ref, search);
  const [chosen, setChosen] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const online = useConnection((s) => s.status.state === 'online');
  const names = baseChoices(branches.data, { head, base });

  const go = async () => {
    if (!chosen) return;
    setBusy(true);
    setError('');
    const answer = await editPullRequest(ref, { kind: 'base', pullRequestId: id, base: chosen });
    setBusy(false);
    if (!answer.ok) { setError(answer.error || 'GitHub did not change the base.'); return; }
    setPullNotice(projectId, { kind: 'ok', text: answer.message || `The base is ${chosen} now.` });
    router.back();
  };

  const submit = () => {
    if (!chosen) { setError('Choose a branch.'); return; }
    Alert.alert(`Change the base to ${chosen}?`, 'Some commits from the old base branch may be removed from the timeline, and old review comments may become outdated.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Change base', onPress: go },
    ]);
  };

  return (
    <ScrollView style={formStyles.screen} contentContainerStyle={formStyles.content} keyboardShouldPersistTaps="handled">
      <Stack.Screen options={{ title: `Change base of #${number}` }} />
      <Hint mono>{head} → {base}</Hint>
      <Label>New base branch</Label>
      <Field value={query} onChangeText={setQuery} placeholder="Find a branch" returnKeyType="search" accessibilityLabel="Find a branch" />
      {branches.isLoading ? <ActivityIndicator color={colors.accent} style={{ marginTop: spacing.md }} /> : null}
      {branches.data && !branches.data.ok ? <ErrorText>{branches.data.error}</ErrorText> : null}
      {branches.data?.ok && !names.length ? <Text style={formStyles.empty}>No other branch matches.</Text> : null}
      {names.map((name) => (
        <Pressable key={name} onPress={() => setChosen(name)} style={[styles.option, chosen === name && styles.optionOn]} accessibilityRole="radio" accessibilityState={{ selected: chosen === name }}>
          <Ionicons name={chosen === name ? 'radio-button-on' : 'radio-button-off'} size={18} color={chosen === name ? colors.accent : colors.textDim} />
          <Text style={styles.name} numberOfLines={1}>{name}</Text>
          {name === branches.data?.defaultBranch ? <Text style={styles.flag}>default</Text> : null}
        </Pressable>
      ))}
      {branches.data?.ok && (branches.data.totalCount || 0) > names.length + 2 ? <Hint>Type to find the others.</Hint> : null}
      <ErrorText>{error}</ErrorText>
      <PrimaryButton label="Change base" busyLabel="Changing…" busy={busy} disabled={!online || !chosen} onPress={submit} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  option: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: 46, paddingHorizontal: spacing.md, borderRadius: 8 },
  optionOn: { backgroundColor: 'rgba(128,136,255,0.12)' },
  name: { flex: 1, color: colors.text, fontSize: 14, fontFamily: 'Menlo' },
  flag: { color: colors.textDim, fontSize: 11, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border, borderRadius: 8, paddingHorizontal: 6, paddingVertical: 1, overflow: 'hidden' },
});
