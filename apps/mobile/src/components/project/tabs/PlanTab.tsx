import { useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text } from 'react-native';

import { usePullRefresh } from '@/components/PullRefresh';
import type { Project, ProjectPlan } from '@/projects/model';
import { colors, spacing } from '@/theme';
import { PlanSection } from '../PlanSection';
import { StartSheet, type StartRequest } from '../StartSheet';
import { useTabScroll } from '../useTabScroll';

/** The plan's phases and the todos, with the sheet that starts a session on one of them. */
export function PlanTab({ project, plan, loading, onChanged, onRefresh }: {
  project: Project;
  plan: (ProjectPlan & { error?: string }) | undefined;
  loading: boolean;
  onChanged: () => void;
  onRefresh: () => unknown;
}) {
  const pull = usePullRefresh(onRefresh);
  const scroll = useTabScroll(project.id, 'plan');
  const [start, setStart] = useState<StartRequest | null>(null);

  return (
    <>
      <ScrollView {...scroll} refreshControl={pull}>
        {plan && !plan.error ? (
          <PlanSection projectId={project.id} data={plan} onChanged={onChanged} onStart={setStart} />
        ) : plan?.error ? <Text style={styles.empty}>{plan.error}</Text>
          : loading ? <ActivityIndicator style={{ margin: spacing.lg }} color={colors.accent} /> : null}
      </ScrollView>
      <StartSheet project={project} start={start} onClose={() => setStart(null)} />
    </>
  );
}

const styles = StyleSheet.create({
  empty: { color: colors.textFaint, fontSize: 13, padding: spacing.lg },
});
