import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView, Text, View } from 'react-native';

import { FolderBrowser } from '@/components/worktrees/FolderBrowser';
import { ErrorText, Field, formStyles, Hint, Label, PrimaryButton } from '@/components/form';
import { useConnection } from '@/store/connection';
import { colors } from '@/theme';
import { basename, findWorktree, parentFolder, shortPath, worktreeLabel } from '@/worktrees/model';
import { ask, reloadWorktrees, setNotice, SLOW_TIMEOUT_MS, useProjectWorktrees } from '@/worktrees/queries';

/**
 * A folder for a worktree: where to move one (action=move&path=…), or where
 * one of a repository's worktrees was moved by hand, so git finds it again
 * (action=repair&repo=…). Typed, or picked from the computer's folders.
 */
export default function WorktreeFolderScreen() {
  const { projectId, action, path: worktreePath, repo: repoPath } = useLocalSearchParams<{ projectId: string; action: 'move' | 'repair'; path?: string; repo?: string }>();
  const move = action !== 'repair';
  const online = useConnection((s) => s.status.state === 'online');
  const listing = useProjectWorktrees(projectId);
  const homeDir = listing.data?.homeDir || '';
  const found = move ? findWorktree(listing.data?.repositories, worktreePath) : null;
  const repo = move ? found?.repo : listing.data?.repositories.find((r) => r.mainPath === repoPath);
  const [value, setValue] = useState(move ? worktreePath || '' : '');
  // Repairing starts by looking for the folder, as the desktop opens its folder picker.
  const [browsing, setBrowsing] = useState(!move);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const title = move ? `Move ${found ? worktreeLabel(found.wt) : 'worktree'}` : 'Repair a moved folder';

  if (move ? !found : !repo) {
    return (
      <View style={formStyles.center}>
        <Stack.Screen options={{ title }} />
        {listing.isLoading ? <ActivityIndicator color={colors.accent} /> : <Text style={formStyles.empty}>{move ? 'This worktree is gone.' : 'This repository is no longer in the project.'}</Text>}
      </View>
    );
  }

  const submit = async () => {
    const target = value.trim();
    setError('');
    if (move && found) {
      if (!target || target === found.wt.path) { setError('Choose a different folder.'); return; }
      setBusy(true);
      const result = await ask<{ ok?: boolean; error?: string; path?: string }>('worktree-move', [projectId, found.wt.path, target], SLOW_TIMEOUT_MS);
      setBusy(false);
      if (!result.ok) { setError(result.error || 'Could not move the worktree.'); return; }
      setNotice(projectId, { kind: 'ok', text: `Moved ${worktreeLabel(found.wt)} to ${shortPath(result.path || target, homeDir)}` });
    } else if (repo) {
      if (!target.startsWith('/')) { setError('Write the full path of the folder, starting with /.'); return; }
      setBusy(true);
      const result = await ask('worktree-repair', [projectId, repo.mainPath, [target]], SLOW_TIMEOUT_MS);
      setBusy(false);
      if (!result.ok) { setError(result.error || 'Could not repair the worktree.'); return; }
      setNotice(projectId, { kind: 'ok', text: result.output ? `Reconnected ${target}` : 'Nothing to repair', output: result.output || '' });
    }
    router.back();
    reloadWorktrees(projectId);
  };

  const start = move && found ? parentFolder(found.wt.path) : value ? parentFolder(value) : repo ? parentFolder(repo.mainPath) : null;

  return (
    <KeyboardAvoidingView style={formStyles.screen} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={Platform.OS === 'ios' ? 100 : 0}>
      <Stack.Screen options={{ title }} />
      <ScrollView contentContainerStyle={formStyles.content} keyboardShouldPersistTaps="handled">
        {move ? null : <Hint>Pick the folder a worktree of {repo?.name} was moved to by hand: git reconnects it with the repository.</Hint>}
        <Label>{move ? 'New folder' : 'The moved worktree'}</Label>
        <Field value={value} onChangeText={setValue} mono multiline style={{ minHeight: 44 }} placeholder={move ? undefined : '/path/to/the/worktree'} />
        <Text style={formStyles.link} onPress={() => setBrowsing(!browsing)} accessibilityRole="button">
          {browsing ? 'Hide the folders' : move ? 'Choose the folder to move it into…' : 'Choose the folder…'}
        </Text>
        {browsing ? (
          <FolderBrowser
            start={start}
            pickLabel={move ? 'Move it here' : 'This is it'}
            onPick={(folder) => {
              setValue(move && found ? `${folder.replace(/[\\/]+$/, '')}/${basename(found.wt.path)}` : folder);
              setBrowsing(false);
            }}
          />
        ) : null}
        {move && found ? (
          <Hint>
            Git moves the folder and keeps track of it.{found.wt.attached ? ' The project\'s folder, default folder and track folders follow.' : ''} Past sessions keep the old folder, so they will not resume there.
          </Hint>
        ) : null}
        <ErrorText>{error}</ErrorText>
        <PrimaryButton label={move ? 'Move' : 'Repair'} busyLabel={move ? 'Moving…' : 'Repairing…'} busy={busy} disabled={!value.trim() || !online} onPress={submit} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
