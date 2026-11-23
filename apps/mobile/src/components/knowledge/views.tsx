import { router } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Alert, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';

import { MarkdownPreview } from '@/components/files/MarkdownPreview';
import { Sheet } from '@/components/Sheet';
import { act } from '@/projects/queries';
import { knowledgeAction, knowledgeQuery, useKnowledgeQuery, type KnowledgeStatus } from '@/knowledge/queries';
import { impactArgs, type ImpactAgainst } from '@/knowledge/model';
import {
  ambiguity, cellText, codeResults, compareModel, CYPHER_EXAMPLES, expandTrace, impactModel, indexGaps, queryTable, searchResults,
  shortName, testImpactModel, TRACE_MODES, traceSides, utf8Bytes,
  type Impact, type KnowledgeSymbol, type QueryTable, type TestImpact, type TraceLayoutNode, type TraceSides, type TraceTree,
} from '@/shared/vendor/knowledge-model';
import { colors, spacing } from '@/theme';
import { useConnection } from '@/store/connection';
import { Chips, KButton, KCard, KEmpty, KError, KLoading, KSeg, kstyles, MONO, SymbolRow } from './parts';
import { TraceGraph } from './TraceGraph';

type ViewProps = { projectId: string; folder: string; status: KnowledgeStatus };

/** A symbol's page: its code, who calls it and what it calls. */
export function openSymbol(projectId: string, folder: string, qn: string) {
  router.push({ pathname: '/knowledge/symbol', params: { projectId, folder, qn } });
}

// --- Search ---

export function SearchView({ projectId, folder }: ViewProps) {
  const [kind, setKind] = useState<'symbols' | 'code'>('symbols');
  const [text, setText] = useState('');
  const [meaning, setMeaning] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [items, setItems] = useState<{ items: KnowledgeSymbol[]; semantic: KnowledgeSymbol[]; raw: { file: string | null; line: number | null; content: string }[]; total: number } | null>(null);

  const run = async () => {
    const query = text.trim();
    if (!query) return;
    setBusy(true);
    setError(null);
    try {
      if (kind === 'code') {
        const r = codeResults(await knowledgeQuery(projectId, folder, 'search_code', { pattern: query, limit: 30 }));
        setItems({ items: r.items, semantic: [], raw: r.raw, total: r.total });
      } else {
        const r = searchResults(await knowledgeQuery(projectId, folder, 'search_graph', { query, limit: 40, ...(meaning ? { semantic_query: [query] } : {}) }));
        setItems({ items: r.items, semantic: r.semantic, raw: [], total: r.total });
      }
    } catch (err) { setError(err); }
    setBusy(false);
  };

  return (
    <ScrollView contentContainerStyle={kstyles.page} keyboardShouldPersistTaps="handled">
      <KSeg label="Search in" value={kind} onChange={(k) => { setKind(k); setItems(null); }} options={[{ key: 'symbols', label: 'Symbols' }, { key: 'code', label: 'Code' }]} />
      <TextInput
        style={kstyles.input}
        value={text}
        onChangeText={setText}
        onSubmitEditing={run}
        returnKeyType="search"
        placeholder={kind === 'code' ? 'Text in the source' : 'Name or words, e.g. parse config'}
        placeholderTextColor={colors.textFaint}
        autoCapitalize="none"
        autoCorrect={false}
        accessibilityLabel="Search"
      />
      {kind === 'symbols' ? (
        <View style={kstyles.bar}>
          <Switch value={meaning} onValueChange={setMeaning} accessibilityLabel="By meaning" />
          <Text style={kstyles.help}>Also by meaning</Text>
        </View>
      ) : null}
      <KButton label="Search" primary onPress={run} busy={busy} disabled={!text.trim()} />
      <KError error={error} />
      {items ? (
        <KCard title={`${items.total.toLocaleString('en-US')} found`}>
          {items.items.map((item, i) => <SymbolRow key={`${item.qn}${i}`} item={item} onPress={() => openSymbol(projectId, folder, item.qn)} />)}
          {items.raw.map((m, i) => (
            <SymbolRow key={`raw${i}`} item={{ qn: '', name: m.content.trim().slice(0, 80), label: null, file: m.file, start: m.line, end: m.line }} />
          ))}
          {!items.items.length && !items.raw.length ? <KEmpty>Nothing found.</KEmpty> : null}
        </KCard>
      ) : null}
      {items?.semantic.length ? (
        <KCard title="Close in meaning">
          {items.semantic.map((item, i) => <SymbolRow key={`s${item.qn}${i}`} item={item} onPress={() => openSymbol(projectId, folder, item.qn)} />)}
        </KCard>
      ) : null}
    </ScrollView>
  );
}

