import { router, Stack } from 'expo-router';
import { useRef, useState } from 'react';
import { ActivityIndicator, Alert, StyleSheet, Text, View } from 'react-native';

import { CodeEditor, type CodeEditorHandle } from '@/components/files/CodeEditor';
import { FontSizeButtons } from '@/components/files/FontSizeButtons';
import { HeaderButton } from '@/components/HeaderButton';
import { savePromptImproverSettings, usePromptImproverInfo } from '@/prompt-improver/queries';
import { DEFAULT_TEMPLATE, MAX_TEMPLATE, PLACEHOLDERS } from '@/shared/vendor/prompt-improver-model';
import { colors, spacing } from '@/theme';

/**
 * The improver prompt in the editor: the instructions the CLI follows to
 * rewrite a prompt, with the placeholders it understands under it. Save keeps
 * it on the computer (the default is stored as none, so a better default
 * arrives by itself); Reset puts the default back in the editor.
 */
export default function PromptImproverTemplateScreen() {
  const info = usePromptImproverInfo();
  const editor = useRef<CodeEditorHandle>(null);
  const [doc, setDoc] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const [saving, setSaving] = useState(false);
  const defaultTemplate = info.data?.defaultTemplate || DEFAULT_TEMPLATE;
  const start = doc ?? info.data?.settings.template ?? defaultTemplate;

  const save = async () => {
    let text = '';
    try { text = (await editor.current?.getText()) ?? ''; } catch { return; }
    if (!text.trim()) { Alert.alert('The improver prompt is empty', 'Reset it to the default to start again.'); return; }
    if (text.length > MAX_TEMPLATE) { Alert.alert('Too long', `At most ${MAX_TEMPLATE} characters.`); return; }
    setSaving(true);
    try {
      await savePromptImproverSettings({ template: text === defaultTemplate ? null : text });
      editor.current?.saved(text);
      router.back();
    } catch (err: any) {
      Alert.alert('Not saved', err?.message || String(err));
    } finally {
      setSaving(false);
    }
  };
  const reset = () => { setDoc(defaultTemplate); setVersion((v) => v + 1); };

  if (!info.data) {
    return <View style={styles.center}><ActivityIndicator color={colors.accent} /></View>;
  }
  return (
    <View style={styles.fill}>
      <Stack.Screen options={{ title: 'Improver prompt' }} />
      <View style={styles.toolbar}>
        <FontSizeButtons />
        <HeaderButton icon="refresh-outline" accessibilityLabel="Reset to the default" onPress={reset} />
        <HeaderButton icon="arrow-undo-outline" accessibilityLabel="Undo" onPress={() => editor.current?.undo()} />
        <HeaderButton icon="arrow-redo-outline" accessibilityLabel="Redo" onPress={() => editor.current?.redo()} />
        <HeaderButton icon="save-outline" accessibilityLabel="Save" onPress={save} disabled={saving} />
      </View>
      <View style={styles.fill}>
        <CodeEditor key={version} ref={editor} text={start} filename="improver-prompt.md" editable wrap />
      </View>
      <View style={styles.placeholders}>
        {PLACEHOLDERS.map((p) => (
          <Text key={p.name} style={styles.placeholder}><Text style={styles.code}>{p.name}</Text> {p.description}</Text>
        ))}
        <Text style={styles.placeholder}>{'After the prompt the computer adds, out of sight, the session\'s last turns and the commands, skills and MCP servers it has, with the instruction to use one when it clearly fits the task.'}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: colors.background },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background },
  toolbar: { flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center', gap: spacing.xs, paddingHorizontal: spacing.sm, paddingVertical: spacing.xs, backgroundColor: colors.surface },
  placeholders: { padding: spacing.md, gap: 3, backgroundColor: colors.surface, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  placeholder: { color: colors.textFaint, fontSize: 12, lineHeight: 16 },
  code: { color: colors.text, fontFamily: 'monospace' },
});
