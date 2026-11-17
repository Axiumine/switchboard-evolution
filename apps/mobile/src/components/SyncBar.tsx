import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { cancelAnimation, Easing, useAnimatedStyle, useReducedMotion, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';

import { useSyncing } from '@/remote/useSyncing';
import { colors } from '@/theme';

const HEIGHT = 1.5;
/** The moving segment, as a share of the width. */
const SEGMENT = 0.35;
/** Brightest point of the segment: there, but not asking for the eyes. */
const PEAK = 0.5;
const PASS_MS = 1600;
const FADE_MS = 250;

/**
 * Just under the status bar, on every screen: a faint segment sliding while
 * the app reloads in the background (useSyncing). It fades in and out; with
 * reduced motion it is a still, fainter line.
 */
export function SyncBar() {
  const insets = useSafeAreaInsets();
  const syncing = useSyncing();
  const still = useReducedMotion();
  const [width, setWidth] = useState(0);
  const opacity = useSharedValue(0);
  const progress = useSharedValue(0);
  const sliding = useSharedValue(false);
  const segment = width * SEGMENT;

  useEffect(() => {
    if (syncing) {
      opacity.value = withTiming(1, { duration: FADE_MS });
      // Back while still fading out: it keeps sliding from where it is.
      if (!still && !sliding.value) {
        sliding.value = true;
        progress.value = 0;
        progress.value = withRepeat(withTiming(1, { duration: PASS_MS, easing: Easing.inOut(Easing.ease) }), -1, false);
      }
    } else {
      // The segment keeps sliding while it fades, and stops once it is gone.
      opacity.value = withTiming(0, { duration: FADE_MS }, (finished) => {
        'worklet';
        if (!finished) return;
        cancelAnimation(progress);
        sliding.value = false;
      });
    }
  }, [syncing, still, opacity, progress, sliding]);

  useEffect(() => () => {
    cancelAnimation(opacity);
    cancelAnimation(progress);
  }, [opacity, progress]);

  const fade = useAnimatedStyle(() => ({ opacity: opacity.value }));
  const slide = useAnimatedStyle(() => ({ transform: [{ translateX: -segment + progress.value * (width + segment) }] }));

  return (
    <Animated.View
      style={[styles.bar, { top: insets.top }, fade]}
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
    >
      {still ? <View style={styles.still} /> : width > 0 ? (
        <Animated.View style={[{ width: segment, height: HEIGHT }, slide]}>
          <Svg width={segment} height={HEIGHT}>
            <Defs>
              <LinearGradient id="sync-bar" x1="0" y1="0" x2="1" y2="0">
                <Stop offset="0" stopColor={colors.accent} stopOpacity={0} />
                <Stop offset="0.5" stopColor={colors.accent} stopOpacity={PEAK} />
                <Stop offset="1" stopColor={colors.accent} stopOpacity={0} />
              </LinearGradient>
            </Defs>
            <Rect x="0" y="0" width={segment} height={HEIGHT} fill="url(#sync-bar)" />
          </Svg>
        </Animated.View>
      ) : null}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  bar: { position: 'absolute', left: 0, right: 0, height: HEIGHT, overflow: 'hidden', zIndex: 20, elevation: 20 },
  still: { flex: 1, backgroundColor: colors.accent, opacity: 0.3 },
});
