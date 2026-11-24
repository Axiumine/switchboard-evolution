import { Stack, useLocalSearchParams } from 'expo-router';
import { Text, View } from 'react-native';

import { WorkflowFileView } from '@/components/actions/manage';
import { refFrom } from '@/components/actions/parts';
import { formStyles } from '@/components/form';
import { useCapability } from '@/store/connection';

/** A workflow file at a run's commit or at a branch (WorkflowFileView). */
export default function ActionsFileScreen() {
  const params = useLocalSearchParams<{ path: string; ref: string; title?: string; projectId: string; folder: string; remote?: string }>();
  const supported = useCapability('get-actions-workflow-file');
  const ref = refFrom(params);
  if (!supported || !ref || !params.path || !params.ref) {
    return (
      <View style={formStyles.center}>
        <Stack.Screen options={{ title: 'Workflow file' }} />
        <Text style={formStyles.empty}>This workflow file needs a newer Switchboard Evolution on the computer.</Text>
      </View>
    );
  }
  return <WorkflowFileView actionsRef={ref} path={params.path} gitRef={params.ref} title={params.title} />;
}
