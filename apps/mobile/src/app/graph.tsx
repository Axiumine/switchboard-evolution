import { useLocalSearchParams } from 'expo-router';

import { GitGraphView } from '@/components/git/GitGraphView';

/** The Git Graph of one repository of a project, on its own page: its title and actions sit in the header. */
export default function GraphScreen() {
  const { projectId, folder } = useLocalSearchParams<{ projectId: string; folder: string }>();
  return <GitGraphView projectId={projectId} folder={folder} />;
}
