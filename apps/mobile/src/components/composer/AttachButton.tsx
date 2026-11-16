import Ionicons from '@expo/vector-icons/Ionicons';
import { useState } from 'react';
import { ActivityIndicator, Alert, Platform, Pressable, StyleSheet } from 'react-native';

import { Sheet } from '@/components/Sheet';
import type { AttachmentSource } from '@/sessions/attachments';
import { useConnection } from '@/store/connection';
import { colors } from '@/theme';
import type { Attachments } from './useAttachments';

// iOS cannot show the picker while the sheet is still sliding away.
const AFTER_SHEET_MS = Platform.OS === 'ios' ? 450 : 0;

/**
 * The round + left of a composer's field: a sheet to take photos from the
 * library or the camera, or a file. Hide it when the computer cannot take
 * attachments (useCapability('save-session-attachment')).
 */
export function AttachButton({ attachments }: { attachments: Attachments }) {
  const [open, setOpen] = useState(false);
  const computer = useConnection((s) => s.desktop?.name) || 'the computer';

  const pick = (source: AttachmentSource) => {
    setTimeout(() => {
      attachments.add(source).catch((err: any) => Alert.alert('Could not attach', err?.message || String(err)));
    }, AFTER_SHEET_MS);
  };

  return (
    <>
      <Pressable
        onPress={() => setOpen(true)}
        disabled={attachments.full || attachments.picking}
        hitSlop={2}
        style={({ pressed }) => [styles.button, pressed && styles.pressed, attachments.full && styles.off]}
        accessibilityRole="button"
        accessibilityLabel="Attach photos or files"
        accessibilityState={{ disabled: attachments.full, busy: attachments.picking }}
      >
        {attachments.picking ? <ActivityIndicator size="small" color={colors.text} /> : <Ionicons name="add" size={24} color={colors.text} />}
      </Pressable>
      <Sheet
        visible={open}
        title="Attach"
        onClose={() => setOpen(false)}
        options={[
          { label: 'Photo library', onPress: () => pick('library') },
          { label: 'Take a photo', onPress: () => pick('camera') },
          { label: 'Choose a file', onPress: () => pick('file') },
        ]}
        footer={`Files are saved on ${computer} and their paths are pasted into the session, so Claude can read them.`}
      />
    </>
  );
}

const styles = StyleSheet.create({
  // 40pt visible; with the hit slop the target is 44.
  button: { width: 40, height: 40, borderRadius: 20, margin: 2, backgroundColor: colors.raised, alignItems: 'center', justifyContent: 'center' },
  pressed: { backgroundColor: colors.border },
  off: { opacity: 0.4 },
});
