import { memo } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';

import { memoryFigure } from '@/processes/session-memory';
import { cliLabel, relativeTime, sessionTitle, type RowState, type Session } from '@/sessions/model';
import { refreshSessionLists } from '@/sessions/refresh';
import { formatBytes } from '@/shared/vendor/usage-chart';
import { starTintColor } from '@/shared/vendor/star-tints';
import { request } from '@/store/connection';
import { ReorderHandle } from './reorder/Reorder';
import { LeaveOutButton } from './SearchStopBar';
import { colors, spacing } from '@/theme';

export const STATE_COLORS: Record<RowState, string> = {
  attention: colors.attention,
  busy: colors.accent,
  // The same grey as the sessions count on a project row: work goes on, but it is not the main agent's.
  subagent: colors.textFaint,
  unread: colors.unread,
  running: colors.running,
  idle: 'transparent',
};

export const STATE_LABELS: Record<RowState, string> = {
  attention: 'waiting for you',
  busy: 'working',
  subagent: 'a subagent is working',
  unread: 'unread',
  running: 'running',
  idle: '',
};

// The desktop's colours for what a session uses (.session-ram): grey, amber from 1 GB, red from 2 GB.
const RAM_COLORS = { low: '#7a7a90', mid: '#f0a050', high: '#e05070' } as const;

/** What a live session uses, at the right of a row's second line; nothing when it runs nothing. */
export function RamText({ bytes }: { bytes?: number }) {
  const figure = memoryFigure(bytes);
  if (!figure) return null;
  const text = formatBytes(figure.bytes);
  return (
    <Text style={[styles.ram, { color: RAM_COLORS[figure.level] }, figure.level === 'high' && styles.ramHigh]} accessibilityLabel={`uses ${text}`}>
      {text}
    </Text>
  );
}

/** The star at the right of a row's title, as on the desktop: outlined, or in the session's own colour when pinned; a tap pins or unpins. */
export function StarButton({ session }: { session: Session }) {
  const toggle = async () => {
    try {
      const result: any = await request('toggle-star', [session.sessionId]);
      if (result && typeof result === 'object' && result.error) throw new Error(result.error);
    } catch (err: any) {
      Alert.alert('That did not work', err?.message || String(err));
    } finally {
      refreshSessionLists();
    }
  };
  return (
    <Pressable
      onPress={toggle}
      hitSlop={10}
      style={styles.starButton}
      accessibilityRole="button"
      accessibilityLabel={session.starred ? 'Unpin' : 'Pin'}
      accessibilityState={{ selected: !!session.starred }}
    >
      <Text style={[styles.star, { color: session.starred ? starTintColor(session.starTint, session.sessionId) : colors.textFaint }]}>
        {session.starred ? '★' : '☆'}
      </Text>
    </Pressable>
  );
}

type Props = {
  session: Session; state: RowState; onPress: (session: Session) => void; onLongPress: (session: Session) => void; inset?: boolean;
  /** While searching: the X that leaves this row out of this search. */
  onLeaveOut?: (session: Session) => void;
  /** The folder it runs in, short ("Code/switchboard"): shown in a list that has no folder headers. */
  folder?: string;
  /** The name of the project it belongs to: first on the second line. */
  project?: string;
  /** What the live session uses, in bytes: at the right of the second line. */
  ram?: number;
  /** The drag handle of a pinned one, inside a ReorderItem. */
  handle?: boolean;
};

/**
 * One session, on three lines as the desktop's Sessions tab: its title and
 * star; its project, its folder (in a list without folder headers) and what
 * it uses at the right; its state, CLI, age and size. The second line shows
 * only when it has something to say.
 */
export const SessionRow = memo(function SessionRow({ session, state, onPress, onLongPress, inset, onLeaveOut, folder, project, ram, handle }: Props) {
  const lit = state !== 'idle';
  const meta = [cliLabel(session), relativeTime(session.modified || session.created)];
  if (session.messageCount) meta.push(`${session.messageCount} msgs`);
  if (STATE_LABELS[state]) meta.unshift(STATE_LABELS[state]);
  const middle = !!project || !!folder || !!memoryFigure(ram);
  const where = [project ? `project ${project}` : null, folder ?? null].filter(Boolean);
  return (
    <Pressable
      onPress={() => onPress(session)}
      onLongPress={() => onLongPress(session)}
      style={({ pressed }) => [styles.row, inset && styles.inset, pressed && styles.pressed]}
      accessibilityRole="button"
      accessibilityLabel={`${sessionTitle(session)}, ${[...where, ...meta].join(', ')}${session.starred ? ', pinned' : ''}`}
    >
      <View style={styles.text}>
        <View style={styles.line}>
          <Text style={[styles.title, state === 'unread' && styles.unread]} numberOfLines={1}>
            {sessionTitle(session)}
          </Text>
          {onLeaveOut ? <LeaveOutButton label={sessionTitle(session)} onPress={() => onLeaveOut(session)} /> : null}
          <StarButton session={session} />
        </View>
        {middle ? (
          <View style={styles.line}>
            {project ? <Text style={styles.project} numberOfLines={1}>{project}</Text> : null}
            {/* The folder comes after the project, so a long path is what gets cut short. */}
            {folder ? <Text style={styles.folder} numberOfLines={1}>{folder}</Text> : <View style={styles.fill} />}
            <RamText bytes={ram} />
          </View>
        ) : null}
        <View style={styles.line}>
          {lit ? <View style={[styles.dot, { backgroundColor: STATE_COLORS[state] }]} /> : null}
          <Text style={[styles.meta, (state === 'attention' || state === 'unread') && { color: STATE_COLORS[state] }]} numberOfLines={1}>
            {meta.join(' · ')}
          </Text>
        </View>
      </View>
      {handle ? <ReorderHandle label={sessionTitle(session)} /> : null}
    </Pressable>
  );
});

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    backgroundColor: colors.background,
  },
  // Inside a padded block, such as a project's track.
  inset: { paddingHorizontal: 0 },
  pressed: { backgroundColor: colors.surface },
  text: { flex: 1, minWidth: 0, gap: 4 },
  line: { flexDirection: 'row', alignItems: 'center', gap: 6, minWidth: 0 },
  fill: { flex: 1 },
  title: { flex: 1, color: colors.text, fontSize: 15 },
  // Finished while nobody was looking, as the desktop shows it.
  unread: { color: colors.unread, fontWeight: '600' },
  // As the desktop's project label: the accent, on a faint tint of it.
  project: {
    flexShrink: 1, maxWidth: '60%', color: colors.accent, backgroundColor: 'rgba(128,136,255,0.14)',
    fontSize: 11, fontWeight: '600', paddingHorizontal: 5, paddingVertical: 1, borderRadius: 4, overflow: 'hidden',
  },
  folder: { flex: 1, color: colors.textFaint, fontSize: 11.5 },
  ram: { fontSize: 11, fontVariant: ['tabular-nums'] },
  ramHigh: { fontWeight: '600' },
  dot: { width: 7, height: 7, borderRadius: 4 },
  meta: { flexShrink: 1, color: colors.textFaint, fontSize: 12 },
  starButton: { paddingHorizontal: 2 },
  star: { fontSize: 15 },
});
