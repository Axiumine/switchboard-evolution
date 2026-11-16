import * as DocumentPicker from 'expo-document-picker';
import { File } from 'expo-file-system';
import { ImageManipulator, SaveFormat, type ImageRef } from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';

import { request } from '@/store/connection';

// Photos and files from the phone, for a session: picked here, saved on the
// computer (save-session-attachment answers with the absolute path there),
// then the paths are pasted into the session, where Claude Code turns a
// pasted image path into an image and any CLI can read a path.

/** A picked photo or file, ready to upload. */
export type PendingAttachment = { uri: string; name: string; mimeType?: string; size?: number };
export type AttachmentSource = 'library' | 'camera' | 'file';

/** The computer takes at most this much per file (one message carries it). */
export const MAX_ATTACHMENT_BYTES = 8 * 1024 * 1024;
export const MAX_ATTACHMENTS = 6;
export const TOO_LARGE = 'Too large (max 8 MB)';

const MAX_PHOTO_EDGE = 2048;
const PHOTO_QUALITY = 0.8;
const MAX_NAME_LENGTH = 120;
// An 8 MB upload over a slow network.
const UPLOAD_TIMEOUT_MS = 120_000;

// --- Pasting paths ---

// A path made only of these needs no quotes in a shell.
const PLAIN_PATH = /^[A-Za-z0-9_\-.,/:@%+=]+$/;

/** A path as a shell reads it: single-quoted when it has a space or a shell character. */
export function shellQuote(path: string): string {
  return PLAIN_PATH.test(path) ? path : `'${path.replace(/'/g, "'\\''")}'`;
}

/** The paths as one bracketed paste, separated by spaces. */
export function pasteText(paths: string[]): string {
  return `\x1b[200~${paths.map(shellQuote).join(' ')}\x1b[201~`;
}

/**
 * What Send writes to the terminal, in order, and when Enter follows: the
 * typed text, then the paths as a paste, then Enter. Enter waits 300 ms
 * after a paste, for Claude Code to read the pasted images; after text
 * alone a moment is enough (a TUI reads text and Enter written together as
 * a paste, and keeps the Enter as a new line).
 */
export function terminalSend(text: string, paths: string[]): { writes: string[]; enterAfterMs: number } {
  if (!paths.length) return { writes: text ? [text] : [], enterAfterMs: 80 };
  const writes: string[] = [];
  if (text) writes.push(/\s$/.test(text) ? text : `${text} `);
  writes.push(pasteText(paths));
  return { writes, enterAfterMs: 300 };
}

// --- Names ---

/**
 * A file name the computer accepts: no slashes or control characters (a
 * newline in a pasted path would press Enter), not empty, not too long, with
 * a short extension kept at the end.
 */
export function attachmentName(name: string): string {
  const clean = (name || '').replace(/[\x00-\x1f\x7f/\\]/g, '_').trim();
  if (!clean || clean === '.' || clean === '..') return 'attachment';
  const dot = clean.lastIndexOf('.');
  const ext = dot > 0 && /^\.[A-Za-z0-9]{1,10}$/.test(clean.slice(dot)) ? clean.slice(dot) : '';
  const stem = Array.from(ext ? clean.slice(0, dot) : clean);
  return stem.slice(0, MAX_NAME_LENGTH - ext.length).join('') + ext;
}

const pad = (n: number) => String(n).padStart(2, '0');

/** A photo's name as a JPEG: its own name with .jpg, or one made from the time. */
function jpegName(fileName: string | null | undefined): string {
  if (fileName) return `${fileName.replace(/\.[^.]*$/, '')}.jpg`;
  const d = new Date();
  return `photo-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}.jpg`;
}

// --- Picking ---

/**
 * A photo as it goes to the computer: at most 2048 px on its long edge, as
 * a JPEG at 0.8 (HEIC from an iPhone becomes something every CLI reads).
 */
async function preparePhoto(asset: ImagePicker.ImagePickerAsset): Promise<PendingAttachment> {
  const edge = (width: number, height: number) => (width >= height ? { width: MAX_PHOTO_EDGE, height: null } : { width: null, height: MAX_PHOTO_EDGE });
  // Native images, freed as soon as the JPEG is written.
  const native: { release(): void }[] = [];
  try {
    const context = ImageManipulator.manipulate(asset.uri);
    native.push(context);
    // The picker usually knows the size, so a big photo is scaled while it is drawn.
    if (Math.max(asset.width, asset.height) > MAX_PHOTO_EDGE) context.resize(edge(asset.width, asset.height));
    let image: ImageRef = await context.renderAsync();
    native.push(image);
    if (Math.max(image.width, image.height) > MAX_PHOTO_EDGE) {
      const again = ImageManipulator.manipulate(image).resize(edge(image.width, image.height));
      native.push(again);
      image = await again.renderAsync();
      native.push(image);
    }
    const saved = await image.saveAsync({ format: SaveFormat.JPEG, compress: PHOTO_QUALITY });
    return { uri: saved.uri, name: jpegName(asset.fileName), mimeType: 'image/jpeg', size: new File(saved.uri).size || undefined };
  } finally {
    for (const object of native) object.release();
  }
}

