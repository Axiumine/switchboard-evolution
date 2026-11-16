import { useKeyboardHandler } from 'react-native-keyboard-controller';
import Animated, { useAnimatedStyle, useSharedValue } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

/**
 * Goes under a screen's bottom block (composer, keys) and keeps it right
 * above the keyboard: as tall as the keyboard while it is open, frame by
 * frame as it moves, and as tall as the bottom safe area (the home indicator
 * or gesture bar) when it is closed. Whatever sits above with flex: 1
 * shrinks instead. Android draws edge to edge, so the window no longer
 * shrinks for the keyboard by itself.
 */
export function KeyboardSpacer() {
  const { bottom } = useSafeAreaInsets();
  const keyboard = useSharedValue(0);
  useKeyboardHandler({
    onMove: (event) => {
      'worklet';
      keyboard.value = Math.max(event.height, 0);
    },
    onEnd: (event) => {
      'worklet';
      keyboard.value = Math.max(event.height, 0);
    },
  }, []);
  const style = useAnimatedStyle(() => ({ height: Math.max(keyboard.value, bottom) }), [bottom]);
  return <Animated.View style={style} />;
}
