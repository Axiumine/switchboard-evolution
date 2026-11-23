import Ionicons from '@expo/vector-icons/Ionicons';
import { useQuery } from '@tanstack/react-query';
import * as Clipboard from 'expo-clipboard';
import { router } from 'expo-router';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';

import { Field, MONO, SelectRow } from '@/components/form';
import { Sheet, type SheetOption } from '@/components/Sheet';
import { TextPrompt } from '@/components/TextPrompt';
import { deleteTrack, detachFolder, toggleProjectDone, toggleTrackDone, wakeProject } from '@/projects/flows';
import type { Project, ProjectFolder, Track } from '@/projects/model';
import { branchHelp, cliChoices, folderDetail, projectCwdChoices, trackColor, trackCwdChoices, type FolderGit } from '@/projects/settings';
import type { ProjectTab } from '@/projects/tabs';
import { useProjectUiStore } from '@/projects/ui-store';
import { projectSnoozed, snoozeWakeDescription } from '@/shared/vendor/snooze';
import { request, useConnection } from '@/store/connection';
import { colors, spacing } from '@/theme';
import { basename } from '@/worktrees/model';
import type { Run } from '../actions';
import { RemoveProjectPrompt } from '../RemoveProjectPrompt';
import { Section } from '../Section';
import { useTabScroll } from '../useTabScroll';

type Harness = { id: string; label: string; enabled: boolean };

const SAVED_MS = 1600;

/**
 * The project's settings, as on the desktop: its name, where sessions start,
 * the attached folders and the worktree branch, the tracks with their folder
 * and CLI, and finishing, waking or removing the project. Changes save as
 * they are made: a text when the field is left, a choice at once.
 */
