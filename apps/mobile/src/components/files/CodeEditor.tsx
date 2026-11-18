import { useCallback, useEffect, useImperativeHandle, useRef, useState, type ComponentType, type Ref } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { WebView as RNWebView, type WebViewMessageEvent, type WebViewProps } from 'react-native-webview';

import { call, parseMessage, type EditorState } from '@/editor/bridge';
import { EDITOR_HTML } from '@/editor/editor-html.generated';
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
};

/**
 * A file's text in CodeMirror (scripts/editor-page/page.js in a WebView):
 * highlighted by the file's name, with line numbers, read-only or editable.
 * `line` marks a line and opens the file scrolled to it. A new `text` (the
 * saved file read back) shows that text and starts its history again.
 */
export function CodeEditor({ text, filename, editable, line, wrap = false, onState, ref }: {
  text: string;
  filename: string;
  editable: boolean;
  line?: number;
  wrap?: boolean;
  onState?: (state: EditorState) => void;
  ref?: Ref<CodeEditorHandle>;
}) {
  const webRef = useRef<WebViewHandle>(null);
  const ready = useRef(false);
  // The page's state as calls: sent again whenever the page (re)starts.
  const shown = useRef({ load: '', editable: '' });
  const texts = useRef(new Map<number, (text: string) => void>());
  const nextId = useRef(1);
  const onStateRef = useRef(onState);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => { onStateRef.current = onState; }, [onState]);

  // Before the page is ready a call is dropped: undo, redo and the rest only
  // come after a file is shown, and the file and the mode go with `ready`.
  const run = useCallback((script: string) => {
    if (ready.current) webRef.current?.injectJavaScript(script);
  }, []);

  useEffect(() => {
    shown.current.load = call('load', text, filename, { line: line ?? null, wrap });
    run(shown.current.load);
  }, [text, filename, line, wrap, run]);
  useEffect(() => {
    shown.current.editable = call('setEditable', editable);
    run(shown.current.editable);
  }, [editable, run]);

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
  }), [run]);

  const onMessage = useCallback((event: WebViewMessageEvent) => {
    const message = parseMessage(event.nativeEvent.data);
    if (!message) return;
    if (message.type === 'ready') {
      // The first start, or the page loaded again: it starts empty either way.
      ready.current = true;
      webRef.current?.injectJavaScript(shown.current.load + shown.current.editable);
    } else if (message.type === 'loaded') {
      setLoaded(true);
    } else if (message.type === 'state') {
      onStateRef.current?.({ dirty: message.dirty, canUndo: message.canUndo, canRedo: message.canRedo });
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
