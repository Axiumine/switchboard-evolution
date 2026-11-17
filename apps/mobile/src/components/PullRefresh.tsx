import { useState, type ReactElement } from 'react';
import { RefreshControl, type RefreshControlProps } from 'react-native';

import { colors } from '@/theme';

/**
 * Pull to refresh that spins only for the user's own pull, until `refresh`
 * settles. Refreshes that come by themselves (the desktop's events,
 * reconnecting) do not show it: SyncBar says those, quietly.
 */
export function usePullRefresh(refresh: () => unknown): ReactElement<RefreshControlProps> {
  const [pulling, setPulling] = useState(false);
  const onRefresh = async () => {
    setPulling(true);
    try {
      await refresh();
    } catch {
      // The screen shows its own errors.
    } finally {
      setPulling(false);
    }
  };
  return (
    <RefreshControl
      refreshing={pulling}
      onRefresh={onRefresh}
      tintColor={colors.accent}
      // Android: the app's dark surface, not the default white disc.
      colors={[colors.accent]}
      progressBackgroundColor={colors.raised}
    />
  );
}
