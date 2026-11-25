import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, ScrollView, StyleSheet, Text } from 'react-native';

import { repoLabel, showRepoChips } from '@/git/repo-choice';
import { colors, spacing } from '@/theme';

type Chip = { path: string; label?: string };

/**
 * The Git tab's repository sub-tabs, one chip per repository (the Files tab's
 * folder chips, in the same look). Hidden with one repository or none: there is
 * nothing to choose. A tap on a chip selects that repository.
 *
 * With `onToggle` (History, Pull Requests, Worktrees) several repositories can
 * be shown at once: each chip starts with a small check, always there since a
 * phone has no hover. Tapping the check, or long pressing the chip, adds or
 * removes the repository; tapping the name shows only that one. `checked` are
 * the repositories shown, `selected` the primary one (underlined while several
 * are shown), `repoColors` paint a shown repository's check and name as they
 * are painted on its rows. `label` names a chip that is not a folder (a
 * repository of the Worktrees view).
 */
export function RepoChips({ repos, selected, onSelect, checked, onToggle, repoColors }: {
  repos: readonly Chip[]; selected: string | null; onSelect: (path: string) => void;
  checked?: readonly string[]; onToggle?: (path: string) => void; repoColors?: Record<string, string>;
}) {
  if (!showRepoChips(repos)) return null;
  const multi = !!onToggle;
  const shown = checked ?? (selected ? [selected] : []);
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chips} contentContainerStyle={styles.content} accessibilityLabel="Repository" keyboardShouldPersistTaps="handled">
      {repos.map((repo) => {
        const on = multi ? shown.includes(repo.path) : repo.path === selected;
        const tint = multi && on ? repoColors?.[repo.path] : undefined;
        const name = repo.label ?? repoLabel(repo.path);
        return (
          <Pressable
            key={repo.path}
            onPress={() => onSelect(repo.path)}
            onLongPress={onToggle ? () => onToggle(repo.path) : undefined}
            style={[styles.chip, on && styles.chipActive, tint ? { borderColor: `${tint}99`, backgroundColor: `${tint}1f` } : null]}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
            accessibilityHint={onToggle ? 'Shows only this repository. Long press to add or remove it.' : undefined}
          >
            {onToggle ? (
              <Pressable
                onPress={() => onToggle(repo.path)}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 6 }}
                style={styles.check}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: on }}
                accessibilityLabel={`Show ${name}`}
              >
                <Ionicons name={on ? 'checkbox' : 'square-outline'} size={17} color={tint ?? (on ? colors.accent : colors.textFaint)} />
              </Pressable>
            ) : null}
            <Text
              style={[styles.label, on && styles.labelActive, tint ? { color: tint } : null, multi && shown.length > 1 && repo.path === selected && styles.labelPrimary]}
              numberOfLines={1}
            >
              {name}
            </Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  chips: { flexGrow: 0, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  content: { gap: spacing.sm, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 6, height: 34, paddingHorizontal: spacing.md, borderRadius: 8, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, maxWidth: 240 },
  chipActive: { borderColor: 'rgba(128,136,255,0.5)', backgroundColor: 'rgba(128,136,255,0.16)' },
  check: { marginLeft: -4, marginRight: -1 },
  label: { color: colors.textDim, fontSize: 13.5, fontWeight: '600', flexShrink: 1 },
  labelActive: { color: '#e4e4fa' },
  labelPrimary: { textDecorationLine: 'underline' },
});