export function SettingsTab({ project, now, run, onSelectTab }: {
  project: Project;
  now: number;
  run: Run;
  /** Switches the project page to another tab (from useProjectTab). */
  onSelectTab: (tab: ProjectTab) => void;
}) {
  const scroll = useTabScroll(project.id, 'settings');
  const online = useConnection((s) => s.status.state === 'online');
  const harnesses = useQuery({ queryKey: ['harnesses'], queryFn: () => request<Harness[]>('get-harnesses'), enabled: online });
  const folderKey = project.folders.map((f) => f.path).join('\n');
  const git = useQuery({
    queryKey: ['project-git-status', project.id, folderKey],
    queryFn: () => request<{ byPath?: Record<string, FolderGit> }>('get-project-git-status', [project.id]),
    enabled: online && project.folders.length > 0,
  });
  const [folderMenu, setFolderMenu] = useState<ProjectFolder | 'root' | null>(null);
  const [newTrack, setNewTrack] = useState(false);
  const [removing, setRemoving] = useState(false);
  // A text field shows what was typed until it is saved. One that is cleared, or
  // whose save fails, is drawn again from the stored value: only that field, so
  // another one being typed in keeps its text and focus.
  const [resets, setResets] = useState<Record<string, number>>({});
  const reset = (key: string) => setResets((r) => ({ ...r, [key]: (r[key] || 0) + 1 }));
  const [saved, setSaved] = useState<string | null>(null);
  const savedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (savedTimer.current) clearTimeout(savedTimer.current); }, []);

  const flash = (key: string) => {
    setSaved(key);
    if (savedTimer.current) clearTimeout(savedTimer.current);
    savedTimer.current = setTimeout(() => setSaved(null), SAVED_MS);
  };
  /** Save through the page's run (which says what went wrong); a text field `key` gets its "Saved", or its stored value back. */
  const save = (method: string, params: unknown[], key?: string) => {
    let ok = false;
    return run(method, params, () => { ok = true; if (key) flash(key); }).then(() => { if (!ok && key) reset(key); });
  };
  const update = (fields: Record<string, unknown>, key?: string) => save('update-project', [project.id, fields], key);
  const updateTrack = (track: Track, fields: Record<string, unknown>, key?: string) => save('update-track', [track.id, fields], key);

  const saveName = (text: string) => {
    const name = text.trim();
    if (!name || name === project.name) { reset('name'); return; }
    update({ name }, 'name');
  };

  const shared = project.sharedBranch !== false;
  const saveBranch = (sharedBranch: boolean, text: string) => {
    const branchName = text.trim();
    if (sharedBranch === shared && branchName === (project.branchName || '')) return;
    // The phone's channel takes null, not an empty name, for "the slug".
    update({ sharedBranch, branchName: branchName || null }, 'branch');
  };

  // The project's own folders open in its Files tab, on that folder.
  const showFiles = (root: string, title: string) => {
    if (root === project.root || project.folders.some((f) => f.path === root)) {
      const { get, patch } = useProjectUiStore.getState();
      patch(project.id, { files: { ...get(project.id).files, root } });
      onSelectTab('files');
    } else {
      router.push({ pathname: '/files', params: { root, title } });
    }
  };

  const folderOptions = (target: ProjectFolder | 'root'): SheetOption[] => {
    const path = target === 'root' ? project.root : target.path;
    const options: SheetOption[] = [
      { label: 'Show in Files', onPress: () => showFiles(path, basename(path)) },
      { label: 'Copy path', onPress: () => { Clipboard.setStringAsync(path).catch(() => {}); } },
    ];
    if (target !== 'root') options.push({ label: 'Detach…', hint: target.mode === 'worktree' ? 'its checkout can go too' : 'nothing on disk changes', destructive: true, onPress: () => detachFolder(project, target) });
    return options;
  };

  const snoozed = projectSnoozed(project, now);
  const byPath = git.data?.byPath || {};

  return (
    <>
      <ScrollView {...scroll} keyboardShouldPersistTaps="handled">
        <Section title="Project">
          <FieldLabel title="Name" saved={saved === 'name'} />
          <Field
            key={`name:${project.name}:${resets.name || 0}`}
            defaultValue={project.name}
            onEndEditing={(e) => saveName(e.nativeEvent.text)}
            returnKeyType="done"
            autoCapitalize="sentences"
            maxLength={200}
            accessibilityLabel="Project name"
          />

          <FieldLabel title="Project folder" help="The brief, plan and todos live here." />
          <Pressable onPress={() => setFolderMenu('root')} style={({ pressed }) => [styles.pathRow, pressed && styles.pressed]} accessibilityRole="button" accessibilityLabel={`Project folder, ${project.root}`}>
            <Text style={styles.path} numberOfLines={2} ellipsizeMode="head">{project.root}</Text>
            <Ionicons name="ellipsis-horizontal" size={16} color={colors.textFaint} />
          </Pressable>

          <FieldLabel title="Sessions start in" help="A track can pick its own." />
          <SelectRow
            title="Sessions start in"
            choices={projectCwdChoices(project)}
            selected={project.defaultCwd || ''}
            onSelect={(key) => { if (key !== (project.defaultCwd || '')) update({ defaultCwd: key || null }); }}
          />
        </Section>

        <Section title="Folders" action="Attach…" onAction={() => router.push({ pathname: '/folders', params: { projectId: project.id } })}>
          {project.folders.map((folder) => {
            const isWorktree = folder.mode === 'worktree';
            return (
              <View key={folder.path} style={styles.folderRow}>
                <Pressable onPress={() => setFolderMenu(folder)} style={({ pressed }) => [styles.folderMain, pressed && styles.pressed]} accessibilityRole="button" accessibilityLabel={`${basename(folder.path)}, ${folderDetail(folder, byPath[folder.path])}`}>
                  <Ionicons name={isWorktree ? 'git-branch-outline' : 'folder-outline'} size={16} color={isWorktree ? colors.accent : colors.textDim} />
                  <View style={styles.flex}>
                    <Text style={styles.folderName} numberOfLines={1}>{basename(folder.path)}</Text>
                    <Text style={styles.folderDetail} numberOfLines={2}>{folderDetail(folder, byPath[folder.path])}</Text>
                  </View>
                </Pressable>
                <Pressable onPress={() => detachFolder(project, folder)} hitSlop={6} style={({ pressed }) => [styles.iconButton, pressed && styles.pressed]} accessibilityRole="button" accessibilityLabel={`Detach ${basename(folder.path)}`}>
                  <Ionicons name="close" size={18} color={colors.textFaint} />
                </Pressable>
              </View>
            );
          })}
          {!project.folders.length ? <Text style={styles.empty}>None attached. Sessions run in the project folder.</Text> : null}

          <FieldLabel title="Worktree branch" help={branchHelp(shared)} saved={saved === 'branch'} />
          <View style={styles.switchRow}>
            <Text style={styles.switchLabel}>Same in every repo</Text>
            <Switch value={shared} onValueChange={(value) => saveBranch(value, project.branchName || '')} trackColor={{ true: colors.accent }} />
          </View>
          {shared ? (
            <Field
              key={`branch:${project.branchName || ''}:${resets.branch || 0}`}
              defaultValue={project.branchName || ''}
              placeholder={project.slug || 'branch-name'}
              onEndEditing={(e) => saveBranch(true, e.nativeEvent.text)}
              returnKeyType="done"
              mono
              maxLength={200}
              accessibilityLabel="Worktree branch"
            />
          ) : null}
        </Section>

        <Section title="Tracks" action="New" onAction={() => setNewTrack(true)}>
          {project.tracks.map((track) => (
            <View key={track.id} style={[styles.track, track.status === 'done' && styles.trackDone]}>
              <View style={styles.trackHead}>
                <View style={[styles.dot, { backgroundColor: trackColor(project, track) }]} />
                <View style={styles.flex}>
                  <Field
                    key={`track:${track.id}:${track.name}:${resets[`track:${track.id}`] || 0}`}
                    defaultValue={track.name}
                    onEndEditing={(e) => {
                      const name = e.nativeEvent.text.trim();
                      if (name && name !== track.name) updateTrack(track, { name }, `track:${track.id}`);
                      else reset(`track:${track.id}`);
                    }}
                    returnKeyType="done"
                    autoCapitalize="sentences"
                    maxLength={200}
                    accessibilityLabel={`Track name, ${track.name}`}
                  />
                </View>
                {saved === `track:${track.id}` ? <SavedMark /> : null}
              </View>
              <FieldLabel title="Sessions start in" />
              <SelectRow
                title={`${track.name}: sessions start in`}
                choices={trackCwdChoices(project, track)}
                selected={track.cwd || ''}
                onSelect={(key) => { if (key !== (track.cwd || '')) updateTrack(track, { cwd: key || null }); }}
              />
              <FieldLabel title="CLI for new sessions" />
              <SelectRow
                title={`${track.name}: CLI for new sessions`}
                choices={cliChoices(harnesses.data, track.cli)}
                selected={track.cli || ''}
                onSelect={(key) => { if (key !== (track.cli || '')) updateTrack(track, { cli: key || null }); }}
              />
              <View style={styles.trackActions}>
                <TextButton label={track.status === 'done' ? 'Reopen' : 'Done'} onPress={() => toggleTrackDone(project, track)} />
                <TextButton label="Delete…" danger onPress={() => deleteTrack(project, track)} />
              </View>
            </View>
          ))}
          {!project.tracks.length ? <Text style={styles.empty}>No tracks. A track is one line of work with its own sessions, start folder and CLI.</Text> : null}
        </Section>

        <View style={styles.foot}>
          {snoozed && project.status !== 'done' ? (
            <FootButton label="Wake now" hint={`wakes ${snoozeWakeDescription(project.snoozedUntil!)}`} onPress={() => wakeProject(project)} />
          ) : null}
          <FootButton label={project.status === 'done' ? 'Reopen project' : 'Mark as done'} onPress={() => { toggleProjectDone(project); }} />
          <FootButton label="Remove project…" danger onPress={() => setRemoving(true)} />
          <Text style={styles.note}>Changes save as you make them.</Text>
        </View>
      </ScrollView>

      <Sheet
        visible={!!folderMenu}
        title={folderMenu === 'root' ? 'Project folder' : folderMenu ? basename(folderMenu.path) : ''}
        options={folderMenu ? folderOptions(folderMenu) : []}
        onClose={() => setFolderMenu(null)}
      />
      <RemoveProjectPrompt project={project} visible={removing} onClose={() => setRemoving(false)} after={() => router.back()} />
      <TextPrompt
        visible={newTrack}
        title="New track"
        message="A track is one line of work inside the project, with its own sessions. It starts in the project folder unless you change it."
        placeholder="Build"
        confirm="Create"
        onClose={() => setNewTrack(false)}
        onSubmit={(name) => { if (name) run('create-track', [project.id, { name, cwd: null }]); }}
      />
    </>
  );
}

