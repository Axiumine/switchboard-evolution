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
// folder picker. Several files at once go into a folder picked first, on iOS
// as on Android. Sharing a file goes through the share sheet on both. One
// download, share or upload (upload.ts) at a time.
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

/**
 * What a download (or an upload) has moved so far, for the progress line;
 * `waiting` while the computer is out of reach. Of several files, `index` is
 * the one on its way (from 1) of `count`.
 */
export type DownloadProgress = {
  name: string; received: number; size: number | null; cancelled: boolean; waiting: boolean;
  upload?: boolean; index?: number; count?: number;
};

export const useDownload = create<{ current: DownloadProgress | null }>(() => ({ current: null }));

/** Stop the download after the piece on its way. */
export function cancelDownload() {
  useDownload.setState((s) => (s.current ? { current: { ...s.current, cancelled: true } } : s));
}

export function downloadSupported(): boolean {
  return Platform.OS === 'ios' || Platform.OS === 'android';
}

// The folder picked last time, where the picker opens next.
let lastFolder: string | undefined;
// Until the file is handed over too, not only downloaded.
let busy = false;
export const BUSY = 'Another download or upload is still running.';

/** Run `fn` as the one download, share or upload; rejects at once while another runs. */
export async function oneTransfer<T>(fn: () => Promise<T>): Promise<T> {
  if (busy) throw new Error(BUSY);
  busy = true;
  try {
    return await fn();
  } finally {
    busy = false;
  }
}

/** Run `fn` with the screen kept on (asleep, the phone drops the connection); the bar goes when it ends. */
export async function keptAwake<T>(fn: () => Promise<T>): Promise<T> {
  const awake = activateKeepAwakeAsync(KEEP_AWAKE_TAG).catch(() => {});
  try {
    return await fn();
  } finally {
    useDownload.setState({ current: null });
    await awake;
    deactivateKeepAwake(KEEP_AWAKE_TAG).catch(() => {});
  }
}

/** The bar on a new file, nothing moved yet. A Cancel tapped on the file before still holds. */
export function showInBar(name: string, more: Pick<DownloadProgress, 'upload' | 'index' | 'count'> = {}) {
  useDownload.setState((s) => ({ current: { name, received: 0, size: null, cancelled: !!s.current?.cancelled, waiting: false, ...more } }));
}

/** What the bar's file needs to follow a transfer: its progress, a Cancel, a wait for the computer. */
export const barProgress = {
  onProgress: (received: number, size: number) => useDownload.setState((s) => (s.current ? { current: { ...s.current, received, size } } : s)),
  cancelled: () => !!useDownload.getState().current?.cancelled,
  waitForConnection: () => waitForComputer(),
  onWaiting: (waiting: boolean) => useDownload.setState((s) => (s.current ? { current: { ...s.current, waiting } } : s)),
};

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
export function downloadProjectFile(root: string, relativePath: string, name: string): Promise<DownloadOutcome> {
  return oneTransfer(async () => {
    const dir = new Directory(Paths.cache, 'downloads');
    try {
      // Also clears what a download before left behind (the app quit while it ran).
      const file = emptyFile(dir, name);
      await keptAwake(() => { showInBar(name); return fetchInto(file, root, relativePath); });
      await whenOnScreen();
      return Platform.OS === 'android' ? await saveInFolder(file) : await share(file);
    } catch (err) {
      if (err instanceof DownloadCancelled) return 'cancelled';
      throw err;
    } finally {
      try { if (dir.exists) dir.delete(); } catch {}
    }
  });
}

/** A file to download among several: `folders` are the folders it goes in, under the one picked. */
export type DownloadItem = { relativePath: string; name: string; folders: string[] };

/** What came of several files: how many arrived, which did not and why, and whether Cancel stopped them. */
export type TransferOutcome = { done: number; failed: { rel: string; error: string }[]; cancelled: boolean };

