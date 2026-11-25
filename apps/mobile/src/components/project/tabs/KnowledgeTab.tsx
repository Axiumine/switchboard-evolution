import { useState, type ReactNode } from 'react';
import { Alert, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';

import { KButton, KCard, KEmpty, KError, KLoading, KSection, KSeg, kstyles, SymbolRow, Chips } from '@/components/knowledge/parts';
import { AdrView, CompareView, CoverageView, ImpactView, openSymbol, QueryView, SearchView, TraceView } from '@/components/knowledge/views';
import { Sheet } from '@/components/Sheet';
import { chooseFolder, folderLabel, linkableFolders, worktreeNote } from '@/knowledge/model';
import { knowledgeAction, SLOW_TIMEOUT_MS, useKnowledgeQuery, useKnowledgeStatus, useKnowledgeSupported, type KnowledgeFolder, type KnowledgeStatus } from '@/knowledge/queries';
import type { Project } from '@/projects/model';
import { KNOWLEDGE_VIEWS, parseKnowledgeView, type KnowledgeView } from '@/projects/tabs';
import { useProjectUi } from '@/projects/ui-store';
import { ago, architectureModel, indexSummary, INDEX_MODES, jobActive, jobText, TOOL_PROFILES } from '@/shared/vendor/knowledge-model';
import { colors, spacing } from '@/theme';

const baseName = (p: string) => p.split('/').filter(Boolean).pop() || p;

/**
 * The Node Knowledge tab: the project's attached folders as code graphs kept
 * by codebase-memory-mcp on the computer (the desktop's tab, but the Lens).
 * Every view asks the computer, which names the CBM project itself.
 */
export function KnowledgeTab({ project, active = true }: { project: Project; active?: boolean }) {
  const supported = useKnowledgeSupported();
  // Two selectors of plain values: an object made in the selector would be new at every render.
  const [savedView, patchUi] = useProjectUi(project.id, (u) => u.knowledgeView);
  const [savedFolder] = useProjectUi(project.id, (u) => u.knowledgeFolder);
  const view = parseKnowledgeView(savedView);
  const status = useKnowledgeStatus(project.id, active);
  const [picking, setPicking] = useState(false);

  if (!supported) {
    return <View style={kstyles.page}><KEmpty>The computer does not offer Node Knowledge. Update Switchboard Evolution on it.</KEmpty></View>;
  }
  const data = status.data;
  const folders = data?.folders || [];
  const folder = chooseFolder(folders, savedFolder);
  const current = folders.find((f) => f.path === folder) || null;

  let body: ReactNode;
  if (status.isLoading && !data) body = <View style={kstyles.page}><KLoading text="Asking the computer…" /></View>;
  else if (status.error) body = <View style={kstyles.page}><KError error={status.error} /></View>;
  else if (!data) body = null;
  else body = <Gate project={project} status={data} view={view} folder={current} />;

  return (
    <View style={styles.screen}>
      <View style={styles.bar}>
        <KSeg label="Node Knowledge view" value={view} onChange={(v: KnowledgeView) => patchUi({ knowledgeView: v })} options={KNOWLEDGE_VIEWS} />
        {folders.length > 1 && current ? (
          <KButton label={`${folderLabel(current)}${current.indexed ? '' : ' (not indexed)'}`} onPress={() => setPicking(true)} />
        ) : null}
      </View>
      <View style={styles.body}>{body}</View>
      <Sheet
        visible={picking}
        title="Folder"
        onClose={() => setPicking(false)}
        options={folders.map((f) => ({ label: folderLabel(f), hint: f.indexed ? f.path : `${f.path} · not indexed`, onPress: () => { patchUi({ knowledgeFolder: f.path }); setPicking(false); } }))}
      />
    </View>
  );
}

/** What the view needs before it can show: CBM on the computer, a folder, a graph of it. */
function Gate({ project, status, view, folder }: { project: Project; status: KnowledgeStatus; view: KnowledgeView; folder: KnowledgeFolder | null }) {
  const found = status.binary.found;
  if (!found || !found.ok) {
    return (
      <View style={kstyles.page}>
        <KEmpty>{found ? `codebase-memory-mcp ${found.version} on the computer is too old (${status.binary.minimum} or later).` : 'The computer has no codebase-memory-mcp yet.'} Install it from the desktop&apos;s Node Knowledge tab.</KEmpty>
      </View>
    );
  }
  if (!folder) return <View style={kstyles.page}><KEmpty>This project has no folder to index yet.</KEmpty></View>;
  if (view === 'settings') return <SettingsView project={project} status={status} />;
  // Only a first index takes the page; a refresh of a graph there leaves the view as it is.
  if (folder.job && jobActive(folder.job) && !folder.indexed) {
    return <View style={kstyles.page}><KLoading text={`${jobText(folder.job)} ${baseName(folder.path)}`} /><Text style={kstyles.help}>A large repository takes a minute or two the first time; afterwards only what changed is read again.</Text></View>;
  }
  if (!folder.indexed) return <IndexPrompt project={project} status={status} folder={folder} />;
  const props = { projectId: project.id, folder: folder.path, status };
  switch (view) {
    case 'search': return <SearchView {...props} />;
    case 'trace': return <TraceView {...props} />;
    case 'impact': return <ImpactView {...props} />;
    case 'query': return <QueryView {...props} />;
    case 'adr': return <AdrView {...props} />;
    case 'coverage': return <CoverageView {...props} />;
    case 'compare': return <CompareView {...props} />;
    default: return <OverviewView project={project} status={status} folder={folder} />;
  }
}

function IndexPrompt({ project, status, folder }: { project: Project; status: KnowledgeStatus; folder: KnowledgeFolder }) {
  const [busy, setBusy] = useState(false);
  const index = async () => {
    setBusy(true);
    try { await knowledgeAction('knowledge-index', [project.id, folder.path, { mode: status.settings.mode }]); } catch (err: any) { Alert.alert('Indexing did not start', err.message); }
    setBusy(false);
  };
  return (
    <ScrollView contentContainerStyle={kstyles.page}>
      <KCard title={`${baseName(folder.path)} has no code graph yet`}>
        <Text style={[kstyles.help, styles.pad]}>Indexing reads the folder&apos;s source into a graph of its functions, classes, routes and the calls between them, on the computer.</Text>
        {folder.job?.state === 'failed' ? <View style={styles.pad}><KError error={jobText(folder.job)} /></View> : null}
        <View style={styles.pad}><KButton label={`Index ${baseName(folder.path)}`} primary busy={busy} onPress={index} /></View>
      </KCard>
    </ScrollView>
  );
}

function OverviewView({ project, status, folder }: { project: Project; status: KnowledgeStatus; folder: KnowledgeFolder }) {
  const arch = useKnowledgeQuery(project.id, folder.path, 'get_architecture', { aspects: ['overview'] });
  const model = arch.data ? architectureModel(arch.data) : null;
  const refresh = async (path: string) => {
    try { await knowledgeAction('knowledge-index', [project.id, path, {}]); } catch (err: any) { Alert.alert('Indexing did not start', err.message); }
  };
  const section = (id: string) => model?.sections.find((s) => s.id === id);
  const languages = section('languages');
  const hotspots = section('hotspots');
  const entries = section('entry_points');
  const packages = section('packages');
  return (
    <ScrollView contentContainerStyle={kstyles.page}>
      <KSection>{status.folders.length > 1 ? 'Folders' : 'Folder'}</KSection>
      {status.folders.map((f) => {
        const sum = f.indexed && f.index ? indexSummary(f.index) : null;
        const busy = f.job && jobActive(f.job);
        return (
          <KCard key={f.path} title={folderLabel(f)} meta={busy ? jobText(f.job) : sum ? `${sum.nodes.toLocaleString('en-US')} nodes · ${ago(sum.indexedAt)}` : 'not indexed'} right={busy ? null : <KButton label={sum ? 'Refresh' : 'Index'} onPress={() => refresh(f.path)} />}>
            {sum && sum.crossRepo.status === 'ran' ? <Text style={[kstyles.help, styles.pad]}>Linked with {sum.crossRepo.targets.join(', ') || 'nothing'} · {sum.crossRepo.edges} cross-repo calls</Text> : null}
            {sum && (sum.gaps.files || sum.gaps.partial) ? <Text style={[kstyles.help, styles.pad]}>{sum.gaps.files} files left out · {sum.gaps.partial} read in part</Text> : null}
            {f.inner?.length ? <Text style={[kstyles.help, styles.pad]}>{f.inner.length} other graph{f.inner.length === 1 ? '' : 's'} of folders inside it repeat part of this one (see Coverage)</Text> : null}
          </KCard>
        );
      })}
      <KSection>Architecture of {baseName(folder.path)}</KSection>
      {arch.isLoading ? <KLoading text="Reading the architecture…" /> : null}
      <KError error={arch.error} />
      {languages ? <KCard title="Languages"><Chips items={languages.rows.map((r: any) => ({ key: String(r.language), label: String(r.language), count: Number(r.files) || 0 }))} /></KCard> : null}
      {hotspots?.rows.length ? (
        <KCard title="Hotspots" meta="the most called code">
          {hotspots.rows.slice(0, 15).map((r: any, i) => <SymbolRow key={`${r.qn}${i}`} item={{ qn: String(r.qn), name: String(r.qn).split('.').pop() || '', label: null, file: null, start: null, end: null }} extra={`${r.fan_in} callers`} onPress={() => openSymbol(project.id, folder.path, String(r.qn))} />)}
        </KCard>
      ) : null}
      {entries?.rows.length ? (
        <KCard title="Entry points">
          {entries.rows.slice(0, 15).map((r: any, i) => <SymbolRow key={`${r.qn}${i}`} item={{ qn: String(r.qn), name: String(r.qn).split('.').pop() || '', label: null, file: r.file ? String(r.file) : null, start: null, end: null }} onPress={() => openSymbol(project.id, folder.path, String(r.qn))} />)}
        </KCard>
      ) : null}
      {packages?.rows.length ? <KCard title="Packages"><Chips items={packages.rows.map((r: any) => ({ key: String(r.name), label: String(r.name), count: Number(r.nodes) || 0 }))} /></KCard> : null}
    </ScrollView>
  );
}

function SettingsView({ project, status }: { project: Project; status: KnowledgeStatus }) {
  const settings = status.settings;
  const [mode, setMode] = useState(false);
  const [profile, setProfile] = useState(false);
  const save = async (patch: Record<string, unknown>) => {
    try { await knowledgeAction('set-knowledge-settings', [project.id, patch]); } catch (err: any) { Alert.alert('Not saved', err.message); }
  };
  const remove = (f: KnowledgeFolder) => Alert.alert(`Delete the code graph of ${baseName(f.path)}?`, 'codebase-memory-mcp forgets what it read there, and its decision record. The folder is not touched.', [
    { text: 'Cancel', style: 'cancel' },
    { text: 'Delete graph', style: 'destructive', onPress: () => knowledgeAction('knowledge-delete-index', [project.id, f.path]).catch((err) => Alert.alert('Not deleted', err.message)) },
  ]);
  const row = (label: string, help: string, control: ReactNode) => (
    <View style={styles.row}>
      <View style={styles.rowText}><Text style={styles.rowLabel}>{label}</Text><Text style={kstyles.help}>{help}</Text></View>
      {control}
    </View>
  );
  return (
    <ScrollView contentContainerStyle={kstyles.page}>
      <KSection>Code graph</KSection>
      <KCard>
        {row('Use the code graph', 'On in new projects. Index the project folder and the attached folders (each one that joins, and those without a graph when turned on), one graph each, keep the graphs fresh, tell the project\'s agents about them, and give their sessions the graph\'s tools.', <Switch value={settings.enabled} onValueChange={(v) => save({ enabled: v })} accessibilityLabel="Use the code graph" />)}
        {row('Refresh automatically', 'After a commit, a checkout or saved files.', <Switch value={settings.autoRefresh} onValueChange={(v) => save({ autoRefresh: v })} accessibilityLabel="Refresh automatically" />)}
        {row('Link the repositories', 'Find the calls one folder makes into another.', <Switch value={settings.crossRepo} onValueChange={(v) => save({ crossRepo: v })} accessibilityLabel="Link the repositories" />)}
        {row('How much to read', INDEX_MODES.find((m) => m.id === settings.mode)?.hint || '', <KButton label={INDEX_MODES.find((m) => m.id === settings.mode)?.label || 'Full'} onPress={() => setMode(true)} />)}
        {row('Tools in the sessions', 'When the computer adds the server to a session.', <KButton label={TOOL_PROFILES.find((p) => p.id === settings.toolProfile)?.label || 'All tools'} onPress={() => setProfile(true)} />)}
      </KCard>
      <KSection>Folders</KSection>
      <KCard>
        {status.folders.map((f) => (
          <View key={f.path} style={styles.folder}>
            <Text style={styles.rowLabel}>{folderLabel(f)}</Text>
            <Text style={kstyles.help}>{f.name ? `CBM name: ${f.name}` : 'Not indexed yet'}</Text>
            {worktreeNote(f) ? <Text style={kstyles.help}>{worktreeNote(f)}</Text> : null}
            {f.mode === 'project' ? <Text style={kstyles.help}>The project&apos;s own folder (plans, notes, tools), where its sessions start. Its graph keeps out the folders inside it that have one of their own.</Text> : (
              <View style={kstyles.bar}>
                <Switch value={!!settings.share[f.path]} onValueChange={(v) => save({ share: { [f.path]: v } })} accessibilityLabel="Share with the team" />
                <Text style={kstyles.help}>Share with the team</Text>
              </View>
            )}
            <View style={kstyles.bar}>
              <KButton label={f.indexed ? 'Re-index' : 'Index'} onPress={() => knowledgeAction('knowledge-index', [project.id, f.path, {}]).catch((err) => Alert.alert('Not started', err.message))} />
              {f.indexed && f.mode !== 'project' ? <KButton label="Delete graph…" danger onPress={() => remove(f)} /> : null}
            </View>
          </View>
        ))}
        {linkableFolders(status.folders).length > 1 ? <View style={styles.pad}><KButton label="Link now" onPress={() => knowledgeAction('knowledge-link-cross-repo', [project.id], { timeoutMs: SLOW_TIMEOUT_MS }).catch((err) => Alert.alert('Not linked', err.message))} /></View> : null}
      </KCard>
      {status.agents ? (
        <>
          <KSection>Agents</KSection>
          <KCard>
            <Text style={[kstyles.help, styles.pad]}>Claude Code: {status.agents.claude === 'global' ? 'has it in its own config' : 'gets it per session from the computer'}</Text>
            <Text style={[kstyles.help, styles.pad]}>Codex: {status.agents.codex === 'global' ? 'has it in its own config' : 'gets it per session from the computer'}</Text>
          </KCard>
        </>
      ) : null}
      <Text style={kstyles.help}>The program the computer runs, codebase-memory-mcp&apos;s own settings and the Lens are on the desktop, in Settings › Node Knowledge.</Text>
      <Sheet visible={mode} title="How much to read" onClose={() => setMode(false)} options={INDEX_MODES.map((m) => ({ label: m.label, hint: m.hint, onPress: () => { save({ mode: m.id }); setMode(false); } }))} />
      <Sheet visible={profile} title="Tools in the sessions" onClose={() => setProfile(false)} options={TOOL_PROFILES.map((p) => ({ label: p.label, hint: p.hint, onPress: () => { save({ toolProfile: p.id }); setProfile(false); } }))} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  bar: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  body: { flex: 1 },
  pad: { paddingHorizontal: spacing.md, paddingVertical: spacing.xs },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, minHeight: 56 },
  rowText: { flex: 1, gap: 2 },
  rowLabel: { color: colors.text, fontSize: 15, fontWeight: '600' },
  folder: { paddingHorizontal: spacing.md, paddingVertical: spacing.sm, gap: spacing.xs, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
});
