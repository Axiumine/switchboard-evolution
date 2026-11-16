import { create } from 'zustand';

import { terminalSend, type PendingAttachment } from './attachments';

// What is being written to each session, kept while the app is alive:
// switching between Chat and Terminal, or leaving the session and coming
// back, keeps the text and the attachments.

export type AttachmentItem = PendingAttachment & {
  id: string;
  state: 'uploading' | 'done' | 'failed';
  /** Where the computer saved it, once done. */
  path?: string;
  error?: string;
  /** False when trying again cannot help (too large). */
  retryable?: boolean;
};

export type Draft = { text: string; attachments: AttachmentItem[] };

const EMPTY: Draft = { text: '', attachments: [] };

export const useDrafts = create<{ bySession: Record<string, Draft> }>(() => ({ bySession: {} }));

export function getDraft(sessionId: string): Draft {
  return useDrafts.getState().bySession[sessionId] || EMPTY;
}

function update(sessionId: string, change: (draft: Draft) => Draft) {
  useDrafts.setState((state) => ({ bySession: { ...state.bySession, [sessionId]: change(state.bySession[sessionId] || EMPTY) } }));
}

export function setDraftText(sessionId: string, text: string) {
  update(sessionId, (draft) => ({ ...draft, text }));
}

export function updateDraftAttachments(sessionId: string, change: (items: AttachmentItem[]) => AttachmentItem[]) {
  update(sessionId, (draft) => ({ ...draft, attachments: change(draft.attachments) }));
}

export function clearDraft(sessionId: string) {
  update(sessionId, () => EMPTY);
}

/** A session's draft, kept up to date. */
export function useDraft(sessionId: string): Draft {
  return useDrafts((state) => state.bySession[sessionId] || EMPTY);
}

/**
 * Whether a draft can go: something to send, and no attachment still
 * uploading or failed. `attach` false when the computer takes no
 * attachments: they are not shown, so they neither count nor hold it back.
 */
export function draftReady(draft: Draft, attach = true): boolean {
  const items = attach ? draft.attachments : [];
  if (items.some((item) => item.state !== 'done')) return false;
  return !!draft.text.trim() || items.length > 0;
}

const pause = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Send a session's draft: the text, the attachments' paths on the computer
 * as one bracketed paste, then Enter a moment later (`write` sends to the
 * terminal and settles once the computer has it). Once the text and paths
 * are through, what was sent leaves the draft; anything typed or attached
 * meanwhile stays. Returns false when the draft is not ready; throws, with
 * the draft kept, when the computer cannot be reached.
 */
export async function sendDraft(
  sessionId: string,
  write: (data: string) => Promise<unknown>,
  { attach = true, wait = pause }: { attach?: boolean; wait?: (ms: number) => Promise<void> } = {},
): Promise<boolean> {
  const draft = getDraft(sessionId);
  if (!draftReady(draft, attach)) return false;
  const sent = attach ? draft.attachments : [];
  const sentIds = new Set(sent.map((item) => item.id));
  const { writes, enterAfterMs } = terminalSend(draft.text, sent.flatMap((item) => (item.path ? [item.path] : [])));
  for (const data of writes) await write(data);
  update(sessionId, (current) => ({
    text: current.text === draft.text ? '' : current.text,
    attachments: current.attachments.filter((item) => !sentIds.has(item.id)),
  }));
  await wait(enterAfterMs);
  await write('\r');
  return true;
}
