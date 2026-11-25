import Ionicons from '@expo/vector-icons/Ionicons';
import * as Clipboard from 'expo-clipboard';
import { useMemo, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, KeyboardAvoidingView, Linking, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { runCommand, useCommandCatalog } from '@/catalog/queries';
import { useWindowInsets } from '@/layout/bottomInset';
import type { SessionState } from '@/sessions/model';
import {
  badgesOf, canRun, cliLabel, insertionFor, needsConfirm, searchCommands, stateNotice, tabsFor,
  type CatalogTab, type CommandBadge, type CommandDoc,
} from '@/shared/vendor/command-catalog-model';
import { colors, spacing } from '@/theme';

/**
 * The command catalog of a session: what its CLI understands (slash commands,
 * skills, MCP servers, its own commands and flags, its keys), searchable, by
 * tab. A tap on a row shows what the command takes and does. Insert hands the
 * text to the composer (`onInsert`), without Enter; Run, for a command that
 * needs no argument while the session is idle, writes it and Enter (`write`),
 * asking first for one that ends the session, replaces the conversation,
 * signs in or out or writes files. The CLI's own commands and flags are
 * copied in its session.
 *
 * Shown three ways, as the desktop's palette: full height (`sheet`, closed by
 * a pick), pinned in the session's page above the composer (`docked`, it
 * stays for the next pick), or in a window of its own (`window`, on DeX or a
 * tablet; a pick types into the session). At the top right: the pin, the
 * window (where windows can open) and close.
 */
export function CommandsPanel({ mode, onClose, onPin, onWindow, sessionId, runtime, state, isTerminal, clis, write, onInsert, onRan, height }: {
  mode: 'sheet' | 'docked' | 'window';
  onClose?: () => void;
  /** The pin: from a sheet it pins the panel in the page, docked it lets it go back to a sheet. */
  onPin?: () => void;
  /** Open it in a window of its own (only where windows can open). */
  onWindow?: () => void;
  sessionId: string;
  /** The session's CLI as the phone knows it. */
  runtime?: string | null;
  state: SessionState;
  /** A plain terminal: the catalog of a CLI to run in it. */
  isTerminal: boolean;
  /** The CLIs with a catalog, for a plain terminal's choice. */
  clis: readonly string[];
  write: (data: string) => unknown;
  onInsert: (text: string) => void;
  onRan?: (entry: CommandDoc) => void;
  /** Docked: how tall it is. */
  height?: number;
}) {
  const [query, setQuery] = useState('');
  const [chosenTab, setChosenTab] = useState<CatalogTab['id'] | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [cli, setCli] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const shellCli = isTerminal ? cli || clis[0] || null : null;
  const { data: catalog, isLoading, error } = useCommandCatalog(sessionId, { enabled: true, cli: shellCli, runtime: isTerminal ? 'terminal' : runtime || 'claude' });
  // Docked or in its own window, a pick leaves it open for the next one.
  const stays = mode !== 'sheet';

  const tabs = useMemo(() => tabsFor(catalog), [catalog]);
  const tab = chosenTab && tabs.some((t) => t.id === chosenTab) ? chosenTab : tabs[0]?.id ?? null;
  const entries = useMemo(() => (catalog
    ? searchCommands(catalog.entries, query, { tab: query.trim() ? null : tab, tabs: tabs.map((t) => t.id) })
    : []), [catalog, query, tab, tabs]);
  const version = catalog?.version?.session || catalog?.version?.installed || null;
  const target = catalog?.target ?? (isTerminal ? 'terminal' : 'agent');

  const insert = (entry: CommandDoc, text: string) => {
    const go = () => { if (!stays) onClose?.(); onInsert(text); };
    if (state === 'attention') {
      Alert.alert('Insert anyway?', stateNotice(entry, state) ?? undefined, [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Insert', onPress: go },
      ]);
    } else {
      go();
    }
  };

  const run = (entry: CommandDoc, text: string) => {
    const go = () => {
      if (!stays) onClose?.();
      runCommand(write, text)
        .then(() => onRan?.(entry))
        .catch((err: any) => Alert.alert('Could not run it', err?.message || String(err)));
    };
    const question = needsConfirm(entry);
    if (question) {
      Alert.alert(question, undefined, [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Run', style: 'destructive', onPress: go },
      ]);
    } else {
      go();
    }
  };

  const copy = (entry: CommandDoc, text: string) => {
    Clipboard.setStringAsync(text.trimEnd()).then(() => setCopied(entry.id)).catch(() => {});
  };

  const renderRow = ({ item }: { item: CommandDoc }) => {
    const open = item.id === openId;
    const badges = badgesOf(item, version);
    const rowBadges = badges.filter((b) => b.id === 'danger' || b.id === 'newer' || b.id === 'source' || b.id === 'bundled');
    return (
      <View style={[styles.row, open && styles.rowOpen]}>
        <Pressable
          onPress={() => { setOpenId(open ? null : item.id); setCopied(null); }}
          style={({ pressed }) => [styles.rowHead, pressed && styles.pressed]}
          accessibilityRole="button"
          accessibilityState={{ expanded: open }}
          accessibilityLabel={`${item.command}${item.inputArgs ? ` ${item.inputArgs}` : ''}. ${item.description}`}
        >
          <View style={styles.rowTop}>
            <Text style={styles.command} numberOfLines={1}>{item.command}</Text>
            {item.inputArgs ? <Text style={styles.args} numberOfLines={1}>{item.inputArgs}</Text> : null}
          </View>
          {rowBadges.length ? <Badges badges={rowBadges} /> : null}
          <Text style={styles.desc} numberOfLines={open ? undefined : 2}>{item.description}</Text>
        </Pressable>
        {open ? (
          <Details
            entry={item}
            badges={badges.filter((b) => !rowBadges.includes(b))}
            target={target}
            state={state}
            copied={copied === item.id}
            onInsert={insert}
            onRun={run}
            onCopy={copy}
          />
        ) : null}
      </View>
    );
  };

  const empty = isLoading
    ? <ActivityIndicator color={colors.textDim} style={styles.empty} />
    : <Text style={[styles.empty, styles.emptyText]}>{error ? `Could not load the commands: ${(error as Error).message}` : catalog ? 'Nothing matches.' : 'No commands for this session.'}</Text>;
  const docked = mode === 'docked';
  const pinned = mode === 'docked';

  return (
    <View style={docked ? [styles.dock, { height }] : styles.fill}>
      <View style={[styles.header, docked && styles.headerDocked]}>
        <Text style={[styles.title, docked && styles.titleDocked]} accessibilityRole="header" numberOfLines={1}>{catalog ? `${cliLabel(catalog.cli)} commands` : 'Commands'}</Text>
        {onPin ? (
          <Pressable
            onPress={onPin}
            hitSlop={6}
            style={[styles.tool, pinned && styles.toolOn]}
            accessibilityRole="button"
            accessibilityLabel={pinned ? 'Unpin: open it full height' : 'Pin: keep it open in the page'}
            accessibilityState={{ selected: pinned }}
          >
            <Ionicons name={pinned ? 'pin' : 'pin-outline'} size={19} color={pinned ? colors.accent : colors.textDim} />
          </Pressable>
        ) : null}
        {onWindow ? (
          <Pressable onPress={onWindow} hitSlop={6} style={styles.tool} accessibilityRole="button" accessibilityLabel="Open in a window of its own">
            <Ionicons name="open-outline" size={19} color={colors.textDim} />
          </Pressable>
        ) : null}
        {onClose ? (
          <Pressable onPress={onClose} hitSlop={8} style={styles.tool} accessibilityRole="button" accessibilityLabel="Close">
            <Ionicons name="close" size={docked ? 21 : 24} color={colors.text} />
          </Pressable>
        ) : null}
      </View>
      {isTerminal && clis.length > 1 ? (
        <Chips items={clis.map((c) => ({ id: c, label: cliLabel(c) }))} value={shellCli} onChange={(id) => { setCli(id); setChosenTab(null); setOpenId(null); }} label="CLI" />
      ) : null}
      <View style={styles.searchRow}>
        <Ionicons name="search" size={16} color={colors.textFaint} />
        <TextInput
          value={query}
          onChangeText={(text) => { setQuery(text); setOpenId(null); }}
          placeholder="Search commands"
          placeholderTextColor={colors.textFaint}
          autoCapitalize="none"
          autoCorrect={false}
          clearButtonMode="while-editing"
          style={styles.search}
          accessibilityLabel="Search commands"
        />
      </View>
      {!query.trim() && tabs.length > 1 ? (
        <Chips items={tabs} value={tab} onChange={(id) => { setChosenTab(id as CatalogTab['id']); setOpenId(null); }} label="Kind" />
      ) : null}
      <FlatList
        data={entries}
        keyExtractor={(item) => item.id}
        renderItem={renderRow}
        ListEmptyComponent={empty}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        initialNumToRender={20}
        contentContainerStyle={styles.list}
      />
      {catalog && !docked ? (
        <Text style={styles.foot} numberOfLines={1}>
          {[`${cliLabel(catalog.cli)}${version ? ` ${version}` : ''}`, catalog.docs?.generatedAt ? `docs of ${formatDay(catalog.docs.refreshedAt || catalog.docs.generatedAt)}` : null].filter(Boolean).join(' · ')}
        </Text>
      ) : null}
    </View>
  );
}

/** The panel full height, over the session; a pick closes it. */
export function CommandsSheet({ visible, ...props }: Omit<Parameters<typeof CommandsPanel>[0], 'mode' | 'height'> & { visible: boolean }) {
  const insets = useWindowInsets();
  return (
    <Modal visible={visible} animationType="slide" onRequestClose={props.onClose}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={[styles.screen, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
        {/* Made afresh at each opening: no search or open row left from the last time. */}
        {visible ? <CommandsPanel mode="sheet" {...props} /> : null}
      </KeyboardAvoidingView>
    </Modal>
  );
}

function Details({ entry, badges, target, state, copied, onInsert, onRun, onCopy }: {
  entry: CommandDoc;
  badges: CommandBadge[];
  target: 'agent' | 'terminal';
  state: SessionState;
  copied: boolean;
  onInsert: (entry: CommandDoc, text: string) => void;
  onRun: (entry: CommandDoc, text: string) => void;
  onCopy: (entry: CommandDoc, text: string) => void;
}) {
  const insertion = insertionFor(entry, { target });
  const runnable = canRun(entry, { target, state });
  const notice = stateNotice(entry, state);
  const prefix = entry.kind === 'slash' ? '/' : '';
  return (
    <View style={styles.details}>
      {badges.length ? <Badges badges={badges} /> : null}
      {entry.outputBehavior ? <Text style={styles.detailText}>{entry.outputBehavior}</Text> : null}
      {entry.aliases?.length ? <Field label="Also" values={entry.aliases.map((a) => prefix + a)} /> : null}
      {entry.acceptedValues?.length ? <Field label="Values" values={entry.acceptedValues} /> : null}
      {entry.example ? <Field label="Example" values={[entry.example]} /> : null}
      {entry.group ? <Text style={styles.detailDim}>{entry.group}</Text> : null}
      {notice ? <Text style={styles.notice}>{notice}</Text> : null}
      {insertion && target === 'agent' && insertion.mode === 'insert' && !runnable.ok && runnable.reason ? (
        <Text style={styles.detailDim}>{runnable.reason}</Text>
      ) : null}
      <View style={styles.actions}>
        {insertion ? (
          <ActionButton
            primary
            label={insertion.mode === 'insert' ? 'Insert' : copied ? 'Copied' : 'Copy'}
            onPress={() => (insertion.mode === 'insert' ? onInsert(entry, insertion.text) : onCopy(entry, insertion.text))}
          />
        ) : <Text style={styles.detailDim}>A key to press in the terminal.</Text>}
        {insertion && target === 'agent' && insertion.mode === 'insert' ? (
          <ActionButton label="Run" disabled={!runnable.ok} onPress={() => onRun(entry, insertion.text)} />
        ) : null}
        {entry.docUrl ? (
          <ActionButton label="Docs" link onPress={() => { Linking.openURL(entry.docUrl as string).catch(() => {}); }} />
        ) : null}
      </View>
    </View>
  );
}

function Field({ label, values }: { label: string; values: string[] }) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <View style={styles.fieldValues}>
        {values.map((v) => <Text key={v} style={styles.code} selectable>{v}</Text>)}
      </View>
    </View>
  );
}

function Badges({ badges }: { badges: CommandBadge[] }) {
  return (
    <View style={styles.badges}>
      {badges.map((b, i) => (
        <Text key={`${b.id}:${i}`} style={[styles.badge, b.id === 'danger' && styles.badgeDanger, b.id === 'newer' && styles.badgeNewer]}>{b.label}</Text>
      ))}
    </View>
  );
}

function Chips({ items, value, onChange, label }: { items: { id: string; label: string }[]; value: string | null; onChange: (id: string) => void; label: string }) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips} accessibilityRole="tablist" accessibilityLabel={label} style={styles.chipsBar}>
      {items.map((item) => {
        const on = item.id === value;
        return (
          <Pressable
            key={item.id}
            onPress={() => onChange(item.id)}
            style={[styles.chip, on && styles.chipOn]}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
          >
            <Text style={[styles.chipText, on && styles.chipTextOn]}>{item.label}</Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

function ActionButton({ label, onPress, primary, disabled, link }: { label: string; onPress: () => void; primary?: boolean; disabled?: boolean; link?: boolean }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [styles.button, primary && styles.buttonPrimary, link && styles.buttonLink, disabled && styles.buttonOff, pressed && styles.pressed]}
      accessibilityRole="button"
      accessibilityState={{ disabled: !!disabled }}
    >
      <Text style={[styles.buttonText, link && { color: colors.accent }]}>{label}</Text>
    </Pressable>
  );
}

function formatDay(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

const mono = Platform.select({ ios: 'Menlo', default: 'monospace' });

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  fill: { flex: 1, backgroundColor: colors.background },
  // Pinned above the composer: a part of the page, its own top line.
  dock: { backgroundColor: colors.background, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  header: { height: 52, flexDirection: 'row', alignItems: 'center', gap: 2, paddingLeft: spacing.lg, paddingRight: spacing.sm },
  headerDocked: { height: 42 },
  title: { flex: 1, color: colors.text, fontSize: 17, fontWeight: '700' },
  titleDocked: { fontSize: 15 },
  tool: { width: 40, height: 40, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  toolOn: { backgroundColor: 'rgba(128,136,255,0.16)' },
  searchRow: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginHorizontal: spacing.lg, marginBottom: spacing.sm,
    paddingHorizontal: spacing.md, borderRadius: 10, backgroundColor: colors.surface, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border,
  },
  search: { flex: 1, color: colors.text, fontSize: 15, paddingVertical: 10 },
  chipsBar: { flexGrow: 0, flexShrink: 0 },
  chips: { gap: spacing.sm, paddingHorizontal: spacing.lg, paddingBottom: spacing.sm },
  chip: { paddingHorizontal: 14, height: 34, borderRadius: 17, justifyContent: 'center', backgroundColor: colors.surface, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
  chipOn: { backgroundColor: 'rgba(128,136,255,0.18)', borderColor: 'rgba(128,136,255,0.5)' },
  chipText: { color: colors.textDim, fontSize: 14, fontWeight: '600' },
  chipTextOn: { color: colors.text },
  list: { paddingHorizontal: spacing.sm, paddingBottom: spacing.lg },
  row: { borderRadius: 10, marginBottom: 2 },
  rowOpen: { backgroundColor: colors.surface },
  rowHead: { paddingHorizontal: spacing.md, paddingVertical: 10, gap: 4, borderRadius: 10 },
  pressed: { opacity: 0.7 },
  rowTop: { flexDirection: 'row', alignItems: 'baseline', gap: 6 },
  command: { color: colors.text, fontFamily: mono, fontSize: 14, flexShrink: 0, maxWidth: '70%' },
  args: { color: colors.textFaint, fontFamily: mono, fontSize: 13, flexShrink: 1 },
  desc: { color: colors.textDim, fontSize: 13, lineHeight: 18 },
  details: { paddingHorizontal: spacing.md, paddingBottom: spacing.md, gap: spacing.sm },
  detailText: { color: colors.textDim, fontSize: 13, lineHeight: 18 },
  detailDim: { color: colors.textFaint, fontSize: 12, lineHeight: 17 },
  notice: { color: colors.attention, fontSize: 13, lineHeight: 18, backgroundColor: 'rgba(224,160,80,0.1)', borderRadius: 8, padding: spacing.sm },
  field: { flexDirection: 'row', gap: spacing.sm, alignItems: 'flex-start' },
  fieldLabel: { width: 60, color: colors.textFaint, fontSize: 12, paddingTop: 3 },
  fieldValues: { flex: 1, flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  code: { color: colors.text, fontFamily: mono, fontSize: 12, backgroundColor: 'rgba(255,255,255,0.06)', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 5, overflow: 'hidden' },
  badges: { flexDirection: 'row', flexWrap: 'wrap', gap: 4 },
  badge: { fontSize: 11, fontWeight: '600', color: '#b8bcff', backgroundColor: 'rgba(128,136,255,0.14)', paddingHorizontal: 6, paddingVertical: 1, borderRadius: 4, overflow: 'hidden' },
  badgeDanger: { color: '#f08098', backgroundColor: 'rgba(224,80,112,0.14)' },
  badgeNewer: { color: colors.attention, backgroundColor: 'rgba(224,160,80,0.14)' },
  actions: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: 2 },
  button: { height: 40, minWidth: 72, paddingHorizontal: spacing.lg, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.raised, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
  buttonPrimary: { backgroundColor: 'rgba(128,136,255,0.24)', borderColor: 'rgba(128,136,255,0.55)' },
  buttonLink: { marginLeft: 'auto', backgroundColor: 'transparent', borderColor: 'transparent' },
  buttonOff: { opacity: 0.4 },
  buttonText: { color: colors.text, fontSize: 15, fontWeight: '600' },
  empty: { marginTop: spacing.xl },
  emptyText: { color: colors.textDim, fontSize: 14, textAlign: 'center', paddingHorizontal: spacing.xl },
  foot: { color: colors.textFaint, fontSize: 12, paddingHorizontal: spacing.lg, paddingTop: spacing.sm, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
});
