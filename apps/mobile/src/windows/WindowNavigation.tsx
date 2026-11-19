// Expo Router's own focus context (useIsFocused asks it): not in its index, so
// from its build, which the package exports. Look here after an SDK upgrade.
import { FocusedRouteKeyContext, IsFocusedContext } from 'expo-router/build/react-navigation/core/useIsFocused';
import { NavigationContext, NavigationRouteContext } from 'expo-router/react-navigation';
import { useMemo, useState, type ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { colors, spacing } from '@/theme';

// A window of its own shows one screen and goes nowhere: it has no Expo
// Router of its own (the router is global, the main window's). The screens
// it shows still ask what navigation answers: whether they are in sight
// (always, here), and what their header holds (Stack.Screen's title and
// buttons). This answers that, and draws the header.

type HeaderOptions = { title?: string; headerRight?: () => ReactNode };

const ROUTE = { key: 'window', name: 'window', params: {} };

/** The navigation of a window: always in sight, alone, its options kept for the header. */
function windowNavigation(setOptions: (options: HeaderOptions) => void) {
  const none = () => {};
  return {
    isFocused: () => true,
    addListener: () => none,
    removeListener: none,
    setOptions: (options: HeaderOptions) => setOptions(options),
    setParams: none,
    getParent: () => undefined,
    getId: () => 'window',
    getState: () => ({ key: 'window', index: 0, routeNames: ['window'], routes: [ROUTE], type: 'stack', stale: false }),
    canGoBack: () => false,
    goBack: none,
    navigate: none,
    dispatch: none,
    reset: none,
    emit: () => ({ defaultPrevented: false }),
  };
}

/** `children` under the header their screen asks for, `title` until it asks. */
export function WindowNavigation({ title, children }: { title: string; children: ReactNode }) {
  const insets = useSafeAreaInsets();
  const [options, setOptions] = useState<HeaderOptions>({});
  const navigation = useMemo(() => windowNavigation((next) => setOptions((now) => ({ ...now, ...next }))), []);
  return (
    // The stand-in has what the screens call; React Navigation's own type asks for much more.
    <NavigationContext.Provider value={navigation as never}>
      <NavigationRouteContext.Provider value={ROUTE as never}>
        <IsFocusedContext.Provider value>
        <FocusedRouteKeyContext.Provider value={ROUTE.key}>
        <View style={styles.screen}>
          <View style={[styles.header, { paddingTop: insets.top }]}>
            <Text style={styles.title} numberOfLines={1}>{options.title || title}</Text>
            {options.headerRight ? <View style={styles.right}>{options.headerRight()}</View> : null}
          </View>
          <View style={styles.body}>{children}</View>
        </View>
        </FocusedRouteKeyContext.Provider>
        </IsFocusedContext.Provider>
      </NavigationRouteContext.Provider>
    </NavigationContext.Provider>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, minHeight: 52, paddingHorizontal: spacing.lg, backgroundColor: colors.surface },
  title: { flex: 1, color: colors.text, fontSize: 17, fontWeight: '600' },
  right: { flexDirection: 'row', alignItems: 'center' },
  body: { flex: 1 },
});
