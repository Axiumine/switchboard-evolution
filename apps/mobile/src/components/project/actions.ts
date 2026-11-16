import { router } from 'expo-router';
import { Alert } from 'react-native';

import type { Project, Schedule, Track } from '@/projects/model';
import { useConnection } from '@/store/connection';
import type { SheetOption } from '../Sheet';

/** A name being typed: the project's, a track's, or a new track's. */
export type Rename = { kind: 'project' | 'track' | 'new-track'; id: string; name: string };

/** Call the computer, tell the user if it failed, and read the project again. */
export type Run = (method: string, params: unknown[], after?: () => void) => Promise<void>;

export function trackOptions(project: Project, track: Track, run: Run, setRename: (r: Rename) => void): SheetOption[] {
  return [
    { label: 'New session here…', onPress: () => router.push({ pathname: '/new', params: { target: `t:${track.id}` } }) },
    { label: 'Rename…', onPress: () => setRename({ kind: 'track', id: track.id, name: track.name }) },
    track.status === 'done'
      ? { label: 'Reopen', onPress: () => run('update-track', [track.id, { status: 'active' }]) }
      : { label: 'Mark as done', onPress: () => run('update-track', [track.id, { status: 'done' }]) },
    {
      label: 'Delete track…', destructive: true,
      onPress: () => Alert.alert(`Delete “${track.name}”?`, `Its sessions stay in ${project.name}.`, [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete', style: 'destructive', onPress: () => run('delete-track', [track.id, { archiveSessions: false }]) },
      ]),
    },
  ];
}

export function scheduleOptions(project: Project, schedule: Schedule, run: Run): SheetOption[] {
  return [
    {
      label: 'Run now', onPress: () => run('run-schedule', [schedule.id]).then(() => {
        useConnection.getState().refreshLive();
      }),
    },
    { label: 'Edit…', onPress: () => router.push({ pathname: '/schedule', params: { projectId: project.id, id: schedule.id } }) },
    { label: schedule.enabled ? 'Pause' : 'Resume', onPress: () => run('update-schedule', [schedule.id, { enabled: !schedule.enabled }]) },
    {
      label: 'Delete…', destructive: true,
      onPress: () => Alert.alert(`Delete “${schedule.name}”?`, 'Sessions it already started are kept.', [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete', style: 'destructive', onPress: () => run('delete-schedule', [schedule.id]) },
      ]),
    },
  ];
}
