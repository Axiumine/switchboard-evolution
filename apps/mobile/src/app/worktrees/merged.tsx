import { useQuery } from '@tanstack/react-query';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
import { ActivityIndicator, ScrollView, Text, View } from 'react-native';

import { Code, ErrorText, formStyles, Hint, Label, PrimaryButton, SelectRow, SwitchRow } from '@/components/form';
import { act } from '@/projects/queries';
import { useConnection } from '@/store/connection';
import { colors } from '@/theme';
import { baseChoices, mergedChoices, plural, type Branches, type MergedChoice, type MergedList, type RemoveResult } from '@/worktrees/model';
import { ask, HOOK_TIMEOUT_MS, reloadWorktrees, setNotice, SLOW_TIMEOUT_MS, useProjectWorktrees, useRunningByWorktree } from '@/worktrees/queries';

/**
 * Remove the worktrees of a repository whose branch is already merged into a
 * base branch (the default one first), and their branches if asked. One that
 * is locked, dirty or missing cannot go; one just made or with sessions
 * running is offered but not ticked.
 */
export default function RemoveMergedScreen() {
  const { projectId, repo: repoPath } = useLocalSearchParams<{ projectId: string; repo: string }>();
  const online = useConnection((s) => s.status.state === 'online');
  const listing = useProjectWorktrees(projectId);
  const repo = listing.data?.repositories.find((r) => r.mainPath === repoPath);
  const homeDir = listing.data?.homeDir || '';
  const preRemove = !!listing.data?.settings.preRemoveCmd;
  const running = useRunningByWorktree(listing.data?.repositories);

  const branches = useQuery({
    queryKey: ['worktree-branches', projectId, repoPath],
    queryFn: () => act<Branches>('list-worktree-branches', [projectId, repoPath]),
    enabled: online && !!repoPath,
    refetchOnMount: 'always',
  });
  const [base, setBase] = useState<string | null>(null);
  const baseValue = base ?? branches.data?.defaultBranch ?? '';
  const merged = useQuery({
    queryKey: ['worktree-merged', projectId, repoPath, baseValue],
    queryFn: () => act<MergedList>('worktree-merged', [projectId, repoPath, baseValue]),
    enabled: online && !!repoPath && !!baseValue,
    refetchOnMount: 'always',
  });
  const choices = useMemo(
    () => (merged.data ? mergedChoices(merged.data, { mainPath: repoPath }, homeDir, running) : []),
    [merged.data, repoPath, homeDir, running],
  );
  // What was ticked or unticked here; the rest keep their default.
  const [picked, setPicked] = useState<Record<string, boolean>>({});
  const ticked = (choice: MergedChoice) => choice.eligible && (picked[choice.path] ?? choice.ticked);
  const chosen = choices.filter(ticked);
  const [deleteBranches, setDeleteBranches] = useState(true);
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState('');

  const submit = async () => {
    if (!chosen.length) { setError('Tick at least one worktree.'); return; }
    setError('');
    const failures: string[] = [];
    let removed = 0;
    for (const item of chosen) {
      setProgress(`Removing ${item.branch}…`);
      const done = await ask<RemoveResult>('worktree-remove', [projectId, item.path, { deleteBranch: deleteBranches }], preRemove ? HOOK_TIMEOUT_MS : SLOW_TIMEOUT_MS);
      if (!done.ok) { failures.push(`${item.branch}: ${done.error || 'failed'}`); continue; }
      removed += 1;
      if (done.branchError) failures.push(`${item.branch}: removed, but the branch stays: ${done.branchError.split('\n')[0]}`);
    }
    setProgress(null);
    const text = `Removed ${plural(removed, 'merged worktree')}`;
    setNotice(projectId, failures.length
      ? { kind: 'error', text: `${text}; ${plural(failures.length, 'problem')}`, output: failures.join('\n') }
      : { kind: 'ok', text });
    router.back();
    reloadWorktrees(projectId);
  };

  const title = repo ? `Remove merged worktrees in ${repo.name}` : 'Remove merged worktrees';
  const noBase = !branches.isLoading && !baseValue;

  return (
    <ScrollView style={formStyles.screen} contentContainerStyle={formStyles.content}>
      <Stack.Screen options={{ title: 'Remove merged' }} />
      <Text style={formStyles.title}>{title}</Text>

      <Label>Merged into</Label>
      <SelectRow
        title="Merged into"
        choices={baseChoices(branches.data || null, baseValue).map((name) => ({ key: name, label: name }))}
        selected={baseValue}
        onSelect={(key) => { setBase(key); setPicked({}); setError(''); }}
        placeholder={branches.isLoading ? 'Reading branches…' : 'Pick a base branch'}
        loading={branches.isLoading}
      />
      {noBase ? <Hint>This repository has no main or master branch: pick a base branch.</Hint> : null}
      <ErrorText>{(branches.error as Error | null)?.message || (merged.error as Error | null)?.message || ''}</ErrorText>

      {merged.isLoading && baseValue ? (
        <View style={{ paddingVertical: 16 }}><ActivityIndicator color={colors.accent} /></View>
      ) : merged.data && !choices.length ? (
        <Hint>No worktree has a branch merged into <Code>{merged.data.base}</Code>.</Hint>
      ) : (
        choices.map((choice) => (
          <SwitchRow
            key={choice.path}
            label={<Code>{choice.branch}</Code>}
            help={choice.notes}
            value={ticked(choice)}
            disabled={!choice.eligible || !!progress}
            onChange={(on) => setPicked({ ...picked, [choice.path]: on })}
          />
        ))
      )}

      <SwitchRow
        label="Also delete their branches"
        help="Git deletes only a branch it sees as merged; any other stays and is listed."
        value={deleteBranches}
        onChange={setDeleteBranches}
        disabled={!!progress}
      />
      <ErrorText>{error}</ErrorText>
      <PrimaryButton
        label={chosen.length ? `Remove ${plural(chosen.length, 'worktree')}` : 'Remove selected'}
        busyLabel={progress || 'Removing…'}
        busy={!!progress}
        disabled={!chosen.length || !online}
        danger
        onPress={submit}
      />
    </ScrollView>
  );
}
