import Ionicons from '@expo/vector-icons/Ionicons';
import { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { ActionIcon } from '@/components/ActionIcon';
import { toolKind, type ToolItem, type ToolKind } from '@/sessions/chat-groups';
import { isFolderPath, toolFilePath } from '@/sessions/file-refs';
import { commandOf, diffLines } from '@/sessions/tool-details';
import type { ChatItem } from '@/sessions/transcript';
import { colors, spacing } from '@/theme';
import { mono } from './ChatMarkdown';
import { ResultImage } from './ImageTiles';
import { useOpenFile } from './OpenFile';

const BULLETS: Record<ToolKind, string> = {
  read: '#80c0e0', search: '#80c0e0', websearch: '#80c0e0', fetch: '#80c0e0',
  command: '#e0aa63',
  edit: '#c77dd1', write: '#c77dd1',
  agent: colors.textDim, other: colors.textDim,
};

/** A shorter name for an MCP tool: "mcp__browser__screenshot" reads "screenshot". */
const toolName = (name: string) => (name.startsWith('mcp__') ? name.split('__').slice(2).join('__') || name : name);

function Output({ text, error }: { text: string; error?: boolean }) {
  return (
    <ScrollView style={styles.output} nestedScrollEnabled>
      <Text style={[styles.mono, error && styles.error]} selectable>{text}</Text>
    </ScrollView>
  );
}

/** What a tool did, under its row: the command and its output, the lines an edit changed, the lines read, screenshots. */
function Details({ tool, width }: { tool: ToolItem; width: number }) {
  const openFile = useOpenFile();
  const file = toolFilePath(tool.name, tool.input);
  const kind = toolKind(tool.name);
  const diff = kind === 'edit' || kind === 'write' ? diffLines(tool.name, tool.input) : null;
  const command = kind === 'command' ? commandOf(tool.input) : '';
  return (
    <View style={styles.details}>
      {command ? <Text style={[styles.mono, styles.command]} selectable>$ {command}</Text> : null}
      {diff && diff.lines.length ? (
        <View>
          {diff.lines.map((line, i) => (
            <Text key={i} style={[styles.mono, line.sign === '+' ? styles.added : styles.removed]}>{line.sign}  {line.text}</Text>
          ))}
          {diff.more ? <Text style={[styles.mono, styles.faint]}>{diff.more} more lines</Text> : null}
        </View>
      ) : null}
      {kind === 'read' && !tool.error && tool.lines ? (
        <Text style={styles.faint}>Read {tool.lines} {tool.lines === 1 ? 'line' : 'lines'}</Text>
      ) : tool.result && (!diff || tool.error) ? (
        <Output text={tool.result} error={tool.error} />
      ) : null}
      {tool.images?.map((_, index) => (
        <View key={index} style={styles.shot}><ResultImage images={tool.images!} index={index} width={Math.min(width, 320)} /></View>
      ))}
      {!tool.result && !command && !diff?.lines.length && !tool.images ? <Text style={styles.faint}>{tool.summary || 'No details'}</Text> : null}
      {file && openFile ? (
        <Pressable onPress={() => openFile(file)} hitSlop={{ top: 6, bottom: 6 }} style={({ pressed }) => [styles.open, pressed && styles.pressed]} accessibilityRole="button" accessibilityLabel={`Open ${file}`}>
          {isFolderPath(file)
            ? <ActionIcon name="folderSearch" size={14} color={colors.accent} />
            : <Ionicons name="document-text-outline" size={14} color={colors.accent} />}
          <Text style={styles.openText} numberOfLines={1}>Open {file.split('/').pop()}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

/**
 * One tool call: a coloured bullet, the tool's name and what it worked on,
 * and a chevron (a spinner while it runs). A tap shows what it did.
 */
export function ToolRow({ tool, running, width, inset }: { tool: ToolItem; running?: boolean; width: number; inset?: boolean }) {
  const [open, setOpen] = useState(false);
  const kind = toolKind(tool.name);
  return (
    <View>
      <Pressable
        onPress={() => setOpen(!open)}
        style={({ pressed }) => [styles.row, inset && styles.inset, pressed && styles.pressed]}
        accessibilityRole="button"
        accessibilityState={{ expanded: open, busy: !!running }}
        accessibilityLabel={`${toolName(tool.name)} ${tool.summary}${running ? ', running' : ''}${tool.error ? ', failed' : ''}`}
      >
        <View style={[styles.bullet, { backgroundColor: tool.error ? colors.danger : BULLETS[kind] }]} />
        <Text style={[styles.name, { color: tool.error ? colors.danger : BULLETS[kind] }]} numberOfLines={1}>{toolName(tool.name)}</Text>
        <Text style={styles.summary} numberOfLines={1}>{tool.summary}</Text>
        {running ? <ActivityIndicator size="small" color={colors.textDim} /> : (
          <Ionicons name={open ? 'chevron-down' : 'chevron-forward'} size={14} color={colors.textFaint} />
        )}
      </Pressable>
      {open ? <View style={inset && styles.insetDetails}><Details tool={tool} width={width - (inset ? spacing.md * 2 : 0)} /></View> : null}
    </View>
  );
}

/** Claude's thinking: one faint line, the text under it when opened. */
export function ThinkingRow({ text, inset }: { text: string; inset?: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <View style={inset && styles.inset}>
      <Pressable onPress={() => setOpen(!open)} hitSlop={{ top: 4, bottom: 4 }} style={styles.thinking} accessibilityRole="button" accessibilityState={{ expanded: open }} accessibilityLabel="Thinking">
        <Ionicons name={open ? 'chevron-down' : 'chevron-forward'} size={13} color={colors.textFaint} />
        <Text style={styles.thinkingLabel}>Thinking</Text>
      </Pressable>
      {open ? <Text style={styles.thinkingText} selectable>{text}</Text> : null}
    </View>
  );
}

/**
 * Tool calls in a row as one card: "Read 2 files, ran 1 command, edited 1 file".
 * Folded, except while it is the group that is running now.
 */
export function ToolGroup({ items, summary, running, active, busy, width }: {
  items: ChatItem[];
  summary: string;
  /** Its last tool has no result yet. */
  running: boolean;
  /** The session is working or waiting: a running group opens by itself. */
  active: boolean;
  /** The session is working: the running tool spins. */
  busy: boolean;
  width: number;
}) {
  const [choice, setChoice] = useState<boolean | null>(null);
  const open = choice ?? (running && active);
  const last = items.length - 1;
  return (
    <View style={styles.group}>
      <Pressable onPress={() => setChoice(!open)} style={({ pressed }) => [styles.groupHeader, pressed && styles.pressed]} accessibilityRole="button" accessibilityState={{ expanded: open }}>
        <Ionicons name={open ? 'chevron-down' : 'chevron-forward'} size={14} color={colors.textDim} />
        <Text style={styles.groupSummary} numberOfLines={2}>{summary}</Text>
        {running && busy && !open ? <ActivityIndicator size="small" color={colors.textDim} /> : null}
      </Pressable>
      {open ? items.map((item, index) => (
        <View key={item.id} style={styles.groupItem}>
          {item.kind === 'tool' ? <ToolRow tool={item} running={running && busy && index === last} width={width} inset /> : null}
          {item.kind === 'thinking' ? <ThinkingRow text={item.text} inset /> : null}
        </View>
      )) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  inset: { paddingHorizontal: spacing.md },
  insetDetails: { paddingHorizontal: spacing.md },
  pressed: { opacity: 0.7 },
  bullet: { width: 8, height: 8, borderRadius: 4 },
  name: { fontSize: 12.5, fontWeight: '700' },
  summary: { flex: 1, color: colors.textDim, fontFamily: mono, fontSize: 12 },
  details: { marginStart: 3, marginBottom: spacing.sm, paddingStart: spacing.md, borderLeftWidth: 1.5, borderLeftColor: 'rgba(255,255,255,0.14)', gap: spacing.xs },
  mono: { color: colors.textDim, fontFamily: mono, fontSize: 12, lineHeight: 18 },
  command: { color: colors.text },
  output: { maxHeight: 200 },
  error: { color: colors.danger },
  added: { color: '#5ec46a', backgroundColor: 'rgba(62,207,90,0.10)' },
  removed: { color: '#e06c75', backgroundColor: 'rgba(224,80,112,0.10)' },
  faint: { color: colors.textFaint, fontSize: 12 },
  shot: { marginTop: spacing.xs },
  open: { minHeight: 36, flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start' },
  openText: { color: colors.accent, fontSize: 13, fontWeight: '600', flexShrink: 1 },
  thinking: { minHeight: 36, flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start' },
  thinkingLabel: { color: colors.textFaint, fontSize: 13 },
  thinkingText: { color: colors.textFaint, fontSize: 13.5, lineHeight: 20, fontStyle: 'italic', marginStart: 3, paddingStart: spacing.md, borderLeftWidth: 1.5, borderLeftColor: 'rgba(255,255,255,0.14)', marginBottom: spacing.sm },
  group: { borderRadius: 12, borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.14)', backgroundColor: colors.surface, overflow: 'hidden' },
  groupHeader: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.md },
  groupSummary: { flex: 1, color: colors.textDim, fontSize: 13 },
  groupItem: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
});
