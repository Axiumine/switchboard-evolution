import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { SafeAreaInsetsContext, useSafeAreaInsets, type EdgeInsets } from 'react-native-safe-area-context';

// A bar of the root layout under every screen (the download bar) takes the
// bottom safe area (the gesture bar, the home indicator) for itself: while it
// is there, the screens above it must not leave that room again. They read the
// insets through useSafeAreaInsets, so a provider with no bottom inset around
// them is enough. Modals cover the whole window, bar included, and still need
// the real bottom inset: they read it with useWindowInsets.

const WindowInsets = createContext<EdgeInsets | null>(null);

/** The insets of the whole window, even under a bar that took the bottom one. For modals. */
export function useWindowInsets(): EdgeInsets {
  const window = useContext(WindowInsets);
  const insets = useSafeAreaInsets();
  return window ?? insets;
}

/** `children` with no bottom inset while `taken`: a bar under them has it. */
export function BottomInsetTaken({ taken, children }: { taken: boolean; children: ReactNode }) {
  const insets = useSafeAreaInsets();
  const inner = useMemo(() => (taken ? { ...insets, bottom: 0 } : insets), [taken, insets]);
  return (
    <WindowInsets.Provider value={insets}>
      <SafeAreaInsetsContext.Provider value={inner}>{children}</SafeAreaInsetsContext.Provider>
    </WindowInsets.Provider>
  );
}