// --- Trace ---

export function TraceView({ projectId, folder, initial }: ViewProps & { initial?: string }) {
  const [name, setName] = useState(initial || '');
  const [mode, setMode] = useState('calls');
  const [show, setShow] = useState<'graph' | 'list'>('graph');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [tree, setTree] = useState<TraceTree | null>(null);
  const [list, setList] = useState<TraceSides | null>(null);
  const [choices, setChoices] = useState<KnowledgeSymbol[] | null>(null);
  const [picked, setPicked] = useState<TraceLayoutNode | null>(null);
  const [modes, setModes] = useState(false);

  const args = (fn: string, depth: number, direction: string) => ({ function_name: fn, direction, depth, limit: 200, risk_labels: true, ...(mode !== 'calls' ? { mode } : {}) });

  const run = async (fn = name.trim(), as = show) => {
    if (!fn) return;
    setBusy(true); setError(null); setChoices(null); setPicked(null);
    try {
      const r = await knowledgeQuery(projectId, folder, 'trace_path', args(fn, as === 'graph' ? 1 : 3, 'both'));
      const amb = ambiguity(r);
      if (amb) { setChoices(amb.suggestions); setBusy(false); return; }
      const sides = traceSides(r);
      setList(sides);
      const root = sides.root || fn;
      setTree({ qn: root, name: shortName(root), callers: sides.callers.filter((n) => (n.hop || 1) === 1), callees: sides.callees.filter((n) => (n.hop || 1) === 1) });
    } catch (err) { setError(err); }
    setBusy(false);
  };

  const onNode = async (node: TraceLayoutNode) => {
    setPicked(node);
    if (!tree || !node.expandable || node.side === 'root') return;
    try {
      const r = await knowledgeQuery(projectId, folder, 'trace_path', args(node.qn, 1, node.side === 'callers' ? 'inbound' : 'outbound'));
      const sides = traceSides(r);
      const next = (node.side === 'callers' ? sides.callers : sides.callees).filter((n) => (n.hop || 1) === 1);
      setTree(expandTrace(tree, node.id, next));
    } catch (err) { setError(err); }
  };

  const modeLabel = TRACE_MODES.find((m) => m.id === mode)?.label ?? 'Calls';
  return (
    <ScrollView contentContainerStyle={kstyles.page} keyboardShouldPersistTaps="handled">
      <TextInput
        style={[kstyles.input, kstyles.mono]}
        value={name}
        onChangeText={setName}
        onSubmitEditing={() => run()}
        returnKeyType="go"
        placeholder="function name"
        placeholderTextColor={colors.textFaint}
        autoCapitalize="none"
        autoCorrect={false}
        accessibilityLabel="Function"
      />
      <View style={kstyles.bar}>
        <KSeg label="Show as" value={show} onChange={(v) => { setShow(v); if (name.trim()) run(name.trim(), v); }} options={[{ key: 'graph', label: 'Graph' }, { key: 'list', label: 'List' }]} />
        <KButton label={modeLabel} onPress={() => setModes(true)} />
      </View>
      <KButton label="Trace" primary onPress={() => run()} busy={busy} disabled={!name.trim()} />
      <KError error={error} />
      {choices ? (
        <KCard title="Which one?">
          {choices.map((item, i) => <SymbolRow key={`${item.qn}${i}`} item={item} onPress={() => { setName(item.qn); run(item.qn); }} />)}
        </KCard>
      ) : null}
      {show === 'graph' && tree ? (
        <>
          <Text style={kstyles.help}>Tap a node with + to open its next step.</Text>
          <TraceGraph tree={tree} selected={picked?.id} onNode={onNode} />
          {picked ? (
            <View style={kstyles.bar}>
              <Text style={[kstyles.help, styles.flex]} numberOfLines={1}>{picked.qn}</Text>
              <KButton label="Read code" onPress={() => openSymbol(projectId, folder, picked.qn)} />
              {picked.side !== 'root' ? <KButton label="Trace from here" onPress={() => { setName(picked.qn); run(picked.qn); }} /> : null}
            </View>
          ) : null}
        </>
      ) : null}
      {show === 'list' && list ? (
        <>
          <KCard title="Called by" meta={String(list.callersTotal)}>
            {list.callers.length ? list.callers.map((item, i) => <SymbolRow key={`c${item.qn}${i}`} item={item} onPress={() => openSymbol(projectId, folder, item.qn)} />) : <KEmpty>None</KEmpty>}
          </KCard>
          <KCard title="Calls" meta={String(list.calleesTotal)}>
            {list.callees.length ? list.callees.map((item, i) => <SymbolRow key={`e${item.qn}${i}`} item={item} onPress={() => openSymbol(projectId, folder, item.qn)} />) : <KEmpty>None</KEmpty>}
          </KCard>
        </>
      ) : null}
      <Sheet visible={modes} title="What to follow" onClose={() => setModes(false)} options={TRACE_MODES.map((m) => ({ label: m.label, hint: m.hint, onPress: () => { setMode(m.id); setModes(false); } }))} />
    </ScrollView>
  );
}

