import { useState } from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';

import { hasCommandCatalog, useCommandCatalogClis } from '@/catalog/queries';
import type { Session, SessionState } from '@/sessions/model';
import type { CommandDoc } from '@/shared/vendor/command-catalog-model';
import { colors } from '@/theme';
import { CommandsSheet } from './CommandsSheet';

/**
 * The round "/" beside a composer's Attach: the command catalog of the
 * session (CommandsSheet), in the chat and in the terminal alike. Hidden when
 * the computer has no catalog for the session's CLI (or no catalog at all).
 */
export function CommandsButton({ sessionId, session, state, write, onInsert, onRan }: {
  sessionId: string;
  session: Pick<Session, 'type' | 'runtime'> | null | undefined;
  state: SessionState;
  write: (data: string) => unknown;
  onInsert: (text: string) => void;
  onRan?: (entry: CommandDoc) => void;
}) {
  const clis = useCommandCatalogClis();
  const [open, setOpen] = useState(false);
  if (!hasCommandCatalog(clis, session)) return null;
  return (
    <>
      <Pressable
        onPress={() => setOpen(true)}
        hitSlop={2}
        style={({ pressed }) => [styles.button, pressed && styles.pressed]}
        accessibilityRole="button"
        accessibilityLabel="Commands"
        accessibilityHint="Lists what the CLI understands, to insert or run"
      >
        <Text style={styles.slash}>/</Text>
      </Pressable>
      <CommandsSheet
        visible={open}
        onClose={() => setOpen(false)}
        sessionId={sessionId}
        runtime={session?.runtime}
        state={state}
        isTerminal={session?.type === 'terminal'}
        clis={clis}
        write={write}
        onInsert={onInsert}
        onRan={onRan}
      />
    </>
  );
}

const styles = StyleSheet.create({
  // 40pt visible, as Attach; with the hit slop the target is 44.
  button: { width: 40, height: 40, borderRadius: 20, margin: 2, backgroundColor: colors.raised, alignItems: 'center', justifyContent: 'center' },
  pressed: { backgroundColor: colors.border },
  slash: { color: colors.text, fontSize: 20, fontWeight: '600', marginTop: -2 },
});
