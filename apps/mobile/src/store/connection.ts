import { create } from 'zustand';

import { pairWithDesktop, RemoteClient, type ConnectionStatus, type RouteName } from '@/remote/client';
import { queryClient } from '@/remote/query';
import type { PairingPayload } from '@/remote/pairing';
import { applyDiffEvent, diffsFrom, type PendingDiffs } from '@/diffs/model';
import { applyLiveEvent, liveFromStates, noticesFrom, type LiveState, type Notices } from '@/sessions/model';
import { desktopFromPairing, keyPairOf, linkOf, loadActiveDesktop, removeDesktop, saveDesktop, withHello, type SavedDesktop } from './desktops';

// The paired computer, the connection to it, and the live state of its
// sessions. Screens read this store; desktop events update it and refresh
// the query cache.

type ConnectionStore = {
  loaded: boolean;
  desktop: SavedDesktop | null;
  status: ConnectionStatus;
  live: Record<string, LiveState>;
  /** Unread and needs-you marks, shared with the desktop. */
  notices: Notices;
  /** IDE diffs waiting for an answer, by diff id. */
  diffs: PendingDiffs;
  /** The session open on screen: not announced as needing you, and read on the desktop too. */
  viewing: string | null;
  setViewing(sessionId: string | null): void;
  /** The app came to the foreground or left it: in the background nothing is on screen. */
  setForeground(active: boolean): void;
  /** Read every live session's state again. */
  refreshLive(): Promise<void>;
  /** Load the saved computer and connect to it. */
  init(): Promise<void>;
  /** Pair with the computer in a scanned QR code, through `route`, then connect to it. */
  pair(payload: PairingPayload, deviceName: string, route?: RouteName): Promise<void>;
  /** Reach the computer another way (local network, Cloudflare, ngrok), from now on. */
  setRoute(route: RouteName): Promise<void>;
  /** Forget the computer on this phone. */
  forget(): Promise<void>;
  /** Reconnect now instead of waiting for the next retry. */
  reconnect(): void;
};

let client: RemoteClient | null = null;
let foreground = true;
const noNotices = (): Notices => ({ ready: new Set(), attention: new Set() });

type DesktopEventListener = (event: string, args: any[]) => void;
const eventListeners = new Set<DesktopEventListener>();

/** Hear every event from the computer (terminal output, state changes). Returns the unsubscribe. */
export function onDesktopEvent(listener: DesktopEventListener): () => void {
  eventListeners.add(listener);
  return () => { eventListeners.delete(listener); };
}

/** Call the computer. Rejects when not connected. */
export function request<T = any>(method: string, params: unknown[] = [], options?: { timeoutMs?: number }): Promise<T> {
  if (!client) return Promise.reject(new Error('No computer is paired'));
  return client.request<T>(method, params, options);
}

/** Whether the computer is connected and offers `method` (older desktops lack newer ones). */
export function hasCapability(status: ConnectionStatus, method: string): boolean {
  return status.state === 'online' && status.hello.methods.includes(method);
}

/** `hasCapability` for the connection now. */
export function useCapability(method: string): boolean {
  return useConnection((s) => hasCapability(s.status, method));
}