// --- Impact ---

const AGAINST: { key: ImpactAgainst; label: string }[] = [
  { key: 'uncommitted', label: 'Uncommitted' },
  { key: 'branch', label: 'Branch vs base' },
  { key: 'since', label: 'Since a ref' },
];

export function ImpactView({ projectId, folder }: ViewProps) {
  const [against, setAgainst] = useState<ImpactAgainst>('uncommitted');
  const [ref, setRef] = useState('');
  const [tests, setTests] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [result, setResult] = useState<Impact | null>(null);
  const [testResult, setTestResult] = useState<TestImpact | null>(null);

  const run = async () => {
    setBusy(true); setError(null);
    try {
      const r = await knowledgeQuery(projectId, folder, 'detect_changes', impactArgs({ against, ref, scope: tests ? 'tests' : 'impact' }));
      if (tests) { setTestResult(testImpactModel(r)); setResult(null); } else { setResult(impactModel(r)); setTestResult(null); }
    } catch (err) { setError(err); }
    setBusy(false);
  };

  return (
    <ScrollView contentContainerStyle={kstyles.page} keyboardShouldPersistTaps="handled">
      <KSeg label="Compare with" value={against} onChange={setAgainst} options={AGAINST} />
      {against !== 'uncommitted' ? (
        <TextInput
          style={[kstyles.input, kstyles.mono]}
          value={ref}
          onChangeText={setRef}
          placeholder={against === 'branch' ? 'base branch (empty: main or master)' : 'commit, tag or ref'}
          placeholderTextColor={colors.textFaint}
          autoCapitalize="none"
          autoCorrect={false}
          accessibilityLabel="Reference"
        />
      ) : null}
      <View style={kstyles.bar}>
        <Switch value={tests} onValueChange={setTests} accessibilityLabel="Tests to run" />
        <Text style={kstyles.help}>Tests to run (experimental)</Text>
      </View>
      <KButton label="Analyse" primary onPress={run} busy={busy} />
      <KError error={error} />
      {testResult ? (
        <KCard title="Tests to run" meta="experimental">
          <Text style={[kstyles.help, styles.pad]}>{testResult.decision ? `Decision: ${testResult.decision}` : 'No decision'} · {testResult.suites} suites · {testResult.tests} tests</Text>
          {testResult.warnings.map((w, i) => <Text key={i} style={[kstyles.help, styles.pad]}>{w}</Text>)}
        </KCard>
      ) : null}
      {result ? (
        <>
          <Text style={kstyles.help}>{result.changedTotal} files changed{result.base ? ` against ${result.base}` : ''} · {result.seeds} symbols in them · {result.impactedTotal} reached</Text>
          <KCard title="Changed files">
            {result.changedFiles.length ? result.changedFiles.map((f) => <Text key={f} style={[styles.file, styles.pad]} numberOfLines={1} ellipsizeMode="head">{f}</Text>) : <KEmpty>No changed files.</KEmpty>}
          </KCard>
          <KCard title="What depends on them">
            {result.modules.length ? <Chips items={result.modules.map((m) => ({ key: m.module, label: m.module, count: m.count }))} /> : null}
            {result.impacted.length
              ? result.impacted.map((item, i) => <SymbolRow key={`${item.qn}${i}`} item={item} extra={item.viaName ? `via ${item.viaName}` : undefined} onPress={() => openSymbol(projectId, folder, item.qn)} />)
              : <KEmpty>Nothing calls the changed symbols.</KEmpty>}
          </KCard>
        </>
      ) : null}
    </ScrollView>
  );
}

