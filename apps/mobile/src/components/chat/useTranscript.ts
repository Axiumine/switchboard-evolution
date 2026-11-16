import { useCallback, useEffect, useRef, useState } from 'react';

import { Transcript, type ChatItem } from '@/sessions/transcript';
import { onDesktopEvent, request, useCapability, useConnection } from '@/store/connection';

const FIRST_READ_TIMEOUT_MS = 60_000;
// A first look at a conversation: its last entries. All of a long one takes
// seconds to decrypt and lay out, and the app does nothing else meanwhile.
const FIRST_ENTRIES = 500;

/**
 * Follow a session's transcript: read its last entries once (all of it from a
 * computer that cannot send only those), then only what was written since,
 * whenever the computer says sessions changed. Off (`enabled` false) for a
 * plain terminal, which has none. `loading` until the first read is back;
 * `earlier` is how many entries that read left out. Leaving the session stops
 * the reading.
 */
export function useTranscript(sessionId: string, enabled = true) {
  const [items, setItems] = useState<ChatItem[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [earlier, setEarlier] = useState(0);
  const online = useConnection((s) => s.status.state === 'online');
  const canTail = useCapability('read-session-tail');
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; };
  }, []);
  // With Claude's thinking, which the chat shows folded.
  const transcript = useRef(new Transcript({ thinking: true }));
  const cursor = useRef(0);
  const reading = useRef(false);
  const again = useRef(false);

  // One read at a time; a change during a read is picked up by reading again.
  const read = useCallback(async () => {
    if (reading.current) { again.current = true; return; }
    reading.current = true;
    try {
      do {
        again.current = false;
        try {
          // The first read may carry a long conversation: more time than a call usually gets.
          const first = cursor.current === 0;
          type Read = { entries?: any[]; cursor?: number; reset?: boolean; earlier?: number; error?: string };
          const result = first && canTail
            ? await request<Read>('read-session-tail', [sessionId, FIRST_ENTRIES], { timeoutMs: FIRST_READ_TIMEOUT_MS })
            : await request<Read>('read-session-entries', [sessionId, cursor.current], { timeoutMs: first ? FIRST_READ_TIMEOUT_MS : undefined });
          // Left the session meanwhile: what came is dropped, and nothing more is read.
          if (!alive.current) return;
          if (result.error) {
            // A session that has not written its transcript yet has none to read.
            setError(result.error === 'Session not found in cache' ? '' : result.error);
            setLoading(false);
            continue;
          }
          if (result.reset) transcript.current = new Transcript({ thinking: true });
          cursor.current = result.cursor ?? cursor.current;
          if (typeof result.earlier === 'number') setEarlier(result.earlier);
          const entries = result.entries || [];
          // Nothing new: the chat stays as it is, instead of being laid out again.
          if (entries.length || result.reset || first) setItems(transcript.current.add(entries));
          setError('');
        } catch (err: any) {
          if (!alive.current) return;
          setError(err.message);
        }
        setLoading(false);
      } while (again.current && alive.current);
    } finally {
      reading.current = false;
    }
  }, [sessionId, canTail]);

  useEffect(() => { if (online && enabled) read(); }, [online, enabled, read]);
  useEffect(() => (enabled ? onDesktopEvent((event, args) => {
    if (event === 'projects-changed' || (event === 'cli-busy-state' && args[0] === sessionId && !args[1])) read();
  }) : undefined), [enabled, read, sessionId]);

  return { items, error, loading: enabled && loading, earlier };
}

/** When the user last wrote, as a guess at when the current work began. */
export function lastUserTime(items: ChatItem[]): number | undefined {
  for (let i = items.length - 1; i >= 0; i--) {
    const item = items[i];
    if (item.kind === 'user' && item.time) {
      const time = Date.parse(item.time);
      return Number.isNaN(time) ? undefined : time;
    }
  }
  return undefined;
}
