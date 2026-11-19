import Ionicons from '@expo/vector-icons/Ionicons';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text } from 'react-native';

import { Sheet, type SheetOption } from '@/components/Sheet';
import { useSessionListPrefs } from '@/sessions/list-prefs';
import { PIN_FILTERS, SESSION_ORDERS, STATUS_FILTERS } from '@/sessions/model';
import { colors, spacing } from '@/theme';

type Menu = 'status' | 'pinned' | 'order' | null;

const TITLES = { status: 'Show sessions', pinned: 'Pinned sessions', order: 'Order sessions' } as const;

/**
 * The Sessions tab's row under the search: a combo each for the status, the
 * pinned filter and the order, and the "Group by folders" checkbox. It
 * scrolls sideways where the four do not fit. A combo that narrows the list
 * is lit, as on the worktrees tab.
 */
export function SessionListControls() {
  const { status, pinned, order, groupByFolders, setStatus, setPinned, setOrder, setGroupByFolders } = useSessionListPrefs();
  const [menu, setMenu] = useState<Menu>(null);

  const statusChoice = STATUS_FILTERS.find((f) => f.key === status) ?? STATUS_FILTERS[0];
  const pinnedChoice = PIN_FILTERS.find((f) => f.key === pinned) ?? PIN_FILTERS[0];
  const orderChoice = SESSION_ORDERS.find((o) => o.key === order) ?? SESSION_ORDERS[0];

  const options = (): SheetOption[] => {
    if (menu === 'status') return STATUS_FILTERS.map((f) => ({ label: f.label, hint: f.key === status ? 'chosen' : undefined, onPress: () => setStatus(f.key) }));
    if (menu === 'pinned') return PIN_FILTERS.map((f) => ({ label: f.label, hint: f.key === pinned ? 'chosen' : undefined, onPress: () => setPinned(f.key) }));
    if (menu === 'order') return SESSION_ORDERS.map((o) => ({ label: o.label, hint: o.key === order ? 'chosen' : undefined, onPress: () => setOrder(o.key) }));
    return [];
  };

  return (
    <>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.scroll} contentContainerStyle={styles.row} keyboardShouldPersistTaps="handled">
        <Combo icon="funnel" label={`Status: ${statusChoice.label}`} on={status !== 'all'} a11y={`Status: ${statusChoice.label}`} onPress={() => setMenu('status')} />
        <Combo icon="star" label={`Pinned: ${pinnedChoice.label}`} on={pinned !== 'all'} a11y={`Pinned: ${pinnedChoice.label}`} onPress={() => setMenu('pinned')} />
        <Combo icon="swap-vertical" label={orderChoice.short} on={false} a11y={`Order: ${orderChoice.label}`} onPress={() => setMenu('order')} />
        <Pressable
          onPress={() => setGroupByFolders(!groupByFolders)}
          style={({ pressed }) => [styles.pill, groupByFolders && styles.on, pressed && styles.pressed]}
          accessibilityRole="checkbox"
          accessibilityLabel="Group by folders"
          accessibilityState={{ checked: groupByFolders }}
        >
          <Ionicons name={groupByFolders ? 'checkbox' : 'square-outline'} size={16} color={groupByFolders ? colors.accent : colors.textDim} />
          <Text style={[styles.text, groupByFolders && styles.onText]} numberOfLines={1}>Group by folders</Text>
        </Pressable>
      </ScrollView>
      <Sheet visible={!!menu} title={menu ? TITLES[menu] : ''} options={options()} onClose={() => setMenu(null)} />
    </>
  );
}

function Combo({ icon, label, on, a11y, onPress }: { icon: 'funnel' | 'star' | 'swap-vertical'; label: string; on: boolean; a11y: string; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.pill, on && styles.on, pressed && styles.pressed]}
      accessibilityRole="button"
      accessibilityLabel={a11y}
      accessibilityHint="Opens the choices"
    >
      <Ionicons name={icon} size={14} color={on ? colors.accent : colors.textDim} />
      <Text style={[styles.text, on && styles.onText]} numberOfLines={1}>{label}</Text>
      <Ionicons name="chevron-down" size={12} color={on ? colors.accent : colors.textFaint} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  // Out to the screen edges (the parent pads by lg), so the pills scroll under them.
  scroll: { marginHorizontal: -spacing.lg, flexGrow: 0 },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.lg },
  pill: { flexDirection: 'row', alignItems: 'center', gap: 5, height: 34, paddingHorizontal: spacing.md, borderRadius: 17, borderWidth: 1, borderColor: colors.border },
  on: { backgroundColor: 'rgba(128,136,255,0.18)', borderColor: colors.accent },
  pressed: { backgroundColor: colors.surface },
  text: { color: colors.textDim, fontSize: 13 },
  onText: { color: colors.text },
});
