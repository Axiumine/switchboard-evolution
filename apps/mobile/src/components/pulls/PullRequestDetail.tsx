import Ionicons from '@expo/vector-icons/Ionicons';
import * as Clipboard from 'expo-clipboard';
import { router } from 'expo-router';
import { memo, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { create } from 'zustand';

import { ChatMarkdown } from '@/components/chat/ChatMarkdown';
import { LINE_STYLES, mono } from '@/components/git/diff-style';
import { usePullRefresh } from '@/components/PullRefresh';
import { CommitFiles, PullRequestFiles } from '@/components/pulls/PullRequestFiles';
import { openInAppBrowser } from '@/components/pulls/PullRequestWebPage';
import { Sheet, type SheetOption } from '@/components/Sheet';
import { TextPrompt } from '@/components/TextPrompt';
import { diffLines } from '@/git/model';
import { useAreaWidth } from '@/layout/size';
import {
  ACTION_COPY, badges, canEdit, checkDuration, checkFinishedJob, checkGroups, checksSummaryText, commentType, commitDays, DETAIL_TABS, detailCounts,
  eventText, HIDE_REASONS, hunkTail, labelColor, logLines, mergeBlock, messageActions, messageVerb, prStatus, quoteText, REACTIONS, statusRows,
  timelineBlocks, titleProblem, toggleReaction, webUrl,
  type Check, type CheckBucket, type ConfirmAction, type DetailTab, type Message, type PullRequestHead, type ReactionContent,
  type ReviewThread, type TimelineCommit, type TimelineEvent,
} from '@/pulls/model';
import {
  editPullRequest, patchConversationMessage, reloadPullRequestDetail, reloadPullRequestTab, runPullRequestAction, setPullDraft,
  setPullNotice, setViewedState, useChecks, useCommits, useConversation, useJobLog, useOpenPullRequests, usePullNotice, useViewed, type PullRef,
} from '@/pulls/queries';
import { relativeTime } from '@/sessions/model';
import { useConnection } from '@/store/connection';
import { colors, spacing } from '@/theme';

/** The tab last chosen, for every pull request, while the app runs: the conversation at first, as on GitHub. */
const useDetailTab = create<{ tab: DetailTab }>(() => ({ tab: 'conversation' }));

const STATE_ICONS = {
  open: { name: 'git-pull-request' as const, color: colors.running, label: 'Open' },
  draft: { name: 'git-pull-request-outline' as const, color: colors.textDim, label: 'Draft' },
  closed: { name: 'close-circle-outline' as const, color: colors.danger, label: 'Closed' },
  merged: { name: 'git-merge' as const, color: '#b48cf0', label: 'Merged' },
};

const TONES = { good: colors.running, bad: colors.danger, warn: colors.attention, muted: colors.textFaint };
const BUCKET_ICONS: Record<CheckBucket, { name: keyof typeof Ionicons.glyphMap; color: string }> = {
  pass: { name: 'checkmark-circle', color: colors.running },
  fail: { name: 'close-circle', color: colors.danger },
  pending: { name: 'time-outline', color: colors.attention },
  skipped: { name: 'remove-circle-outline', color: colors.textFaint },
  cancelled: { name: 'stop-circle-outline', color: colors.textFaint },
};

type Menu =
  | { kind: 'more' }
  | { kind: 'message'; message: Message }
  | { kind: 'react'; message: Message }
  | { kind: 'hide'; message: Message };

function routeParams(ref: PullRef) {
  return { projectId: ref.projectId, folder: ref.folder, remote: ref.remote ?? '', number: String(ref.number) };
}

/**
 * An open pull request as GitHub's page shows it: its title (a pencil edits it
 * where GitHub allows), Merge and Review changes, and four tabs:
 * Conversation (with the sidebar, every message and what may be done with it),
 * Commits, Checks (logs and re-runs) and Files changed (with Viewed).
 */
export function PullRequestDetail({ pullRef, title }: { pullRef: PullRef; title?: string }) {
  const online = useConnection((s) => s.status.state === 'online');
  const tab = useDetailTab((s) => s.tab);
  const [visited, setVisited] = useState<ReadonlySet<DetailTab>>(() => new Set([tab, 'conversation']));
  const [menu, setMenu] = useState<Menu | null>(null);
  const [editingTitle, setEditingTitle] = useState(false);
  const notice = usePullNotice(pullRef.projectId);

  const conversation = useConversation(pullRef);
  const pages = conversation.data?.pages;
  const head = pages?.[0]?.pr;
  const commits = useCommits(pullRef, visited.has('commits'));
  const checks = useChecks(pullRef, visited.has('checks'));
  const viewed = useViewed(pullRef, visited.has('files'));
  const listing = useOpenPullRequests(pullRef.projectId, pullRef.folder, pullRef.remote);
  const item = listing.data?.items?.find((pr) => pr.number === pullRef.number);
  const repo = listing.data?.repo;

  const pull = usePullRefresh(() => (online ? Promise.all([reloadPullRequestDetail(pullRef), listing.refetch()]) : undefined));

  const choose = (next: DetailTab) => {
    useDetailTab.setState({ tab: next });
    setVisited((previous) => new Set([...previous, next]));
  };

  const notify = (kind: 'ok' | 'error', text: string) => setPullNotice(pullRef.projectId, { kind, text });

  const saveTitle = async (text: string) => {
    if (!head) return;
    const problem = titleProblem(text);
    if (problem) { notify('error', problem); return; }
    if (text.trim() === head.title) return;
    const answer = await editPullRequest(pullRef, { kind: 'title', pullRequestId: head.id, title: text.trim() });
    notify(answer.ok ? 'ok' : 'error', answer.ok ? (answer.message || 'Title saved.') : (answer.error || 'GitHub did not take the title.'));
  };

  const runAction = (action: ConfirmAction) => {
    if (!head) return;
    const copy = ACTION_COPY[action];
    Alert.alert(copy.title, `#${head.number} ${head.title}\n${head.head} → ${head.base}\n\n${copy.text}`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: copy.confirm,
        style: copy.destructive ? 'destructive' : 'default',
        onPress: async () => {
          const answer = await runPullRequestAction(pullRef.projectId, pullRef.folder, pullRef.remote, { number: head.number, action });
          notify(answer.ok ? 'ok' : 'error', answer.ok ? (answer.message || 'Done.') : (answer.error || 'GitHub did not do it.'));
          reloadPullRequestDetail(pullRef).catch(() => {});
        },
      },
    ]);
  };

  const openEditor = (params: Record<string, string>, draftKey: string, text: string | null) => {
    if (text !== null) setPullDraft(draftKey, text);
    router.push({ pathname: '/pulls/edit', params: { ...routeParams(pullRef), draftKey, pullRequestId: head?.id ?? '', ...params } });
  };

  const react = (message: Message, content: ReactionContent) => {
    if (!message.can.react) return;
    const mine = message.reactions.some((r) => r.content === content && r.mine);
    patchConversationMessage(pullRef, message.id, (m) => ({ ...m, reactions: toggleReaction(m.reactions, content) }));
    editPullRequest(pullRef, { kind: mine ? 'unreact' : 'react', subjectId: message.id, content }).then((answer) => {
      if (answer.ok) return;
      notify('error', answer.error || 'GitHub did not take the reaction.');
      reloadPullRequestTab(pullRef, 'pull-request-conversation').catch(() => {});
    });
  };

  const messageMenu = (message: Message): SheetOption[] => messageActions(message).map((action): SheetOption => {
    switch (action) {
      case 'copy': return { label: 'Copy link', onPress: () => { Clipboard.setStringAsync(message.url).catch(() => {}); } };
      case 'quote': {
        const thread = message.kind === 'review-comment' ? (pages?.[0]?.threads || []).find((t) => t.comments.some((c) => c.id === message.id)) : undefined;
        return thread?.can.reply
          ? { label: 'Quote reply', onPress: () => openEditor({ mode: 'reply', threadId: thread.id }, `reply:${thread.id}`, quoteText(message.body)) }
          : { label: 'Quote reply', onPress: () => openEditor({ mode: 'comment', close: head?.can.close ? '1' : '', reopen: head?.can.reopen ? '1' : '' }, `composer:${pullRef.number}`, quoteText(message.body)) };
      }
      case 'edit': return message.kind === 'description'
        ? { label: 'Edit description', onPress: () => openEditor({ mode: 'description' }, `edit:description:${pullRef.number}`, message.body) }
        : { label: 'Edit', onPress: () => openEditor({ mode: 'edit', id: message.id, type: commentType(message) }, `edit:${message.id}`, message.body) };
      case 'hide': return { label: 'Hide…', onPress: () => setTimeout(() => setMenu({ kind: 'hide', message }), 300) };
      case 'unhide': return {
        label: 'Unhide',
        onPress: async () => {
          const answer = await editPullRequest(pullRef, { kind: 'comment-unhide', id: message.id });
          notify(answer.ok ? 'ok' : 'error', answer.ok ? (answer.message || 'Done.') : (answer.error || 'GitHub did not do it.'));
        },
      };
      case 'web': return { label: 'Open on GitHub', onPress: () => openInAppBrowser(message.url) };
      case 'delete': return {
        label: 'Delete…',
        destructive: true,
        onPress: () => Alert.alert('Delete comment', `The comment by ${message.author} is deleted on GitHub. It cannot be brought back.`, [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Delete', style: 'destructive',
            onPress: async () => {
              const type = commentType(message);
              if (type === 'review') return;
              const answer = await editPullRequest(pullRef, { kind: 'comment-delete', type, id: message.id });
              notify(answer.ok ? 'ok' : 'error', answer.ok ? (answer.message || 'Comment deleted.') : (answer.error || 'GitHub did not delete it.'));
            },
          },
        ]),
      };
      default: return { label: action, onPress: () => {} };
    }
  });

  const moreMenu = (): SheetOption[] => {
    if (!head) return [];
    const options: SheetOption[] = [];
    if (head.can.update) options.push({ label: 'Edit description', onPress: () => openEditor({ mode: 'description' }, `edit:description:${pullRef.number}`, head.body) });
    if (head.state === 'OPEN' && (head.can.update || (item && canEdit(item, repo)))) {
      options.push({ label: 'Change base…', onPress: () => router.push({ pathname: '/pulls/base', params: { ...routeParams(pullRef), id: head.id, head: head.head, base: head.base } }) });
    }
    if (head.state === 'OPEN') {
      const action: ConfirmAction = head.isDraft ? 'ready' : 'draft';
      options.push({ label: ACTION_COPY[action].menu, onPress: () => runAction(action) });
      options.push({ label: ACTION_COPY.close.menu, destructive: true, onPress: () => runAction('close') });
    }
    if (head.state === 'CLOSED' && head.can.reopen) options.push({ label: ACTION_COPY.reopen.menu, onPress: () => runAction('reopen') });
    if (webUrl(head)) {
      options.push({ label: 'Copy the address', onPress: () => { Clipboard.setStringAsync(head.url).catch(() => {}); } });
      options.push({ label: 'Open in the browser', onPress: () => openInAppBrowser(head.url) });
    }
    return options;
  };

  const sheetOptions = (): SheetOption[] | undefined => {
    if (!menu) return undefined;
    if (menu.kind === 'more') return moreMenu();
    if (menu.kind === 'message') return messageMenu(menu.message);
    if (menu.kind === 'react') {
      return REACTIONS.map((r) => ({
        label: `${r.emoji}  ${r.label}`,
        hint: menu.message.reactions.some((x) => x.content === r.content && x.mine) ? 'yours' : undefined,
        onPress: () => react(menu.message, r.content),
      }));
    }
    return HIDE_REASONS.map((reason) => ({
      label: reason.label,
      onPress: async () => {
        const answer = await editPullRequest(pullRef, { kind: 'comment-hide', id: menu.message.id, reason: reason.key });
        notify(answer.ok ? 'ok' : 'error', answer.ok ? (answer.message || 'Comment hidden.') : (answer.error || 'GitHub did not hide it.'));
      },
    }));
  };
  const sheetTitle = menu?.kind === 'react' ? 'React' : menu?.kind === 'hide' ? 'Hide the comment as…' : menu?.kind === 'message' ? `${menu.message.author}'s ${menu.message.kind === 'description' ? 'description' : 'comment'}` : head ? `#${head.number} ${head.title}` : undefined;

  const counts = detailCounts(item ?? { changedFiles: 0 }, head, commits.data, checks.data);
  const status = head ? prStatus(head) : item ? prStatus(item) : 'open';
  const icon = STATE_ICONS[status];
  const block = item ? mergeBlock(item, repo) : 'Only an open pull request can be merged.';

  let body;
  if (!head) {
    body = conversation.error
      ? (
        <View style={styles.center}>
          <Text style={styles.emptyText}>{(conversation.error as Error).message}</Text>
          <Pressable onPress={() => conversation.refetch()} accessibilityRole="button"><Text style={styles.link}>Try again</Text></Pressable>
        </View>
      )
      : <View style={styles.center}><ActivityIndicator color={colors.accent} /><Text style={styles.emptyText}>Reading the pull request…</Text></View>;
  } else if (tab === 'conversation') {
    body = (
      <ConversationView
        head={head}
        pages={pages || []}
        hasMore={!!conversation.hasNextPage}
        loadingMore={conversation.isFetchingNextPage}
        onMore={() => conversation.fetchNextPage()}
        onMessageMenu={(message) => setMenu({ kind: 'message', message })}
        onReact={react}
        onAddReaction={(message) => setMenu({ kind: 'react', message })}
        onReply={(thread) => openEditor({ mode: 'reply', threadId: thread.id }, `reply:${thread.id}`, null)}
        onResolve={async (thread, resolve) => {
          const answer = await editPullRequest(pullRef, { kind: resolve ? 'thread-resolve' : 'thread-unresolve', threadId: thread.id });
          if (!answer.ok) notify('error', answer.error || 'GitHub did not do it.');
        }}
        onUpdateBranch={(method) => Alert.alert(method === 'MERGE' ? 'Update with merge commit' : 'Update with rebase', `The latest changes from ${head.base} go into ${head.head}, on GitHub.`, [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Update branch',
            onPress: async () => {
              const answer = await editPullRequest(pullRef, { kind: 'update-branch', pullRequestId: head.id, headOid: head.headOid, method });
              notify(answer.ok ? 'ok' : 'error', answer.ok ? (answer.message || 'Done.') : (answer.error || 'GitHub did not update it.'));
            },
          },
        ])}
        onComment={() => openEditor({ mode: 'comment', close: head.can.close ? '1' : '', reopen: head.can.reopen ? '1' : '' }, `composer:${pullRef.number}`, null)}
        onSideEdit={(side) => router.push({ pathname: '/pulls/side', params: { ...routeParams(pullRef), side } })}
      />
    );
  } else if (tab === 'commits') {
    body = <CommitsView pullRef={pullRef} query={commits} />;
  } else if (tab === 'checks') {
    body = (
      <ChecksView
        pullRef={pullRef}
        query={checks}
        onRerun={async (params) => {
          const answer = await editPullRequest(pullRef, params);
          notify(answer.ok ? 'ok' : 'error', answer.ok ? (answer.message || 'Started again.') : (answer.error || 'GitHub did not start it again.'));
        }}
      />
    );
  } else {
    body = (
      <PullRequestFiles
        projectId={pullRef.projectId}
        folder={pullRef.folder}
        remote={pullRef.remote}
        number={pullRef.number}
        headOid={head.headOid}
        viewed={viewed.data?.ok ? (viewed.data.viewed || {}) : undefined}
        onToggleViewed={viewed.data?.ok ? (file, on) => {
          setViewedState(pullRef, file.path, on);
          editPullRequest(pullRef, { kind: on ? 'viewed' : 'unviewed', pullRequestId: head.id, path: file.path }).then((answer) => {
            if (answer.ok) return;
            notify('error', answer.error || 'GitHub did not take it.');
            reloadPullRequestTab(pullRef, 'pull-request-viewed').catch(() => {});
          });
        } : undefined}
      />
    );
  }

  const shownTitle = head?.title ?? item?.title ?? title ?? `#${pullRef.number}`;
  return (
    <View style={styles.screen}>
      <ScrollView refreshControl={pull} keyboardShouldPersistTaps="handled">
        <View style={styles.head}>
          <View style={styles.titleRow}>
            <Ionicons name={icon.name} size={18} color={icon.color} style={styles.titleIcon} accessibilityLabel={icon.label} />
            <Text style={styles.title} selectable>{shownTitle}</Text>
            {head?.can.update ? (
              <Pressable onPress={() => setEditingTitle(true)} hitSlop={8} style={({ pressed }) => [styles.pencil, pressed && styles.pressed]} accessibilityRole="button" accessibilityLabel="Edit title">
                <Ionicons name="pencil" size={16} color={colors.textDim} />
              </Pressable>
            ) : null}
          </View>
          <Text style={styles.meta}>#{pullRef.number} · {head ? `${head.author} opened ${relativeTime(head.createdAt)}` : item ? `by ${item.author}` : ''}</Text>
          {head || item ? <Text style={styles.branches} numberOfLines={2}>{(head ?? item)!.head} → {(head ?? item)!.base}</Text> : null}
          {item ? (
            <View style={styles.badges}>
              {badges(item).map((badge) => <Text key={badge.text} style={[styles.badge, { color: TONE_BADGES[badge.tone] }]}>{badge.text}</Text>)}
            </View>
          ) : null}
          <View style={styles.actions}>
            {head?.state === 'OPEN' ? (
              <>
                <Pressable
                  onPress={() => (block ? Alert.alert('Merge', block) : router.push({ pathname: '/pulls/merge', params: routeParams(pullRef) }))}
                  style={({ pressed }) => [styles.action, styles.actionPrimary, !!block && styles.actionOff, pressed && styles.pressed]}
                  accessibilityRole="button"
                  accessibilityLabel={block ? `Merge is off: ${block}` : 'Merge'}
                >
                  <Ionicons name="git-merge" size={15} color={block ? colors.textFaint : colors.accent} />
                  <Text style={[styles.actionText, { color: block ? colors.textFaint : colors.accent }]}>Merge</Text>
                </Pressable>
                <Pressable
                  onPress={() => router.push({ pathname: '/pulls/review', params: { ...routeParams(pullRef), id: head.id, pending: head.pendingReviewId ?? '', mine: head.mine ? '1' : '' } })}
                  style={({ pressed }) => [styles.action, pressed && styles.pressed]}
                  accessibilityRole="button"
                >
                  <Ionicons name="chatbubble-ellipses-outline" size={15} color={colors.textDim} />
                  <Text style={styles.actionText}>Review</Text>
                </Pressable>
              </>
            ) : null}
            <View style={styles.flex} />
            <Pressable onPress={() => setMenu({ kind: 'more' })} disabled={!head} hitSlop={6} style={({ pressed }) => [styles.moreIcon, pressed && styles.pressed]} accessibilityRole="button" accessibilityLabel="More">
              <Ionicons name="ellipsis-horizontal" size={20} color={colors.textDim} />
            </Pressable>
          </View>
          {notice ? (
            <Pressable onPress={() => setPullNotice(pullRef.projectId, null)} style={[styles.notice, { borderLeftColor: notice.kind === 'error' ? colors.danger : notice.kind === 'ok' ? colors.running : colors.accent }]} accessibilityRole="alert" accessibilityHint="Dismiss">
              <Text style={styles.noticeText}>{notice.text}</Text>
              <Ionicons name="close" size={15} color={colors.textFaint} />
            </Pressable>
          ) : null}
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tabs}>
          {DETAIL_TABS.map(({ key, short }) => {
            const on = tab === key;
            const count = counts[key];
            return (
              <Pressable key={key} onPress={() => choose(key)} style={[styles.tab, on && styles.tabOn]} accessibilityRole="tab" accessibilityState={{ selected: on }}>
                <Text style={[styles.tabText, on && styles.tabTextOn]}>{short}</Text>
                {count != null ? <Text style={styles.tabCount}>{count}</Text> : null}
              </Pressable>
            );
          })}
        </ScrollView>
        {body}
      </ScrollView>

      <Sheet visible={!!menu} title={sheetTitle} options={sheetOptions()} onClose={() => setMenu(null)} />
      <TextPrompt
        visible={editingTitle}
        title="Edit title"
        initialValue={head?.title ?? ''}
        confirm="Save"
        onSubmit={saveTitle}
        onClose={() => setEditingTitle(false)}
      />
    </View>
  );
}

