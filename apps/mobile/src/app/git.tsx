import { Stack, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { RepositoryBlock } from '@/components/git/RepositoryBlock';
import { usePullRefresh } from '@/components/PullRefresh';
import { useGitInfo } from '@/git/info-query';
import { useCanStage } from '@/git/stage-requests';
import { colors, spacing } from '@/theme';

/** A project's repositories: branch, what changed (as a list or a tree) and the latest commits. */
export default function GitScreen() {
  const { projectId, title } = useLocalSearchParams<{ projectId: string; title?: string }>();
  // Staging needs both of the computer's requests; an older computer keeps the read-only list.
  const canStage = useCanStage();
  const [tree, setTree] = useState(false);
  const info = useGitInfo(projectId);
  const repositories = info.data?.repositories || [];
  // Back from the Git Graph, where an action may have changed everything.
  const { refetch } = info;
  useFocusEffect(useCallback(() => { refetch(); }, [refetch]));
  const pull = usePullRefresh(() => info.refetch());

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
      <ScrollView refreshControl={pull}>
        {info.isLoading ? <ActivityIndicator style={{ margin: spacing.xl }} color={colors.accent} /> : null}
        {info.data?.error ? <Text style={styles.empty}>{info.data.error}</Text> : null}
        {!info.isLoading && !repositories.length ? <Text style={styles.empty}>No folder of this project is attached yet.</Text> : null}
        {repositories.map((repo) => <RepositoryBlock key={repo.path} projectId={projectId} repo={repo} tree={tree} canStage={canStage} />)}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  headerButton: { color: colors.accent, fontSize: 16, paddingHorizontal: spacing.sm },
  empty: { color: colors.textFaint, textAlign: 'center', marginTop: spacing.xl, paddingHorizontal: spacing.lg },
});
