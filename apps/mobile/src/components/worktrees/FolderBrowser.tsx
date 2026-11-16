import Ionicons from '@expo/vector-icons/Ionicons';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';

import { request, useConnection } from '@/store/connection';
import { colors, spacing } from '@/theme';
import { MONO } from '@/components/form';

type Listing = { path: string; parent: string | null; folders: { name: string; path: string }[]; error?: string };

/**
 * The "Choose…" of the desktop's worktree dialogs: the computer's folders,
 * one level at a time (list-folders, as the folder picker screen reads them),
 * inside a form. `onPick` gets the folder shown.
 */
export function FolderBrowser({ start, pickLabel, onPick }: { start: string | null; pickLabel: string; onPick: (folder: string) => void }) {
  const online = useConnection((s) => s.status.state === 'online');
  const [path, setPath] = useState<string | null>(start);
  const [hidden, setHidden] = useState(false);
  const listing = useQuery({
    queryKey: hidden ? ['folders', path, true] : ['folders', path],
    queryFn: () => request<Listing>('list-folders', hidden ? [path, true] : path ? [path] : []),
    enabled: online,
  });
  const here = listing.data?.path;
  const rows = [...(listing.data?.parent ? [{ name: '..', path: listing.data.parent }] : []), ...(listing.data?.folders || [])];

  return (
    <View style={styles.box}>
      <Text style={styles.path} numberOfLines={2}>{here || ' '}</Text>
      {listing.data?.error ? <Text style={styles.error}>{listing.data.error}</Text> : null}
      {/* Scrolls inside the form's own scroll. */}
      <ScrollView style={styles.list} nestedScrollEnabled keyboardShouldPersistTaps="handled">
        {listing.isLoading ? <ActivityIndicator style={{ margin: spacing.md }} color={colors.accent} /> : null}
        {rows.map((item) => (
          <Pressable key={item.path} onPress={() => setPath(item.path)} style={({ pressed }) => [styles.row, pressed && styles.pressed]} accessibilityRole="button">
            <Ionicons name={item.name === '..' ? 'arrow-up' : 'folder-outline'} size={16} color={colors.textDim} />
            <Text style={styles.name} numberOfLines={1}>{item.name === '..' ? 'Up' : item.name}</Text>
          </Pressable>
        ))}
        {!listing.isLoading && !rows.length && !listing.data?.error ? <Text style={styles.empty}>No folders inside.</Text> : null}
      </ScrollView>
      <View style={styles.footer}>
        <Text style={styles.hiddenLabel}>Hidden folders</Text>
        <Switch value={hidden} onValueChange={setHidden} trackColor={{ true: colors.accent }} />
        <View style={styles.flex} />
        <Pressable onPress={() => here && onPick(here)} disabled={!here} style={[styles.pick, !here && { opacity: 0.5 }]} accessibilityRole="button">
          <Text style={styles.pickText}>{pickLabel}</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  box: { borderRadius: 10, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, overflow: 'hidden', marginTop: spacing.sm },
  path: { color: colors.textDim, fontSize: 12, fontFamily: MONO, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  error: { color: colors.danger, fontSize: 13, paddingHorizontal: spacing.md },
  list: { maxHeight: 320 },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.md, minHeight: 42, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  pressed: { backgroundColor: colors.raised },
  name: { color: colors.text, fontSize: 15, flex: 1 },
  empty: { color: colors.textFaint, fontSize: 13, padding: spacing.md },
  footer: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  hiddenLabel: { color: colors.textDim, fontSize: 13 },
  flex: { flex: 1 },
  pick: { backgroundColor: colors.accent, borderRadius: 8, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  pickText: { color: '#fff', fontSize: 14, fontWeight: '600' },
});