const TONE_BADGES = { draft: colors.textDim, bad: colors.danger, good: colors.running, warn: colors.attention };

// --- Conversation ---

function Avatar({ login, url, size = 22 }: { login: string; url: string | null; size?: number }) {
  if (url && /^https:\/\//i.test(url)) {
    return <Image source={{ uri: `${url}${url.includes('?') ? '&' : '?'}s=${size * 3}` }} style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: colors.raised }} accessibilityIgnoresInvertColors />;
  }
  return (
    <View style={[styles.avatarNone, { width: size, height: size, borderRadius: size / 2 }]}>
      <Text style={styles.avatarLetter}>{(login || '?').slice(0, 1).toUpperCase()}</Text>
    </View>
  );
}

const MessageCard = memo(function MessageCard({ message, prAuthor, compact, onMenu, onReact, onAddReaction }: {
  message: Message; prAuthor: string; compact?: boolean;
  onMenu: (message: Message) => void; onReact: (message: Message, content: ReactionContent) => void; onAddReaction: (message: Message) => void;
}) {
  const width = useAreaWidth();
  const [showHidden, setShowHidden] = useState(false);
  const hidden = !!message.minimized && !showHidden;
  const tags = [message.author === prAuthor && message.kind !== 'description' ? 'Author' : '', ROLE_LABELS[message.association] || ''].filter(Boolean);
  return (
    <View style={[styles.card, compact && styles.cardCompact]}>
      <View style={styles.cardHead}>
        <Avatar login={message.author} url={message.avatar} size={compact ? 18 : 22} />
        <Text style={styles.cardAuthor} numberOfLines={1}>{message.author}</Text>
        <Text style={styles.cardVerb} numberOfLines={1}>{messageVerb(message)} {relativeTime(message.submittedAt || message.createdAt)}{message.editedAt ? ' · edited' : ''}</Text>
        <View style={styles.flex} />
        {tags.map((tag) => <Text key={tag} style={styles.tag}>{tag}</Text>)}
        <Pressable onPress={() => onMenu(message)} hitSlop={8} style={styles.cardMore} accessibilityRole="button" accessibilityLabel="More for this message">
          <Ionicons name="ellipsis-horizontal" size={16} color={colors.textDim} />
        </Pressable>
      </View>
      {hidden ? (
        <Pressable onPress={() => setShowHidden(true)} accessibilityRole="button">
          <Text style={styles.hiddenText}>This comment was hidden as {String(message.minimized).replace(/_/g, ' ')}. Show it</Text>
        </Pressable>
      ) : message.body.trim() ? (
        <View style={styles.cardBody}><ChatMarkdown text={message.body} width={width - spacing.lg * 2 - spacing.md * 2} /></View>
      ) : message.kind === 'description' ? <Text style={styles.noBody}>No description provided.</Text> : null}
      {!hidden && (message.reactions.length || message.can.react) ? (
        <View style={styles.reactions}>
          {message.reactions.map((r) => (
            <Pressable
              key={r.content}
              onPress={() => onReact(message, r.content)}
              disabled={!message.can.react}
              style={[styles.reaction, r.mine && styles.reactionMine]}
              accessibilityRole="button"
              accessibilityState={{ selected: r.mine }}
              accessibilityLabel={`${REACTIONS.find((x) => x.content === r.content)?.label}, ${r.count}`}
            >
              <Text style={styles.reactionText}>{REACTIONS.find((x) => x.content === r.content)?.emoji} {r.count}</Text>
            </Pressable>
          ))}
          {message.can.react ? (
            <Pressable onPress={() => onAddReaction(message)} style={styles.reaction} accessibilityRole="button" accessibilityLabel="Add a reaction">
              <Ionicons name="happy-outline" size={15} color={colors.textDim} />
            </Pressable>
          ) : null}
        </View>
      ) : null}
    </View>
  );
});

