import Ionicons from '@expo/vector-icons/Ionicons';
import { router, useFocusEffect } from 'expo-router';
import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import * as Clipboard from 'expo-clipboard';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { mono } from '@/components/git/diff-style';
import { usePullRefresh } from '@/components/PullRefresh';
import { PullRequestFiles } from '@/components/pulls/PullRequestFiles';
import { openInAppBrowser } from '@/components/pulls/PullRequestWebPage';
import { Sheet, type SheetOption } from '@/components/Sheet';
import { useGitInfo } from '@/git/info-query';
import { chooseRepo, historyRepos, type RepoRef } from '@/git/repo-choice';
import type { Project } from '@/projects/model';
import { useProjectUi } from '@/projects/ui-store';
import {
  ACTION_COPY, badges, canEdit, DEFAULT_FILTER, emptyText, errorTitle, filterLabel, isDefaultFilter, mergeBlock,
  inAppWebUrl, mergeLists, pagedWords, pageStates, PR_FILTERS, prStatus, rowMenu, summaryText, toggleFilter, webUrl, whenText,
  type Badge, type ConfirmAction, type PrFilterKey, type PrStatus, type PullRequest, type PullRequestRepo,
} from '@/pulls/model';
import {
  runPullRequestAction, setPullNotice, useOpenPullRequests, usePagedPullRequests, usePullNotice, type Notice,
} from '@/pulls/queries';
import { openPullRequestWindow, windowActionLabel } from '@/pulls/web';
import { relativeTime } from '@/sessions/model';
import { useCapability, useConnection } from '@/store/connection';
import { colors, spacing } from '@/theme';
import { useCanOpenWindows } from '@/windows/open';
import { RepoChips } from '../RepoChips';
import { useTabScroll } from '../useTabScroll';

const STATE_ICONS: Record<PrStatus, { name: keyof typeof Ionicons.glyphMap; color: string; label: string }> = {
  open: { name: 'git-pull-request', color: colors.running, label: 'Open' },
  draft: { name: 'git-pull-request-outline', color: colors.textDim, label: 'Draft' },
  closed: { name: 'close-circle-outline', color: colors.danger, label: 'Closed' },
  merged: { name: 'git-merge', color: '#b48cf0', label: 'Merged' },
};

const BADGE_COLORS: Record<Badge['tone'], { color: string; background: string }> = {
  draft: { color: colors.textDim, background: 'rgba(255,255,255,0.07)' },
  bad: { color: colors.danger, background: 'rgba(224,108,117,0.14)' },
  good: { color: colors.running, background: 'rgba(76,175,143,0.14)' },
  warn: { color: colors.attention, background: 'rgba(224,160,80,0.14)' },
};

type Menu = { kind: 'filter' } | { kind: 'remote' } | { kind: 'row'; pr: PullRequest };

const STALE_MS = 60_000;

/**
 * The Git tab's Pull Requests view, as on the desktop: the pull requests of
 * the chosen repository on GitHub, read by gh on the computer. Every open one
 * is listed, drafts too; Closed and Merged join 10 at a time from the filter.
 * Tapping a row shows its changed files and their diffs. Merge opens a screen
 * to choose how; the "…" has Convert to draft or Ready for review, and Close.
 * Each of them asks first.
 */
