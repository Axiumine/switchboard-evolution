import Ionicons from '@expo/vector-icons/Ionicons';
import { createContext, useCallback, useContext, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Animated, PanResponder, StyleSheet, View, type AccessibilityActionEvent, type StyleProp, type ViewProps, type ViewStyle } from 'react-native';

import { moveId } from '@/shared/vendor/pinned-order';
import { colors } from '@/theme';

// Rows put in order by dragging them among the others of their group: the
// Starred section of the Projects tab, a project's pinned sessions. A row
// moves by its handle (≡), so a tap still opens it and a long press still
// shows its actions; while it moves the list does not scroll, the row follows
// the finger and a line shows where it will land, as on the desktop.

/** The row being dragged, and where it lands: `to` is its index once moved (pinned-order.js moveId). */
type Drag = { group: string; id: string; rowKey: string; ids: string[]; to: number };
type Frame = { y: number; h: number };
/** What a row's view is asked: where it is on screen. */
type Measurable = { measureInWindow: (done: (x: number, y: number, width: number, height: number) => void) => void };

type Controller = {
  dy: Animated.Value;
  register: (group: string, id: string, view: Measurable | null) => void;
  start: (group: string, id: string, rowKey: string, ids: string[]) => void;
  move: (dy: number) => void;
  end: (commit: boolean) => void;
  step: (group: string, id: string, ids: string[], by: number) => void;
};

// The controller never changes; the drag does, on every move that changes where the row lands.
const ControllerContext = createContext<Controller | null>(null);
const DragContext = createContext<Drag | null>(null);

/**
 * Where rows can be dragged into a new order. `onOrder` gets a group's ids in
 * their new order; `onDragChange` says when a drag starts and ends, so the
 * list can stop scrolling meanwhile.
 */
export function ReorderProvider({ onOrder, onDragChange, children }: {
  onOrder: (group: string, ids: string[]) => void;
  onDragChange?: (dragging: boolean) => void;
  children: ReactNode;
}) {
  const [drag, setDrag] = useState<Drag | null>(null);
  const current = useRef<Drag | null>(null);
  const views = useRef(new Map<string, Measurable>());
  const frames = useRef(new Map<string, Frame>());
  const [dy] = useState(() => new Animated.Value(0));
  const latest = useRef({ onOrder, onDragChange });
  useLayoutEffect(() => { latest.current = { onOrder, onDragChange }; });

  const update = useCallback((next: Drag | null) => {
    current.current = next;
    setDrag(next);
  }, []);

  const controller = useMemo<Controller>(() => ({
    dy,
    register: (group, id, view) => {
      const key = `${group}\n${id}`;
      if (view) views.current.set(key, view); else views.current.delete(key);
    },
    start: (group, id, rowKey, ids) => {
      dy.setValue(0);
      frames.current.clear();
      // Where each row of the group is on screen now: the list stays still until the drop.
      for (const other of ids) {
        views.current.get(`${group}\n${other}`)?.measureInWindow((_x, y, _w, h) => { frames.current.set(other, { y, h }); });
      }
      update({ group, id, rowKey, ids, to: ids.indexOf(id) });
      latest.current.onDragChange?.(true);
    },
    move: (moved) => {
      const d = current.current;
      if (!d) return;
      dy.setValue(moved);
      const own = frames.current.get(d.id);
      if (!own) return;
      const middle = own.y + own.h / 2 + moved;
      const from = d.ids.indexOf(d.id);
      // Its new index: how many of the others sit above where it is now (one not on screen keeps its side).
      const to = d.ids.filter((id) => id !== d.id).filter((id) => {
        const frame = frames.current.get(id);
        return frame ? frame.y + frame.h / 2 < middle : d.ids.indexOf(id) < from;
      }).length;
      if (to !== d.to) update({ ...d, to });
    },
    end: (commit) => {
      const d = current.current;
      update(null);
      latest.current.onDragChange?.(false);
      if (commit && d && d.to !== d.ids.indexOf(d.id)) latest.current.onOrder(d.group, moveId(d.ids, d.id, d.to));
    },
    step: (group, id, ids, by) => {
      const next = moveId(ids, id, ids.indexOf(id) + by);
      if (next !== ids) latest.current.onOrder(group, next);
    },
  }), [dy, update]);

  return (
    <ControllerContext.Provider value={controller}>
      <DragContext.Provider value={drag}>{children}</DragContext.Provider>
    </ControllerContext.Provider>
  );
}

/** Where the line goes on a row while another one is dragged: above it, below it, or nowhere. */
function lineFor(drag: Drag | null, group: string, id: string): 'before' | 'after' | null {
  if (!drag || drag.group !== group || drag.id === id) return null;
  const from = drag.ids.indexOf(drag.id);
  if (drag.to === from) return null;
  const others = drag.ids.filter((other) => other !== drag.id);
  if (drag.to < from) return others[drag.to] === id ? 'before' : null;
  return others[drag.to - 1] === id ? 'after' : null;
}

