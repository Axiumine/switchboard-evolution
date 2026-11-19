import { TabRouter, withLayoutContext } from 'expo-router';
import {
  CommonActions, createNavigatorFactory, getHeaderTitle, Header, TabActions, useNavigationBuilder,
  type DefaultNavigatorOptions, type ParamListBase, type TabNavigationState, type TabRouterOptions,
} from 'expo-router/react-navigation';
import { useNavigationState } from 'expo-router/react-navigation';
import { useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppTabBar } from '@/components/AppTabBar';
import { hasSidebar, useHinge } from '@/layout/hinge';
import { TabShown } from '@/layout/shown';
import { useListUi } from '@/projects/list-ui';
import { useAreaWidth } from '@/layout/size';

// The tabs on a Surface Duo, and beside the sidebar in a wide window (DeX, a
// tablet), where the sidebar is the left screen. With both screens to themselves (the root of the
// carousel, AppStack, with nothing open on the right yet) Projects is always
// on the left, the tab bar under it, and the other tab in use on the right:
// Sessions at first, then whichever the bar picks. Otherwise (something open
// on the right, or the Duo folded) the tab in use and the bar, on one screen:
// the bar changes the left screen and leaves the right one alone.
//
// Each tab hears through TabShown whether it is on screen, which focus does
// not say here: two show at once, and the left one stays in sight while
// another screen is in front on the right.
//
// Expo Router's state holds only the tabs opened so far, so the ones about to
// show side by side are loaded first, without taking the focus.

type Options = {
  title?: string;
  headerTitle?: unknown;
  headerLeft?: unknown;
  headerRight?: unknown;
  headerStyle?: object;
  headerTintColor?: string;
  headerTitleStyle?: object;
  headerLeftContainerStyle?: object;
  headerRightContainerStyle?: object;
  sceneStyle?: object;
};

type Props = DefaultNavigatorOptions<ParamListBase, string | undefined, TabNavigationState<ParamListBase>, Options, Record<string, never>, any> & TabRouterOptions;

function DuoTabsNavigator({ id, initialRouteName, children, screenOptions, backBehavior }: Props) {
  const { state, navigation, descriptors, NavigationContent } = useNavigationBuilder(TabRouter, {
    id, initialRouteName, children, screenOptions, backBehavior,
  });
  const hinge = useHinge();
  const width = useAreaWidth();
  const insets = useSafeAreaInsets();
  const focused = state.routes[state.index];
  // A jump, not a navigate: a navigate brings the tabs to the front of the
  // stack, which closes whatever is open on the right.
  const focus = (name: string) => { if (focused.name !== name) navigation.dispatch(TabActions.jumpTo(name)); };
  // Across both panes: the area goes past the band between them.
  const both = !!hinge && width > hinge.x + hinge.width;
  const sidebar = hasSidebar();
  // The tab on the right side by side: the last one in use other than Projects.
  const [rightTab, setRightTab] = useState(focused.name === 'projects' ? 'index' : focused.name);
  if (focused.name !== 'projects' && focused.name !== rightTab) setRightTab(focused.name);
  const shownNames = both ? ['projects', rightTab] : [focused.name];
  // A session opened anywhere: on a Duo the left screen shows it in Projects, highlighted.
  // After the render, never during it: a navigation there stalls a screen sliding in.
  // The sidebar stays on its tab, as the desktop's does.
  const revealCount = useListUi((s) => s.revealCount);
  const seenReveal = useRef(revealCount);
  useEffect(() => {
    if (revealCount === seenReveal.current) return;
    seenReveal.current = revealCount;
    if (!sidebar && state.routes[state.index].name !== 'projects') navigation.dispatch(TabActions.jumpTo('projects'));
  }, [revealCount, navigation, state, sidebar]);
  const missing = shownNames.filter((name) => !state.routes.some((route) => route.name === name));
  useEffect(() => {
    for (const name of missing) navigation.dispatch(CommonActions.preload(name));
  }, [missing.join(), navigation]); // eslint-disable-line react-hooks/exhaustive-deps

  // Whether these tabs are in sight at all: in front, or (open across both
  // screens) the screen on the left of the one in front, unless that one
  // takes both (a session split into chat and terminal). The sidebar always is.
  const rootShown = useNavigationState((s: { index: number; routes: { name: string; params?: { split?: string } }[] }) => {
    if (s.index === 0 || (sidebar && !!hinge)) return true;
    const top = s.routes[s.index];
    return !!hinge && s.index === 1 && !(top?.name === 'session/[id]' && top.params?.split === '1');
  });

  const scene = (key: string) => {
    const { options, route, render } = descriptors[key];
    const o = options as Options;
    return (
      <View style={styles.fill}>
        <Header
          title={getHeaderTitle(options as any, route.name)}
          headerTitle={o.headerTitle as any}
          headerLeft={o.headerLeft as any}
          headerRight={o.headerRight as any}
          headerStyle={o.headerStyle}
          headerTintColor={o.headerTintColor}
          headerTitleStyle={o.headerTitleStyle}
          headerLeftContainerStyle={o.headerLeftContainerStyle}
          headerRightContainerStyle={o.headerRightContainerStyle}
        />
        <View style={[styles.fill, o.sceneStyle]}>{render()}</View>
      </View>
    );
  };

  // One tree for both ways, so spanning or folding the Duo does not remount
  // the tabs: the ones on screen show, the others stay mounted, hidden, as tabs do.
  const bar = (
    <AppTabBar selected={both ? ['projects', rightTab] : [focused.name]} onTab={focus} bottomInset={insets.bottom} />
  );
  return (
    <NavigationContent>
      <View style={styles.fill}>
        <View style={styles.row}>
          {state.routeNames.map((name) => {
            const route = state.routes.find((r) => r.name === name);
            const left = both && name === 'projects';
            const visible = shownNames.includes(name);
            const pane = !visible
              ? styles.hidden
              : both && hinge ? { width: left ? hinge.x : width - hinge.x - hinge.width } : styles.fill;
            return (
              <View key={name} style={pane} onTouchStart={both ? () => focus(name) : undefined}>
                <TabShown.Provider value={visible && rootShown}>
                  {route ? scene(route.key) : null}
                </TabShown.Provider>
                {/* Side by side, the bar sits under Projects, as the desktop's strip tops its sidebar. */}
                {left ? bar : null}
              </View>
            );
          })}
        </View>
        {both ? null : bar}
      </View>
    </NavigationContent>
  );
}

/** Tabs for a Surface Duo, side by side when they have both screens. */
export const DuoTabs = withLayoutContext(createNavigatorFactory(DuoTabsNavigator)().Navigator);

const styles = StyleSheet.create({
  fill: { flex: 1 },
  row: { flex: 1, flexDirection: 'row', justifyContent: 'space-between' },
  hidden: { display: 'none' },
});
