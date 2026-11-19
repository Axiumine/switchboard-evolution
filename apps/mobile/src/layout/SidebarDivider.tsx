import { useRootNavigationState } from 'expo-router';
import { useState } from 'react';
import { Dimensions, PanResponder, StyleSheet, View } from 'react-native';

import { hasSidebar, useHinge } from '@/layout/hinge';
import { clampSidebar, useSidebar } from '@/layout/sidebar';
import { colors } from '@/theme';

// The line between the sidebar and the workspace in a wide window (DeX, a
// tablet), over the screens. Dragging it makes the sidebar wider or narrower,
// as the desktop's sidebar edge does; the width is kept when it is let go.

/** How wide the line takes a touch or a mouse press, centred on it. */
const GRAB = 12;

export function SidebarDivider() {
  const hinge = useHinge();
  // Only beside the tabs: a screen that stands alone (pairing, before the tabs) has no sidebar.
  const besideTabs = useRootNavigationState()?.routes?.[0]?.name === '(tabs)';
  const [responder] = useState(() => {
    let start = 0;
    return PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: () => { start = useSidebar.getState().width; },
      onPanResponderMove: (_, gesture) => {
        useSidebar.getState().setWidth(clampSidebar(start + gesture.dx, Dimensions.get('window').width));
      },
      onPanResponderRelease: () => useSidebar.getState().save(),
      onPanResponderTerminate: () => useSidebar.getState().save(),
    });
  });
  if (!hinge || !hasSidebar() || !besideTabs) return null;
  return (
    <View
      {...responder.panHandlers}
      style={[styles.grab, { left: hinge.x + hinge.width / 2 - GRAB / 2 }]}
      accessibilityRole="adjustable"
      accessibilityLabel="Sidebar width"
      hitSlop={{ left: 4, right: 4 }}
    >
      <View style={[styles.line, { width: hinge.width }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  grab: { position: 'absolute', top: 0, bottom: 0, width: GRAB, alignItems: 'center' },
  line: { flex: 1, backgroundColor: colors.border },
});
