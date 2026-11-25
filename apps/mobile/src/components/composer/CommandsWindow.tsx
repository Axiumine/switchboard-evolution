import { useCallback } from 'react';

import { useCommandCatalogClis } from '@/catalog/queries';
import { sessionState } from '@/sessions/model';
import { request, useConnection } from '@/store/connection';
import { CommandsPanel } from './CommandsSheet';

/**
 * A session's command catalog in a window of its own (WindowRoot, opened from
 * the panel's window button on DeX or a tablet): it stays open, and a pick
 * types into the session, Insert without Enter, as the desktop's palette in
 * its own window does. The session's state comes from the same live state as
 * the main window's.
 */
export function CommandsWindow({ sessionId, runtime, type }: { sessionId: string; runtime: string | null; type: string | null }) {
  const clis = useCommandCatalogClis();
  const state = useConnection((s) => sessionState(s.live[sessionId]));
  const write = useCallback((data: string) => request('terminal-input', [sessionId, data]), [sessionId]);
  return (
    <CommandsPanel
      mode="window"
      sessionId={sessionId}
      runtime={runtime}
      state={state}
      isTerminal={type === 'terminal'}
      clis={clis}
      write={write}
      onInsert={(text) => { write(text).catch(() => {}); }}
    />
  );
}