export function PullRequestsTab({ project, active = true }: { project: Project; active?: boolean }) {
  const pid = project.id;
  const supported = useCapability('get-pull-requests');
  // A newer desktop shows an open pull request as GitHub does, on a screen of its own, and takes every change.
  const detailed = useCapability('get-pull-request-conversation');
  const editable = useCapability('edit-pull-request');
  const online = useConnection((s) => s.status.state === 'online');
  const scroll = useTabScroll(pid, 'pulls');
  const [gitRepo, patchUi] = useProjectUi(pid, (ui) => ui.gitRepo);
  const [pullRemotes] = useProjectUi(pid, (ui) => ui.pullRemotes);
  // The repositories are read by Changes too: use what is cached. Until they arrive, the project's folders stand in.
  const info = useGitInfo(pid, false);
  const known = info.data?.repositories;
  const repositories = useMemo(
    () => historyRepos(known ?? project.folders.map((folder): RepoRef => ({ path: folder.path }))),
    [known, project.folders],
  );
  const repo = chooseRepo(repositories, gitRepo);
  const folder = repo && repo.git !== false ? repo.path : undefined;
  const remote = folder ? pullRemotes?.[folder] : undefined;
  // Which pull requests to show, as the desktop's filter: not saved.
  const [filter, setFilter] = useState<PrFilterKey[]>([...DEFAULT_FILTER]);
  const states = useMemo(() => pageStates(filter), [filter]);
  const [menu, setMenu] = useState<Menu | null>(null);
  const notice = usePullNotice(pid);

  const open = useOpenPullRequests(pid, folder, remote, supported);
  const listing = open.data;
  const paged = usePagedPullRequests(pid, folder, remote, states, supported && !!listing?.ok);
  const pages = paged.data?.pages;
  const lastPage = pages?.[pages.length - 1];
  const pageItems = useMemo(() => (pages || []).flatMap((page) => page.items || []), [pages]);
  const items = useMemo(() => mergeLists(listing?.items || [], states.length ? pageItems : [], filter), [listing?.items, pageItems, states.length, filter]);
  const repoInfo = listing?.repo;
  const remotes = listing?.remotes || [];

  // Shown again after a while (or back from the merge screen): read again.
  const { refetch, dataUpdatedAt } = open;
  useFocusEffect(useCallback(() => {
    if (active && online && supported && folder && Date.now() - dataUpdatedAt > STALE_MS) refetch({ cancelRefetch: false });
  }, [active, online, supported, folder, dataUpdatedAt, refetch]));
  const pull = usePullRefresh(() => (online ? Promise.all([refetch(), states.length ? paged.refetch() : null]) : undefined));

  // --- Actions ---

  const run = async (pr: PullRequest, action: ConfirmAction) => {
    if (!folder) return;
    setPullNotice(pid, { kind: 'busy', text: `${ACTION_COPY[action].title}: #${pr.number}…` });
    const answer = await runPullRequestAction(pid, folder, remote, { number: pr.number, action });
    setPullNotice(pid, answer.ok ? { kind: 'ok', text: answer.message || 'Done.' } : { kind: 'error', text: answer.error || 'GitHub did not do it.' });
  };

  const confirm = (pr: PullRequest, action: ConfirmAction) => {
    if (!canEdit(pr, repoInfo)) {
      Alert.alert(ACTION_COPY[action].title, 'Your GitHub account cannot change this pull request.');
      return;
    }
    const copy = ACTION_COPY[action];
    Alert.alert(copy.title, `#${pr.number} ${pr.title}\n${pr.head} → ${pr.base}\n\n${copy.text}`, [
      { text: 'Cancel', style: 'cancel' },
      { text: copy.confirm, style: copy.destructive ? 'destructive' : 'default', onPress: () => run(pr, action) },
    ]);
  };

  const merge = (pr: PullRequest) => {
    const block = mergeBlock(pr, repoInfo);
    if (block) { Alert.alert('Merge', block); return; }
    if (!folder) return;
    router.push({ pathname: '/pulls/merge', params: { projectId: pid, folder, number: String(pr.number), remote: remote ?? '' } });
  };

  const openDetail = (pr: PullRequest) => {
    if (!folder) return;
    router.push({ pathname: '/pulls/[number]', params: { number: String(pr.number), projectId: pid, folder, remote: remote ?? '', title: pr.title } });
  };

  const changeBase = (pr: PullRequest) => {
    if (!folder) return;
    if (!canEdit(pr, repoInfo)) { Alert.alert('Change base', 'Your GitHub account cannot change this pull request.'); return; }
    router.push({ pathname: '/pulls/base', params: { projectId: pid, folder, remote: remote ?? '', number: String(pr.number), id: pr.id ?? '', head: pr.head, base: pr.base } });
  };

  const menuOptions = (): SheetOption[] => {
    if (menu?.kind === 'row') {
      const pr = menu.pr;
      return rowMenu(pr, { canChangeBase: editable && !!pr.id }).map((key) => (key === 'base'
        ? { label: 'Change base…', onPress: () => changeBase(pr) }
        : { label: ACTION_COPY[key].menu, destructive: ACTION_COPY[key].destructive, onPress: () => confirm(pr, key) }));
    }
    if (menu?.kind === 'remote' && folder) {
      const current = listing?.remote || remote;
      return remotes.map((r) => ({
        label: `${r.name} · ${r.slug}`,
        hint: r.name === current ? 'chosen' : undefined,
        onPress: () => patchUi({ pullRemotes: { ...(pullRemotes || {}), [folder]: r.name } }),
      }));
    }
    return [];
  };
  const menuTitle = menu?.kind === 'row' ? `#${menu.pr.number} ${menu.pr.title}` : menu?.kind === 'remote' ? 'Whose pull requests are listed' : menu?.kind === 'filter' ? 'Show pull requests' : undefined;

  // --- Drawing ---

  if (!supported && online) {
    return (
      <View style={styles.center}>
        <Text style={styles.emptyTitle}>Update Switchboard Evolution on the computer</Text>
        <Text style={styles.emptyText}>Pull requests on this phone need a newer Switchboard Evolution on the computer. Update it there, then come back.</Text>
      </View>
    );
  }

  const currentRemote = remotes.find((r) => r.name === (listing?.remote || remote));
  const header = (
    <View style={styles.header}>
      <View style={styles.toolbar}>
        <View style={styles.flex}>
          <Text style={styles.toolbarTitle}>Pull requests</Text>
          <Text style={styles.summary} numberOfLines={1}>{summaryText(listing) || ' '}</Text>
        </View>
      </View>
      <View style={styles.controls}>
        {remotes.length > 1 ? (
          <Pressable onPress={() => setMenu({ kind: 'remote' })} style={({ pressed }) => [styles.control, styles.flexShrink, pressed && styles.pressed]} accessibilityRole="button" accessibilityLabel={`Remote: ${currentRemote ? `${currentRemote.name}, ${currentRemote.slug}` : 'choose'}`}>
            <Ionicons name="cloud-outline" size={14} color={colors.textDim} />
            <Text style={styles.controlText} numberOfLines={1}>{currentRemote ? `${currentRemote.name} · ${currentRemote.slug}` : 'Remote'}</Text>
            <Ionicons name="chevron-down" size={13} color={colors.textFaint} />
          </Pressable>
        ) : null}
        <Pressable
          onPress={() => setMenu({ kind: 'filter' })}
          style={({ pressed }) => [styles.control, !isDefaultFilter(filter) && styles.filterOn, pressed && styles.pressed]}
          accessibilityRole="button"
          accessibilityLabel={`Show: ${filterLabel(filter)}`}
        >
          <Ionicons name={isDefaultFilter(filter) ? 'funnel-outline' : 'funnel'} size={14} color={isDefaultFilter(filter) ? colors.textDim : colors.accent} />
          <Text style={[styles.controlText, !isDefaultFilter(filter) && styles.filterOnText]} numberOfLines={1}>{filterLabel(filter)}</Text>
        </Pressable>
      </View>
      {notice ? <NoticeBar key={`${notice.kind}:${notice.text}`} notice={notice} onClose={() => setPullNotice(pid, null)} /> : null}
    </View>
  );

  let body;
  if (!repo) {
    body = <View style={styles.emptyBox}><Text style={styles.emptyText}>No folder of this project is attached yet.</Text></View>;
  } else if (!folder) {
    body = <View style={styles.emptyBox}><Text style={styles.emptyTitle}>Not a Git repository</Text><Text style={styles.emptyText}>{repo.path}</Text></View>;
  } else if (open.isLoading || (!listing && online)) {
    body = <View style={styles.loading}><ActivityIndicator color={colors.accent} /><Text style={styles.emptyText}>Reading pull requests…</Text></View>;
  } else if (!listing?.ok) {
    body = (
      <View style={styles.emptyBox}>
        <Text style={styles.emptyTitle}>{errorTitle(listing?.code)}</Text>
        <Text style={styles.emptyText}>
          {listing?.code === 'no-github-remote'
            ? 'Pull requests are listed for repositories on GitHub, and this one has no GitHub remote.'
            : listing?.error || 'Not connected to the computer.'}
        </Text>
        <Pressable onPress={() => refetch()} accessibilityRole="button"><Text style={styles.link}>Try again</Text></Pressable>
      </View>
    );
  } else {
    const waiting = states.length > 0 && paged.isLoading;
    body = (
      <>
        {items.length ? (
          <View style={styles.rows}>
            {items.map((pr) => (
              <PullRequestRow
                // Its open state belongs to one repository and remote: another one starts closed.
                key={`${folder}|${remote ?? ''}#${pr.number}`}
                pr={pr}
                repo={repoInfo}
                projectId={pid}
                folder={folder}
                remote={remote}
                onMerge={merge}
                onMore={(item) => setMenu({ kind: 'row', pr: item })}
                onOpen={detailed ? openDetail : undefined}
              />
            ))}
          </View>
        ) : waiting ? null : <View style={styles.emptyBox}><Text style={styles.emptyTitle}>{emptyText(filter)}</Text></View>}
        {listing.truncated ? <Text style={styles.footer}>Only the newest 1000 open pull requests are listed.</Text> : null}
        {states.length ? (
          <View style={styles.pageFooter}>
            {paged.isLoading ? (
              <><ActivityIndicator size="small" color={colors.accent} /><Text style={styles.footerText}>Reading {pagedWords(states)} pull requests…</Text></>
            ) : paged.error ? (
              <>
                <Text style={[styles.footerText, { color: colors.danger }]}>{(paged.error as Error).message}</Text>
                <Pressable onPress={() => paged.refetch()} accessibilityRole="button"><Text style={styles.link}>Try again</Text></Pressable>
              </>
            ) : lastPage ? (
              <>
                <Text style={styles.footerText}>{pageItems.length} of {lastPage.totalCount || 0} {pagedWords(states)} shown</Text>
                {paged.hasNextPage ? (
                  <Pressable
                    onPress={() => paged.fetchNextPage()}
                    disabled={paged.isFetchingNextPage}
                    style={({ pressed }) => [styles.moreButton, pressed && styles.pressed, paged.isFetchingNextPage && { opacity: 0.5 }]}
                    accessibilityRole="button"
                  >
                    <Text style={styles.moreText}>{paged.isFetchingNextPage ? 'Loading…' : 'Load 10 more'}</Text>
                  </Pressable>
                ) : null}
              </>
            ) : null}
          </View>
        ) : null}
        <Text style={styles.footer}>
          {detailed
            ? 'Tap a pull request for its conversation, commits, checks and files. Merge asks how; “…” converts it to a draft, marks it ready, changes its base, closes or reopens it. Pull down to read them again.'
            : 'Tap a pull request for its files and diffs. Merge asks how; “…” converts it to a draft, marks it ready or closes it. Pull down to read them again.'}
        </Text>
      </>
    );
  }

  return (
    <View style={styles.screen}>
      <RepoChips repos={repositories} selected={repo?.path ?? null} onSelect={(path) => patchUi({ gitRepo: path })} />
      {header}
      <ScrollView {...scroll} refreshControl={pull}>
        {body}
      </ScrollView>

      <Sheet visible={!!menu} title={menuTitle} options={menu?.kind === 'filter' ? undefined : menuOptions()} onClose={() => setMenu(null)}>
        {menu?.kind === 'filter' ? (
          <>
            {PR_FILTERS.map(({ key, label }) => {
              const on = filter.includes(key);
              const last = on && filter.length === 1;
              const icon = STATE_ICONS[key];
              return (
                <Pressable
                  key={key}
                  onPress={() => setFilter(toggleFilter(filter, key))}
                  disabled={last}
                  style={({ pressed }) => [styles.filterRow, pressed && styles.pressed]}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: on, disabled: last }}
                >
                  <Ionicons name={on ? 'checkbox' : 'square-outline'} size={20} color={on ? colors.accent : colors.textDim} style={last && { opacity: 0.5 }} />
                  <Ionicons name={icon.name} size={16} color={icon.color} />
                  <Text style={styles.filterLabel}>{label}</Text>
                </Pressable>
              );
            })}
            {isDefaultFilter(filter) ? null : (
              <Pressable onPress={() => setFilter([...DEFAULT_FILTER])} style={({ pressed }) => [styles.filterRow, pressed && styles.pressed]} accessibilityRole="button">
                <Text style={styles.link}>Open and draft only</Text>
              </Pressable>
            )}
          </>
        ) : null}
      </Sheet>
    </View>
  );
}