function FieldLabel({ title, help, saved }: { title: string; help?: string; saved?: boolean }) {
  return (
    <View style={styles.fieldLabel}>
      <View style={styles.labelLine}>
        <Text style={styles.label}>{title}</Text>
        {saved ? <SavedMark /> : null}
      </View>
      {help ? <Text style={styles.help}>{help}</Text> : null}
    </View>
  );
}

function SavedMark() {
  return (
    <View style={styles.saved} accessibilityLiveRegion="polite">
      <Ionicons name="checkmark" size={12} color={colors.running} />
      <Text style={styles.savedText}>Saved</Text>
    </View>
  );
}

function TextButton({ label, onPress, danger }: { label: string; onPress: () => void; danger?: boolean }) {
  return (
    <Pressable onPress={onPress} hitSlop={6} style={({ pressed }) => [styles.textButton, pressed && styles.pressed]} accessibilityRole="button">
      <Text style={[styles.textButtonLabel, danger && { color: colors.danger }]}>{label}</Text>
    </Pressable>
  );
}

function FootButton({ label, hint, onPress, danger }: { label: string; hint?: string; onPress: () => void; danger?: boolean }): ReactNode {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.footButton, danger && styles.footDanger, pressed && styles.pressed]} accessibilityRole="button" accessibilityHint={hint}>
      <Text style={[styles.footLabel, danger && { color: colors.danger }]}>{label}</Text>
      {hint ? <Text style={styles.footHint}>{hint}</Text> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, minWidth: 0 },
  pressed: { opacity: 0.7 },
  fieldLabel: { marginTop: spacing.md, marginBottom: 6, gap: 2 },
  labelLine: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  label: { color: colors.text, fontSize: 14, fontWeight: '600' },
  help: { color: colors.textFaint, fontSize: 12, lineHeight: 17 },
  saved: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  savedText: { color: colors.running, fontSize: 12 },
  pathRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, backgroundColor: colors.surface, borderRadius: 8, paddingHorizontal: spacing.md, minHeight: 44, paddingVertical: spacing.sm },
  path: { flex: 1, color: colors.textDim, fontFamily: MONO, fontSize: 12.5 },
  folderRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  folderMain: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.sm, minHeight: 48 },
  folderName: { color: colors.text, fontSize: 15 },
  folderDetail: { color: colors.textFaint, fontSize: 11.5, fontFamily: MONO, marginTop: 2 },
  iconButton: { width: 40, height: 40, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  empty: { color: colors.textFaint, fontSize: 13, paddingVertical: spacing.sm },
  switchRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.sm },
  switchLabel: { color: colors.text, fontSize: 15 },
  track: { paddingVertical: spacing.md, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  trackDone: { opacity: 0.65 },
  trackHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  dot: { width: 10, height: 10, borderRadius: 5 },
  trackActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: spacing.md, marginTop: spacing.sm },
  textButton: { paddingHorizontal: spacing.sm, paddingVertical: 6, minHeight: 36, justifyContent: 'center' },
  textButtonLabel: { color: colors.accent, fontSize: 14, fontWeight: '600' },
  foot: { padding: spacing.lg, gap: spacing.sm },
  footButton: { borderRadius: 10, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, paddingVertical: 12, paddingHorizontal: spacing.lg, alignItems: 'center' },
  footDanger: { borderColor: 'rgba(224,108,117,0.35)', backgroundColor: 'transparent' },
  footLabel: { color: colors.text, fontSize: 15, fontWeight: '600' },
  footHint: { color: colors.textFaint, fontSize: 12, marginTop: 2 },
  note: { color: colors.textFaint, fontSize: 12, textAlign: 'center', marginTop: spacing.sm },
});
