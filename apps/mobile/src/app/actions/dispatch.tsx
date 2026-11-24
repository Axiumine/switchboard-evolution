import { Stack, useLocalSearchParams } from 'expo-router';
import { Text, View } from 'react-native';

import { DispatchForm } from '@/components/actions/forms';
import { refFrom } from '@/components/actions/parts';
import { formStyles } from '@/components/form';
import { useCapability } from '@/store/connection';

/** Run workflow: the branch or tag, the workflow's inputs, then the run it started (DispatchForm). */
export default function ActionsDispatchScreen() {
  const params = useLocalSearchParams<{ workflowId: string; name?: string; projectId: string; folder: string; remote?: string }>();
  const editable = useCapability('edit-actions');
  const ref = refFrom(params);
  const workflowId = Number(params.workflowId);
  if (!editable || !ref || !Number.isSafeInteger(workflowId) || workflowId <= 0) {
    return (
      <View style={formStyles.center}>
        <Stack.Screen options={{ title: 'Run workflow' }} />
        <Text style={formStyles.empty}>Running a workflow from the phone needs a newer Switchboard Evolution on the computer.</Text>
      </View>
    );
  }
  return <DispatchForm actionsRef={ref} workflowId={workflowId} name={params.name || 'workflow'} />;
}
