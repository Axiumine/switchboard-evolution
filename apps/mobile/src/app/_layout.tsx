import '@/remote/random';

import { QueryClientProvider } from '@tanstack/react-query';
import { StatusBar } from 'expo-status-bar';
import { useEffect, type ReactNode } from 'react';
import { AppState, StyleSheet, View } from 'react-native';
import { KeyboardProvider, useKeyboardState } from 'react-native-keyboard-controller';

import { AttentionToast } from '@/components/AttentionToast';
import { DownloadBar } from '@/components/files/DownloadBar';
import { NoteFloating } from '@/components/notes/NoteFloating';
import { SyncBar } from '@/components/SyncBar';
import { useDownload } from '@/files/download';
import { AppStack as Stack } from '@/layout/AppStack';
import { BottomInsetTaken } from '@/layout/bottomInset';
import { SidebarDivider } from '@/layout/SidebarDivider';
import { isDuoModel } from '@/layout/hinge';
import { queryClient } from '@/remote/query';
import { useConnection } from '@/store/connection';
import { useDonateUsage } from '@/store/donate';
import { colors } from '@/theme';

export default function RootLayout() {
  // The time of use that brings back the donation box of the Projects tab.
  useDonateUsage();
  useEffect(() => {
    useConnection.getState().init();
    // iOS drops the socket in the background; reconnect as soon as the app is back.
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') useConnection.getState().reconnect();
      useConnection.getState().setForeground(state === 'active');
    });
    return () => subscription.remove();
  }, []);

  return (
    // Keyboard height and movement, for screens that keep a field above the keyboard.
    <KeyboardProvider>
      <QueryClientProvider client={queryClient}>
        <StatusBar style="light" />
        <WithDownloadBar>
          <Stack
            screenOptions={{
              headerStyle: { backgroundColor: colors.surface },
              headerTintColor: colors.text,
              headerTitleStyle: { color: colors.text },
              contentStyle: { backgroundColor: colors.background },
            }}
          >
            <Stack.Screen name="(tabs)" options={{ headerShown: false, title: 'Back' }} />
            <Stack.Screen name="pair" options={{ title: 'Pair with a computer' }} />
            <Stack.Screen name="task-log" options={{ title: 'Task' }} />
            <Stack.Screen name="new" options={{ title: 'New session' }} />
            <Stack.Screen name="session/[id]" options={{ title: 'Session' }} />
            <Stack.Screen name="project/[id]/index" options={{ title: 'Project' }} />
            <Stack.Screen name="folders" options={{ title: 'Choose a folder' }} />
            <Stack.Screen name="files" options={{ title: 'Files' }} />
            <Stack.Screen name="file" options={{ title: 'File' }} />
            <Stack.Screen name="timeline" options={{ title: 'Timeline' }} />
            <Stack.Screen name="file-diff" options={{ title: 'Change' }} />
            <Stack.Screen name="schedule" options={{ title: 'Schedule' }} />
            <Stack.Screen name="prompt-improver" options={{ title: 'Prompt improver' }} />
            <Stack.Screen name="prompt-improver-template" options={{ title: 'Improver prompt' }} />
            <Stack.Screen name="git" options={{ title: 'Git' }} />
            <Stack.Screen name="diff" options={{ title: 'Diff' }} />
            <Stack.Screen name="graph" options={{ title: 'Git Graph' }} />
            <Stack.Screen name="knowledge/symbol" options={{ title: 'Symbol' }} />
            <Stack.Screen name="compare" options={{ title: 'Compare' }} />
            {/* On a Duo the diff is the other screen of the pair: it must be there at once, not slide in over the table. */}
            <Stack.Screen name="compare-diff" options={{ title: 'Compare', ...(isDuoModel() ? { animation: 'none' as const } : {}) }} />
            <Stack.Screen name="worktrees/new" options={{ title: 'New worktree' }} />
            <Stack.Screen name="worktrees/remove" options={{ title: 'Remove worktree' }} />
            <Stack.Screen name="worktrees/merged" options={{ title: 'Remove merged' }} />
            <Stack.Screen name="worktrees/settings" options={{ title: 'Worktree settings' }} />
            <Stack.Screen name="worktrees/folder" options={{ title: 'Worktree folder' }} />
            <Stack.Screen name="worktrees/changes" options={{ title: 'Uncommitted and unpushed' }} />
            <Stack.Screen name="pulls/merge" options={{ title: 'Merge pull request' }} />
            <Stack.Screen name="pulls/[number]" options={{ title: 'Pull request' }} />
            <Stack.Screen name="pulls/edit" options={{ title: 'Comment' }} />
            <Stack.Screen name="pulls/base" options={{ title: 'Change base' }} />
            <Stack.Screen name="pulls/review" options={{ title: 'Review' }} />
            <Stack.Screen name="pulls/side" options={{ title: 'Sidebar' }} />
            {/* A pull request's page on GitHub: over the tab (Open here), or on a screen of its own. */}
            <Stack.Screen name="pulls/web" options={{ title: 'Pull request', presentation: 'modal' }} />
            <Stack.Screen name="pulls/web-full" options={{ title: 'Pull request' }} />
            {/* GitHub Actions: a run, a job, Run workflow, a review, Management, a workflow file. */}
            <Stack.Screen name="actions/run/[id]" options={{ title: 'Workflow run' }} />
            <Stack.Screen name="actions/job/[id]" options={{ title: 'Job' }} />
            <Stack.Screen name="actions/dispatch" options={{ title: 'Run workflow' }} />
            <Stack.Screen name="actions/review" options={{ title: 'Review deployments' }} />
            <Stack.Screen name="actions/caches" options={{ title: 'Caches' }} />
            <Stack.Screen name="actions/runners" options={{ title: 'Runners' }} />
            <Stack.Screen name="actions/deployments" options={{ title: 'Deployments' }} />
            <Stack.Screen name="actions/file" options={{ title: 'Workflow file' }} />
          </Stack>
          <SidebarDivider />
        </WithDownloadBar>
        <AttentionToast />
        <SyncBar />
        {/* Over every screen, and kept through navigation. */}
        <NoteFloating />
      </QueryClientProvider>
    </KeyboardProvider>
  );
}

/**
 * The screens, and under them the download bar while a file comes down from
 * the computer or goes up to it, whatever screen is open. Not while typing: the keyboard covers
 * that part of the window, and the composer must sit right on it.
 */
function WithDownloadBar({ children }: { children: ReactNode }) {
  const downloading = useDownload((s) => !!s.current);
  const typing = useKeyboardState((s) => s.isVisible);
  const shown = downloading && !typing;
  return (
    <View style={styles.screens}>
      <BottomInsetTaken taken={shown}><View style={styles.screens}>{children}</View></BottomInsetTaken>
      {shown ? <DownloadBar /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  screens: { flex: 1, backgroundColor: colors.background },
});
