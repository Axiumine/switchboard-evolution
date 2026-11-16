import Ionicons from '@expo/vector-icons/Ionicons';
import { useQuery } from '@tanstack/react-query';
import * as Clipboard from 'expo-clipboard';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { Sheet, type SheetOption } from '@/components/Sheet';
import { TextPrompt } from '@/components/TextPrompt';
import type { Project } from '@/projects/model';
import { useOpenSession } from '@/projects/open-session';
import { relativeTime, sessionTitle, type Session } from '@/sessions/model';
import { request, useCapability, useConnection } from '@/store/connection';
import { colors, spacing } from '@/theme';
import {
  folderFor, plural, prunedText, rowPath, shortPath, SORT_ORDERS, summaryText, toggleGroup, visibleRepositories, worktreeBadges, worktreeLabel,
  type Badge, type PrunePreview, type SortOrder, type Worktree, type WorktreeRepository,
} from '@/worktrees/model';
import {
  ask, patchCachedSettings, runAction, setNotice, SLOW_TIMEOUT_MS, startInWorktree, useNotice, useProjectWorktrees, useRunningByWorktree, type Notice,
} from '@/worktrees/queries';
import { useTabScroll } from '../useTabScroll';

type Harness = { id: string; label: string; enabled: boolean };

/** Which sheet is open: a worktree's, its sessions', a repository's, which repository, or the order. */
type Menu =
  | { kind: 'row'; repo: WorktreeRepository; wt: Worktree }
  | { kind: 'session'; wt: Worktree }
  | { kind: 'repo'; repo: WorktreeRepository }
  | { kind: 'pick'; then: 'merged' | 'prune' }
  | { kind: 'sort' };

const MONO = 'Menlo';

const BADGE_COLORS: Record<Badge['tone'], { color: string; background: string }> = {
  kind: { color: colors.textDim, background: 'rgba(255,255,255,0.06)' },
  project: { color: '#b4b8ff', background: 'rgba(128,136,255,0.16)' },
  plain: { color: colors.textDim, background: 'rgba(255,255,255,0.06)' },
  locked: { color: colors.attention, background: 'rgba(224,160,80,0.14)' },
  missing: { color: colors.danger, background: 'rgba(224,108,117,0.14)' },
};

/**
 * The Git tab's Worktrees view. Every git worktree of the project's
 * repositories, grouped by repository, as
 * on the desktop: create, start a session in, attach, lock, move, repair,
 * prune and remove them. Tapping a worktree offers its actions; the + on its
 * row starts a session there.
 */
