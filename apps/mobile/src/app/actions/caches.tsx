import { Stack, useLocalSearchParams } from 'expo-router';
import { Text, View } from 'react-native';

import { CachesView } from '@/components/actions/manage';
import { refFrom } from '@/components/actions/parts';
import { formStyles } from '@/components/form';
import { useCapability } from '@/store/connection';

/** Management in the Actions view: Caches (CachesView). */
export default function ActionsCachesScreen() {
  const params = useLocalSearchParams<{ projectId: string; folder: string; remote?: string }>();
  const supported = useCapability('get-actions-caches');
  const ref = refFrom(params);
  if (!supported || !ref) {
    return (
      <View style={formStyles.center}>
        <Stack.Screen options={{ title: 'Caches' }} />
        <Text style={formStyles.empty}>Caches on the phone needs a newer Switchboard Evolution on the computer.</Text>
      </View>
    );
  }
  return <CachesView actionsRef={ref} />;
}
