// The notes pad of a project: note.md in the project's folder, in a panel that
// floats over the app. What is not about the screen is here, so it is tested.

/** The file in the project folder; the computer makes it on first use (create-project-file). */
export const NOTE_FILE = 'note.md';

/** What an older Switchboard Evolution on the computer makes of note.md: it does not know the file. */
export const NOTE_NEEDS_NEWER = 'The note needs a newer Switchboard Evolution on the computer. Update it there, then try again.';

/** How long after the last edit the note is saved by itself, in ms. */
export const AUTOSAVE_MS = 1000;

export type Rect = { x: number; y: number; width: number; height: number };
/** The part of the screen the panel may be in: its edges, in dp. */
export type Bounds = { left: number; top: number; right: number; bottom: number };

export const NOTE_MIN = { width: 320, height: 240 };
/** Where a panel never opened starts: this size, bottom right. */
export const NOTE_START = { width: 420, height: 360 };
/** The gap the panel keeps from the screen's edge when it first opens. */
const MARGIN = 12;

/**
 * `rect` inside `bounds`: at least the minimum size (less when the screen has
 * no more room), at most the whole area, and moved in when it sticks out.
 * Whole dp.
 */
export function clampRect(rect: Rect, bounds: Bounds, min = NOTE_MIN): Rect {
  const room = { width: Math.max(1, bounds.right - bounds.left), height: Math.max(1, bounds.bottom - bounds.top) };
  const width = Math.round(Math.min(room.width, Math.max(Math.min(min.width, room.width), rect.width)));
  const height = Math.round(Math.min(room.height, Math.max(Math.min(min.height, room.height), rect.height)));
  const x = Math.round(Math.min(bounds.right - width, Math.max(bounds.left, rect.x)));
  const y = Math.round(Math.min(bounds.bottom - height, Math.max(bounds.top, rect.y)));
  return { x, y, width, height };
}

/** The panel's first place: bottom right of `bounds`, a margin in. */
export function startRect(bounds: Bounds): Rect {
  const rect = { ...NOTE_START, x: bounds.right - NOTE_START.width - MARGIN, y: bounds.bottom - NOTE_START.height - MARGIN };
  return clampRect(rect, bounds);
}

/** A rect read back from the saved prefs; null when it is not one. */
export function parseRect(value: unknown): Rect | null {
  if (!value || typeof value !== 'object') return null;
  const { x, y, width, height } = value as Record<string, unknown>;
  if (![x, y, width, height].every((n) => typeof n === 'number' && Number.isFinite(n))) return null;
  if ((width as number) <= 0 || (height as number) <= 0) return null;
  return { x: x as number, y: y as number, width: width as number, height: height as number };
}

/** The panel dragged by its title bar: moved by (dx, dy), kept inside. */
export function moveRect(start: Rect, dx: number, dy: number, bounds: Bounds): Rect {
  return clampRect({ ...start, x: start.x + dx, y: start.y + dy }, bounds);
}

/** The panel resized from its bottom-right corner by (dx, dy): the top left stays, the size stays within its minimum and the screen. */
export function resizeRect(start: Rect, dx: number, dy: number, bounds: Bounds): Rect {
  const width = Math.min(bounds.right - start.x, Math.max(NOTE_MIN.width, start.width + dx));
  const height = Math.min(bounds.bottom - start.y, Math.max(NOTE_MIN.height, start.height + dy));
  return clampRect({ ...start, width, height }, bounds);
}

export type SaveOutcome =
  | { kind: 'saved'; version?: string }
  | { kind: 'changed'; version?: string }
  | { kind: 'failed'; message: string };

/**
 * What the computer answered to save-project-file: saved (with the file's new
 * version), changed on the computer since the version this save was based on
 * (with the version now there), or refused.
 */
export function saveOutcome(result: unknown): SaveOutcome {
  const answer = result && typeof result === 'object' ? result as Record<string, unknown> : {};
  const version = typeof answer.version === 'string' ? answer.version : undefined;
  if (answer.ok === true) return { kind: 'saved', version };
  if (answer.code === 'CHANGED') return { kind: 'changed', version };
  return { kind: 'failed', message: typeof answer.error === 'string' && answer.error ? answer.error : 'That did not work' };
}