export function WorktreesTab({ project, active = true }: { project: Project; active?: boolean }) {
  const pid = project.id;
  const openInTab = useOpenSession();
  const scroll = useTabScroll(pid, 'worktrees');
  const supported = useCapability('get-project-worktrees');
  const online = useConnection((s) => s.status.state === 'online');
  const listing = useProjectWorktrees(supported ? pid : undefined);
  const notice = useNotice(pid);
  const [query, setQuery] = useState('');
  const [menu, setMenu] = useState<Menu | null>(null);
  const [locking, setLocking] = useState<Worktree | null>(null);
  const harnesses = useQuery({ queryKey: ['harnesses'], queryFn: () => request<Harness[]>('get-harnesses'), enabled: online });

  // Read again each time the tab comes on screen, as the desktop does, and back
  // from a screen (a session, the Git Graph) where worktrees may have changed.
  // A read already under way is joined, not started over.
  const { refetch } = listing;
  useFocusEffect(useCallback(() => { if (active && online && supported) refetch({ cancelRefetch: false }); }, [active, online, supported, refetch]));

  const repositories = listing.data?.repositories;
  const settings = listing.data?.settings;
  const homeDir = listing.data?.homeDir || '';
  const order: SortOrder = settings?.sortOrder || 'default';
  const collapsed = settings?.collapsedGroups || [];
  const running = useRunningByWorktree(repositories);
  const groups = useMemo(() => visibleRepositories(repositories || [], query, order), [repositories, query, order]);
  const usable = (repositories || []).filter((repo) => !repo.error);
  const clis = (harnesses.data || []).filter((h) => h.enabled);

  // --- Actions ---

  const saveSettings = (patch: Parameters<typeof patchCachedSettings>[1]) => {
    patchCachedSettings(pid, patch);
    ask('set-worktree-settings', [pid, patch]).then((result) => {
      if (!result.ok) setNotice(pid, { kind: 'error', text: result.error || 'Could not save the worktree settings.' });
    });
  };

  const copyPath = (path: string) => {
    Clipboard.setStringAsync(path).catch(() => {});
    setNotice(pid, { kind: 'ok', text: `Copied ${path}` });
  };

  const start = (wt: Worktree, runtime: string) => {
    startInWorktree(pid, wt.path, runtime, (id) => openInTab(id, 'terminal')).catch((err: any) => Alert.alert('Could not start the session', err?.message || String(err)));
  };

  const openSession = (session: Session) => openInTab(session.sessionId);

  const configure = (wt: Worktree, runtime: string) => router.push({ pathname: '/new', params: { worktree: wt.path, projectId: pid, runtime } });

  const attach = (wt: Worktree) => runAction(pid, `Attaching ${worktreeLabel(wt)}…`, () => ask('worktree-attach', [pid, wt.path]), `Attached ${worktreeLabel(wt)} to the project`);

  const detach = (repo: WorktreeRepository, wt: Worktree) => {
    const go = () => runAction(pid, `Detaching ${worktreeLabel(wt)}…`, () => ask('worktree-detach', [pid, wt.path]), `Detached ${worktreeLabel(wt)}; the folder stays`);
    // The repository was found through this folder: once detached it may leave the tab.
    if (!wt.isMain || repo.nested) { go(); return; }
    Alert.alert(`Detach ${repo.name} from the project?`, 'The folder and its worktrees stay on disk. They stop showing here unless another attached folder holds the repository.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Detach', onPress: go },
    ]);
  };

  const unlock = (wt: Worktree) => runAction(pid, `Unlocking ${worktreeLabel(wt)}…`, () => ask('worktree-unlock', [pid, wt.path]), `Unlocked ${worktreeLabel(wt)}`);

  const lock = (wt: Worktree, reason: string) => runAction(pid, `Locking ${worktreeLabel(wt)}…`, () => ask('worktree-lock', [pid, wt.path, reason]), `Locked ${worktreeLabel(wt)}`);

  const repair = (repo: WorktreeRepository, paths: string[]) => runAction(
    pid,
    `Repairing ${paths.length ? worktreeLabel({ path: paths[0] }) : repo.name}…`,
    () => ask('worktree-repair', [pid, repo.mainPath, paths], SLOW_TIMEOUT_MS),
    (result) => (result.output ? 'Repaired' : 'Nothing to repair'),
  );

  const prune = async (repo: WorktreeRepository) => {
    setNotice(pid, { kind: 'busy', text: `Checking what to prune in ${repo.name}…` });
    const preview = await ask<PrunePreview & { error?: string }>('worktree-prune-preview', [pid, repo.mainPath]);
    if (!preview.ok) { setNotice(pid, { kind: 'error', text: preview.error || 'Could not check what to prune.' }); return; }
    const stale = preview.staleFolders || [];
    if (!preview.worktrees.length && !stale.length) { setNotice(pid, { kind: 'ok', text: `Nothing to prune in ${repo.name}` }); return; }
    setNotice(pid, null);
    const lines = preview.worktrees.map((item) => `• ${shortPath(item.path, homeDir)}${item.branch ? ` · ${item.branch}` : ''}${item.reason ? ` · ${item.reason}` : ''}`);
    const message = [
      lines.length
        ? `Git still has a record of ${lines.length === 1 ? 'this worktree' : 'these worktrees'}, but the folder is gone. Pruning drops the record; branches stay.\n\n${lines.join('\n')}`
        : 'Git has nothing to prune.',
      stale.length ? `\n${plural(stale.length, 'project folder')} no longer ${stale.length === 1 ? 'exists' : 'exist'}: ${stale.map((f) => shortPath(f.path, homeDir)).join(', ')}` : '',
    ].join('');
    const go = (detachStale: boolean) => runAction(
      pid, `Pruning ${repo.name}…`,
      () => ask<{ ok?: boolean; error?: string; pruned: number; detached: number }>('worktree-prune', [pid, repo.mainPath, { detachStale }], SLOW_TIMEOUT_MS),
      prunedText,
    );
    Alert.alert(`Prune ${repo.name}?`, message, [
      { text: 'Cancel', style: 'cancel' },
      ...(stale.length ? [{ text: `Prune and detach ${stale.length === 1 ? 'it' : 'them'}`, onPress: () => go(true) }] : []),
      { text: stale.length ? 'Only prune' : 'Prune', onPress: () => go(false) },
    ]);
  };

  /** One repository: go; several: ask which first. */
  const pickRepository = (then: 'merged' | 'prune') => {
    if (usable.length === 1) doForRepository(then, usable[0]);
    else setMenu({ kind: 'pick', then });
  };
  const doForRepository = (then: 'merged' | 'prune', repo: WorktreeRepository) => {
    if (then === 'prune') prune(repo);
    else router.push({ pathname: '/worktrees/merged', params: { projectId: pid, repo: repo.mainPath } });
  };

  const create = (repo: WorktreeRepository | null) => router.push({ pathname: '/worktrees/new', params: { projectId: pid, ...(repo ? { repo: repo.mainPath } : {}) } });

  const notAttached = (what: string) => () => Alert.alert(`Attach it first`, `${what} shows the project's folders. Attach this worktree to the project to see it there.`);

  // --- Sheets ---

  const sessionOptions = (wt: Worktree): SheetOption[] => {
    const list = clis.length ? clis : [{ id: 'claude', label: 'Claude' }];
    return [
      ...list.map((cli) => ({ label: cli.label, hint: 'a new session in this worktree', onPress: () => start(wt, cli.id) })),
      { label: 'Terminal', hint: 'a terminal in this worktree', onPress: () => start(wt, 'terminal') },
      ...list.map((cli) => ({ label: `${cli.label}, configure…`, onPress: () => configure(wt, cli.id) })),
    ];
  };

  const rowOptions = (repo: WorktreeRepository, wt: Worktree): SheetOption[] => {
    const options: SheetOption[] = [];
    for (const session of running.get(wt.path) || []) {
      options.push({ label: `Open “${sessionTitle(session)}”`, hint: 'running here', onPress: () => openSession(session) });
    }
    if (wt.exists) options.push({ label: 'New session…', hint: 'Claude, Codex or a terminal here', onPress: () => setMenu({ kind: 'session', wt }) });
    options.push({ label: 'Copy path', hint: shortPath(wt.path, homeDir), onPress: () => copyPath(wt.path) });
    const folder = folderFor(project.folders, wt);
    options.push(folder
      ? { label: 'Show in Git', onPress: () => router.push({ pathname: '/git', params: { projectId: pid, title: project.name } }) }
      : { label: 'Show in Git', hint: 'attach it first', onPress: notAttached('Git') });
    options.push(folder
      ? { label: 'Show in the Git Graph', onPress: () => router.push({ pathname: '/graph', params: { projectId: pid, folder: folder.path } }) }
      : { label: 'Show in the Git Graph', hint: 'attach it first', onPress: notAttached('The Git Graph') });
    if (wt.attached) options.push({ label: 'Detach from project', hint: 'keeps the folder', onPress: () => detach(repo, wt) });
    else if (wt.exists) options.push({ label: 'Attach to project', hint: 'listed with its folders, added to its new sessions', onPress: () => attach(wt) });
    if (wt.isMain) return options;
    options.push(wt.locked
      ? { label: 'Unlock', hint: wt.lockReason ? `Locked: ${wt.lockReason}` : undefined, onPress: () => unlock(wt) }
      : { label: 'Lock…', hint: 'not pruned, moved or removed until unlocked', onPress: () => setLocking(wt) });
    if (wt.exists) {
      options.push(wt.locked
        ? { label: 'Move…', hint: 'unlock it first', onPress: () => Alert.alert('Unlock it first', 'Git does not move a locked worktree.') }
        : { label: 'Move…', onPress: () => router.push({ pathname: '/worktrees/folder', params: { projectId: pid, action: 'move', path: wt.path } }) });
    }
    options.push({ label: 'Repair', hint: 'reconnect it with its repository', onPress: () => repair(repo, [wt.path]) });
    options.push({
      label: wt.exists ? 'Remove…' : 'Remove record…', destructive: true,
      onPress: () => router.push({ pathname: '/worktrees/remove', params: { projectId: pid, path: wt.path } }),
    });
    return options;
  };

  const repoOptions = (repo: WorktreeRepository): SheetOption[] => [
    ...(repo.error ? [] : [
      { label: 'New worktree…', onPress: () => create(repo) },
      { label: 'Remove merged…', hint: 'the worktrees whose branch is merged', onPress: () => doForRepository('merged', repo) },
      { label: 'Prune…', hint: 'drop the records of worktrees whose folder is gone', onPress: () => prune(repo) },
      { label: 'Repair all', onPress: () => repair(repo, []) },
      { label: 'Repair a moved folder…', onPress: () => router.push({ pathname: '/worktrees/folder', params: { projectId: pid, action: 'repair', repo: repo.mainPath } }) },
    ]),
    { label: 'Copy path', hint: shortPath(repo.mainPath, homeDir), onPress: () => copyPath(repo.mainPath) },
  ];

  const menuTitle = !menu ? '' : menu.kind === 'row' ? worktreeLabel(menu.wt)
    : menu.kind === 'session' ? `New session in ${worktreeLabel(menu.wt)}`
    : menu.kind === 'repo' ? menu.repo.name
    : menu.kind === 'pick' ? 'Repository'
    : 'Sort worktrees';
  const menuOptions = (): SheetOption[] => {
    if (!menu) return [];
    if (menu.kind === 'row') return rowOptions(menu.repo, menu.wt);
    if (menu.kind === 'session') return sessionOptions(menu.wt);
    if (menu.kind === 'repo') return repoOptions(menu.repo);
    if (menu.kind === 'pick') {
      const then = menu.then;
      return usable.map((repo) => ({ label: repo.name, hint: shortPath(repo.mainPath, homeDir), onPress: () => doForRepository(then, repo) }));
    }
    return SORT_ORDERS.map((item) => ({ label: item.label, hint: item.key === order ? 'chosen' : undefined, onPress: () => saveSettings({ sortOrder: item.key }) }));
  };

  // --- Drawing ---

  if (!supported && online) {
    return (
      <View style={styles.center}>
        <Text style={styles.emptyTitle}>Update Switchboard on the computer</Text>
        <Text style={styles.emptyText}>Managing worktrees from this phone needs a newer Switchboard on the computer. Update it there, then come back.</Text>
      </View>
    );
  }

  const header = (
    <View style={styles.header}>
      <View style={styles.toolbar}>
        <View style={styles.flex}>
          <Text style={styles.toolbarTitle}>Worktrees</Text>
          <Text style={styles.summary} numberOfLines={1}>{repositories ? summaryText(repositories) : ' '}</Text>
        </View>
        <ToolButton icon="add" label="New worktree" onPress={() => create(null)} disabled={!usable.length} primary />
        <ToolButton icon="git-merge-outline" label="Remove merged" onPress={() => pickRepository('merged')} disabled={!usable.length} />
        <ToolButton icon="cut-outline" label="Prune" onPress={() => pickRepository('prune')} disabled={!usable.length} />
        <ToolButton icon="options-outline" label="Worktree settings" onPress={() => router.push({ pathname: '/worktrees/settings', params: { projectId: pid } })} disabled={!repositories} />
      </View>
      <View style={styles.searchRow}>
        <View style={styles.search}>
          <Ionicons name="search" size={15} color={colors.textFaint} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Filter by branch, folder or kind"
            placeholderTextColor={colors.textFaint}
            autoCapitalize="none"
            autoCorrect={false}
            clearButtonMode="while-editing"
            style={styles.searchInput}
          />
        </View>
        <Pressable onPress={() => setMenu({ kind: 'sort' })} style={({ pressed }) => [styles.sort, pressed && styles.pressed]} accessibilityRole="button" accessibilityLabel={`Sort: ${SORT_ORDERS.find((s) => s.key === order)?.label}`}>
          <Ionicons name="swap-vertical" size={15} color={colors.textDim} />
          <Text style={styles.sortText} numberOfLines={1}>{SORT_ORDERS.find((s) => s.key === order)?.label}</Text>
        </Pressable>
      </View>
      {notice ? <NoticeBar key={`${notice.kind}:${notice.text}`} notice={notice} onClose={() => setNotice(pid, null)} /> : null}
    </View>
  );

  let body;
  if (listing.isLoading || (!listing.data && !listing.error && online)) {
    body = <View style={styles.loading}><ActivityIndicator color={colors.accent} /><Text style={styles.emptyText}>Reading worktrees…</Text></View>;
  } else if (!repositories) {
    body = (
      <View style={styles.emptyBox}>
        <Text style={styles.emptyTitle}>Worktrees unavailable</Text>
        <Text style={styles.emptyText}>{(listing.error as Error | null)?.message || 'Not connected to the computer.'}</Text>
      </View>
    );
  } else if (!repositories.length) {
    body = (
      <View style={styles.emptyBox}>
        <Text style={styles.emptyTitle}>No repositories in this project</Text>
        <Text style={styles.emptyText}>Attach a folder that is a git repository, or holds some, to manage its worktrees here.</Text>
        <Pressable onPress={() => router.push({ pathname: '/folders', params: { projectId: pid } })} accessibilityRole="button">
          <Text style={styles.link}>Attach a folder…</Text>
        </Pressable>
      </View>
    );
  } else if (!groups.length) {
    body = <View style={styles.emptyBox}><Text style={styles.emptyTitle}>Nothing matches “{query}”</Text></View>;
  } else {
    body = groups.map(({ repo, worktrees }) => {
      const closed = collapsed.includes(repo.id) && !query;
      return (
        <View key={repo.id} style={styles.repo}>
          <View style={styles.repoHead}>
            <Pressable
              onPress={() => saveSettings({ collapsedGroups: toggleGroup(collapsed, repo.id) })}
              style={styles.repoToggle}
              accessibilityRole="button"
              accessibilityState={{ expanded: !closed }}
              accessibilityLabel={`${repo.name}, ${closed ? 'show' : 'hide'} its worktrees`}
            >
              <Ionicons name={closed ? 'chevron-forward' : 'chevron-down'} size={13} color={colors.textFaint} />
              <View style={styles.flex}>
                <Text style={styles.repoName} numberOfLines={1}>{repo.name}</Text>
                <Text style={styles.repoPath} numberOfLines={1}>{shortPath(repo.mainPath, homeDir)} · {plural((repo.worktrees || []).length, 'worktree')}</Text>
              </View>
            </Pressable>
            {repo.error ? null : <ToolButton icon="add" label={`New worktree in ${repo.name}`} onPress={() => create(repo)} />}
            <ToolButton icon="ellipsis-horizontal" label={`More for ${repo.name}`} onPress={() => setMenu({ kind: 'repo', repo })} />
          </View>
          {closed ? null : repo.error ? <Text style={styles.repoError}>{repo.error}</Text> : worktrees.map((wt) => (
            <WorktreeRow
              key={wt.path}
              wt={wt}
              path={rowPath(wt, repo, homeDir)}
              live={running.get(wt.path) || []}
              onPress={() => setMenu({ kind: 'row', repo, wt })}
              onSession={() => setMenu({ kind: 'session', wt })}
            />
          ))}
        </View>
      );
    });
  }

  return (
    <View style={styles.screen}>
      {header}
      <ScrollView
        {...scroll}
        keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={listing.isRefetching} onRefresh={() => { if (online) refetch({ cancelRefetch: false }); }} tintColor={colors.accent} />}
      >
        {body}
        {repositories?.length ? <Text style={styles.footer}>Tap a worktree for its actions; + starts a session in it. Pull down to read them again.</Text> : null}
      </ScrollView>

      <Sheet visible={!!menu} title={menuTitle} options={menuOptions()} onClose={() => setMenu(null)} />
      <TextPrompt
        visible={!!locking}
        title={locking ? `Lock ${worktreeLabel(locking)}` : ''}
        message="A locked worktree is not pruned, moved or removed until you unlock it. Useful for one on a removable drive or a network share. Reason (optional):"
        placeholder="on the USB drive"
        confirm="Lock"
        onClose={() => setLocking(null)}
        onSubmit={(reason) => { if (locking) lock(locking, reason.slice(0, 200)); }}
      />
    </View>
  );
}

