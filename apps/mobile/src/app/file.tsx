import { useLocalSearchParams } from 'expo-router';

import { FileView } from '@/components/files/FileView';

/** A project file: text and Markdown to read or edit, images to look at. `line` is the line a search result points at. */
export default function FileScreen() {
  const { root, path, line } = useLocalSearchParams<{ root: string; path: string; line?: string }>();
  const lineNumber = Number(line);
  return <FileView root={root} path={path} line={Number.isInteger(lineNumber) && lineNumber > 0 ? lineNumber : undefined} />;
}
