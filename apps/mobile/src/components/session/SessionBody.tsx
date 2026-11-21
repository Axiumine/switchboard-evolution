import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { CHAT_COLUMN, ChatView } from '@/components/ChatView';
import { ChatComposer } from '@/components/composer/ChatComposer';
import { KeyboardSpacer } from '@/components/composer/KeyboardSpacer';
import { TerminalComposer } from '@/components/composer/TerminalComposer';
import { NotRunningCard } from '@/components/session/NotRunningCard';
import type { SessionData } from '@/components/session/useSessionData';
import { TerminalView } from '@/components/TerminalView';
import type { SessionView } from '@/projects/tabs';
import { canFork, cliLabel } from '@/sessions/model';
import { colors, spacing } from '@/theme';

/** The bar that says a change waits for review, and opens it. */
export function DiffBanner({ data }: { data: SessionData }) {
  const { waiting } = data;
  if (!waiting.length) return null;
  return (
    <Pressable onPress={() => router.push({ pathname: '/ide-diff', params: { diffId: waiting[0].diffId } })} style={styles.diffBanner} accessibilityRole="button">
      <Ionicons name="eye-outline" size={17} color={colors.attention} />
      <Text style={styles.diffBannerText} numberOfLines={1}>
        {waiting.length === 1 ? `Wants to change ${waiting[0].oldFilePath.split('/').pop()}` : `${waiting.length} changes to review`} · Review
      </Text>
    </Pressable>
  );
}

/** Resume, options, fork: what a session that is not running offers. */
export function NotRunning({ data, onResume, onFork }: { data: SessionData; onResume: () => void; onFork: () => void }) {
  return (
    <NotRunningCard
      terminal={data.isTerminal}
      starting={data.starting}
      forkable={!data.session || canFork(data.session)}
      onResume={onResume}
      onOptions={() => router.push({ pathname: '/new', params: { mode: 'resume', sessionId: data.sessionId } })}
      onFork={onFork}
    />
  );
}

/**
 * A session on one screen, under its header: the chat or the live terminal,
 * the composer that belongs to it, and resume or fork when it is not running.
 * `visible` false (a project tab out of sight) takes the terminal's focus away.
 */
export function SessionBody({ data, view, onView, terminalOpened, onResume, onFork, visible = true }: {
  data: SessionData;
  view: SessionView;
  onView: (view: SessionView) => void;
  terminalOpened: boolean;
  onResume: () => void;
  onFork: () => void;
  visible?: boolean;
}) {
  const { sessionId, session, isTerminal, state, running, transcript, working, send } = data;
  const shown: SessionView = isTerminal ? 'terminal' : view;
  const terminalMounted = running && (shown === 'terminal' || terminalOpened);
  return (
    <>
      <DiffBanner data={data} />
      <View style={styles.body}>
        {terminalMounted ? (
          <View
            style={shown === 'terminal' ? styles.body : styles.behind}
            pointerEvents={shown === 'terminal' ? 'auto' : 'none'}
            importantForAccessibility={shown === 'terminal' ? 'auto' : 'no-hide-descendants'}
            accessibilityElementsHidden={shown !== 'terminal'}
          >
            <TerminalView key={sessionId} sessionId={sessionId} visible={visible && shown === 'terminal'} />
          </View>
        ) : null}
        {shown === 'chat' ? <ChatView items={transcript.items} error={transcript.error} state={state} loading={transcript.loading} cwd={session?.projectPath} earlier={transcript.earlier} /> : null}
        {shown === 'terminal' && !running && !isTerminal ? <Text style={styles.ended}>This session is not running.</Text> : null}
      </View>
      {/* The bottom block rides on the keyboard; the body above shrinks. The
          terminal keys belong to the terminal: the chat has its own composer.
          When the session is not running, the card to resume it takes its place. */}
      {running && shown === 'terminal' ? <TerminalComposer sessionId={sessionId} send={send} placeholder={isTerminal ? 'Type a command…' : undefined} /> : null}
      {running && shown === 'chat' ? (
        <ChatComposer
          sessionId={sessionId}
          cli={session ? cliLabel(session) : 'Claude'}
          state={state}
          working={working}
          onOpenTerminal={() => onView('terminal')}
        />
      ) : null}
      {!running ? (
        <View style={shown === 'chat' && styles.chatColumn}>
          <NotRunning data={data} onResume={onResume} onFork={onFork} />
        </View>
      ) : null}
      <KeyboardSpacer />
    </>
  );
}

const styles = StyleSheet.create({
  diffBanner: { height: 44, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, backgroundColor: 'rgba(224,160,80,0.14)', paddingHorizontal: spacing.lg, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: 'rgba(224,160,80,0.28)' },
  diffBannerText: { flex: 1, color: colors.attention, fontSize: 14, fontWeight: '600' },
  body: { flex: 1 },
  // The terminal out of sight, behind the chat: drawn nowhere, taking no touches.
  behind: { ...StyleSheet.absoluteFill, opacity: 0 },
  ended: { color: colors.textDim, fontSize: 14, textAlign: 'center', padding: spacing.xl },
  chatColumn: { width: '100%', maxWidth: CHAT_COLUMN, alignSelf: 'center' },
});
