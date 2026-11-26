import Ionicons from '@expo/vector-icons/Ionicons';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet } from 'react-native';

import { canImprove, canUndo, changedMeanwhile, confirmText, type ImproveStep } from '@/prompt-improver/model';
import { cancelImprovePrompt, improvePrompt, usePromptImproverInfo, usePromptImproverSupported } from '@/prompt-improver/queries';
import type { Session } from '@/sessions/model';
import { colors } from '@/theme';

/**
 * The round button beside "/" that improves the prompt in the composer: the
 * computer has the session's CLI (or the one set in its settings) rewrite it,
 * out of sight, on the user's subscription, with the commands, skills and MCP
 * servers the session has. After a question (settings.confirm) the rewrite
 * takes the place of the text, and the button turns into Undo until the text
 * is changed. Tapped while it works, it stops. Nothing is ever sent.
 *
 * `getText` reads the field now (the text may change while the computer
 * works); `setText` replaces it. Nothing for a plain terminal, with the
 * improver off, or on a computer that has no improver.
 */
export function useImproveButton({ sessionId, session, text, getText, setText }: {
  sessionId: string;
  session: Pick<Session, 'type' | 'runtime'> | null | undefined;
  text: string;
  getText: () => string;
  setText: (text: string) => void;
}): ReactNode {
  const supported = usePromptImproverSupported();
  const info = usePromptImproverInfo();
  const settings = info.data?.settings ?? null;
  const [step, setStep] = useState<ImproveStep>({ phase: 'idle' });
  const alive = useRef(true);
  const running = useRef<string | null>(null);

  // Leaving the composer stops a run: its answer would have nowhere to go.
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      if (running.current) cancelImprovePrompt(running.current);
    };
  }, []);

  if (!supported || !canImprove(session, settings) || !settings) return null;

  const run = async () => {
    const sent = getText();
    if (!sent.trim()) return;
    setStep({ phase: 'running', sent });
    running.current = sessionId;
    let res;
    try {
      res = await improvePrompt(sessionId, sent, { mode: settings.context, runtime: session?.runtime || 'claude' }, settings);
    } catch (err: any) {
      res = { ok: false, error: err?.message || String(err) };
    } finally {
      running.current = null;
    }
    if (!alive.current) return;
    if (!res.ok || !res.text) {
      setStep({ phase: 'idle' });
      if (!res.cancelled) Alert.alert('Could not improve the prompt', res.error || 'The computer gave back no prompt.');
      return;
    }
    const improved = res.text;
    const put = () => { setText(improved); setStep({ phase: 'done', original: sent, improved }); };
    if (changedMeanwhile(sent, getText())) {
      setStep({ phase: 'idle' });
      Alert.alert('Your text changed', 'You edited the prompt while it was being improved. Replace it with the rewrite?', [
        { text: 'Keep mine', style: 'cancel' },
        { text: 'Replace', onPress: put },
      ]);
      return;
    }
    put();
  };

  const onPress = () => {
    if (step.phase === 'running') {
      cancelImprovePrompt(sessionId);
      return;
    }
    if (canUndo(step, text)) {
      setText(step.original);
      setStep({ phase: 'idle' });
      return;
    }
    if (!text.trim()) return;
    if (settings.confirm) {
      const { title, message } = confirmText(settings, session?.runtime);
      Alert.alert(title, message, [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Improve', onPress: () => { run(); } },
      ]);
      return;
    }
    run();
  };

  const busy = step.phase === 'running';
  const undo = !busy && canUndo(step, text);
  const empty = !busy && !undo && !text.trim();
  return (
    <Pressable
      onPress={onPress}
      disabled={empty}
      hitSlop={2}
      style={({ pressed }) => [styles.button, undo && styles.on, pressed && styles.pressed, empty && styles.off]}
      accessibilityRole="button"
      accessibilityLabel={busy ? 'Stop improving the prompt' : undo ? 'Undo the improved prompt' : 'Improve the prompt'}
      accessibilityHint={busy || undo ? undefined : 'Rewrites the prompt with the commands and skills the session has; nothing is sent'}
      accessibilityState={{ disabled: empty, busy }}
    >
      {busy
        ? <ActivityIndicator size="small" color={colors.accent} />
        : <Ionicons name={undo ? 'arrow-undo' : 'sparkles'} size={20} color={undo ? colors.accent : colors.text} />}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  // 40pt visible, as Attach and "/"; with the hit slop the target is 44.
  button: { width: 40, height: 40, borderRadius: 20, margin: 2, backgroundColor: colors.raised, alignItems: 'center', justifyContent: 'center' },
  on: { backgroundColor: 'rgba(128,136,255,0.22)' },
  pressed: { backgroundColor: colors.border },
  off: { opacity: 0.45 },
});
