import * as Notifications from 'expo-notifications';
import { AndroidImportance } from 'expo-notifications';
import { Platform } from 'react-native';

import { notificationId, readAlert, sessionOfNotification, type SessionAlert } from './model';

// The system's side of the notifications (expo-notifications): local ones
// only, posted by the app itself. Nothing goes through a push service.

const CHANNEL = 'sessions';

/** Once, before anything is shown: how a notification looks while the app is open, and its Android channel. */
export async function setUpNotifications(): Promise<void> {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: false }),
  });
  // Android 13 asks for the permission only once a channel exists.
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync(CHANNEL, { name: 'Sessions', importance: AndroidImportance.HIGH });
  }
}

/** Whether notifications may be shown; with `ask`, the system's question first, while it still can be asked. */
export async function notificationsAllowed(ask: boolean): Promise<boolean> {
  let permission = await Notifications.getPermissionsAsync();
  if (!permission.granted && ask && permission.canAskAgain) permission = await Notifications.requestPermissionsAsync();
  return permission.granted;
}

export async function present(alert: SessionAlert): Promise<void> {
  await Notifications.scheduleNotificationAsync({
    identifier: notificationId(alert.sessionId),
    content: { title: alert.title, body: alert.body, data: { ...alert } },
    // At once.
    trigger: Platform.OS === 'android' ? { channelId: CHANNEL } : null,
  });
}

export async function dismiss(sessionId: string): Promise<void> {
  await Notifications.dismissNotificationAsync(notificationId(sessionId));
}

/** The session notifications still in the system's list: session → when its alert was raised. */
export async function shownAlerts(): Promise<Map<string, number | undefined>> {
  const shown = await Notifications.getPresentedNotificationsAsync();
  const map = new Map<string, number | undefined>();
  for (const { request } of shown) {
    const sessionId = sessionOfNotification(request.identifier);
    if (sessionId) map.set(sessionId, readAlert(request.content.data)?.at);
  }
  return map;
}
