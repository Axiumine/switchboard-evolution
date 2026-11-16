import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { HeaderButton } from '@/components/HeaderButton';
import { STATE_COLORS } from '@/components/SessionRow';
import type { SessionState } from '@/sessions/model';
import { colors, spacing } from '@/theme';

export type SessionTab = 'chat' | 'terminal';

const TABS: { key: SessionTab; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { key: 'chat', label: 'Chat', icon: 'book-outline' },
  { key: 'terminal', label: 'Terminal', icon: 'terminal-outline' },
];

function goBack() {
  if (router.canGoBack()) router.back();
  else router.replace('/');
}

/**
 * Chat | Terminal, 40pt, with an amber pip on Chat while the session waits for
 * the user. `compact` is the narrower one beside a title (a project's Session
 * tab): 34pt, and only the icons when `iconsOnly`.
 */
export function SegmentedControl({ tab, onChange, waiting, compact, iconsOnly }: {
  tab: SessionTab; onChange: (tab: SessionTab) => void; waiting: boolean; compact?: boolean; iconsOnly?: boolean;
}) {
  return (
    <View style={[styles.segments, compact && styles.segmentsCompact]} accessibilityRole="tablist">
      {TABS.map(({ key, label, icon }) => {
        const on = key === tab;
        return (
          <Pressable
            key={key}
            onPress={() => onChange(key)}
            style={[styles.segment, compact && styles.segmentCompact, on && styles.segmentOn]}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
            accessibilityLabel={key === 'chat' && waiting ? `${label}, waiting for you` : label}
          >
            <Ionicons name={icon} size={16} color={on ? colors.text : colors.textDim} />
            {iconsOnly ? null : <Text style={[styles.segmentText, compact && styles.segmentTextCompact, on && styles.segmentTextOn]}>{label}</Text>}
            {key === 'chat' && waiting ? <View style={styles.pip} /> : null}
          </Pressable>
        );
      })}
    </View>
  );
}

/**
 * A session's header: back, its state dot, title and a subtitle that says
 * what it does, the session actions; under it Chat | Terminal (not for a
 * plain terminal, which has no chat).
 */
export function SessionHeader({ title, subtitle, state, onMore, tab, onTab, showTabs }: {
  title: string;
  subtitle: string;
  state: SessionState;
  onMore?: () => void;
  tab: SessionTab;
  onTab: (tab: SessionTab) => void;
  showTabs: boolean;
}) {
  const { top } = useSafeAreaInsets();
  const dot = STATE_COLORS[state];
  return (
    <View style={[styles.container, { paddingTop: top }]}>
      <View style={styles.bar}>
        <Pressable onPress={goBack} style={styles.back} accessibilityRole="button" accessibilityLabel="Back">
          <Ionicons name="chevron-back" size={24} color={colors.text} />
        </Pressable>
        <View style={[styles.dot, { backgroundColor: dot, borderColor: state === 'idle' ? colors.textFaint : dot }]} />
        <View style={styles.titles} accessible accessibilityRole="header" accessibilityLabel={`${title}, ${subtitle}`}>
          <Text style={styles.title} numberOfLines={1}>{title}</Text>
          {subtitle ? <Text style={styles.subtitle} numberOfLines={1}>{subtitle}</Text> : null}
        </View>
        {onMore ? <View style={styles.more}><HeaderButton icon="ellipsis-horizontal" accessibilityLabel="Session actions" onPress={onMore} /></View> : null}
      </View>
      {showTabs ? (
        <View style={styles.tabs}>
          <SegmentedControl tab={tab} onChange={onTab} waiting={state === 'attention'} />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { backgroundColor: colors.surface, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  bar: { height: 56, flexDirection: 'row', alignItems: 'center', paddingStart: 6, paddingEnd: spacing.md },
  back: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  dot: { width: 11, height: 11, borderRadius: 6, borderWidth: 1.5, marginStart: 2, marginEnd: spacing.sm },
  titles: { flex: 1, minWidth: 0 },
  title: { color: colors.text, fontSize: 17, fontWeight: '700', lineHeight: 22 },
  subtitle: { color: colors.textFaint, fontSize: 12, lineHeight: 16 },
  more: { marginStart: spacing.sm },
  tabs: { height: 54, paddingHorizontal: spacing.lg, paddingBottom: 7, justifyContent: 'center' },
  segments: { height: 40, flexDirection: 'row', backgroundColor: colors.background, borderRadius: 12, padding: 3, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
  segmentsCompact: { height: 34, borderRadius: 10 },
  segment: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, borderRadius: 9 },
  segmentCompact: { flex: 0, paddingHorizontal: 12, gap: 6, borderRadius: 8 },
  segmentTextCompact: { fontSize: 13.5 },
  segmentOn: { backgroundColor: colors.raised },
  segmentText: { color: colors.textDim, fontSize: 14.5, fontWeight: '600' },
  segmentTextOn: { color: '#e4e4fa' },
  pip: { width: 7, height: 7, borderRadius: 4, backgroundColor: colors.attention },
});
