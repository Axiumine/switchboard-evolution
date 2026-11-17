import { Pressable, ScrollView, StyleSheet, Text } from 'react-native';

import { repoLabel, showRepoChips } from '@/git/repo-choice';
import { colors, spacing } from '@/theme';

/**
 * The Git tab's repository sub-tabs, one chip per repository (the Files tab's
 * folder chips, in the same look). Hidden with one repository or none: there is
 * nothing to choose.
 */
export function RepoChips({ repos, selected, onSelect }: { repos: readonly { path: string }[]; selected: string | null; onSelect: (path: string) => void }) {
  if (!showRepoChips(repos)) return null;
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chips} contentContainerStyle={styles.content} accessibilityLabel="Repository">
      {repos.map((repo) => {
        const active = repo.path === selected;
        return (
          <Pressable
            key={repo.path}
            onPress={() => onSelect(repo.path)}
            style={[styles.chip, active && styles.chipActive]}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
          >
            <Text style={[styles.label, active && styles.labelActive]} numberOfLines={1}>{repoLabel(repo.path)}</Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  chips: { flexGrow: 0, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  content: { gap: spacing.sm, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  chip: { flexDirection: 'row', alignItems: 'center', height: 34, paddingHorizontal: spacing.md, borderRadius: 8, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, maxWidth: 220 },
  chipActive: { borderColor: 'rgba(128,136,255,0.5)', backgroundColor: 'rgba(128,136,255,0.16)' },
  label: { color: colors.textDim, fontSize: 13.5, fontWeight: '600', flexShrink: 1 },
  labelActive: { color: '#e4e4fa' },
});
