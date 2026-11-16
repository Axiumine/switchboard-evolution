import { router, useIsFocused } from 'expo-router';
import { useNavigationState, useRoute } from 'expo-router/react-navigation';
import { useCallback, useEffect, useRef } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { SessionBody } from '@/components/session/SessionBody';
import { SegmentedControl } from '@/components/session/SessionHeader';
import { useSessionData, useSessionView } from '@/components/session/useSessionData';
import { SessionActions } from '@/components/SessionActions';
import { STATE_COLORS } from '@/components/SessionRow';
import { isDuoModel, useHinge } from '@/layout/hinge';
import { useAreaWidth } from '@/layout/size';
import type { SessionView } from '@/projects/tabs';
import { sessionSubtitle, sessionTitle, type Session } from '@/sessions/model';
import { useConnection } from '@/store/connection';
import { colors, spacing } from '@/theme';

type Props = {
  sessionId: string;
  /** What to show first, when the tab was opened on purpose (a new session opens on its terminal). */
  view: SessionView | undefined;
  /** Whether the Session tab is the one on screen. */
  active: boolean;
  /** The page header's ⋯ asked for this session's actions. */
  actionsOpen: boolean;
  onCloseActions: () => void;
  onProjectActions: () => void;
  /** The tab should show another session: a fork, or the id a new session got. */
  onSessionChange: (sessionId: string, view?: SessionView) => void;
};

/**
 * The project's Session tab: the session opened in the project, under the
 * project's header and tabs, as on the desktop. A bar with its state, title
 * and Chat | Terminal, then the same chat or terminal as the session's own
 * screen. On a Surface Duo the header's ⋯ has Split screen, which opens it on
 * both screens (chat left, terminal right); One screen comes back here.
 */
export function SessionTab(props: Props) {
  const route = useRoute();
  // Split across both screens it is drawn there, in front of this page: not twice.
  const split = useNavigationState((s) => {
    const at = s.routes.findIndex((r) => r.key === route.key);
    return s.routes.slice(at + 1).some((r) => r.name === 'session/[id]' && (r.params as { id?: string } | undefined)?.id === props.sessionId);
  });
  if (split) return <Text style={styles.away}>Open on both screens.</Text>;
  return <EmbeddedSession key={props.sessionId} {...props} />;
}

function EmbeddedSession({ sessionId, view: askedView, active, actionsOpen, onCloseActions, onProjectActions, onSessionChange }: Props) {
  const { view, showView, terminalOpened } = useSessionView(askedView);
  const viewRef = useRef(view);
  useEffect(() => { viewRef.current = view; }, [view]);
  const follow = useCallback((next: string) => onSessionChange(next, viewRef.current), [onSessionChange]);
  const data = useSessionData(sessionId, follow);
  const { session, state, track, working, isTerminal } = data;
  // Asked again for a view (a resumed session opens on its terminal).
  useEffect(() => { if (askedView) showView(askedView); }, [askedView, showView]);

  // Read while on screen: the computer clears its unread and needs-you marks.
  const focused = useIsFocused();
  const setViewing = useConnection((s) => s.setViewing);
  const shownId = data.sessionId;
  useEffect(() => {
    if (!focused || !active) return;
    setViewing(shownId);
    return () => { if (useConnection.getState().viewing === shownId) setViewing(null); };
  }, [focused, active, shownId, setViewing]);

  const hinge = useHinge();
  const width = useAreaWidth();
  const canSplit = isDuoModel() && !!hinge && !isTerminal;
  const extra = canSplit
    ? [{ label: 'Split screen', hint: 'chat on the left, terminal on the right', onPress: () => router.push({ pathname: '/session/[id]', params: { id: shownId, split: '1', from: 'project' } }) }]
    : [];
  // An archived session is not in the list the sheet reads; its id is enough for the sheet.
  const sheetSession: Session | null = actionsOpen ? session ?? { sessionId: shownId, projectPath: '', archived: 1 } : null;

  const resume = async () => { if (await data.launch('resume')) showView('terminal'); };
  const fork = async () => {
    const id = await data.launch('fork');
    if (id) onSessionChange(id, 'terminal');
  };

  const title = session ? sessionTitle(session) : 'Session';
  const subtitle = session ? sessionSubtitle(session, { track, state, working }) : '';
  const dot = STATE_COLORS[state];
  return (
    <View style={styles.fill}>
      <View style={styles.bar}>
        <View style={[styles.dot, { backgroundColor: dot, borderColor: state === 'idle' ? colors.textFaint : dot }]} />
        <View style={styles.titles} accessible accessibilityRole="header" accessibilityLabel={subtitle ? `${title}, ${subtitle}` : title}>
          <Text style={styles.title} numberOfLines={1}>{title}</Text>
          {subtitle ? <Text style={styles.subtitle} numberOfLines={1}>{subtitle}</Text> : null}
        </View>
        {isTerminal ? null : <SegmentedControl tab={view} onChange={showView} waiting={state === 'attention'} compact iconsOnly={width < 460} />}
      </View>
      <SessionBody data={data} view={view} onView={showView} terminalOpened={terminalOpened} onResume={resume} onFork={fork} visible={active && focused} />
      <SessionActions
        session={sheetSession}
        onClose={onCloseActions}
        extra={extra}
        trailing={[{ label: 'Project actions…', onPress: onProjectActions }]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  bar: {
    minHeight: 52, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.lg, paddingVertical: 6,
    backgroundColor: colors.background, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border,
  },
  dot: { width: 10, height: 10, borderRadius: 5, borderWidth: 1.5 },
  titles: { flex: 1, minWidth: 0 },
  title: { color: colors.text, fontSize: 15, fontWeight: '700', lineHeight: 20 },
  subtitle: { color: colors.textFaint, fontSize: 12, lineHeight: 16 },
  away: { color: colors.textFaint, fontSize: 14, textAlign: 'center', padding: spacing.xl },
});
