import { useEffect, useState } from 'react';
import { PanResponder, StyleSheet, Text, View } from 'react-native';
import { useKeyboardState } from 'react-native-keyboard-controller';

import { HeaderButton } from '@/components/HeaderButton';
import { NoteEditor } from '@/components/notes/NoteEditor';
import { useWindowInsets } from '@/layout/bottomInset';
import { useAreaWidth, useWindowHeight } from '@/layout/size';
import { clampRect, moveRect, resizeRect, startRect, type Bounds, type Rect } from '@/notes/model';
import { closeNote, useNotePanel } from '@/notes/panel';
import { useProject } from '@/projects/queries';
import { colors, spacing } from '@/theme';
import { openWindow, useCanOpenWindows } from '@/windows/open';

/**
 * The note panel, once at the app's root so it floats over every screen and
 * stays through navigation. Dragged by its title bar, resized from the corner
 * at its bottom right, always inside the screen (and above the keyboard); where
 * it was put is what it comes back to, after a restart too (notes/panel.ts).
 * One note at a time: another project's replaces this one.
 */
export function NoteFloating() {
  const projectId = useNotePanel((s) => s.projectId);
  if (!projectId) return null;
  return <Panel key={projectId} projectId={projectId} />;
}

function Panel({ projectId }: { projectId: string }) {
  const { project } = useProject(projectId);
  const canPopOut = useCanOpenWindows();
  const stored = useNotePanel((s) => s.rect);
  const setRect = useNotePanel((s) => s.setRect);
  const windowWidth = useAreaWidth();
  const windowHeight = useWindowHeight();
  const insets = useWindowInsets();
  const keyboard = useKeyboardState((s) => (s.isVisible ? s.height : 0));
  const bounds: Bounds = { left: insets.left, top: insets.top, right: windowWidth - insets.right, bottom: windowHeight - Math.max(insets.bottom, keyboard) };
  // While a finger moves or resizes it, the rect is that of the gesture; the stored one only changes when it is let go.
  const [live, setLive] = useState<Rect | null>(null);
  const rect = live ?? clampRect(stored ?? startRect(bounds), bounds);

  // What the gestures (made once) read when a finger moves: the screen and the rect as they are now.
  const [latest] = useState(() => ({ rect, bounds, setRect }));
  useEffect(() => { Object.assign(latest, { rect, bounds, setRect }); });
  const [gestures] = useState(() => {
    const make = (change: (start: Rect, dx: number, dy: number, bounds: Bounds) => Rect) => {
      let start: Rect | null = null;
      const end = (g: { dx: number; dy: number }) => {
        if (start) latest.setRect(change(start, g.dx, g.dy, latest.bounds));
        start = null;
        setLive(null);
      };
      return PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderTerminationRequest: () => false,
        onPanResponderGrant: () => { start = latest.rect; },
        onPanResponderMove: (_, g) => { if (start) setLive(change(start, g.dx, g.dy, latest.bounds)); },
        onPanResponderRelease: (_, g) => end(g),
        onPanResponderTerminate: (_, g) => end(g),
      });
    };
    return { drag: make(moveRect), resize: make(resizeRect) };
  });

  const popOut = async () => {
    // Saved and closed first: the window then reads the file as saved.
    if (await closeNote()) openWindow({ kind: 'note', projectId }, project?.name);
  };

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      <View style={[styles.panel, { left: rect.x, top: rect.y, width: rect.width, height: rect.height }]}>
        <View style={styles.titleBar}>
          <View {...gestures.drag.panHandlers} style={styles.title} accessibilityLabel="Move the note">
            <Text style={styles.titleText} numberOfLines={1}>{project?.name ? `${project.name} · Note` : 'Note'}</Text>
          </View>
          {canPopOut ? <HeaderButton icon="open-outline" accessibilityLabel="Open in a window of its own" onPress={popOut} /> : null}
          <HeaderButton icon="close" accessibilityLabel="Close note" onPress={() => { closeNote(); }} />
        </View>
        <NoteEditor projectId={projectId} floating />
        <View {...gestures.resize.panHandlers} style={styles.corner} accessibilityLabel="Resize the note">
          <View style={styles.cornerMark} />
        </View>
      </View>
    </View>
  );
}

const CORNER = 32;

const styles = StyleSheet.create({
  panel: {
    position: 'absolute', overflow: 'hidden', borderRadius: 12, backgroundColor: colors.background,
    borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.18)', zIndex: 30, elevation: 30,
    shadowColor: '#000', shadowOpacity: 0.4, shadowRadius: 12, shadowOffset: { width: 0, height: 4 },
  },
  titleBar: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingRight: spacing.sm, backgroundColor: colors.raised },
  // The part of the bar that moves the panel: the buttons beside it are not under its finger.
  title: { flex: 1, minHeight: 44, justifyContent: 'center', paddingHorizontal: spacing.md },
  titleText: { color: colors.text, fontSize: 14, fontWeight: '600' },
  corner: { position: 'absolute', right: 0, bottom: 0, width: CORNER, height: CORNER, alignItems: 'flex-end', justifyContent: 'flex-end', padding: 6 },
  cornerMark: { width: 12, height: 12, borderRightWidth: 2, borderBottomWidth: 2, borderColor: colors.textDim },
});