function WorktreeRow({ wt, path, live, onPress, onSession }: { wt: Worktree; path: string; live: Session[]; onPress: () => void; onSession: () => void }) {
  const badges = worktreeBadges(wt);
  const status: { text: string; color: string }[] = [];
  if (wt.exists && !wt.bare) {
    if (wt.dirty === true) status.push({ text: 'Changes', color: colors.attention });
    else if (wt.dirty === false) status.push({ text: 'Clean', color: colors.running });
    if (wt.ahead) status.push({ text: `↑${wt.ahead}`, color: colors.textDim });
    if (wt.behind) status.push({ text: `↓${wt.behind}`, color: colors.textDim });
    if (wt.lastCommit?.time) status.push({ text: relativeTime(new Date(wt.lastCommit.time).toISOString()), color: colors.textFaint });
  }
  const label = worktreeLabel(wt);
  return (
    <Pressable
      onPress={onPress}
      onLongPress={onPress}
      style={({ pressed }) => [styles.row, !wt.exists && styles.rowMissing, pressed && styles.pressed]}
      accessibilityRole="button"
      accessibilityLabel={[label, ...badges.map((b) => b.label), ...status.map((s) => s.text), live.length ? `${live.length} running` : ''].filter(Boolean).join(', ')}
    >
      <Ionicons name={wt.isMain ? 'folder-outline' : 'git-branch-outline'} size={16} color={wt.isMain ? colors.accent : colors.textDim} style={styles.rowIcon} />
      <View style={styles.flex}>
        <View style={styles.rowLine}>
          <Text style={[styles.rowLabel, wt.detached && styles.mono]} numberOfLines={1}>{label}</Text>
          {badges.map((badge) => (
            <View key={badge.label} style={[styles.badge, { backgroundColor: BADGE_COLORS[badge.tone].background }]}>
              {badge.tone === 'locked' ? <Ionicons name="lock-closed" size={9} color={BADGE_COLORS.locked.color} /> : null}
              <Text style={[styles.badgeText, { color: BADGE_COLORS[badge.tone].color }]}>{badge.label}</Text>
            </View>
          ))}
        </View>
        <Text style={styles.rowPath} numberOfLines={1} ellipsizeMode="head">{path}</Text>
        {status.length || live.length ? (
          <View style={styles.rowStatus}>
            {status.map((s) => <Text key={s.text} style={[styles.statusText, { color: s.color }]}>{s.text}</Text>)}
            {live.length ? <View style={styles.live}><Text style={styles.liveText}>{live.length} running</Text></View> : null}
          </View>
        ) : null}
        {wt.locked && wt.lockReason ? <Text style={styles.lockReason} numberOfLines={1}>Locked: {wt.lockReason}</Text> : null}
      </View>
      {wt.exists ? (
        <Pressable onPress={onSession} hitSlop={6} style={({ pressed }) => [styles.rowButton, pressed && styles.pressedButton]} accessibilityRole="button" accessibilityLabel={`New session in ${label}`}>
          <Ionicons name="add" size={18} color={colors.accent} />
        </Pressable>
      ) : null}
    </Pressable>
  );
}

