import Ionicons from '@expo/vector-icons/Ionicons';
import { Stack } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { deploymentState, errorTitle, formatBytes, githubPage, shortSha, type Runner } from '@/actions/model';
import { editActions, useCaches, useDeployments, useRunners, useWorkflowFile, useWorkflows, type ActionsRef, type CacheOpts } from '@/actions/queries';
import { Field } from '@/components/form';
import { usePullRefresh } from '@/components/PullRefresh';
import { openInAppBrowser } from '@/components/pulls/PullRequestWebPage';
import { Sheet } from '@/components/Sheet';
import { TextPrompt } from '@/components/TextPrompt';
import { relativeTime } from '@/sessions/model';
import { colors, spacing } from '@/theme';
import { actionStyles as s, openGitHubHere, openJob, openRun, StateIcon } from './parts';

function Failed({ code, error, retry }: { code?: string; error?: string; retry: () => void }) {
  return (
    <View style={s.loading}>
      <Text style={s.emptyTitle}>{errorTitle(code)}</Text>
      <Text style={s.emptyText}>{error || 'Not connected to the computer.'}</Text>
      <Pressable onPress={retry} accessibilityRole="button"><Text style={s.link}>Try again</Text></Pressable>
    </View>
  );
}

function Loading({ text }: { text: string }) {
  return <View style={s.loading}><ActivityIndicator color={colors.accent} /><Text style={s.emptyText}>{text}</Text></View>;
}

const SORTS: { key: NonNullable<CacheOpts['sort']>; label: string }[] = [
  { key: 'last_accessed_at', label: 'Last used' },
  { key: 'created_at', label: 'Created' },
  { key: 'size_in_bytes', label: 'Size' },
];

