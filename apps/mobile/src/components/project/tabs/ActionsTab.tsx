import Ionicons from '@expo/vector-icons/Ionicons';
import * as Clipboard from 'expo-clipboard';
import { router } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import {
  badgeMarkdown, countText, errorTitle, GITHUB_PAGES, githubPage, parseQuery, RUN_MENU_LABELS, runMenu, setQualifier, sortWorkflows,
  STATUS_FILTERS, workflowStateText, type Run, type Workflow,
} from '@/actions/model';
import { editActions, setActionsNotice, useActionsNotice, useDispatchForm, useRuns, useWorkflows, type ActionsRef } from '@/actions/queries';
import { actionStyles, NoticeBar, openGitHubHere, openRun, refParams, RunRow, useNow } from '@/components/actions/parts';
import { usePullRefresh } from '@/components/PullRefresh';
import { openInAppBrowser } from '@/components/pulls/PullRequestWebPage';
import { Sheet, type SheetOption } from '@/components/Sheet';
import { useGitInfo } from '@/git/info-query';
import { carryRepoPatch, chooseRepo, historyRepos, type RepoRef } from '@/git/repo-choice';
import type { Project } from '@/projects/model';
import { useProjectUi } from '@/projects/ui-store';
import { useCapability, useConnection } from '@/store/connection';
import { colors, spacing } from '@/theme';
import { RepoChips } from '../RepoChips';
import { useTabScroll } from '../useTabScroll';

type Menu = { kind: 'workflows' } | { kind: 'status' } | { kind: 'remote' } | { kind: 'run'; run: Run } | { kind: 'workflow'; workflow: Workflow };

/**
 * The Git tab's Actions view, as on the desktop and on GitHub: the runs of
 * every workflow or of one, read by gh on the computer and read again every
 * 30 s while shown. "Workflows" picks a workflow or a Management page; Status
 * and the search box filter (GitHub's qualifiers: is:, branch:, actor:,
 * event:, created:). A run opens on its own screen; its "…" re-runs, cancels
 * or deletes it. A workflow's page has Run workflow and Disable/Enable.
 */
