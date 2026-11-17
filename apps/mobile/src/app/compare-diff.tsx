import { Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import { StepDiffPager } from '@/components/git/StepDiffPager';
import { splitParam, useCompareSteps } from '@/git/compare-queries';
import { colors, spacing } from '@/theme';

/**
 * One file of a comparison, a page per step. It reads the steps from the same
 * queries as the compare screen, so they are already in the cache.
 */
export default function CompareDiffScreen() {
  const { projectId, folder, hashes, labels: labelsParam, path, step: stepParam } = useLocalSearchParams<{
    projectId: string; folder: string; hashes: string; labels: string; path: string; step?: string;
  }>();
  const labels = splitParam(labelsParam);
  const { steps, matrix, loading, error } = useCompareSteps(projectId, folder, hashes);
  const [step, setStep] = useState(Math.max(0, parseInt(stepParam || '0', 10) || 0));
  const row = matrix.find((item) => item.path === path);

  let content;
  if (loading) content = <ActivityIndicator style={styles.spinner} color={colors.accent} />;
  else if (error) content = <Text style={[styles.message, styles.error]}>{error}</Text>;
  else if (!steps.length || !row) content = <Text style={styles.message}>This file is not in the comparison.</Text>;
  else content = <StepDiffPager projectId={projectId} folder={folder} path={path} steps={steps} labels={labels} cells={row.cells} step={step} onStep={setStep} />;

  return (
    <View style={styles.screen}>
      <Stack.Screen options={{ title: (path || '').split('/').pop() || 'Compare' }} />
      {content}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  spinner: { margin: spacing.xl },
  message: { color: colors.textFaint, textAlign: 'center', marginTop: spacing.xl, paddingHorizontal: spacing.lg },
  error: { color: colors.danger },
});