/**
 * The icons before Merge, on every pull request with a web address, closed and
 * merged ones too, as on the desktop: Copy the address, Open here (a sheet with
 * the page), Open in a window of its own (where windows sit side by side, else
 * full screen), and the browser inside the app. The page shows in the app only
 * over https; without it, Copy and the browser only.
 */
function PullRequestLinkTools({ pr }: { pr: PullRequest }) {
  const canOpenWindows = useCanOpenWindows();
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return undefined;
    const timer = setTimeout(() => setCopied(false), 1200);
    return () => clearTimeout(timer);
  }, [copied]);
  const url = webUrl(pr);
  if (!url) return null;
  const inside = inAppWebUrl(url);
  const title = `#${pr.number} ${pr.title}`;
  const tool = (icon: keyof typeof Ionicons.glyphMap, label: string, onPress: () => void, tint?: string) => (
    <Pressable
      key={label}
      onPress={onPress}
      hitSlop={2}
      style={({ pressed }) => [styles.linkTool, pressed && styles.pressedButton]}
      accessibilityRole="button"
      accessibilityLabel={`${label}, pull request ${pr.number}`}
      accessibilityHint={label === 'Copy the address' ? url : undefined}
    >
      <Ionicons name={icon} size={17} color={tint ?? colors.textDim} />
    </Pressable>
  );
  return (
    <View style={styles.linkTools}>
      {tool(copied ? 'checkmark' : 'link-outline', 'Copy the address', () => {
        Clipboard.setStringAsync(url).catch(() => {});
        setCopied(true);
      }, copied ? colors.running : undefined)}
      {inside ? tool('browsers-outline', 'Open here', () => router.push({ pathname: '/pulls/web', params: { url: inside, title } })) : null}
      {inside ? tool('open-outline', windowActionLabel(canOpenWindows), () => openPullRequestWindow(inside, title, canOpenWindows)) : null}
      {tool('globe-outline', 'Open in the browser', () => openInAppBrowser(url))}
    </View>
  );
}

