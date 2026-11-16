import { describe, expect, it } from '@jest/globals';

import type { Session } from '@/sessions/model';
import {
  barShare,
  diskFill,
  formatBytes,
  formatDisk,
  formatPercent,
  formatCpu,
  formatShare,
  formatUptime,
  kindLabel,
  measureNote,
  memoryLevel,
  memorySummary,
  ownerKey,
  ownerRef,
  ownerSubtitle,
  ownerTitle,
  plainOutput,
  refreshInterval,
  runStateLabel,
  sessionsById,
  type Owner,
} from '../model';

const MB = 1024 ** 2;
const GB = 1024 ** 3;

function owner(patch: Partial<Owner>): Owner {
  return {
    kind: 'session', id: 's1', pid: 100, type: 'cli', runtime: 'claude', projectPath: '/code/acme/app', startedAt: null,
    stopRequested: false, rssBytes: 0, cpu: 0, processCount: 1, processes: [], found: true, ...patch,
  };
}

describe('names', () => {
  const sessions = new Map<string, Session>([['s1', { sessionId: 's1', projectPath: '/code/acme/app', name: null, aiTitle: 'Fix the  <b>login</b>' }]]);

  it('names a session as the list does, else by what it is', () => {
    expect(ownerTitle(owner({}), sessions)).toBe('Fix the login');
    expect(ownerTitle(owner({ id: 'other' }), sessions)).toBe('Claude session');
    expect(ownerTitle(owner({ id: 'other', runtime: 'codex' }), sessions)).toBe('Codex session');
    expect(ownerTitle(owner({ id: 'other', type: 'terminal' }), sessions)).toBe('Terminal');
    expect(ownerTitle(owner({ kind: 'task', type: 'task', label: 'dev server' }), sessions)).toBe('dev server');
  });

  it('says what it is, where and its pid', () => {
    expect(kindLabel(owner({ runtime: null }))).toBe('Claude');
    expect(kindLabel(owner({ kind: 'task', type: 'task' }))).toBe('Task');
    expect(ownerSubtitle(owner({}))).toBe('Claude · acme/app · PID 100');
    expect(ownerSubtitle(owner({ type: 'terminal', projectPath: null, pid: null }))).toBe('Terminal');
  });

  it('collects the sessions of every folder by id', () => {
    const map = sessionsById([{ sessions: [{ sessionId: 'a', projectPath: '/a' }] }, { sessions: [{ sessionId: 'b', projectPath: '/b' }] }]);
    expect([...map.keys()]).toEqual(['a', 'b']);
    expect(sessionsById(undefined).size).toBe(0);
  });
});

describe('owner references', () => {
  it('send back only what names the owner', () => {
    expect(ownerRef(owner({ rssBytes: 5 }))).toEqual({ kind: 'session', id: 's1' });
    expect(ownerRef(owner({ kind: 'task', type: 'task', projectPath: '/code/app', label: 'dev' }))).toEqual({ kind: 'task', projectPath: '/code/app', label: 'dev' });
  });

  it('key sessions and tasks apart', () => {
    expect(ownerKey(owner({}))).toBe('session:s1');
    expect(ownerKey(owner({ kind: 'task', projectPath: '/p', label: 'dev' }))).toBe('task:/p|dev');
  });
});

describe('formatting', () => {
  it('writes memory in KB, MB or GB', () => {
    expect(formatBytes(0)).toBe('0 MB');
    expect(formatBytes(300)).toBe('1 KB');
    expect(formatBytes(512 * 1024)).toBe('512 KB');
    expect(formatBytes(344 * MB)).toBe('344 MB');
    expect(formatBytes(1.5 * GB)).toBe('1.50 GB');
    expect(formatBytes(12 * GB)).toBe('12.0 GB');
  });

  it('writes CPU and the share of installed memory', () => {
    expect(formatCpu(null)).toBe('—');
    expect(formatCpu(3.14)).toBe('3.1%');
    expect(formatCpu(42.6)).toBe('43%');
    expect(formatShare(GB, 16 * GB)).toBe('6.3% of RAM');
    expect(formatShare(4 * GB, 16 * GB)).toBe('25% of RAM');
    expect(formatShare(GB, 0)).toBe('');
  });

  it('writes how long it has been running', () => {
    const now = Date.parse('2026-11-13T12:00:00Z');
    expect(formatUptime(null, now)).toBe('—');
    expect(formatUptime(now - 20_000, now)).toBe('<1m');
    expect(formatUptime(now - 42 * 60_000, now)).toBe('42m');
    expect(formatUptime(now - (3 * 60 + 5) * 60_000, now)).toBe('3h 05m');
    expect(formatUptime(now - (52 * 60) * 60_000, now)).toBe('2d 4h');
  });

  it('turns amber from 1 GB and red from 2 GB', () => {
    expect(memoryLevel(900 * MB)).toBe('low');
    expect(memoryLevel(GB)).toBe('mid');
    expect(memoryLevel(2 * GB)).toBe('high');
  });

  it('draws bars against the heaviest row, never invisible', () => {
    expect(barShare(50, 100)).toBe(0.5);
    expect(barShare(0, 100)).toBe(0.015);
    expect(barShare(5, 0)).toBe(0);
  });

  it('refreshes every 3 s, 6 s on Windows', () => {
    expect(refreshInterval('darwin')).toBe(3000);
    expect(refreshInterval('win32')).toBe(6000);
    expect(refreshInterval(undefined)).toBe(3000);
  });
});

