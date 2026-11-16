import Ionicons from '@expo/vector-icons/Ionicons';
import { useQuery } from '@tanstack/react-query';
import { router, Stack, useNavigation } from 'expo-router';
import { useMemo, useState, type Dispatch, type SetStateAction } from 'react';
import { ActivityIndicator, Alert, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';

import {
  barShare,
  diskFill,
  formatBytes,
  formatCpu,
  formatDisk,
  formatPercent,
  formatShare,
  formatUptime,
  measureNote,
  memoryLevel,
  memorySummary,
  ownerKey,
  ownerRef,
  ownerSubtitle,
  ownerTitle,
  refreshInterval,
  sessionsById,
  type Disk,
  type Owner,
  type OwnedProcess,
  type ProcessUsage,
} from '@/processes/model';
import { useShown } from '@/layout/shown';
import { openSessionFromTabs } from '@/projects/open-session';
import { queryClient } from '@/remote/query';
import type { Folder } from '@/sessions/model';
import { request, useCapability, useConnection } from '@/store/connection';
import { colors, spacing } from '@/theme';

// A shell busy starting up can briefly hold hundreds of processes; keep the list readable.
const MAX_PROCESS_ROWS = 40;
const LEVEL_COLORS = { low: colors.accent, mid: colors.attention, high: colors.danger } as const;
// The rest of the memory in use, beside the app and its sessions: the same colour, darker.
const USED_COLOR = '#4b5099';
// Stop waits for the stragglers on the computer: a few seconds.
const STOP_TIMEOUT_MS = 30000;

type ActionResult = { ok?: boolean; error?: string } | null;

/**
 * The computer's Task Manager. On top, as on the desktop: the memory
 * installed, the memory in use on the whole computer, what Switchboard uses
 * with all its sessions, and the free disk space. Then every running session
 * and task, heaviest first,
 * with the RAM, CPU and processes of its whole tree (the CLI, its MCP servers,
 * the dev servers it started). Tap a row for its processes, where each one but
 * the session's own can be ended alone; Stop ends the session and anything it
 * left running. Reads again every few seconds while on screen.
 */
export default function ProcessesScreen() {
  const online = useConnection((s) => s.status.state === 'online');
  const supported = useCapability('get-process-usage');
  // On screen: on a Surface Duo a tab can be in sight without the focus.
  const focused = useShown();
  const navigation = useNavigation();
  // A task opens on its output, like the desktop's task log.
  const taskLogs = useCapability('get-task-run');
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  // Asked of the computer from this phone: Stop turns into Force kill, Kill into Force kill, while still listed.
  const [stopping, setStopping] = useState<Set<string>>(() => new Set());
  const [stopAsked, setStopAsked] = useState<Set<string>>(() => new Set());
  const [killAsked, setKillAsked] = useState<Set<string>>(() => new Set());
  const [pulling, setPulling] = useState(false);

  const usage = useQuery({
    queryKey: ['process-usage'],
    queryFn: () => request<ProcessUsage>('get-process-usage', [], { timeoutMs: 20000 }),
    enabled: online && supported,
    refetchOnMount: 'always',
    refetchInterval: (query) => (focused ? refreshInterval(query.state.data?.platform) : false),
  });
  const projects = useQuery({ queryKey: ['projects'], queryFn: () => request<Folder[]>('get-projects', [false]), enabled: online });
  const sessions = useMemo(() => sessionsById(projects.data), [projects.data]);

  const data = usage.data;
  const owners = useMemo(() => data?.owners ?? [], [data]);
  const maxBytes = owners.reduce((max, owner) => Math.max(max, owner.rssBytes), 0);
  // Uptimes count to when the computer measured, so they move with each refresh.
  const now = data?.sampledAt ?? 0;

  const refreshSoon = () => setTimeout(() => usage.refetch(), 700);
  const update = (set: Dispatch<SetStateAction<Set<string>>>, key: string, on: boolean) =>
    set((old) => { const next = new Set(old); if (on) next.add(key); else next.delete(key); return next; });

  const toggle = (key: string) => update(setExpanded, key, !expanded.has(key));

  const stop = (owner: Owner) => {
    const key = ownerKey(owner);
    const what = owner.kind === 'task' ? 'task' : 'session';
    const count = `${owner.processCount} process${owner.processCount === 1 ? '' : 'es'}`;
    Alert.alert(
      `Stop this ${what}?`,
      `“${ownerTitle(owner, sessions)}” uses ${formatBytes(owner.rssBytes)} across ${count}. All of them are ended, including any started in the background.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Stop', style: 'destructive', onPress: async () => {
            update(setStopAsked, key, true);
            update(setStopping, key, true);
            refreshSoon();
            try {
              const result = await request<ActionResult>('stop-owner', [ownerRef(owner)], { timeoutMs: STOP_TIMEOUT_MS });
              if (result && !result.ok && result.error) Alert.alert('Could not stop it', result.error);
            } catch (err: any) {
              Alert.alert('Could not stop it', err.message);
            } finally {
              update(setStopping, key, false);
              queryClient.invalidateQueries({ queryKey: ['projects'] });
              usage.refetch();
            }
          },
        },
      ],
    );
  };

  const forceStop = (owner: Owner) => {
    Alert.alert(
      'Force kill?',
      `Every process of “${ownerTitle(owner, sessions)}” gets SIGKILL right away: anything unsaved in them is lost.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Force kill', style: 'destructive', onPress: async () => {
            try {
              const result = await request<ActionResult>('force-stop-owner', [ownerRef(owner)]);
              if (result && !result.ok && result.error) Alert.alert('Could not kill it', result.error);
            } catch (err: any) {
              Alert.alert('Could not kill it', err.message);
            }
            queryClient.invalidateQueries({ queryKey: ['projects'] });
            refreshSoon();
          },
        },
      ],
    );
  };

  const kill = (owner: Owner, proc: OwnedProcess) => {
    const killKey = `${ownerKey(owner)}#${proc.pid}`;
    const force = killAsked.has(killKey);
    const name = proc.label || proc.name;
    Alert.alert(
      force ? 'Still running' : 'End this process?',
      force
        ? `“${name}” (PID ${proc.pid}) is still running. Send SIGKILL?`
        : `“${name}” (PID ${proc.pid}) uses ${formatBytes(proc.rssBytes)}. The ${owner.kind === 'task' ? 'task' : 'session'} keeps running; only this process ends.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: force ? 'Force kill' : 'Kill', style: 'destructive', onPress: async () => {
            try {
              const result = await request<ActionResult>('kill-owned-process', [ownerRef(owner), proc.pid, force]);
              if (!result?.ok) { if (result?.error) Alert.alert('Could not end it', result.error); return; }
              update(setKillAsked, killKey, true);
            } catch (err: any) {
              Alert.alert('Could not end it', err.message);
              return;
            }
            refreshSoon();
          },
        },
      ],
    );
  };

  const open = (owner: Owner) => {
    if (owner.kind === 'session') {
      // As from the lists: highlighted in Projects, and on a Surface Duo on its project's Session tab.
      const session = sessions.get(owner.id);
      openSessionFromTabs(navigation, { sessionId: owner.id, projectPath: owner.projectPath }, session?.projectId);
    }
    else if (owner.projectPath && owner.label) router.push({ pathname: '/task-log', params: { projectPath: owner.projectPath, label: owner.label } });
  };

  if (!online) {
    return <Empty title="Not connected" text="The Task Manager needs the computer online." />;
  }
  if (!supported) {
    return <Empty title="Update Switchboard on the computer" text="The Task Manager needs a newer Switchboard on the computer. Update it there, then come back." />;
  }

  const summary = data ? memorySummary(data) : null;
  const notes = [measureNote(data?.memoryMeasure)];
  if (data?.platform === 'win32') notes.push('CPU is not measured on Windows, and a WSL session only shows its Windows-side process.');

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={pulling} onRefresh={async () => { setPulling(true); await usage.refetch(); setPulling(false); }} tintColor={colors.accent} />}
    >
      <Stack.Screen options={{ title: 'Task Manager' }} />
      {!data ? (
        usage.error
          ? <Text style={styles.error}>Could not read the process list: {(usage.error as Error).message}</Text>
          : <ActivityIndicator color={colors.accent} style={styles.loading} />
      ) : (
        <>
          <MemoryCard summary={summary!} appCpu={data.app.cpu} />
          {data.disks?.length ? <DisksCard disks={data.disks} platform={data.platform} /> : null}

          <View style={styles.listHead}>
            <Text style={styles.listTitle}>By RAM</Text>
            <Text style={styles.listMeta}>{usage.isError ? 'Refresh failed' : `Live · every ${refreshInterval(data.platform) / 1000}s · ${new Date(data.sampledAt).toLocaleTimeString()}`}</Text>
          </View>
          {owners.length ? owners.map((owner) => {
            const key = ownerKey(owner);
            return (
              <OwnerRow
                key={key}
                owner={owner}
                title={ownerTitle(owner, sessions)}
                share={barShare(owner.rssBytes, maxBytes)}
                totalMemBytes={data.totalMemBytes}
                now={now}
                open={expanded.has(key)}
                pending={stopping.has(key)}
                stopped={stopAsked.has(key) || owner.stopRequested}
                killAsked={killAsked}
                onToggle={() => toggle(key)}
                onOpen={owner.kind === 'session' || taskLogs ? () => open(owner) : undefined}
                onStop={() => stop(owner)}
                onForceStop={() => forceStop(owner)}
                onKill={(proc) => kill(owner, proc)}
              />
            );
          }) : <Text style={styles.none}>No session or task is running.</Text>}
          {notes.map((note) => <Text key={note} style={styles.footnote}>{note}</Text>)}
        </>
      )}
    </ScrollView>
  );
}

function OwnerRow({ owner, title, share, totalMemBytes, now, open, pending, stopped, killAsked, onToggle, onOpen, onStop, onForceStop, onKill }: {
  owner: Owner;
  title: string;
  share: number;
  totalMemBytes: number;
  now: number;
  open: boolean;
  pending: boolean;
  stopped: boolean;
  killAsked: Set<string>;
  onToggle: () => void;
  /** Missing for a task when the computer cannot show its output to a phone. */
  onOpen?: () => void;
  onStop: () => void;
  onForceStop: () => void;
  onKill: (proc: OwnedProcess) => void;
}) {
  const level = memoryLevel(owner.rssBytes);
  const icon: keyof typeof Ionicons.glyphMap = owner.kind === 'task' ? 'play-outline' : owner.type === 'terminal' ? 'terminal-outline' : 'sparkles-outline';
  const shown = owner.processes.slice(0, MAX_PROCESS_ROWS);
  const hidden = owner.processes.slice(MAX_PROCESS_ROWS);
  const badge = pending || stopped ? 'stopping…' : owner.busy ? 'working' : null;

  return (
    <View style={styles.row}>
      <Pressable onPress={onToggle} accessibilityRole="button" accessibilityState={{ expanded: open }} accessibilityLabel={`${title}, ${formatBytes(owner.rssBytes)}`}>
        <View style={styles.rowTop}>
          <Ionicons name={icon} size={16} color={colors.textDim} style={styles.rowIcon} />
          <View style={styles.flex}>
            <View style={styles.titleLine}>
              <Text style={styles.title} numberOfLines={1}>{title}</Text>
              {badge ? <Text style={[styles.badge, badge === 'working' ? styles.badgeBusy : styles.badgeStop]}>{badge}</Text> : null}
              {!owner.found ? <Text style={styles.badge}>not measured</Text> : null}
            </View>
            <Text style={styles.sub} numberOfLines={1}>{ownerSubtitle(owner)}</Text>
          </View>
          <View style={styles.ram}>
            <Text style={[styles.ramValue, { color: level === 'low' ? colors.text : LEVEL_COLORS[level] }]}>{formatBytes(owner.rssBytes)}</Text>
            <Text style={styles.ramShare}>{formatShare(owner.rssBytes, totalMemBytes)}</Text>
          </View>
          <Ionicons name={open ? 'chevron-down' : 'chevron-forward'} size={14} color={colors.textFaint} />
        </View>
        <View style={styles.bar}>
          <View style={[styles.fill, { width: `${(share * 100).toFixed(2)}%` as `${number}%`, backgroundColor: LEVEL_COLORS[level] }]} />
        </View>
        <Text style={styles.meta}>
          {owner.processCount} process{owner.processCount === 1 ? '' : 'es'} · CPU {formatCpu(owner.cpu)} · up {formatUptime(owner.startedAt, now)}
        </Text>
      </Pressable>
      <View style={styles.actions}>
        {onOpen ? <Button label="Open" onPress={onOpen} /> : null}
        {pending
          ? <Button label="Stopping…" disabled />
          : stopped
            ? <Button label="Force kill" danger onPress={onForceStop} />
            : <Button label="Stop" stop onPress={onStop} />}
      </View>
      {open ? (
        <View style={styles.procs}>
          {shown.length ? shown.map((proc) => {
            const forcing = killAsked.has(`${ownerKey(owner)}#${proc.pid}`);
            return (
              <View key={proc.pid} style={[styles.proc, { paddingLeft: Math.min(proc.depth, 6) * 12 }]}>
                <View style={styles.flex}>
                  <Text style={styles.procName} numberOfLines={1}>{proc.depth ? '└ ' : ''}{proc.label || proc.name || '?'}</Text>
                  <Text style={styles.procMeta} numberOfLines={1}>PID {proc.pid} · CPU {formatCpu(proc.cpu)} · {formatBytes(proc.rssBytes)}</Text>
                  {proc.command ? <Text style={styles.procCmd} numberOfLines={2} selectable>{proc.command}</Text> : null}
                </View>
                {proc.depth === 0
                  ? <Text style={styles.root}>root</Text>
                  : <Button label={forcing ? 'Force kill' : 'Kill'} danger={forcing} small onPress={() => onKill(proc)} />}
              </View>
            );
          }) : <Text style={styles.procMeta}>No process found for this PID.</Text>}
          {hidden.length ? (
            <Text style={styles.procMeta}>
              …and {hidden.length} more process{hidden.length === 1 ? '' : 'es'}, {formatBytes(hidden.reduce((sum, proc) => sum + proc.rssBytes, 0))} in all.
            </Text>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

/**
 * The memory, one card and one bar: what the app and its sessions use, the
 * rest of what is in use on the computer in a darker shade, and what is free
 * up to the installed memory. "5.50 GB / 27.2 GB / 32.0 GB", each number in
 * its colour of the bar. A desktop too old to say what is in use gets the
 * first and the last.
 */
function MemoryCard({ summary, appCpu }: { summary: ReturnType<typeof memorySummary>; appCpu: number | null }) {
  const { used, installed, ours } = summary;
  return (
    <View style={styles.cardMain}>
      <Text style={styles.cardLabel} numberOfLines={1} adjustsFontSizeToFit>
        {used !== null ? 'App and sessions / Used / Installed' : 'App and sessions / Installed'}
      </Text>
      <Text style={styles.cardValue} numberOfLines={1} adjustsFontSizeToFit>
        <Text style={styles.oursValue}>{formatBytes(ours)}</Text>
        {used !== null ? <Text style={styles.usedValue}>{' / '}{formatBytes(used)}</Text> : null}
        <Text style={styles.cardUnit}>{' / '}{formatBytes(installed)}</Text>
      </Text>
      <View style={[styles.meter, styles.meterRow]}>
        <View style={[styles.fillFlat, { width: percent(summary.oursShare), backgroundColor: colors.accent }]} />
        {used !== null ? <View style={[styles.fillFlat, { width: percent(summary.usedShare - summary.oursShare), backgroundColor: USED_COLOR }]} /> : null}
      </View>
      <Text style={styles.cardHint}>
        {[
          `${formatPercent(ours, installed)} app and sessions`,
          used !== null ? `${formatPercent(used, installed)} used` : null,
          summary.free !== null ? `${formatBytes(summary.free)} free` : null,
        ].filter(Boolean).join(' · ')}
      </Text>
      <Text style={styles.cardHint}>
        app {formatBytes(summary.appBytes)} · {summary.running} {formatBytes(summary.ownersBytes)} · {summary.processCount} process{summary.processCount === 1 ? '' : 'es'} · app CPU {formatCpu(appCpu)}
      </Text>
    </View>
  );
}

/**
 * The disks, one line each: its name, what is free of how much, and a bar of
 * how full it is. The disk of home and the projects comes first; a computer
 * with more (Linux keeps the projects on several) lists them all.
 */
function DisksCard({ disks, platform }: { disks: Disk[]; platform: string }) {
  return (
    <View style={styles.cardMain}>
      <Text style={styles.cardLabel}>{disks.length > 1 ? `Disks · ${disks.length}` : 'Disk'}</Text>
      {disks.map((disk, i) => {
        const fill = diskFill(disk);
        return (
          <View
            key={disk.mount}
            style={[styles.disk, i > 0 && styles.diskNext]}
            accessible
            accessibilityLabel={`${disk.name}: ${formatDisk(disk.freeBytes, platform)} free of ${formatDisk(disk.totalBytes, platform)}`}
          >
            <Text style={styles.diskName} numberOfLines={1}>{disk.name}</Text>
            <Text style={styles.cardHint}>
              <Text style={styles.diskFree}>{formatDisk(disk.freeBytes, platform)} free</Text> of {formatDisk(disk.totalBytes, platform)} · {Math.round(fill.used * 100)}% used
            </Text>
            <View style={styles.meter}>
              <View style={[styles.fill, { width: percent(fill.used), backgroundColor: LEVEL_COLORS[fill.level] }]} />
            </View>
          </View>
        );
      })}
    </View>
  );
}

/** A 0 to 1 share as a width. */
function percent(share: number): `${number}%` {
  return `${Math.round(Math.max(0, Math.min(1, share)) * 10000) / 100}%`;
}

function Button({ label, onPress, disabled, danger, stop, small }: { label: string; onPress?: () => void; disabled?: boolean; danger?: boolean; stop?: boolean; small?: boolean }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || !onPress}
      accessibilityRole="button"
      accessibilityState={{ disabled: !!disabled }}
      style={({ pressed }) => [styles.button, small && styles.buttonSmall, danger && styles.buttonDanger, stop && styles.buttonStop, pressed && styles.pressed, disabled && styles.disabled]}
    >
      <Text style={[styles.buttonText, small && styles.buttonTextSmall, (danger || stop) && styles.buttonTextDanger]}>{label}</Text>
    </Pressable>
  );
}

