import { Directory, File, Paths } from 'expo-file-system';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import * as Sharing from 'expo-sharing';
import { AppState, Platform } from 'react-native';
import { create } from 'zustand';

import { ConnectionError } from '@/remote/client';
import { request, useConnection } from '@/store/connection';

// Downloading a file of the computer to the phone. read-project-file-chunk
// hands it over a piece (2 MB) at a time, into the app's cache; then it goes
// where the user says: on iOS through the share sheet (Save to Files,
// AirDrop, another app), on Android into a folder picked in the system's
// folder picker. Sharing a file goes through the share sheet on both. One
// download or share at a time.
//
// It goes on whatever screen the user moves to (the bar is on every screen),
// and keeps the screen on while it runs. When the connection drops (the phone
// slept, the app went to the background, the network changed) it waits for
// the computer and asks again for the piece it was at, until it is cancelled.

type Chunk = { ok?: boolean; error?: string; size?: number; modified?: number; base64?: string };
type Request = <T = any>(method: string, params?: unknown[], options?: { timeoutMs?: number }) => Promise<T>;

// One piece over a slow network.
const CHUNK_TIMEOUT_MS = 60_000;
// Before asking again for a piece that got no answer.
const RETRY_PAUSE_MS = 1_000;
const KEEP_AWAKE_TAG = 'switchboard-download';
export const CHANGED = 'The file changed on the computer while it downloaded. Try again.';

/** The user stopped the download. */
export class DownloadCancelled extends Error {
  constructor() { super('Download cancelled'); }
}

/** How many bytes a base64 string holds. */
function decodedLength(base64: string): number {
  const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0;
  return Math.floor((base64.length * 3) / 4) - padding;
}

/**
 * Read a file of the computer piece by piece, giving each piece (base64) to
 * `write` in order. Stops with CHANGED when the file changes on the way, and
 * with DownloadCancelled once `cancelled()` says so. Resolves with the size.
 *
 * With `waitForConnection`, a piece that got no answer (ConnectionError: no
 * connection, a dropped one, too slow) is asked for again once it resolves,
 * from the same place; `onWaiting` says when it starts and stops waiting.
 * Without it, or for an error the computer sent back, the download stops.
 */
export async function readFileChunks(
  root: string,
  relativePath: string,
  write: (base64: string) => Promise<void>,
  { request, onProgress, cancelled = () => false, waitForConnection, onWaiting }: {
    request: Request;
    onProgress?: (received: number, size: number) => void;
    cancelled?: () => boolean;
    waitForConnection?: () => Promise<void>;
    onWaiting?: (waiting: boolean) => void;
  },
): Promise<number> {
  let offset = 0;
  let first: { size: number; modified?: number } | null = null;
  for (;;) {
    if (cancelled()) throw new DownloadCancelled();
    let piece: Chunk;
    try {
      piece = await request<Chunk>('read-project-file-chunk', [root, relativePath, offset], { timeoutMs: CHUNK_TIMEOUT_MS });
    } catch (err) {
      if (!(err instanceof ConnectionError) || !waitForConnection) throw err;
      onWaiting?.(true);
      try { await waitForConnection(); } finally { onWaiting?.(false); }
      continue;
    }
    if (!piece?.ok || typeof piece.base64 !== 'string' || typeof piece.size !== 'number') throw new Error(piece?.error || 'The computer did not send the file');
    if (first && (piece.size !== first.size || piece.modified !== first.modified)) throw new Error(CHANGED);
    first ??= { size: piece.size, modified: piece.modified };
    const bytes = decodedLength(piece.base64);
    if (cancelled()) throw new DownloadCancelled();
    if (bytes > 0) await write(piece.base64);
    offset += bytes;
    onProgress?.(offset, piece.size);
    if (offset >= piece.size) return piece.size;
    // Nothing more to read before the end: the file got shorter.
    if (bytes <= 0) throw new Error(CHANGED);
  }
}

