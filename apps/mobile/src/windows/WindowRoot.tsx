import '@/remote/random';

import { QueryClientProvider } from '@tanstack/react-query';
import { StatusBar } from 'expo-status-bar';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { KeyboardProvider } from 'react-native-keyboard-controller';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import ProcessesScreen from '@/app/(tabs)/processes';
import StatsScreen from '@/app/(tabs)/stats';
import { CommandsWindow } from '@/components/composer/CommandsWindow';
import { NoteEditor } from '@/components/notes/NoteEditor';
import { PullRequestWebPage } from '@/components/pulls/PullRequestWebPage';
import { useProject } from '@/projects/queries';
import { queryClient } from '@/remote/query';
import { colors } from '@/theme';
import { ProjectWindow } from '@/windows/ProjectWindow';
import { parseWindowSpec, windowTitle, type WindowSpec, type WindowTab } from '@/windows/window-spec';
import { WindowNavigation } from '@/windows/WindowNavigation';
import { WindowTabs } from '@/windows/WindowTabs';

/**
 * The root of a window of its own (modules/switchboard-window's
 * WindowActivity), registered as "window" beside Expo Router's "main". It
 * runs on the same JavaScript and the same connection as the main window,
 * so it shares its queries and live state, and costs only its views.
 */
export function WindowRoot({ window }: { window?: string }) {
  const spec = parseWindowSpec(window);
  return (
    <GestureHandlerRootView style={styles.fill}>
      <SafeAreaProvider>
        <KeyboardProvider>
          <QueryClientProvider client={queryClient}>
            <StatusBar style="light" />
            {spec ? <Window spec={spec} /> : <Text style={styles.empty}>Nothing to show here.</Text>}
          </QueryClientProvider>
        </KeyboardProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

function Window({ spec }: { spec: WindowSpec }) {
  const { project } = useProject(spec.kind === 'project' || spec.kind === 'note' ? spec.projectId : undefined);
  // A project's window can change tab in place: the one it was opened with is where it starts.
  const [tab, setTab] = useState<WindowTab>(spec.kind === 'project' ? spec.tab : 'overview');
  const shown: WindowSpec = spec.kind === 'project' ? { ...spec, tab } : spec;
  return (
    <WindowNavigation
      title={windowTitle(shown, project?.name)}
      tabs={spec.kind === 'project' ? <WindowTabs active={tab} onChange={setTab} /> : undefined}
    >
      <View style={styles.fill}>
        {spec.kind === 'project' ? <ProjectWindow projectId={spec.projectId} tab={tab} onTab={setTab} /> : null}
        {spec.kind === 'note' ? <NoteEditor projectId={spec.projectId} /> : null}
        {spec.kind === 'stats' ? <StatsScreen /> : null}
        {spec.kind === 'processes' ? <ProcessesScreen /> : null}
        {spec.kind === 'web' ? <PullRequestWebPage url={spec.url} /> : null}
        {spec.kind === 'commands' ? <CommandsWindow sessionId={spec.sessionId} runtime={spec.runtime} type={spec.type} /> : null}
      </View>
    </WindowNavigation>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: colors.background },
  empty: { flex: 1, color: colors.textFaint, textAlign: 'center', marginTop: 48, backgroundColor: colors.background },
});
