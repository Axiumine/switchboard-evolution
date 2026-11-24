import { Stack, useLocalSearchParams } from 'expo-router';
import { Text, View } from 'react-native';

import { refFrom } from '@/components/actions/parts';
import { RunView } from '@/components/actions/RunView';
import { formStyles } from '@/components/form';
import { useCapability } from '@/store/connection';

/** A workflow run on a screen of its own, as GitHub's summary page shows it (RunView). */
export default function ActionsRunScreen() {
  const params = useLocalSearchParams<{ id: string; projectId: string; folder: string; remote?: string; title?: string }>();
  const supported = useCapability('get-actions-run');
  const ref = refFrom(params);
  const id = Number(params.id);
  if (!supported || !ref || !Number.isSafeInteger(id) || id <= 0) {
    return (
      <View style={formStyles.center}>
        <Stack.Screen options={{ title: 'Workflow run' }} />
        <Text style={formStyles.empty}>This workflow run needs a newer Switchboard Evolution on the computer.</Text>
      </View>
    );
  }
  return <RunView actionsRef={ref} runId={id} title={params.title} />;
}
