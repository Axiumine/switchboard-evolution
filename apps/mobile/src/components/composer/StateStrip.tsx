import Ionicons from '@expo/vector-icons/Ionicons';
import { useEffect } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { cancelAnimation, useAnimatedStyle, useReducedMotion, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated';

import type { SessionState } from '@/sessions/model';
import { colors, spacing } from '@/theme';

function PulsingDot() {
  const opacity = useSharedValue(1);
  const still = useReducedMotion();
  useEffect(() => {
    if (still) return;
    opacity.value = withRepeat(withTiming(0.3, { duration: 800 }), -1, true);
    return () => cancelAnimation(opacity);
  }, [opacity, still]);
  const style = useAnimatedStyle(() => ({ opacity: opacity.value }));
  return <Animated.View style={[styles.dot, style]} />;
}

/**
 * Above the chat's composer: while the session works, how long, and how to
 * stop it; while it waits for an answer, a way to the terminal, where
 * permission and choice prompts are answered.
 */
export function StateStrip({ state, cli, working, stopShown, onStop, onOpenTerminal }: {
  state: SessionState;
  /** The CLI's name: "Claude", "Codex" or "OpenCode". */
  cli: string;
  working?: string;
  /** The Send button is Stop now: point at it instead of showing another. */
  stopShown: boolean;
  onStop: () => void;
  onOpenTerminal: () => void;
}) {
  if (state === 'attention') {
    return (
      <View style={[styles.strip, styles.waiting]}>
        <Ionicons name="notifications-outline" size={17} color={colors.attention} />
        <Text style={[styles.text, styles.waitingText]} numberOfLines={2}>{cli} is waiting for your answer</Text>
        <Pressable onPress={onOpenTerminal} hitSlop={{ top: 4, bottom: 4 }} style={({ pressed }) => [styles.action, styles.open, pressed && styles.pressed]} accessibilityRole="button">
          <Text style={styles.openText}>Open terminal</Text>
        </Pressable>
      </View>
    );
  }
  if (state !== 'busy') return null;
  return (
    <View style={styles.strip} accessibilityLiveRegion="polite">
      <PulsingDot />
      <Text style={styles.text} numberOfLines={1}>{cli} is working{working ? ` · ${working}` : ''}</Text>
      {stopShown ? <Text style={styles.hint} numberOfLines={1}>Tap ✕ to interrupt</Text> : (
        <Pressable onPress={onStop} hitSlop={{ top: 4, bottom: 4 }} style={({ pressed }) => [styles.action, styles.stop, pressed && styles.pressed]} accessibilityRole="button" accessibilityHint="Interrupts the session, like Esc">
          <Ionicons name="close" size={15} color={colors.text} />
          <Text style={styles.stopText}>Stop</Text>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  strip: { minHeight: 48, paddingVertical: 6, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.lg, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  waiting: { backgroundColor: 'rgba(224,160,80,0.12)', borderBottomColor: 'rgba(224,160,80,0.28)' },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.accent },
  text: { flex: 1, color: colors.textDim, fontSize: 13.5 },
  waitingText: { color: colors.attention, fontSize: 13, lineHeight: 17, fontWeight: '600' },
  hint: { color: colors.textFaint, fontSize: 12 },
  action: { height: 36, borderRadius: 10, paddingHorizontal: 11, flexDirection: 'row', alignItems: 'center', gap: 5 },
  pressed: { opacity: 0.7 },
  stop: { backgroundColor: colors.raised, borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.14)' },
  stopText: { color: colors.text, fontSize: 14, fontWeight: '600' },
  open: { backgroundColor: 'rgba(128,136,255,0.14)', borderWidth: 1, borderColor: 'rgba(128,136,255,0.35)' },
  openText: { color: '#c8ccff', fontSize: 13.5, fontWeight: '600' },
});
