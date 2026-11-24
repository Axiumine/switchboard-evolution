import { Stack, useLocalSearchParams } from 'expo-router';
import { Text, View } from 'react-native';

import { DeploymentsView } from '@/components/actions/manage';
import { refFrom } from '@/components/actions/parts';
import { formStyles } from '@/components/form';
import { useCapability } from '@/store/connection';

/** Management in the Actions view: Deployments (DeploymentsView). */
export default function ActionsDeploymentsScreen() {
  const params = useLocalSearchParams<{ projectId: string; folder: string; remote?: string }>();
  const supported = useCapability('get-actions-deployments');
  const ref = refFrom(params);
  if (!supported || !ref) {
    return (
      <View style={formStyles.center}>
        <Stack.Screen options={{ title: 'Deployments' }} />
        <Text style={formStyles.empty}>Deployments on the phone needs a newer Switchboard Evolution on the computer.</Text>
      </View>
    );
  }
  return <DeploymentsView actionsRef={ref} />;
}
