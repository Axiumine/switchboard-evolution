import { hasSidebar, useTwoPanes } from '@/layout/hinge';

import { openNativeWindow, windowsAvailable } from '../../modules/switchboard-window';
import { windowTitle, type WindowSpec } from './window-spec';

/**
 * Whether the buttons that open a tab in a window of its own show: where
 * windows sit side by side (DeX, a tablet's wide window, beside the sidebar),
 * with a build that has the windows module. Not on a phone nor on a Duo.
 */
export function useCanOpenWindows(): boolean {
  const twoPanes = useTwoPanes();
  return windowsAvailable && twoPanes && hasSidebar();
}

/** Opens `spec` in a window of its own; false when this build cannot. */
export function openWindow(spec: WindowSpec, projectName?: string): boolean {
  return openNativeWindow(JSON.stringify(spec), windowTitle(spec, projectName));
}