const ROLE_LABELS: Record<string, string> = { OWNER: 'Owner', MEMBER: 'Member', COLLABORATOR: 'Collaborator', CONTRIBUTOR: 'Contributor', FIRST_TIME_CONTRIBUTOR: 'First-time contributor', FIRST_TIMER: 'First-time contributor' };

function ThreadCard({ thread, prAuthor, onMenu, onReact, onAddReaction, onReply, onResolve }: {
  thread: ReviewThread; prAuthor: string;
  onMenu: (message: Message) => void; onReact: (message: Message, content: ReactionContent) => void; onAddReaction: (message: Message) => void;
  onReply: (thread: ReviewThread) => void; onResolve: (thread: ReviewThread, resolve: boolean) => void;
}) {
  const [open, setOpen] = useState(!thread.resolved);
  const lines = useMemo(() => (open ? diffLines(hunkTail(thread.diffHunk)) : []), [open, thread.diffHunk]);
  return (
    <View style={styles.thread}>
      <Pressable onPress={() => setOpen(!open)} disabled={!thread.resolved} style={styles.threadHead} accessibilityRole="button" accessibilityState={{ expanded: open }}>
        {thread.resolved ? <Ionicons name={open ? 'chevron-down' : 'chevron-forward'} size={12} color={colors.textFaint} /> : null}
        <Text style={styles.threadPath} numberOfLines={1} ellipsizeMode="head">{thread.path}{thread.line != null ? `:${thread.line}` : ''}</Text>
        {thread.outdated ? <Text style={styles.tag}>Outdated</Text> : null}
        {thread.resolved ? <Text style={[styles.tag, { color: colors.running }]}>Resolved</Text> : null}
      </Pressable>
      {open ? (
        <>
          <ScrollView horizontal style={styles.hunk} contentContainerStyle={styles.hunkContent}>
            <View>{lines.map((line, i) => <Text key={i} style={[styles.hunkLine, LINE_STYLES[line.kind]]}>{line.text || ' '}</Text>)}</View>
          </ScrollView>
          {thread.comments.map((comment) => <MessageCard key={comment.id} message={comment} prAuthor={prAuthor} compact onMenu={onMenu} onReact={onReact} onAddReaction={onAddReaction} />)}
          <View style={styles.threadActions}>
            {thread.can.reply ? <Pressable onPress={() => onReply(thread)} style={styles.replyButton} accessibilityRole="button"><Text style={styles.replyText}>Reply…</Text></Pressable> : <View style={styles.flex} />}
            {thread.resolved && thread.can.unresolve ? <Pressable onPress={() => onResolve(thread, false)} accessibilityRole="button"><Text style={styles.link}>Unresolve</Text></Pressable> : null}
            {!thread.resolved && thread.can.resolve ? <Pressable onPress={() => onResolve(thread, true)} accessibilityRole="button"><Text style={styles.link}>Resolve</Text></Pressable> : null}
          </View>
        </>
      ) : null}
    </View>
  );
}

