import { Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, spacing } from '@/theme';

export type FileView = 'tree' | 'list';

/** Tree / List, for any list of changed files. */
export function FileViewToggle({ view, onChange }: { view: FileView; onChange: (view: FileView) => void }) {
  return (
    <View style={styles.toggle}>
      {(['tree', 'list'] as const).map((option) => (
        <Pressable key={option} onPress={() => onChange(option)} style={[styles.button, view === option && styles.active]} accessibilityRole="button" accessibilityState={{ selected: view === option }}>
          <Text style={[styles.text, view === option && styles.textActive]}>{option === 'tree' ? 'Tree' : 'List'}</Text>
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  toggle: { flexDirection: 'row', borderRadius: 6, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border, overflow: 'hidden' },
  button: { paddingHorizontal: spacing.sm, paddingVertical: 3 },
  active: { backgroundColor: colors.raised },
  text: { color: colors.textFaint, fontSize: 12 },
  textActive: { color: colors.text },
});
