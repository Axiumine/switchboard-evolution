import Ionicons from '@expo/vector-icons/Ionicons';
import { useState, type ReactNode } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, Switch, Text, TextInput, View, type TextInputProps } from 'react-native';

import { Sheet } from '@/components/Sheet';
import { colors, spacing } from '@/theme';
import type { Choice } from '@/worktrees/model';

// The pieces of the forms that stand for the desktop's dialogs and settings
// (labels, hints, radio rows, selects and checkboxes), in the phone's form
// style (schedule.tsx). The worktree screens and the project's Settings tab use them.

export const MONO = 'Menlo';

export function Label({ children }: { children: ReactNode }) {
  return <Text style={styles.label}>{children}</Text>;
}

export function Hint({ children, mono }: { children: ReactNode; mono?: boolean }) {
  return <Text style={[styles.hint, mono && styles.mono]}>{children}</Text>;
}

export function ErrorText({ children }: { children: ReactNode }) {
  return children ? <Text style={styles.error} accessibilityLiveRegion="polite">{children}</Text> : null;
}

export function Field(props: TextInputProps & { mono?: boolean }) {
  const { mono, style, ...rest } = props;
  return (
    <TextInput
      placeholderTextColor={colors.textFaint}
      autoCapitalize="none"
      autoCorrect={false}
      spellCheck={false}
      {...rest}
      style={[styles.input, mono && styles.mono, rest.multiline && styles.multiline, style]}
    />
  );
}

/** One of a few choices, as a row of chips. */
export function Chips<K extends string>({ items, selected, onSelect }: { items: readonly { key: K; label: string }[]; selected: K | null; onSelect: (key: K) => void }) {
  return (
    <View style={styles.chips}>
      {items.map((item) => {
        const on = selected === item.key;
        return (
          <Pressable key={item.key} onPress={() => onSelect(item.key)} style={[styles.chip, on && styles.chipOn]} accessibilityRole="radio" accessibilityState={{ selected: on }}>
            <Text style={[styles.chipText, on && styles.chipTextOn]}>{item.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/**
 * One of many choices (branches): the current one in a row, the list in a
 * sheet. A disabled choice is listed with why, and explains itself if picked.
 */
export function SelectRow({ title, choices, selected, onSelect, placeholder = 'Choose…', loading, disabledReason }: {
  title: string;
  choices: Choice[];
  selected: string;
  onSelect: (key: string) => void;
  placeholder?: string;
  loading?: boolean;
  disabledReason?: (choice: Choice) => string;
}) {
  const [open, setOpen] = useState(false);
  const current = choices.find((c) => c.key === selected);
  return (
    <>
      <Pressable
        onPress={() => setOpen(true)}
        disabled={loading || !choices.length}
        style={({ pressed }) => [styles.select, pressed && styles.pressed]}
        accessibilityRole="button"
        accessibilityLabel={`${title}: ${current?.label || placeholder}`}
      >
        <Text style={[styles.selectText, !current && { color: colors.textFaint }]} numberOfLines={1}>{current?.label || placeholder}</Text>
        {loading ? <ActivityIndicator size="small" color={colors.accent} /> : <Ionicons name="chevron-down" size={16} color={colors.textFaint} />}
      </Pressable>
      <Sheet
        visible={open}
        title={title}
        options={choices.map((choice) => ({
          label: choice.label,
          hint: choice.key === selected ? 'chosen' : undefined,
          onPress: () => {
            if (choice.disabled) Alert.alert(choice.label, disabledReason?.(choice) || 'This one cannot be picked.');
            else onSelect(choice.key);
          },
        }))}
        onClose={() => setOpen(false)}
      />
    </>
  );
}

/** A checkbox of the desktop's dialogs: a switch with its label and a line of help. */
export function SwitchRow({ label, help, value, onChange, disabled }: { label: ReactNode; help?: ReactNode; value: boolean; onChange: (value: boolean) => void; disabled?: boolean }) {
  return (
    <View style={[styles.switchRow, disabled && { opacity: 0.5 }]}>
      <View style={styles.flex}>
        <Text style={styles.switchLabel}>{label}</Text>
        {help ? <Text style={styles.switchHelp}>{help}</Text> : null}
      </View>
      <Switch value={value} onValueChange={onChange} disabled={disabled} trackColor={{ true: colors.accent }} />
    </View>
  );
}

/** The screen's main button: accent, or red for one that removes something. */
export function PrimaryButton({ label, busyLabel, busy, disabled, danger, onPress }: { label: string; busyLabel?: string; busy?: boolean; disabled?: boolean; danger?: boolean; onPress: () => void }) {
  const off = busy || disabled;
  return (
    <Pressable onPress={onPress} disabled={off} style={[styles.primary, danger && styles.primaryDanger, off && { opacity: 0.5 }]} accessibilityRole="button" accessibilityState={{ disabled: off, busy }}>
      {busy && !busyLabel ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryText}>{busy ? busyLabel : label}</Text>}
    </Pressable>
  );
}

/** A mono path or command inside running text. */
export function Code({ children }: { children: ReactNode }) {
  return <Text style={styles.mono}>{children}</Text>;
}

export const formStyles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.lg, gap: spacing.sm, paddingBottom: 48 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background, padding: spacing.xl },
  empty: { color: colors.textFaint, textAlign: 'center' },
  title: { color: colors.text, fontSize: 17, fontWeight: '600' },
  warn: { color: colors.attention, fontSize: 13, lineHeight: 18, marginTop: spacing.sm },
  link: { color: colors.accent, fontSize: 14, paddingVertical: spacing.xs },
});

const styles = StyleSheet.create({
  label: { color: colors.textDim, fontSize: 13, fontWeight: '600', marginTop: spacing.md },
  hint: { color: colors.textFaint, fontSize: 12, lineHeight: 17 },
  mono: { fontFamily: MONO, fontSize: 12.5 },
  error: { color: colors.danger, fontSize: 13, lineHeight: 18, marginTop: spacing.sm },
  input: { color: colors.text, backgroundColor: colors.surface, borderRadius: 8, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, fontSize: 15 },
  multiline: { minHeight: 76, textAlignVertical: 'top' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  chip: { paddingHorizontal: spacing.md, paddingVertical: 6, borderRadius: 14, borderWidth: 1, borderColor: colors.border },
  chipOn: { borderColor: colors.accent, backgroundColor: 'rgba(128,136,255,0.15)' },
  chipText: { color: colors.textDim, fontSize: 13 },
  chipTextOn: { color: colors.text },
  select: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: 44, backgroundColor: colors.surface, borderRadius: 8, paddingHorizontal: spacing.md },
  selectText: { flex: 1, color: colors.text, fontSize: 15 },
  pressed: { opacity: 0.7 },
  flex: { flex: 1 },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginTop: spacing.md },
  switchLabel: { color: colors.text, fontSize: 15 },
  switchHelp: { color: colors.textFaint, fontSize: 12, lineHeight: 17, marginTop: 2 },
  primary: { backgroundColor: colors.accent, borderRadius: 10, paddingVertical: 13, alignItems: 'center', marginTop: spacing.lg },
  primaryDanger: { backgroundColor: colors.danger },
  primaryText: { color: '#fff', fontSize: 16, fontWeight: '600' },
});
