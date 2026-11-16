import { router } from 'expo-router';
import { useState, type ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import type { Project } from '@/projects/model';
import { GIT_VIEWS, type GitView } from '@/projects/tabs';
import { useProjectUi } from '@/projects/ui-store';
import { shortProjectPath } from '@/sessions/model';
import { colors, spacing } from '@/theme';
import { InfoRow, Section, SectionLink } from '../Section';
import { useTabScroll } from '../useTabScroll';
import { WorktreesTab } from './WorktreesTab';

/**
 * The Git tab, as on the desktop: Changes | History | Worktrees. Each view is
 * built when first shown and kept, so its scroll and sheets survive switching;
 * the project remembers which one was open.
 */
export function GitTab({ project, active = true }: { project: Project; active?: boolean }) {
  const [view, patchUi] = useProjectUi(project.id, (ui) => ui.gitView ?? 'changes');
  const [visited, setVisited] = useState<GitView[]>([view]);
  if (!visited.includes(view)) setVisited([...visited, view]);

  const bodies: Record<GitView, ReactNode> = {
    changes: <ChangesView project={project} />,
    history: <HistoryView project={project} />,
    worktrees: <WorktreesTab project={project} active={active && view === 'worktrees'} />,
  };

  return (
    <View style={styles.screen}>
      <View style={styles.switchBar}>
        <View style={styles.switch} accessibilityRole="tablist" accessibilityLabel="Git view">
          {GIT_VIEWS.map(({ key, label }) => {
            const on = key === view;
            return (
              <Pressable
                key={key}
                onPress={() => patchUi({ gitView: key })}
                style={[styles.option, on && styles.optionOn]}
                accessibilityRole="tab"
                accessibilityState={{ selected: on }}
              >
                <Text style={[styles.optionText, on && styles.optionTextOn]}>{label}</Text>
              </Pressable>
            );
          })}
        </View>
      </View>
      <View style={styles.body}>
        {GIT_VIEWS.filter(({ key }) => key === view || visited.includes(key)).map(({ key }) => (
          <View key={key} style={[styles.body, key !== view && styles.hidden]}>{bodies[key]}</View>
        ))}
      </View>
    </View>
  );
}

/** The way into each repository's changes and latest commits. */
function ChangesView({ project }: { project: Project }) {
  const scroll = useTabScroll(project.id, 'changes');
  return (
    <ScrollView {...scroll}>
      <Section title="Changes">
        {project.folders.length ? (
          <InfoRow
            title="Branch, changes and latest commits"
            meta={project.folders.map((f) => shortProjectPath(f.path)).join(', ')}
            onPress={() => router.push({ pathname: '/git', params: { projectId: project.id, title: project.name } })}
          />
        ) : (
          <>
            <Text style={styles.text}>No folder of this project is attached yet.</Text>
            <SectionLink label="Attach a folder…" onPress={() => router.push({ pathname: '/folders', params: { projectId: project.id } })} />
          </>
        )}
      </Section>
    </ScrollView>
  );
}

/** The Git Graph of each folder of the project, with its actions. */
function HistoryView({ project }: { project: Project }) {
  const scroll = useTabScroll(project.id, 'history');
  return (
    <ScrollView {...scroll}>
      <Section title="History">
        {project.folders.map((folder) => (
          <InfoRow
            key={folder.path}
            title={shortProjectPath(folder.path)}
            meta={folder.mode === 'worktree' ? `worktree${folder.branch ? ` · ${folder.branch}` : ''}` : 'folder'}
            onPress={() => router.push({ pathname: '/graph', params: { projectId: project.id, folder: folder.path } })}
          />
        ))}
        {!project.folders.length ? <Text style={styles.text}>No folder of this project is attached yet.</Text> : null}
      </Section>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  body: { flex: 1 },
  hidden: { display: 'none' },
  switchBar: { paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  switch: { height: 36, flexDirection: 'row', backgroundColor: colors.background, borderRadius: 10, padding: 3, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
  option: { flex: 1, alignItems: 'center', justifyContent: 'center', borderRadius: 7 },
  optionOn: { backgroundColor: 'rgba(122,132,255,0.16)' },
  optionText: { color: colors.textDim, fontSize: 13.5, fontWeight: '600' },
  optionTextOn: { color: '#e4e4fa' },
  text: { color: colors.textFaint, fontSize: 13, paddingVertical: spacing.sm },
});