/**
 * Download several files of the computer into a folder the user picks on the
 * phone (the system's folder picker, on iOS as on Android): each under a free
 * name, inside the folders its `folders` name (made when missing). A file
 * that fails does not stop the others; Cancel stops them all. Resolves null
 * when the picker is closed without a folder.
 */
export function downloadProjectFiles(root: string, items: DownloadItem[]): Promise<TransferOutcome | null> {
  return oneTransfer(async () => {
    let folder: Directory;
    try {
      folder = await Directory.pickDirectoryAsync(lastFolder);
    } catch {
      // Closing the picker rejects.
      return null;
    }
    lastFolder = folder.uri;
    const dir = new Directory(Paths.cache, 'downloads');
    const made = new Map<string, Directory>();
    const outcome: TransferOutcome = { done: 0, failed: [], cancelled: false };
    try {
      await keptAwake(async () => {
        for (const [i, item] of items.entries()) {
          if (barProgress.cancelled()) { outcome.cancelled = true; break; }
          showInBar(item.name, { index: i + 1, count: items.length });
          try {
            const file = emptyFile(dir, item.name);
            await fetchInto(file, root, item.relativePath);
            await saveInto(file, subfolder(folder, item.folders, made));
            outcome.done++;
          } catch (err: any) {
            if (err instanceof DownloadCancelled) { outcome.cancelled = true; break; }
            outcome.failed.push({ rel: item.relativePath, error: err?.message || String(err) });
          }
        }
      });
    } finally {
      try { if (dir.exists) dir.delete(); } catch {}
    }
    return outcome;
  });
}

/** The folder `names` lead to under `base`, each made when missing; `made` remembers them by path. */
function subfolder(base: Directory, names: string[], made: Map<string, Directory>): Directory {
  let dir = base;
  let key = '';
  for (const name of names) {
    const clean = localFileName(name);
    key += `/${clean}`;
    let next = made.get(key);
    if (!next) {
      next = dir.list().find((entry): entry is Directory => entry instanceof Directory && entry.name === clean) ?? dir.createDirectory(clean);
      made.set(key, next);
    }
    dir = next;
  }
  return dir;
}

/** What a file's screen already holds: its text, or the bytes of an image. */
export type KnownContent = { text: string } | { base64: string };

/**
 * Share a file of the computer through the system share sheet (WhatsApp,
 * Telegram, Mail…), on Android as on iOS. What the screen already holds goes
 * as it is; anything else is downloaded first. The copy stays in the cache
 * until the next share: the app it went to may still be reading it.
 */
export function shareProjectFile(root: string, relativePath: string, name: string, known?: KnownContent): Promise<'shared' | 'cancelled'> {
  return oneTransfer(async () => {
    try {
      const file = emptyFile(new Directory(Paths.cache, 'shared'), name);
      if (known && 'text' in known) await file.write(known.text);
      else if (known) await file.write(known.base64, { encoding: 'base64' });
      else await keptAwake(() => { showInBar(name); return fetchInto(file, root, relativePath); });
      await whenOnScreen();
      await share(file);
      return 'shared';
    } catch (err) {
      if (err instanceof DownloadCancelled) return 'cancelled';
      throw err;
    }
  });
}

/** A new empty file called `name` in `dir`, which loses whatever it held. */
function emptyFile(dir: Directory, name: string): File {
  if (dir.exists) dir.delete();
  dir.create({ intermediates: true });
  const file = new File(dir, localFileName(name));
  file.create();
  return file;
}

/** Download a file of the computer into `file`, with its progress in the bar (showInBar first). */
async function fetchInto(file: File, root: string, relativePath: string) {
  await readFileChunks(root, relativePath, (base64) => file.write(base64, { encoding: 'base64', append: true }), { request, ...barProgress });
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
  await saveInto(file, folder);
  return 'saved';
}

/** A copy of `file` in `folder`, under a free name, as a browser saves a download. */
async function saveInto(file: File, folder: Directory) {
  const name = freeName(file.name, new Set(folder.list().map((entry) => entry.name)));
  if (name !== file.name) file.rename(name);
  await file.copy(folder);
}
