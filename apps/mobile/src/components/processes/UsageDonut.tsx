import Ionicons from '@expo/vector-icons/Ionicons';
import { useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';

import { donutPaths, formatPercent, type Slice } from '@/shared/vendor/usage-chart';
import { colors, spacing } from '@/theme';

const SIZE = 120;
const THICKNESS = 14;

export type DetailRow = { key: string; name: string; value: string; note?: string };

/**
 * A ring and its legend, as the desktop's Task Manager draws them
 * (usage-chart.js). Tapping a slice or a legend row lights both and shows that
 * slice in the middle; tapping it again goes back to `center`. A row with
 * details (a project's folders) opens under itself.
 */
export function UsageDonut<O>({
  slices,
  total,
  format,
  center,
  label,
  details,
  footer,
}: {
  slices: Slice<O>[];
  total: number;
  format: (bytes: number) => string;
  center: { big: string; small: string };
  label: string;
  details?: (slice: Slice<O>) => DetailRow[] | null;
  footer?: ReactNode;
}) {
  const [active, setActive] = useState<string | null>(null);
  const [open, setOpen] = useState<ReadonlySet<string>>(() => new Set());
  const byKey = new Map(slices.map((slice) => [slice.key, slice]));
  const pointed = active ? byKey.get(active) ?? null : null;
  const shown = (slice: Slice<O>) => slice.display ?? slice.bytes;
  const share = (bytes: number) => formatPercent(bytes, total);
  const point = (key: string) => setActive((current) => (current === key ? null : key));
  const toggleOpen = (key: string) => setOpen((old) => {
    const next = new Set(old);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });

  const paths = donutPaths(slices, { size: SIZE, thickness: THICKNESS });

  return (
    <View style={styles.wrap}>
      <View style={styles.ring} accessible accessibilityRole="image" accessibilityLabel={label}>
        <Svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`}>
          {paths.map(({ key, d }) => (
            <Path
              key={key}
              d={d}
              fill={byKey.get(key)?.color}
              opacity={active && active !== key ? 0.35 : 1}
              onPress={() => point(key)}
            />
          ))}
        </Svg>
        <View style={styles.center} pointerEvents="none">
          <Text style={styles.big} numberOfLines={1} adjustsFontSizeToFit>{pointed ? format(shown(pointed)) : center.big}</Text>
          <Text style={styles.small} numberOfLines={2}>{pointed ? `${pointed.label} · ${share(shown(pointed))}` : center.small}</Text>
        </View>
      </View>
      <View style={styles.legend}>
        {slices.map((slice) => {
          const rows = details?.(slice) ?? null;
          const isOpen = !!rows && open.has(slice.key);
          const dim = !!active && active !== slice.key;
          const shared = slice.display != null && slice.display > slice.bytes;
          return (
            <View key={slice.key}>
              <Pressable
                onPress={() => { point(slice.key); if (rows) toggleOpen(slice.key); }}
                accessibilityRole="button"
                accessibilityState={rows ? { expanded: isOpen, selected: active === slice.key } : { selected: active === slice.key }}
                accessibilityLabel={`${slice.label}, ${format(shown(slice))}, ${share(shown(slice))}${shared ? ', part of it shared with another project' : ''}`}
                style={({ pressed }) => [styles.row, active === slice.key && styles.rowActive, dim && styles.rowDim, pressed && styles.pressed]}
              >
                <View style={[styles.dot, { backgroundColor: slice.color }]} />
                {rows ? <Ionicons name={isOpen ? 'chevron-down' : 'chevron-forward'} size={11} color={colors.textFaint} /> : null}
                <Text style={styles.name} numberOfLines={1}>
                  {slice.label}
                  {shared ? <Text style={styles.tag}>{'  shared'}</Text> : null}
                </Text>
                <Text style={styles.value}>{format(shown(slice))}</Text>
                <Text style={styles.share}>{share(shown(slice))}</Text>
              </Pressable>
              {isOpen ? rows!.map((row) => (
                <View key={row.key} style={styles.sub}>
                  <Text style={styles.subName} numberOfLines={1}>
                    {row.name}
                    {row.note ? <Text style={styles.subNote}>{`  ${row.note}`}</Text> : null}
                  </Text>
                  <Text style={styles.subValue}>{row.value}</Text>
                </View>
              )) : null}
            </View>
          );
        })}
        {footer}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginTop: spacing.sm },
  ring: { width: SIZE, height: SIZE },
  center: { position: 'absolute', top: 22, left: 22, right: 22, bottom: 22, alignItems: 'center', justifyContent: 'center' },
  big: { color: colors.text, fontSize: 16, fontWeight: '700', fontVariant: ['tabular-nums'] },
  small: { color: colors.textDim, fontSize: 10.5, textAlign: 'center', marginTop: 1 },
  legend: { flex: 1, minWidth: 0, gap: 1 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 5, paddingHorizontal: 6, borderRadius: 6 },
  rowActive: { backgroundColor: 'rgba(255,255,255,0.06)' },
  rowDim: { opacity: 0.55 },
  pressed: { opacity: 0.6 },
  dot: { width: 8, height: 8, borderRadius: 2 },
  name: { flex: 1, minWidth: 0, color: colors.text, fontSize: 12.5 },
  tag: { color: colors.textFaint, fontSize: 10.5 },
  value: { color: colors.text, fontSize: 12.5, fontVariant: ['tabular-nums'] },
  share: { width: 40, textAlign: 'right', color: colors.textFaint, fontSize: 11.5, fontVariant: ['tabular-nums'] },
  sub: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingLeft: 27, paddingRight: 46, paddingVertical: 2 },
  subName: { flex: 1, minWidth: 0, color: colors.textDim, fontSize: 11.5 },
  subNote: { color: colors.textFaint, fontSize: 10.5 },
  subValue: { color: colors.textDim, fontSize: 11.5, fontVariant: ['tabular-nums'] },
});
