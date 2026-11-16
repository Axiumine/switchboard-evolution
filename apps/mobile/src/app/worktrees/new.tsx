import { useQuery } from '@tanstack/react-query';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, View } from 'react-native';

import { FolderBrowser } from '@/components/worktrees/FolderBrowser';
import { Chips, Code, ErrorText, Field, formStyles, Hint, Label, PrimaryButton, SelectRow, SwitchRow } from '@/components/form';
import { act } from '@/projects/queries';
import { useConnection } from '@/store/connection';
import { colors } from '@/theme';
import {
  basename, CREATE_MODES, createSpec, existingChoices, formRef, parentFolder, refFolderName, remoteLocalName, shortPath, START_OPTIONS, startPointChoices,
  type Branches, type CreateForm, type CreateMode, type CreateResult, type StartAfter,
} from '@/worktrees/model';
import { afterCreate, ask, SLOW_TIMEOUT_MS, useProjectWorktrees } from '@/worktrees/queries';

/**
 * A new worktree in one of the project's repositories, as the desktop's
 * "New worktree" dialog makes it: a new, existing or remote branch, or a
 * detached checkout, in a folder from the template, with the local files to
 * copy, then the post-create command and a session if asked.
 */
export default function NewWorktreeScreen() {
  const { projectId, repo: repoParam } = useLocalSearchParams<{ projectId: string; repo?: string }>();
  const online = useConnection((s) => s.status.state === 'online');
  const listing = useProjectWorktrees(projectId);
  const repos = (listing.data?.repositories || []).filter((r) => !r.error);
  const homeDir = listing.data?.homeDir || '';
  const settings = listing.data?.settings;

  const [repoPath, setRepoPath] = useState<string | null>(repoParam || null);
  const current = repos.find((r) => r.mainPath === repoPath) || repos[0];
  const [mode, setMode] = useState<CreateMode>('new');
  const [branch, setBranch] = useState('');
  const [startPoint, setStartPoint] = useState('');
  const [detachAt, setDetachAt] = useState('');
  // null: the default the branches give (the first free branch, the first remote, its local name).
  const [existing, setExisting] = useState<string | null>(null);
  const [remoteBranch, setRemoteBranch] = useState<string | null>(null);
  const [localBranch, setLocalBranch] = useState<string | null>(null);
  const [path, setPath] = useState('');
  const [pathEdited, setPathEdited] = useState(false);
  const [browsing, setBrowsing] = useState(false);
  const [attach, setAttach] = useState(false);
  const [envPicked, setEnvPicked] = useState<string[] | null>(null);
  const [runPost, setRunPost] = useState(true);
  const [after, setAfter] = useState<StartAfter | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const branches = useQuery({
    queryKey: ['worktree-branches', projectId, current?.mainPath],
    queryFn: () => act<Branches>('list-worktree-branches', [projectId, current!.mainPath]),
    enabled: online && !!current,
    refetchOnMount: 'always',
  });
  const env = useQuery({
    queryKey: ['worktree-env', projectId, current?.mainPath],
    queryFn: () => act<{ files: string[]; defaults: string[] }>('list-env-files', [projectId, current!.mainPath]),
    enabled: online && !!current,
    refetchOnMount: 'always',
  });

  const existingList = useMemo(() => existingChoices(branches.data || null), [branches.data]);
  const remoteList = (branches.data?.remote || []).map((b) => ({ key: b.name, label: b.name }));
  const existingValue = existing ?? existingList.find((c) => !c.disabled)?.key ?? '';
  const remoteValue = remoteBranch ?? remoteList[0]?.key ?? '';
  const localValue = localBranch ?? remoteLocalName(branches.data || null, remoteValue);
  const envFiles = env.data?.files || [];
  const envSelected = envPicked ?? (env.data?.defaults || []).filter((name) => envFiles.includes(name));
  const afterValue: StartAfter = after ?? settings?.startAfterCreate ?? 'none';

  const form: CreateForm = {
    repoPath: current?.mainPath || '',
    mode,
    branch,
    startPoint: mode === 'detached' ? detachAt : startPoint,
    existing: existingValue,
    remoteBranch: remoteValue,
    localBranch: localValue,
    path,
    attach,
    copyEnv: envSelected,
  };
  const ref = formRef(form, branches.data || null);

  // The folder from the template, for the ref as it is typed, until the path is changed by hand.
  const repoMain = current?.mainPath;
  useEffect(() => {
    if (pathEdited || !repoMain || !online) return undefined;
    let stale = false;
    const timer = setTimeout(async () => {
      const result = await ask<{ ok?: boolean; path?: string }>('suggest-worktree-path', [projectId, repoMain, ref || 'worktree']);
      if (!stale && result.ok && result.path) setPath(result.path);
    }, 150);
    return () => { stale = true; clearTimeout(timer); };
  }, [projectId, repoMain, ref, pathEdited, online]);

  const pickRepository = (key: string) => {
    if (key === current?.mainPath) return;
    setRepoPath(key);
    setExisting(null);
    setRemoteBranch(null);
    setLocalBranch(null);
    setStartPoint('');
    setDetachAt('');
    setEnvPicked(null);
    setError('');
  };

  const toggleEnv = (name: string, on: boolean) => setEnvPicked(on ? [...envSelected.filter((n) => n !== name), name] : envSelected.filter((n) => n !== name));

  const submit = async () => {
    if (!current) return;
    const built = createSpec(form);
    if (built.error) { setError(built.error); return; }
    setError('');
    setBusy(true);
    const result = await ask('worktree-create', [projectId, built.spec], SLOW_TIMEOUT_MS);
    setBusy(false);
    if (!result.ok) { setError(result.error || 'Could not create the worktree.'); return; }
    router.back();
    afterCreate(projectId, { result: result as unknown as CreateResult, runPost: !!settings?.postCreateCmd && runPost, after: afterValue });
  };

  if (!listing.data) {
    return (
      <View style={formStyles.center}>
        <Stack.Screen options={{ title: 'New worktree' }} />
        {listing.isLoading ? <ActivityIndicator color={colors.accent} /> : <Text style={formStyles.empty}>{(listing.error as Error | null)?.message || 'Not connected to the computer.'}</Text>}
      </View>
    );
  }
  if (!current) {
    return (
      <View style={formStyles.center}>
        <Stack.Screen options={{ title: 'New worktree' }} />
        <Text style={formStyles.empty}>This project has no git repository to make a worktree in.</Text>
      </View>
    );
  }

  const checkedOutIn = (key: string) => `${key} is already checked out in ${branches.data?.checkedOut[key] || 'another worktree'}.`;

  return (
    <KeyboardAvoidingView style={formStyles.screen} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={Platform.OS === 'ios' ? 100 : 0}>
      <Stack.Screen options={{ title: 'New worktree' }} />
      <ScrollView contentContainerStyle={formStyles.content} keyboardShouldPersistTaps="handled">
        {repos.length > 1 ? (
          <>
            <Label>Repository</Label>
            <SelectRow
              title="Repository"
              choices={repos.map((r) => ({ key: r.mainPath, label: `${r.name} · ${shortPath(r.mainPath, homeDir)}` }))}
              selected={current.mainPath}
              onSelect={pickRepository}
            />
          </>
        ) : (
          <Hint>In <Text style={{ color: colors.text, fontWeight: '600' }}>{current.name}</Text> · <Code>{shortPath(current.mainPath, homeDir)}</Code></Hint>
        )}

        <Label>Check out</Label>
        <Chips items={CREATE_MODES} selected={mode} onSelect={(m) => { setMode(m); setError(''); }} />
        {branches.error ? <ErrorText>{(branches.error as Error).message || 'Could not read the branches.'}</ErrorText> : null}

        {mode === 'new' ? (
          <>
            <Label>Branch name</Label>
            <Field value={branch} onChangeText={setBranch} placeholder="feature/my-change" autoFocus />
            <Label>Start from</Label>
            <SelectRow title="Start from" choices={startPointChoices(branches.data || null)} selected={startPoint} onSelect={setStartPoint} loading={branches.isLoading} />
          </>
        ) : mode === 'existing' ? (
          <>
            <Label>Branch</Label>
            <SelectRow
              title="Branch"
              choices={existingList}
              selected={existingValue}
              onSelect={setExisting}
              placeholder={branches.isLoading ? 'Reading branches…' : 'No local branches'}
              loading={branches.isLoading}
              disabledReason={(choice) => checkedOutIn(choice.key)}
            />
          </>
        ) : mode === 'remote' ? (
          <>
            <Label>Remote branch</Label>
            <SelectRow
              title="Remote branch"
              choices={remoteList}
              selected={remoteValue}
              onSelect={(key) => { setRemoteBranch(key); setLocalBranch(null); }}
              placeholder={branches.isLoading ? 'Reading branches…' : 'No remote branches (fetch first)'}
              loading={branches.isLoading}
            />
            <Label>Local branch</Label>
            <Field value={localValue} onChangeText={setLocalBranch} />
          </>
        ) : (
          <>
            <Label>At</Label>
            <SelectRow title="Check out at" choices={startPointChoices(branches.data || null, true)} selected={detachAt} onSelect={setDetachAt} loading={branches.isLoading} />
          </>
        )}

        <Label>Folder</Label>
        <Field value={path} onChangeText={(value) => { setPath(value); setPathEdited(!!value.trim()); }} mono multiline style={{ minHeight: 44 }} />
        <Pressable onPress={() => setBrowsing(!browsing)} accessibilityRole="button" accessibilityState={{ expanded: browsing }}>
          <Text style={formStyles.link}>{browsing ? 'Hide the folders' : 'Choose the folder to put it in…'}</Text>
        </Pressable>
        {browsing ? (
          <FolderBrowser
            start={path ? parentFolder(path) : parentFolder(current.mainPath)}
            pickLabel="Put it here"
            onPick={(parent) => {
              const name = refFolderName(ref) || basename(path) || 'worktree';
              setPath(`${parent.replace(/[\\/]+$/, '')}/${name}`);
              setPathEdited(true);
              setBrowsing(false);
            }}
          />
        ) : null}
        <Hint>From the folder template in Worktree settings. Change it freely.</Hint>

        <SwitchRow
          label="Attach to the project"
          help="Listed with the project's folders and in the Git tab, and added to new sessions of the project."
          value={attach}
          onChange={setAttach}
        />

        {envFiles.length ? (
          <>
            <Label>Local files to copy</Label>
            {envFiles.map((name) => (
              <SwitchRow key={name} label={<Code>{name}</Code>} value={envSelected.includes(name)} onChange={(on) => toggleEnv(name, on)} />
            ))}
          </>
        ) : null}
        {settings?.copyPatterns?.length ? <Hint>Also copies what matches <Code>{settings.copyPatterns.join(', ')}</Code>.</Hint> : null}
        {settings?.postCreateCmd ? (
          <SwitchRow label={<>Then run <Code>{settings.postCreateCmd}</Code></>} help="In the new worktree, before anything opens there." value={runPost} onChange={setRunPost} />
        ) : null}

        <Label>Then open</Label>
        <Chips items={START_OPTIONS} selected={afterValue} onSelect={setAfter} />

        <ErrorText>{error}</ErrorText>
        <PrimaryButton label="Create worktree" busyLabel="Creating…" busy={busy} disabled={!online} onPress={submit} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
