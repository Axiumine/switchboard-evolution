import Ionicons from '@expo/vector-icons/Ionicons';
import { useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, View } from 'react-native';

import { FileIcon } from '@/components/files/FileIcon';
import { Sheet } from '@/components/Sheet';
import { changeMenu, sectionChangesIn, type ChangeMenuAction } from '@/git/change-menu';
import { STATUS_COLORS, statusLetter, treeRows, type Change, type Repository, type TreeRow } from '@/git/model';
import { discardFiles, ignorePaths, refreshGit, stageFiles, useCanDiscard, useCanIgnore } from '@/git/stage-requests';
import { letterColor, sectionPaths, sideLetter, stagingSections, pathsToStage, type Section, type Side } from '@/git/staging';
import { discardQuestion, discardTargets, untrackQuestion, type ChangeTarget } from '@/shared/vendor/git-change-actions';
import { relativeTime, shortProjectPath } from '@/sessions/model';
import { colors, spacing } from '@/theme';

/**
 * One repository: branch, what changed (as a list or a tree, staged or not) and
 * the latest commits. `onOpenHistory` replaces the push to the Git Graph screen
 * where the graph is a view of the same page.
 */
export function RepositoryBlock({ projectId, repo, tree, canStage, onOpenHistory }: {
  projectId: string; repo: Repository; tree: boolean; canStage: boolean; onOpenHistory?: () => void;
}) {
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState<string | null>(null);
  // The row a long press opened the menu of.
  const [menu, setMenu] = useState<{ section: Section; target: ChangeTarget } | null>(null);
  const canDiscard = useCanDiscard();
  const canIgnore = useCanIgnore();
  const changes = repo.changes || [];
  const sync = [repo.ahead ? `↑${repo.ahead}` : null, repo.behind ? `↓${repo.behind}` : null].filter(Boolean).join(' ');
  const sections = canStage ? stagingSections(changes) : [];

  const openDiff = (change: Change, side: Side | null) => router.push({
    pathname: '/diff',
    params: {
      projectId, folder: repo.path, path: change.path, ...(side ? { side } : {}), ...(change.oldPath ? { oldPath: change.oldPath } : {}),
      // What Edit needs to know: whether the file is on disk, and what it is compared with.
      ...(change.code ? { code: change.code } : {}), ...(change.status ? { status: change.status } : {}),
    },
  });

  /** Stage or unstage files (null: every change), then read the changes again. */
  const run = async (key: string, paths: string[] | null, stage: boolean) => {
    setBusy(key);
    try {
      await stageFiles(projectId, repo.path, paths, stage);
    } catch (err: any) {
      Alert.alert(`Could not ${stage ? 'stage' : 'unstage'}`, err?.message || String(err));
    } finally {
      await refreshGit(queryClient, projectId);
      setBusy(null);
    }
  };

  /** Run one call of the row menu with the list busy, then read the changes again. */
  const act = async (key: string, call: () => Promise<void>, failure: string) => {
    setBusy(key);
    try {
      await call();
    } catch (err: any) {
      Alert.alert(failure, err?.message || String(err));
    } finally {
      await refreshGit(queryClient, projectId);
      setBusy(null);
    }
  };

  /** Discard the "Changes" side of a file or folder (null: all of it), after asking. */
  const discard = (target: ChangeTarget | null, key: string) => {
    const targets = discardTargets(changes, target);
    if (!targets.length) return;
    const question = discardQuestion(targets, target?.dir ? target.path.split('/').pop() : null);
    // The files the question counted, not whatever the folder holds by the time the computer runs it.
    const paths = targets.map((change) => change.path);
    setTimeout(() => Alert.alert(question.title, question.detail, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: question.confirm, style: 'destructive', onPress: () => act(key, async () => {
          const failed = await discardFiles(projectId, repo.path, paths);
          if (failed.length) Alert.alert('Some files were not moved to the Trash', failed.map((item) => `${item.path}: ${item.error}`).join('\n'));
        }, 'Could not discard'),
      },
    ]));
  };

  /** Add a file or folder to .gitignore; taking it out of Git too asks first. */
  const ignore = (target: ChangeTarget, untrack: boolean, key: string) => {
    const run = () => act(key, () => ignorePaths(projectId, repo.path, [target.path], untrack), 'Could not add to .gitignore');
    if (!untrack) { run(); return; }
    const question = untrackQuestion(target.path.split('/').pop() || target.path, target.dir);
    setTimeout(() => Alert.alert(question.title, question.detail, [
      { text: 'Cancel', style: 'cancel' },
      { text: question.confirm, style: 'destructive', onPress: run },
    ]));
  };

  const runMenu = (section: Section, target: ChangeTarget, action: ChangeMenuAction) => {
    const key = `${section.key}:${target.path}`;
    if (action === 'stage' || action === 'unstage') run(key, pathsToStage(sectionChangesIn(section, target), section.stage), section.stage);
    else if (action === 'discard') discard(target, key);
    else ignore(target, action === 'untrack', key);
  };

  const rowsOf = (items: Change[]): TreeRow<Change>[] => tree ? treeRows(items) : items.map((change) => ({ kind: 'file', key: change.path, depth: 0, name: change.path, item: change }));

  const renderRows = (items: Change[], section: Section | null) => rowsOf(items).map((row) => {
    if (row.kind === 'folder') {
      const folder = (
        <>
          <FileIcon name={row.name.split(' / ').pop() || row.name} dir size={18} />
          <Text style={styles.folder} numberOfLines={1}>{row.name}</Text>
        </>
      );
      if (!section) {
        return <View key={row.key} style={[styles.folderRow, { paddingLeft: row.depth * 16 }]}>{folder}</View>;
      }
      return (
        <Pressable
          key={`${section.key}:${row.key}`}
          onLongPress={() => setMenu({ section, target: { path: row.key, dir: true } })}
          style={({ pressed }) => [styles.folderRow, { paddingLeft: row.depth * 16 }, pressed && styles.pressed]}
          accessibilityRole="button"
          accessibilityLabel={`${row.name}, ${section.title}`}
          accessibilityHint="Long press for actions"
        >
          {folder}
        </Pressable>
      );
    }
    const change = row.item;
    const letter = section ? sideLetter(change, section.side) : statusLetter(change);
    const color = section ? letterColor(letter) : STATUS_COLORS[change.status];
    const rowKey = `${section?.key ?? ''}:${row.key}`;
    return (
      <View key={rowKey} style={styles.changeLine}>
        <Pressable
          onPress={() => openDiff(change, section?.side ?? null)}
          onLongPress={section ? () => setMenu({ section, target: { path: change.path, dir: false } }) : undefined}
          style={({ pressed }) => [styles.change, { paddingLeft: row.depth * 16 }, pressed && styles.pressed]}
          accessibilityRole="button"
          accessibilityLabel={`${change.path}${section ? `, ${section.title}` : ''}`}
        >
          <FileIcon name={change.path.split('/').pop() || row.name} size={18} />
          <Text style={styles.path} numberOfLines={1}>{row.name}</Text>
          {!section && change.staged ? <Text style={styles.staged}>staged</Text> : null}
          <Text style={[styles.letter, { color }]}>{letter}</Text>
        </Pressable>
        {section ? (
          <Pressable
            onPress={() => run(rowKey, pathsToStage([change], section.stage), section.stage)}
            disabled={busy !== null}
            hitSlop={4}
            style={({ pressed }) => [styles.rowButton, busy !== null && styles.disabled, pressed && styles.pressed]}
            accessibilityRole="button"
            accessibilityLabel={`${section.stage ? 'Stage' : 'Unstage'} ${change.path}`}
          >
            {busy === rowKey ? <ActivityIndicator size="small" color={colors.accent} /> : <Ionicons name={section.stage ? 'add' : 'remove'} size={22} color={colors.textDim} />}
          </Pressable>
        ) : null}
      </View>
    );
  });

  return (
    <View style={styles.repo}>
      <Text style={styles.repoName}>{shortProjectPath(repo.path)}</Text>
      {!repo.git ? <Text style={styles.meta}>Not a git repository.</Text> : (
        <>
          <Text style={styles.meta}>
            {[repo.detached ? `detached at ${repo.head?.slice(0, 7)}` : repo.branch, sync, repo.operation ? `${repo.operation} in progress` : null,
              repo.stats && (repo.stats.insertions || repo.stats.deletions) ? `+${repo.stats.insertions} −${repo.stats.deletions}` : null].filter(Boolean).join(' · ')}
          </Text>
          <Pressable onPress={onOpenHistory ?? (() => router.push({ pathname: '/graph', params: { projectId, folder: repo.path } }))} style={styles.graphLink} accessibilityRole="button">
            <Text style={styles.link}>Git Graph</Text>
          </Pressable>
          {canStage ? (
            <>
              {!sections.length ? <Text style={styles.heading}>No changes</Text> : null}
              {sections.map((section) => {
                const key = `all:${section.key}`;
                return (
                  <View key={section.key}>
                    <View style={styles.sectionHead}>
                      <Text style={[styles.heading, styles.sectionTitle]}>{section.title} ({section.changes.length})</Text>
                      {section.key === 'changes' && canDiscard ? (
                        <Pressable
                          onPress={() => discard(null, `discard:${section.key}`)}
                          disabled={busy !== null}
                          hitSlop={8}
                          style={({ pressed }) => [styles.sectionButton, busy !== null && styles.disabled, pressed && styles.pressed]}
                          accessibilityRole="button"
                          accessibilityLabel="Discard all in Changes"
                        >
                          {busy === `discard:${section.key}` ? <ActivityIndicator size="small" color={colors.danger} /> : null}
                          <Text style={[styles.link, styles.danger]}>Discard All</Text>
                        </Pressable>
                      ) : null}
                      <Pressable
                        onPress={() => run(key, sectionPaths(section, changes), section.stage)}
                        disabled={busy !== null}
                        hitSlop={8}
                        style={({ pressed }) => [styles.sectionButton, busy !== null && styles.disabled, pressed && styles.pressed]}
                        accessibilityRole="button"
                        accessibilityLabel={`${section.stage ? 'Stage' : 'Unstage'} all in ${section.title}`}
                      >
                        {busy === key ? <ActivityIndicator size="small" color={colors.accent} /> : null}
                        <Text style={styles.link}>{section.stage ? 'Stage All' : 'Unstage All'}</Text>
                      </Pressable>
                    </View>
                    {renderRows(section.changes, section)}
                  </View>
                );
              })}
            </>
          ) : (
            <>
              <Text style={styles.heading}>{changes.length ? `Changes (${changes.length})` : 'No changes'}</Text>
              {renderRows(changes, null)}
            </>
          )}
          <Sheet
            visible={!!menu}
            title={menu?.target.path}
            options={menu ? changeMenu(menu.section, menu.target, changes, { stage: canStage, discard: canDiscard, ignore: canIgnore }).map((entry) => ({
              label: entry.label,
              destructive: entry.destructive,
              onPress: () => runMenu(menu.section, menu.target, entry.action),
            })) : []}
            onClose={() => setMenu(null)}
          />
          {repo.commits?.length ? <Text style={styles.heading}>Latest commits</Text> : null}
          {repo.commits?.slice(0, 10).map((commit) => (
            <View key={commit.hash} style={styles.commit}>
              <Text style={styles.subject} numberOfLines={2}>{commit.subject}</Text>
              <Text style={styles.meta}>{commit.shortHash} · {commit.author} · {relativeTime(commit.date)}</Text>
            </View>
          ))}
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  repo: { padding: spacing.lg, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border, gap: 4 },
  repoName: { color: colors.text, fontSize: 17, fontWeight: '600' },
  meta: { color: colors.textFaint, fontSize: 12 },
  graphLink: { paddingVertical: spacing.sm, alignSelf: 'flex-start' },
  link: { color: colors.accent, fontSize: 15 },
  danger: { color: colors.danger },
  heading: { color: colors.textDim, fontSize: 13, fontWeight: '600', marginTop: spacing.md, marginBottom: 2 },
  changeLine: { flexDirection: 'row', alignItems: 'center' },
  change: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: 7 },
  rowButton: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center', borderRadius: 8 },
  sectionHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
  sectionTitle: { flex: 1 },
  sectionButton: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 4, paddingLeft: spacing.sm },
  disabled: { opacity: 0.4 },
  pressed: { backgroundColor: colors.surface },
  letter: { width: 14, textAlign: 'right', fontFamily: 'Menlo', fontSize: 13, fontWeight: '700' },
  path: { color: colors.text, fontSize: 14, flex: 1 },
  staged: { color: colors.textFaint, fontSize: 11 },
  folderRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: 5 },
  folder: { color: colors.textDim, fontSize: 14, flex: 1 },
  commit: { paddingVertical: 6, gap: 2 },
  subject: { color: colors.text, fontSize: 14 },
});
