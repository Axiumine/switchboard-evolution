import Ionicons from '@expo/vector-icons/Ionicons';
import * as Clipboard from 'expo-clipboard';
import { memo, useCallback, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Platform, Pressable, ScrollView, StyleSheet, Text, View, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native';

import { mono } from '@/components/chat/ChatMarkdown';
import { ImageViewer } from '@/components/chat/ImageViewer';
import { AssistantMessage, CommandChip, TimeSeparator, UserBubble } from '@/components/chat/MessageRows';
import { OpenFileProvider } from '@/components/chat/OpenFile';
import { PlanCard } from '@/components/chat/PlanCard';
import { ThinkingRow, ToolGroup, ToolRow } from '@/components/chat/ToolRows';
import { Sheet } from '@/components/Sheet';
import { useAreaWidth } from '@/layout/size';
import { useMinute } from '@/projects/queries';
import { groupTools, withSeparators, type ChatRow } from '@/sessions/chat-groups';
import { planOf } from '@/sessions/file-refs';
import type { SessionState } from '@/sessions/model';
import type { ChatItem } from '@/sessions/transcript';
import { colors, spacing } from '@/theme';

/** On a wide window the conversation is a centered column this wide. */
export const CHAT_COLUMN = 760;
const PADDING = spacing.lg;
// Scrolled up further than this (from the newest message): offer the way back.
const AWAY = 400;
// iOS cannot show a sheet while the previous one is still sliding away.
const AFTER_SHEET_MS = Platform.OS === 'ios' ? 450 : 0;

type RowProps = {
  row: ChatRow;
  width: number;
  bubble: number;
  /** The session works / works or waits (only passed to the running row, so the others stay put). */
  busy: boolean;
  active: boolean;
  onLongPress: (text: string) => void;
};

function sameRow(a: RowProps, b: RowProps) {
  if (a.width !== b.width || a.bubble !== b.bubble || a.busy !== b.busy || a.active !== b.active || a.onLongPress !== b.onLongPress) return false;
  const x = a.row;
  const y = b.row;
  if (x.kind === 'time') return y.kind === 'time' && x.label === y.label;
  if (x.kind === 'item') return y.kind === 'item' && x.item === y.item && x.running === y.running;
  return y.kind === 'tools' && x.running === y.running && x.summary === y.summary
    && x.items.length === y.items.length && x.items.every((item, i) => item === y.items[i]);
}

const Row = memo(function Row({ row, width, bubble, busy, active, onLongPress }: RowProps) {
  if (row.kind === 'time') return <View style={styles.timeRow}><TimeSeparator label={row.label} /></View>;
  if (row.kind === 'tools') {
    return <View style={styles.groupRow}><ToolGroup items={row.items} summary={row.summary} running={row.running} active={active} busy={busy} width={width} /></View>;
  }
  const item = row.item;
  switch (item.kind) {
    case 'user': return <View style={styles.messageRow}><UserBubble item={item} maxWidth={bubble} onLongPress={onLongPress} /></View>;
    case 'assistant': return <View style={styles.messageRow}><AssistantMessage item={item} width={width} onLongPress={onLongPress} /></View>;
    case 'command': return <View style={styles.messageRow}><CommandChip item={item} onLongPress={onLongPress} /></View>;
    case 'thinking': return <ThinkingRow text={item.text} />;
    case 'tool': {
      const plan = planOf(item);
      if (plan) return <View style={styles.messageRow}><PlanCard tool={item} plan={plan} waiting={!!row.running && active} width={width} onLongPress={onLongPress} /></View>;
      return <ToolRow tool={item} running={row.running && busy} width={width} />;
    }
  }
}, sameRow);

/**
 * The conversation, newest at the bottom: messages, tool calls folded into
 * groups, the time after a pause. It stays on the newest message while it
 * is in view; scrolled up, a chip leads back. A long press copies a message.
 * `loading` while the transcript is on its way: a spinner, not "No messages".
 * Files it mentions open, relative paths from the session's folder `cwd`.
 */
export function ChatView({ items, error, state, loading = false, cwd, earlier = 0 }: { items: ChatItem[]; error: string; state: SessionState; loading?: boolean; cwd?: string; earlier?: number }) {
  const areaWidth = useAreaWidth();
  const width = Math.min(areaWidth, CHAT_COLUMN) - PADDING * 2;
  const bubble = Math.min(Math.round(width * 0.88), 560);
  const now = useMinute();
  // Inverted: the newest row first.
  const rows = useMemo(() => withSeparators(groupTools(items), now).reverse(), [items, now]);
  const busy = state === 'busy';
  const active = busy || state === 'attention';

  const list = useRef<FlatList<ChatRow>>(null);
  const awayRef = useRef(false);
  const [away, setAway] = useState(false);
  const onScroll = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const next = event.nativeEvent.contentOffset.y > AWAY;
    if (next !== awayRef.current) { awayRef.current = next; setAway(next); }
  }, []);

  const [menu, setMenu] = useState<string | null>(null);
  const [selecting, setSelecting] = useState<string | null>(null);
  const onLongPress = useCallback((text: string) => setMenu(text), []);

  return (
    <OpenFileProvider cwd={cwd}>
      <View style={styles.container}>
        {error ? <Text style={styles.error}>{error}</Text> : null}
        {loading && !rows.length ? (
          <View style={styles.loading} accessibilityLiveRegion="polite">
            <ActivityIndicator size="large" color={colors.accent} />
            <Text style={styles.loadingText}>Loading the conversation…</Text>
          </View>
        ) : <FlatList
          ref={list}
          data={rows}
          inverted
          keyExtractor={(row) => row.id}
          renderItem={({ item: row }) => (
            <View style={[styles.column, { width }]}>
              <Row row={row} width={width} bubble={bubble} busy={row.kind !== 'time' && row.running ? busy : false} active={row.kind !== 'time' && row.running ? active : false} onLongPress={onLongPress} />
            </View>
          )}
          contentContainerStyle={styles.list}
          ListEmptyComponent={<Text style={styles.empty}>No messages yet.</Text>}
          // The list is upside down: its footer is the top, above the oldest message shown.
          ListFooterComponent={earlier ? <Text style={styles.earlier}>{earlier} earlier {earlier === 1 ? 'message is' : 'messages are'} not shown here.</Text> : undefined}
          onScroll={onScroll}
          scrollEventThrottle={100}
          // Stay on the newest message when one arrives, unless scrolled up to read.
          maintainVisibleContentPosition={{ minIndexForVisible: 0, autoscrollToTopThreshold: 80 }}
          keyboardShouldPersistTaps="handled"
          initialNumToRender={20}
          windowSize={11}
        />}
        {away ? (
          <Pressable onPress={() => list.current?.scrollToOffset({ offset: 0, animated: true })} style={styles.jump} accessibilityRole="button">
            <Ionicons name="arrow-down" size={16} color={colors.text} />
            <Text style={styles.jumpText}>Jump to latest</Text>
          </Pressable>
        ) : null}
        <ImageViewer />
        <Sheet
          visible={menu !== null}
          onClose={() => setMenu(null)}
          options={[
            { label: 'Copy text', onPress: () => { if (menu) Clipboard.setStringAsync(menu).catch(() => {}); } },
            { label: 'Select text', onPress: () => { const text = menu; setTimeout(() => setSelecting(text), AFTER_SHEET_MS); } },
          ]}
        />
        <Sheet visible={selecting !== null} title="Select text" onClose={() => setSelecting(null)}>
          <ScrollView style={styles.selectBox}>
            <Text style={styles.selectText} selectable>{selecting}</Text>
          </ScrollView>
        </Sheet>
      </View>
    </OpenFileProvider>
  );
}

