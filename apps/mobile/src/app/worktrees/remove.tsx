import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Alert, ScrollView, Text, View } from 'react-native';

import { Code, ErrorText, formStyles, Hint, PrimaryButton, SwitchRow } from '@/components/form';
import { sessionTitle } from '@/sessions/model';
import { useConnection } from '@/store/connection';
import { colors } from '@/theme';
import { findWorktree, plural, removeReady, shortPath, worktreeLabel, type RemoveResult, type Worktree, type WorktreeRepository } from '@/worktrees/model';
import { ask, HOOK_TIMEOUT_MS, reloadWorktrees, runAction, setNotice, SLOW_TIMEOUT_MS, useProjectWorktrees, useRunningByWorktree } from '@/worktrees/queries';

/**
 * Remove one worktree, as the desktop's dialog asks it: unlock it first,
 * lose its uncommitted changes, delete its branch too. An unmerged branch is
 * asked about again once the worktree is gone.
 */
export default function RemoveWorktreeScreen() {
  const { projectId, path } = useLocalSearchParams<{ projectId: string; path: string }>();
  const online = useConnection((s) => s.status.state === 'online');
  const listing = useProjectWorktrees(projectId);
  const found = findWorktree(listing.data?.repositories, path);
  const running = useRunningByWorktree(listing.data?.repositories);
  const settings = listing.data?.settings;
  const homeDir = listing.data?.homeDir || '';
  const [unlock, setUnlock] = useState(false);
  const [force, setForce] = useState(false);
  const [deleteBranch, setDeleteBranch] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  if (!found) {
    return (
      <View style={formStyles.center}>
        <Stack.Screen options={{ title: 'Remove worktree' }} />
        {listing.isLoading ? <ActivityIndicator color={colors.accent} /> : <Text style={formStyles.empty}>This worktree is gone.</Text>}
      </View>
    );
  }

  const { repo, wt } = found;
  const live = running.get(wt.path) || [];
  const label = worktreeLabel(wt);
  const ready = removeReady(wt, { unlock, force });

  const submit = async () => {
    setError('');
    setBusy(true);
    const result = await ask<RemoveResult>('worktree-remove', [projectId, wt.path, { unlock, force, deleteBranch }], settings?.preRemoveCmd && wt.exists ? HOOK_TIMEOUT_MS : SLOW_TIMEOUT_MS);
    setBusy(false);
    if (result.dirty) { setError('It has uncommitted changes. Turn on “Discard its uncommitted changes” to remove it anyway.'); return; }
    if (!result.ok) { setError([result.error || 'Could not remove the worktree.', result.output].filter(Boolean).join('\n\n')); return; }
    router.back();
    afterRemove(projectId, repo, wt, result);
  };

  return (
    <ScrollView style={formStyles.screen} contentContainerStyle={formStyles.content}>
      <Stack.Screen options={{ title: 'Remove worktree' }} />
      <Text style={formStyles.title}>Remove the worktree {label}?</Text>
      <Hint mono>{shortPath(wt.path, homeDir)}</Hint>
      {live.length ? (
        <>
          <Text style={formStyles.warn}>{plural(live.length, 'running session')} here will lose {live.length === 1 ? 'its' : 'their'} folder.</Text>
          {live.map((s) => <Hint key={s.sessionId}>• {sessionTitle(s)}</Hint>)}
        </>
      ) : null}
      {!wt.exists ? <Hint>The folder is already gone: this drops git&apos;s record of it.</Hint> : null}
      {wt.locked ? <SwitchRow label="Unlock it first" help={wt.lockReason ? `Locked: ${wt.lockReason}` : 'It is locked.'} value={unlock} onChange={setUnlock} /> : null}
      {wt.exists ? (
        <SwitchRow
          label="Discard its uncommitted changes"
          help={wt.dirty ? 'It has some. They are lost: git cannot bring them back.' : 'Only needed if it has any.'}
          value={force}
          onChange={setForce}
        />
      ) : null}
      {wt.branch ? <SwitchRow label={<>Also delete the branch <Code>{wt.branch}</Code></>} help="If it is not merged you are asked again." value={deleteBranch} onChange={setDeleteBranch} /> : null}
      {settings?.preRemoveCmd && wt.exists ? <Hint>Runs <Code>{settings.preRemoveCmd}</Code> first. If it fails, the worktree stays.</Hint> : null}
      {wt.exists ? <Hint>Files git ignores there, like node_modules or a copied .env, go with the folder.</Hint> : null}
      {wt.attached ? <Hint>It is detached from the project too.</Hint> : null}
      <ErrorText>{error}</ErrorText>
      <PrimaryButton
        label={force ? 'Remove and discard changes' : 'Remove worktree'}
        busyLabel="Removing…"
        busy={busy}
        disabled={!ready || !online}
        danger
        onPress={submit}
      />
    </ScrollView>
  );
}

/** Say what went, read the worktrees again, and ask about a branch git would not delete. */
async function afterRemove(projectId: string, repo: WorktreeRepository, wt: Worktree, result: RemoveResult) {
  let text = `Removed ${worktreeLabel(wt)}`;
  if (result.branchDeleted) text += ` and the branch ${result.branch}`;
  setNotice(projectId, { kind: 'ok', text });
  await reloadWorktrees(projectId);
  const branch = result.branch;
  if (result.unmerged && branch) {
    const why = result.branchError ? `\n\n${result.branchError.split('\n')[0]}` : '';
    Alert.alert(`Delete ${branch} anyway?`, `The worktree is gone, but the branch has commits that are not merged. Deleting it loses them unless another branch or tag points at them.${why}`, [
      { text: 'Keep it', style: 'cancel' },
      {
        text: 'Delete the branch', style: 'destructive',
        onPress: () => runAction(projectId, `Deleting ${branch}…`, () => ask('worktree-delete-branch', [projectId, repo.mainPath, branch, { force: true }]), `Deleted the branch ${branch}`),
      },
    ]);
  } else if (result.branchError) {
    setNotice(projectId, { kind: 'error', text: `${text}, but the branch stays: ${result.branchError}` });
  }
}
