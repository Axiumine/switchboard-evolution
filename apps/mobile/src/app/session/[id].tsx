import { router, Stack, useFocusEffect, useLocalSearchParams, useNavigation } from 'expo-router';
import { useNavigationState, useRoute, type NavigationProp } from 'expo-router/react-navigation';
import { useCallback, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { CHAT_COLUMN, ChatView } from '@/components/ChatView';
import { ChatComposer } from '@/components/composer/ChatComposer';
import { KeyboardSpacer } from '@/components/composer/KeyboardSpacer';
import { TerminalComposer } from '@/components/composer/TerminalComposer';
import { DiffBanner, NotRunning, SessionBody } from '@/components/session/SessionBody';
import { SessionHeader } from '@/components/session/SessionHeader';
import { useSessionData, useSessionView } from '@/components/session/useSessionData';
import { SessionActions } from '@/components/SessionActions';
import { TerminalView } from '@/components/TerminalView';
import { opensSplit } from '@/layout/carousel';
import { isDuoModel, useHinge } from '@/layout/hinge';
import { AreaWidth } from '@/layout/size';
import { parseSessionView } from '@/projects/tabs';
import { cliLabel, sessionSubtitle, sessionTitle, type Session } from '@/sessions/model';
import { useConnection } from '@/store/connection';
import { colors, spacing } from '@/theme';

/** One session: its conversation, its live terminal, and resume or fork when it is not running. */
export default function SessionScreen() {
  // `from=project`: opened on both screens from a project's Session tab, which One screen goes back to.
  const params = useLocalSearchParams<{ id: string; tab?: string; split?: string; from?: string }>();
  const data = useSessionData(params.id);
  const { sessionId, session, isTerminal, state, running, track, transcript, working } = data;
  const setViewing = useConnection((s) => s.setViewing);
  const [actions, setActions] = useState<Session | null>(null);
  const { view, showView, terminalOpened } = useSessionView(parseSessionView(params.tab));
  // On a Surface Duo open across both screens, a session in front may take
  // both: the chat on the left, the terminal on the right (AppStack gives it
  // the whole window), when its menu's Split screen asks for it.
  const hinge = useHinge();
  const insets = useSafeAreaInsets();
  const route = useRoute();
  const navigation = useNavigation<NavigationProp<Record<string, { split?: string }>>>();
  const place = useNavigationState((s) => {
    const at = s.routes.findIndex((r) => r.key === route.key);
    return { top: at === s.index };
  });
  const canSplit = isDuoModel() && !!hinge && place.top && !isTerminal;
  const split = canSplit && opensSplit(params);

  // While this screen is in front: another screen pushed on top, or going
  // back to it, changes what is on screen without unmounting it.
  useFocusEffect(useCallback(() => {
    setViewing(sessionId);
    return () => { if (useConnection.getState().viewing === sessionId) setViewing(null); };
  }, [sessionId, setViewing]));

  const resume = async () => { if (await data.launch('resume')) showView('terminal'); };
  const fork = async () => {
    const id = await data.launch('fork');
    if (id) router.replace({ pathname: '/session/[id]', params: { id, tab: 'terminal' } });
  };

  // Opened on both screens from a project, one screen is the project's Session tab again.
  const toOneScreen = () => (params.from === 'project' ? router.back() : navigation.setParams({ split: '0' }));
  const splitOption = canSplit
    ? [{ label: split ? 'One screen' : 'Split screen', hint: split ? 'chat and terminal as tabs' : 'chat on the left, terminal on the right', onPress: () => (split ? toOneScreen() : navigation.setParams({ split: '1' })) }]
    : [];

  const title = session ? sessionTitle(session) : 'Session';
  const subtitle = session ? sessionSubtitle(session, { track, state, working }) : '';

  if (split && hinge) {
    return (
      <View style={[styles.screen, styles.row]}>
        <Stack.Screen options={{ title, headerShown: false }} />
        <AreaWidth.Provider value={hinge.x}>
          <View style={{ width: hinge.x }}>
            <SessionHeader title={title} subtitle={subtitle} state={state} onMore={session ? () => setActions(session) : undefined} tab="chat" onTab={() => {}} showTabs={false} />
            <DiffBanner data={data} />
            <View style={styles.body}>
              <ChatView items={transcript.items} error={transcript.error} state={state} loading={transcript.loading} cwd={session?.projectPath} earlier={transcript.earlier} />
            </View>
            {running ? (
              <ChatComposer sessionId={sessionId} session={session} cli={session ? cliLabel(session) : 'Claude'} state={state} working={working} onOpenTerminal={() => {}} />
            ) : <View style={styles.chatColumn}><NotRunning data={data} onResume={resume} onFork={fork} /></View>}
            <KeyboardSpacer />
          </View>
        </AreaWidth.Provider>
        <View style={{ width: hinge.width }} />
        {/* The terminal needs no title of its own: the chat's is on the left. */}
        <View style={[styles.body, { paddingTop: insets.top }]}>
          <View style={styles.body}>
            {running ? <TerminalView key={sessionId} sessionId={sessionId} /> : <Text style={styles.ended}>This session is not running.</Text>}
          </View>
          {running ? <TerminalComposer sessionId={sessionId} send={data.send} session={session} state={state} /> : null}
          <KeyboardSpacer />
        </View>
        <SessionActions session={actions} onClose={() => setActions(null)} extra={splitOption} />
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <Stack.Screen options={{ title, headerShown: false }} />
      <SessionHeader
        title={title}
        subtitle={subtitle}
        state={state}
        onMore={session ? () => setActions(session) : undefined}
        tab={isTerminal ? 'terminal' : view}
        onTab={showView}
        showTabs={!isTerminal}
      />
      <SessionBody data={data} view={view} onView={showView} terminalOpened={terminalOpened} onResume={resume} onFork={fork} />
      <SessionActions session={actions} onClose={() => setActions(null)} extra={splitOption} />
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row' },
  screen: { flex: 1, backgroundColor: colors.background },
  body: { flex: 1 },
  ended: { color: colors.textDim, fontSize: 14, textAlign: 'center', padding: spacing.xl },
  chatColumn: { width: '100%', maxWidth: CHAT_COLUMN, alignSelf: 'center' },
});
