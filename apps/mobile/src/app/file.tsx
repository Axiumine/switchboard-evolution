import { useLocalSearchParams } from 'expo-router';

import { FileView } from '@/components/files/FileView';

/** A project file: text and Markdown to read or edit, images to look at. */
export default function FileScreen() {
  const { root, path } = useLocalSearchParams<{ root: string; path: string }>();
  return <FileView root={root} path={path} />;
}