function Empty({ title, text }: { title: string; text: string }) {
  return (
    <View style={styles.center}>
      <Stack.Screen options={{ title: 'Task Manager' }} />
      <Text style={styles.emptyTitle}>{title}</Text>
      <Text style={styles.emptyText}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.lg, gap: spacing.sm, paddingBottom: spacing.xl * 2 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl, gap: spacing.sm, backgroundColor: colors.background },
  emptyTitle: { color: colors.text, fontSize: 16, fontWeight: '600', textAlign: 'center' },
  emptyText: { color: colors.textDim, fontSize: 14, textAlign: 'center', lineHeight: 20 },
  loading: { marginTop: spacing.xl },
  error: { color: colors.danger, fontSize: 14 },
  flex: { flex: 1, minWidth: 0 },

  cardMain: { backgroundColor: colors.surface, borderRadius: 12, padding: spacing.md, gap: 4 },
  cardsRow: { flexDirection: 'row', gap: spacing.sm },
  card: { flex: 1, backgroundColor: colors.surface, borderRadius: 12, padding: spacing.md, gap: 3 },
  cardLabel: { color: colors.textFaint, fontSize: 11.5, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.5 },
  cardValue: { color: colors.text, fontSize: 26, fontWeight: '700' },
  cardValueSmall: { color: colors.text, fontSize: 17, fontWeight: '700' },
  cardHint: { color: colors.textDim, fontSize: 12 },
  meter: { height: 6, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.06)', overflow: 'hidden', marginVertical: 4 },
  fill: { height: '100%', borderRadius: 3 },
  meterRow: { flexDirection: 'row' },
  fillFlat: { height: '100%' },
  oursValue: { color: '#c4c8ff' },
  cardUnit: { color: colors.textDim, fontSize: 15, fontWeight: '500' },
  usedValue: { color: '#8f94d8' },
  disk: { gap: 3 },
  diskNext: { marginTop: spacing.sm, paddingTop: spacing.sm, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  diskName: { color: colors.text, fontSize: 15, fontWeight: '700' },
  diskFree: { color: colors.text, fontWeight: '600' },

  listHead: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', marginTop: spacing.md, paddingHorizontal: 2 },
  listTitle: { color: colors.text, fontSize: 15, fontWeight: '700' },
  listMeta: { color: colors.textFaint, fontSize: 11.5 },
  none: { color: colors.textFaint, fontSize: 14, paddingVertical: spacing.lg, textAlign: 'center' },

  row: { backgroundColor: colors.surface, borderRadius: 12, padding: spacing.md, gap: 6 },
  rowTop: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  rowIcon: { width: 18 },
  titleLine: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  title: { color: colors.text, fontSize: 15, fontWeight: '600', flexShrink: 1 },
  sub: { color: colors.textFaint, fontSize: 12, marginTop: 1 },
  badge: { color: colors.textDim, fontSize: 10.5, fontWeight: '600', paddingHorizontal: 6, paddingVertical: 1, borderRadius: 6, backgroundColor: 'rgba(255,255,255,0.06)', overflow: 'hidden' },
  badgeBusy: { color: colors.running, backgroundColor: 'rgba(76,175,143,0.14)' },
  badgeStop: { color: colors.attention, backgroundColor: 'rgba(224,160,80,0.14)' },
  ram: { alignItems: 'flex-end' },
  ramValue: { fontSize: 16, fontWeight: '700', fontVariant: ['tabular-nums'] },
  ramShare: { color: colors.textFaint, fontSize: 11 },
  bar: { height: 4, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.05)', overflow: 'hidden', marginTop: 8 },
  meta: { color: colors.textDim, fontSize: 12, marginTop: 6 },

  actions: { flexDirection: 'row', justifyContent: 'flex-end', gap: spacing.sm },
  button: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 8, backgroundColor: 'rgba(255,255,255,0.06)' },
  buttonSmall: { paddingHorizontal: 10, paddingVertical: 5 },
  buttonStop: { backgroundColor: 'rgba(224,108,117,0.12)' },
  buttonDanger: { backgroundColor: 'rgba(224,108,117,0.22)' },
  buttonText: { color: colors.text, fontSize: 13.5, fontWeight: '600' },
  buttonTextSmall: { fontSize: 12.5 },
  buttonTextDanger: { color: colors.danger },
  pressed: { opacity: 0.6 },
  disabled: { opacity: 0.45 },

  procs: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border, paddingTop: spacing.sm, gap: spacing.sm },
  proc: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  procName: { color: colors.text, fontSize: 13.5, fontWeight: '600' },
  procMeta: { color: colors.textDim, fontSize: 12, fontVariant: ['tabular-nums'] },
  procCmd: { color: colors.textFaint, fontSize: 11, fontFamily: 'monospace', marginTop: 2 },
  root: { color: colors.textFaint, fontSize: 11.5, paddingHorizontal: 6 },

  footnote: { color: colors.textFaint, fontSize: 11.5, lineHeight: 16, marginTop: spacing.sm },
});
