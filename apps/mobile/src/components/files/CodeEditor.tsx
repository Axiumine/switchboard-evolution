import { useCallback, useEffect, useImperativeHandle, useRef, useState, type ComponentType, type Ref } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { WebView as RNWebView, type WebViewMessageEvent, type WebViewProps } from 'react-native-webview';

import { call, languageScript, parseMessage, type CursorAction, type EditorState, type FindOptions, type FindResult } from '@/editor/bridge';
import { EDITOR_HTML } from '@/editor/editor-html.generated';
import { EDITOR_LANGUAGES } from '@/editor/editor-languages.generated';
import { useEditorFont } from '@/editor/font';
import { colors } from '@/theme';

// react-native-webview types its class as WebView<P = undefined>, which makes
// every prop `never`; give it the shape it actually has.
type WebViewHandle = { injectJavaScript(script: string): void };
const WebView = RNWebView as unknown as ComponentType<WebViewProps & { ref?: Ref<WebViewHandle> }>;

/** How long Save waits for the page to hand over the text. */
const TEXT_TIMEOUT_MS = 10_000;

export type CodeEditorHandle = {
  /** The text as it is now in the editor. */
  getText(): Promise<string>;
  undo(): void;
  redo(): void;
  /** Back to the text it was given, dropping every edit. */
  revert(): void;
  /** A command of the cursor bar: next or all occurrences, a cursor above or below, back to one. */
  cursors(action: CursorAction): void;
  /** `text` (from getText) was saved: the editor is clean unless it changed since, its history kept. */
  saved(text: string): void;
  /** Search `query` (an empty one clears the search); the matches marked, the first from the cursor selected. */
  find(query: string, options: FindOptions): void;
  /** The next match (1) or the previous one (-1), round the end. */
  findNext(direction: 1 | -1): void;
  /** Replace the selected match and go to the next (the first press goes to a match). */
  replace(text: string, options: FindOptions): void;
  replaceAll(text: string, options: FindOptions): void;
  clearFind(): void;
};

/**
 * A file's text in CodeMirror (scripts/editor-page/page.js in a WebView):
 * highlighted by the file's name, with line numbers, read-only or editable.
 * `line` marks a line and opens the file scrolled to it. A new `text` (the
 * saved file read back) shows that text and starts its history again. With
 * `base`, what differs from it is marked in the text as it is edited.
 * The text size is the one all editors share (useEditorFont), or `fontSize`.
 * `onChange` is called at every edit (not on a load), for autosave's timer:
 * `onState` only hears of the first edit, as dirty does not change after it.
 * `onFind` hears what a search found (and its count as the text changes),
 * `onOpenFind` that Cmd/Ctrl+F was pressed on a hardware keyboard.
 */
