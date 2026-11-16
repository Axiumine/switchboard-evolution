import type { Ref } from 'react';
import { StyleSheet, TextInput, type TextInputInstance, type TextInputProps } from 'react-native';

import { colors, spacing } from '@/theme';

const LINE = 21;
const MAX_LINES = 5;
const PADDING = 12;

/**
 * The text field of a composer: rounded, at least `minHeight` tall, growing
 * with its text up to five lines and scrolling after that. Return makes a
 * new line; the composer's Send button sends.
 */
export function ComposerField({ minHeight = 44, style, ref, ...props }: TextInputProps & { minHeight?: number; ref?: Ref<TextInputInstance> }) {
  return (
    <TextInput
      ref={ref}
      multiline
      autoCorrect
      placeholderTextColor={colors.textFaint}
      textAlignVertical="center"
      {...props}
      style={[styles.input, { minHeight }, style]}
    />
  );
}

const styles = StyleSheet.create({
  input: {
    flex: 1,
    maxHeight: LINE * MAX_LINES + PADDING * 2,
    color: colors.text,
    backgroundColor: colors.background,
    borderRadius: 22,
    paddingHorizontal: spacing.lg,
    paddingTop: PADDING,
    paddingBottom: PADDING,
    fontSize: 15,
    lineHeight: LINE,
  },
});
