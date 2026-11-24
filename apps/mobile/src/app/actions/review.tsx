import { Stack, useLocalSearchParams } from 'expo-router';
import { Text, View } from 'react-native';

import { ReviewForm } from '@/components/actions/forms';
import { refFrom } from '@/components/actions/parts';
import { formStyles } from '@/components/form';
import { useCapability } from '@/store/connection';

/** Review the deployments a run waits for: Approve and deploy, or Reject (ReviewForm). */
export default function ActionsReviewScreen() {
  const params = useLocalSearchParams<{ runId: string; projectId: string; folder: string; remote?: string }>();
  const editable = useCapability('edit-actions');
  const ref = refFrom(params);
  const runId = Number(params.runId);
  if (!editable || !ref || !Number.isSafeInteger(runId) || runId <= 0) {
    return (
      <View style={formStyles.center}>
        <Stack.Screen options={{ title: 'Review deployments' }} />
        <Text style={formStyles.empty}>Reviewing deployments from the phone needs a newer Switchboard Evolution on the computer.</Text>
      </View>
    );
  }
  return <ReviewForm actionsRef={ref} runId={runId} />;
}