export const useConnection = create<ConnectionStore>((set, get) => {
  async function refreshLive() {
    try {
      const states = await request<any[]>('get-session-states');
      set({ live: liveFromStates(states, get().live) });
    } catch {}
  }

  async function refreshDiffs() {
    try {
      set({ diffs: diffsFrom(await request('list-pending-diffs')) });
    } catch {}
  }

  async function refreshNotices() {
    try {
      set({ notices: noticesFrom(await request('get-session-notices')) });
    } catch {}
  }

  // The desktop counts the session on this screen as seen, so it stays read there.
  function tellViewing() {
    if (get().status.state !== 'online') return;
    request('set-viewing', [foreground ? get().viewing : null]).catch(() => {});
  }

  function connect(desktop: SavedDesktop) {
    client?.stop();
    client = new RemoteClient({
      link: linkOf(desktop),
      device: keyPairOf(desktop),
      onStatus: (status) => {
        set({ status });
        if (status.state === 'online') {
          // Everything may have changed while offline.
          refreshLive();
          refreshNotices();
          refreshDiffs();
          tellViewing();
          queryClient.invalidateQueries();
          // The address that worked, and the access key and Internet routes the hello brings.
          const current = get().desktop ?? desktop;
          const learned = withHello(current, status.hello) ?? current;
          const lastAddress = (desktop.route ?? 'lan') === 'lan' ? status.address : current.lastAddress;
          if (learned !== current || lastAddress !== current.lastAddress) {
            const updated = { ...learned, lastAddress };
            set({ desktop: updated });
            saveDesktop(updated);
          }
        }
      },
      onEvent: (event, args) => {
        for (const listener of eventListeners) {
          try { listener(event, args); } catch {}
        }
        if (event === 'session-notices-changed') {
          set({ notices: noticesFrom(args[0]) });
          return;
        }
        if (event === 'projects-changed') {
          queryClient.invalidateQueries({ queryKey: ['projects'] });
          // A session just started sends nothing else until it works.
          refreshLive();
          // Project pages list sessions too.
          queryClient.invalidateQueries({ queryKey: ['project-tree'] });
          // Worktree changes reach phones only through this event (remote-worktrees.js).
          queryClient.invalidateQueries({ queryKey: ['worktrees'] });
          if (args[0] === 'project') queryClient.invalidateQueries({ queryKey: ['project-plan'] });
          return;
        }
        if (event === 'project-plan-changed') {
          queryClient.invalidateQueries({ queryKey: ['project-plan', args[0]] });
          return;
        }
        if (event === 'knowledge-changed') {
          // An index job moved, settings or an ADR changed (remote-knowledge.js).
          const projectId = args[0] && typeof args[0] === 'object' ? (args[0] as { projectId?: string | null }).projectId : null;
          // Only the queries on screen are read again; a finished job changes their answers.
          queryClient.invalidateQueries({ queryKey: projectId ? ['knowledge', projectId] : ['knowledge'] });
          queryClient.invalidateQueries({ queryKey: projectId ? ['knowledge-data', projectId] : ['knowledge-data'] });
          return;
        }
        if (event === 'process-exited' || event === 'session-detected' || event === 'session-forked') {
          queryClient.invalidateQueries({ queryKey: ['projects'] });
        }
        const live = applyLiveEvent(get().live, event, args);
        if (live !== get().live) set({ live });
        const diffs = applyDiffEvent(get().diffs, event, args);
        if (diffs !== get().diffs) set({ diffs });
      },
    });
    client.start();
  }

  return {
    loaded: false,
    desktop: null,
    status: { state: 'closed' },
    live: {},
    notices: noNotices(),
    diffs: {},
    viewing: null,
    setViewing: (sessionId) => {
      set({ viewing: sessionId });
      tellViewing();
    },
    setForeground: (active) => {
      foreground = active;
      tellViewing();
    },
    refreshLive,

    async init() {
      const desktop = await loadActiveDesktop();
      set({ desktop, loaded: true });
      if (desktop) connect(desktop);
    },

    async pair(payload, deviceName, route = 'lan') {
      const link = {
        addresses: payload.addresses, port: payload.port, desktopKey: payload.desktopKey,
        accessKey: payload.accessKey, internet: payload.routes, route,
      };
      const { device, hello, address } = await pairWithDesktop(link, payload.code, deviceName);
      const desktop = desktopFromPairing(payload, device, hello, route === 'lan' ? address : payload.addresses[0], route);
      await saveDesktop(desktop, { makeActive: true });
      set({ desktop, live: {}, notices: noNotices(), diffs: {} });
      queryClient.clear();
      connect(desktop);
    },

    async forget() {
      const desktop = get().desktop;
      client?.stop();
      client = null;
      if (desktop) await removeDesktop(desktop.deviceId);
      queryClient.clear();
      set({ desktop: null, status: { state: 'closed' }, live: {}, notices: noNotices(), diffs: {} });
    },

    reconnect() {
      if (client && get().status.state === 'offline') client.start();
    },

    async setRoute(route) {
      const desktop = get().desktop;
      if (!desktop || (desktop.route ?? 'lan') === route) return;
      const updated = { ...desktop, route };
      await saveDesktop(updated);
      set({ desktop: updated, status: { state: 'connecting' } });
      connect(updated);
    },
  };
});