const PullRequestRow = memo(function PullRequestRow({ pr, repo, projectId, folder, remote, onMerge, onMore, onOpen }: {
  pr: PullRequest; repo: PullRequestRepo | undefined; projectId: string; folder: string; remote: string | undefined;
  onMerge: (pr: PullRequest) => void; onMore: (pr: PullRequest) => void;
  /** Open it on a screen of its own (a newer desktop); without it the row opens on its files. */
  onOpen?: (pr: PullRequest) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const status = prStatus(pr);
  const icon = STATE_ICONS[status];
  const block = mergeBlock(pr, repo);
  const linkTools = <PullRequestLinkTools pr={pr} />;
  return (
    <View style={styles.item}>
      <Pressable
        onPress={() => (onOpen ? onOpen(pr) : setExpanded(!expanded))}
        style={({ pressed }) => [styles.row, expanded && styles.rowOpen, pressed && styles.pressed]}
        accessibilityRole="button"
        accessibilityState={onOpen ? undefined : { expanded }}
        accessibilityLabel={`${icon.label} pull request ${pr.number}, ${pr.title}`}
      >
        <Ionicons name={!onOpen && expanded ? 'chevron-down' : 'chevron-forward'} size={13} color={colors.textFaint} style={styles.rowChevron} />
        <Ionicons name={icon.name} size={17} color={icon.color} style={styles.rowIcon} />
        <View style={styles.flex}>
          <Text style={styles.title} numberOfLines={2}>{pr.title}</Text>
          <View style={styles.badges}>
            {badges(pr).map((badge) => (
              <View key={badge.text} style={[styles.badge, { backgroundColor: BADGE_COLORS[badge.tone].background }]}>
                <Text style={[styles.badgeText, { color: BADGE_COLORS[badge.tone].color }]}>{badge.text}</Text>
              </View>
            ))}
          </View>
          <Text style={styles.meta} numberOfLines={1}>#{pr.number} · {whenText(pr, (iso) => relativeTime(iso))} by {pr.author}</Text>
          <Text style={styles.branches} numberOfLines={1}>{pr.head} → {pr.base}</Text>
          <Text style={styles.meta}>
            <Text style={styles.add}>+{pr.additions}</Text> <Text style={styles.del}>−{pr.deletions}</Text> · {pr.changedFiles} file{pr.changedFiles === 1 ? '' : 's'}
          </Text>
        </View>
        {pr.state === 'OPEN' ? (
          <View style={styles.rowActions}>
            {linkTools}
            <Pressable
              onPress={() => onMerge(pr)}
              style={({ pressed }) => [styles.mergeButton, block && styles.mergeOff, pressed && styles.pressedButton]}
              accessibilityRole="button"
              accessibilityLabel={block ? `Merge is off: ${block}` : `Merge pull request ${pr.number}`}
            >
              <Ionicons name="git-merge" size={14} color={block ? colors.textFaint : colors.accent} />
              <Text style={[styles.mergeText, block && { color: colors.textFaint }]}>Merge</Text>
            </Pressable>
            <Pressable onPress={() => onMore(pr)} hitSlop={4} style={({ pressed }) => [styles.moreIcon, pressed && styles.pressedButton]} accessibilityRole="button" accessibilityLabel={`More for pull request ${pr.number}`}>
              <Ionicons name="ellipsis-horizontal" size={18} color={colors.textDim} />
            </Pressable>
          </View>
        ) : pr.state === 'CLOSED' || webUrl(pr) ? (
          <View style={styles.rowActions}>
            {linkTools}
            {/* A closed one can be reopened. */}
            {pr.state === 'CLOSED' ? (
              <Pressable onPress={() => onMore(pr)} hitSlop={4} style={({ pressed }) => [styles.moreIcon, pressed && styles.pressedButton]} accessibilityRole="button" accessibilityLabel={`More for pull request ${pr.number}`}>
                <Ionicons name="ellipsis-horizontal" size={18} color={colors.textDim} />
              </Pressable>
            ) : null}
          </View>
        ) : null}
      </Pressable>
      {!onOpen && expanded ? <PullRequestFiles projectId={projectId} folder={folder} remote={remote} number={pr.number} headOid={pr.headOid} /> : null}
    </View>
  );
});

function NoticeBar({ notice, onClose }: { notice: Notice; onClose: () => void }) {
  const tone = notice.kind === 'error' ? colors.danger : notice.kind === 'ok' ? colors.running : colors.accent;
  return (
    <View style={[styles.notice, { borderLeftColor: tone }]} accessibilityRole="alert" accessibilityLiveRegion="polite">
      {notice.kind === 'busy' ? <ActivityIndicator size="small" color={colors.accent} /> : null}
      <Text style={styles.noticeText}>{notice.text}</Text>
      {notice.kind === 'busy' ? null : (
        <Pressable onPress={onClose} hitSlop={10} accessibilityRole="button" accessibilityLabel="Dismiss">
          <Ionicons name="close" size={16} color={colors.textFaint} />
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  flex: { flex: 1, minWidth: 0 },
  flexShrink: { flexShrink: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl, gap: spacing.sm },
  header: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border, paddingBottom: spacing.sm },
  toolbar: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.lg, minHeight: 48 },
  toolbarTitle: { color: colors.textDim, fontSize: 12.5, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5 },
  summary: { color: colors.textFaint, fontSize: 12, marginTop: 2 },
  controls: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.lg },
  control: { flexDirection: 'row', alignItems: 'center', gap: 5, height: 36, paddingHorizontal: spacing.sm + 2, borderRadius: 8, borderWidth: 1, borderColor: colors.border },
  controlText: { color: colors.textDim, fontSize: 12.5, flexShrink: 1 },
  filterOn: { borderColor: colors.accent, backgroundColor: 'rgba(128,136,255,0.12)' },
  filterOnText: { color: colors.accent },
  notice: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginHorizontal: spacing.lg, marginTop: spacing.sm, padding: spacing.sm, paddingLeft: spacing.md, borderRadius: 8, backgroundColor: colors.surface, borderLeftWidth: 3 },
  noticeText: { flex: 1, color: colors.text, fontSize: 13, lineHeight: 18 },
  loading: { alignItems: 'center', gap: spacing.sm, padding: spacing.xl },
  emptyBox: { alignItems: 'center', gap: spacing.sm, padding: spacing.xl },
  emptyTitle: { color: colors.text, fontSize: 15, fontWeight: '600', textAlign: 'center' },
  emptyText: { color: colors.textFaint, fontSize: 13, lineHeight: 18, textAlign: 'center' },
  link: { color: colors.accent, fontSize: 14, paddingVertical: spacing.sm },
  rows: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  item: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm, paddingLeft: spacing.md, paddingRight: spacing.sm, paddingVertical: spacing.md },
  rowOpen: { backgroundColor: 'rgba(128,136,255,0.06)' },
  rowChevron: { marginTop: 4 },
  rowIcon: { marginTop: 1 },
  title: { color: colors.text, fontSize: 15, fontWeight: '600', lineHeight: 20 },
  badges: { flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginTop: 4 },
  badge: { paddingHorizontal: 6, paddingVertical: 1, borderRadius: 4 },
  badgeText: { fontSize: 10.5, fontWeight: '600' },
  meta: { color: colors.textFaint, fontSize: 12, marginTop: 3 },
  branches: { color: '#9aa0e0', fontSize: 11.5, fontFamily: mono, marginTop: 3 },
  add: { color: colors.running },
  del: { color: colors.danger },
  rowActions: { alignItems: 'flex-end', gap: spacing.sm },
  linkTools: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  linkTool: { width: 32, height: 32, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  mergeButton: { flexDirection: 'row', alignItems: 'center', gap: 4, height: 34, paddingHorizontal: spacing.sm + 2, borderRadius: 8, borderWidth: 1, borderColor: 'rgba(128,136,255,0.4)', backgroundColor: 'rgba(128,136,255,0.12)' },
  mergeOff: { borderColor: colors.border, backgroundColor: 'transparent' },
  mergeText: { color: colors.accent, fontSize: 13, fontWeight: '600' },
  moreIcon: { width: 40, height: 34, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  pageFooter: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: spacing.sm, paddingHorizontal: spacing.lg, paddingVertical: spacing.md },
  footerText: { color: colors.textFaint, fontSize: 12.5, flexShrink: 1 },
  moreButton: { marginLeft: 'auto', height: 34, paddingHorizontal: spacing.md, borderRadius: 8, borderWidth: 1, borderColor: colors.border, justifyContent: 'center' },
  moreText: { color: colors.accent, fontSize: 13, fontWeight: '600' },
  footer: { color: colors.textFaint, fontSize: 12, lineHeight: 17, padding: spacing.lg },
  filterRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.xl, paddingVertical: 12, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  filterLabel: { color: colors.text, fontSize: 16 },
  pressed: { backgroundColor: colors.surface },
  pressedButton: { backgroundColor: colors.raised },
});
