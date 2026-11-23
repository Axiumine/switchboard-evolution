import type { ReactNode } from 'react';
import { ActivityIndicator, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { riskColor, type KnowledgeSymbol } from '@/shared/vendor/knowledge-model';
import { colors, spacing } from '@/theme';

// The Node Knowledge tab's small pieces, shared by its views.

export const MONO = Platform.select({ ios: 'Menlo', default: 'monospace' });

export function KCard({ title, meta, right, children }: { title?: string; meta?: string; right?: ReactNode; children?: ReactNode }) {
  return (
    <View style={styles.card}>
      {title || right ? (
        <View style={styles.cardHead}>
          {title ? <Text style={styles.cardTitle} numberOfLines={1}>{title}</Text> : null}
          {meta ? <Text style={styles.cardMeta} numberOfLines={1}>{meta}</Text> : null}
          <View style={styles.flex} />
          {right}
        </View>
      ) : null}
      {children}
    </View>
  );
}

export function KSection({ children }: { children: ReactNode }) {
  return <Text style={styles.section}>{children}</Text>;
}

export function KEmpty({ children }: { children: ReactNode }) {
  return <Text style={styles.empty}>{children}</Text>;
}

export function KError({ error }: { error: unknown }) {
  if (!error) return null;
  const text = error instanceof Error ? error.message : String(error);
  return <Text style={styles.error}>{text}</Text>;
}

export function KLoading({ text = 'Reading…' }: { text?: string }) {
  return (
    <View style={styles.loading}>
      <ActivityIndicator color={colors.accent} />
      <Text style={styles.loadingText}>{text}</Text>
    </View>
  );
}

/** A row of choices, one picked, scrolling sideways when they do not fit. */
export function KSeg<T extends string>({ options, value, onChange, label }: { options: readonly { key: T; label: string }[]; value: T; onChange: (key: T) => void; label: string }) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.seg} accessibilityRole="tablist" accessibilityLabel={label}>
      {options.map((option) => {
        const on = option.key === value;
        return (
          <Pressable
            key={option.key}
            onPress={() => onChange(option.key)}
            style={[styles.segBtn, on && styles.segBtnOn]}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
          >
            <Text style={[styles.segText, on && styles.segTextOn]}>{option.label}</Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

export function KButton({ label, onPress, primary, danger, disabled, busy }: { label: string; onPress: () => void; primary?: boolean; danger?: boolean; disabled?: boolean; busy?: boolean }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || busy}
      style={({ pressed }) => [styles.button, primary && styles.buttonPrimary, (disabled || busy) && styles.buttonOff, pressed && styles.pressed]}
      accessibilityRole="button"
      accessibilityState={{ disabled: !!(disabled || busy), busy: !!busy }}
    >
      {busy ? <ActivityIndicator size="small" color={colors.accent} /> : null}
      <Text style={[styles.buttonText, primary && styles.buttonTextPrimary, danger && styles.buttonTextDanger]}>{label}</Text>
    </Pressable>
  );
}

export function RiskDot({ risk }: { risk?: string | null }) {
  return <View style={[styles.dot, { backgroundColor: riskColor(risk) }]} />;
}

/** A symbol of any list: its name and kind, where it is, and the hop or the risk when there are. */
export function SymbolRow({ item, onPress, extra }: { item: KnowledgeSymbol; onPress?: () => void; extra?: string }) {
  const where = item.file ? `${item.file}${item.start ? `:${item.start}` : ''}` : '';
  return (
    <Pressable onPress={onPress} disabled={!onPress} style={({ pressed }) => [styles.row, pressed && styles.pressed]} accessibilityRole={onPress ? 'button' : undefined} accessibilityLabel={`${item.name}${item.label ? `, ${item.label}` : ''}${where ? `, ${where}` : ''}`}>
      <View style={styles.rowLine}>
        {item.hop != null ? <Text style={styles.hop}>{item.hop}</Text> : null}
        {item.risk !== undefined ? <RiskDot risk={item.risk} /> : null}
        <Text style={styles.rowName} numberOfLines={1}>{item.name || item.qn}</Text>
        {item.label ? <Text style={styles.label}>{item.label}</Text> : null}
        {extra ? <Text style={styles.rowExtra} numberOfLines={1}>{extra}</Text> : null}
      </View>
      {where ? <Text style={styles.rowWhere} numberOfLines={1} ellipsizeMode="head">{where}</Text> : null}
    </Pressable>
  );
}

export function Chips({ items }: { items: { key: string; label: string; count?: number }[] }) {
  return (
    <View style={styles.chips}>
      {items.map((chip) => (
        <View key={chip.key} style={styles.chip}>
          <Text style={styles.chipText}>{chip.label}</Text>
          {chip.count != null ? <Text style={styles.chipCount}>{chip.count.toLocaleString('en-US')}</Text> : null}
        </View>
      ))}
    </View>
  );
}

export const kstyles = StyleSheet.create({
  input: {
    minHeight: 40, paddingHorizontal: spacing.md, borderRadius: 8, borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border, backgroundColor: colors.surface, color: colors.text, fontSize: 15,
  },
  mono: { fontFamily: MONO, fontSize: 12.5 },
  bar: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flexWrap: 'wrap' },
  page: { padding: spacing.lg, gap: spacing.md, paddingBottom: spacing.xl * 2 },
  help: { color: colors.textDim, fontSize: 13, lineHeight: 18 },
});

const styles = StyleSheet.create({
  flex: { flex: 1 },
  card: { backgroundColor: colors.surface, borderRadius: 10, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border, paddingVertical: spacing.sm, gap: 2 },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.md, paddingBottom: spacing.xs },
  cardTitle: { color: colors.text, fontSize: 15, fontWeight: '700', flexShrink: 1 },
  cardMeta: { color: colors.textDim, fontSize: 12, flexShrink: 1 },
  section: { color: colors.textFaint, fontSize: 12, fontWeight: '700', letterSpacing: 0.6, textTransform: 'uppercase', marginTop: spacing.sm },
  empty: { color: colors.textDim, fontSize: 14, lineHeight: 20, paddingVertical: spacing.md },
  error: { color: colors.danger, fontSize: 13, lineHeight: 18 },
  loading: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.md },
  loadingText: { color: colors.textDim, fontSize: 14 },
  seg: { gap: 4, padding: 3, borderRadius: 8, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border, backgroundColor: 'rgba(255,255,255,0.03)' },
  segBtn: { minHeight: 34, paddingHorizontal: spacing.md, borderRadius: 6, justifyContent: 'center' },
  segBtnOn: { backgroundColor: 'rgba(128,136,255,0.18)' },
  segText: { color: colors.textDim, fontSize: 13.5, fontWeight: '600' },
  segTextOn: { color: colors.text },
  button: {
    minHeight: 40, paddingHorizontal: spacing.md, borderRadius: 8, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border,
    backgroundColor: colors.raised, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.xs,
  },
  buttonPrimary: { backgroundColor: 'rgba(128,136,255,0.18)', borderColor: 'rgba(128,136,255,0.45)' },
  buttonOff: { opacity: 0.5 },
  buttonText: { color: colors.text, fontSize: 14, fontWeight: '600' },
  buttonTextPrimary: { color: '#b4b8ff' },
  buttonTextDanger: { color: colors.danger },
  pressed: { opacity: 0.7 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  row: { paddingHorizontal: spacing.md, paddingVertical: spacing.sm, minHeight: 48, justifyContent: 'center', gap: 2 },
  rowLine: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  rowName: { color: colors.text, fontSize: 15, fontWeight: '600', flexShrink: 1 },
  rowExtra: { color: colors.textDim, fontSize: 12, flexShrink: 1 },
  rowWhere: { color: colors.textFaint, fontSize: 12, fontFamily: MONO },
  hop: { color: colors.textFaint, fontSize: 12, width: 16, textAlign: 'center' },
  label: { color: '#b4b8ff', backgroundColor: 'rgba(128,136,255,0.14)', fontSize: 11, fontWeight: '700', paddingHorizontal: 6, paddingVertical: 1, borderRadius: 4, overflow: 'hidden' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, paddingHorizontal: spacing.md, paddingVertical: spacing.xs },
  chip: { flexDirection: 'row', gap: 6, alignItems: 'center', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10, backgroundColor: 'rgba(255,255,255,0.05)' },
  chipText: { color: colors.textDim, fontSize: 12 },
  chipCount: { color: colors.text, fontSize: 12, fontWeight: '700' },
});
