import { useMemo, type ReactNode } from 'react';
import { StyleSheet } from 'react-native';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import Animated, { useAnimatedStyle, useReducedMotion, useSharedValue, withSequence, withTiming } from 'react-native-reanimated';

import { swipeTab, type ProjectTab } from '@/projects/tabs';

/** How far a finger moves sideways before the swipe takes the touch, or up or down before it gives it up. */
const START = 24;
/** The tab coming in slides this far, from the side the finger went towards. */
const SLIDE = 36;
const SLIDE_MS = 180;

/**
 * The project page's tabs, swiped through: a sideways swipe goes to the next
 * tab (to the left) or the one before (to the right), as the bar shows them,
 * and the tab that comes in slides in from that side.
 *
 * Only a clearly sideways move counts. Whatever scrolls inside a tab keeps
 * its touch: a list scrolling up or down, a row scrolling sideways (code in a
 * message, the folder chips) once it moves, and on Android the terminal and
 * the code viewer from the first touch (their WebViews set
 * nestedScrollEnabled). That is why this is the gesture builder's Pan: a
 * native view grabbing the touch cancels it, which the hook gestures ignore.
 */
export function SwipeTabs({ tabs, active, onChange, children }: {
  tabs: readonly { key: ProjectTab }[];
  active: ProjectTab;
  onChange: (tab: ProjectTab) => void;
  children: ReactNode;
}) {
  const still = useReducedMotion();
  const shift = useSharedValue(0);
  const style = useAnimatedStyle(() => ({
    transform: [{ translateX: shift.get() }],
    opacity: 1 - Math.abs(shift.get()) / (SLIDE * 3),
  }));

  const pan = useMemo(() => Gesture.Pan()
    .runOnJS(true)
    .activeOffsetX([-START, START])
    .failOffsetY([-START, START])
    .onEnd((event, success) => {
      if (!success) return;
      const next = swipeTab(tabs, active, { dx: event.translationX, dy: event.translationY, vx: event.velocityX });
      if (!next) return;
      onChange(next);
      if (still) return;
      shift.set(withSequence(
        withTiming(event.translationX < 0 ? SLIDE : -SLIDE, { duration: 0 }),
        withTiming(0, { duration: SLIDE_MS }),
      ));
    }), [tabs, active, onChange, still, shift]);

  return (
    <GestureHandlerRootView style={styles.fill}>
      <GestureDetector gesture={pan}>
        <Animated.View style={[styles.fill, style]}>{children}</Animated.View>
      </GestureDetector>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
});