function NoticeBar({ notice, onClose }: { notice: Notice; onClose: () => void }) {
  const [open, setOpen] = useState(false);
  const tone = notice.kind === 'error' ? colors.danger : notice.kind === 'ok' ? colors.running : colors.accent;
  return (
    <View style={[styles.notice, { borderLeftColor: tone }]} accessibilityRole="alert" accessibilityLiveRegion="polite">
      <View style={styles.noticeLine}>
        {notice.kind === 'busy' ? <ActivityIndicator size="small" color={colors.accent} /> : null}
        <Text style={styles.noticeText}>{notice.text}</Text>
        {notice.kind === 'busy' ? null : (
          <Pressable onPress={onClose} hitSlop={10} accessibilityRole="button" accessibilityLabel="Dismiss">
            <Ionicons name="close" size={16} color={colors.textFaint} />
          </Pressable>
        )}
      </View>
      {notice.output ? (
        <>
          <Pressable onPress={() => setOpen(!open)} accessibilityRole="button" accessibilityState={{ expanded: open }}>
            <Text style={styles.outputToggle}>{open ? 'Hide output' : 'Output'}</Text>
          </Pressable>
          {open ? <ScrollView horizontal style={styles.output}><Text style={styles.outputText} selectable>{notice.output}</Text></ScrollView> : null}
        </>
      ) : null}
    </View>
  );
}