function EventLine({ event }: { event: TimelineEvent }) {
  return (
    <View style={styles.event}>
      <Ionicons name={EVENT_ICONS[event.type] || 'ellipse-outline'} size={14} color={colors.textFaint} />
      <Text style={styles.eventText}>{eventText(event)} <Text style={styles.eventWhen}>{relativeTime(event.createdAt)}</Text></Text>
    </View>
  );
}

const EVENT_ICONS: Partial<Record<TimelineEvent['type'], keyof typeof Ionicons.glyphMap>> = {
  'force-pushed': 'push-outline', 'base-changed': 'git-branch-outline', renamed: 'pencil-outline', closed: 'close-circle-outline', reopened: 'refresh-outline',
  merged: 'git-merge-outline', ready: 'eye-outline', draft: 'create-outline', 'review-requested': 'chatbubble-outline', 'review-request-removed': 'chatbubble-outline',
  'review-dismissed': 'close-outline', labeled: 'pricetag-outline', unlabeled: 'pricetag-outline', assigned: 'person-outline', unassigned: 'person-outline',
  'branch-deleted': 'trash-outline', 'branch-restored': 'git-branch-outline',
};

function CommitsLine({ commits }: { commits: TimelineCommit[] }) {
  const author = commits.every((c) => c.author === commits[0].author) ? commits[0].author : 'Commits were';
  return (
    <View style={styles.event}>
      <Ionicons name="git-commit-outline" size={14} color={colors.textFaint} />
      <View style={styles.flex}>
        <Text style={styles.eventText}>{author} added {commits.length} commit{commits.length === 1 ? '' : 's'}</Text>
        {commits.map((c) => <Text key={c.oid} style={styles.commitLine} numberOfLines={1}>{c.short}  {c.headline}</Text>)}
      </View>
    </View>
  );
}