// --- Query ---

export function QueryView({ projectId, folder, status }: ViewProps) {
  const [text, setText] = useState(CYPHER_EXAMPLES[0].query);
  const [graph, setGraph] = useState<'code' | 'missed'>('code');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [table, setTable] = useState<QueryTable | null>(null);
  const [examples, setExamples] = useState(false);
  const saved = status.settings.savedQueries || [];

  const run = async () => {
    if (!text.trim()) return;
    setBusy(true); setError(null);
    try { setTable(queryTable(await knowledgeQuery(projectId, folder, 'query_graph', { query: text.trim(), graph, max_rows: 200 }))); } catch (err) { setError(err); }
    setBusy(false);
  };

  return (
    <ScrollView contentContainerStyle={kstyles.page} keyboardShouldPersistTaps="handled">
      <View style={kstyles.bar}>
        <KSeg label="Graph" value={graph} onChange={setGraph} options={[{ key: 'code', label: 'Code' }, { key: 'missed', label: 'Gaps' }]} />
        <KButton label="Examples" onPress={() => setExamples(true)} />
      </View>
      <TextInput
        style={[kstyles.input, kstyles.mono, styles.query]}
        value={text}
        onChangeText={setText}
        multiline
        autoCapitalize="none"
        autoCorrect={false}
        accessibilityLabel="Cypher query"
      />
      <KButton label="Run" primary onPress={run} busy={busy} />
      <KError error={error} />
      {table ? (
        <KCard title={`${table.rows.length} of ${table.total} rows`}>
          <ScrollView horizontal>
            <View>
              <View style={styles.tr}>{table.columns.map((c) => <Text key={c} style={[styles.td, styles.th]}>{c}</Text>)}</View>
              {table.rows.map((row, i) => (
                <View key={i} style={styles.tr}>{row.map((v, j) => <Text key={j} style={styles.td} numberOfLines={2}>{cellText(v)}</Text>)}</View>
              ))}
            </View>
          </ScrollView>
        </KCard>
      ) : null}
      <Sheet
        visible={examples}
        title="Queries"
        onClose={() => setExamples(false)}
        options={[...CYPHER_EXAMPLES, ...saved].map((q) => ({ label: q.name, onPress: () => { setText(q.query); setExamples(false); } }))}
      />
    </ScrollView>
  );
}

// --- ADR ---

const ADR_TEMPLATE = '# Architecture decisions\n\n## Context\n\n## Decision\n\n## Consequences\n\n## Status\nAccepted\n';

