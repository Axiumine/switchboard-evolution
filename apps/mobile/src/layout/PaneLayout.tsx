import { type ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { paneMode, type PaneMode } from '@/layout/panes';
import { useWorkspaceWidth } from '@/layout/size';
import { colors, spacing } from '@/theme';

/** How this page lays out a list and a detail now. The page opens the detail itself in 'single'. */
export function usePaneMode(minWidth: number): PaneMode {
  return paneMode({ width: useWorkspaceWidth(), minWidth });
}

/**
 * A page with a list and a detail. Where the detail does not fit beside the
 * list only the list (the page opens the detail its own way: on a Surface Duo
 * that is the next screen of the carousel), otherwise the two side by side.
 */
export function PaneLayout({
  list, detail, placeholder, minWidth, listWidth,
}: {
  list: ReactNode;
  /** The detail, or null when nothing is picked. */
  detail: ReactNode;
  /** What the detail's place says while nothing is picked. */
  placeholder: string;
  /** From this workspace width up, the two side by side. */
  minWidth: number;
  /** The list's width beside the detail, from the workspace width. */
  listWidth: (width: number) => number;
}) {
  const mode = usePaneMode(minWidth);
  const width = useWorkspaceWidth();
  if (mode === 'single') return <View style={styles.fill}>{list}</View>;
  return (
    <View style={styles.split}>
      <View style={[styles.list, { width: listWidth(width) }]}>{list}</View>
      <View style={styles.fill}>{detail ?? <Text style={styles.placeholder}>{placeholder}</Text>}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  split: { flex: 1, flexDirection: 'row' },
  list: { borderRightWidth: StyleSheet.hairlineWidth, borderRightColor: colors.border },
  placeholder: { color: colors.textFaint, textAlign: 'center', marginTop: spacing.xl * 2, paddingHorizontal: spacing.lg },
});
