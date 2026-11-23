import { Stack, useLocalSearchParams } from 'expo-router';
import { Text, View } from 'react-native';

import { formStyles } from '@/components/form';
import { PullRequestWebPage } from '@/components/pulls/PullRequestWebPage';
import { inAppWebUrl } from '@/pulls/model';

/**
 * A pull request's page on GitHub on a screen of its own: "Open in a window"
 * where windows of their own are not available (a phone, a Duo).
 */
export default function PullRequestWebFullScreen() {
  const { url, title } = useLocalSearchParams<{ url: string; title?: string }>();
  const page = inAppWebUrl(url);
  const name = title || 'Pull request';
  return (
    <>
      <Stack.Screen options={{ title: name }} />
      {page ? <PullRequestWebPage url={page} handleBack /> : (
        <View style={formStyles.center}>
          <Text style={formStyles.empty}>This address cannot be shown here.</Text>
        </View>
      )}
    </>
  );
}
