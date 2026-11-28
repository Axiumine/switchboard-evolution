import { AppState, Platform } from 'react-native';

import '@/remote/random';
import { queryClient } from '@/remote/query';
import { sessionTitle, type Folder } from '@/sessions/model';
import { hasCapability, onDesktopEvent, request, useConnection } from '@/store/connection';
import { useNotificationPrefs } from '@/store/notificationPrefs';

import { keepAliveAvailable, registerKeepAliveWork, startKeepAlive, stopKeepAlive, updateKeepAlive } from '../../modules/switchboard-keepalive';
import { alertFromEvent, catchUp, keepAliveText, onScreen, readAlert, type SessionAlert } from './model';
import { dismiss, notificationsAllowed, present, setUpNotifications, shownAlerts } from './presenter';

// The phone's notifications, from the start of the app and apart from any
// screen, so they keep coming while it is in the background: what the computer
// says becomes a system notification, and the keep-alive service holds the
// connection that brings it.

/** How often the connection held in the background is checked: a network change can leave it silently dead. */
export const HEARTBEAT_MS = 45_000;

let started = false;
/** The handler and the Android channel: nothing is asked or shown before them. */
let ready: Promise<void> = Promise.resolve();
let allowed = false;
let asked = false;
let keptAlive: string | null = null; // the words on the service's notification, while it runs
const had = new Map<string, number | undefined>(); // session → the alert the phone has had

const inFront = () => AppState.currentState === 'active';
/** A computer that raises alerts of its own; an older one is followed through its events. */
const computerAlerts = () => hasCapability(useConnection.getState().status, 'get-session-alerts');
const quiet = (work: Promise<unknown>) => { work.catch(() => {}); };

function titleOf(sessionId: string): string {
  const folders = queryClient.getQueryData<Folder[]>(['projects']) || [];
  const session = folders.flatMap((f) => f.sessions).find((s) => s.sessionId === sessionId);
  return session ? sessionTitle(session) : 'A session';
}

function show(alert: SessionAlert): void {
  had.set(alert.sessionId, alert.at);
  if (!useNotificationPrefs.getState().enabled) return;
  if (onScreen(alert.sessionId, { foreground: inFront(), viewing: useConnection.getState().viewing })) return;
  quiet(present(alert));
}

function takeBack(sessionId: string): void {
  had.delete(sessionId);
  quiet(dismiss(sessionId));
}

function hear(event: string, args: any[]): void {
  if (computerAlerts()) {
    if (event === 'session-alert') {
      const alert = readAlert(args[0]);
      if (alert) show(alert);
    } else if (event === 'session-alert-cleared' && typeof args[0] === 'string') {
      takeBack(args[0]);
    }
    return;
  }
  const alert = alertFromEvent(event, args, titleOf);
  if (alert) show(alert);
  else if (event === 'cli-busy-state' && args[1] && typeof args[0] === 'string') takeBack(args[0]);
}

/** Connected again: what was raised while away is shown, what was read meanwhile goes. */
async function catchUpWithComputer(): Promise<void> {
  if (!computerAlerts()) return;
  const answer = await request<unknown[]>('get-session-alerts');
  const standing = (Array.isArray(answer) ? answer : []).map(readAlert).filter((a): a is SessionAlert => !!a);
  const known = new Map([...(await shownAlerts()), ...had]);
  const { missed, gone } = catchUp(known, standing);
  for (const sessionId of gone) takeBack(sessionId);
  for (const alert of missed) {
    // With the app on screen the lists already show them: no banners for old news.
    if (inFront()) had.set(alert.sessionId, alert.at);
    else show(alert);
  }
}

/** Start, rename or stop the keep-alive service, as the settings and the connection are now. */
function syncKeepAlive(): void {
  if (!keepAliveAvailable) return;
  const { desktop, status } = useConnection.getState();
  const { enabled, background } = useNotificationPrefs.getState();
  if (!desktop || !enabled || !background || !allowed || status.state === 'rejected') {
    if (keptAlive !== null) {
      keptAlive = null;
      stopKeepAlive();
    }
    return;
  }
  const text = keepAliveText(status, desktop.name);
  if (keptAlive === null) {
    // Android starts it only for an app on screen.
    if (inFront() && startKeepAlive(text)) keptAlive = text;
  } else if (keptAlive !== text) {
    keptAlive = text;
    updateKeepAlive(text);
  }
}

/** Read the permission (asking once per run, on screen, for a paired computer), then settle the service. */
async function refreshNotificationPermission(): Promise<void> {
  await ready;
  const ask = !asked && inFront() && !!useConnection.getState().desktop && useNotificationPrefs.getState().enabled;
  if (ask) asked = true;
  allowed = await notificationsAllowed(ask);
  useNotificationPrefs.getState().setAllowed(allowed);
  syncKeepAlive();
}

export function startNotifications(): void {
  // The web build has no system notifications.
  if (started || Platform.OS === 'web') return;
  started = true;

  registerKeepAliveWork(() => {
    const beat = setInterval(() => useConnection.getState().checkConnection(), HEARTBEAT_MS);
    return () => clearInterval(beat);
  });

  onDesktopEvent(hear);

  useConnection.subscribe((state, previous) => {
    if (state.desktop?.deviceId !== previous.desktop?.deviceId) {
      for (const sessionId of [...had.keys()]) takeBack(sessionId);
      quiet(refreshNotificationPermission());
    }
    // Opening a session reads its notification.
    if (state.viewing && state.viewing !== previous.viewing) takeBack(state.viewing);
    if (state.status !== previous.status) {
      if (state.status.state === 'online') quiet(catchUpWithComputer());
      syncKeepAlive();
    }
  });

  useNotificationPrefs.subscribe((state, previous) => {
    if (state.enabled !== previous.enabled && !state.enabled) {
      for (const sessionId of [...had.keys()]) quiet(dismiss(sessionId));
    }
    if (state.enabled !== previous.enabled || state.background !== previous.background) quiet(refreshNotificationPermission());
  });

  AppState.addEventListener('change', (next) => {
    if (next !== 'active') return;
    const { viewing } = useConnection.getState();
    if (viewing) takeBack(viewing);
    // The permission may have changed in Android's settings.
    quiet(refreshNotificationPermission());
  });

  ready = setUpNotifications().catch(() => {});
  quiet(refreshNotificationPermission());
}
