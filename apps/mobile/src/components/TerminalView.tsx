import Ionicons from '@expo/vector-icons/Ionicons';
import { useCallback, useEffect, useRef, useState, type ComponentType, type Ref } from 'react';
import { ActivityIndicator, AppState, Platform, Pressable, StyleSheet, Switch, Text, View, type LayoutChangeEvent } from 'react-native';
import { useKeyboardState } from 'react-native-keyboard-controller';
import { WebView as RNWebView, type WebViewMessageEvent, type WebViewProps } from 'react-native-webview';

import { useLayoutClass } from '@/layout/size';
import { onDesktopEvent, request, useConnection } from '@/store/connection';
import { DEFAULT_FONT_SIZE, FIT_BY_DEFAULT, MAX_FONT_SIZE, MIN_FONT_SIZE, fitNote, sizeLabel } from '@/terminal/defaults';
import { TERMINAL_HTML } from '@/terminal/terminal-html.generated';
import { colors, spacing } from '@/theme';

// react-native-webview types its class as WebView<P = undefined>, which makes
// every prop `never`; give it the shape it actually has.
type WebViewHandle = { injectJavaScript(script: string): void };
const WebView = RNWebView as unknown as ComponentType<WebViewProps & { ref?: Ref<WebViewHandle> }>;

const mono = Platform.select({ ios: 'Menlo', default: 'monospace' });

/** False while the app is in the background; a passing 'inactive' (iOS) does not count. */
function useAppActive() {
  const [active, setActive] = useState(AppState.currentState !== 'background');
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') setActive(true);
      else if (state === 'background') setActive(false);
    });
    return () => subscription.remove();
  }, []);
  return active;
}

/**
 * A live terminal for one session: xterm.js in a WebView, fed by the
 * desktop's terminal-reset / terminal-data / terminal-size events. It opens
 * at the computer's size and scrolls sideways. "Fit to phone" gives the PTY
 * the phone's size instead, which resizes the computer's terminal too, so it
 * is off on every visit and undone when the screen closes, the chat comes in
 * front, the app goes to the background or the connection drops.
 *
 * A spinner covers it until the replay is drawn. The page comes a frame
 * after the spinner, so the tap that opened the terminal shows at once.
 * `visible` false keeps it loading and attached out of sight (the session's
 * chat in front of it) and takes the focus away from it.
 */
