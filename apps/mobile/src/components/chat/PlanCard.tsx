import Ionicons from '@expo/vector-icons/Ionicons';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { ToolItem } from '@/sessions/chat-groups';
import { homeShort, type PlanRef } from '@/sessions/file-refs';
import { colors, spacing } from '@/theme';
import { ChatMarkdown, mono } from './ChatMarkdown';
import { useOpenFile } from './OpenFile';

const PADDING = spacing.md;

type Status = { label: string; color: string; background: string };

function statusOf(tool: ToolItem, waiting: boolean): Status | null {
  if (tool.result === undefined) return waiting ? { label: 'Waiting for your approval', color: colors.attention, background: 'rgba(224,160,80,0.14)' } : null;
  if (tool.error) return { label: 'Not approved', color: colors.textDim, background: 'rgba(255,255,255,0.06)' };
  return { label: 'Approved', color: colors.running, background: 'rgba(76,175,143,0.14)' };
}

/**
 * The plan Claude put up for approval at the end of plan mode: its title,
 * where it is saved, and two ways to read it: Open plan (the file, full
 * screen and formatted, from the computer) and Read here (the plan as it
 * was put up, under the title). A long press copies it.
 */
export function PlanCard({ tool, plan, waiting, width, onLongPress }: {
  tool: ToolItem;
  plan: PlanRef;
  /** The session waits for an answer: the plan has none yet. */
  waiting: boolean;
  width: number;
  onLongPress: (text: string) => void;
}) {
  const openFile = useOpenFile();
  const [reading, setReading] = useState(false);
  const status = statusOf(tool, waiting);
  return (
    <Pressable onLongPress={plan.text ? () => onLongPress(plan.text) : undefined} delayLongPress={480} style={styles.card} accessibilityHint={plan.text ? 'Long press to copy the plan' : undefined}>
      <View style={styles.header}>
        <Ionicons name="map-outline" size={15} color={colors.accent} />
        <Text style={styles.label}>Plan</Text>
        {status ? (
          <View style={[styles.status, { backgroundColor: status.background }]}>
            <Text style={[styles.statusText, { color: status.color }]} numberOfLines={1}>{status.label}</Text>
          </View>
        ) : null}
      </View>
      <Text style={styles.title} numberOfLines={3}>{plan.title}</Text>
      {plan.file ? <Text style={styles.file} numberOfLines={1} ellipsizeMode="middle">{homeShort(plan.file)}</Text> : null}
      {reading ? <View style={styles.body}><ChatMarkdown text={plan.text} width={width - PADDING * 2} /></View> : null}
      <View style={styles.actions}>
        {plan.file && openFile ? (
          <Pressable onPress={() => openFile(plan.file!)} style={({ pressed }) => [styles.button, styles.primary, pressed && styles.pressed]} accessibilityRole="button">
            <Ionicons name="document-text-outline" size={15} color="#fff" />
            <Text style={[styles.buttonText, styles.primaryText]}>Open plan</Text>
          </Pressable>
        ) : null}
        {plan.text ? (
          <Pressable onPress={() => setReading(!reading)} style={({ pressed }) => [styles.button, pressed && styles.pressed]} accessibilityRole="button" accessibilityState={{ expanded: reading }}>
            <Ionicons name={reading ? 'chevron-up' : 'chevron-down'} size={15} color={colors.text} />
            <Text style={styles.buttonText}>{reading ? 'Hide' : 'Read here'}</Text>
          </Pressable>
        ) : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 12, borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(128,136,255,0.35)', backgroundColor: 'rgba(128,136,255,0.07)',
    padding: PADDING, gap: spacing.sm,
  },
  header: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  label: { color: colors.accent, fontSize: 12.5, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5 },
  status: { marginStart: 'auto', borderRadius: 8, paddingHorizontal: spacing.sm, paddingVertical: 3, flexShrink: 1 },
  statusText: { fontSize: 12, fontWeight: '600' },
  title: { color: colors.text, fontSize: 16, lineHeight: 22, fontWeight: '700' },
  file: { color: colors.textFaint, fontFamily: mono, fontSize: 11.5 },
  body: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border, paddingTop: spacing.sm },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: 2 },
  button: {
    minHeight: 40, flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: spacing.md, borderRadius: 10,
    backgroundColor: 'rgba(255,255,255,0.06)', borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.14)',
  },
  primary: { backgroundColor: colors.accent, borderColor: colors.accent },
  pressed: { opacity: 0.7 },
  buttonText: { color: colors.text, fontSize: 14, fontWeight: '600' },
  primaryText: { color: '#fff' },
});
