import * as Clipboard from 'expo-clipboard';
import { useEffect, useRef, useState } from 'react';
import { Platform, StyleSheet, Text, View, type AccessibilityActionEvent, type GestureResponderEvent } from 'react-native';

import { Sheet } from '@/components/Sheet';
import { sendTerminalCommand } from '@/terminal/commands';
import { encode, holdsAny, parseAction, spoken, type BarButton, type Command, type Modifiers } from '@/terminal/keys';
import { TERMINAL_BUTTONS } from '@/terminal/terminal-buttons.generated';
import { colors, spacing } from '@/theme';

const mono = Platform.select({ ios: 'Menlo', default: 'monospace' });
const { look, rows, fn, more } = TERMINAL_BUTTONS;
const REPEATS = new Set(TERMINAL_BUTTONS.repeat);
// How far up the finger goes for a key's swipe-up action, in points.
const SWIPE = 18;
const REPEAT_DELAY = 400;
const REPEAT_EVERY = 60;

type Press = 'idle' | 'down' | 'up';
type Gesture = { y: number; mode: Press; repeated: boolean; delay?: ReturnType<typeof setTimeout>; timer?: ReturnType<typeof setInterval> };

/**
 * One key: a tap does its action, a swipe up its `up` action (whose label sits
 * small and faint above the key's own, and lights up while the finger is up
 * there). Keys of terminal-buttons.yml's repeat_while_held repeat while held.
 */
function BarKey({ button, lit, sheet, onAction }: { button: BarButton; lit?: boolean; sheet?: boolean; onAction: (action: string) => void }) {
  const [press, setPress] = useState<Press>('idle');
  const gesture = useRef<Gesture>({ y: 0, mode: 'idle', repeated: false });

  useEffect(() => {
    const current = gesture.current;
    return () => { clearTimeout(current.delay); clearInterval(current.timer); };
  }, []);

  const setMode = (mode: Press) => {
    gesture.current.mode = mode;
    setPress(mode);
  };
  const stopRepeating = () => {
    const current = gesture.current;
    clearTimeout(current.delay);
    clearInterval(current.timer);
    current.delay = undefined;
    current.timer = undefined;
  };

  const onGrant = (event: GestureResponderEvent) => {
    const current = gesture.current;
    current.y = event.nativeEvent.pageY;
    current.repeated = false;
    setMode('down');
    if (!REPEATS.has(button.action)) return;
    current.delay = setTimeout(() => {
      current.repeated = true;
      onAction(button.action);
      current.timer = setInterval(() => onAction(button.action), REPEAT_EVERY);
    }, REPEAT_DELAY);
  };
  const onMove = (event: GestureResponderEvent) => {
    const current = gesture.current;
    if (!button.up || current.repeated) return;
    const rise = current.y - event.nativeEvent.pageY;
    if (rise > SWIPE && current.mode !== 'up') {
      stopRepeating();
      setMode('up');
    } else if (rise < SWIPE / 2 && current.mode === 'up') {
      setMode('down');
    }
  };
  const onRelease = () => {
    const current = gesture.current;
    stopRepeating();
    if (current.mode === 'up' && button.up) onAction(button.up.action);
    else if (current.mode === 'down' && !current.repeated) onAction(button.action);
    setMode('idle');
  };
  const onTerminate = () => {
    stopRepeating();
    setMode('idle');
  };
  const onAccessibilityAction = (event: AccessibilityActionEvent) => {
    if (event.nativeEvent.actionName === 'swipeUp' && button.up) onAction(button.up.action);
    else if (event.nativeEvent.actionName === 'activate') onAction(button.action);
  };

  return (
    <View
      style={[styles.key, { height: look.height }, sheet && styles.sheetKey, press !== 'idle' && styles.pressed, lit && styles.lit]}
      onStartShouldSetResponder={() => true}
      onResponderTerminationRequest={() => false}
      onResponderGrant={onGrant}
      onResponderMove={onMove}
      onResponderRelease={onRelease}
      onResponderTerminate={onTerminate}
      accessible
      accessibilityRole="button"
      accessibilityLabel={spoken(button.action)}
      accessibilityState={lit === undefined ? undefined : { selected: lit }}
      accessibilityActions={button.up ? [{ name: 'activate' }, { name: 'swipeUp', label: spoken(button.up.action) }] : [{ name: 'activate' }]}
      onAccessibilityAction={onAccessibilityAction}
    >
      {button.up ? (
        <Text style={[styles.upText, { fontSize: look.swipeText.size, opacity: press === 'up' ? 1 : look.swipeText.opacity }, press === 'up' && styles.upActive, lit && styles.litText]} numberOfLines={1}>
          {button.up.label}
        </Text>
      ) : null}
      <Text style={[styles.keyText, { fontSize: look.keyText }, press === 'up' && styles.faded, lit && styles.litText]} numberOfLines={1}>
        {button.label}
      </Text>
    </View>
  );
}

