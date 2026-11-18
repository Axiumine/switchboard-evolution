/**
 * The app's side of the file editor's page (scripts/editor-page/page.js):
 * the calls the app makes through injectJavaScript, and the messages the
 * page sends back with postMessage.
 */

/** `cursors`: how many cursors and selections the text has (several with the cursor bar or Cmd+D). */
export type EditorState = { dirty: boolean; canUndo: boolean; canRedo: boolean; cursors: number };

/** What the cursor bar over the keyboard asks of the page (CURSOR_ACTIONS in scripts/editor-page/cursors.js). */
export type CursorAction = 'next' | 'all' | 'above' | 'below' | 'one';

export type EditorMessage =
  | { type: 'ready' }
  | { type: 'loaded' }
  | ({ type: 'state' } & EditorState)
  | { type: 'text'; id: number; text: string };

export type EditorCall = 'load' | 'setEditable' | 'revert' | 'saved' | 'undo' | 'redo' | 'getText' | 'cursors';

/**
 * The script that calls window.sb[fn](...args) in the page. Each argument
 * goes as JSON, with U+2028 and U+2029 escaped (a file's text can hold them,
 * and older engines end a string at them).
 */
export function call(fn: EditorCall, ...args: unknown[]): string {
  const json = args.map((arg) => (arg === undefined ? 'undefined' : JSON.stringify(arg).replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029')));
  return `window.sb.${fn}(${json.join(',')});true;`;
}

/** A message from the page, or null for anything that is not one. */
export function parseMessage(data: string): EditorMessage | null {
  let message: any;
  try { message = JSON.parse(data); } catch { return null; }
  if (!message || typeof message !== 'object') return null;
  switch (message.type) {
    case 'ready':
    case 'loaded':
      return { type: message.type };
    case 'state':
      if (typeof message.dirty !== 'boolean' || typeof message.canUndo !== 'boolean' || typeof message.canRedo !== 'boolean') return null;
      return { type: 'state', dirty: message.dirty, canUndo: message.canUndo, canRedo: message.canRedo, cursors: Number.isInteger(message.cursors) && message.cursors > 0 ? message.cursors : 1 };
    case 'text':
      if (!Number.isInteger(message.id) || typeof message.text !== 'string') return null;
      return { type: 'text', id: message.id, text: message.text };
    default:
      return null;
  }
}
