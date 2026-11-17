import { useQuery } from '@tanstack/react-query';
import * as Clipboard from 'expo-clipboard';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';

import { usePullRefresh } from '@/components/PullRefresh';
import type { Timeline, TimelineEntry } from '@/files/model';
import { relativeTime } from '@/sessions/model';
import { request, useConnection } from '@/store/connection';
import { colors, spacing } from '@/theme';

type Row = { key: string; entry: TimelineEntry | null; subject: string; meta: string };

/**
 * The Timeline of a file or folder, as on the desktop's Files tab: the
 * commits that changed it, newest first, following a file's renames. A
 * file's commit opens its change; a long press copies the commit id.
 */
export default function TimelineScreen() {
  const { root, path, name, dir } = useLocalSearchParams<{ root: string; path: string; name?: string; dir?: string }>();
  const online = useConnection((s) => s.status.state === 'online');
  const timeline = useQuery({
    queryKey: ['timeline', root, path],
    queryFn: () => request<Timeline>('get-file-timeline', [root, path]),
    enabled: online && !!root && !!path,
  });
  const pull = usePullRefresh(() => timeline.refetch());
  const data = timeline.data;
  const isDir = !!dir;
  const rows: Row[] = [];
  if (data?.uncommitted && !isDir) rows.push({ key: 'working', entry: null, subject: 'Uncommitted changes', meta: 'Working tree' });
  for (const entry of data?.entries || []) {
    rows.push({ key: entry.hash, entry, subject: entry.subject, meta: `${entry.authorName} · ${relativeTime(new Date(entry.date).toISOString())} · ${entry.shortHash}` });
  }

  const openChange = (row: Row) => {
    if (isDir) return;
    router.push({
      pathname: '/file-diff',
      params: {
        root, path, title: name || path,
        hash: row.entry?.hash || '', repoPath: row.entry?.path || '', oldPath: row.entry?.oldPath || '',
        detail: row.entry ? `${row.entry.shortHash} · ${row.entry.subject}` : 'Uncommitted changes',
      },
    });
  };

  let empty = null;
  if (timeline.isLoading) empty = <ActivityIndicator style={{ margin: spacing.xl }} color={colors.accent} />;
  else if (!data?.ok) empty = <Text style={styles.note}>{data?.error || 'Could not read the history.'}</Text>;
  else if (!data.repoRoot) empty = <Text style={styles.note}>Not in a Git repository, so there is no history to show.</Text>;
  else empty = <Text style={styles.note}>No commits yet.</Text>;

  return (
    <View style={styles.screen}>
      <Stack.Screen options={{ title: `Timeline · ${name || path}` }} />
      <FlatList
        data={rows}
        keyExtractor={(row) => row.key}
        refreshControl={pull}
        renderItem={({ item }) => (
          <Pressable
            onPress={() => openChange(item)}
            onLongPress={() => { if (item.entry) Clipboard.setStringAsync(item.entry.hash).catch(() => {}); }}
            style={({ pressed }) => [styles.row, pressed && styles.pressed]}
            accessibilityRole={isDir ? undefined : 'button'}
          >
            <View style={[styles.dot, !item.entry && styles.dotWorking]} />
            <View style={styles.text}>
              <Text style={styles.subject} numberOfLines={2}>{item.subject}</Text>
              <Text style={styles.meta} numberOfLines={1}>{item.meta}</Text>
            </View>
          </Pressable>
        )}
        ListEmptyComponent={empty}
        ListFooterComponent={rows.length ? <Text style={styles.footer}>{isDir ? 'Long-press a commit to copy its id.' : 'Tap a commit to see what it changed. Long-press to copy its id.'}</Text> : undefined}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md, minHeight: 56, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm },
  pressed: { backgroundColor: colors.surface },
  dot: { width: 9, height: 9, borderRadius: 5, borderWidth: 2, borderColor: colors.accent, marginTop: 6 },
  dotWorking: { borderColor: colors.attention, backgroundColor: 'rgba(224,160,80,0.3)' },
  text: { flex: 1, gap: 2 },
  subject: { color: colors.text, fontSize: 15 },
  meta: { color: colors.textFaint, fontSize: 12 },
  note: { color: colors.textFaint, textAlign: 'center', marginTop: spacing.xl, paddingHorizontal: spacing.lg },
  footer: { color: colors.textFaint, fontSize: 12, padding: spacing.lg },
});
