import { Stack, useLocalSearchParams } from 'expo-router';
import { Text, View } from 'react-native';

import { formStyles } from '@/components/form';
import { PullRequestDetail } from '@/components/pulls/PullRequestDetail';
import { useCapability } from '@/store/connection';

/**
 * An open pull request on a screen of its own, as GitHub's page shows it:
 * Conversation, Commits, Checks and Files changed (PullRequestDetail).
 */
export default function PullRequestScreen() {
  const { number, projectId, folder, remote, title } = useLocalSearchParams<{ number: string; projectId: string; folder: string; remote?: string; title?: string }>();
  const supported = useCapability('get-pull-request-conversation');
  const n = Number(number);
  if (!supported || !Number.isInteger(n) || !projectId || !folder) {
    return (
      <View style={formStyles.center}>
        <Stack.Screen options={{ title: `#${number}` }} />
        <Text style={formStyles.empty}>This pull request needs a newer Switchboard Evolution on the computer.</Text>
      </View>
    );
  }
  return (
    <>
      <Stack.Screen options={{ title: `#${n}` }} />
      <PullRequestDetail pullRef={{ projectId, folder, remote: remote || undefined, number: n }} title={title} />
    </>
  );
}
