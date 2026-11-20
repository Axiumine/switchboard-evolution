import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { PROJECT_TABS } from '@/projects/tabs';
import { colors } from '@/theme';
import { WINDOW_TABS, type WindowTab } from './window-spec';

/**
 * The other tabs of a project, in the header of its window: choosing one
 * shows it in this window (the window's native title keeps the tab it was
 * opened with). Not Session: its terminal stays in the main window.
 */
export function WindowTabs({ active, onChange }: { active: WindowTab; onChange: (tab: WindowTab) => void }) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.scroll} contentContainerStyle={styles.row} accessibilityRole="tablist">
      {WINDOW_TABS.map((key) => {
        const selected = key === active;
        const label = PROJECT_TABS.find((t) => t.key === key)?.label ?? key;
        return (
          <Pressable key={key} onPress={() => onChange(key)} style={styles.tab} accessibilityRole="tab" accessibilityState={{ selected }}>
            <Text style={[styles.label, selected && styles.labelActive]}>{label}</Text>
            {selected ? <View style={styles.underline} /> : null}
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  // Takes the room the title and the buttons leave, and scrolls when that is little.
  scroll: { flex: 1, alignSelf: 'stretch' },
  row: { alignItems: 'center' },
  tab: { height: 52, paddingHorizontal: 12, justifyContent: 'center' },
  label: { color: colors.textDim, fontSize: 14, fontWeight: '600' },
  labelActive: { color: '#e4e4fa' },
  underline: { position: 'absolute', left: 8, right: 8, bottom: 0, height: 2, borderRadius: 1, backgroundColor: colors.accent },
});
