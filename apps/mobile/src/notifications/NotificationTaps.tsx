import * as Notifications from 'expo-notifications';
import { router } from 'expo-router';
import { useEffect } from 'react';
import { Platform } from 'react-native';

import { readAlert } from './model';

/** A tap on a session's notification opens the session, or the change it asks you to review. */
export function NotificationTaps() {
  return Platform.OS === 'web' ? null : <Taps />;
}

function Taps() {
  // Also the tap that started the app.
  const response = Notifications.useLastNotificationResponse();
  useEffect(() => {
    if (!response || response.actionIdentifier !== Notifications.DEFAULT_ACTION_IDENTIFIER) return;
    const alert = readAlert(response.notification.request.content.data);
    if (!alert) return;
    Notifications.clearLastNotificationResponse();
    if (alert.diffId) router.push({ pathname: '/ide-diff', params: { diffId: alert.diffId } });
    else router.push({ pathname: '/session/[id]', params: { id: alert.sessionId } });
  }, [response]);
  return null;
}
