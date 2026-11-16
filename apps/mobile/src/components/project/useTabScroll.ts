import { useRef, useState } from 'react';
import type { LayoutChangeEvent, NativeScrollEvent, NativeSyntheticEvent, ScrollViewInstance } from 'react-native';

import type { ScrollKey } from '@/projects/tabs';
import { rememberScroll, useProjectUiStore } from '@/projects/ui-store';

/**
 * Props for a tab's vertical ScrollView: it records how far it is scrolled
 * (per project and tab, or Git view) and, when it appears again, scrolls back there once
 * the content is tall enough.
 */
export function useTabScroll(projectId: string, tab: ScrollKey) {
  const ref = useRef<ScrollViewInstance>(null);
  const [target] = useState(() => useProjectUiStore.getState().get(projectId).scroll[tab] ?? 0);
  // Nothing is recorded until the saved offset is back (or the user takes over), so the first frames cannot overwrite it.
  const settled = useRef(target === 0);
  const sizes = useRef({ content: 0, layout: 0 });

  const restore = () => {
    if (settled.current) return;
    const { content, layout } = sizes.current;
    if (!layout || content - layout < target) return;
    ref.current?.scrollTo({ y: target, animated: false });
    settled.current = true;
  };

  const remember = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    if (settled.current) rememberScroll(projectId, tab, event.nativeEvent.contentOffset.y);
  };

  return {
    ref,
    onLayout: (event: LayoutChangeEvent) => { sizes.current.layout = event.nativeEvent.layout.height; restore(); },
    onContentSizeChange: (_width: number, height: number) => { sizes.current.content = height; restore(); },
    onScrollBeginDrag: () => { settled.current = true; },
    // Recorded when a scroll ends, not while it moves: writing the store on every frame would re-render subscribers.
    onScrollEndDrag: remember,
    onMomentumScrollEnd: remember,
  };
}
