import { requireOptionalNativeModule } from 'expo';

// Tabs in windows of their own (Android: WindowActivity), on the same app and
// connection. Elsewhere, and with an app built before this module, none.

type Native = { open(window: string, title: string): boolean };

const native = requireOptionalNativeModule<Native>('SwitchboardWindow');

/** Whether this build can open windows. */
export const windowsAvailable = !!native;

/** Opens `window` (what WindowRoot shows, as JSON) titled `title`; false when it cannot. */
export function openNativeWindow(window: string, title: string): boolean {
  return native ? native.open(window, title) : false;
}
