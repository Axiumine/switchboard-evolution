import { Alert, Platform } from 'react-native';

import { HeaderButton } from '@/components/HeaderButton';
import { downloadSupported, shareProjectFile, type KnownContent } from '@/files/download';
import { useCapability } from '@/store/connection';

/**
 * The share button of a project file. `known` is the content already here
 * (text, an image), or a function that gets it when the button is pressed (a
 * file being edited); any other file comes down from the computer first, which
 * an older desktop cannot do. Nothing where this build cannot share.
 */
export function ShareButton({ root, path, name, known }: { root: string; path: string; name: string; known?: KnownContent | (() => Promise<KnownContent>) }) {
  const canDownload = useCapability('read-project-file-chunk');
  if (!downloadSupported()) return null;
  const share = () => {
    if (!known && !canDownload) {
      Alert.alert('Share', 'Sharing this kind of file needs a newer Switchboard Evolution on the computer. Update it there, then try again.');
      return;
    }
    Promise.resolve(typeof known === 'function' ? known() : known)
      .then((content) => shareProjectFile(root, path, name, content))
      .catch((err: any) => Alert.alert(`Could not share “${name}”`, err?.message || String(err)));
  };
  return <HeaderButton icon={Platform.OS === 'ios' ? 'share-outline' : 'share-social-outline'} accessibilityLabel={`Share ${name}`} onPress={share} />;
}
