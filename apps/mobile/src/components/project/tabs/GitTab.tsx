import { router, useFocusEffect } from 'expo-router';
import { useCallback, useMemo, useState, type ReactNode } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { FileViewToggle, type FileView } from '@/components/git/FileViewToggle';
import { GitGraphView } from '@/components/git/GitGraphView';
import { RepositoryBlock } from '@/components/git/RepositoryBlock';
import { usePullRefresh } from '@/components/PullRefresh';
import { useGitInfo } from '@/git/info-query';
import { chooseRepo, historyRepos, type RepoRef } from '@/git/repo-choice';
import { useCanStage } from '@/git/stage-requests';
import type { Project } from '@/projects/model';
import { GIT_VIEWS, type GitView } from '@/projects/tabs';
import { useProjectUi } from '@/projects/ui-store';
import { colors, spacing } from '@/theme';
import { RepoChips } from '../RepoChips';
import { SectionLink } from '../Section';
import { WorktreesTab } from './WorktreesTab';

/**
 * The Git tab, as on the desktop: Changes | History | Worktrees. Each view is
 * built when first shown and kept, so its scroll and sheets survive switching;
 * the project remembers which one was open.
 */
export function GitTab({ project, active = true }: { project: Project; active?: boolean }) {
  const [view, patchUi] = useProjectUi(project.id, (ui) => ui.gitView ?? 'changes');
  const [visited, setVisited] = useState<GitView[]>([view]);
  if (!visited.includes(view)) setVisited([...visited, view]);

  const bodies: Record<GitView, ReactNode> = {
    changes: <ChangesView project={project} active={active && view === 'changes'} />,
    history: <HistoryView project={project} />,
    worktrees: <WorktreesTab project={project} active={active && view === 'worktrees'} />,
  };

  return (
    <View style={styles.screen}>
      <View style={styles.switchBar}>
        <View style={styles.switch} accessibilityRole="tablist" accessibilityLabel="Git view">
          {GIT_VIEWS.map(({ key, label }) => {
            const on = key === view;
            return (
              <Pressable
                key={key}
                onPress={() => patchUi({ gitView: key })}
                style={[styles.option, on && styles.optionOn]}
                accessibilityRole="tab"
                accessibilityState={{ selected: on }}
              >
                <Text style={[styles.optionText, on && styles.optionTextOn]}>{label}</Text>
              </Pressable>
            );
          })}
        </View>
      </View>
      <View style={styles.body}>
        {GIT_VIEWS.filter(({ key }) => key === view || visited.includes(key)).map(({ key }) => (
          <View key={key} style={[styles.body, key !== view && styles.hidden]}>{bodies[key]}</View>
        ))}
      </View>
    </View>
  );
}

/** The selected repository's branch, changes and latest commits, under the repository chips. */
function ChangesView({ project, active }: { project: Project; active: boolean }) {
  const canStage = useCanStage();
  const [fileView, setFileView] = useState<FileView>('list');
  const [gitRepo, patchUi] = useProjectUi(project.id, (ui) => ui.gitRepo);
  const info = useGitInfo(project.id);
  const repositories = info.data?.repositories || [];
  const repo = chooseRepo(repositories, gitRepo);
  // Back from the Git Graph or another screen, or this view shown again: staging or a commit may have changed everything.
  const { refetch } = info;
  useFocusEffect(useCallback(() => { if (active) refetch(); }, [refetch, active]));
  const pull = usePullRefresh(() => info.refetch());

  return (
    <View style={styles.body}>
      <RepoChips repos={repositories} selected={repo?.path ?? null} onSelect={(path) => patchUi({ gitRepo: path })} />
      <ScrollView refreshControl={pull}>
        {repo ? (
          <View style={styles.toggleRow}>
            <FileViewToggle view={fileView} onChange={setFileView} />
          </View>
        ) : null}
        {info.isLoading ? <ActivityIndicator style={{ margin: spacing.xl }} color={colors.accent} /> : null}
        {info.data?.error ? <Text style={styles.text}>{info.data.error}</Text> : null}
        {repo ? (
          <RepositoryBlock
            key={repo.path}
            projectId={project.id}
            repo={repo}
            tree={fileView === 'tree'}
            canStage={canStage}
            onOpenHistory={() => patchUi({ gitView: 'history', gitRepo: repo.path })}
          />
        ) : null}
        {!info.isLoading && !repo && !info.data?.error ? (
          <View style={styles.empty}>
            <Text style={styles.text}>No folder of this project is attached yet.</Text>
            <SectionLink label="Attach a folder…" onPress={() => router.push({ pathname: '/folders', params: { projectId: project.id } })} />
          </View>
        ) : null}
      </ScrollView>
    </View>
  );
}

/** The Git Graph of the selected repository, with its actions, under the repository chips. */
function HistoryView({ project }: { project: Project }) {
  const [gitRepo, patchUi] = useProjectUi(project.id, (ui) => ui.gitRepo);
  // The repositories are read by Changes too: use what is cached. Until they arrive, the project's folders stand in.
  const info = useGitInfo(project.id, false);
  const known = info.data?.repositories;
  const repositories = useMemo(
    () => historyRepos(known ?? project.folders.map((folder): RepoRef => ({ path: folder.path }))),
    [known, project.folders],
  );
  const repo = chooseRepo(repositories, gitRepo);

  return (
    <View style={styles.body}>
      <RepoChips repos={repositories} selected={repo?.path ?? null} onSelect={(path) => patchUi({ gitRepo: path })} />
      {repo ? (
        // Its own state (open row, selection, page) belongs to one repository.
        <GitGraphView
          key={repo.path}
          projectId={project.id}
          folder={repo.path}
          embedded
          onReviewChanges={() => patchUi({ gitView: 'changes', gitRepo: repo.path })}
        />
      ) : (
        <View style={styles.empty}>
          <Text style={styles.text}>No folder of this project is attached yet.</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  body: { flex: 1 },
  hidden: { display: 'none' },
  switchBar: { paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  switch: { height: 36, flexDirection: 'row', backgroundColor: colors.background, borderRadius: 10, padding: 3, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
  option: { flex: 1, alignItems: 'center', justifyContent: 'center', borderRadius: 7 },
  optionOn: { backgroundColor: 'rgba(122,132,255,0.16)' },
  optionText: { color: colors.textDim, fontSize: 13.5, fontWeight: '600' },
  optionTextOn: { color: '#e4e4fa' },
  text: { color: colors.textFaint, fontSize: 13, paddingVertical: spacing.sm },
  empty: { paddingHorizontal: spacing.lg, paddingVertical: spacing.md },
  toggleRow: { alignItems: 'flex-end', paddingHorizontal: spacing.lg, paddingTop: spacing.sm },
});
