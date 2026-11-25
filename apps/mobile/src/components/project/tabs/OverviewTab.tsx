import { router } from 'expo-router';
import { useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text } from 'react-native';

import { usePullRefresh } from '@/components/PullRefresh';
import { ReorderItem, ReorderProvider } from '@/components/reorder/Reorder';
import { SessionActions } from '@/components/SessionActions';
import { SessionRow } from '@/components/SessionRow';
import { Sheet } from '@/components/Sheet';
import { pinnedSessions } from '@/projects/drawer';
import { projectSessions, rollupState, scheduleSummary, type Project, type ProjectFolder, type Schedule, type Track } from '@/projects/model';
import { useOpenSession } from '@/projects/open-session';
import { pinnedGroup, type OrderGroup } from '@/projects/order';
import { useSessionMemory } from '@/processes/session-memory';
import { saveOrder } from '@/projects/save-order';
import { relativeTime, rowState, shortProjectPath, type Session } from '@/sessions/model';
import { projectSnoozed, snoozeWakeDescription } from '@/shared/vendor/snooze';
import { useCapability, useConnection } from '@/store/connection';
import { colors, spacing } from '@/theme';
import { scheduleOptions, trackOptions, type Rename, type Run } from '../actions';
import { InfoRow, Section, SectionLink } from '../Section';
import { useTabScroll } from '../useTabScroll';

/**
 * The project at a glance: status, its pinned sessions (in the order they were
 * dragged into, by the handle at their end), tracks and their other sessions,
 * the sessions of no track, schedules and folders.
 */
export function OverviewTab({ project, now, run, onRename, onRefresh }: {
  project: Project;
  now: number;
  run: Run;
  onRename: (rename: Rename) => void;
  onRefresh: () => unknown;
}) {
  const pull = usePullRefresh(onRefresh);
  const live = useConnection((s) => s.live);
  const notices = useConnection((s) => s.notices);
  // What each live session uses, as the desktop's track cards show it.
  const memory = useSessionMemory();
  const scroll = useTabScroll(project.id, 'overview');
  const [trackActions, setTrackActions] = useState<Track | null>(null);
  const [folderActions, setFolderActions] = useState<ProjectFolder | null>(null);
  const [scheduleActions, setScheduleActions] = useState<Schedule | null>(null);
  const [sessionActions, setSessionActions] = useState<Session | null>(null);
  const [dragging, setDragging] = useState(false);
  // A desktop older than the order has no handles.
  const canOrder = useCapability('set-pinned-order');

  const snoozed = projectSnoozed(project, now);
  const state = rollupState(projectSessions(project), live, notices);
  const status = project.status === 'done' ? 'Done' : snoozed ? `Snoozed until ${snoozeWakeDescription(project.snoozedUntil!)}` : null;
  const openInTab = useOpenSession();
  const openSession = (session: Session) => openInTab(session.sessionId);
  const sessionRow = (session: Session, handle = false) => (
    <SessionRow key={session.sessionId} inset session={session} state={rowState(session.sessionId, live[session.sessionId], notices)} ram={memory.get(session.sessionId)} onPress={openSession} onLongPress={setSessionActions} handle={handle} />
  );
  // The pinned ones are listed once, above the tracks.
  const pinned = pinnedSessions(project);
  const pinGroup = pinnedGroup(project.id);
  const pinIds = pinned.map((s) => s.sessionId);
  const shown = (list: Session[]) => list.filter((s) => !s.archived && !s.starred);
  const none = (list: Session[]) => !list.some((s) => !s.archived);
  const roots = [{ path: project.root, title: 'Project folder', hint: 'plan, memory, notes' }, ...project.folders.map((f) => ({ path: f.path, title: shortProjectPath(f.path), hint: f.mode === 'worktree' ? `worktree${f.branch ? ` · ${f.branch}` : ''}` : 'folder' }))];

  return (
    <ReorderProvider onOrder={(group, ids) => { saveOrder(group as OrderGroup, ids); }} onDragChange={setDragging}>
      <ScrollView {...scroll} scrollEnabled={!dragging} refreshControl={pull}>
        {status || state !== 'idle' ? (
          <Text style={styles.status}>{[status, state === 'attention' ? 'a session needs you' : state === 'busy' ? 'working' : state === 'subagent' ? 'a subagent is working' : state === 'unread' ? 'unread' : null].filter(Boolean).join(' · ')}</Text>
        ) : null}

        {pinned.length ? (
          <Section title="Pinned">
            {pinned.map((session) => (canOrder
              ? <ReorderItem key={session.sessionId} group={pinGroup} id={session.sessionId} ids={pinIds} rowKey={session.sessionId}>{sessionRow(session, true)}</ReorderItem>
              : sessionRow(session)))}
          </Section>
        ) : null}

        {project.tracks.map((track) => (
          <Section key={track.id} title={`${track.name}${track.status === 'done' ? ' · done' : ''}`} action="•••" onAction={() => setTrackActions(track)}>
            {shown(track.sessions).map((session) => sessionRow(session))}
            {none(track.sessions) ? <Text style={styles.empty}>No sessions in this track.</Text> : null}
          </Section>
        ))}

        <Section title={project.tracks.length ? 'Other sessions' : 'Sessions'} action="New" onAction={() => router.push({ pathname: '/new', params: { target: `p:${project.id}` } })}>
          {shown(project.sessions).map((session) => sessionRow(session))}
          {none(project.sessions) ? <Text style={styles.empty}>No sessions yet.</Text> : null}
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
    </ReorderProvider>
  );
}

const styles = StyleSheet.create({
  status: { color: colors.textDim, fontSize: 13, paddingHorizontal: spacing.lg, paddingTop: spacing.md },
  empty: { color: colors.textFaint, fontSize: 13, paddingVertical: spacing.sm },
});