async function preparePhotos(assets: ImagePicker.ImagePickerAsset[]): Promise<PendingAttachment[]> {
  const out: PendingAttachment[] = [];
  // One at a time: a decoded photo takes a lot of memory.
  for (const asset of assets) out.push(await preparePhoto(asset));
  return out;
}

/**
 * Let the user pick up to `limit` photos or files. Cancelling gives an empty
 * list; a refused camera permission throws an error to show.
 */
export async function pickAttachments(source: AttachmentSource, limit: number = MAX_ATTACHMENTS): Promise<PendingAttachment[]> {
  if (limit <= 0) return [];
  if (source === 'file') {
    // Copied to the cache so expo-file-system can read it right away.
    const result = await DocumentPicker.getDocumentAsync({ type: '*/*', multiple: limit > 1, copyToCacheDirectory: true });
    if (result.canceled) return [];
    return result.assets.slice(0, limit).map((asset) => ({ uri: asset.uri, name: asset.name, mimeType: asset.mimeType, size: asset.size }));
  }
  if (source === 'camera') {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) {
      throw new Error(permission.canAskAgain
        ? 'Switchboard Evolution needs the camera to take a photo.'
        : 'Camera access is off for Switchboard Evolution. Turn it on in Settings to take a photo.');
    }
    const result = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 1 });
    if (result.canceled) return [];
    return preparePhotos(result.assets.slice(0, 1));
  }
  // The system photo picker needs no permission for photos (only videos on
  // iOS do, and this picks images only).
  const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsMultipleSelection: limit > 1, selectionLimit: limit, quality: 1 });
  if (result.canceled) return [];
  return preparePhotos(result.assets.slice(0, limit));
}

/** One photo or file, or null when the user cancels. */
export async function pickAttachment(source: AttachmentSource): Promise<PendingAttachment | null> {
  return (await pickAttachments(source, 1))[0] ?? null;
}

// --- Uploading ---

export type AttachmentIO = {
  request: <T = any>(method: string, params?: unknown[], options?: { timeoutMs?: number }) => Promise<T>;
  readFile: (uri: string) => { size: number; base64(): Promise<string> };
};

const deviceIO: AttachmentIO = { request, readFile: (uri) => new File(uri) };

/** How many bytes a base64 string holds. */
function decodedLength(base64: string): number {
  const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0;
  return Math.floor((base64.length * 3) / 4) - padding;
}

/**
 * Save an attachment on the computer, in the session's attachments folder.
 * Returns its absolute path there. A file over 8 MiB is refused here,
 * before anything is sent.
 */
export async function uploadAttachment(sessionId: string, attachment: PendingAttachment, io: AttachmentIO = deviceIO): Promise<string> {
  if ((attachment.size ?? 0) > MAX_ATTACHMENT_BYTES) throw new Error(TOO_LARGE);
  const file = io.readFile(attachment.uri);
  if (file.size > MAX_ATTACHMENT_BYTES) throw new Error(TOO_LARGE);
  const base64 = await file.base64();
  const bytes = decodedLength(base64);
  // The size can be unknown up front (0): check what was read.
  if (bytes > MAX_ATTACHMENT_BYTES) throw new Error(TOO_LARGE);
  if (bytes <= 0) throw new Error('The file is empty');
  const answer = await io.request<{ ok?: boolean; path?: string; error?: string }>(
    'save-session-attachment',
    [sessionId, attachmentName(attachment.name), base64],
    { timeoutMs: UPLOAD_TIMEOUT_MS },
  );
  if (!answer?.ok || !answer.path) throw new Error(answer?.error || 'The computer did not save the file');
  return answer.path;
}

// --- The composer's hint line ---

/**
 * "Uploading 1 of 3 to <computer>…", or what to do about a failed upload
 * (Retry only when trying again can help: a file too large cannot); empty
 * when there is nothing to say.
 */
export function uploadHint(items: { state: 'uploading' | 'done' | 'failed'; retryable?: boolean }[], computer: string | undefined): string {
  const failed = items.filter((item) => item.state === 'failed');
  if (failed.length) {
    const what = failed.some((item) => item.retryable !== false) ? 'Retry or remove' : 'Remove';
    return failed.length === 1
      ? `1 attachment did not upload. ${what} it to send.`
      : `${failed.length} attachments did not upload. ${what} them to send.`;
  }
  const uploading = items.filter((item) => item.state === 'uploading').length;
  if (!uploading) return '';
  return `Uploading ${items.length - uploading + 1} of ${items.length} to ${computer || 'the computer'}…`;
}