function SideSummary({ head, onEdit }: { head: PullRequestHead; onEdit: (side: 'reviewers' | 'assignees' | 'labels') => void }) {
  const row = (side: 'reviewers' | 'assignees' | 'labels', label: string, editable: boolean, content: React.ReactNode) => (
    <View style={styles.sideRow}>
      <View style={styles.sideHead}>
        <Text style={styles.sideLabel}>{label}</Text>
        {editable ? <Pressable onPress={() => onEdit(side)} hitSlop={8} accessibilityRole="button" accessibilityLabel={`Edit ${label.toLowerCase()}`}><Ionicons name="settings-outline" size={15} color={colors.textDim} /></Pressable> : null}
      </View>
      {content}
    </View>
  );
  const STATE_WORDS: Record<string, string> = { APPROVED: 'approved', CHANGES_REQUESTED: 'requested changes', COMMENTED: 'commented', DISMISSED: 'dismissed', REQUESTED: 'awaiting review', PENDING: 'awaiting review' };
  return (
    <View style={styles.side}>
      {row('reviewers', 'Reviewers', head.can.update && head.state === 'OPEN', head.reviewers.length
        ? head.reviewers.map((r) => <Text key={`${r.kind}:${r.login}`} style={styles.sideValue}>{r.name} <Text style={styles.sideFaint}>· {STATE_WORDS[r.state] || r.state.toLowerCase()}</Text></Text>)
        : <Text style={styles.sideFaint}>No reviews</Text>)}
      {row('assignees', 'Assignees', head.can.assign, head.assignees.length
        ? <Text style={styles.sideValue}>{head.assignees.map((a) => a.login).join(', ')}</Text>
        : <Text style={styles.sideFaint}>No one assigned</Text>)}
      {row('labels', 'Labels', head.can.label, head.labels.length
        ? <View style={styles.labels}>{head.labels.map((l) => <Text key={l.id} style={[styles.label, { borderColor: labelColor(l.color), color: labelColor(l.color) }]}>{l.name}</Text>)}</View>
        : <Text style={styles.sideFaint}>None yet</Text>)}
    </View>
  );
}

