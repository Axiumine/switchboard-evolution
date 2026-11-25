import Ionicons from '@expo/vector-icons/Ionicons';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { memo, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { FileIcon } from '@/components/files/FileIcon';
import { SearchIconButton as IconButton, SearchToggle as Toggle } from '@/components/search/SearchControls';
import {
  dismissFile, dismissMatch, EMPTY_SEARCH, matchParts, NO_DISMISSED, replaceOpts, replaceReport, replacementText, replaceTargets, resultRows,
  searchOpts, splitPath, summaryText, visibleFiles, type Dismissed, type ReplaceResult, type ResultRow, type SearchFile, type SearchForm,
  type SearchMatch, type SearchResult,
} from '@/files/search';
import { useDebounced } from '@/files/useDebounced';
import { act } from '@/projects/queries';
import { request, useConnection } from '@/store/connection';
import { colors, spacing } from '@/theme';

const mono = Platform.select({ ios: 'Menlo', default: 'monospace' });

const NO_FILES: SearchFile[] = [];
const NONE: ReadonlySet<string> = new Set();

/**
 * The Files tab's Search mode, as VS Code's Search view: a query with its
 * toggles, a replace field (when the computer can replace), optional globs of
 * files to include and exclude, and the results by file. It searches `root`,
 * the folder of the Files tab's current tab.
 */
export function SearchPanel({ root, folderName, canReplace, onOpen, onClose }: {
  root: string;
  folderName: string;
  /** The computer offers replace-in-project-files. */
  canReplace: boolean;
  /** Open a file at a line (1-based). */
  onOpen: (path: string, line: number) => void;
  onClose: () => void;
}) {
  const online = useConnection((s) => s.status.state === 'online');
  const queryClient = useQueryClient();
  const [form, setFormState] = useState<SearchForm>(EMPTY_SEARCH);
  const [replaceOpen, setReplaceOpen] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(NONE);
  const [dismissedAt, setDismissedAt] = useState<{ at: number; dismissed: Dismissed }>({ at: 0, dismissed: NO_DISMISSED });
  const [replacing, setReplacing] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const setForm = (patch: Partial<SearchForm>) => { setFormState((f) => ({ ...f, ...patch })); setNotice(null); };

  // The search follows the typing, once it pauses; the replace text is not part of it.
  const optsKey = JSON.stringify(searchOpts(form));
  const settledKey = useDebounced(optsKey, 350);
  const settledOpts = settledKey === 'null' ? null : JSON.parse(settledKey);
  const search = useQuery({
    queryKey: ['search', root, settledKey],
    queryFn: () => request<SearchResult>('search-project-files', [root, settledOpts]),
    enabled: online && !!settledOpts,
    placeholderData: keepPreviousData,
    staleTime: 0,
    gcTime: 30_000,
    retry: false,
  });
  const waiting = optsKey !== settledKey;
  const data = optsKey === 'null' ? undefined : search.data;
  const failure = data && !data.ok ? data.error || 'The search failed.' : search.error ? (search.error as Error).message : null;
  const found = data?.ok ? data.files ?? NO_FILES : NO_FILES;
  const limitHit = !!data?.ok && !!data.limitHit;

  // What is dismissed belongs to the results it was dismissed from.
  const dismissed = dismissedAt.at === search.dataUpdatedAt ? dismissedAt.dismissed : NO_DISMISSED;
  const files = useMemo(() => visibleFiles(found, dismissed), [found, dismissed]);
  const rows = useMemo(() => resultRows(files, collapsed), [files, collapsed]);
  const dismiss = (next: Dismissed) => setDismissedAt({ at: search.dataUpdatedAt, dismissed: next });

  const toggleCollapsed = (path: string) => setCollapsed((current) => {
    const next = new Set(current);
    if (!next.delete(path)) next.add(path);
    return next;
  });

  const replaceActive = canReplace && replaceOpen && form.replace !== '';

  const runReplace = async (scope: Parameters<typeof replaceTargets>[1]) => {
    const targets = replaceTargets(files, scope);
    if (!targets.length) return;
    setReplacing(true);
    try {
      const result = await act<ReplaceResult>('replace-in-project-files', [root, replaceOpts(form, targets)], { timeoutMs: 120_000 });
      const report = replaceReport(result);
      queryClient.invalidateQueries({ queryKey: ['file'] });
      queryClient.invalidateQueries({ queryKey: ['directory'] });
      await search.refetch();
      if (report.message || !result.replaced) Alert.alert(report.title, report.message || undefined);
      else setNotice(report.title);
    } catch (err: any) {
      Alert.alert('Could not replace', err?.message || String(err));
    } finally {
      setReplacing(false);
    }
  };

  // Replace All always asks first. One file or one match asks only when the replace field is empty, which deletes what it finds.
  const confirmReplace = (scope: Parameters<typeof replaceTargets>[1], where: string, always = false) => {
    const targets = replaceTargets(files, scope);
    const count = targets.reduce((sum, t) => sum + t.matches.length, 0);
    if (!count) return;
    if (!always && form.replace !== '') { runReplace(scope); return; }
    const into = form.replace === '' ? 'nothing (it is deleted)' : `“${form.replace}”`;
    Alert.alert(
      `Replace ${count} ${count === 1 ? 'match' : 'matches'} in ${targets.length} ${targets.length === 1 ? 'file' : 'files'}?`,
      `“${form.query}” becomes ${into} ${where}. This changes files on the computer.`,
      [{ text: 'Cancel', style: 'cancel' }, { text: 'Replace', style: 'destructive', onPress: () => { runReplace(scope); } }],
    );
  };

  const replaceAll = () => confirmReplace({}, 'in every result shown', true);
  const replaceFile = (path: string) => confirmReplace({ path }, `in ${path}`);
  const replaceOne = (path: string, match: SearchMatch) => confirmReplace({ path, match }, `at ${path}:${match.line}`);

  const renderRow = ({ item }: { item: ResultRow }) => item.kind === 'file' ? (
    <FileRow
      file={item.file}
      collapsed={item.collapsed}
      canReplace={canReplace && replaceOpen && !replacing}
      onToggle={toggleCollapsed}
      onReplace={replaceFile}
      onDismiss={(path) => dismiss(dismissFile(dismissed, path))}
    />
  ) : (
    <MatchRow
      path={item.path}
      match={item.match}
      replacement={replaceActive ? replacementText(form, item.match) : null}
      canReplace={canReplace && replaceOpen && !replacing}
      onOpen={onOpen}
      onReplace={replaceOne}
      onDismiss={(path, match) => dismiss(dismissMatch(dismissed, path, match))}
    />
  );

  let status: { text: string; error?: boolean } | null = null;
  if (failure) status = { text: failure, error: true };
  else if (notice) status = { text: notice };
  else if (form.query && data?.ok) status = { text: summaryText(files, limitHit) };

  return (
    <View style={styles.panel}>
      <View style={styles.header}>
        <Text style={styles.title} numberOfLines={1}>Search · {folderName}</Text>
        <IconButton icon="close" label="Close search" onPress={onClose} />
      </View>

      <View style={styles.form}>
        <View style={styles.formRow}>
          {canReplace ? (
            <Pressable
              onPress={() => setReplaceOpen((open) => !open)}
              style={styles.chevron}
              hitSlop={6}
              accessibilityRole="button"
              accessibilityLabel={replaceOpen ? 'Hide replace' : 'Show replace'}
              accessibilityState={{ expanded: replaceOpen }}
            >
              <Ionicons name={replaceOpen ? 'chevron-down' : 'chevron-forward'} size={16} color={colors.textDim} />
            </Pressable>
          ) : null}
          <View style={[styles.field, !!failure && styles.fieldError]}>
            <TextInput
              value={form.query}
              onChangeText={(query) => setForm({ query })}
              placeholder="Search"
              placeholderTextColor={colors.textFaint}
              autoCapitalize="none"
              autoCorrect={false}
              returnKeyType="search"
              style={styles.input}
              accessibilityLabel="Search text"
            />
            <Toggle on={form.matchCase} label="Match case" onPress={() => setForm({ matchCase: !form.matchCase })}>
              <Text style={[styles.toggleText, form.matchCase && styles.toggleTextOn]}>Aa</Text>
            </Toggle>
            <Toggle on={form.wholeWord} label="Match whole word" onPress={() => setForm({ wholeWord: !form.wholeWord })}>
              <Text style={[styles.toggleText, styles.underline, form.wholeWord && styles.toggleTextOn]}>ab</Text>
            </Toggle>
            <Toggle on={form.isRegex} label="Use regular expression" onPress={() => setForm({ isRegex: !form.isRegex })}>
              <Text style={[styles.toggleText, styles.mono, form.isRegex && styles.toggleTextOn]}>.*</Text>
            </Toggle>
          </View>
          <IconButton icon="ellipsis-horizontal" label={detailsOpen ? 'Hide files to include and exclude' : 'Show files to include and exclude'} active={detailsOpen} onPress={() => setDetailsOpen((open) => !open)} />
        </View>

        {canReplace && replaceOpen ? (
          <View style={styles.formRow}>
            <View style={styles.chevron} />
            <View style={styles.field}>
              <TextInput
                value={form.replace}
                onChangeText={(replace) => setForm({ replace })}
                placeholder="Replace"
                placeholderTextColor={colors.textFaint}
                autoCapitalize="none"
                autoCorrect={false}
                style={styles.input}
                accessibilityLabel="Replace with"
              />
              <Toggle on={form.preserveCase} label="Preserve case" onPress={() => setForm({ preserveCase: !form.preserveCase })}>
                <Text style={[styles.toggleText, form.preserveCase && styles.toggleTextOn]}>AB</Text>
              </Toggle>
            </View>
            <Pressable
              onPress={replaceAll}
              disabled={!files.length || replacing}
              style={({ pressed }) => [styles.replaceAll, (!files.length || replacing) && styles.disabled, pressed && styles.pressed]}
              accessibilityRole="button"
              accessibilityLabel="Replace all"
            >
              {replacing ? <ActivityIndicator size="small" color={colors.accent} /> : <Ionicons name="swap-horizontal" size={16} color={colors.accent} />}
              <Text style={styles.replaceAllText}>All</Text>
            </Pressable>
          </View>
        ) : null}

        {detailsOpen ? (
          <>
            <GlobField label="files to include" placeholder="Files to include, e.g. src, *.ts" value={form.include} onChange={(include) => setForm({ include })} />
            <GlobField label="files to exclude" placeholder="Files to exclude, e.g. dist, **/*.test.ts" value={form.exclude} onChange={(exclude) => setForm({ exclude })} />
          </>
        ) : null}
      </View>

      <View style={styles.statusRow}>
        {status ? <Text style={[styles.status, status.error && styles.statusError]} numberOfLines={3}>{status.text}</Text> : <View style={styles.statusFill} />}
        {waiting || (search.isFetching && !!settledOpts) ? <ActivityIndicator size="small" color={colors.accent} /> : null}
      </View>

      <FlatList
        data={rows}
        keyExtractor={(row) => row.key}
        renderItem={renderRow}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        initialNumToRender={24}
        ListEmptyComponent={form.query ? undefined : <Text style={styles.hint}>Type to search the files in {folderName}.</Text>}
      />
    </View>
  );
}

const FileRow = memo(function FileRow({ file, collapsed, canReplace, onToggle, onReplace, onDismiss }: {
  file: SearchFile;
  collapsed: boolean;
  canReplace: boolean;
  onToggle: (path: string) => void;
  onReplace: (path: string) => void;
  onDismiss: (path: string) => void;
}) {
  const { name, folder } = splitPath(file.path);
  return (
    <Pressable
      onPress={() => onToggle(file.path)}
      style={({ pressed }) => [styles.fileRow, pressed && styles.pressed]}
      accessibilityRole="button"
      accessibilityLabel={`${file.path}, ${file.matches.length} ${file.matches.length === 1 ? 'result' : 'results'}`}
      accessibilityState={{ expanded: !collapsed }}
    >
      <Ionicons name={collapsed ? 'chevron-forward' : 'chevron-down'} size={13} color={colors.textFaint} style={styles.fileChevron} />
      <FileIcon name={name} size={18} />
      <Text style={styles.fileName} numberOfLines={1}>{name}</Text>
      {folder ? <Text style={styles.fileFolder} numberOfLines={1}>{folder}</Text> : <View style={styles.spacer} />}
      <Text style={styles.count}>{file.matches.length}</Text>
      {canReplace ? <IconButton icon="swap-horizontal" label={`Replace in ${name}`} small onPress={() => onReplace(file.path)} /> : null}
      <IconButton icon="close" label={`Dismiss ${name}`} small onPress={() => onDismiss(file.path)} />
    </Pressable>
  );
});

const MatchRow = memo(function MatchRow({ path, match, replacement, canReplace, onOpen, onReplace, onDismiss }: {
  path: string;
  match: SearchMatch;
  /** What the match becomes, when the replace field holds something. */
  replacement: string | null;
  canReplace: boolean;
  onOpen: (path: string, line: number) => void;
  onReplace: (path: string, match: SearchMatch) => void;
  onDismiss: (path: string, match: SearchMatch) => void;
}) {
  const { before, text, after } = matchParts(match);
  return (
    <Pressable
      onPress={() => onOpen(path, match.line)}
      style={({ pressed }) => [styles.matchRow, pressed && styles.pressed]}
      accessibilityRole="button"
      accessibilityLabel={`Line ${match.line}: ${match.before}${match.text}${match.after}`}
    >
      <Text style={styles.matchLine} numberOfLines={1}>
        <Text style={styles.lineNo}>{match.line}  </Text>
        {before}
        {replacement === null ? <Text style={styles.hit}>{text}</Text> : (
          <>
            <Text style={styles.removed}>{text}</Text>
            <Text style={styles.added}>{replacement}</Text>
          </>
        )}
        {after}
      </Text>
      {canReplace ? <IconButton icon="swap-horizontal" label={`Replace at line ${match.line}`} small onPress={() => onReplace(path, match)} /> : null}
      <IconButton icon="close" label={`Dismiss line ${match.line}`} small onPress={() => onDismiss(path, match)} />
    </Pressable>
  );
});

function GlobField({ label, placeholder, value, onChange }: { label: string; placeholder: string; value: string; onChange: (value: string) => void }) {
  return (
    <View style={styles.formRow}>
      {/* Lines up with the query field above, which has the replace chevron before it. */}
      <View style={styles.chevronSpace} />
      <View style={styles.field}>
        <TextInput
          value={value}
          onChangeText={onChange}
          placeholder={placeholder}
          placeholderTextColor={colors.textFaint}
          autoCapitalize="none"
          autoCorrect={false}
          style={styles.input}
          accessibilityLabel={label}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  panel: { flex: 1, backgroundColor: colors.background },
  header: { flexDirection: 'row', alignItems: 'center', gap: 2, paddingLeft: spacing.lg, paddingRight: spacing.sm, height: 44 },
  title: { flex: 1, color: colors.textDim, fontSize: 12.5, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5 },
  form: { gap: 6, paddingHorizontal: spacing.sm, paddingBottom: spacing.sm },
  formRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  chevron: { width: 22, height: 36, alignItems: 'center', justifyContent: 'center' },
  chevronSpace: { width: 22 },
  field: { flex: 1, flexDirection: 'row', alignItems: 'center', minHeight: 38, paddingRight: 4, gap: 2, borderRadius: 8, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  fieldError: { borderColor: colors.danger },
  input: { flex: 1, minWidth: 0, color: colors.text, fontSize: 14.5, paddingHorizontal: spacing.md, paddingVertical: 6 },
  toggleText: { color: colors.textDim, fontSize: 13, fontWeight: '600' },
  toggleTextOn: { color: '#e4e4fa' },
  underline: { textDecorationLine: 'underline' },
  mono: { fontFamily: mono },
  replaceAll: { flexDirection: 'row', alignItems: 'center', gap: 4, height: 38, paddingHorizontal: spacing.md, borderRadius: 8, backgroundColor: 'rgba(128,136,255,0.14)' },
  replaceAllText: { color: colors.accent, fontSize: 14, fontWeight: '600' },
  disabled: { opacity: 0.4 },
  pressed: { backgroundColor: colors.surface },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.lg, minHeight: 22, paddingBottom: 4 },
  status: { flex: 1, color: colors.textDim, fontSize: 12 },
  statusError: { color: colors.danger },
  statusFill: { flex: 1 },
  hint: { color: colors.textFaint, textAlign: 'center', marginTop: spacing.xl, paddingHorizontal: spacing.lg },
  fileRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: 38, paddingLeft: spacing.md, paddingRight: 4 },
  fileChevron: { width: 13 },
  fileName: { color: colors.text, fontSize: 14, fontWeight: '500', flexShrink: 1 },
  fileFolder: { flex: 1, color: colors.textFaint, fontSize: 12 },
  spacer: { flex: 1 },
  count: { minWidth: 20, textAlign: 'center', color: colors.textDim, fontSize: 11, fontWeight: '700', paddingHorizontal: 5, paddingVertical: 1, borderRadius: 9, overflow: 'hidden', backgroundColor: 'rgba(255,255,255,0.08)' },
  matchRow: { flexDirection: 'row', alignItems: 'center', minHeight: 34, paddingLeft: spacing.md + 13 + spacing.sm + 18 + spacing.sm, paddingRight: 4 },
  matchLine: { flex: 1, color: colors.textDim, fontSize: 13 },
  lineNo: { color: colors.textFaint, fontSize: 11, fontFamily: mono },
  hit: { color: colors.text, backgroundColor: 'rgba(128,136,255,0.32)' },
  removed: { color: colors.text, textDecorationLine: 'line-through', backgroundColor: 'rgba(224,108,117,0.3)' },
  added: { color: colors.text, backgroundColor: 'rgba(76,175,143,0.3)' },
});
