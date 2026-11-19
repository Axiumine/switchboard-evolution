import '@/remote/random';

import { QueryClientProvider } from '@tanstack/react-query';
import { StatusBar } from 'expo-status-bar';
import { StyleSheet, Text, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { KeyboardProvider } from 'react-native-keyboard-controller';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import ProcessesScreen from '@/app/(tabs)/processes';
import StatsScreen from '@/app/(tabs)/stats';
import { useProject } from '@/projects/queries';
import { queryClient } from '@/remote/query';
import { colors } from '@/theme';
import { ProjectWindow } from '@/windows/ProjectWindow';
import { parseWindowSpec, windowTitle, type WindowSpec } from '@/windows/window-spec';
import { WindowNavigation } from '@/windows/WindowNavigation';

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
  const { project } = useProject(spec.kind === 'project' ? spec.projectId : undefined);
  return (
    <WindowNavigation title={windowTitle(spec, project?.name)}>
      <View style={styles.fill}>
        {spec.kind === 'project' ? <ProjectWindow projectId={spec.projectId} tab={spec.tab} /> : null}
        {spec.kind === 'stats' ? <StatsScreen /> : null}
        {spec.kind === 'processes' ? <ProcessesScreen /> : null}
      </View>
    </WindowNavigation>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: colors.background },
  empty: { flex: 1, color: colors.textFaint, textAlign: 'center', marginTop: 48, backgroundColor: colors.background },
});