/** Caches, as GitHub's page: what they take together, filtered by key and branch, sorted, deleted one by one. */
export function CachesView({ actionsRef }: { actionsRef: ActionsRef }) {
  const [key, setKey] = useState('');
  const [branch, setBranch] = useState('');
  const [applied, setApplied] = useState({ key: '', branch: '' });
  const [sort, setSort] = useState<NonNullable<CacheOpts['sort']>>('last_accessed_at');
  const [page, setPage] = useState(1);
  const caches = useCaches(actionsRef, { key: applied.key, ref: applied.branch ? `refs/heads/${applied.branch}` : undefined, sort, direction: 'desc', page });
  const workflows = useWorkflows(actionsRef);
  const canWrite = !!(workflows.data?.ok && workflows.data.repo.canWrite);
  const pull = usePullRefresh(() => caches.refetch());
  const apply = () => { setApplied({ key: key.trim(), branch: branch.trim() }); setPage(1); };
  const answer = caches.data;
  const remove = (id: number, name: string) => Alert.alert('Delete cache?', name, [
    { text: 'Cancel', style: 'cancel' },
    { text: 'Delete', style: 'destructive', onPress: async () => {
      const result = await editActions(actionsRef, { kind: 'delete-cache', cacheId: id });
      if (!result.ok) Alert.alert('GitHub did not do it', result.error || 'Try again.');
    } },
  ]);
  const pages = answer?.ok ? Math.max(1, Math.ceil(answer.total / (answer.perPage || 30))) : 1;
  return (
    <ScrollView style={s.screen} refreshControl={pull} keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
      <Stack.Screen options={{ title: 'Caches' }} />
      <View style={s.section}>
        {answer?.ok && answer.usage ? <Text style={s.faint}>{answer.usage.count} cache{answer.usage.count === 1 ? '' : 's'} · {formatBytes(answer.usage.size)} in all</Text> : null}
        <Field value={key} onChangeText={setKey} onSubmitEditing={apply} onEndEditing={apply} placeholder="Filter caches by key" autoCapitalize="none" autoCorrect={false} mono />
        <Field value={branch} onChangeText={setBranch} onSubmitEditing={apply} onEndEditing={apply} placeholder="Branch" autoCapitalize="none" autoCorrect={false} mono />
        <View style={s.buttons}>
          {SORTS.map((o) => (
            <Pressable key={o.key} onPress={() => { setSort(o.key); setPage(1); }} style={({ pressed }) => [s.button, sort === o.key && s.primary, pressed && s.pressed]} accessibilityRole="button" accessibilityState={{ selected: sort === o.key }}>
              <Text style={[s.buttonText, sort === o.key && s.primaryText]}>{o.label}</Text>
            </Pressable>
          ))}
        </View>
      </View>
      {!answer ? <Loading text="Reading caches…" /> : !answer.ok ? <Failed code={answer.code} error={answer.error} retry={() => caches.refetch()} /> : !answer.caches.length ? (
        <Text style={[s.emptyText, styles.pad]}>{applied.key || applied.branch ? 'No caches match.' : 'This repository has no caches.'}</Text>
      ) : (
        <View style={styles.list}>
          {answer.caches.map((c) => (
            <View key={c.id} style={s.rowLine}>
              <View style={s.flex}>
                <Text style={s.mono} numberOfLines={2}>{c.key}</Text>
                <Text style={s.faint}>{formatBytes(c.size)} · {c.ref.replace(/^refs\/heads\//, '')} · used {relativeTime(c.lastAccessedAt)}</Text>
              </View>
              {canWrite ? <Pressable onPress={() => remove(c.id, c.key)} hitSlop={6} accessibilityRole="button" accessibilityLabel={`Delete cache ${c.key}`}><Ionicons name="trash-outline" size={19} color={colors.danger} /></Pressable> : null}
            </View>
          ))}
          {pages > 1 ? (
            <View style={styles.pager}>
              <Pressable onPress={() => setPage(Math.max(1, page - 1))} disabled={page <= 1} style={[s.button, page <= 1 && styles.off]} accessibilityRole="button"><Text style={s.buttonText}>Previous</Text></Pressable>
              <Text style={s.faint}>Page {page} of {pages}</Text>
              <Pressable onPress={() => setPage(page + 1)} disabled={page >= pages} style={[s.button, page >= pages && styles.off]} accessibilityRole="button"><Text style={s.buttonText}>Next</Text></Pressable>
            </View>
          ) : null}
        </View>
      )}
    </ScrollView>
  );
}

const RUNNER_WORDS: Record<Runner['status'], { label: string; color: string }> = {
  idle: { label: 'Idle', color: colors.running },
  active: { label: 'Active', color: '#d9b45c' },
  offline: { label: 'Offline', color: colors.textFaint },
};

/** The repository's self-hosted runners, for its admins: Idle, Active or Offline, their labels, Remove. */
export function RunnersView({ actionsRef }: { actionsRef: ActionsRef }) {
  const runners = useRunners(actionsRef);
  const pull = usePullRefresh(() => runners.refetch());
  const [menu, setMenu] = useState<Runner | null>(null);
  const [editing, setEditing] = useState<Runner | null>(null);
  const answer = runners.data;
  const repo = answer?.ok ? answer.repo : null;
  const change = async (params: Parameters<typeof editActions>[1]) => {
    const result = await editActions(actionsRef, params);
    if (!result.ok) Alert.alert('GitHub did not do it', result.error || 'Try again.');
  };
  return (
    <View style={s.screen}>
      <Stack.Screen options={{ title: 'Runners' }} />
      <ScrollView refreshControl={pull} contentContainerStyle={styles.content}>
        {!answer ? <Loading text="Reading runners…" /> : !answer.ok ? <Failed code={answer.code} error={answer.error} retry={() => runners.refetch()} /> : (
          <>
            {!answer.admin ? <Text style={[s.emptyText, styles.pad]}>{'GitHub shows a repository\'s self-hosted runners to its admins only, and your account is not one of them here.'}</Text>
              : !answer.runners.length ? <Text style={[s.emptyText, styles.pad]}>{'This repository has no self-hosted runners. Its jobs run on GitHub-hosted runners, or on the organization\'s.'}</Text>
                : (
                  <View style={styles.list}>
                    {answer.runners.map((r) => (
                      <Pressable key={r.id} onPress={() => setMenu(r)} style={({ pressed }) => [s.rowLine, pressed && s.pressed]} accessibilityRole="button" accessibilityLabel={`${r.name}, ${RUNNER_WORDS[r.status].label}`}>
                        <Text style={{ color: RUNNER_WORDS[r.status].color }}>●</Text>
                        <View style={s.flex}>
                          <Text style={s.text}>{r.name}</Text>
                          <Text style={s.faint}>{RUNNER_WORDS[r.status].label} · {r.os}{r.ephemeral ? ' · ephemeral' : ''}</Text>
                          <Text style={s.mono} numberOfLines={2}>{r.labels.map((l) => l.name).join(', ')}</Text>
                        </View>
                        <Ionicons name="ellipsis-horizontal" size={18} color={colors.textDim} />
                      </Pressable>
                    ))}
                  </View>
                )}
            {repo ? (
              <View style={s.section}>
                <Pressable onPress={() => openGitHubHere(githubPage(repo, 'runners') || '', 'Runners')} accessibilityRole="button"><Text style={s.link}>GitHub-hosted runners ↗</Text></Pressable>
                {answer.admin ? <Pressable onPress={() => openGitHubHere(githubPage(repo, 'newRunner') || '', 'New runner')} accessibilityRole="button"><Text style={s.link}>New self-hosted runner ↗</Text></Pressable> : null}
              </View>
            ) : null}
          </>
        )}
      </ScrollView>
      <Sheet
        visible={!!menu}
        title={menu?.name}
        options={menu ? [
          { label: 'Edit labels…', onPress: () => setEditing(menu) },
          { label: 'Remove runner', destructive: true, onPress: () => Alert.alert(`Remove ${menu.name}?`, 'GitHub forgets the runner; the machine keeps its files.', [{ text: 'Cancel', style: 'cancel' }, { text: 'Remove', style: 'destructive', onPress: () => change({ kind: 'runner-remove', runnerId: menu.id }) }]) },
        ] : undefined}
        onClose={() => setMenu(null)}
      />
      <TextPrompt
        visible={!!editing}
        title={editing ? `Labels of ${editing.name}` : ''}
        message="Custom labels, separated by commas. GitHub's own labels stay."
        initialValue={editing ? editing.labels.filter((l) => l.custom).map((l) => l.name).join(', ') : ''}
        autoCapitalize="none"
        onClose={() => setEditing(null)}
        onSubmit={(value) => editing && change({ kind: 'runner-labels', runnerId: editing.id, labels: value.split(',').map((x) => x.trim()).filter(Boolean) })}
      />
    </View>
  );
}

/** Deployments: each environment with its active deployment, the deployments newest first; a log on GitHub Actions opens in the app. */
export function DeploymentsView({ actionsRef }: { actionsRef: ActionsRef }) {
  const [environment, setEnvironment] = useState<string | null>(null);
  const deployments = useDeployments(actionsRef, environment);
  const pull = usePullRefresh(() => deployments.refetch());
  const answer = deployments.data;
  return (
    <ScrollView style={s.screen} refreshControl={pull} contentContainerStyle={styles.content}>
      <Stack.Screen options={{ title: 'Deployments' }} />
      {!answer ? <Loading text="Reading deployments…" /> : !answer.ok ? <Failed code={answer.code} error={answer.error} retry={() => deployments.refetch()} /> : (
        <>
          <View style={[s.buttons, styles.pad]}>
            {[null, ...answer.environments.map((e) => e.name)].map((name) => (
              <Pressable key={name ?? 'all'} onPress={() => setEnvironment(name)} style={({ pressed }) => [s.button, environment === name && s.primary, pressed && s.pressed]} accessibilityRole="button" accessibilityState={{ selected: environment === name }}>
                <Text style={[s.buttonText, environment === name && s.primaryText]}>{name ?? 'All environments'}</Text>
              </Pressable>
            ))}
          </View>
          {answer.environments.some((e) => e.active) ? (
            <View style={s.section}>
              <Text style={s.sectionTitle}>Active deployments</Text>
              {answer.environments.filter((e) => e.active).map((e) => (
                <View key={e.name} style={s.card}>
                  <Text style={s.text}>{e.name}</Text>
                  <Text style={s.faint}>{e.active!.ref || shortSha(e.active!.sha)} · {relativeTime(e.active!.createdAt)}{e.active!.creator ? ` · ${e.active!.creator}` : ''}</Text>
                  {e.active!.environmentUrl ? <Pressable onPress={() => openInAppBrowser(e.active!.environmentUrl)} accessibilityRole="button"><Text style={s.link} numberOfLines={1}>{e.active!.environmentUrl}</Text></Pressable> : null}
                </View>
              ))}
            </View>
          ) : null}
          <View style={s.section}><Text style={s.sectionTitle}>Deployment history · {answer.totalCount}</Text></View>
          <View style={styles.list}>
            {answer.deployments.map((d) => {
              const state = deploymentState(d);
              const open = d.actions ? () => (d.actions!.jobId ? openJob(actionsRef, d.actions!.runId, d.actions!.jobId, d.environment) : openRun(actionsRef, d.actions!.runId, d.environment)) : d.logUrl ? () => openInAppBrowser(d.logUrl) : undefined;
              return (
                <Pressable key={d.id} disabled={!open} onPress={open} style={({ pressed }) => [s.rowLine, pressed && s.pressed]} accessibilityRole="button" accessibilityLabel={`${d.environment}, ${state.label}`}>
                  <StateIcon state={{ key: state.bucket, bucket: state.bucket, label: state.label, a11y: state.label, verb: '' }} />
                  <View style={s.flex}>
                    <Text style={s.text}>{d.environment} <Text style={s.faint}>{state.label}</Text></Text>
                    <Text style={s.faint}>{d.ref} {shortSha(d.sha)} · {d.creator} · {relativeTime(d.createdAt)}</Text>
                  </View>
                  {open ? <Text style={s.link}>View logs</Text> : null}
                </Pressable>
              );
            })}
          </View>
          {answer.hasNextPage ? <Text style={[s.faint, styles.pad]}>Older deployments are on GitHub.</Text> : null}
        </>
      )}
    </ScrollView>
  );
}

/** A workflow file at a commit or a branch, numbered lines in a mono font. */
export function WorkflowFileView({ actionsRef, path, gitRef, title }: { actionsRef: ActionsRef; path: string; gitRef: string; title?: string }) {
  const file = useWorkflowFile(actionsRef, path, gitRef);
  const answer = file.data;
  const lines = answer?.ok ? answer.text.replace(/\n$/, '').split('\n') : [];
  return (
    <View style={s.screen}>
      <Stack.Screen options={{ title: title || 'Workflow file' }} />
      {!answer ? <Loading text="Reading the workflow file…" /> : !answer.ok ? <Failed code={answer.code} error={answer.error} retry={() => file.refetch()} /> : (
        <ScrollView contentContainerStyle={styles.content}>
          <View style={s.section}>
            <Text style={s.mono}>{answer.path} @ {/^[0-9a-f]{40}$/.test(answer.ref) ? shortSha(answer.ref) : answer.ref}</Text>
            {answer.error ? <Text style={[s.faint, { color: colors.attention }]}>{answer.error}</Text> : null}
          </View>
          <ScrollView horizontal contentContainerStyle={styles.code}>
            <View>
              {lines.map((line, i) => (
                <Text key={i} style={styles.codeLine}><Text style={styles.num}>{String(i + 1).padStart(4, ' ')}  </Text>{line || ' '}</Text>
              ))}
            </View>
          </ScrollView>
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  content: { paddingBottom: 48 },
  pad: { marginHorizontal: spacing.lg, marginTop: spacing.md },
  list: { marginTop: spacing.md, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  pager: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.md, padding: spacing.md },
  off: { opacity: 0.4 },
  code: { padding: spacing.lg },
  codeLine: { fontFamily: 'Menlo', fontSize: 12, lineHeight: 18, color: colors.text },
  num: { color: '#55556a' },
});
