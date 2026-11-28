import { describe, expect, it } from '@jest/globals';

import { alertFromEvent, catchUp, keepAliveText, notificationId, onScreen, readAlert, sessionOfNotification } from '../model';

const title = (id: string) => `Session ${id}`;

describe('an alert from the computer', () => {
  it('is read as sent', () => {
    const alert = { sessionId: 's1', kind: 'attention', title: 'Fix', body: 'Needs your input', diffId: 'd1', at: 5 };
    expect(readAlert({ ...alert, extra: true })).toEqual(alert);
  });

  it('needs a session and a kind it knows', () => {
    expect(readAlert(null)).toBeNull();
    expect(readAlert({ kind: 'finished' })).toBeNull();
    expect(readAlert({ sessionId: 's1', kind: 'other' })).toBeNull();
    expect(readAlert({ sessionId: 's1', kind: 'finished' })).toEqual({ sessionId: 's1', kind: 'finished', title: 'A session', body: '' });
  });
});

describe('a computer without alerts', () => {
  it('is followed through its notifications', () => {
    expect(alertFromEvent('terminal-notification', ['s1', 'Claude needs your permission', 'attention'], title))
      .toEqual({ sessionId: 's1', kind: 'attention', title: 'Session s1', body: 'Claude needs your permission' });
    expect(alertFromEvent('terminal-notification', ['s1', '', 'attention'], title)?.body).toBe('Needs your input');
    expect(alertFromEvent('terminal-notification', ['s1', 'waiting', 'idle'], title)?.kind).toBe('finished');
    expect(alertFromEvent('terminal-notification', ['s1', 'hello', null], title)).toBeNull();
  });

  it('and through the changes it asks to review', () => {
    expect(alertFromEvent('mcp-open-diff', ['s1', 'd1', { oldFilePath: '/work/app/index.ts' }], title))
      .toEqual({ sessionId: 's1', diffId: 'd1', kind: 'attention', title: 'Session s1', body: 'Wants to change index.ts' });
  });

  it('says nothing of other events', () => {
    expect(alertFromEvent('cli-busy-state', ['s1', false], title)).toBeNull();
    expect(alertFromEvent('projects-changed', [], title)).toBeNull();
  });
});

it('gives each session one notification', () => {
  expect(sessionOfNotification(notificationId('s1'))).toBe('s1');
  expect(sessionOfNotification('something-else')).toBeNull();
});

it('leaves out only the session on a screen that is in front', () => {
  expect(onScreen('s1', { foreground: true, viewing: 's1' })).toBe(true);
  expect(onScreen('s1', { foreground: false, viewing: 's1' })).toBe(false);
  expect(onScreen('s1', { foreground: true, viewing: 's2' })).toBe(false);
});

it('after a reconnect shows what was missed and takes back what was read', () => {
  const standing = [
    { sessionId: 'same', kind: 'finished' as const, title: 't', body: 'b', at: 1 },
    { sessionId: 'newer', kind: 'attention' as const, title: 't', body: 'b', at: 9 },
    { sessionId: 'new', kind: 'finished' as const, title: 't', body: 'b', at: 3 },
  ];
  const { missed, gone } = catchUp(new Map([['same', 1], ['newer', 2], ['read', 4]]), standing);
  expect(missed.map((a) => a.sessionId)).toEqual(['newer', 'new']);
  expect(gone).toEqual(['read']);
});

it('says on the connection\'s notification how the connection is', () => {
  expect(keepAliveText({ state: 'offline', retryInMs: 1000, error: 'lost' }, 'Studio')).toBe('Reconnecting to Studio…');
  expect(keepAliveText({ state: 'connecting' }, 'Studio')).toBe('Connecting to Studio…');
  expect(keepAliveText({ state: 'online', address: '192.0.2.10', hello: {} as any }, 'Studio')).toBe('Connected to Studio');
});
