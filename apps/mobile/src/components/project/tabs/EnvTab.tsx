import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { usePullRefresh } from '@/components/PullRefresh';
import { envNeedsIgnore, envRows, type EnvRow } from '@/env/model';
import { useEnvFiles, useEnvSupported } from '@/env/queries';
import type { Project } from '@/projects/model';
import { act } from '@/projects/queries';
import { ENV_FILE_NAME, ENV_RULES, loadOrderText } from '@/shared/vendor/env-files-model';
import { colors, spacing } from '@/theme';
import { Section } from '../Section';
import { useTabScroll } from '../useTabScroll';

/**
 * The Env tab, as on the desktop: the local.env.sh of the project folder and
 * of each attached folder, which a session's shell sources before it starts.
 * A row opens its file to read or edit (the file screen); a folder without
 * one has a + that makes it. The rules of what a session loads come first,
 * in the desktop's words (env-files-model.js).
 */
export function EnvTab({ project, active = true }: { project: Project; active?: boolean }) {
  const supported = useEnvSupported();
  const files = useEnvFiles(project.id, active);
  const scroll = useTabScroll(project.id, 'env');
  const pull = usePullRefresh(() => files.refetch());
  const [busy, setBusy] = useState<string | null>(null);

  if (!supported) {
    return <View style={styles.page}><Text style={styles.empty}>The computer does not offer the Env tab. Update Switchboard Evolution on it.</Text></View>;
  }

  const open = (row: EnvRow) => router.push({ pathname: '/file', params: { root: row.path, path: ENV_FILE_NAME } });

  const run = async (row: EnvRow, method: 'create-project-env-file' | 'exclude-project-env-file') => {
    setBusy(row.path);
    try {
      await act(method, [project.id, row.path]);
      await files.refetch();
      if (method === 'create-project-env-file') open(row);
    } catch (err: any) {
      Alert.alert('That did not work', err.message);
    } finally {
      setBusy(null);
    }
  };

  const data = files.data;
  const rows = data && !data.error ? envRows(project, data.entries) : [];

  return (
    <ScrollView {...scroll} refreshControl={pull} contentContainerStyle={styles.content}>
      <Section title="How the files load">
        {ENV_RULES.map((rule) => (
          <View key={rule} style={styles.rule}>
            <Text style={styles.bullet}>•</Text>
            <Text style={styles.ruleText}>{rule}</Text>
          </View>
        ))}
      </Section>
      <Section title="Files">
        {files.isLoading && !data ? <ActivityIndicator color={colors.accent} style={styles.loading} /> : null}
        {data?.error || files.error ? <Text style={styles.error}>{data?.error || (files.error as Error).message}</Text> : null}
        {rows.map((row) => (
          <View key={row.path} style={styles.row}>
            <View style={styles.rowLine}>
              <Pressable
                onPress={() => open(row)}
                disabled={!row.exists}
                style={({ pressed }) => [styles.rowMain, pressed && styles.pressed]}
                accessibilityRole="button"
                accessibilityLabel={row.exists ? `Open ${ENV_FILE_NAME} of ${row.label}` : `${row.label}: no ${ENV_FILE_NAME} yet`}
              >
                <Ionicons name={row.kind === 'project' ? 'grid-outline' : 'folder-outline'} size={18} color={row.exists ? colors.accent : colors.textFaint} />
                <View style={styles.rowText}>
                  <Text style={[styles.label, !row.exists && styles.labelMissing]} numberOfLines={1}>{row.label}</Text>
                  <Text style={styles.detail}>{row.exists ? loadOrderText(row.kind) : `No ${ENV_FILE_NAME} yet`}</Text>
                </View>
                {row.exists ? <Ionicons name="chevron-forward" size={16} color={colors.textFaint} /> : null}
              </Pressable>
              {!row.exists ? (
                <Pressable
                  onPress={() => run(row, 'create-project-env-file')}
                  disabled={busy === row.path}
                  style={({ pressed }) => [styles.add, pressed && styles.pressed]}
                  accessibilityRole="button"
                  accessibilityLabel={`Create ${ENV_FILE_NAME} in ${row.label}`}
                  hitSlop={6}
                >
                  {busy === row.path ? <ActivityIndicator color={colors.accent} size="small" /> : <Ionicons name="add" size={20} color={colors.text} />}
                </Pressable>
              ) : null}
            </View>
            {envNeedsIgnore(row) ? (
              <View style={styles.warn}>
                <Text style={styles.warnText}>Not ignored by Git: it could be committed.</Text>
                <Pressable
                  onPress={() => run(row, 'exclude-project-env-file')}
                  disabled={busy === row.path}
                  style={({ pressed }) => [styles.warnButton, pressed && styles.pressed]}
                  accessibilityRole="button"
                  accessibilityHint="Adds it to this clone's .git/info/exclude, which is never committed"
                >
                  <Text style={styles.warnButtonText}>Ignore in this clone</Text>
                </Pressable>
              </View>
            ) : null}
          </View>
        ))}
      </Section>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, padding: spacing.lg },
  content: { paddingBottom: spacing.xl },
  empty: { color: colors.textFaint, fontSize: 13 },
  loading: { marginVertical: spacing.md },
  error: { color: colors.danger, fontSize: 13, paddingVertical: spacing.sm },
  rule: { flexDirection: 'row', gap: spacing.sm, marginBottom: 6 },
  bullet: { color: colors.textFaint, fontSize: 13, lineHeight: 19 },
  ruleText: { flex: 1, color: colors.textDim, fontSize: 13, lineHeight: 19 },
  row: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border, paddingVertical: spacing.xs },
  rowLine: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  rowMain: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: spacing.md, minHeight: 52, paddingVertical: spacing.sm },
  rowText: { flex: 1, minWidth: 0 },
  label: { color: colors.text, fontSize: 15, fontWeight: '600' },
  labelMissing: { color: colors.textDim },
  detail: { color: colors.textFaint, fontSize: 12, lineHeight: 16, marginTop: 2 },
  add: { width: 40, height: 40, borderRadius: 8, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
  warn: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: spacing.sm, marginLeft: 30, marginBottom: spacing.sm },
  warnText: { color: colors.attention, fontSize: 12 },
  warnButton: { borderWidth: 1, borderColor: 'rgba(224,160,80,0.45)', borderRadius: 6, paddingHorizontal: spacing.sm, paddingVertical: 6, minHeight: 32, justifyContent: 'center' },
  warnButtonText: { color: colors.attention, fontSize: 12.5, fontWeight: '600' },
  pressed: { opacity: 0.7 },
});
