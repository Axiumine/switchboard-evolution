import Ionicons from '@expo/vector-icons/Ionicons';
import { useQuery } from '@tanstack/react-query';
import { router, Stack, useNavigation } from 'expo-router';
import { useMemo, useState, type Dispatch, type SetStateAction } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

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
import { usePullRefresh } from '@/components/PullRefresh';
import { UsageDonut, type DetailRow } from '@/components/processes/UsageDonut';
import { useShown } from '@/layout/shown';
import { openSessionFromTabs } from '@/projects/open-session';
import { queryClient } from '@/remote/query';
import type { Folder, Session } from '@/sessions/model';
import { diskSlices, memorySlices, memoryTotals, type ProjectDiskUsage, type Slice } from '@/shared/vendor/usage-chart';
import { request, useCapability, useConnection } from '@/store/connection';
import { colors, spacing } from '@/theme';

// A shell busy starting up can briefly hold hundreds of processes; keep the list readable.
const MAX_PROCESS_ROWS = 40;
const LEVEL_COLORS = { low: colors.accent, mid: colors.attention, high: colors.danger } as const;
// Project sizes change slowly and the computer keeps them for half an hour: ask now and then.
const PROJECT_DISK_MS = 10000;
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

  const usage = useQuery({
    queryKey: ['process-usage'],
    queryFn: () => request<ProcessUsage>('get-process-usage', [], { timeoutMs: 20000 }),
    enabled: online && supported,
    refetchOnMount: 'always',
    refetchInterval: (query) => (focused ? refreshInterval(query.state.data?.platform) : false),
    // It polls: no SyncBar for it.
    meta: { quiet: true },
  });
  // How much disk each project takes with its attached folders, for the disk ring.
  const projectSizes = useCapability('get-project-disk-usage');
  const projectDisk = useQuery({
    queryKey: ['project-disk-usage'],
    queryFn: () => request<ProjectDiskUsage>('get-project-disk-usage', [], { timeoutMs: 20000 }),
    enabled: online && projectSizes,
    refetchOnMount: 'always',
    refetchInterval: (query) => (focused ? (query.state.data?.measuring ? 3000 : PROJECT_DISK_MS) : false),
    meta: { quiet: true },
  });
  const measureAgain = async () => {
    try {
      const result = await request<ProjectDiskUsage>('get-project-disk-usage', [true], { timeoutMs: 20000 });
      queryClient.setQueryData(['project-disk-usage'], result);
    } catch (err: any) {
      Alert.alert('Could not measure the projects', err.message);
    }
  };
  const pull = usePullRefresh(() => Promise.all([usage.refetch(), projectDisk.refetch()]));
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
    return <Empty title="Update Switchboard Evolution on the computer" text="The Task Manager needs a newer Switchboard Evolution on the computer. Update it there, then come back." />;
  }

  const notes = [measureNote(data?.memoryMeasure)];
  if (data?.platform === 'win32') notes.push('CPU is not measured on Windows, and a WSL session only shows its Windows-side process.');

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.content}
      refreshControl={pull}
    >
      <Stack.Screen options={{ title: 'Task Manager' }} />
      {!data ? (
        usage.error
          ? <Text style={styles.error}>Could not read the process list: {(usage.error as Error).message}</Text>
          : <ActivityIndicator color={colors.accent} style={styles.loading} />
      ) : (
        <>
          <MemoryCard data={data} sessions={sessions} />
          {data.disks?.length ? <DisksCard disks={data.disks} platform={data.platform} projects={projectSizes ? projectDisk.data ?? null : null} onMeasure={measureAgain} /> : null}

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
 * The memory, as on the desktop: what the app and its sessions use / what is
 * in use on the computer / what is installed, then a ring of the installed
 * memory: the app, each of the largest sessions and tasks, other apps, free.
 * A desktop too old to say what is in use gets two numbers and no "other apps".
 */
function MemoryCard({ data, sessions }: { data: ProcessUsage; sessions: ReadonlyMap<string, Session> }) {
  const totals = memoryTotals(data);
  // Colours go by session, so a session keeps its colour while among the largest.
  const ring = useMemo(() => memorySlices(data, { labelFor: (owner) => ownerTitle(owner, sessions) }), [data, sessions]);
  const { used, installed, ours } = totals;
  const running = [`${totals.sessions} session${totals.sessions === 1 ? '' : 's'}`];
  if (totals.tasks) running.push(`${totals.tasks} task${totals.tasks === 1 ? '' : 's'}`);
  const center = used === null
    ? { big: formatPercent(ours, installed) || '—', small: 'app and sessions' }
    : { big: formatPercent(used, installed) || '—', small: 'in use' };
  return (
    <View style={styles.cardMain}>
      <Text style={styles.cardLabel}>Memory</Text>
      <Text style={styles.cardValue} numberOfLines={1} adjustsFontSizeToFit>
        <Text style={styles.oursValue}>{formatBytes(ours)}</Text>
        {used !== null ? <Text style={styles.usedValue}>{' / '}{formatBytes(used)}</Text> : null}
        <Text style={styles.cardUnit}>{' / '}{formatBytes(installed)}</Text>
      </Text>
      <Text style={styles.cardKey} numberOfLines={1} adjustsFontSizeToFit>
        {used !== null ? 'App and sessions / in use / installed' : 'App and sessions / installed'}
      </Text>
      <UsageDonut
        slices={ring.slices}
        total={installed}
        format={formatBytes}
        center={center}
        label={used !== null
          ? `Switchboard and its sessions use ${formatBytes(ours)}; ${formatBytes(used)} of ${formatBytes(installed)} is in use on the computer`
          : `Switchboard and its sessions use ${formatBytes(ours)} of ${formatBytes(installed)}`}
      />
      <Text style={styles.cardHint}>
        {[
          `app ${formatBytes(totals.appBytes)}`,
          `${running.join(', ')} ${formatBytes(totals.ownersBytes)}`,
          `${totals.processes} process${totals.processes === 1 ? '' : 'es'}`,
          totals.free !== null ? `${formatBytes(totals.free)} free` : null,
          `app CPU ${formatCpu(data.app.cpu)}`,
        ].filter(Boolean).join(' · ')}
      </Text>
    </View>
  );
}

/** "just now", "12 min ago", "2 h ago". */
function agoText(at: number): string {
  const minutes = Math.max(0, Math.round((Date.now() - at) / 60000));
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  return `${Math.round(minutes / 60)} h ago`;
}

/**
 * The disk of home and the projects as a ring, as on the desktop: used / size,
 * each project (its folder and attached folders, which open under it) when
 * the computer measured them, other files and free. Any other disk below it
 * as a line and a bar.
 */
function DisksCard({ disks, platform, projects, onMeasure }: {
  disks: Disk[];
  platform: string;
  projects: ProjectDiskUsage | null;
  onMeasure: () => void;
}) {
  const [main, ...others] = disks;
  const ring = useMemo(() => diskSlices(main, { projects: projects?.projects ?? null }), [main, projects]);
  const used = Math.max(0, main.totalBytes - main.freeBytes);
  const format = (bytes: number) => formatDisk(bytes, platform);
  const details = (slice: Slice): DetailRow[] | null => {
    if (slice.project) {
      return slice.project.folders.map((folder) => {
        const notes = [];
        if (folder.isRoot) notes.push('project folder');
        if (folder.inside) notes.push(`inside ${folder.inside}`);
        if (folder.alsoIn.length) notes.push(`also in ${folder.alsoIn.join(', ')}`);
        return { key: folder.path, name: folder.name, value: folder.bytes == null ? '—' : format(folder.bytes), note: notes.join(' · ') };
      });
    }
    if (slice.projects) return slice.projects.map((project) => ({ key: project.id, name: project.name, value: format(project.bytes) }));
    return null;
  };
  const level = ring.level === 'high' ? 'Almost full' : ring.level === 'mid' ? 'Low on space' : null;
  return (
    <View style={styles.cardMain}>
      <Text style={styles.cardLabel}>{disks.length > 1 ? `Disk · ${disks.length} disks` : 'Disk'}</Text>
      <Text style={styles.cardValue} numberOfLines={1} adjustsFontSizeToFit>
        {format(used)}<Text style={styles.cardUnit}>{' / '}{format(main.totalBytes)}</Text>
      </Text>
      <Text style={styles.cardKey}>used / size</Text>
      <UsageDonut
        slices={ring.slices}
        total={main.totalBytes}
        format={format}
        center={{ big: formatPercent(used, main.totalBytes) || '—', small: 'used' }}
        label={`${main.name}: ${format(used)} used of ${format(main.totalBytes)}, ${format(main.freeBytes)} free`}
        details={details}
      />
      <Text style={styles.cardHint}>
        {format(main.freeBytes)} free on {main.name}
        {level ? <Text style={[styles.low, ring.level === 'high' && styles.lowHigh]}>{` · ${level}`}</Text> : null}
      </Text>
      {projects ? (
        projects.measuring
          ? <Text style={styles.cardHint}>{projects.projects ? 'Measuring the projects again…' : 'Measuring the projects (their folder and attached folders)…'}</Text>
          : projects.measuredAt ? (
            <View style={styles.measureLine}>
              <Text style={styles.cardHint}>Projects measured {agoText(projects.measuredAt)} · </Text>
              <Pressable onPress={onMeasure} accessibilityRole="button" hitSlop={8} style={({ pressed }) => pressed && styles.pressed}>
                <Text style={styles.link}>Measure again</Text>
              </Pressable>
            </View>
          ) : null
      ) : null}
      {others.map((disk) => {
        const fill = diskFill(disk);
        return (
          <View
            key={disk.mount}
            style={[styles.disk, styles.diskNext]}
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
  oursValue: { color: '#c4c8ff' },
  cardKey: { color: colors.textFaint, fontSize: 11.5 },
  low: { color: colors.attention, fontWeight: '600' },
  lowHigh: { color: colors.danger },
  measureLine: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap' },
  link: { color: colors.accent, fontSize: 12, fontWeight: '600' },
  cardUnit: { color: colors.textDim, fontSize: 15, fontWeight: '500' },
  usedValue: { color: '#a6a8d8' },
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
