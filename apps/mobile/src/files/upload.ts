import * as Crypto from 'expo-crypto';
import * as DocumentPicker from 'expo-document-picker';
import { File, FileMode } from 'expo-file-system';
import * as ImagePicker from 'expo-image-picker';

import { ConnectionError } from '@/remote/client';
import { attachmentName } from '@/sessions/attachments';
import { toBase64 } from '@/shared/vendor/remote-protocol';
import { request } from '@/store/connection';

import { barProgress, DownloadCancelled, keptAwake, oneTransfer, showInBar, type TransferOutcome } from './download';

// Files of the phone into a folder of the computer, several at once: picked
// in the system's file picker or photo library, then sent a piece (2 MB) at
// a time with upload-project-file-chunk, which puts each file in the folder
// once it has all of it. As a download does, it shows in the bar on every
// screen, keeps the screen on, and when the connection drops it waits for the
// computer and sends the piece again (the computer writes it at its offset
// once more). One download or upload at a time (download.ts).

type Request = <T = any>(method: string, params?: unknown[], options?: { timeoutMs?: number }) => Promise<T>;

/** One piece's bytes; in base64 it stays well under the computer's 8 MB a message. */
export const UPLOAD_CHUNK_BYTES = 2 * 1024 * 1024;
// One piece over a slow network.
const CHUNK_TIMEOUT_MS = 60_000;
const ABORT_TIMEOUT_MS = 5_000;

/** A file picked on the phone, to upload. */
export type UploadItem = { uri: string; name: string };

/** What becomes of an entry of the same name already in the folder: replaced (the old one to the Trash), or kept beside the new one. */
export type UploadConflict = 'replace' | 'keep-both';

export type UploadSource = 'files' | 'photos';

/** What sendFile needs of a file: its size, and its bytes a piece at a time from the start. */
export type PieceReader = { size: number; read(length: number): Promise<Uint8Array> };

type Answer = { ok?: boolean; error?: string; relativePath?: string; name?: string };

/** Where an uploaded file lands, as the computer named it there. */
export type Uploaded = { relativePath: string; name: string };

/**
 * Send one file to the computer, piece by piece, into `folder` of `root` as
 * `name`. A piece that got no answer (ConnectionError) is sent again once
 * `waitForConnection` resolves; an error the computer sent back stops it.
 * Stops with DownloadCancelled once `cancelled()` says so.
 */
export async function sendFile(
  reader: PieceReader,
  { root, folder, name, conflict, upload }: { root: string; folder: string; name: string; conflict: UploadConflict; upload: string },
  { request, onProgress, cancelled = () => false, waitForConnection, onWaiting }: {
    request: Request;
    onProgress?: (sent: number, size: number) => void;
    cancelled?: () => boolean;
    waitForConnection?: () => Promise<void>;
    onWaiting?: (waiting: boolean) => void;
  },
): Promise<Uploaded> {
  let offset = 0;
  for (;;) {
    if (cancelled()) throw new DownloadCancelled();
    const bytes = await reader.read(UPLOAD_CHUNK_BYTES);
    const last = offset + bytes.length >= reader.size;
    // Nothing more to read before the end: the file got shorter.
    if (!bytes.length && !last) throw new Error('The file changed on the phone while it uploaded.');
    const piece = { upload, offset, base64: toBase64(bytes), ...(last ? { last: true, conflict } : {}) };
    let answer: Answer;
    for (;;) {
      if (cancelled()) throw new DownloadCancelled();
      try {
        answer = await request<Answer>('upload-project-file-chunk', [root, folder, name, piece], { timeoutMs: CHUNK_TIMEOUT_MS });
        break;
      } catch (err) {
        if (!(err instanceof ConnectionError) || !waitForConnection) throw err;
        onWaiting?.(true);
        try { await waitForConnection(); } finally { onWaiting?.(false); }
      }
    }
    if (!answer?.ok) throw new Error(answer?.error || 'The computer did not take the file');
    offset += bytes.length;
    onProgress?.(offset, reader.size);
    if (last) return { relativePath: answer.relativePath ?? name, name: answer.name ?? name };
  }
}

/**
 * Upload the files picked into `folder` of `root`, one after the other, with
 * their progress in the bar. A file that fails does not stop the others;
 * Cancel stops them all, and the computer drops what came of the file on its
 * way. `done` counts the files that arrived; `uploaded` says where.
 */
export function uploadFiles(root: string, folder: string, items: UploadItem[], conflict: UploadConflict): Promise<TransferOutcome & { uploaded: Uploaded[] }> {
  return oneTransfer(() => keptAwake(async () => {
    const outcome = { done: 0, failed: [] as TransferOutcome['failed'], cancelled: false, uploaded: [] as Uploaded[] };
    for (const [i, item] of items.entries()) {
      if (barProgress.cancelled()) { outcome.cancelled = true; break; }
      showInBar(item.name, { upload: true, index: i + 1, count: items.length });
      const upload = Crypto.randomUUID();
      let handle: ReturnType<File['open']> | null = null;
      try {
        handle = new File(item.uri).open(FileMode.ReadOnly);
        const opened = handle;
        const reader: PieceReader = { size: opened.size ?? 0, read: (length) => opened.readBytes(length) };
        outcome.uploaded.push(await sendFile(reader, { root, folder, name: item.name, conflict, upload }, { request, ...barProgress }));
        outcome.done++;
      } catch (err: any) {
        if (err instanceof DownloadCancelled) {
          outcome.cancelled = true;
          request('upload-project-file-chunk', [root, folder, item.name, { upload, offset: 0, abort: true }], { timeoutMs: ABORT_TIMEOUT_MS }).catch(() => {});
          break;
        }
        outcome.failed.push({ rel: item.name, error: err?.message || String(err) });
      } finally {
        try { handle?.close(); } catch {}
      }
    }
    return outcome;
  }));
}

const pad = (n: number) => String(n).padStart(2, '0');

/** A name for a photo the library gave none: the time, with the extension of its file. */
function photoName(uri: string): string {
  const ext = /\.[A-Za-z0-9]{1,10}$/.exec(uri)?.[0] ?? '.jpg';
  const d = new Date();
  return `photo-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}${ext}`;
}

/**
 * Let the user pick files (the system's file picker) or photos (the photo
 * library, as they are, not made smaller), several at once. Cancelling gives
 * an empty list. Names come cleaned for the computer (no slashes).
 */
export async function pickUploads(source: UploadSource): Promise<UploadItem[]> {
  if (source === 'files') {
    // Copied to the cache, where expo-file-system reads it a piece at a time.
    const result = await DocumentPicker.getDocumentAsync({ type: '*/*', multiple: true, copyToCacheDirectory: true });
    if (result.canceled) return [];
    return result.assets.map((asset) => ({ uri: asset.uri, name: attachmentName(asset.name) }));
  }
  // The system photo picker needs no permission for photos.
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    allowsMultipleSelection: true,
    selectionLimit: 0,
    quality: 1,
    // The photo's own file (HEIC from an iPhone stays HEIC), not a JPEG made from it.
    preferredAssetRepresentationMode: ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Current,
  });
  if (result.canceled) return [];
  return result.assets.map((asset) => ({ uri: asset.uri, name: attachmentName(asset.fileName || photoName(asset.uri)) }));
}