export function AdrView({ projectId, folder }: ViewProps) {
  const online = useConnection((s) => s.status.state === 'online');
  // Under knowledge-data: read again on knowledge-changed (an ADR saved elsewhere).
  const adr = useQuery({
    queryKey: ['knowledge-data', projectId, folder, 'adr'],
    queryFn: () => act<{ content?: string }>('knowledge-adr', [projectId, folder, { mode: 'get' }]),
    enabled: online,
  });
  const content = adr.data ? (typeof adr.data.content === 'string' ? adr.data.content : '') : null;
  const error = adr.error;
  const [draft, setDraft] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    if (draft == null) return;
    setBusy(true);
    try {
      await knowledgeAction('knowledge-adr', [projectId, folder, { mode: 'update', content: draft }]);
      setDraft(null);
    } catch (err: any) { Alert.alert('The decision record was not saved', err.message); }
    setBusy(false);
  };

  if (draft != null) {
    const bytes = utf8Bytes(draft);
    return (
      <ScrollView contentContainerStyle={kstyles.page} keyboardShouldPersistTaps="handled">
        <TextInput style={[kstyles.input, kstyles.mono, styles.adr]} value={draft} onChangeText={setDraft} multiline autoCorrect={false} accessibilityLabel="Decision record" />
        <Text style={[kstyles.help, bytes > 8000 && styles.over]}>{bytes.toLocaleString('en-US')} / 8,000 bytes</Text>
        <View style={kstyles.bar}>
          <KButton label="Cancel" onPress={() => setDraft(null)} />
          <KButton label="Save" primary onPress={save} busy={busy} disabled={bytes > 8000} />
        </View>
      </ScrollView>
    );
  }
  return (
    <ScrollView contentContainerStyle={kstyles.page}>
      <KError error={error} />
      {content == null && !error ? <KLoading text="Reading the decision record…" /> : null}
      {content != null && !content.trim() ? (
        <>
          <KEmpty>No decision record yet. It is the folder&apos;s architecture decisions in Markdown, kept by codebase-memory-mcp beside the graph; agents read it with manage_adr.</KEmpty>
          <KButton label="Start one" primary onPress={() => setDraft(ADR_TEMPLATE)} />
        </>
      ) : null}
      {content?.trim() ? (
        <>
          <View style={kstyles.bar}><KButton label="Edit" onPress={() => setDraft(content)} /></View>
          <KCard>
            <View style={styles.pad}>
              <MarkdownPreview root={folder} path="ADR.md" content={content} />
            </View>
          </KCard>
        </>
      ) : null}
    </ScrollView>
  );
}

// --- Coverage ---

export function CoverageView({ projectId, folder }: ViewProps) {
  const q = useKnowledgeQuery(projectId, folder, 'index_status', { verbose: true, diagnostics: 'summary' });
  if (q.isLoading) return <View style={kstyles.page}><KLoading text="Reading the index…" /></View>;
  if (q.error) return <View style={kstyles.page}><KError error={q.error} /></View>;
  const g = indexGaps(q.data);
  const list = (title: string, items: { path: string; ranges?: string | null; reason?: string | null }[]) => (items.length ? (
    <KCard title={title} meta={String(items.length)}>
      {items.slice(0, 200).map((f, i) => (
        <View key={`${f.path}${i}`} style={[styles.pad, styles.gap]}>
          <Text style={styles.file} numberOfLines={1} ellipsizeMode="head">{f.path}</Text>
          {f.ranges ? <Text style={kstyles.help}>lines {f.ranges}</Text> : null}
          {f.reason ? <Text style={kstyles.help}>{f.reason}</Text> : null}
        </View>
      ))}
    </KCard>
  ) : null);
  return (
    <ScrollView contentContainerStyle={kstyles.page}>
      {list('Read in part', g.partial)}
      {list('Could not read', g.unusable)}
      {list('Skipped', g.skipped)}
      <KCard title="Left out on purpose" meta={`${Math.max(g.counts.notIndexed, g.notIndexed.length)} files · ${Math.max(g.counts.notIndexedDirs, g.notIndexedDirs.length)} folders`}>
        {g.notIndexedDirs.length ? <Text style={[styles.file, styles.pad]}>{g.notIndexedDirs.join(' · ')}</Text> : null}
        <Chips items={Object.entries(g.notIndexed.reduce<Record<string, number>>((acc, f) => { const r = f.reason || 'other'; acc[r] = (acc[r] || 0) + 1; return acc; }, {})).map(([key, count]) => ({ key, label: key, count }))} />
      </KCard>
      {!g.partial.length && !g.unusable.length && !g.skipped.length ? <KEmpty>Every source file was read whole. (A clean index means no recorded gap, not proof that nothing is missing.)</KEmpty> : null}
    </ScrollView>
  );
}