type ItemHandle = { handlers: ViewProps; onAction: (event: AccessibilityActionEvent) => void; first: boolean; last: boolean };
const ItemContext = createContext<ItemHandle | null>(null);

/**
 * One row of a group (`ids`, in their order on screen). `rowKey` is the
 * list's key for it, so the list's cell can rise above the others (ReorderCell).
 * Its handle is a ReorderHandle anywhere inside it.
 */
export function ReorderItem({ group, id, ids, rowKey, style, children }: {
  group: string; id: string; ids: string[]; rowKey: string; style?: StyleProp<ViewStyle>; children: ReactNode;
}) {
  const controller = useContext(ControllerContext);
  const drag = useContext(DragContext);
  // The list's rows are built again as sessions change state: the same ids keep the same responder, even mid-drag.
  const idsKey = ids.join('\n');

  const handle = useMemo<ItemHandle>(() => {
    const order = idsKey.split('\n');
    const pan = PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      // Once moving, the row keeps the touch: the list may not take it to scroll.
      onPanResponderTerminationRequest: () => false,
      onShouldBlockNativeResponder: () => true,
      onPanResponderGrant: () => { controller?.start(group, id, rowKey, order); },
      onPanResponderMove: (_event, gesture) => { controller?.move(gesture.dy); },
      onPanResponderRelease: () => { controller?.end(true); },
      onPanResponderTerminate: () => { controller?.end(false); },
    });
    const index = order.indexOf(id);
    return {
      handlers: pan.panHandlers,
      // A screen reader moves it a place up or down instead.
      onAction: (event) => {
        const by = event.nativeEvent.actionName === 'increment' ? 1 : event.nativeEvent.actionName === 'decrement' ? -1 : 0;
        if (by) controller?.step(group, id, order, by);
      },
      first: index === 0,
      last: index === order.length - 1,
    };
  }, [controller, group, id, rowKey, idsKey]);

  const register = useCallback((view: unknown) => { controller?.register(group, id, (view as Measurable | null) ?? null); }, [controller, group, id]);
  const active = !!controller && !!drag && drag.group === group && drag.id === id;
  const line = lineFor(drag, group, id);
  return (
    <ItemContext.Provider value={handle}>
      <Animated.View ref={register} style={[style, active && [styles.lifted, { transform: [{ translateY: controller.dy }] }]]}>
        {children}
        {line ? <View pointerEvents="none" style={[styles.line, line === 'before' ? styles.lineTop : styles.lineBottom]} /> : null}
      </Animated.View>
    </ItemContext.Provider>
  );
}

/** The handle that drags the row it is in (a ReorderItem); nothing outside one. */
export function ReorderHandle({ label }: { label: string }) {
  const handle = useContext(ItemContext);
  if (!handle) return null;
  return (
    <View
      {...handle.handlers}
      style={styles.handle}
      hitSlop={{ top: 8, bottom: 8, left: 6, right: 6 }}
      accessible
      accessibilityRole="adjustable"
      accessibilityLabel={`Move ${label}`}
      accessibilityHint="Drag up or down to change the order"
      accessibilityActions={[
        ...(handle.first ? [] : [{ name: 'decrement', label: 'Move up' }]),
        ...(handle.last ? [] : [{ name: 'increment', label: 'Move down' }]),
      ]}
      onAccessibilityAction={handle.onAction}
    >
      <Ionicons name="reorder-three-outline" size={20} color={colors.textFaint} />
    </View>
  );
}

/**
 * A FlatList's CellRendererComponent: the cell of the row being dragged rises
 * above the cells after it, which would otherwise draw over it.
 */
export function ReorderCell({ item, style, children, onLayout, onFocusCapture }: {
  item: unknown; index?: number; cellKey?: string; style?: StyleProp<ViewStyle>; children?: ReactNode;
  onLayout?: ViewProps['onLayout']; onFocusCapture?: ViewProps['onFocusCapture'];
}) {
  const drag = useContext(DragContext);
  const key = (item as { key?: string } | null)?.key;
  const lifted = !!drag && key === drag.rowKey;
  return <View style={[style, lifted && styles.liftedCell]} onLayout={onLayout} onFocusCapture={onFocusCapture}>{children}</View>;
}

const styles = StyleSheet.create({
  lifted: {
    zIndex: 10, elevation: 8, backgroundColor: colors.raised, borderRadius: 10, opacity: 0.96,
    shadowColor: '#000', shadowOpacity: 0.35, shadowRadius: 8, shadowOffset: { width: 0, height: 4 },
  },
  liftedCell: { zIndex: 10, elevation: 8 },
  line: { position: 'absolute', left: 10, right: 10, height: 2, borderRadius: 1, backgroundColor: colors.accent },
  lineTop: { top: -1 },
  lineBottom: { bottom: -1 },
  handle: { width: 30, height: 36, alignItems: 'center', justifyContent: 'center' },
});
