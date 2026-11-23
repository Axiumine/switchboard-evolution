import { useState } from 'react';
import { KeyboardAvoidingView, Modal, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { colors, spacing } from '@/theme';

/**
 * A small dialog with one text field. Resolves through onSubmit with the
 * trimmed text. `message` is a line under the title. With `canSubmit` the
 * confirm button waits until the text passes it (a word to type, say), and
 * `destructive` paints it as a removal.
 */
export function TextPrompt({ visible, title, message, placeholder, initialValue = '', confirm = 'Save', onSubmit, onClose, canSubmit, destructive, autoCapitalize }: {
  visible: boolean;
  title: string;
  message?: string;
  placeholder?: string;
  initialValue?: string;
  confirm?: string;
  onSubmit: (value: string) => void;
  onClose: () => void;
  canSubmit?: (value: string) => boolean;
  destructive?: boolean;
  autoCapitalize?: 'none' | 'sentences' | 'words' | 'characters';
}) {
  const [value, setValue] = useState(initialValue);
  const ready = !canSubmit || canSubmit(value);
  const submit = () => { if (!ready) return; onClose(); onSubmit(value.trim()); };
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose} onShow={() => setValue(initialValue)}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.backdrop}>
        <View style={styles.dialog}>
          <Text style={styles.title}>{title}</Text>
          {message ? <Text style={styles.message}>{message}</Text> : null}
          <TextInput
            value={value}
            onChangeText={setValue}
            autoFocus
            selectTextOnFocus
            onSubmitEditing={submit}
            returnKeyType="done"
            placeholder={placeholder}
            autoCapitalize={autoCapitalize}
            autoCorrect={autoCapitalize === 'none' ? false : undefined}
            style={styles.input}
            placeholderTextColor={colors.textFaint}
          />
          <View style={styles.actions}>
            <Pressable onPress={onClose} style={styles.button} accessibilityRole="button">
              <Text style={[styles.buttonText, { color: colors.textDim }]}>Cancel</Text>
            </Pressable>
            <Pressable onPress={submit} disabled={!ready} style={[styles.button, !ready && styles.buttonOff]} accessibilityRole="button" accessibilityState={{ disabled: !ready }}>
              <Text style={[styles.buttonText, destructive && { color: colors.danger }]}>{confirm}</Text>
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', padding: spacing.xl },
  dialog: { backgroundColor: colors.raised, borderRadius: 14, padding: spacing.lg, gap: spacing.md },
  title: { color: colors.text, fontSize: 16, fontWeight: '600' },
  message: { color: colors.textDim, fontSize: 13, lineHeight: 18 },
  input: {
    color: colors.text,
    fontSize: 15,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    backgroundColor: colors.surface,
  },
  actions: { flexDirection: 'row', justifyContent: 'flex-end', gap: spacing.sm },
  button: { paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  buttonOff: { opacity: 0.4 },
  buttonText: { color: colors.accent, fontSize: 15, fontWeight: '600' },
});