// --- Compare ---

export function CompareView({ projectId, status }: ViewProps) {
  const indexed = status.folders.filter((f) => f.indexed);
  const [base, setBase] = useState<string | null>(indexed[0]?.path ?? null);
  const [target, setTarget] = useState<string | null>(indexed[1]?.path ?? null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [result, setResult] = useState<ReturnType<typeof compareModel> | null>(null);
  const [picking, setPicking] = useState<'base' | 'target' | null>(null);
  if (indexed.length < 2) {
    return <View style={kstyles.page}><KEmpty>Compare puts two indexed folders of this project side by side, such as a worktree and its main checkout. Index a second folder first; for what a branch changes, use Impact.</KEmpty></View>;
  }
  const label = (p: string | null) => (p ? p.split('/').pop() || p : 'Pick');
  const run = async () => {
    if (!base || !target || base === target) return;
    setBusy(true); setError(null);
    try { setResult(compareModel(await knowledgeAction('knowledge-compare', [projectId, base, target, { limit: 1000 }]))); } catch (err) { setError(err); }
    setBusy(false);
  };
  const names = (items: KnowledgeSymbol[]) => items.slice(0, 200).map((n, i) => <SymbolRow key={`${n.qn}${i}`} item={n} />);
  return (
    <ScrollView contentContainerStyle={kstyles.page}>
      <View style={kstyles.bar}>
        <KButton label={label(base)} onPress={() => setPicking('base')} />
        <Text style={kstyles.help}>→</Text>
        <KButton label={label(target)} onPress={() => setPicking('target')} />
      </View>
      <KButton label="Compare" primary onPress={run} busy={busy} disabled={!base || !target || base === target} />
      <KError error={error} />
      {result ? (
        <>
          {result.partial ? <Text style={[kstyles.help, styles.over]}>Partial: codebase-memory-mcp cut its lists short.</Text> : null}
          <KCard title={`Only in ${label(target)}`} meta={String(result.addedNodes.length)}>{names(result.addedNodes)}</KCard>
          <KCard title={`Only in ${label(base)}`} meta={String(result.removedNodes.length)}>{names(result.removedNodes)}</KCard>
          <KCard title="Calls added" meta={String(result.addedEdges.length)}>{result.addedEdges.slice(0, 200).map((e, i) => <Text key={i} style={[styles.file, styles.pad]}>{e.from} → {e.to}</Text>)}</KCard>
          <KCard title="Calls removed" meta={String(result.removedEdges.length)}>{result.removedEdges.slice(0, 200).map((e, i) => <Text key={i} style={[styles.file, styles.pad]}>{e.from} → {e.to}</Text>)}</KCard>
        </>
      ) : null}
      <Sheet
        visible={!!picking}
        title={picking === 'base' ? 'From' : 'To'}
        onClose={() => setPicking(null)}
        options={indexed.map((f) => ({ label: label(f.path), hint: f.path, onPress: () => { if (picking === 'base') setBase(f.path); else setTarget(f.path); setPicking(null); } }))}
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  pad: { paddingHorizontal: spacing.md, paddingVertical: spacing.xs },
  gap: { gap: 2 },
  file: { color: colors.text, fontFamily: MONO, fontSize: 12.5 },
  query: { minHeight: 120, paddingTop: spacing.sm, textAlignVertical: 'top' },
  adr: { minHeight: 320, paddingTop: spacing.sm, textAlignVertical: 'top' },
  over: { color: colors.danger },
  tr: { flexDirection: 'row' },
  td: { width: 160, paddingHorizontal: spacing.sm, paddingVertical: 6, color: colors.text, fontFamily: MONO, fontSize: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  th: { color: colors.textDim, fontWeight: '700' },
});
