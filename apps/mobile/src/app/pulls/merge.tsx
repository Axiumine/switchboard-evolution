import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Alert, ScrollView, Text, View } from 'react-native';

import { Code, ErrorText, formStyles, Hint, Label, PrimaryButton, SelectRow, SwitchRow } from '@/components/form';
import { mergeBlock, mergeWarnings, METHOD_LABELS, type MergeMethod } from '@/pulls/model';
import { runPullRequestAction, setPullNotice, useOpenPullRequests } from '@/pulls/queries';
import { useConnection } from '@/store/connection';
import { colors } from '@/theme';

/**
 * Merge one pull request, as the desktop's dialog asks it: how (only the
 * methods the repository allows), and whether to delete its branch on GitHub.
 * The merge happens on GitHub; the computer's checkout is not touched.
 */
export default function MergePullRequestScreen() {
  const { projectId, folder, number, remote } = useLocalSearchParams<{ projectId: string; folder: string; number: string; remote?: string }>();
  const chosenRemote = remote || undefined;
  const online = useConnection((s) => s.status.state === 'online');
  const listing = useOpenPullRequests(projectId, folder, chosenRemote);
  const pr = listing.data?.items?.find((item) => item.number === Number(number));
  const repo = listing.data?.repo;
  const [method, setMethod] = useState<MergeMethod | null>(null);
  const [deleteBranch, setDeleteBranch] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  if (!pr || !repo) {
    return (
      <View style={formStyles.center}>
        <Stack.Screen options={{ title: 'Merge pull request' }} />
        {listing.isLoading ? <ActivityIndicator color={colors.accent} /> : <Text style={formStyles.empty}>This pull request is no longer open.</Text>}
      </View>
    );
  }

  const block = mergeBlock(pr, repo);
  const how = method ?? repo.defaultMethod ?? repo.mergeMethods[0];
  const fork = pr.crossRepository;
  const remove = !fork && (deleteBranch ?? repo.deleteBranchOnMerge);

  const go = async () => {
    setError('');
    setBusy(true);
    const answer = await runPullRequestAction(projectId, folder, chosenRemote, { number: pr.number, action: 'merge', method: how, deleteBranch: remove, headOid: pr.headOid });
    setBusy(false);
    if (!answer.ok) { setError(answer.error || 'GitHub did not merge it.'); return; }
    setPullNotice(projectId, { kind: 'ok', text: answer.message || `Merged pull request #${pr.number}.` });
    router.back();
  };

  const submit = () => {
    if (!how) return;
    Alert.alert(`Merge #${pr.number}?`, `${METHOD_LABELS[how]} into ${pr.base}${remove ? `, then delete ${pr.head} on GitHub` : ''}.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Merge', onPress: go },
    ]);
  };

  return (
    <ScrollView style={formStyles.screen} contentContainerStyle={formStyles.content}>
      <Stack.Screen options={{ title: `Merge #${pr.number}` }} />
      <Text style={formStyles.title}>{pr.title}</Text>
      <Hint mono>{pr.head} → {pr.base}</Hint>
      {mergeWarnings(pr).map((warning) => <Text key={warning} style={formStyles.warn}>{warning}</Text>)}
      {block ? <Text style={formStyles.warn}>{block}</Text> : null}
      <Label>Merge method</Label>
      <SelectRow
        title="Merge method"
        choices={repo.mergeMethods.map((key) => ({ key, label: METHOD_LABELS[key] }))}
        selected={how ?? ''}
        onSelect={(key) => setMethod(key as MergeMethod)}
      />
      <SwitchRow
        label={<>Delete the branch <Code>{pr.head}</Code> after merging</>}
        help={fork ? 'Its branch is in another repository (a fork), so it stays.' : 'On GitHub only: the branch on the computer, and any worktree on it, stay.'}
        value={remove}
        onChange={setDeleteBranch}
        disabled={fork}
      />
      <Hint>The merge happens on GitHub. The computer&apos;s checkout is not changed.</Hint>
      <ErrorText>{error}</ErrorText>
      <PrimaryButton label="Merge" busyLabel="Merging…" busy={busy} disabled={!!block || !how || !online} onPress={submit} />
    </ScrollView>
  );
}
