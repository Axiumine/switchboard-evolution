import { router, Stack, useLocalSearchParams } from 'expo-router';
import { Text, View } from 'react-native';

import { formStyles } from '@/components/form';
import { PullRequestWebPage } from '@/components/pulls/PullRequestWebPage';
import { inAppWebUrl } from '@/pulls/model';
import { openPullRequestWindow, windowActionLabel } from '@/pulls/web';
import { useCanOpenWindows } from '@/windows/open';

/**
 * A pull request's page on GitHub over the Pull Requests tab (the icon
 * "Open here" before Merge), as the desktop's panel: a sheet with the page,
 * which goes to a window of its own (or the whole screen) from its toolbar.
 */
export default function PullRequestWebScreen() {
  const { url, title } = useLocalSearchParams<{ url: string; title?: string }>();
  const page = inAppWebUrl(url);
  const canOpenWindows = useCanOpenWindows();
  const name = title || 'Pull request';
  if (!page) {
    return (
      <View style={formStyles.center}>
        <Stack.Screen options={{ title: name }} />
        <Text style={formStyles.empty}>This address cannot be shown here.</Text>
      </View>
    );
  }
  return (
    <>
      <Stack.Screen options={{ title: name }} />
      <PullRequestWebPage
        url={page}
        handleBack
        onClose={() => router.back()}
        onWindow={(current) => openPullRequestWindow(current, name, canOpenWindows, { replace: true })}
        windowLabel={windowActionLabel(canOpenWindows)}
      />
    </>
  );
}
