import { useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';

import { useCommandsPin } from '@/catalog/pin';
import { hasCommandCatalog, useCommandCatalogClis } from '@/catalog/queries';
import { useWindowHeight } from '@/layout/size';
import { queryClient } from '@/remote/query';
import { sessionTitle, type Folder, type Session, type SessionState } from '@/sessions/model';
import type { CommandDoc } from '@/shared/vendor/command-catalog-model';
import { colors } from '@/theme';
import { openWindow, useCanOpenWindows } from '@/windows/open';
import { CommandsPanel, CommandsSheet } from './CommandsSheet';

// Pinned in the page, the panel takes this share of the window above the composer.
const DOCK_SHARE = 0.42;
const DOCK_MIN = 240;

/**
 * The round "/" beside a composer's Attach and the command catalog of the
 * session it opens, in the chat and in the terminal alike: full height
 * (CommandsSheet), or, pinned, in the page above the composer, where it
 * stays for the next pick (`dock`, which the composer puts over its row).
 * Its window button opens it in a window of its own where windows can open.
 * Nothing when the computer has no catalog for the session's CLI.
 */
export function useCommandsPanel({ sessionId, session, state, write, onInsert, onRan }: {
  sessionId: string;
  session: Pick<Session, 'type' | 'runtime'> | null | undefined;
  state: SessionState;
  write: (data: string) => unknown;
  onInsert: (text: string) => void;
  onRan?: (entry: CommandDoc) => void;
}): { button: ReactNode; dock: ReactNode } {
  const clis = useCommandCatalogClis();
  const [open, setOpen] = useState(false);
  const pinned = useCommandsPin((s) => s.pinned);
  const setPinned = useCommandsPin((s) => s.setPinned);
  const canWindow = useCanOpenWindows();
  const height = useWindowHeight();
  if (!hasCommandCatalog(clis, session)) return { button: null, dock: null };

  const common = {
    sessionId, runtime: session?.runtime, state, isTerminal: session?.type === 'terminal', clis, write, onInsert, onRan,
    onClose: () => setOpen(false),
    onWindow: canWindow ? () => {
      setOpen(false);
      const title = titleOf(sessionId);
      openWindow({ kind: 'commands', sessionId, runtime: session?.runtime ?? null, type: session?.type ?? null, title });
    } : undefined,
  };
  const docked = open && pinned;
  const button = (
    <>
      <Pressable
        onPress={() => setOpen(!docked)}
        hitSlop={2}
        style={({ pressed }) => [styles.button, docked && styles.on, pressed && styles.pressed]}
        accessibilityRole="button"
        accessibilityLabel="Commands"
        accessibilityHint="Lists what the CLI understands, to insert or run"
        accessibilityState={{ expanded: open }}
      >
        <Text style={[styles.slash, docked && styles.slashOn]}>/</Text>
      </Pressable>
      <CommandsSheet visible={open && !pinned} onPin={() => setPinned(true)} {...common} />
    </>
  );
  const dock = docked
    ? <CommandsPanel mode="docked" height={Math.max(DOCK_MIN, Math.round(height * DOCK_SHARE))} onPin={() => setPinned(false)} {...common} />
    : null;
  return { button, dock };
}

/** The session's title, from the lists already read, for its window's caption. */
function titleOf(sessionId: string): string {
  const folders = queryClient.getQueryData<Folder[]>(['projects']) || [];
  for (const folder of folders) {
    const session = folder.sessions.find((s) => s.sessionId === sessionId);
    if (session) return sessionTitle(session);
  }
  return '';
}

const styles = StyleSheet.create({
  // 40pt visible, as Attach; with the hit slop the target is 44.
  button: { width: 40, height: 40, borderRadius: 20, margin: 2, backgroundColor: colors.raised, alignItems: 'center', justifyContent: 'center' },
  on: { backgroundColor: 'rgba(128,136,255,0.22)' },
  pressed: { backgroundColor: colors.border },
  slash: { color: colors.text, fontSize: 20, fontWeight: '600', marginTop: -2 },
  slashOn: { color: colors.accent },
});
