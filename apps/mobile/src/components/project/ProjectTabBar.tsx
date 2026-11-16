import { useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View, type ScrollViewInstance } from 'react-native';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';

import { PROJECT_TABS, type ProjectTab } from '@/projects/tabs';
import { colors } from '@/theme';

const FADE = 28;
const ACTIVE_LABEL = '#e4e4fa';

/**
 * The project page's tabs: a row that scrolls sideways when it does not fit,
 * with a fade on the right edge saying so. The active tab is scrolled into
 * view when it is selected or restored. `meta` is a short note after a
 * label (the plan's `3/7`), `dots` a state dot after it (what the Session
 * tab's session is doing). `tabs` leaves some out (Session until one is open).
 */
export function ProjectTabBar({ tabs = PROJECT_TABS, active, onChange, meta, dots }: {
  tabs?: readonly { key: ProjectTab; label: string }[];
  active: ProjectTab;
  onChange: (tab: ProjectTab) => void;
  meta?: Partial<Record<ProjectTab, string>>;
  dots?: Partial<Record<ProjectTab, string>>;
}) {
  const scroller = useRef<ScrollViewInstance>(null);
  const spans = useRef<Partial<Record<ProjectTab, { x: number; width: number }>>>({});
  const [width, setWidth] = useState(0);
  const [content, setContent] = useState(0);
  const [atEnd, setAtEnd] = useState(false);
  const offsetRef = useRef(0);
  const sizes = useRef({ width: 0, content: 0 });
  const revealed = useRef(false);

  const reveal = () => {
    const span = spans.current[active];
    if (!span || !width) return;
    const left = offsetRef.current;
    // The first reveal (opening the page) jumps; later ones, from a tap, animate.
    const animated = revealed.current;
    revealed.current = true;
    // Leave the neighbour peeking out, so there is something to scroll towards.
    if (span.x - FADE < left) scroller.current?.scrollTo({ x: Math.max(0, span.x - FADE), animated });
    else if (span.x + span.width + FADE > left + width) scroller.current?.scrollTo({ x: span.x + span.width + FADE - width, animated });
  };
  useEffect(reveal, [active, width, content]);

  // Only the fade's visibility is state, so scrolling the row re-renders nothing unless that flips.
  const updateEnd = () => setAtEnd(offsetRef.current + sizes.current.width >= sizes.current.content - 1);

  const overflowing = content > width + 1;
  const showFade = overflowing && !atEnd;

  return (
    <View style={styles.bar} onLayout={(e) => { const w = e.nativeEvent.layout.width; sizes.current.width = w; setWidth(w); updateEnd(); }} accessibilityRole="tablist">
      <ScrollView
        ref={scroller}
        horizontal
        showsHorizontalScrollIndicator={false}
        scrollEventThrottle={32}
        onScroll={(e) => { offsetRef.current = e.nativeEvent.contentOffset.x; updateEnd(); }}
        onContentSizeChange={(w) => { sizes.current.content = w; setContent(w); updateEnd(); }}
      >
        {tabs.map(({ key, label }) => {
          const selected = key === active;
          return (
            <Pressable
              key={key}
              onPress={() => onChange(key)}
              onLayout={(e) => { spans.current[key] = { x: e.nativeEvent.layout.x, width: e.nativeEvent.layout.width }; }}
              style={styles.tab}
              accessibilityRole="tab"
              accessibilityState={{ selected }}
              accessibilityLabel={meta?.[key] ? `${label}, ${meta[key]}` : label}
            >
              <Text style={[styles.label, selected && styles.labelActive]}>{label}</Text>
              {meta?.[key] ? <Text style={styles.meta}>{meta[key]}</Text> : null}
              {dots?.[key] ? <View style={[styles.dot, { backgroundColor: dots[key] }]} /> : null}
              {selected ? <View style={styles.underline} /> : null}
            </Pressable>
          );
        })}
      </ScrollView>
      {showFade ? (
        <View style={styles.fade} pointerEvents="none">
          <Svg width={FADE} height="100%">
            <Defs>
              <LinearGradient id="tab-fade" x1="0" y1="0" x2="1" y2="0">
                <Stop offset="0" stopColor={colors.surface} stopOpacity={0} />
                <Stop offset="1" stopColor={colors.surface} stopOpacity={1} />
              </LinearGradient>
            </Defs>
            <Rect x="0" y="0" width="100%" height="100%" fill="url(#tab-fade)" />
          </Svg>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { height: 46, backgroundColor: colors.surface, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  tab: { height: 46, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', gap: 6 },
  label: { color: colors.textDim, fontSize: 14.5, fontWeight: '600' },
  labelActive: { color: ACTIVE_LABEL },
  meta: { color: colors.textFaint, fontSize: 12 },
  dot: { width: 7, height: 7, borderRadius: 4 },
  underline: { position: 'absolute', left: 10, right: 10, bottom: 0, height: 2, borderRadius: 1, backgroundColor: colors.accent },
  fade: { position: 'absolute', top: 0, right: 0, bottom: 0, width: FADE },
});