/** A name the phone's file systems take: no slashes, colons or other characters FAT and SAF refuse. */
export function localFileName(name: string): string {
  const clean = name.replace(/[\\/:*?"<>|\x00-\x1f]/g, '_').trim();
  return clean && clean !== '.' && clean !== '..' ? clean : 'download';
}

/** What a download has received so far, for the progress line; `waiting` while the computer is out of reach. */
export type DownloadProgress = { name: string; received: number; size: number | null; cancelled: boolean; waiting: boolean };

export const useDownload = create<{ current: DownloadProgress | null }>(() => ({ current: null }));

/** Stop the download after the piece on its way. */
export function cancelDownload() {
  useDownload.setState((s) => (s.current ? { current: { ...s.current, cancelled: true } } : s));
}

export function downloadSupported(): boolean {
  return Platform.OS === 'ios' || Platform.OS === 'android';
}

// The Android folder picked last time, where the picker opens next.
let lastFolder: string | undefined;
// Until the file is handed over too, not only downloaded.
let busy = false;

export type DownloadOutcome = 'saved' | 'shared' | 'cancelled';

/** `name`, or "name (1).ext", "name (2).ext"… when a file of that name is already there. */
export function freeName(name: string, taken: ReadonlySet<string>): string {
  if (!taken.has(name)) return name;
  const dot = name.lastIndexOf('.');
  const [base, ext] = dot > 0 ? [name.slice(0, dot), name.slice(dot)] : [name, ''];
  for (let i = 1; ; i++) {
    const candidate = `${base} (${i})${ext}`;
    if (!taken.has(candidate)) return candidate;
  }
}

/**
 * Download a file of the computer and hand it over: the share sheet on iOS,
 * a folder to save it in on Android (under a free name, as a browser does).
 * Rejects with a message to show.
 */
export async function downloadProjectFile(root: string, relativePath: string, name: string): Promise<DownloadOutcome> {
  if (busy) throw new Error('Another download is still running.');
  busy = true;
  const dir = new Directory(Paths.cache, 'downloads');
  try {
    // Also clears what a download before left behind (the app quit while it ran).
    const file = emptyFile(dir, name);
    await fetchInto(file, root, relativePath, name);
    await whenOnScreen();
    return Platform.OS === 'android' ? await saveInFolder(file) : await share(file);
  } catch (err) {
    if (err instanceof DownloadCancelled) return 'cancelled';
    throw err;
  } finally {
    busy = false;
    try { if (dir.exists) dir.delete(); } catch {}
  }
}

/** What a file's screen already holds: its text, or the bytes of an image. */
export type KnownContent = { text: string } | { base64: string };

/**
 * Share a file of the computer through the system share sheet (WhatsApp,
 * Telegram, Mail…), on Android as on iOS. What the screen already holds goes
 * as it is; anything else is downloaded first. The copy stays in the cache
 * until the next share: the app it went to may still be reading it.
 */
export async function shareProjectFile(root: string, relativePath: string, name: string, known?: KnownContent): Promise<'shared' | 'cancelled'> {
  if (busy) throw new Error('Another download is still running.');
  busy = true;
  try {
    const file = emptyFile(new Directory(Paths.cache, 'shared'), name);
    if (known && 'text' in known) await file.write(known.text);
    else if (known) await file.write(known.base64, { encoding: 'base64' });
    else await fetchInto(file, root, relativePath, name);
    await whenOnScreen();
    await share(file);
    return 'shared';
  } catch (err) {
    if (err instanceof DownloadCancelled) return 'cancelled';
    throw err;
  } finally {
    busy = false;
  }
}

/** A new empty file called `name` in `dir`, which loses whatever it held. */
function emptyFile(dir: Directory, name: string): File {
  if (dir.exists) dir.delete();
  dir.create({ intermediates: true });
  const file = new File(dir, localFileName(name));
  file.create();
  return file;
}

/** Download a file of the computer into `file`, with its progress in the download bar. */
async function fetchInto(file: File, root: string, relativePath: string, name: string) {
  useDownload.setState({ current: { name, received: 0, size: null, cancelled: false, waiting: false } });
  // Asleep, the phone drops the connection: the screen stays on until it is done.
  const awake = activateKeepAwakeAsync(KEEP_AWAKE_TAG).catch(() => {});
  try {
    await readFileChunks(root, relativePath, (base64) => file.write(base64, { encoding: 'base64', append: true }), {
      request,
      onProgress: (received, size) => useDownload.setState((s) => (s.current ? { current: { ...s.current, received, size } } : s)),
      cancelled: () => !!useDownload.getState().current?.cancelled,
      waitForConnection: waitForComputer,
      onWaiting: (waiting) => useDownload.setState((s) => (s.current ? { current: { ...s.current, waiting } } : s)),
    });
  } finally {
    useDownload.setState({ current: null });
    await awake;
    deactivateKeepAwake(KEEP_AWAKE_TAG).catch(() => {});
  }
}

/**
 * Resolves once the computer is connected again (and a moment has passed, so a
 * piece that took too long is not asked for in a tight loop), or at once when
 * the download is cancelled. Rejects when the computer is gone for good:
 * forgotten on this phone, or the phone was removed on the computer.
 */
export function waitForComputer(): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let paused = false;
    const unsubscribe: (() => void)[] = [];
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      for (const stop of unsubscribe) stop();
      if (error) reject(error);
      else resolve();
    };
    const check = () => {
      const current = useDownload.getState().current;
      if (!current || current.cancelled) return finish();
      const { status } = useConnection.getState();
      if (status.state === 'rejected') return finish(new Error(status.message));
      if (status.state === 'closed') return finish(new Error('No computer is paired'));
      if (paused && status.state === 'online') finish();
    };
    const timer = setTimeout(() => { paused = true; check(); }, RETRY_PAUSE_MS);
    unsubscribe.push(useConnection.subscribe(check), useDownload.subscribe(check));
    check();
  });
}

/** Once the app is on screen: the folder picker and the share sheet do not open from the background. */
function whenOnScreen(): Promise<void> {
  const state = AppState.currentState;
  if (state !== 'background' && state !== 'inactive') return Promise.resolve();
  return new Promise((resolve) => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state !== 'active') return;
      subscription.remove();
      resolve();
    });
  });
}

async function share(file: File): Promise<DownloadOutcome> {
  if (!(await Sharing.isAvailableAsync())) throw new Error('This phone cannot share files');
  // No MIME type: on iOS it would add an extension; the name's own says what the file is.
  await Sharing.shareAsync(file.uri, { dialogTitle: file.name });
  return 'shared';
}

async function saveInFolder(file: File): Promise<DownloadOutcome> {
  let folder: Directory;
  try {
    folder = await Directory.pickDirectoryAsync(lastFolder);
  } catch {
    // Closing the picker rejects.
    return 'cancelled';
  }
  lastFolder = folder.uri;
  const name = freeName(file.name, new Set(folder.list().map((entry) => entry.name)));
  if (name !== file.name) file.rename(name);
  await file.copy(folder);
  return 'saved';
}
