import { router } from 'expo-router';
import { useState } from 'react';
import { Alert, RefreshControl, ScrollView, StyleSheet, Text } from 'react-native';

import { SessionActions } from '@/components/SessionActions';
import { SessionRow } from '@/components/SessionRow';
import { Sheet } from '@/components/Sheet';
import { projectSessions, rollupState, scheduleSummary, type Project, type ProjectFolder, type Schedule, type Track } from '@/projects/model';
import { useOpenSession } from '@/projects/open-session';
import { relativeTime, rowState, shortProjectPath, type Session } from '@/sessions/model';
import { projectSnoozed, snoozeWakeDescription } from '@/shared/vendor/snooze';
import { useConnection } from '@/store/connection';
import { colors, spacing } from '@/theme';
import { scheduleOptions, trackOptions, type Rename, type Run } from '../actions';
import { InfoRow, Section, SectionLink } from '../Section';
import { useTabScroll } from '../useTabScroll';

/** The project at a glance: status, tracks and their sessions, other sessions, schedules and folders. */
export function OverviewTab({ project, now, run, onRename, refreshing, onRefresh }: {
  project: Project;
  now: number;
  run: Run;
  onRename: (rename: Rename) => void;
  refreshing: boolean;
  onRefresh: () => void;
}) {
  const live = useConnection((s) => s.live);
  const notices = useConnection((s) => s.notices);
  const scroll = useTabScroll(project.id, 'overview');
  const [trackActions, setTrackActions] = useState<Track | null>(null);
  const [folderActions, setFolderActions] = useState<ProjectFolder | null>(null);
  const [scheduleActions, setScheduleActions] = useState<Schedule | null>(null);
  const [sessionActions, setSessionActions] = useState<Session | null>(null);

  const snoozed = projectSnoozed(project, now);
  const state = rollupState(projectSessions(project), live, notices);
  const status = project.status === 'done' ? 'Done' : snoozed ? `Snoozed until ${snoozeWakeDescription(project.snoozedUntil!)}` : null;
  const openInTab = useOpenSession();
  const openSession = (session: Session) => openInTab(session.sessionId);
  const sessionRow = (session: Session) => (
    <SessionRow key={session.sessionId} inset session={session} state={rowState(session.sessionId, live[session.sessionId], notices)} onPress={openSession} onLongPress={setSessionActions} />
  );
  const roots = [{ path: project.root, title: 'Project folder', hint: 'plan, memory, notes' }, ...project.folders.map((f) => ({ path: f.path, title: shortProjectPath(f.path), hint: f.mode === 'worktree' ? `worktree${f.branch ? ` · ${f.branch}` : ''}` : 'folder' }))];

  return (
    <>
      <ScrollView {...scroll} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.accent} />}>
        {status || state !== 'idle' ? (
          <Text style={styles.status}>{[status, state === 'attention' ? 'a session needs you' : state === 'busy' ? 'working' : state === 'unread' ? 'unread' : null].filter(Boolean).join(' · ')}</Text>
        ) : null}

        {project.tracks.map((track) => (
          <Section key={track.id} title={`${track.name}${track.status === 'done' ? ' · done' : ''}`} action="•••" onAction={() => setTrackActions(track)}>
            {track.sessions.filter((s) => !s.archived).map(sessionRow)}
            {!track.sessions.some((s) => !s.archived) ? <Text style={styles.empty}>No sessions in this track.</Text> : null}
          </Section>
        ))}

        <Section title={project.tracks.length ? 'Other sessions' : 'Sessions'} action="New" onAction={() => router.push({ pathname: '/new', params: { target: `p:${project.id}` } })}>
          {project.sessions.filter((s) => !s.archived).map(sessionRow)}
          {!project.sessions.some((s) => !s.archived) ? <Text style={styles.empty}>No sessions yet.</Text> : null}
        </Section>

        <Section title="Schedules" action="New" onAction={() => router.push({ pathname: '/schedule', params: { projectId: project.id } })}>
          {project.schedules.map((schedule) => (
            <InfoRow
              key={schedule.id}
              title={schedule.name}
              meta={[scheduleSummary(schedule), schedule.lastRunAt ? `last run ${relativeTime(schedule.lastRunAt)}` : null].filter(Boolean).join(' · ')}
              dim={!schedule.enabled}
              onPress={() => setScheduleActions(schedule)}
            />
          ))}
          {!project.schedules.length ? <Text style={styles.empty}>Nothing scheduled.</Text> : null}
        </Section>

        <Section title="Files">
          {roots.map((root) => (
            <InfoRow key={root.path} title={root.title} meta={root.hint} onPress={() => router.push({ pathname: '/files', params: { root: root.path, title: root.title } })}
              onLongPress={root.path === project.root ? undefined : () => setFolderActions(project.folders.find((f) => f.path === root.path) || null)} />
          ))}
          <SectionLink label="Attach a folder…" onPress={() => router.push({ pathname: '/folders', params: { projectId: project.id } })} />
        </Section>
      </ScrollView>

      <Sheet visible={!!trackActions} title={trackActions?.name} options={trackActions ? trackOptions(project, trackActions, run, onRename) : []} onClose={() => setTrackActions(null)} />
      <Sheet
        visible={!!folderActions}
        title={folderActions ? shortProjectPath(folderActions.path) : ''}
        options={folderActions ? [{
          label: folderActions.mode === 'worktree' ? 'Detach and remove the worktree' : 'Detach from the project', destructive: true,
          onPress: () => {
            const folder = folderActions;
            if (folder.mode !== 'worktree') { run('detach-project-folder', [project.id, folder.path, { removeWorktree: false }]); return; }
            Alert.alert('Remove the worktree?', `${shortProjectPath(folder.path)} is deleted from disk, with files git ignores (such as .env copies). Its branch stays.`, [
              { text: 'Cancel', style: 'cancel' },
              { text: 'Remove', style: 'destructive', onPress: () => run('detach-project-folder', [project.id, folder.path, { removeWorktree: true }]) },
            ]);
          },
        }] : []}
        onClose={() => setFolderActions(null)}
      />
      <Sheet visible={!!scheduleActions} title={scheduleActions?.name} options={scheduleActions ? scheduleOptions(project, scheduleActions, run) : []} onClose={() => setScheduleActions(null)} />
      <SessionActions session={sessionActions} onClose={() => setSessionActions(null)} />
    </>
  );
}

const styles = StyleSheet.create({
  status: { color: colors.textDim, fontSize: 13, paddingHorizontal: spacing.lg, paddingTop: spacing.md },
  empty: { color: colors.textFaint, fontSize: 13, paddingVertical: spacing.sm },
});
