import { Stack, useLocalSearchParams } from 'expo-router';
import { Text, View } from 'react-native';

import { RunnersView } from '@/components/actions/manage';
import { refFrom } from '@/components/actions/parts';
import { formStyles } from '@/components/form';
import { useCapability } from '@/store/connection';

/** Management in the Actions view: Runners (RunnersView). */
export default function ActionsRunnersScreen() {
  const params = useLocalSearchParams<{ projectId: string; folder: string; remote?: string }>();
  const supported = useCapability('get-actions-runners');
  const ref = refFrom(params);
  if (!supported || !ref) {
    return (
      <View style={formStyles.center}>
        <Stack.Screen options={{ title: 'Runners' }} />
        <Text style={formStyles.empty}>Runners on the phone needs a newer Switchboard Evolution on the computer.</Text>
      </View>
    );
  }
  return <RunnersView actionsRef={ref} />;
}
