import Ionicons from '@expo/vector-icons/Ionicons';
import { Fragment, useState } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Sheet } from '@/components/Sheet';
import { KEY_GROUPS, MORE_KEYS, type TerminalKey } from '@/terminal/keys';
import { colors, spacing } from '@/theme';

const mono = Platform.select({ ios: 'Menlo', default: 'monospace' });
const FADE = 28;

function Key({ item, onPress, wide }: { item: TerminalKey; onPress: () => void; wide?: boolean }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [wide ? styles.sheetKey : styles.key, pressed && styles.pressed]} accessibilityRole="button" accessibilityLabel={item.hint}>
      <Text style={styles.keyText}>{item.label}</Text>
    </Pressable>
  );
}

/**
 * The keys a phone keyboard lacks (Esc, Tab, ^C, arrows, Enter), in groups
 * on one row that scrolls sideways, and a last key that opens the rest.
 * Each key goes straight to the terminal.
 */
export function TerminalKeys({ send }: { send: (data: string) => void }) {
  const [more, setMore] = useState(false);
  return (
    <View style={styles.row}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.keys} keyboardShouldPersistTaps="always">
        {KEY_GROUPS.map((group, index) => (
          <Fragment key={index}>
            {index > 0 ? <View style={styles.divider} /> : null}
            {group.map((key) => <Key key={key.label} item={key} onPress={() => send(key.data)} />)}
          </Fragment>
        ))}
        <View style={styles.divider} />
        <Pressable onPress={() => setMore(true)} style={({ pressed }) => [styles.key, pressed && styles.pressed]} accessibilityRole="button" accessibilityLabel="More keys">
          <Ionicons name="ellipsis-horizontal" size={18} color={colors.text} />
        </Pressable>
      </ScrollView>
      {/* The row goes on past the edge: fade it out there. */}
      <View pointerEvents="none" style={styles.fade} />
      <Sheet visible={more} title="More keys" onClose={() => setMore(false)}>
        <View style={styles.grid}>
          {MORE_KEYS.map((key) => (
            <View key={key.label} style={styles.cell}>
              <Key item={key} wide onPress={() => { setMore(false); send(key.data); }} />
            </View>
          ))}
        </View>
      </Sheet>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { height: 52 },
  // Room at the end for the fade, so the last key is clear of it once scrolled there.
  keys: { alignItems: 'center', gap: 6, paddingLeft: spacing.sm, paddingRight: FADE },
  key: { minWidth: 44, height: 44, paddingHorizontal: spacing.sm, borderRadius: 10, backgroundColor: colors.raised, alignItems: 'center', justifyContent: 'center' },
  pressed: { backgroundColor: colors.border },
  keyText: { color: colors.text, fontSize: 14, fontFamily: mono },
  divider: { width: 1, height: 22, backgroundColor: colors.border, marginHorizontal: 2 },
  fade: { position: 'absolute', top: 0, bottom: 0, right: 0, width: FADE, backgroundImage: `linear-gradient(to right, rgba(26,26,36,0), ${colors.surface})` },
  grid: { flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: spacing.md, paddingBottom: spacing.sm },
  cell: { width: '25%', padding: 4 },
  sheetKey: { height: 52, borderRadius: 10, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
});
