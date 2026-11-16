import Ionicons from '@expo/vector-icons/Ionicons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { router, Stack, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';

import { FileIcon } from '@/components/files/FileIcon';
import { STATUS_COLORS, statusLetter, treeRows, type Change, type Repository, type TreeRow } from '@/git/model';
import { refreshGit, stageFiles, useCanStage } from '@/git/stage-requests';
import { letterColor, sectionPaths, sideLetter, stagingSections, pathsToStage, type Section, type Side } from '@/git/staging';
import { relativeTime, shortProjectPath } from '@/sessions/model';
import { request, useConnection } from '@/store/connection';
import { colors, spacing } from '@/theme';

/** A project's repositories: branch, what changed (as a list or a tree) and the latest commits. */
export default function GitScreen() {
  const { projectId, title } = useLocalSearchParams<{ projectId: string; title?: string }>();
  const online = useConnection((s) => s.status.state === 'online');
  // Staging needs both of the computer's requests; an older computer keeps the read-only list.
  const canStage = useCanStage();
  const [tree, setTree] = useState(false);
  const info = useQuery({
    queryKey: ['git-info', projectId],
    queryFn: () => request<{ ok?: boolean; repositories?: Repository[]; error?: string }>('get-project-git-info', [projectId]),
    enabled: online && !!projectId,
    // No event says a working tree changed: read it again each time.
    refetchOnMount: 'always',
  });
  const repositories = info.data?.repositories || [];
  // Back from the Git Graph, where an action may have changed everything.
  const { refetch } = info;
  useFocusEffect(useCallback(() => { refetch(); }, [refetch]));

  return (
    <View style={styles.screen}>
      <Stack.Screen
        options={{
          title: title ? `${title} · Git` : 'Git',
          headerRight: () => (
            <Pressable onPress={() => setTree((t) => !t)} hitSlop={10} accessibilityRole="button">
              <Text style={styles.headerButton}>{tree ? 'List' : 'Tree'}</Text>
            </Pressable>
          ),
        }}
      />
      <ScrollView refreshControl={<RefreshControl refreshing={info.isRefetching} onRefresh={() => { info.refetch(); }} tintColor={colors.accent} />}>
        {info.isLoading ? <ActivityIndicator style={{ margin: spacing.xl }} color={colors.accent} /> : null}
        {info.data?.error ? <Text style={styles.empty}>{info.data.error}</Text> : null}
        {!info.isLoading && !repositories.length ? <Text style={styles.empty}>No folder of this project is attached yet.</Text> : null}
        {repositories.map((repo) => <RepositoryBlock key={repo.path} projectId={projectId} repo={repo} tree={tree} canStage={canStage} />)}
      </ScrollView>
    </View>
  );
}

function RepositoryBlock({ projectId, repo, tree, canStage }: { projectId: string; repo: Repository; tree: boolean; canStage: boolean }) {
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState<string | null>(null);
  const changes = repo.changes || [];
  const sync = [repo.ahead ? `↑${repo.ahead}` : null, repo.behind ? `↓${repo.behind}` : null].filter(Boolean).join(' ');
  const sections = canStage ? stagingSections(changes) : [];

  const openDiff = (change: Change, side: Side | null) => router.push({
    pathname: '/diff',
    params: { projectId, folder: repo.path, path: change.path, ...(side ? { side } : {}), ...(change.oldPath ? { oldPath: change.oldPath } : {}) },
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

  const rowsOf = (items: Change[]): TreeRow<Change>[] => tree ? treeRows(items) : items.map((change) => ({ kind: 'file', key: change.path, depth: 0, name: change.path, item: change }));

  const renderRows = (items: Change[], section: Section | null) => rowsOf(items).map((row) => {
    if (row.kind === 'folder') {
      return (
        <View key={`${section?.key ?? ''}:${row.key}`} style={[styles.folderRow, { paddingLeft: row.depth * 16 }]}>
          <FileIcon name={row.name.split(' / ').pop() || row.name} dir size={18} />
          <Text style={styles.folder} numberOfLines={1}>{row.name}</Text>
        </View>
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
          <Pressable onPress={() => router.push({ pathname: '/graph', params: { projectId, folder: repo.path } })} style={styles.graphLink} accessibilityRole="button">
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
  screen: { flex: 1, backgroundColor: colors.background },
  headerButton: { color: colors.accent, fontSize: 16, paddingHorizontal: spacing.sm },
  empty: { color: colors.textFaint, textAlign: 'center', marginTop: spacing.xl, paddingHorizontal: spacing.lg },
  repo: { padding: spacing.lg, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border, gap: 4 },
  repoName: { color: colors.text, fontSize: 17, fontWeight: '600' },
  meta: { color: colors.textFaint, fontSize: 12 },
  graphLink: { paddingVertical: spacing.sm, alignSelf: 'flex-start' },
  link: { color: colors.accent, fontSize: 15 },
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
