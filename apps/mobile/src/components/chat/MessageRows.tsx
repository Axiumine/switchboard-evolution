import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { ChatItem } from '@/sessions/transcript';
import { colors, spacing } from '@/theme';
import { ChatMarkdown, mono } from './ChatMarkdown';
import { ImageTiles } from './ImageTiles';

// A long press shows the message's menu, after the time the design uses everywhere.
const LONG_PRESS_MS = 480;
const BUBBLE_PADDING = 14;

type Copyable = { onLongPress: (text: string) => void };

/** What the user wrote: a bubble on the right, its images above the text. */
export function UserBubble({ item, maxWidth, onLongPress }: { item: Extract<ChatItem, { kind: 'user' }>; maxWidth: number } & Copyable) {
  const inner = maxWidth - BUBBLE_PADDING * 2;
  return (
    <Pressable
      onLongPress={() => onLongPress(item.text)}
      delayLongPress={LONG_PRESS_MS}
      style={[styles.bubble, { maxWidth }]}
      accessibilityHint="Long press to copy"
    >
      {item.images ? <ImageTiles images={item.images} width={Math.min(inner, 300)} /> : null}
      {item.text ? <Text style={styles.userText}>{item.text}</Text> : null}
    </Pressable>
  );
}

/** What Claude wrote: no bubble, the whole width, as markdown. */
export function AssistantMessage({ item, width, onLongPress }: { item: Extract<ChatItem, { kind: 'assistant' }>; width: number } & Copyable) {
  return (
    <Pressable onLongPress={() => onLongPress(item.text)} delayLongPress={LONG_PRESS_MS} style={styles.assistant} accessibilityHint="Long press to copy">
      {item.images ? <ImageTiles images={item.images} width={Math.min(width, 300)} /> : null}
      {item.text ? <ChatMarkdown text={item.text} width={width} /> : null}
    </Pressable>
  );
}

/** A slash command as a centered chip, its output under it. */
export function CommandChip({ item, onLongPress }: { item: Extract<ChatItem, { kind: 'command' }> } & Copyable) {
  return (
    <Pressable
      onLongPress={() => onLongPress(item.output ? `${item.text}\n${item.output}` : item.text)}
      delayLongPress={LONG_PRESS_MS}
      style={styles.command}
      accessibilityHint="Long press to copy"
    >
      <View style={styles.chip}><Text style={styles.chipText}>{item.text}</Text></View>
      {item.output ? <Text style={styles.output}>{item.output}</Text> : null}
    </Pressable>
  );
}

/** "Today, 09:12" between messages. */
export function TimeSeparator({ label }: { label: string }) {
  return <Text style={styles.time} accessibilityRole="header">{label}</Text>;
}

const styles = StyleSheet.create({
  bubble: {
    alignSelf: 'flex-end',
    backgroundColor: 'rgba(128,136,255,0.20)',
    borderTopLeftRadius: 18, borderTopRightRadius: 18, borderBottomRightRadius: 5, borderBottomLeftRadius: 18,
    paddingHorizontal: BUBBLE_PADDING, paddingVertical: 10, gap: spacing.sm,
  },
  userText: { color: colors.text, fontSize: 15, lineHeight: 21 },
  assistant: { alignSelf: 'stretch', gap: spacing.sm },
  command: { alignItems: 'center', gap: spacing.xs },
  chip: { borderRadius: 9, paddingHorizontal: 10, paddingVertical: 4, backgroundColor: 'rgba(255,255,255,0.06)', borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.14)' },
  chipText: { color: colors.textDim, fontFamily: mono, fontSize: 13 },
  output: { alignSelf: 'stretch', color: colors.textDim, fontFamily: mono, fontSize: 12, lineHeight: 18 },
  time: { color: colors.textFaint, fontSize: 11.5, textAlign: 'center', paddingVertical: spacing.xs },
});
