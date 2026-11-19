import { Stack } from 'expo-router';
import JSStack, { type StackCardStyleInterpolator } from 'expo-router/js-stack';
import { useNavigationState } from 'expo-router/react-navigation';
import { Children, createElement, isValidElement, type ComponentProps, type ReactNode } from 'react';
import { StyleSheet, useWindowDimensions, View } from 'react-native';

import { backFromLeft, cardFrame, opensSplit, trimForLeftTouch } from '@/layout/carousel';
import { hasSidebar, splitNow, useHinge, useTwoPanes } from '@/layout/hinge';
import { AreaWidth } from '@/layout/size';

// The app's stack of screens. On a phone, the native stack. On a Surface Duo,
// expo-router's JS stack, which keeps the screen before the last one drawn:
// open across both screens it shows the two as a carousel (carousel.ts), and
// a screen knows the width it has from AreaWidth. In a wide window (DeX, a
// tablet) the same stack, with the sidebar where the hinge was: the root
// keeps the sidebar and what opens after it stays on the right.

type StackRoute = { key: string; name: string; params?: object };
type StackState = { index: number; routes: StackRoute[] };

/** A session asking for both screens: chat on the left, terminal on the right. */
function wantsBoth(route: StackRoute): boolean {
  if (route.name !== 'session/[id]') return false;
  return opensSplit((route.params || {}) as { split?: string });
}

/** Slides each screen to its place: on the right when it is the last, on the left when one comes after it. */
function carousel(full: boolean): StackCardStyleInterpolator {
  return ({ current, next, index, layouts }) => {
    const width = layouts.screen.width;
    const hinge = splitNow(width);
    const sidebar = hasSidebar();
    if (!hinge) {
      // One screen: the usual slide from the right.
      const enter = current.progress.interpolate({ inputRange: [0, 1], outputRange: [width, 0] });
      const leave = next ? next.progress.interpolate({ inputRange: [0, 1], outputRange: [0, -width * 0.3] }) : 0;
      return { cardStyle: { transform: [{ translateX: next ? leave : enter }] } };
    }
    const onTop = cardFrame({ windowWidth: width, hinge, index, top: true, full, sidebar });
    if (!next) {
      const translateX = current.progress.interpolate({ inputRange: [0, 1], outputRange: [width, onTop.x] });
      return { cardStyle: { width: onTop.width, transform: [{ translateX }] } };
    }
    const below = cardFrame({ windowWidth: width, hinge, index, top: false, full, sidebar });
    const translateX = next.progress.interpolate({ inputRange: [0, 1], outputRange: [onTop.x, below.x] });
    return { cardStyle: { width: below.width, transform: [{ translateX }] } };
  };
}

// The screen the user last touched, and when: what a screen on the left opens
// replaces the one on the right. Only a recent touch counts, so a screen opened
// later by itself (after a session starts, say) is not taken for one.
let touched: { key: string; at: number } | null = null;
const TOUCH_COUNTS_MS = 2000;

function lastTouched(): string | null {
  return touched && Date.now() - touched.at < TOUCH_COUNTS_MS ? touched.key : null;
}

/** Around every screen on a Duo: the width it has, and a note of the touches it gets. */
function DuoCard({ route, children }: { route: StackRoute; children: ReactNode }) {
  const state = useNavigationState((s) => s) as unknown as StackState;
  const hinge = useHinge();
  const { width } = useWindowDimensions();
  const at = state.routes.findIndex((r) => r.key === route.key);
  const frame = cardFrame({ windowWidth: width, hinge, index: at, top: at === state.index, full: wantsBoth(route), sidebar: hasSidebar() });
  return (
    <AreaWidth.Provider value={frame.width}>
      <View style={styles.card} onTouchStart={() => { touched = { key: route.key, at: Date.now() }; }}>
        {children}
      </View>
    </AreaWidth.Provider>
  );
}

type StackProps = ComponentProps<typeof Stack>;

function DuoStack({ screenOptions, children }: StackProps) {
  const { contentStyle, ...rest } = (screenOptions || {}) as { contentStyle?: object } & Record<string, unknown>;
  return (
    <JSStack
      // Plain views around the screens, not react-native-screens' native ones. A
      // native screen fills the window and Android takes it for the target of
      // any touch its own content does not cover: every tap on the left screen
      // went to the right screen's container, and reached no button.
      detachInactiveScreens={false}
      screenOptions={({ route, navigation }) => ({
        ...rest,
        headerMode: 'screen',
        cardStyle: contentStyle,
        // The screen before the last one stays drawn: it is the left screen.
        detachPreviousScreen: false,
        gestureEnabled: false,
        cardStyleInterpolator: carousel(wantsBoth(route as StackRoute)),
      })}
      screenLayout={({ route, children: screen }) => <DuoCard route={route as StackRoute}>{screen}</DuoCard>}
      UNSTABLE_router={(original) => ({
        getStateForAction(state, action, options) {
          type Result = ReturnType<typeof original.getStateForAction>;
          const back = backFromLeft(state as unknown as StackState, action as { type: string; source?: string });
          // A router answers with the new state and the route it lands on, not the bare state.
          if (back) return { state: back, affectedRouteKey: back.routes[back.index]?.key } as unknown as Result;
          const trimmed = trimForLeftTouch(state as unknown as StackState, action.type, lastTouched());
          return original.getStateForAction(trimmed as unknown as typeof state, action, options);
        },
      })}
    >
      {children}
    </JSStack>
  );
}
DuoStack.Screen = JSStack.Screen;
DuoStack.Protected = JSStack.Protected;

/**
 * The stack of screens: the native one on a phone, the two-pane one on a Duo
 * or in a wide window. A window that grows wide (the app moved to DeX) or
 * narrow again swaps one for the other. The screens are written once, as the
 * JS stack's Screen; the native stack reads only its own Screen's options (a
 * plain one lost its title and showed a header over the tabs), so they become
 * that one there.
 */
function AppStackSwitch({ children, ...props }: StackProps) {
  const twoPanes = useTwoPanes();
  if (twoPanes) return <DuoStack {...props}>{children}</DuoStack>;
  const screens = Children.map(children, (child) =>
    isValidElement(child) && child.type === JSStack.Screen
      ? createElement(Stack.Screen, { ...(child.props as ComponentProps<typeof Stack.Screen>), key: child.key ?? undefined })
      : child);
  return <Stack {...props}>{screens}</Stack>;
}
AppStackSwitch.Screen = JSStack.Screen;
AppStackSwitch.Protected = JSStack.Protected;

export const AppStack = AppStackSwitch as unknown as typeof Stack;

const styles = StyleSheet.create({
  card: { flex: 1 },
});
