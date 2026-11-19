import { Tabs } from 'expo-router';

import { AppTabBar } from '@/components/AppTabBar';
import { HeaderButton, headerEdgeOptions } from '@/components/HeaderButton';
import { DuoTabs } from '@/layout/DuoTabs';
import { useTwoPanes } from '@/layout/hinge';
import { colors } from '@/theme';
import { openWindow, useCanOpenWindows } from '@/windows/open';
import type { WindowSpec } from '@/windows/window-spec';

/** The header button that opens Stats or the Task Manager in a window of its own, as the desktop's tooltip does. */
const popOut = (spec: WindowSpec, label: string) => ({
  headerRight: () => <HeaderButton icon="open-outline" accessibilityLabel={`Open ${label} in a window`} onPress={() => openWindow(spec)} />,
});

// The app opens on Sessions, though Projects comes first in the bar, as on the desktop.
export const unstable_settings = { initialRouteName: 'index' };

/**
 * The tabs of the desktop's sidebar strip: Projects, Sessions, Stats, the
 * Task Manager and Settings (AppTabBar). On a Surface Duo, and in a wide
 * window (DeX, a tablet) beside the sidebar, side by side: see DuoTabs.
 */
export default function TabsLayout() {
  const TabsNavigator = (useTwoPanes() ? DuoTabs : Tabs) as typeof Tabs;
  const canPopOut = useCanOpenWindows();
  return (
    <TabsNavigator
      tabBar={({ state, navigateToTab, insets }) => (
        <AppTabBar
          selected={[state.routes[state.index].name]}
          onTab={(name) => {
            const route = state.routes.find((r) => r.name === name);
            if (route) navigateToTab(route.key);
          }}
          bottomInset={insets.bottom}
        />
      )}
      screenOptions={{
        headerStyle: { backgroundColor: colors.surface },
        headerTintColor: colors.text,
        headerTitleStyle: { color: colors.text },
        ...headerEdgeOptions,
        sceneStyle: { backgroundColor: colors.background },
      }}
    >
      <TabsNavigator.Screen name="projects" options={{ title: 'Projects' }} />
      <TabsNavigator.Screen name="index" options={{ title: 'Sessions' }} />
      <TabsNavigator.Screen name="stats" options={{ title: 'Stats', ...(canPopOut ? popOut({ kind: 'stats' }, 'Stats') : {}) }} />
      <TabsNavigator.Screen name="processes" options={{ title: 'Task Manager', ...(canPopOut ? popOut({ kind: 'processes' }, 'the Task Manager') : {}) }} />
      <TabsNavigator.Screen name="settings" options={{ title: 'Settings' }} />
    </TabsNavigator>
  );
}
