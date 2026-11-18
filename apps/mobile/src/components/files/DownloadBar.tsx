import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { cancelDownload, useDownload } from '@/files/download';
import { byteSize } from '@/files/model';
import { colors, spacing } from '@/theme';

/**
 * While a file comes down from the computer: its name, how far it got, and
 * Cancel. At the bottom of every screen (the root layout puts it under the
 * screens, which leave it the bottom safe area), so a download stays in sight
 * from anywhere in the app. While the computer is out of reach it says the
 * download waits, and goes on by itself once it is back.
 */
export function DownloadBar() {
  const current = useDownload((s) => s.current);
  const insets = useSafeAreaInsets();
  if (!current) return null;
  const { name, received, size, cancelled, waiting } = current;
  const fraction = size ? Math.min(received / size, 1) : 0;
  const amount = size === null ? '' : `${byteSize(received)} of ${byteSize(size)}`;
  const detail = cancelled ? 'Cancelling…'
    : waiting ? `Waiting for the computer${amount ? ` · ${amount}` : ''}`
    : size === null ? 'Starting…'
    : `${amount} · ${Math.floor(fraction * 100)}%`;
  return (
    <View style={[styles.bar, { paddingBottom: insets.bottom + spacing.md }]} accessibilityLiveRegion="polite">
      {waiting && !cancelled
        ? <View style={styles.pausedDot} accessibilityLabel="Paused" />
        : <ActivityIndicator size="small" color={colors.accent} />}
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
  // Where the spinner was: the download is not moving, it waits.
  pausedDot: { width: 20, height: 20, alignItems: 'center', justifyContent: 'center', borderRadius: 10, borderWidth: 2, borderColor: colors.textFaint },
  cancel: { minHeight: 44, justifyContent: 'center' },
  cancelText: { color: colors.accent, fontSize: 15, fontWeight: '600' },
});