function ToolButton({ icon, label, onPress, disabled, primary }: { icon: keyof typeof Ionicons.glyphMap; label: string; onPress: () => void; disabled?: boolean; primary?: boolean }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      hitSlop={4}
      style={({ pressed }) => [styles.tool, primary && styles.toolPrimary, pressed && styles.pressedButton, disabled && { opacity: 0.4 }]}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
    >
      <Ionicons name={icon} size={18} color={primary ? colors.accent : colors.textDim} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  flex: { flex: 1, minWidth: 0 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl, gap: spacing.sm },
  header: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border, paddingBottom: spacing.sm },
  toolbar: { flexDirection: 'row', alignItems: 'center', gap: 2, paddingLeft: spacing.lg, paddingRight: spacing.sm, minHeight: 52 },
  toolbarTitle: { color: colors.textDim, fontSize: 12.5, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5 },
  summary: { color: colors.textFaint, fontSize: 12, marginTop: 2 },
  tool: { width: 40, height: 40, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  toolPrimary: { backgroundColor: 'rgba(128,136,255,0.14)' },
  searchRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.lg },
  search: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: colors.surface, borderRadius: 8, paddingHorizontal: spacing.md, height: 38 },
  searchInput: { flex: 1, color: colors.text, fontSize: 14, paddingVertical: 0 },
  sort: { flexDirection: 'row', alignItems: 'center', gap: 4, height: 38, paddingHorizontal: spacing.sm, borderRadius: 8, borderWidth: 1, borderColor: colors.border, maxWidth: 140 },
  sortText: { color: colors.textDim, fontSize: 12.5, flexShrink: 1 },
  notice: { marginHorizontal: spacing.lg, marginTop: spacing.sm, padding: spacing.sm, paddingLeft: spacing.md, borderRadius: 8, backgroundColor: colors.surface, borderLeftWidth: 3, gap: 4 },
  noticeLine: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  noticeText: { flex: 1, color: colors.text, fontSize: 13, lineHeight: 18 },
  outputToggle: { color: colors.accent, fontSize: 13 },
  output: { maxHeight: 180, backgroundColor: colors.background, borderRadius: 6, padding: spacing.sm },
  outputText: { color: colors.textDim, fontFamily: MONO, fontSize: 11.5 },
  loading: { alignItems: 'center', gap: spacing.sm, padding: spacing.xl },
  emptyBox: { alignItems: 'center', gap: spacing.sm, padding: spacing.xl },
  emptyTitle: { color: colors.text, fontSize: 15, fontWeight: '600', textAlign: 'center' },
  emptyText: { color: colors.textFaint, fontSize: 13, lineHeight: 18, textAlign: 'center' },
  link: { color: colors.accent, fontSize: 14, paddingVertical: spacing.sm },
  repo: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border, paddingBottom: spacing.xs },
  repoHead: { flexDirection: 'row', alignItems: 'center', paddingLeft: spacing.md, paddingRight: spacing.sm, paddingTop: spacing.sm },
  repoToggle: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: 44, minWidth: 0 },
  repoName: { color: colors.text, fontSize: 15, fontWeight: '600' },
  repoPath: { color: colors.textFaint, fontSize: 11.5, fontFamily: MONO },
  repoError: { color: colors.danger, fontSize: 13, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm, paddingLeft: spacing.lg + 6, paddingRight: spacing.sm, paddingVertical: spacing.sm, minHeight: 52 },
  rowMissing: { opacity: 0.6 },
  rowIcon: { marginTop: 2 },
  rowLine: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 6 },
  rowLabel: { color: colors.text, fontSize: 15, flexShrink: 1 },
  mono: { fontFamily: MONO, fontSize: 13.5 },
  rowPath: { color: colors.textFaint, fontSize: 11.5, fontFamily: MONO, marginTop: 2 },
  rowStatus: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: spacing.sm, marginTop: 4 },
  statusText: { fontSize: 12 },
  lockReason: { color: colors.attention, fontSize: 11.5, marginTop: 2 },
  badge: { flexDirection: 'row', alignItems: 'center', gap: 3, paddingHorizontal: 6, paddingVertical: 1, borderRadius: 4 },
  badgeText: { fontSize: 10.5, fontWeight: '600' },
  live: { paddingHorizontal: 6, paddingVertical: 1, borderRadius: 8, backgroundColor: 'rgba(76,175,143,0.16)' },
  liveText: { color: colors.running, fontSize: 11, fontWeight: '600' },
  rowButton: { width: 40, height: 40, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  pressed: { backgroundColor: colors.surface },
  pressedButton: { backgroundColor: colors.raised },
  footer: { color: colors.textFaint, fontSize: 12, lineHeight: 17, padding: spacing.lg },
});
