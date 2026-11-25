import { describe, expect, it } from '@jest/globals';

import { projectMenu } from '../menu';
import type { Project } from '../model';

const NOW = Date.parse('2026-03-10T12:00:00Z');

const project = (extra: Partial<Project> = {}): Project => ({
  id: 'p1', name: 'Web', root: '/Users/alex/Switchboard/web', status: 'active', snoozedUntil: null, defaultCwd: null,
  folders: [], tracks: [], schedules: [], sessions: [], ...extra,
});

const labels = (p: Project) => projectMenu(p, NOW).map((entry) => entry.label);

describe('projectMenu', () => {
  it('lists the actions of an active project in the order of its menu', () => {
    expect(labels(project())).toEqual([
      'New session…', 'Rename…', 'New track…', 'Note', 'Attach a folder…', 'Star', 'Snooze…', 'Mark as done', 'Settings', 'Remove project…',
    ]);
  });

  it('unstars a starred project', () => {
    expect(labels(project({ starred: true }))).toContain('Unstar');
    expect(labels(project({ starred: true }))).not.toContain('Star');
  });

  it('wakes a snoozed project instead of snoozing it', () => {
    const snoozed = project({ snoozedUntil: '2026-03-11T08:00:00Z' });
    expect(labels(snoozed)).toContain('Wake now');
    expect(labels(snoozed)).not.toContain('Snooze…');
    // A snooze that has ended offers Snooze again.
    expect(labels(project({ snoozedUntil: '2026-03-09T08:00:00Z' }))).toContain('Snooze…');
  });

  it('has no snooze on a done project, and reopens it', () => {
    const done = labels(project({ status: 'done', snoozedUntil: '2026-03-11T08:00:00Z' }));
    expect(done).not.toContain('Snooze…');
    expect(done).not.toContain('Wake now');
    expect(done).toContain('Reopen');
    expect(done).not.toContain('Mark as done');
  });

  it('marks only removing the project as destructive', () => {
    expect(projectMenu(project(), NOW).filter((entry) => entry.destructive).map((entry) => entry.action)).toEqual(['remove']);
  });
});
