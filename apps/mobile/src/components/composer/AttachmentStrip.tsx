import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { colors, spacing } from '@/theme';
import type { AttachmentItem, Attachments } from './useAttachments';

const SIZE = 68;

function Thumbnail({ item, onRetry, onRemove }: { item: AttachmentItem; onRetry: () => void; onRemove: () => void }) {
  const image = item.mimeType?.startsWith('image/');
  const label = item.state === 'uploading' ? 'uploading' : item.state === 'done' ? 'uploaded' : `did not upload: ${item.error}`;
  return (
    <View style={styles.thumb} accessible accessibilityLabel={`${item.name}, ${label}`}>
      {image ? (
        <Image source={{ uri: item.uri }} style={styles.image} contentFit="cover" />
      ) : (
        <View style={styles.file}>
          <Ionicons name="document-text-outline" size={22} color={colors.textDim} />
          <Text style={styles.fileName} numberOfLines={2}>{item.name}</Text>
        </View>
      )}
      {item.state === 'uploading' ? (
        <View style={[styles.overlay, styles.dim]}><ActivityIndicator color={colors.text} /></View>
      ) : null}
      {item.state === 'done' ? (
        <View style={styles.check}><Ionicons name="checkmark" size={12} color="#fff" /></View>
      ) : null}
      {item.state === 'failed' ? (
        item.retryable === false ? (
          <View style={[styles.overlay, styles.failed]}><Text style={styles.failedText}>{item.error}</Text></View>
        ) : (
          <Pressable onPress={onRetry} style={[styles.overlay, styles.failed]} accessibilityRole="button" accessibilityLabel={`Retry ${item.name}`}>
            <Ionicons name="refresh" size={20} color="#fff" />
            <Text style={styles.failedText}>Retry</Text>
          </Pressable>
        )
      ) : null}
      <Pressable onPress={onRemove} hitSlop={11} style={styles.remove} accessibilityRole="button" accessibilityLabel={`Remove ${item.name}`}>
        <Ionicons name="close" size={14} color="#fff" />
      </Pressable>
    </View>
  );
}

/** The attachments above a composer's field: 68pt thumbnails that show their upload, with retry and remove. */
export function AttachmentStrip({ attachments, hint }: { attachments: Attachments; hint?: string }) {
  if (!attachments.items.length) return null;
  return (
    <View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row} keyboardShouldPersistTaps="always">
        {attachments.items.map((item) => (
          <Thumbnail key={item.id} item={item} onRetry={() => attachments.retry(item.id)} onRemove={() => attachments.remove(item.id)} />
        ))}
      </ScrollView>
      {hint ? <Text style={styles.hint} numberOfLines={2}>{hint}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  // Room above and to the right for the remove buttons.
  row: { gap: spacing.sm, paddingHorizontal: spacing.sm, paddingTop: spacing.sm + 4, paddingBottom: spacing.xs, paddingRight: spacing.lg },
  thumb: { width: SIZE, height: SIZE, borderRadius: 12, backgroundColor: colors.raised, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
  image: { width: '100%', height: '100%', borderRadius: 12 },
  file: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 4, gap: 2 },
  fileName: { color: colors.textDim, fontSize: 10, textAlign: 'center' },
  overlay: { ...StyleSheet.absoluteFill, borderRadius: 12, alignItems: 'center', justifyContent: 'center', padding: 4 },
  dim: { backgroundColor: 'rgba(17,17,24,0.55)' },
  failed: { backgroundColor: 'rgba(224,108,117,0.75)' },
  failedText: { color: '#fff', fontSize: 11, fontWeight: '700', textAlign: 'center' },
  check: { position: 'absolute', left: 4, bottom: 4, width: 18, height: 18, borderRadius: 9, backgroundColor: colors.running, alignItems: 'center', justifyContent: 'center' },
  remove: { position: 'absolute', top: -6, right: -6, width: 22, height: 22, borderRadius: 11, backgroundColor: 'rgba(0,0,0,0.75)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.25)', alignItems: 'center', justifyContent: 'center' },
  hint: { color: colors.textDim, fontSize: 12, paddingHorizontal: spacing.md, paddingBottom: spacing.xs },
});
