import { router } from 'expo-router';

import { openWindow } from '@/windows/open';

/**
 * A pull request's page in a window of its own where windows sit side by side
 * (DeX, a tablet: Android's WindowActivity, as the desktop's window), else on
 * a screen of its own over the app. `replace` swaps it for the sheet it comes from.
 */
export function openPullRequestWindow(url: string, title: string, canOpenWindows: boolean, { replace = false } = {}) {
  if (canOpenWindows && openWindow({ kind: 'web', url, title })) {
    if (replace && router.canGoBack()) router.back();
    return;
  }
  const to = { pathname: '/pulls/web-full' as const, params: { url, title } };
  if (replace) router.replace(to);
  else router.push(to);
}

/** The name of the button that does it, for its label. */
export function windowActionLabel(canOpenWindows: boolean): string {
  return canOpenWindows ? 'Open in a window of its own' : 'Open full screen';
}
