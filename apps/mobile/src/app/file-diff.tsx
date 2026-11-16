import { useQuery } from '@tanstack/react-query';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useMemo } from 'react';
import { ActivityIndicator, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';

import { lineDiff } from '@/git/history';
import type { DiffLine } from '@/git/model';
import { request, useConnection } from '@/store/connection';
import { colors, spacing } from '@/theme';

const mono = Platform.select({ ios: 'Menlo', default: 'monospace' });
const LINE_STYLES: Record<DiffLine['kind'], object> = {
  meta: { color: colors.textFaint },
  hunk: { color: colors.accent },
  add: { color: '#8fd19e', backgroundColor: 'rgba(76,175,143,0.12)' },
  del: { color: '#f19aa1', backgroundColor: 'rgba(224,108,117,0.12)' },
  context: { color: colors.text },
};

type Change = { ok: boolean; error?: string; oldContent?: string; newContent?: string; path?: string };

/** What one commit of a file's Timeline changed in it (no hash: the uncommitted changes). */
export default function FileDiffScreen() {
  const { root, path, title, hash, repoPath, oldPath, detail } = useLocalSearchParams<{
    root: string; path: string; title?: string; hash?: string; repoPath?: string; oldPath?: string; detail?: string;
  }>();
  const online = useConnection((s) => s.status.state === 'online');
  const change = useQuery({
    queryKey: ['timeline-diff', root, path, hash || null, repoPath, oldPath],
    queryFn: () => request<Change>('get-file-timeline-diff', [root, path, hash || null, repoPath || null, oldPath || null]),
    enabled: online && !!root && !!path,
  });
  const lines = useMemo(() => (change.data?.ok ? lineDiff(change.data.oldContent || '', change.data.newContent || '') : []), [change.data]);

  let body;
  if (change.isLoading) body = <ActivityIndicator style={{ margin: spacing.xl }} color={colors.accent} />;
  else if (!change.data?.ok) body = <Text style={styles.note}>{change.data?.error || 'Could not read this change.'}</Text>;
  else {
    body = (
      <ScrollView style={styles.body}>
        <ScrollView horizontal contentContainerStyle={styles.content}>
          <View>
            {lines.length ? lines.map((line, i) => <Text key={i} style={[styles.line, LINE_STYLES[line.kind]]}>{line.text || ' '}</Text>)
              : <Text style={styles.line}>No differences.</Text>}
          </View>
        </ScrollView>
      </ScrollView>
    );
  }

  return (
    <View style={styles.screen}>
      <Stack.Screen options={{ title: title || path }} />
      {detail ? <Text style={styles.detail} numberOfLines={2}>{detail}</Text> : null}
      {body}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  detail: { color: colors.textDim, fontSize: 12, fontFamily: mono, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  body: { flex: 1 },
  content: { paddingVertical: spacing.sm },
  line: { fontFamily: mono, fontSize: 12, lineHeight: 17, paddingHorizontal: spacing.md, color: colors.text },
  note: { color: colors.textFaint, textAlign: 'center', marginTop: spacing.xl, paddingHorizontal: spacing.lg },
});
