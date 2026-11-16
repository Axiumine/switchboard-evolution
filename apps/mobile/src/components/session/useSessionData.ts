import { useQuery } from '@tanstack/react-query';
import { useCallback, useEffect, useState } from 'react';
import { Alert } from 'react-native';

import { lastUserTime, useTranscript } from '@/components/chat/useTranscript';
import { useSeconds } from '@/components/session/useSeconds';
import type { Project } from '@/projects/model';
import type { SessionView } from '@/projects/tabs';
import { elapsedLabel, sessionState, type Folder } from '@/sessions/model';
import { onDesktopEvent, request, useConnection } from '@/store/connection';

/**
 * Everything a view of one session reads: the session, its live state, its
 * conversation and what waits for review, plus resume and fork. The session's
 * own screen and a project's Session tab share it. `onIdChange` hears the new
 * id of a fork or a Codex session once its transcript appears.
 */
export function useSessionData(id: string, onIdChange?: (next: string) => void) {
  const [asked, setAsked] = useState(id);
  const [sessionId, setSessionId] = useState(id);
  // Pointed at another session (the Session tab switching): follow it.
  if (id !== asked) {
    setAsked(id);
    setSessionId(id);
  }
  const online = useConnection((s) => s.status.state === 'online');
  const live = useConnection((s) => s.live[sessionId]);
  const refreshLive = useConnection((s) => s.refreshLive);
  const [starting, setStarting] = useState(false);

  const projects = useQuery({ queryKey: ['projects'], queryFn: () => request<Folder[]>('get-projects', [false]), enabled: online });
  const session = (projects.data || []).flatMap((f) => f.sessions).find((s) => s.sessionId === sessionId);
  const isTerminal = session?.type === 'terminal';
  const state = sessionState(live);
  const running = state !== 'idle';
  // The track's name for the subtitle. Read once in a while, not on every
  // change the computer reports (as the project pages do): names rarely change.
  const trackNames = useQuery({
    queryKey: ['track-names'],
    queryFn: async () => {
      const tree = await request<{ projects: Project[] }>('get-project-tree', [false]);
      return Object.fromEntries(tree.projects.flatMap((p) => p.tracks.map((t) => [t.id, t.name]))) as Record<string, string>;
    },
    enabled: online && !!session?.trackId,
    staleTime: 5 * 60_000,
  });
  const track = session?.trackId ? trackNames.data?.[session.trackId] : undefined;
  // Read on both views: the chat is ready when switched to, and the last
  // message says roughly since when the session works.
  const transcript = useTranscript(sessionId, !isTerminal);
  const now = useSeconds(state === 'busy');
  const since = live?.busySince ?? lastUserTime(transcript.items);
  const working = state === 'busy' && since ? elapsedLabel(now - since) : undefined;
  const diffs = useConnection((s) => s.diffs);
  const waiting = Object.values(diffs).filter((d) => d.sessionId === sessionId);

  useEffect(() => onDesktopEvent((event, args) => {
    if ((event === 'session-detected' || event === 'session-forked') && args[0] === sessionId) {
      setSessionId(args[1]);
      onIdChange?.(args[1]);
    }
  }), [sessionId, onIdChange]);

  const send = useCallback((data: string) => { request('terminal-input', [sessionId, data]).catch(() => {}); }, [sessionId]);

  /** Resume or fork; the session that runs now, or null when it did not start (already said). */
  const launch = useCallback(async (mode: 'resume' | 'fork'): Promise<string | null> => {
    setStarting(true);
    try {
      const result = await request<{ sessionId?: string; error?: string }>('launch-session', [{ mode, sessionId }]);
      if (result.error || !result.sessionId) throw new Error(result.error || 'Could not start the session');
      await refreshLive();
      return result.sessionId;
    } catch (err: any) {
      Alert.alert(mode === 'fork' ? 'Could not fork' : 'Could not resume', err.message);
      return null;
    } finally {
      setStarting(false);
    }
  }, [sessionId, refreshLive]);

  return { sessionId, session, isTerminal, state, running, track, transcript, working, waiting, send, launch, starting };
}

export type SessionData = ReturnType<typeof useSessionData>;

/**
 * Chat or terminal. Once opened, the terminal stays: back on the chat it goes
 * on loading and following the session behind it, and coming back is instant.
 */
export function useSessionView(initial: SessionView | undefined) {
  const [view, setView] = useState<SessionView>(initial === 'terminal' ? 'terminal' : 'chat');
  const [terminalOpened, setTerminalOpened] = useState(initial === 'terminal');
  const showView = useCallback((next: SessionView) => {
    setView(next);
    if (next === 'terminal') setTerminalOpened(true);
  }, []);
  return { view, showView, terminalOpened };
}
