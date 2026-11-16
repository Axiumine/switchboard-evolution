import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { cancelDownload, useDownload } from '@/files/download';
import { byteSize } from '@/files/model';
import { colors, spacing } from '@/theme';

/** While a file comes down from the computer: its name, how far it got, and Cancel. */
export function DownloadBar() {
  const current = useDownload((s) => s.current);
  if (!current) return null;
  const { name, received, size, cancelled } = current;
  const fraction = size ? Math.min(received / size, 1) : 0;
  const detail = cancelled ? 'Cancelling…'
    : size === null ? 'Starting…'
    : `${byteSize(received)} of ${byteSize(size)} · ${Math.floor(fraction * 100)}%`;
  return (
    <View style={styles.bar} accessibilityLiveRegion="polite">
      <ActivityIndicator size="small" color={colors.accent} />
      <View style={styles.text}>
        <Text style={styles.name} numberOfLines={1}>Downloading {name}</Text>
        <Text style={styles.detail}>{detail}</Text>
        <View style={styles.track}><View style={[styles.fill, { width: `${fraction * 100}%` }]} /></View>
      </View>
      <Pressable onPress={cancelDownload} disabled={cancelled} hitSlop={8} style={styles.cancel} accessibilityRole="button" accessibilityLabel={`Cancel downloading ${name}`}>
        <Text style={[styles.cancelText, cancelled && { color: colors.textFaint }]}>Cancel</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.lg, paddingVertical: spacing.md,
    backgroundColor: colors.raised, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border,
  },
  text: { flex: 1, minWidth: 0, gap: 3 },
  name: { color: colors.text, fontSize: 14, fontWeight: '600' },
  detail: { color: colors.textDim, fontSize: 12 },
  track: { height: 3, borderRadius: 2, backgroundColor: colors.border, overflow: 'hidden', marginTop: 2 },
  fill: { height: 3, backgroundColor: colors.accent },
  cancel: { minHeight: 44, justifyContent: 'center' },
  cancelText: { color: colors.accent, fontSize: 15, fontWeight: '600' },
});
