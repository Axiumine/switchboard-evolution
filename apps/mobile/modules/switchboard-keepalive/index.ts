import { requireOptionalNativeModule } from 'expo';
import { AppRegistry } from 'react-native';

// The app kept running in the background (Android: KeepAliveService, with its
// notification), so the connection to the computer stays and its alerts
// arrive. Elsewhere, and with an app built before this module, none.

type Native = { start(text: string): boolean; update(text: string): void; stop(): void };

const native = requireOptionalNativeModule<Native>('SwitchboardKeepAlive');

/** Whether this build can stay connected in the background. */
export const keepAliveAvailable = !!native;

let release: (() => void) | null = null;

/**
 * Registers what runs while the service does: `work` starts it and returns how
 * to stop it. Call once, as the app starts.
 */
export function registerKeepAliveWork(work: () => () => void): void {
  if (!native) return;
  AppRegistry.registerHeadlessTask('SwitchboardKeepAlive', () => () => new Promise<void>((resolve) => {
    release?.();
    const stop = work();
    release = () => {
      release = null;
      stop();
      resolve();
    };
  }));
}

/** Starts the service with `text` on its notification; false when Android refuses (from the background). */
export function startKeepAlive(text: string): boolean {
  return native ? native.start(text) : false;
}

export function updateKeepAlive(text: string): void {
  native?.update(text);
}

export function stopKeepAlive(): void {
  release?.();
  native?.stop();
}