export function CodeEditor({ text, filename, editable, line, wrap = false, base, fontSize, onState, onChange, onFind, onOpenFind, ref }: {
  text: string;
  filename: string;
  editable: boolean;
  line?: number;
  wrap?: boolean;
  base?: string;
  fontSize?: number;
  onState?: (state: EditorState) => void;
  onChange?: () => void;
  onFind?: (result: FindResult) => void;
  onOpenFind?: () => void;
  ref?: Ref<CodeEditorHandle>;
}) {
  const webRef = useRef<WebViewHandle>(null);
  const ready = useRef(false);
  // The page's state as calls: sent again whenever the page (re)starts.
  const shown = useRef({ load: '', editable: '', fontSize: '', find: '' });
  const texts = useRef(new Map<number, (text: string) => void>());
  const nextId = useRef(1);
  const onStateRef = useRef(onState);
  const onChangeRef = useRef(onChange);
  const onFindRef = useRef(onFind);
  const onOpenFindRef = useRef(onOpenFind);
  const sharedSize = useEditorFont((s) => s.size);
  const size = fontSize ?? sharedSize;
  const [loaded, setLoaded] = useState(false);

  useEffect(() => { onStateRef.current = onState; }, [onState]);
  useEffect(() => { onChangeRef.current = onChange; }, [onChange]);
  useEffect(() => { onFindRef.current = onFind; }, [onFind]);
  useEffect(() => { onOpenFindRef.current = onOpenFind; }, [onOpenFind]);

  // Before the page is ready a call is dropped: undo, redo and the rest only
  // come after a file is shown, and the file and the mode go with `ready`.
  const run = useCallback((script: string) => {
    if (ready.current) webRef.current?.injectJavaScript(script);
  }, []);

  useEffect(() => {
    shown.current.load = call('load', text, filename, { line: line ?? null, wrap, base: base ?? null });
    run(shown.current.load);
  }, [text, filename, line, wrap, base, run]);
  useEffect(() => {
    shown.current.editable = call('setEditable', editable);
    run(shown.current.editable);
  }, [editable, run]);
  useEffect(() => {
    shown.current.fontSize = call('setFontSize', size);
    run(shown.current.fontSize);
  }, [size, run]);

  useImperativeHandle(ref, () => ({
    getText: () => new Promise<string>((resolve, reject) => {
      const id = nextId.current++;
      const timer = setTimeout(() => {
        texts.current.delete(id);
        reject(new Error('The editor did not answer. Close the file and open it again.'));
      }, TEXT_TIMEOUT_MS);
      texts.current.set(id, (value) => { clearTimeout(timer); resolve(value); });
      run(call('getText', id));
    }),
    undo: () => run(call('undo')),
    redo: () => run(call('redo')),
    revert: () => run(call('revert')),
    cursors: (action) => run(call('cursors', action)),
    saved: (text) => run(call('saved', text)),
    find: (query, options) => {
      // The search goes with the page when it starts again, as the file does.
      shown.current.find = query ? call('find', query, options) : '';
      run(query ? shown.current.find : call('clearFind'));
    },
    findNext: (direction) => run(call('findNext', direction)),
    replace: (value, options) => run(call('replace', value, options)),
    replaceAll: (value, options) => run(call('replaceAll', value, options)),
    clearFind: () => {
      shown.current.find = '';
      run(call('clearFind'));
    },
  }), [run]);

  const onMessage = useCallback((event: WebViewMessageEvent) => {
    const message = parseMessage(event.nativeEvent.data);
    if (!message) return;
    if (message.type === 'ready') {
      // The first start, or the page loaded again: it starts empty either way.
      ready.current = true;
      webRef.current?.injectJavaScript(shown.current.fontSize + shown.current.load + shown.current.editable + shown.current.find);
    } else if (message.type === 'loaded') {
      setLoaded(true);
    } else if (message.type === 'changed') {
      onChangeRef.current?.();
    } else if (message.type === 'state') {
      onStateRef.current?.({ dirty: message.dirty, canUndo: message.canUndo, canRedo: message.canRedo, cursors: message.cursors });
    } else if (message.type === 'find') {
      const { type: _type, ...result } = message;
      onFindRef.current?.(result);
    } else if (message.type === 'openFind') {
      onOpenFindRef.current?.();
    } else if (message.type === 'needLanguage') {
      // Asked once per page: a grammar it has not got stays plain text.
      const source = EDITOR_LANGUAGES[message.addon];
      if (source) webRef.current?.injectJavaScript(languageScript(message.addon, source));
    } else if (message.type === 'text') {
      const resolve = texts.current.get(message.id);
      texts.current.delete(message.id);
      resolve?.(message.text);
    }
  }, []);

  return (
    <View style={styles.container}>
      <WebView
        ref={webRef}
        source={{ html: EDITOR_HTML }}
        originWhitelist={['*']}
        onMessage={onMessage}
        style={styles.web}
        containerStyle={styles.web}
        // The page scrolls inside itself (CodeMirror's scroller), not the WebView.
        scrollEnabled={false}
        // Android: a touch on the code stays the code's (long lines scroll
        // sideways), so it does not move the project page to another tab.
        nestedScrollEnabled
        bounces={false}
        overScrollMode="never"
        automaticallyAdjustContentInsets={false}
        contentInsetAdjustmentBehavior="never"
        keyboardDisplayRequiresUserAction={false}
        hideKeyboardAccessoryView
        allowsLinkPreview={false}
        setSupportMultipleWindows={false}
        accessibilityLabel={filename}
      />
      {loaded ? null : (
        <View style={styles.loading}>
          <ActivityIndicator color={colors.accent} />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  web: { flex: 1, backgroundColor: colors.background },
  loading: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background },
});
