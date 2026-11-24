import { Stack, useLocalSearchParams } from 'expo-router';
import { Text, View } from 'react-native';

import { JobView } from '@/components/actions/JobView';
import { refFrom } from '@/components/actions/parts';
import { formStyles } from '@/components/form';
import { useCapability } from '@/store/connection';

/** A job of a workflow run, its steps and their logs, as GitHub's job page shows them (JobView). */
export default function ActionsJobScreen() {
  const params = useLocalSearchParams<{ id: string; runId?: string; projectId: string; folder: string; remote?: string; title?: string }>();
  const supported = useCapability('get-actions-job');
  const ref = refFrom(params);
  const id = Number(params.id);
  const runId = Number(params.runId);
  if (!supported || !ref || !Number.isSafeInteger(id) || id <= 0) {
    return (
      <View style={formStyles.center}>
        <Stack.Screen options={{ title: 'Job' }} />
        <Text style={formStyles.empty}>This job needs a newer Switchboard Evolution on the computer.</Text>
      </View>
    );
  }
  return <JobView actionsRef={ref} jobId={id} runId={Number.isSafeInteger(runId) && runId > 0 ? runId : null} title={params.title} />;
}
