import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Chips, Code, ErrorText, Field, formStyles, Hint, Label } from '@/components/form';
import { useProject } from '@/projects/queries';
import { colors, spacing } from '@/theme';
import {
  DEFAULT_PATH_TEMPLATE, patternsList, patternsText, previewTemplate, START_OPTIONS,
  type StartAfter, type WorktreeRepository, type WorktreeSettings,
} from '@/worktrees/model';
import { ask, patchCachedSettings, setNotice, useProjectWorktrees } from '@/worktrees/queries';

/** The project's worktree settings, as the desktop's dialog has them. */
export default function WorktreeSettingsScreen() {
  const { projectId } = useLocalSearchParams<{ projectId: string }>();
  const listing = useProjectWorktrees(projectId);
  const { project } = useProject(projectId);
  if (!listing.data) {
    return (
      <View style={formStyles.center}>
        <Stack.Screen options={{ title: 'Worktree settings' }} />
        {listing.isLoading ? <ActivityIndicator color={colors.accent} /> : <Text style={formStyles.empty}>{(listing.error as Error | null)?.message || 'Not connected to the computer.'}</Text>}
      </View>
    );
  }
  const sample = listing.data.repositories.find((r) => !r.error) || null;
  return <SettingsForm projectId={projectId} projectRoot={project?.root || ''} settings={listing.data.settings} sample={sample} />;
}

function SettingsForm({ projectId, projectRoot, settings, sample }: { projectId: string; projectRoot: string; settings: WorktreeSettings; sample: WorktreeRepository | null }) {
  const [template, setTemplate] = useState(settings.pathTemplate || '');
  const [copy, setCopy] = useState(patternsText(settings.copyPatterns));
  const [ignore, setIgnore] = useState(patternsText(settings.copyIgnores));
  const [post, setPost] = useState(settings.postCreateCmd || '');
  const [pre, setPre] = useState(settings.preRemoveCmd || '');
  const [after, setAfter] = useState<StartAfter>(settings.startAfterCreate || 'none');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const save = async () => {
    setError('');
    setSaving(true);
    const result = await ask<{ ok?: boolean; error?: string; settings?: WorktreeSettings }>('set-worktree-settings', [projectId, {
      pathTemplate: template.trim(),
      copyPatterns: patternsList(copy),
      copyIgnores: patternsList(ignore),
      postCreateCmd: post,
      preRemoveCmd: pre,
      startAfterCreate: after,
    }]);
    setSaving(false);
    if (!result.ok || !result.settings) { setError(result.error || 'Could not save the settings.'); return; }
    patchCachedSettings(projectId, result.settings);
    setNotice(projectId, { kind: 'ok', text: 'Saved the worktree settings' });
    router.back();
  };

  return (
    <KeyboardAvoidingView style={formStyles.screen} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={Platform.OS === 'ios' ? 100 : 0}>
      <Stack.Screen
        options={{
          title: 'Worktree settings',
          headerRight: () => (
            <Pressable onPress={save} disabled={saving} hitSlop={10} accessibilityRole="button">
              <Text style={styles.headerButton}>{saving ? 'Saving…' : 'Save'}</Text>
            </Pressable>
          ),
        }}
      />
      <ScrollView contentContainerStyle={formStyles.content} keyboardShouldPersistTaps="handled">
        <Label>New worktree folder</Label>
        <Field value={template} onChangeText={setTemplate} mono maxLength={500} placeholder={DEFAULT_PATH_TEMPLATE} />
        <Hint>
          <Code>$BASE_PATH</Code> the repository, <Code>$BASE_ROOT</Code> its parent folder, <Code>$BASE_NAME</Code> its name,{' '}
          <Code>$REF_NAME</Code> the branch, <Code>$INDEX</Code> a number, <Code>$PROJECT_ROOT</Code> this project&apos;s folder.
        </Hint>
        {sample ? (
          <Hint>For <Text style={{ color: colors.text, fontWeight: '600' }}>{sample.name}</Text>: <Code>{previewTemplate(template || DEFAULT_PATH_TEMPLATE, sample, 'feature/example', projectRoot)}</Code></Hint>
        ) : null}

        <Label>Copy into new worktrees</Label>
        <Field value={copy} onChangeText={setCopy} mono multiline placeholder={'.env*\nconfig/local.json'} />
        <Hint>One pattern per line, relative to the repository (<Code>*</Code>, <Code>**</Code>, <Code>?</Code>). Files git does not check out, like .env or local config. A matching folder is copied whole.</Hint>
        <Label>But not</Label>
        <Field value={ignore} onChangeText={setIgnore} mono multiline placeholder=".env.example" />

        <Label>After creating, run</Label>
        <Field value={post} onChangeText={setPost} mono maxLength={2000} placeholder="npm install" />
        <Label>Before removing, run</Label>
        <Field value={pre} onChangeText={setPre} mono maxLength={2000} placeholder="npm run teardown" />
        <Hint>Both run in the worktree, in your login shell on the computer, with SWITCHBOARD_WORKTREE, SWITCHBOARD_MAIN_WORKTREE and SWITCHBOARD_BRANCH set. If the one before removing fails, the worktree stays.</Hint>

        <Label>After creating, open</Label>
        <Chips items={START_OPTIONS} selected={after} onSelect={setAfter} />
        <ErrorText>{error}</ErrorText>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  headerButton: { color: colors.accent, fontSize: 16, fontWeight: '600', paddingHorizontal: spacing.sm },
});
