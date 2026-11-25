import { useLocalSearchParams } from 'expo-router';
import { useMemo } from 'react';

import { GitGraphView } from '@/components/git/GitGraphView';

/** The Git Graph of one repository of a project, on its own page: its title and actions sit in the header. */
export default function GraphScreen() {
  const { projectId, folder } = useLocalSearchParams<{ projectId: string; folder: string }>();
  const folders = useMemo(() => [folder], [folder]);
  return <GitGraphView projectId={projectId} folders={folders} />;
}
