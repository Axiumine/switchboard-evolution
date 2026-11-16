import { useState } from 'react';
import { KeyboardAvoidingView, Modal, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { colors, spacing } from '@/theme';

/** A small dialog with one text field. Resolves through onSubmit with the trimmed text. `message` is a line under the title. */
export function TextPrompt({ visible, title, message, placeholder, initialValue = '', confirm = 'Save', onSubmit, onClose }: {
  visible: boolean;
  title: string;
  message?: string;
  placeholder?: string;
  initialValue?: string;
  confirm?: string;
  onSubmit: (value: string) => void;
  onClose: () => void;
}) {
  const [value, setValue] = useState(initialValue);
  const submit = () => { onClose(); onSubmit(value.trim()); };
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
            style={styles.input}
            placeholderTextColor={colors.textFaint}
          />
          <View style={styles.actions}>
            <Pressable onPress={onClose} style={styles.button} accessibilityRole="button">
              <Text style={[styles.buttonText, { color: colors.textDim }]}>Cancel</Text>
            </Pressable>
            <Pressable onPress={submit} style={styles.button} accessibilityRole="button">
              <Text style={styles.buttonText}>{confirm}</Text>
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
  buttonText: { color: colors.accent, fontSize: 15, fontWeight: '600' },
});
