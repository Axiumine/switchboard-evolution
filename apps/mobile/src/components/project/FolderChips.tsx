import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { FolderChip } from '@/files/model';
import { colors, spacing } from '@/theme';

/**
 * The project's attached folders as chips, the desktop header's: first a dashed
 * "+ folder" chip that attaches another, then one chip per folder reading
 * "name · branch" with the branch in bold (a worktree's own branch, not its
 * repository's). They wrap over as many lines as they need, in the sheet the
 * header's folders button opens.
 */
export function FolderChips({ chips, onAttach }: { chips: readonly FolderChip[]; onAttach: () => void }) {
  return (
    <View style={styles.wrap}>
      <Pressable onPress={onAttach} style={({ pressed }) => [styles.chip, styles.add, pressed && styles.pressed]} accessibilityRole="button" accessibilityLabel="Attach a folder">
        <Ionicons name="add" size={15} color={colors.accent} />
        <Text style={styles.addLabel}>folder</Text>
      </Pressable>
      {chips.map((chip) => (
        <View key={chip.path} style={styles.chip} accessible accessibilityLabel={chip.branch ? `${chip.name}, branch ${chip.branch}` : chip.name}>
          <Ionicons name={chip.kind === 'worktree' ? 'git-branch-outline' : 'folder-outline'} size={14} color={colors.textFaint} />
          <Text style={styles.label} numberOfLines={1}>
            {chip.name}
            {chip.branch ? <>{' · '}<Text style={styles.branch}>{chip.branch}</Text></> : null}
          </Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, paddingHorizontal: spacing.xl, paddingVertical: spacing.md },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 6, height: 34, paddingHorizontal: spacing.md, borderRadius: 8, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, maxWidth: '100%' },
  add: { borderStyle: 'dashed', borderColor: 'rgba(128,136,255,0.5)', backgroundColor: 'transparent' },
  addLabel: { color: colors.accent, fontSize: 13.5, fontWeight: '600' },
  pressed: { backgroundColor: colors.surface },
  label: { color: colors.textDim, fontSize: 13.5, flexShrink: 1 },
  branch: { color: colors.text, fontWeight: '700' },
});