function ConversationView({ head, pages, hasMore, loadingMore, onMore, onMessageMenu, onReact, onAddReaction, onReply, onResolve, onUpdateBranch, onComment, onSideEdit }: {
  head: PullRequestHead; pages: { timeline?: { items: import('@/pulls/model').TimelineItem[] }; threads?: ReviewThread[] }[];
  hasMore: boolean; loadingMore: boolean; onMore: () => void;
  onMessageMenu: (message: Message) => void; onReact: (message: Message, content: ReactionContent) => void; onAddReaction: (message: Message) => void;
  onReply: (thread: ReviewThread) => void; onResolve: (thread: ReviewThread, resolve: boolean) => void;
  onUpdateBranch: (method: 'MERGE' | 'REBASE') => void; onComment: () => void; onSideEdit: (side: 'reviewers' | 'assignees' | 'labels') => void;
}) {
  const items = useMemo(() => pages.flatMap((page) => page.timeline?.items || []), [pages]);
  const blocks = useMemo(() => timelineBlocks(items, pages[0]?.threads || [], !hasMore), [items, pages, hasMore]);
  const description: Message = useMemo(() => ({
    kind: 'description', id: head.id, url: head.url, author: head.author, avatar: head.avatar, association: head.association, body: head.body, bodyHtml: head.bodyHtml,
    createdAt: head.createdAt, editedAt: head.editedAt, mine: head.mine, can: { update: head.can.update, delete: false, minimize: false, react: head.can.react },
    minimized: null, reactions: head.reactions,
  }), [head]);
  const status = statusRows(head);
  const cardProps = { prAuthor: head.author, onMenu: onMessageMenu, onReact, onAddReaction };
  return (
    <View style={styles.conversation}>
      <SideSummary head={head} onEdit={onSideEdit} />
      <MessageCard message={description} {...cardProps} />
      {blocks.map((block) => {
        if (block.kind === 'message') return <MessageCard key={block.key} message={block.message} {...cardProps} />;
        if (block.kind === 'review-line') {
          return (
            <View key={block.key} style={styles.event}>
              <Ionicons name="chatbubble-ellipses-outline" size={14} color={colors.textFaint} />
              <Text style={styles.eventText}>{block.message.author} reviewed <Text style={styles.eventWhen}>{relativeTime(block.message.submittedAt || block.message.createdAt)}</Text></Text>
            </View>
          );
        }
        if (block.kind === 'commits') return <CommitsLine key={block.key} commits={block.commits} />;
        if (block.kind === 'event') return <EventLine key={block.key} event={block.event} />;
        return <ThreadCard key={block.key} thread={block.thread} {...cardProps} onReply={onReply} onResolve={onResolve} />;
      })}
      {hasMore ? (
        <Pressable onPress={onMore} disabled={loadingMore} style={styles.moreButton} accessibilityRole="button">
          <Text style={styles.link}>{loadingMore ? 'Loading…' : 'Load more'}</Text>
        </Pressable>
      ) : null}
      {status.rows.length ? (
        <View style={styles.status}>
          {status.rows.map((row) => (
            <View key={row.text} style={styles.statusRow}>
              <View style={[styles.dot, { backgroundColor: TONES[row.tone] }]} />
              <Text style={styles.statusText}>{row.text}</Text>
            </View>
          ))}
          {status.canUpdateBranch ? (
            <View style={styles.statusActions}>
              <Pressable onPress={() => onUpdateBranch('MERGE')} style={styles.action} accessibilityRole="button"><Text style={styles.actionText}>Update with merge commit</Text></Pressable>
              <Pressable onPress={() => onUpdateBranch('REBASE')} style={styles.action} accessibilityRole="button"><Text style={styles.actionText}>Update with rebase</Text></Pressable>
            </View>
          ) : null}
        </View>
      ) : null}
      <Pressable onPress={onComment} style={styles.composer} accessibilityRole="button">
        <Ionicons name="chatbox-outline" size={16} color={colors.textDim} />
        <Text style={styles.composerText}>Write a comment…</Text>
      </Pressable>
    </View>
  );
}

// --- Commits ---

