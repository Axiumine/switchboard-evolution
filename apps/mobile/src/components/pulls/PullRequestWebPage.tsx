import Ionicons from '@expo/vector-icons/Ionicons';
import * as Clipboard from 'expo-clipboard';
import * as WebBrowser from 'expo-web-browser';
import { useEffect, useRef, useState, type ComponentType, type Ref } from 'react';
import { BackHandler, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { WebView as RNWebView, type WebViewNavigation, type WebViewProps } from 'react-native-webview';

import { inAppWebUrl } from '@/pulls/model';
import { colors, spacing } from '@/theme';

// react-native-webview types its class as WebView<P = undefined>, which makes
// every prop `never`; give it the shape it actually has.
type WebViewHandle = { goBack(): void; goForward(): void; reload(): void; stopLoading(): void };
const WebView = RNWebView as unknown as ComponentType<WebViewProps & { ref?: Ref<WebViewHandle> }>;

const mono = Platform.select({ ios: 'Menlo', default: 'monospace' });

/** `url` in the phone's browser inside the app (Safari View on iOS, a Custom Tab on Android). */
export function openInAppBrowser(url: string) {
  if (!/^https?:\/\//i.test(url)) return;
  WebBrowser.openBrowserAsync(url, { controlsColor: colors.accent, toolbarColor: colors.surface }).catch(() => {});
}

type Props = {
  url: string;
  /** Close the page (the sheet over the tab); none in a screen or a window of its own. */
  onClose?: () => void;
  /** Open the page, at the address it shows now, in a window of its own (or full screen). */
  onWindow?: (current: string) => void;
  /** What onWindow does, for its button: a window where windows sit side by side, else the whole screen. */
  windowLabel?: string;
  /** Android's back button goes back in the page first. Not in a window of its own. */
  handleBack?: boolean;
};

/**
 * A pull request's page on GitHub inside the app, as on the desktop: a web
 * view (https only; GitHub's sign-in stays in it) under a toolbar with Back,
 * Forward, Reload, the address, Copy the address, Open in a window, Open in
 * the browser and Close. Links that ask for a new window open in the browser
 * inside the app; an http one too.
 */
export function PullRequestWebPage({ url, onClose, onWindow, windowLabel = 'Open in a window of its own', handleBack = false }: Props) {
  const web = useRef<WebViewHandle>(null);
  const [nav, setNav] = useState({ url, canGoBack: false, canGoForward: false, loading: true });
  const [progress, setProgress] = useState(0);
  const [copied, setCopied] = useState(false);
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const current = nav.url || url;

  useEffect(() => () => { if (copiedTimer.current) clearTimeout(copiedTimer.current); }, []);

  useEffect(() => {
    if (!handleBack || !nav.canGoBack) return undefined;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      web.current?.goBack();
      return true;
    });
    return () => sub.remove();
  }, [handleBack, nav.canGoBack]);

  const copy = () => {
    Clipboard.setStringAsync(current).catch(() => {});
    setCopied(true);
    if (copiedTimer.current) clearTimeout(copiedTimer.current);
    copiedTimer.current = setTimeout(() => setCopied(false), 1200);
  };

  const onNavigationStateChange = (state: WebViewNavigation) => {
    setNav({ url: state.url || url, canGoBack: state.canGoBack, canGoForward: state.canGoForward, loading: state.loading });
  };

  return (
    <View style={styles.page}>
      <View style={styles.bar}>
        <Tool icon="chevron-back" label="Back" disabled={!nav.canGoBack} onPress={() => web.current?.goBack()} />
        <Tool icon="chevron-forward" label="Forward" disabled={!nav.canGoForward} onPress={() => web.current?.goForward()} />
        <Tool
          icon={nav.loading ? 'close' : 'refresh'}
          label={nav.loading ? 'Stop' : 'Reload'}
          onPress={() => (nav.loading ? web.current?.stopLoading() : web.current?.reload())}
        />
        <Text style={styles.address} numberOfLines={1} ellipsizeMode="middle" selectable accessibilityLabel={`Address ${current}`}>
          {current.replace(/^https:\/\//i, '')}
        </Text>
        <Tool icon={copied ? 'checkmark' : 'link-outline'} label="Copy the address" tint={copied ? colors.running : undefined} onPress={copy} />
        {onWindow ? <Tool icon="open-outline" label={windowLabel} onPress={() => onWindow(current)} /> : null}
        <Tool icon="globe-outline" label="Open in the browser" onPress={() => openInAppBrowser(current)} />
        {onClose ? <Tool icon="close" label="Close" onPress={onClose} /> : null}
        {nav.loading ? <View style={[styles.progress, { width: `${Math.max(8, Math.round(progress * 100))}%` }]} /> : null}
      </View>
      <WebView
        ref={web}
        source={{ uri: url }}
        style={styles.web}
        // Every address reaches onShouldStartLoadWithRequest, which decides (the list would hand the rest to Linking).
        originWhitelist={['*']}
        onNavigationStateChange={onNavigationStateChange}
        onLoadProgress={(e) => setProgress(e.nativeEvent.progress)}
        onShouldStartLoadWithRequest={(request) => {
          // Frames inside the page load as they will (iOS asks for them too).
          if (request.isTopFrame === false) return true;
          if (inAppWebUrl(request.url) || /^about:/i.test(request.url)) return true;
          openInAppBrowser(request.url);
          return false;
        }}
        onOpenWindow={(e) => openInAppBrowser(e.nativeEvent.targetUrl)}
        allowsBackForwardNavigationGestures
        pullToRefreshEnabled
        setSupportMultipleWindows
        renderError={(_domain, _code, description) => (
          <View style={styles.error}>
            <Text style={styles.errorText}>{description ? `The page did not open: ${description}.` : 'The page did not open.'}</Text>
            <View style={styles.errorActions}>
              <Pressable onPress={() => web.current?.reload()} style={({ pressed }) => [styles.errorButton, pressed && styles.pressed]} accessibilityRole="button">
                <Text style={styles.errorButtonText}>Try again</Text>
              </Pressable>
              <Pressable onPress={() => openInAppBrowser(current)} style={({ pressed }) => [styles.errorButton, pressed && styles.pressed]} accessibilityRole="button">
                <Text style={styles.errorButtonText}>Open in the browser</Text>
              </Pressable>
            </View>
          </View>
        )}
      />
    </View>
  );
}

function Tool({ icon, label, onPress, disabled = false, tint }: {
  icon: keyof typeof Ionicons.glyphMap; label: string; onPress: () => void; disabled?: boolean; tint?: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      hitSlop={2}
      style={({ pressed }) => [styles.tool, pressed && styles.pressed, disabled && styles.toolOff]}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
    >
      <Ionicons name={icon} size={18} color={tint ?? colors.textDim} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.background },
  bar: {
    flexDirection: 'row', alignItems: 'center', gap: 2, paddingHorizontal: spacing.xs, height: 44,
    backgroundColor: colors.surface, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border,
  },
  address: { flex: 1, minWidth: 40, marginHorizontal: spacing.xs, color: colors.textDim, fontFamily: mono, fontSize: 12 },
  tool: { width: 34, height: 34, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  toolOff: { opacity: 0.35 },
  pressed: { backgroundColor: 'rgba(255,255,255,0.08)' },
  progress: { position: 'absolute', left: 0, bottom: -1, height: 2, backgroundColor: colors.accent },
  web: { flex: 1, backgroundColor: '#ffffff' },
  error: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, alignItems: 'center', justifyContent: 'center', gap: spacing.md, padding: spacing.xl, backgroundColor: colors.background },
  errorText: { color: colors.text, fontSize: 14, textAlign: 'center' },
  errorActions: { flexDirection: 'row', gap: spacing.sm },
  errorButton: { paddingHorizontal: spacing.md, height: 34, borderRadius: 8, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  errorButtonText: { color: colors.text, fontSize: 13, fontWeight: '600' },
});