/**
 * The keys a phone keyboard lacks, in rows of keys all the same size, as
 * src/terminal/terminal-buttons.yml lays them out. CTRL, ALT, FN and ⌘ stay
 * lit until the next key of the bar, or the next character typed in the
 * field (`held` is shared with the composer for that). Paste, Copy and Select
 * All happen in the terminal; ⋯ opens the More keys sheet.
 */
export function TerminalKeys({ sessionId, send, held, onHeldChange }: { sessionId: string; send: (data: string) => void; held: Modifiers; onHeldChange: (held: Modifiers) => void }) {
  const [moreOpen, setMoreOpen] = useState(false);

  const run = (command: Command) => {
    if (command === 'more') setMoreOpen(true);
    else if (command === 'paste') {
      Clipboard.getStringAsync()
        .then((text) => { if (text) sendTerminalCommand(sessionId, { type: 'paste', text }); })
        .catch(() => {});
    } else sendTerminalCommand(sessionId, { type: command });
  };

  const act = (action: string) => {
    const parsed = parseAction(action);
    if (!parsed) return;
    if (parsed.kind === 'modifier') onHeldChange({ ...held, [parsed.modifier]: !held[parsed.modifier] });
    else if (parsed.kind === 'command') run(parsed.command);
    else {
      send(encode(parsed, held, fn));
      if (holdsAny(held)) onHeldChange({});
    }
  };

  const litFor = (button: BarButton) => {
    const parsed = parseAction(button.action);
    return parsed?.kind === 'modifier' ? !!held[parsed.modifier] : undefined;
  };

  return (
    <View style={styles.bar}>
      {rows.map((row, r) => (
        <View key={r} style={styles.row}>
          {row.map((button, k) => <BarKey key={k} button={button} lit={litFor(button)} onAction={act} />)}
        </View>
      ))}
      <Sheet visible={moreOpen} title="More keys" onClose={() => setMoreOpen(false)}>
        <View style={styles.grid}>
          {more.map((button, k) => (
            <View key={k} style={styles.cell}>
              <BarKey button={button} sheet onAction={(action) => { setMoreOpen(false); act(action); }} />
            </View>
          ))}
        </View>
      </Sheet>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { gap: 4, paddingHorizontal: spacing.sm, paddingVertical: 6 },
  row: { flexDirection: 'row', gap: 4 },
  key: { flex: 1, minWidth: 0, borderRadius: 8, backgroundColor: colors.raised, alignItems: 'center', justifyContent: 'center' },
  pressed: { backgroundColor: colors.border },
  lit: { backgroundColor: colors.accent },
  keyText: { color: colors.text, fontFamily: mono, textAlign: 'center' },
  upText: { color: colors.text, fontFamily: mono, textAlign: 'center', marginBottom: 1 },
  upActive: { color: colors.accent },
  litText: { color: colors.background, fontWeight: '700' },
  faded: { opacity: 0.4 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: spacing.md, paddingBottom: spacing.sm },
  cell: { width: '25%', padding: 4 },
  sheetKey: { flex: 0, height: 52, backgroundColor: colors.surface },
});
