import { useCallback, useMemo, useState } from 'react';

import { MAX_ATTACHMENTS, pickAttachments, TOO_LARGE, uploadAttachment, type AttachmentSource } from '@/sessions/attachments';
import { getDraft, updateDraftAttachments as update, useDraft, type AttachmentItem } from '@/sessions/drafts';

export type { AttachmentItem };

// Kept with the session's draft (src/sessions/drafts.ts), while the app is
// alive: switching between Chat and Terminal, or leaving the session and
// coming back, keeps what is attached.

function patch(sessionId: string, id: string, values: Partial<AttachmentItem>) {
  update(sessionId, (items) => items.map((item) => (item.id === id ? { ...item, ...values } : item)));
}

// Uploads go one at a time (each holds its file in memory as text).
let queue: Promise<void> = Promise.resolve();
let nextId = 1;

function upload(sessionId: string, item: AttachmentItem) {
  patch(sessionId, item.id, { state: 'uploading', error: undefined });
  queue = queue.then(async () => {
    // Removed while it waited.
    if (!getDraft(sessionId).attachments.some((it) => it.id === item.id)) return;
    try {
      const path = await uploadAttachment(sessionId, item);
      patch(sessionId, item.id, { state: 'done', path });
    } catch (err: any) {
      const error = err?.message || 'Could not upload';
      patch(sessionId, item.id, { state: 'failed', error, retryable: error !== TOO_LARGE });
    }
  });
}

/**
 * The attachments of a session's composer: pick them (they upload to the
 * computer right away), retry or remove them, and the paths to send.
 */
export function useAttachments(sessionId: string) {
  const items = useDraft(sessionId).attachments;
  const [picking, setPicking] = useState(false);

  /** Pick photos or files; they upload right away. Throws an error to show (a refused permission). */
  const add = useCallback(async (source: AttachmentSource) => {
    const room = MAX_ATTACHMENTS - getDraft(sessionId).attachments.length;
    if (room <= 0) return;
    setPicking(true);
    try {
      const picked = await pickAttachments(source, room);
      const added: AttachmentItem[] = picked.slice(0, room).map((attachment) => ({ ...attachment, id: `a${nextId++}`, state: 'uploading' }));
      update(sessionId, (current) => [...current, ...added].slice(0, MAX_ATTACHMENTS));
      for (const item of added) upload(sessionId, item);
    } finally {
      setPicking(false);
    }
  }, [sessionId]);

  const retry = useCallback((id: string) => {
    const item = getDraft(sessionId).attachments.find((it) => it.id === id);
    if (item && item.state === 'failed' && item.retryable !== false) upload(sessionId, item);
  }, [sessionId]);

  // The file stays on the computer, which removes it after a week.
  const remove = useCallback((id: string) => update(sessionId, (current) => current.filter((item) => item.id !== id)), [sessionId]);

  const clear = useCallback(() => update(sessionId, () => []), [sessionId]);

  return useMemo(() => ({
    items,
    add,
    retry,
    remove,
    clear,
    picking,
    full: items.length >= MAX_ATTACHMENTS,
    uploading: items.some((item) => item.state === 'uploading'),
    failed: items.some((item) => item.state === 'failed'),
    /** Paths on the computer of what is uploaded, in order. */
    paths: items.flatMap((item) => (item.state === 'done' && item.path ? [item.path] : [])),
  }), [items, add, retry, remove, clear, picking]);
}

export type Attachments = ReturnType<typeof useAttachments>;
