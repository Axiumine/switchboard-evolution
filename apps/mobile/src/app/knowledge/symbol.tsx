import { router, Stack, useLocalSearchParams } from 'expo-router';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { KButton, KCard, KEmpty, KError, KLoading, kstyles, MONO, SymbolRow } from '@/components/knowledge/parts';
import { useKnowledgeQuery } from '@/knowledge/queries';
import { ambiguity, snippetModel, type Ambiguity, type Snippet } from '@/shared/vendor/knowledge-model';
import { colors, spacing } from '@/theme';

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) || '';

/**
 * A symbol of a folder's code graph (the Node Knowledge tab): its code, who
 * calls it and what it calls; a name taps through to that symbol.
 */
export default function KnowledgeSymbolScreen() {
  const params = useLocalSearchParams<{ projectId: string; folder: string; qn: string }>();
  const projectId = one(params.projectId);
  const folder = one(params.folder);
  const qn = one(params.qn);
  const snippet = useKnowledgeQuery(projectId, folder, 'get_code_snippet', { qualified_name: qn, include_neighbors: true, source_mode: 'auto' }, !!qn);
  const choices: Ambiguity | null = snippet.data ? ambiguity(snippet.data) : null;
  const data: Snippet | null = snippet.data && !choices ? snippetModel(snippet.data) : null;
  const error = snippet.error;

  const go = (name: string) => router.push({ pathname: '/knowledge/symbol', params: { projectId, folder, qn: name } });
  const title = data?.name || qn.split('.').pop() || 'Symbol';
  const lines = data ? data.source.replace(/\n$/, '').split('\n') : [];
  const first = data?.sourceMode === 'outline' ? null : data?.start ?? 1;

  return (
    <View style={styles.screen}>
      <Stack.Screen options={{ title }} />
      <ScrollView contentContainerStyle={kstyles.page}>
        <KError error={error} />
        {!data && !choices && !error ? <KLoading /> : null}
        {choices ? (
          <KCard title="Which one?">
            <Text style={[kstyles.help, styles.pad]}>{choices.message}</Text>
            {choices.suggestions.map((s, i) => <SymbolRow key={`${s.qn}${i}`} item={s} onPress={() => go(s.qn)} />)}
          </KCard>
        ) : null}
        {data ? (
          <>
            <View style={kstyles.bar}>
              {data.label ? <Text style={styles.label}>{data.label}</Text> : null}
              <Text style={styles.where} numberOfLines={2}>{data.file}{data.start ? `:${data.start}${data.end && data.end !== data.start ? `-${data.end}` : ''}` : ''}</Text>
            </View>
            <KCard title={`Called by ${data.callers}`}>
              {data.callerNames.length ? <View style={styles.names}>{data.callerNames.slice(0, 40).map((n) => <KButton key={n} label={n} onPress={() => go(n)} />)}</View> : <KEmpty>None</KEmpty>}
            </KCard>
            <KCard title={`Calls ${data.callees}`}>
              {data.calleeNames.length ? <View style={styles.names}>{data.calleeNames.slice(0, 40).map((n) => <KButton key={n} label={n} onPress={() => go(n)} />)}</View> : <KEmpty>None</KEmpty>}
            </KCard>
            <ScrollView horizontal style={styles.code}>
              <View>
                {lines.map((text, i) => (
                  <Text key={i} style={styles.line}>
                    {first != null ? <Text style={styles.no}>{String(first + i).padStart(4, ' ')}  </Text> : null}
                    {text || ' '}
                  </Text>
                ))}
              </View>
            </ScrollView>
          </>
        ) : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  pad: { paddingHorizontal: spacing.md },
  label: { color: '#b4b8ff', backgroundColor: 'rgba(128,136,255,0.14)', fontSize: 12, fontWeight: '700', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4, overflow: 'hidden' },
  where: { color: colors.textDim, fontFamily: MONO, fontSize: 12, flexShrink: 1 },
  names: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, paddingHorizontal: spacing.md, paddingBottom: spacing.xs },
  code: { borderRadius: 10, backgroundColor: '#121218', borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border, paddingVertical: spacing.sm },
  line: { color: colors.text, fontFamily: MONO, fontSize: 12, lineHeight: 18, paddingHorizontal: spacing.md },
  no: { color: colors.textFaint },
});