export function ActionsTab({ project, active = true }: { project: Project; active?: boolean }) {
  const pid = project.id;
  const supported = useCapability('get-actions-workflows');
  const online = useConnection((s) => s.status.state === 'online');
  const scroll = useTabScroll(pid, 'actions');
  const [gitRepo, patchUi] = useProjectUi(pid, (ui) => ui.gitRepo);
  const [gitRepos] = useProjectUi(pid, (ui) => ui.gitRepos);
  const [pullRemotes] = useProjectUi(pid, (ui) => ui.pullRemotes);
  const info = useGitInfo(pid, false);
  const known = info.data?.repositories;
  const repositories = useMemo(
    () => historyRepos(known ?? project.folders.map((folder): RepoRef => ({ path: folder.path }))),
    [known, project.folders],
  );
  const repo = chooseRepo(repositories, gitRepo);
  const folder = repo && repo.git !== false ? repo.path : undefined;
  const remote = folder ? pullRemotes?.[folder] : undefined;
  const ref: ActionsRef | null = useMemo(() => (folder ? { projectId: pid, folder, remote } : null), [pid, folder, remote]);

  const [workflowId, setWorkflowId] = useState<number | null>(null);
  const [typed, setTyped] = useState('');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const [menu, setMenu] = useState<Menu | null>(null);
  const notice = useActionsNotice(pid);
  const now = useNow(5_000);

  const workflowsQuery = useWorkflows(ref, supported);
  const listing = workflowsQuery.data;
  const workflows = useMemo(() => (listing?.ok ? sortWorkflows(listing.workflows) : []), [listing]);
  const repoInfo = listing?.ok ? listing.repo : undefined;
  const canWrite = !!repoInfo?.canWrite;
  const remotes = listing?.remotes || [];
  const runs = useRuns(supported ? ref : null, workflowId, query, page, active);
  const answer = runs.data;
  const workflow = workflowId ? workflows.find((w) => w.id === workflowId) ?? null : null;
  const form = useDispatchForm(ref ?? { projectId: pid, folder: '', remote: undefined }, workflowId ?? 0, null, !!ref && !!workflow && !workflow.dynamic && canWrite);
  const dispatch = form.data?.ok ? form.data : null;

  const pull = usePullRefresh(() => (online ? Promise.all([workflowsQuery.refetch(), runs.refetch()]) : undefined));
  const apply = useCallback((text: string) => { setQuery(text.trim()); setPage(1); }, []);
  const chooseWorkflow = (id: number | null) => { setWorkflowId(id); setTyped(''); setQuery(''); setPage(1); };

  // --- Changes ---

  const change = async (busy: string, params: Parameters<typeof editActions>[1]) => {
    if (!ref) return;
    setActionsNotice(pid, { kind: 'busy', text: busy });
    const result = await editActions(ref, params);
    setActionsNotice(pid, result.ok ? { kind: 'ok', text: result.message || 'Done.' } : { kind: 'error', text: result.error || 'GitHub did not do it.' });
  };

  const confirmChange = (title: string, text: string, button: string, destructive: boolean, busy: string, params: Parameters<typeof editActions>[1]) => {
    Alert.alert(title, text, [
      { text: 'Cancel', style: 'cancel' },
      { text: button, style: destructive ? 'destructive' : 'default', onPress: () => change(busy, params) },
    ]);
  };

  const runOption = (run: Run, key: ReturnType<typeof runMenu>[number]): SheetOption => {
    const label = RUN_MENU_LABELS[key];
    const where = `${run.workflow} #${run.number}`;
    switch (key) {
      case 'view-file': return { label, onPress: () => ref && router.push({ pathname: '/actions/file', params: { ...refParams(ref), path: run.path, ref: run.sha, title: run.path.split('/').pop() || 'Workflow file' } }) };
      case 'cancel': return { label, destructive: true, onPress: () => confirmChange(`Cancel ${where}?`, run.title, 'Cancel run', true, `Cancelling ${where}…`, { kind: 'cancel', runId: run.id }) };
      case 'rerun': return { label, onPress: () => confirmChange('Re-run all jobs', `${where}: every job runs again, with the run's commit and ref.`, 'Re-run jobs', false, `Re-running ${where}…`, { kind: 'rerun', runId: run.id, failedOnly: false }) };
      case 'rerun-failed': return { label, onPress: () => confirmChange('Re-run failed jobs', `${where}: the failed jobs and those that need them run again.`, 'Re-run jobs', false, `Re-running ${where}…`, { kind: 'rerun', runId: run.id, failedOnly: true }) };
      case 'approve': return { label, onPress: () => confirmChange('Approve and run', 'This pull request comes from a fork: read its changes before its workflows run with this repository\'s settings.', 'Approve and run', false, 'Approving…', { kind: 'approve-fork', runId: run.id }) };
      case 'web': return { label, onPress: () => openGitHubHere(run.url, where) };
      case 'browser': return { label, onPress: () => openInAppBrowser(run.url) };
      case 'delete': return { label, destructive: true, onPress: () => confirmChange('Delete workflow run?', `Are you sure you want to permanently delete ${where}? This cannot be undone.`, 'Delete', true, `Deleting ${where}…`, { kind: 'delete-run', runId: run.id }) };
      default: return { label, onPress: () => {} };
    }
  };

  const manage = (which: 'caches' | 'deployments' | 'runners') => {
    if (ref) router.push({ pathname: `/actions/${which}`, params: refParams(ref) });
  };

  const menuOptions = (): SheetOption[] | undefined => {
    if (!menu) return undefined;
    if (menu.kind === 'run') return runMenu(menu.run, canWrite).map((key) => runOption(menu.run, key));
    if (menu.kind === 'status') {
      const current = parseQuery(query).is;
      return [
        { label: 'Any status', hint: current ? undefined : 'chosen', onPress: () => { const next = setQualifier(query, 'is', ''); setTyped(next); apply(next); } },
        ...STATUS_FILTERS.map((s) => ({ label: s.label, hint: current === s.value ? 'chosen' : undefined, onPress: () => { const next = setQualifier(query, 'is', s.value); setTyped(next); apply(next); } })),
      ];
    }
    if (menu.kind === 'remote' && folder) {
      return remotes.map((r) => ({ label: `${r.name} · ${r.slug}`, hint: r.name === (listing?.remote || remote) ? 'chosen' : undefined, onPress: () => patchUi({ pullRemotes: { ...(pullRemotes || {}), [folder]: r.name } }) }));
    }
    if (menu.kind === 'workflow') {
      const w = menu.workflow;
      const options: SheetOption[] = [];
      if (!w.dynamic && ref) options.push({ label: 'View workflow file', onPress: () => router.push({ pathname: '/actions/file', params: { ...refParams(ref), path: w.path, ref: repoInfo?.defaultBranch || 'HEAD', title: w.file } }) });
      if (repoInfo) options.push({ label: 'Copy status badge Markdown', onPress: () => { Clipboard.setStringAsync(badgeMarkdown({ name: w.name, host: repoInfo.host, owner: repoInfo.owner, repo: repoInfo.repo, file: w.file })).catch(() => {}); setActionsNotice(pid, { kind: 'ok', text: 'The status badge\'s Markdown is copied.' }); } });
      if (canWrite && !w.dynamic) {
        if (w.state === 'active') options.push({ label: 'Disable workflow', destructive: true, onPress: () => confirmChange('Disable workflow?', `${w.name} stops running on its triggers until it is enabled again.`, 'Disable', true, 'Disabling…', { kind: 'disable', workflowId: w.id }) });
        else options.push({ label: 'Enable workflow', onPress: () => change('Enabling…', { kind: 'enable', workflowId: w.id }) });
      }
      if (repoInfo) options.push({ label: 'Open on GitHub here', onPress: () => openGitHubHere(`https://${repoInfo.host}/${repoInfo.owner}/${repoInfo.repo}/actions/workflows/${encodeURIComponent(w.file)}`, w.name) });
      return options;
    }
    return undefined;
  };

  // --- Drawing ---

  if (!supported && online) {
    return (
      <View style={actionStyles.center}>
        <Text style={actionStyles.emptyTitle}>Update Switchboard Evolution on the computer</Text>
        <Text style={actionStyles.emptyText}>GitHub Actions on this phone needs a newer Switchboard Evolution on the computer. Update it there, then come back.</Text>
      </View>
    );
  }

  const status = parseQuery(query).is;
  const statusLabel = STATUS_FILTERS.find((s) => s.value === status)?.label;
  const currentRemote = remotes.find((r) => r.name === (listing?.remote || remote));
  const header = (
    <View style={styles.header}>
      <View style={styles.toolbar}>
        <View style={actionStyles.flex}>
          <Text style={styles.toolbarTitle}>Actions</Text>
          <Text style={styles.summary} numberOfLines={1}>{repoInfo ? `${repoInfo.nameWithOwner} · ${workflows.length} workflow${workflows.length === 1 ? '' : 's'}` : ' '}</Text>
        </View>
      </View>
      <View style={styles.controls}>
        <Pressable onPress={() => setMenu({ kind: 'workflows' })} style={({ pressed }) => [styles.control, styles.flexShrink, pressed && actionStyles.pressed]} accessibilityRole="button" accessibilityLabel={`Workflow: ${workflow ? workflow.name : 'All workflows'}`}>
          <Ionicons name="git-network-outline" size={14} color={colors.textDim} />
          <Text style={styles.controlText} numberOfLines={1}>{workflow ? workflow.name : 'All workflows'}</Text>
          <Ionicons name="chevron-down" size={13} color={colors.textFaint} />
        </Pressable>
        <Pressable onPress={() => setMenu({ kind: 'status' })} style={({ pressed }) => [styles.control, status && styles.filterOn, pressed && actionStyles.pressed]} accessibilityRole="button" accessibilityLabel={`Status: ${statusLabel || 'any'}`}>
          <Ionicons name={status ? 'funnel' : 'funnel-outline'} size={14} color={status ? colors.accent : colors.textDim} />
          <Text style={[styles.controlText, status && { color: colors.accent }]} numberOfLines={1}>{statusLabel || 'Status'}</Text>
        </Pressable>
        {remotes.length > 1 ? (
          <Pressable onPress={() => setMenu({ kind: 'remote' })} style={({ pressed }) => [styles.control, styles.flexShrink, pressed && actionStyles.pressed]} accessibilityRole="button" accessibilityLabel={`Remote: ${currentRemote ? currentRemote.name : 'choose'}`}>
            <Ionicons name="cloud-outline" size={14} color={colors.textDim} />
            <Text style={styles.controlText} numberOfLines={1}>{currentRemote ? currentRemote.name : 'Remote'}</Text>
          </Pressable>
        ) : null}
      </View>
      <View style={styles.searchRow}>
        <Ionicons name="search" size={14} color={colors.textFaint} />
        <TextInput
          value={typed}
          onChangeText={setTyped}
          onSubmitEditing={() => apply(typed)}
          onEndEditing={() => apply(typed)}
          placeholder="Filter workflow runs (is:failure branch:main)"
          placeholderTextColor={colors.textFaint}
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="search"
          style={styles.searchInput}
          accessibilityLabel="Filter workflow runs"
        />
        {typed ? <Pressable onPress={() => { setTyped(''); apply(''); }} hitSlop={8} accessibilityRole="button" accessibilityLabel="Clear the filter"><Ionicons name="close-circle" size={16} color={colors.textFaint} /></Pressable> : null}
      </View>
      {notice ? <NoticeBar key={`${notice.kind}:${notice.text}`} notice={notice} onClose={() => setActionsNotice(pid, null)} /> : null}
    </View>
  );

  let workflowHead = null;
  if (workflow) {
    const off = workflowStateText(workflow.state);
    workflowHead = (
      <View style={styles.workflowHead}>
        <View style={styles.workflowTitleRow}>
          <View style={actionStyles.flex}>
            <Text style={styles.workflowName}>{workflow.name}</Text>
            <Text style={actionStyles.mono}>{workflow.dynamic ? 'Run by GitHub' : workflow.file}</Text>
          </View>
          {dispatch?.available && canWrite && workflow.state === 'active' ? (
            <Pressable
              onPress={() => ref && router.push({ pathname: '/actions/dispatch', params: { ...refParams(ref), workflowId: String(workflow.id), name: workflow.name } })}
              style={({ pressed }) => [actionStyles.button, actionStyles.primary, pressed && actionStyles.pressed]}
              accessibilityRole="button"
            >
              <Ionicons name="play" size={13} color={colors.accent} />
              <Text style={[actionStyles.buttonText, actionStyles.primaryText]}>Run workflow</Text>
            </Pressable>
          ) : null}
          <Pressable onPress={() => setMenu({ kind: 'workflow', workflow })} hitSlop={6} style={({ pressed }) => [styles.moreIcon, pressed && actionStyles.pressed]} accessibilityRole="button" accessibilityLabel="Workflow options">
            <Ionicons name="ellipsis-horizontal" size={18} color={colors.textDim} />
          </Pressable>
        </View>
        {off && workflow.state !== 'active' ? (
          <View style={actionStyles.banner}>
            <Text style={actionStyles.text}>{workflow.state === 'disabled_inactivity' ? 'This scheduled workflow is disabled because there hasn\'t been activity in this repository for at least 60 days.' : `${off}.`}</Text>
            {canWrite ? <Pressable onPress={() => change('Enabling…', { kind: 'enable', workflowId: workflow.id })} accessibilityRole="button"><Text style={actionStyles.link}>Enable workflow</Text></Pressable> : null}
          </View>
        ) : null}
        {dispatch?.schedule?.length ? <Text style={actionStyles.faint}>Runs on a schedule: {dispatch.schedule.map((s) => `${s.cron}${s.timezone ? ` (${s.timezone})` : ''}`).join(', ')}</Text> : null}
      </View>
    );
  }

  let body;
  if (!repo) {
    body = <View style={actionStyles.loading}><Text style={actionStyles.emptyText}>No folder of this project is attached yet.</Text></View>;
  } else if (!folder) {
    body = <View style={actionStyles.loading}><Text style={actionStyles.emptyTitle}>Not a Git repository</Text><Text style={actionStyles.emptyText}>{repo.path}</Text></View>;
  } else if (listing && !listing.ok) {
    body = (
      <View style={actionStyles.loading}>
        <Text style={actionStyles.emptyTitle}>{errorTitle(listing.code)}</Text>
        <Text style={actionStyles.emptyText}>{listing.code === 'no-github-remote' ? 'GitHub Actions is shown for repositories on GitHub, and this one has no GitHub remote.' : listing.error || 'Not connected to the computer.'}</Text>
        <Pressable onPress={() => workflowsQuery.refetch()} accessibilityRole="button"><Text style={actionStyles.link}>Try again</Text></Pressable>
      </View>
    );
  } else if (!answer || runs.isLoading) {
    body = <View style={actionStyles.loading}><ActivityIndicator color={colors.accent} /><Text style={actionStyles.emptyText}>Reading workflow runs…</Text></View>;
  } else if (!answer.ok) {
    body = (
      <View style={actionStyles.loading}>
        <Text style={actionStyles.emptyTitle}>{errorTitle(answer.code)}</Text>
        <Text style={actionStyles.emptyText}>{answer.error || 'The workflow runs could not be read.'}</Text>
        <Pressable onPress={() => runs.refetch()} accessibilityRole="button"><Text style={actionStyles.link}>Try again</Text></Pressable>
      </View>
    );
  } else {
    const parsed = parseQuery(query);
    const filtered = Object.keys(parsed).some((k) => k !== 'text' && (parsed as Record<string, string>)[k]);
    const words = parsed.text.toLowerCase();
    const shown = words ? answer.runs.filter((run) => `${run.title} ${run.workflow} ${run.branch} ${run.actor} #${run.number}`.toLowerCase().includes(words)) : answer.runs;
    const pages = Math.max(1, Math.ceil(Math.min(answer.total, 25_000) / 25));
    body = (
      <>
        <View style={styles.countRow}>
          <Text style={styles.count}>{countText(answer.total, filtered)}</Text>
          {query ? <Pressable onPress={() => { setTyped(''); apply(''); }} accessibilityRole="button"><Text style={actionStyles.link}>Clear filter</Text></Pressable> : null}
        </View>
        {answer.notice ? <Text style={[actionStyles.emptyText, styles.pad]}>{answer.notice}</Text> : null}
        {shown.length ? (
          <View style={styles.rows}>
            {shown.map((run) => <RunRow key={run.id} run={run} now={now} onPress={(r) => ref && openRun(ref, r.id, r.title)} onMore={(r) => setMenu({ kind: 'run', run: r })} />)}
          </View>
        ) : <Text style={[actionStyles.emptyText, styles.pad]}>{query ? 'No results matched your search.' : 'There are no workflow runs yet.'}</Text>}
        {pages > 1 ? (
          <View style={styles.pager}>
            <Pressable onPress={() => setPage(Math.max(1, page - 1))} disabled={page <= 1} style={({ pressed }) => [actionStyles.button, pressed && actionStyles.pressed, page <= 1 && styles.off]} accessibilityRole="button"><Text style={actionStyles.buttonText}>Previous</Text></Pressable>
            <Text style={actionStyles.faint}>Page {page} of {pages > 999 ? '1000+' : pages}</Text>
            <Pressable onPress={() => setPage(page + 1)} disabled={page >= pages} style={({ pressed }) => [actionStyles.button, pressed && actionStyles.pressed, page >= pages && styles.off]} accessibilityRole="button"><Text style={actionStyles.buttonText}>Next</Text></Pressable>
          </View>
        ) : null}
        <Text style={styles.footer}>Tap a run for its jobs, graph, annotations and logs; “…” re-runs, cancels or deletes it. The list reads GitHub again every 30 seconds; pull down to read it now.</Text>
      </>
    );
  }

  const workflowsSheet = menu?.kind === 'workflows' ? (
    <>
      <SheetRow label="All workflows" chosen={!workflowId} icon="git-network-outline" onPress={() => { chooseWorkflow(null); setMenu(null); }} />
      {workflows.map((w) => (
        <SheetRow key={w.id} label={w.name} hint={workflowStateText(w.state) ? 'Disabled' : undefined} chosen={w.id === workflowId} onPress={() => { chooseWorkflow(w.id); setMenu(null); }} />
      ))}
      <Text style={styles.sheetHead}>Management</Text>
      <SheetRow label="Caches" icon="albums-outline" onPress={() => { setMenu(null); manage('caches'); }} />
      <SheetRow label="Deployments" icon="rocket-outline" onPress={() => { setMenu(null); manage('deployments'); }} />
      <SheetRow label="Runners" icon="server-outline" onPress={() => { setMenu(null); manage('runners'); }} />
      {repoInfo ? (['attestations', 'usageMetrics', 'performanceMetrics'] as const).map((key) => (
        <SheetRow key={key} label={`${GITHUB_PAGES[key].label} ↗`} icon={key === 'attestations' ? 'shield-checkmark-outline' : key === 'usageMetrics' ? 'bar-chart-outline' : 'speedometer-outline'} onPress={() => { setMenu(null); openGitHubHere(githubPage(repoInfo, key) || '', GITHUB_PAGES[key].label); }} />
      )) : null}
      {repoInfo && listing?.ok && listing.lockfile ? <SheetRow label="Lockfile ↗" icon="lock-closed-outline" onPress={() => { setMenu(null); openGitHubHere(`https://${repoInfo.host}/${repoInfo.owner}/${repoInfo.repo}/blob/${repoInfo.defaultBranch || 'HEAD'}/.github/workflows/actions.lock`, 'actions.lock'); }} /> : null}
    </>
  ) : null;

  const sheetTitle = menu?.kind === 'run' ? `${menu.run.workflow} #${menu.run.number}` : menu?.kind === 'status' ? 'Filter by status' : menu?.kind === 'remote' ? 'Whose workflows are shown' : menu?.kind === 'workflow' ? menu.workflow.name : menu?.kind === 'workflows' ? 'Workflows' : undefined;

  return (
    <View style={actionStyles.screen}>
      <RepoChips repos={repositories} selected={repo?.path ?? null} onSelect={(path) => { patchUi(carryRepoPatch({ gitRepo, gitRepos }, path)); chooseWorkflow(null); }} />
      {header}
      <ScrollView {...scroll} refreshControl={pull} keyboardShouldPersistTaps="handled">
        {workflowHead}
        {body}
      </ScrollView>
      <Sheet visible={!!menu} title={sheetTitle} options={menu?.kind === 'workflows' ? undefined : menuOptions()} onClose={() => setMenu(null)}>
        {workflowsSheet}
      </Sheet>
    </View>
  );
}

