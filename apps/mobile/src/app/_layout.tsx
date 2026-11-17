import '@/remote/random';

import { QueryClientProvider } from '@tanstack/react-query';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { AppState } from 'react-native';
import { KeyboardProvider } from 'react-native-keyboard-controller';

import { AttentionToast } from '@/components/AttentionToast';
import { AppStack as Stack } from '@/layout/AppStack';
import { queryClient } from '@/remote/query';
import { useConnection } from '@/store/connection';
import { colors } from '@/theme';

export default function RootLayout() {
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
          <Stack.Screen name="git" options={{ title: 'Git' }} />
          <Stack.Screen name="diff" options={{ title: 'Diff' }} />
          <Stack.Screen name="graph" options={{ title: 'Git Graph' }} />
          <Stack.Screen name="compare" options={{ title: 'Compare' }} />
          <Stack.Screen name="compare-diff" options={{ title: 'Compare' }} />
          <Stack.Screen name="worktrees/new" options={{ title: 'New worktree' }} />
          <Stack.Screen name="worktrees/remove" options={{ title: 'Remove worktree' }} />
          <Stack.Screen name="worktrees/merged" options={{ title: 'Remove merged' }} />
          <Stack.Screen name="worktrees/settings" options={{ title: 'Worktree settings' }} />
          <Stack.Screen name="worktrees/folder" options={{ title: 'Worktree folder' }} />
        </Stack>
        <AttentionToast />
      </QueryClientProvider>
    </KeyboardProvider>
  );
}
