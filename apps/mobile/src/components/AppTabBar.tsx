import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import { useCapability } from '@/store/connection';
import { colors } from '@/theme';

type Icon = keyof typeof Ionicons.glyphMap;

/** The tabs, in the desktop sidebar strip's order. The Task Manager only shows when the computer has it. */
export const APP_TABS: readonly { name: string; label: string; icon: Icon }[] = [
  { name: 'projects', label: 'Projects', icon: 'briefcase-outline' },
  { name: 'index', label: 'Sessions', icon: 'terminal-outline' },
  { name: 'stats', label: 'Stats', icon: 'bar-chart-outline' },
  { name: 'processes', label: 'Task Manager', icon: 'hardware-chip-outline' },
  { name: 'settings', label: 'Settings', icon: 'settings-outline' },
];

/**
 * The tab bar, as the desktop's sidebar strip: Projects, Sessions, Stats, the
 * Task Manager and Settings. `selected` are the tabs on screen (two on a
 * Surface Duo open across both screens: Projects, and the one on the right).
 */
export function AppTabBar({ selected, onTab, bottomInset, style }: {
  selected: readonly string[];
  onTab: (name: string) => void;
  bottomInset: number;
  style?: StyleProp<ViewStyle>;
}) {
  const taskManager = useCapability('get-process-usage');
  return (
    <View style={[styles.bar, { paddingBottom: bottomInset }, style]} accessibilityRole="tablist">
      {APP_TABS.filter((tab) => tab.name !== 'processes' || taskManager).map(({ name, label, icon }) => {
        const on = selected.includes(name);
        const color = on ? colors.accent : colors.textFaint;
        return (
          <Pressable key={name} style={styles.item} onPress={() => onTab(name)} accessibilityRole="tab" accessibilityState={{ selected: on }} accessibilityLabel={label}>
            <Ionicons name={icon} size={22} color={color} />
            <Text style={[styles.label, { color }]} numberOfLines={1}>{label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { flexDirection: 'row', backgroundColor: colors.surface, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  item: { flex: 1, alignItems: 'center', paddingTop: 8, paddingBottom: 6, gap: 2, minWidth: 0 },
  label: { fontSize: 11 },
});
