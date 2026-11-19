import { Tabs } from 'expo-router';

import { AppTabBar } from '@/components/AppTabBar';
import { headerEdgeOptions } from '@/components/HeaderButton';
import { DuoTabs } from '@/layout/DuoTabs';
import { useTwoPanes } from '@/layout/hinge';
import { colors } from '@/theme';

// The app opens on Sessions, though Projects comes first in the bar, as on the desktop.
export const unstable_settings = { initialRouteName: 'index' };

/**
 * The tabs of the desktop's sidebar strip: Projects, Sessions, Stats, the
 * Task Manager and Settings (AppTabBar). On a Surface Duo, and in a wide
 * window (DeX, a tablet) beside the sidebar, side by side: see DuoTabs.
 */
export default function TabsLayout() {
  const TabsNavigator = (useTwoPanes() ? DuoTabs : Tabs) as typeof Tabs;
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
      <TabsNavigator.Screen name="stats" options={{ title: 'Stats' }} />
      <TabsNavigator.Screen name="processes" options={{ title: 'Task Manager' }} />
      <TabsNavigator.Screen name="settings" options={{ title: 'Settings' }} />
    </TabsNavigator>
  );
}