const styles = StyleSheet.create({
  earlier: { color: colors.textFaint, fontSize: 12, textAlign: 'center', paddingVertical: spacing.md },
  container: { flex: 1, backgroundColor: colors.background },
  list: { paddingVertical: spacing.md },
  column: { alignSelf: 'center' },
  messageRow: { paddingVertical: 6 },
  groupRow: { paddingVertical: spacing.xs },
  timeRow: { paddingTop: spacing.md, paddingBottom: spacing.xs },
  error: { color: colors.attention, fontSize: 13, padding: spacing.md },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.md, padding: spacing.xl },
  loadingText: { color: colors.textDim, fontSize: 14 },
  // No transform: an inverted list already turns its empty component back the right
  // way (scaleY on iOS, both axes on Android). One of our own replaced it, and on
  // Android the text came out mirrored.
  empty: { color: colors.textFaint, textAlign: 'center', padding: spacing.xl },
  jump: {
    position: 'absolute', right: PADDING, bottom: spacing.md, height: 44, borderRadius: 22, paddingHorizontal: spacing.lg,
    flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: colors.raised, borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.14)',
  },
  jumpText: { color: colors.text, fontSize: 14, fontWeight: '600' },
  selectBox: { maxHeight: 420, paddingHorizontal: spacing.xl, paddingBottom: spacing.md },
  selectText: { color: colors.text, fontSize: 15, lineHeight: 22 },
});

/** Markdown at reading sizes, for the file viewer. */
export const markdownStyles = StyleSheet.create({
  body: { color: colors.text, fontSize: 15, lineHeight: 22 },
  // The body's line height would clip larger headings.
  heading1: { fontSize: 24, lineHeight: 30, fontWeight: '700', marginTop: 8, marginBottom: 4 },
  heading2: { fontSize: 20, lineHeight: 26, fontWeight: '700', marginTop: 8, marginBottom: 4 },
  heading3: { fontSize: 17, lineHeight: 24, fontWeight: '600', marginTop: 6, marginBottom: 2 },
  code_inline: { fontFamily: mono, backgroundColor: colors.surface, color: colors.text, borderRadius: 4 },
  fence: { fontFamily: mono, fontSize: 12, backgroundColor: colors.surface, color: colors.text, borderColor: colors.border, borderRadius: 6 },
  code_block: { fontFamily: mono, fontSize: 12, backgroundColor: colors.surface, color: colors.text, borderColor: colors.border, borderRadius: 6 },
  link: { color: colors.accent },
  blockquote: { backgroundColor: colors.surface, borderLeftColor: colors.border },
  hr: { backgroundColor: colors.border },
  table: { borderColor: colors.border },
  tr: { borderColor: colors.border },
});