export function TerminalView({ sessionId, onInput, visible = true }: { sessionId: string; onInput?: (send: (data: string) => void) => void; visible?: boolean }) {
  const webRef = useRef<WebViewHandle>(null);
  const ready = useRef(false);
  const pending = useRef<string[]>([]);
  const lastSeq = useRef<number | null>(null);
  const idRef = useRef(sessionId);
  const fitRef = useRef(FIT_BY_DEFAULT);
  const online = useConnection((s) => s.status.state === 'online');
  const computer = useConnection((s) => s.desktop?.name);
  const appActive = useAppActive();
  const layout = useLayoutClass();
  // On a phone the toolbar gives its height to the terminal while typing.
  const keyboardOpen = useKeyboardState((state) => state.isVisible);
  const compact = keyboardOpen && layout !== 'expanded';
  const [fitToPhone, setFitToPhone] = useState(FIT_BY_DEFAULT);
  const [fontSize, setFontSize] = useState(DEFAULT_FONT_SIZE);
  const [size, setSize] = useState({ cols: 0, rows: 0, width: 0 });
  const [viewWidth, setViewWidth] = useState(0);
  const [error, setError] = useState('');
  const [page, setPage] = useState(false);
  const [loaded, setLoaded] = useState(false);
  // Attached while open and connected, in front or not.
  const attached = online && appActive;

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const frame = requestAnimationFrame(() => { timer = setTimeout(() => setPage(true), 0); });
    return () => { cancelAnimationFrame(frame); clearTimeout(timer); };
  }, []);

  const run = useCallback((js: string) => {
    if (ready.current) webRef.current?.injectJavaScript(`${js};true;`);
    else pending.current.push(js);
  }, []);

  const send = useCallback((data: string) => {
    request('terminal-input', [idRef.current, data]).catch(() => {});
  }, []);

  useEffect(() => { onInput?.(send); }, [onInput, send]);

  // Output for this session. The id can change once (a fork, a Codex
  // session getting its real id); follow it.
  useEffect(() => onDesktopEvent((event, args) => {
    if ((event === 'session-detected' || event === 'session-forked') && args[0] === idRef.current) {
      idRef.current = args[1];
      return;
    }
    if (args[0] !== idRef.current) return;
    if (event === 'terminal-reset') {
      const [, data, seq, meta] = args;
      lastSeq.current = seq;
      run(`sb.reset(${JSON.stringify(data)}, ${meta?.cols || 0}, ${meta?.rows || 0})`);
    } else if (event === 'terminal-data') {
      lastSeq.current = args[2];
      run(`sb.write(${JSON.stringify(args[1])})`);
    } else if (event === 'terminal-size') {
      run(`sb.resize(${args[1]}, ${args[2]})`);
    } else if (event === 'terminal-overflow') {
      // Too far behind: start again from a fresh replay.
      lastSeq.current = null;
      request('attach-terminal', [idRef.current]).catch(() => {});
    }
  }), [run]);

  // Detached (background, offline): the computer has its own size back, so
  // the switch goes off too. The PTY's size changed while nothing was
  // listening, so the next attach starts from a replay, which carries it.
  useEffect(() => {
    if (attached || !fitRef.current) return;
    fitRef.current = false;
    setFitToPhone(false);
    run('sb.unfit()');
    lastSeq.current = null;
  }, [attached, run]);

  // Attach while open, in front and online; again after every reconnect,
  // from where it left off. Leaving detaches, which also gives the desktop
  // its size back.
  useEffect(() => {
    if (!attached) return;
    let cancelled = false;
    request('attach-terminal', lastSeq.current === null ? [idRef.current] : [idRef.current, lastSeq.current])
      .then(() => {
        if (cancelled) return;
        setError('');
        if (fitRef.current) run('sb.measure()');
      })
      .catch((err) => { if (!cancelled) setError(err.message); });
    return () => {
      cancelled = true;
      request('detach-terminal', [idRef.current]).catch(() => {});
    };
  }, [attached, run]);

  const onMessage = useCallback((event: WebViewMessageEvent) => {
    let message: any;
    try { message = JSON.parse(event.nativeEvent.data); } catch { return; }
    if (message.type === 'ready') {
      ready.current = true;
      for (const js of pending.current.splice(0)) webRef.current?.injectJavaScript(`${js};true;`);
    } else if (message.type === 'loaded') {
      setLoaded(true);
    } else if (message.type === 'input') {
      send(message.data);
    } else if (message.type === 'size') {
      setSize({ cols: message.cols || 0, rows: message.rows || 0, width: message.width || 0 });
    } else if (message.type === 'measure' && fitRef.current && message.cols && message.rows) {
      request('fit-terminal', [idRef.current, message.cols, message.rows]).catch(() => {});
    }
  }, [send]);

  const setFit = useCallback((next: boolean) => {
    if (next === fitRef.current) return;
    fitRef.current = next;
    setFitToPhone(next);
    if (next) {
      run('sb.measure()');
    } else {
      run('sb.unfit()');
      request('unfit-terminal', [idRef.current])
        .then((own) => { if (own) run(`sb.resize(${own.cols}, ${own.rows})`); })
        .catch(() => {});
    }
  }, [run]);

  const changeFont = (delta: number) => {
    const next = Math.min(MAX_FONT_SIZE, Math.max(MIN_FONT_SIZE, fontSize + delta));
    setFontSize(next);
    run(`sb.fontSize(${next})`);
    if (fitRef.current) run('sb.measure()');
  };

  // Behind the chat it stays attached, and only detaching gave the computer
  // its size back: Fit goes off here instead.
  useEffect(() => {
    if (visible) return;
    run('sb.blur()');
    setFit(false);
  }, [visible, run, setFit]);

  const onLayout = (event: LayoutChangeEvent) => setViewWidth(event.nativeEvent.layout.width);
  // A tablet wide enough for the computer's terminal has nothing to fit.
  const roomy = layout === 'expanded' && !fitToPhone && size.width > 0 && viewWidth > 0 && size.width <= viewWidth;

  return (
    <View style={styles.container}>
      {compact ? null : (
        <View style={styles.toolbar}>
          {roomy ? (
            <Text style={styles.caption} numberOfLines={1}>Shows the computer&apos;s terminal at its own size</Text>
          ) : (
            <Pressable onPress={() => setFit(!fitToPhone)} style={styles.fit} accessibilityRole="switch" accessibilityState={{ checked: fitToPhone }} accessibilityLabel="Fit to phone">
              {/* The row takes the tap (44pt high); the switch only shows the state. */}
              <View pointerEvents="none">
                <Switch
                  value={fitToPhone}
                  trackColor={{ false: colors.raised, true: colors.accent }}
                  thumbColor={Platform.OS === 'android' ? colors.text : undefined}
                  ios_backgroundColor={colors.raised}
                  style={styles.switch}
                  importantForAccessibility="no"
                />
              </View>
              <Text style={styles.fitText}>Fit to phone</Text>
            </Pressable>
          )}
          <View style={styles.flex} />
          <Text style={styles.size}>{sizeLabel(size.cols, size.rows)}</Text>
          <Pressable onPress={() => changeFont(-1)} disabled={fontSize <= MIN_FONT_SIZE} style={({ pressed }) => [styles.tool, pressed && styles.pressed]} accessibilityRole="button" accessibilityLabel={`Smaller text, size ${fontSize}`}>
            <Text style={[styles.toolText, fontSize <= MIN_FONT_SIZE && styles.off]}>A−</Text>
          </Pressable>
          <Pressable onPress={() => changeFont(1)} disabled={fontSize >= MAX_FONT_SIZE} style={({ pressed }) => [styles.tool, pressed && styles.pressed]} accessibilityRole="button" accessibilityLabel={`Larger text, size ${fontSize}`}>
            <Text style={[styles.toolText, fontSize >= MAX_FONT_SIZE && styles.off]}>A+</Text>
          </Pressable>
        </View>
      )}
      {fitToPhone && !compact ? (
        <View style={styles.note}>
          <Ionicons name="resize-outline" size={16} color={colors.attention} />
          <Text style={styles.noteText} numberOfLines={2}>{fitNote(computer)}</Text>
          <Pressable onPress={() => setFit(false)} hitSlop={8} style={styles.noteAction} accessibilityRole="button">
            <Text style={styles.noteActionText}>Turn off</Text>
          </Pressable>
        </View>
      ) : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <View style={styles.web}>
        {page ? (
          <WebView
            ref={webRef}
            source={{ html: TERMINAL_HTML }}
            originWhitelist={['*']}
            onMessage={onMessage}
            onLayout={onLayout}
            style={styles.web}
            containerStyle={styles.web}
            bounces={false}
            scrollEnabled={false}
            keyboardDisplayRequiresUserAction={false}
            hideKeyboardAccessoryView
            allowsLinkPreview={false}
            setSupportMultipleWindows={false}
          />
        ) : null}
        {loaded || error ? null : (
          <View style={styles.loading} accessibilityLiveRegion="polite">
            <ActivityIndicator size="large" color={colors.accent} />
            <Text style={styles.loadingText}>Loading the terminal…</Text>
          </View>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  toolbar: { height: 48, flexDirection: 'row', alignItems: 'center', gap: spacing.xs, paddingHorizontal: spacing.sm, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  flex: { flex: 1 },
  fit: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.xs },
  switch: Platform.OS === 'ios' ? { transform: [{ scale: 0.8 }] } : {},
  fitText: { color: colors.text, fontSize: 14 },
  caption: { flexShrink: 1, color: colors.textFaint, fontSize: 13, paddingHorizontal: spacing.sm },
  size: { color: colors.textFaint, fontFamily: mono, fontSize: 12, marginRight: spacing.xs },
  tool: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 10 },
  pressed: { backgroundColor: colors.raised },
  toolText: { color: colors.textDim, fontSize: 15, fontWeight: '600' },
  off: { opacity: 0.35 },
  note: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.md, backgroundColor: 'rgba(224,160,80,0.12)', borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: 'rgba(224,160,80,0.3)' },
  noteText: { flex: 1, color: colors.attention, fontSize: 13 },
  noteAction: { minHeight: 44, justifyContent: 'center' },
  noteActionText: { color: colors.attention, fontSize: 14, fontWeight: '700' },
  error: { color: colors.attention, fontSize: 13, paddingHorizontal: spacing.lg, paddingVertical: spacing.xs },
  web: { flex: 1, backgroundColor: colors.background },
  loading: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center', gap: spacing.md, padding: spacing.xl, backgroundColor: colors.background },
  loadingText: { color: colors.textDim, fontSize: 14 },
});
