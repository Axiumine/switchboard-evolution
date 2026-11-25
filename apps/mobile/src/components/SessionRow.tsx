import { memo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { cliLabel, relativeTime, sessionTitle, type RowState, type Session } from '@/sessions/model';
import { starTintColor } from '@/shared/vendor/star-tints';
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

const STATE_LABELS: Record<RowState, string> = {
  attention: 'waiting for you',
  busy: 'working',
  subagent: 'a subagent is working',
  unread: 'unread',
  running: 'running',
  idle: '',
};

type Props = {
  session: Session; state: RowState; onPress: (session: Session) => void; onLongPress: (session: Session) => void; inset?: boolean;
  /** While searching: the X that leaves this row out of the search. */
  onLeaveOut?: (session: Session) => void;
  /** The folder it runs in, short ("Code/switchboard"): shown in a list that has no folder headers. */
  folder?: string;
  /** The drag handle of a pinned one, inside a ReorderItem. */
  handle?: boolean;
};

/** One session: its state dot, title, and the CLI, age and size underneath. */
export const SessionRow = memo(function SessionRow({ session, state, onPress, onLongPress, inset, onLeaveOut, folder, handle }: Props) {
  // The folder comes after the age, so a long path is what gets cut short.
  const meta = [cliLabel(session), relativeTime(session.modified || session.created)];
  if (folder) meta.push(folder);
  if (session.messageCount) meta.push(`${session.messageCount} msgs`);
  if (STATE_LABELS[state]) meta.unshift(STATE_LABELS[state]);
  return (
    <Pressable
      onPress={() => onPress(session)}
      onLongPress={() => onLongPress(session)}
      style={({ pressed }) => [styles.row, inset && styles.inset, pressed && styles.pressed]}
      accessibilityRole="button"
      accessibilityLabel={`${sessionTitle(session)}, ${meta.join(', ')}${session.starred ? ', pinned' : ''}`}
    >
      <View style={[styles.dot, { backgroundColor: STATE_COLORS[state], borderColor: state === 'idle' ? colors.border : STATE_COLORS[state] }]} />
      <View style={styles.text}>
        <Text style={[styles.title, state === 'unread' && styles.unread]} numberOfLines={1}>
          {sessionTitle(session)}
        </Text>
        <Text style={[styles.meta, (state === 'attention' || state === 'unread') && { color: STATE_COLORS[state] }]} numberOfLines={1}>
          {meta.join(' · ')}
        </Text>
      </View>
      {/* Each pinned session in its own color, so several tell apart. */}
      {session.starred ? <Text style={[styles.star, { color: starTintColor(session.starTint, session.sessionId) }]}>★</Text> : null}
      {onLeaveOut ? <LeaveOutButton label={sessionTitle(session)} onPress={() => onLeaveOut(session)} /> : null}
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
  dot: { width: 9, height: 9, borderRadius: 5, borderWidth: 1 },
  text: { flex: 1, gap: 3 },
  title: { color: colors.text, fontSize: 15 },
  // Finished while nobody was looking, as the desktop shows it.
  unread: { color: colors.unread, fontWeight: '600' },
  meta: { color: colors.textFaint, fontSize: 12 },
  star: { fontSize: 14 },
});
