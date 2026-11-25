/**
 * The app's side of the file editor's page (scripts/editor-page/page.js):
 * the calls the app makes through injectJavaScript, and the messages the
 * page sends back with postMessage.
 */

/** `cursors`: how many cursors and selections the text has (several with the cursor bar or Cmd+D). */
export type EditorState = { dirty: boolean; canUndo: boolean; canRedo: boolean; cursors: number };

/** What the cursor bar over the keyboard asks of the page (CURSOR_ACTIONS in scripts/editor-page/cursors.js). */
export type CursorAction = 'next' | 'all' | 'above' | 'below' | 'one';

/** The find bar's options (scripts/editor-page/find.js, the shared text-search.js). */
export type FindOptions = { matchCase: boolean; wholeWord: boolean; isRegex: boolean; preserveCase: boolean };

/**
 * What the page found: `current` is the selected match (1-based, 0 when the
 * cursor is not on one), `limited` that the count stopped at the limit,
 * `error` what is wrong with a pattern (or 'read-only'), `replaced` how many
 * Replace All changed.
 */
export type FindResult = { count: number; current: number; limited: boolean; error?: string; replaced?: number };

export type EditorMessage =
  | { type: 'ready' }
  | { type: 'loaded' }
  | { type: 'changed' }
  | ({ type: 'state' } & EditorState)
  | { type: 'text'; id: number; text: string }
  | ({ type: 'find' } & FindResult)
  | { type: 'openFind' }
  // The page shows a file whose grammar it does not carry: the app puts the grammar's script in (languageScript).
  | { type: 'needLanguage'; addon: string };

export type EditorCall =
  | 'load' | 'setEditable' | 'setFontSize' | 'revert' | 'saved' | 'undo' | 'redo' | 'getText' | 'cursors'
  | 'find' | 'findNext' | 'replace' | 'replaceAll' | 'clearFind';

/**
 * The script that calls window.sb[fn](...args) in the page. Each argument
 * goes as JSON, with U+2028 and U+2029 escaped (a file's text can hold them,
 * and older engines end a string at them).
 */
export function call(fn: EditorCall, ...args: unknown[]): string {
  const json = args.map((arg) => (arg === undefined ? 'undefined' : JSON.stringify(arg).replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029')));
  return `window.sb.${fn}(${json.join(',')});true;`;
}

/** The add-on names of the grammars (scripts/editor-page/grammars.js): lang-<key>. */
const ADDON = /^lang-[a-z]+$/;

/**
 * The script that puts a grammar in the page: its source (src/editor/editor-languages.generated.ts),
 * then the page told it is there, which colours the file shown with it.
 */
export function languageScript(addon: string, source: string): string {
  return `${source}\n;window.sb.languageReady(${JSON.stringify(addon)});true;`;
}

/** A message from the page, or null for anything that is not one. */
export function parseMessage(data: string): EditorMessage | null {
  let message: any;
  try { message = JSON.parse(data); } catch { return null; }
  if (!message || typeof message !== 'object') return null;
  switch (message.type) {
    case 'ready':
    case 'loaded':
    case 'changed':
    case 'openFind':
      return { type: message.type };
    case 'find': {
      if (!Number.isInteger(message.count) || message.count < 0 || !Number.isInteger(message.current) || message.current < 0) return null;
      const result: EditorMessage = { type: 'find', count: message.count, current: Math.min(message.current, message.count), limited: message.limited === true };
      if (typeof message.error === 'string') result.error = message.error;
      if (Number.isInteger(message.replaced)) result.replaced = message.replaced;
      return result;
    }
    case 'state':
      if (typeof message.dirty !== 'boolean' || typeof message.canUndo !== 'boolean' || typeof message.canRedo !== 'boolean') return null;
      return { type: 'state', dirty: message.dirty, canUndo: message.canUndo, canRedo: message.canRedo, cursors: Number.isInteger(message.cursors) && message.cursors > 0 ? message.cursors : 1 };
    case 'text':
      if (!Number.isInteger(message.id) || typeof message.text !== 'string') return null;
      return { type: 'text', id: message.id, text: message.text };
    case 'needLanguage':
      if (typeof message.addon !== 'string' || !ADDON.test(message.addon)) return null;
      return { type: 'needLanguage', addon: message.addon };
    default:
      return null;
  }
}