describe('memorySummary', () => {
  const app = { rssBytes: GB, cpu: 1, processCount: 6 };
  const owners = [owner({ rssBytes: 3 * GB, processCount: 4 }), owner({ id: 's2', rssBytes: GB, processCount: 2 }), owner({ kind: 'task', rssBytes: GB, processCount: 1 })];

  it('gives the memory installed, in use and Switchboard’s with its sessions', () => {
    const summary = memorySummary({ totalMemBytes: 32 * GB, usedMemBytes: 27 * GB, app, switchboard: { rssBytes: 6 * GB, processCount: 13 }, owners });
    expect(summary).toMatchObject({
      installed: 32 * GB, used: 27 * GB, free: 5 * GB, ours: 6 * GB, appBytes: GB, ownersBytes: 5 * GB,
      processCount: 13, running: '2 sessions, 1 task',
    });
    expect(summary.usedShare).toBeCloseTo(27 / 32);
    expect(summary.oursShare).toBeCloseTo(6 / 32);
  });

  it('adds the app and the sessions up itself from a desktop that does not', () => {
    const summary = memorySummary({ totalMemBytes: 8 * GB, app, owners });
    expect(summary).toMatchObject({ used: null, free: null, ours: 6 * GB, processCount: 13 });
  });

  it('never shows less in use than Switchboard alone, nor more than installed', () => {
    expect(memorySummary({ totalMemBytes: 8 * GB, usedMemBytes: GB, app, owners }).used).toBe(6 * GB);
    expect(memorySummary({ totalMemBytes: 8 * GB, usedMemBytes: 9 * GB, app, owners }).used).toBe(8 * GB);
  });
});

describe('disks', () => {
  it('writes sizes in the computer’s own units', () => {
    expect(formatDisk(494384795648, 'darwin')).toBe('494 GB');
    expect(formatDisk(18003595264, 'darwin')).toBe('18.0 GB');
    expect(formatDisk(2 * 1000 ** 4, 'darwin')).toBe('2.00 TB');
    expect(formatDisk(512 * GB, 'win32')).toBe('512 GB');
  });

  it('turns amber under 20% free and red under 10%', () => {
    expect(diskFill({ totalBytes: 100, freeBytes: 50 })).toEqual({ used: 0.5, level: 'low' });
    expect(diskFill({ totalBytes: 100, freeBytes: 15 }).level).toBe('mid');
    expect(diskFill({ totalBytes: 100, freeBytes: 4 }).level).toBe('high');
    expect(diskFill({ totalBytes: 0, freeBytes: 0 })).toEqual({ used: 0, level: 'low' });
  });
});

describe('notes', () => {
  it('says what the numbers are', () => {
    expect(formatPercent(GB, 16 * GB)).toBe('6.3%');
    expect(measureNote('footprint')).toMatch(/Activity Monitor/);
    expect(measureNote(undefined)).toMatch(/RSS/);
  });
});

describe('task output', () => {
  it('drops escape sequences and keeps the last state of a redrawn line', () => {
    const raw = '\x1b[32mready\x1b[0m in 120 ms\r\n\x1b]0;vite\x07building 10%\rbuilding 100%\r\ndone\x07\n';
    expect(plainOutput(raw)).toBe('ready in 120 ms\nbuilding 100%\ndone\n');
    expect(plainOutput(null)).toBe('');
  });

  it('keeps only the end of a long output', () => {
    expect(plainOutput('abcdefghij', 4)).toBe('ghij');
  });

  it('says how a run stands', () => {
    const base = { running: false, stopRequested: false, exitCode: null, signal: null, error: null, state: 'idle' };
    expect(runStateLabel({ ...base, running: true })).toBe('running');
    expect(runStateLabel({ ...base, running: true, stopRequested: true })).toBe('stopping…');
    expect(runStateLabel({ ...base, exitCode: 0 })).toBe('exited 0');
    expect(runStateLabel({ ...base, signal: 'SIGTERM' })).toBe('killed (SIGTERM)');
    expect(runStateLabel({ ...base, error: 'spawn ENOENT' })).toBe('failed: spawn ENOENT');
    expect(runStateLabel(base)).toBe('idle');
  });
});