function SheetRow({ label, hint, chosen, icon, onPress }: { label: string; hint?: string; chosen?: boolean; icon?: keyof typeof Ionicons.glyphMap; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.sheetRow, pressed && actionStyles.pressed]} accessibilityRole="button" accessibilityState={{ selected: !!chosen }}>
      {icon ? <Ionicons name={icon} size={17} color={colors.textDim} /> : <View style={styles.sheetIndent} />}
      <Text style={[styles.sheetLabel, chosen && { color: colors.accent }]} numberOfLines={1}>{label}</Text>
      {hint ? <Text style={styles.sheetHint}>{hint}</Text> : null}
      {chosen ? <Ionicons name="checkmark" size={17} color={colors.accent} /> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  header: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border, paddingBottom: spacing.sm },
  toolbar: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.lg, minHeight: 48 },
  toolbarTitle: { color: colors.textDim, fontSize: 12.5, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5 },
  summary: { color: colors.textFaint, fontSize: 12, marginTop: 2 },
  controls: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.lg },
  control: { flexDirection: 'row', alignItems: 'center', gap: 5, height: 36, paddingHorizontal: spacing.sm + 2, borderRadius: 8, borderWidth: 1, borderColor: colors.border },
  controlText: { color: colors.textDim, fontSize: 12.5, flexShrink: 1 },
  flexShrink: { flexShrink: 1 },
  filterOn: { borderColor: colors.accent, backgroundColor: 'rgba(128,136,255,0.12)' },
  searchRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginHorizontal: spacing.lg, marginTop: spacing.sm, paddingHorizontal: spacing.sm + 2, height: 38, borderRadius: 8, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  searchInput: { flex: 1, color: colors.text, fontSize: 14, paddingVertical: 0 },
  workflowHead: { paddingHorizontal: spacing.lg, paddingTop: spacing.md, gap: spacing.sm },
  workflowTitleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  workflowName: { color: colors.text, fontSize: 17, fontWeight: '700' },
  moreIcon: { width: 40, height: 36, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  countRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: spacing.sm },
  count: { color: colors.textDim, fontSize: 13, fontWeight: '600' },
  rows: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  pad: { padding: spacing.lg },
  pager: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.md, padding: spacing.md },
  off: { opacity: 0.4 },
  footer: { color: colors.textFaint, fontSize: 12, lineHeight: 17, padding: spacing.lg },
  sheetHead: { color: colors.textFaint, fontSize: 11.5, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5, paddingHorizontal: spacing.xl, paddingTop: spacing.md, paddingBottom: spacing.xs },
  sheetRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.xl, paddingVertical: 12, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  sheetIndent: { width: 17 },
  sheetLabel: { flex: 1, color: colors.text, fontSize: 16 },
  sheetHint: { color: colors.textFaint, fontSize: 12 },
});