function CommitsView({ pullRef, query }: { pullRef: PullRef; query: ReturnType<typeof useCommits> }) {
  const [open, setOpen] = useState<ReadonlySet<string>>(() => new Set());
  const data = query.data;
  if (query.isLoading || !data) return <View style={styles.center}><ActivityIndicator color={colors.accent} /><Text style={styles.emptyText}>Reading the commits…</Text></View>;
  if (!data.ok) return <View style={styles.center}><Text style={styles.emptyText}>{data.error}</Text><Pressable onPress={() => query.refetch()}><Text style={styles.link}>Try again</Text></Pressable></View>;
  const flip = (oid: string) => setOpen((previous) => { const next = new Set(previous); if (next.has(oid)) next.delete(oid); else next.add(oid); return next; });
  return (
    <View>
      {commitDays(data.commits || []).map(({ day, commits }) => (
        <View key={day}>
          <Text style={styles.day}>Commits on {day}</Text>
          {commits.map((c) => (
            <View key={c.oid} style={styles.commit}>
              <Pressable onPress={() => flip(c.oid)} style={styles.commitRow} accessibilityRole="button" accessibilityState={{ expanded: open.has(c.oid) }}>
                <Ionicons name={open.has(c.oid) ? 'chevron-down' : 'chevron-forward'} size={12} color={colors.textFaint} />
                <View style={styles.flex}>
                  <Text style={styles.commitTitle} numberOfLines={2}>{c.headline}</Text>
                  <Text style={styles.meta}>{c.author} committed {relativeTime(c.date)}</Text>
                </View>
                {c.checks ? <View style={[styles.dot, { backgroundColor: c.checks === 'SUCCESS' ? colors.running : c.checks === 'FAILURE' || c.checks === 'ERROR' ? colors.danger : colors.attention }]} /> : null}
                <Pressable onPress={() => { Clipboard.setStringAsync(c.oid).catch(() => {}); }} hitSlop={6} style={styles.sha} accessibilityRole="button" accessibilityLabel={`Copy the hash ${c.short}`}>
                  <Text style={styles.shaText}>{c.short}</Text>
                </Pressable>
              </Pressable>
              {open.has(c.oid) ? (
                <>
                  {c.body ? <Text style={styles.commitBody} selectable>{c.body}</Text> : null}
                  {/^https?:\/\//i.test(c.url) ? <Pressable onPress={() => openInAppBrowser(c.url)} accessibilityRole="button"><Text style={[styles.link, { paddingHorizontal: spacing.lg }]}>Open on GitHub</Text></Pressable> : null}
                  <CommitFiles pullRef={pullRef} sha={c.oid} />
                </>
              ) : null}
            </View>
          ))}
        </View>
      ))}
      {data.truncated ? <Text style={styles.footer}>GitHub lists the first 250 commits of a pull request.</Text> : null}
    </View>
  );
}

// --- Checks ---

function ChecksView({ pullRef, query, onRerun }: {
  pullRef: PullRef; query: ReturnType<typeof useChecks>;
  onRerun: (params: { kind: 'rerun'; runId: number; failedOnly: boolean } | { kind: 'rerun-job'; jobId: number }) => void;
}) {
  const [logs, setLogs] = useState<ReadonlySet<number>>(() => new Set());
  const data = query.data;
  if (query.isLoading || !data) return <View style={styles.center}><ActivityIndicator color={colors.accent} /><Text style={styles.emptyText}>Reading the checks…</Text></View>;
  if (!data.ok) return <View style={styles.center}><Text style={styles.emptyText}>{data.error}</Text><Pressable onPress={() => query.refetch()}><Text style={styles.link}>Try again</Text></Pressable></View>;
  const list = data.checks || [];
  if (!list.length) return <View style={styles.center}><Text style={styles.emptyText}>No checks on the last commit.</Text></View>;
  const flip = (id: number) => setLogs((previous) => { const next = new Set(previous); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  return (
    <View>
      <Text style={styles.checksHead}>{checksSummaryText(data.summary)}</Text>
      {checkGroups(list).map((group) => (
        <View key={group.name} style={styles.checkGroup}>
          <View style={styles.checkGroupHead}>
            <Text style={styles.checkGroupName} numberOfLines={1}>{group.name}</Text>
            {group.failedRuns.map((runId) => (
              <Pressable key={runId} onPress={() => onRerun({ kind: 'rerun', runId, failedOnly: true })} accessibilityRole="button"><Text style={styles.link}>Re-run failed</Text></Pressable>
            ))}
          </View>
          {group.checks.map((check, index) => <CheckRow key={`${check.id ?? check.name}:${index}`} pullRef={pullRef} check={check} logOpen={!!check.id && logs.has(check.id)} onLog={() => check.id && flip(check.id)} onRerun={onRerun} />)}
        </View>
      ))}
    </View>
  );
}

function CheckRow({ pullRef, check, logOpen, onLog, onRerun }: {
  pullRef: PullRef; check: Check; logOpen: boolean; onLog: () => void;
  onRerun: (params: { kind: 'rerun-job'; jobId: number }) => void;
}) {
  const icon = BUCKET_ICONS[check.bucket];
  const finished = checkFinishedJob(check);
  return (
    <View style={styles.check}>
      <View style={styles.checkRow}>
        <Ionicons name={icon.name} size={16} color={icon.color} />
        <View style={styles.flex}>
          <Text style={styles.checkName} numberOfLines={2}>{check.name}{check.required ? '  · required' : ''}</Text>
          <Text style={styles.meta} numberOfLines={1}>{[check.title || (check.event ? `on ${check.event}` : ''), checkDuration(check.startedAt, check.completedAt)].filter(Boolean).join(' · ')}</Text>
        </View>
      </View>
      <View style={styles.checkActions}>
        {finished ? <Pressable onPress={onLog} accessibilityRole="button" accessibilityState={{ expanded: logOpen }}><Text style={styles.link}>{logOpen ? 'Hide log' : 'Log'}</Text></Pressable> : null}
        {finished && check.id ? <Pressable onPress={() => onRerun({ kind: 'rerun-job', jobId: check.id! })} accessibilityRole="button"><Text style={styles.link}>Re-run</Text></Pressable> : null}
        {/^https?:\/\//i.test(check.url) ? <Pressable onPress={() => openInAppBrowser(check.url)} accessibilityRole="button"><Text style={styles.link}>Details</Text></Pressable> : null}
      </View>
      {logOpen && check.id ? <JobLog pullRef={pullRef} jobId={check.id} /> : null}
    </View>
  );
}

function JobLog({ pullRef, jobId }: { pullRef: PullRef; jobId: number }) {
  const log = useJobLog(pullRef, jobId);
  const shown = useMemo(() => (log.data?.ok ? logLines(log.data.text || '') : null), [log.data]);
  if (log.isLoading) return <View style={styles.logNote}><ActivityIndicator size="small" color={colors.accent} /><Text style={styles.emptyText}>Reading the log…</Text></View>;
  if (!log.data?.ok || !shown) return <Text style={[styles.logNote, { color: colors.danger }]}>{log.data?.error || 'The log could not be read.'}</Text>;
  return (
    <View>
      {shown.cut || log.data.truncated ? <Text style={styles.logNoteText}>Only the end of the log is shown.</Text> : null}
      <ScrollView horizontal style={styles.log} contentContainerStyle={styles.logContent}>
        <View>
          {shown.lines.map((line, i) => (
            <Text key={i} style={[styles.logLine, line.tone === 'group' && { color: colors.accent, fontWeight: '700' }, line.tone === 'error' && { color: colors.danger }, line.tone === 'warning' && { color: colors.attention }]}>{line.text || ' '}</Text>
          ))}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  flex: { flex: 1, minWidth: 0 },
  center: { alignItems: 'center', gap: spacing.sm, padding: spacing.xl },
  emptyText: { color: colors.textFaint, fontSize: 13, lineHeight: 18, textAlign: 'center' },
  link: { color: colors.accent, fontSize: 14, paddingVertical: spacing.xs },
  pressed: { opacity: 0.7 },
  head: { paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: spacing.sm, gap: 4 },
  titleRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  titleIcon: { marginTop: 2 },
  title: { flex: 1, color: colors.text, fontSize: 17, fontWeight: '700', lineHeight: 23 },
  pencil: { width: 32, height: 32, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  meta: { color: colors.textFaint, fontSize: 12, marginTop: 2 },
  branches: { color: '#9aa0e0', fontSize: 11.5, fontFamily: mono },
  badges: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  badge: { fontSize: 11, fontWeight: '600' },
  actions: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.sm },
  action: { flexDirection: 'row', alignItems: 'center', gap: 5, height: 36, paddingHorizontal: spacing.md, borderRadius: 8, borderWidth: 1, borderColor: colors.border },
  actionPrimary: { borderColor: 'rgba(128,136,255,0.4)', backgroundColor: 'rgba(128,136,255,0.12)' },
  actionOff: { borderColor: colors.border, backgroundColor: 'transparent' },
  actionText: { color: colors.textDim, fontSize: 13, fontWeight: '600' },
  moreIcon: { width: 44, height: 36, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  notice: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.sm, padding: spacing.sm, paddingLeft: spacing.md, borderRadius: 8, backgroundColor: colors.surface, borderLeftWidth: 3 },
  noticeText: { flex: 1, color: colors.text, fontSize: 13, lineHeight: 18 },
  tabs: { flexDirection: 'row', gap: 2, paddingHorizontal: spacing.md, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  tab: { flexDirection: 'row', alignItems: 'center', gap: 6, height: 42, paddingHorizontal: spacing.md, borderBottomWidth: 2, borderBottomColor: 'transparent' },
  tabOn: { borderBottomColor: colors.accent },
  tabText: { color: colors.textDim, fontSize: 14 },
  tabTextOn: { color: colors.text, fontWeight: '700' },
  tabCount: { color: colors.textDim, fontSize: 11.5, backgroundColor: colors.raised, borderRadius: 9, paddingHorizontal: 6, overflow: 'hidden' },
  conversation: { padding: spacing.lg, gap: spacing.md },
  side: { gap: spacing.sm, paddingBottom: spacing.md, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  sideRow: { gap: 3 },
  sideHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  sideLabel: { color: colors.textDim, fontSize: 12, fontWeight: '700' },
  sideValue: { color: colors.text, fontSize: 13 },
  sideFaint: { color: colors.textFaint, fontSize: 12.5 },
  labels: { flexDirection: 'row', flexWrap: 'wrap', gap: 5 },
  label: { fontSize: 11.5, fontWeight: '600', borderWidth: 1, borderRadius: 10, paddingHorizontal: 7, paddingVertical: 1, overflow: 'hidden' },
  card: { borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border, borderRadius: 10, backgroundColor: colors.surface, overflow: 'hidden' },
  cardCompact: { borderRadius: 0, borderWidth: 0, borderTopWidth: StyleSheet.hairlineWidth, backgroundColor: 'transparent' },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  cardAuthor: { color: colors.text, fontSize: 13, fontWeight: '700', flexShrink: 1 },
  cardVerb: { color: colors.textFaint, fontSize: 12, flexShrink: 2 },
  cardMore: { width: 28, height: 24, alignItems: 'center', justifyContent: 'center' },
  cardBody: { paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  noBody: { color: colors.textFaint, fontStyle: 'italic', paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  hiddenText: { color: colors.textDim, fontStyle: 'italic', paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  tag: { color: colors.textDim, fontSize: 10.5, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border, borderRadius: 8, paddingHorizontal: 5, paddingVertical: 1, overflow: 'hidden' },
  avatarNone: { backgroundColor: colors.raised, alignItems: 'center', justifyContent: 'center' },
  avatarLetter: { color: colors.textDim, fontSize: 10, fontWeight: '700' },
  reactions: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, paddingHorizontal: spacing.md, paddingBottom: spacing.sm },
  reaction: { flexDirection: 'row', alignItems: 'center', height: 28, minWidth: 36, justifyContent: 'center', paddingHorizontal: 8, borderRadius: 14, borderWidth: 1, borderColor: colors.border },
  reactionMine: { borderColor: colors.accent, backgroundColor: 'rgba(128,136,255,0.14)' },
  reactionText: { color: colors.text, fontSize: 13 },
  thread: { marginLeft: spacing.sm, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border, borderRadius: 10, overflow: 'hidden', backgroundColor: 'rgba(0,0,0,0.15)' },
  threadHead: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  threadPath: { flexShrink: 1, color: colors.textDim, fontFamily: mono, fontSize: 12 },
  hunk: { backgroundColor: '#14141a', maxHeight: 140 },
  hunkContent: { paddingVertical: spacing.xs, paddingHorizontal: spacing.sm },
  hunkLine: { fontFamily: mono, fontSize: 11, lineHeight: 15, paddingHorizontal: 4 },
  threadActions: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  replyButton: { flex: 1, height: 34, justifyContent: 'center', paddingHorizontal: spacing.md, borderRadius: 8, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border, backgroundColor: colors.background },
  replyText: { color: colors.textFaint, fontSize: 13 },
  event: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm, paddingHorizontal: spacing.xs },
  eventText: { flex: 1, color: colors.textDim, fontSize: 12.5, lineHeight: 17 },
  eventWhen: { color: colors.textFaint, fontSize: 11.5 },
  commitLine: { color: colors.textFaint, fontSize: 12, fontFamily: mono, marginTop: 2 },
  moreButton: { alignItems: 'center' },
  status: { borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border, borderRadius: 10, padding: spacing.md, gap: spacing.sm, backgroundColor: colors.surface },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  statusText: { flex: 1, color: colors.text, fontSize: 13 },
  statusActions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  dot: { width: 8, height: 8, borderRadius: 4 },
  composer: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, height: 46, paddingHorizontal: spacing.md, borderRadius: 10, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  composerText: { color: colors.textFaint, fontSize: 14 },
  day: { color: colors.textDim, fontSize: 12, fontWeight: '700', paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: spacing.xs },
  commit: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  commitRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, minHeight: 52 },
  commitTitle: { color: colors.text, fontSize: 13.5, fontWeight: '600' },
  commitBody: { color: colors.textDim, fontSize: 12.5, lineHeight: 18, paddingHorizontal: spacing.lg, paddingBottom: spacing.sm },
  sha: { paddingHorizontal: 7, paddingVertical: 4, borderRadius: 6, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
  shaText: { color: colors.accent, fontFamily: mono, fontSize: 11.5 },
  footer: { color: colors.textFaint, fontSize: 12, padding: spacing.lg },
  checksHead: { color: colors.text, fontSize: 13, fontWeight: '700', paddingHorizontal: spacing.lg, paddingTop: spacing.md },
  checkGroup: { marginTop: spacing.md, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  checkGroupHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, backgroundColor: colors.surface },
  checkGroupName: { flex: 1, color: colors.textDim, fontSize: 12.5, fontWeight: '700' },
  check: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border, paddingVertical: spacing.sm },
  checkRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.lg },
  checkName: { color: colors.text, fontSize: 13.5 },
  checkActions: { flexDirection: 'row', gap: spacing.lg, paddingLeft: spacing.lg + 24, paddingRight: spacing.lg },
  logNote: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm },
  logNoteText: { color: colors.textFaint, fontSize: 12, paddingHorizontal: spacing.lg },
  log: { backgroundColor: '#101015', marginTop: spacing.xs, maxHeight: 420 },
  logContent: { padding: spacing.sm },
  logLine: { color: colors.text, fontFamily: mono, fontSize: 10.5, lineHeight: 14 },
});
