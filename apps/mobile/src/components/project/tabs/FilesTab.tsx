import Ionicons from '@expo/vector-icons/Ionicons';
import { useQueries, useQueryClient } from '@tanstack/react-query';
import * as Clipboard from 'expo-clipboard';
import { router } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Platform, Pressable, RefreshControl, ScrollView, StyleSheet, Text, ToastAndroid, View } from 'react-native';
import { create } from 'zustand';

import { DownloadBar } from '@/components/files/DownloadBar';
import { FileView } from '@/components/files/FileView';
import { Sheet, type SheetOption } from '@/components/Sheet';
import { TextPrompt } from '@/components/TextPrompt';
import { downloadProjectFile, downloadSupported } from '@/files/download';
import {
  appendMention, byteSize, chatMention, filesRoots, foldersToList, joinPath, parentRelative, pasteTarget, remapExpanded, treeRows,
  type FileEntry,
} from '@/files/model';
import { PaneLayout, usePaneMode } from '@/layout/PaneLayout';
import { projectSessions, type Project } from '@/projects/model';
import { act } from '@/projects/queries';
import { useProjectUi } from '@/projects/ui-store';
import { useOpenSession } from '@/projects/open-session';
import { getDraft, setDraftText } from '@/sessions/drafts';
import { sessionTitle, type Session } from '@/sessions/model';
import { request, useCapability, useConnection } from '@/store/connection';
import { colors, spacing } from '@/theme';

type Listing = { ok: boolean; entries?: FileEntry[]; error?: string };

/** What Cut or Copy picked, for Paste: in this tab or another project's. */
const useFilesClipboard = create<{ clip: { mode: 'copy' | 'cut'; root: string; rel: string; name: string } | null }>(() => ({ clip: null }));

const ICONS: Record<string, keyof typeof Ionicons.glyphMap> = {
  image: 'image-outline', pdf: 'document-outline', text: 'document-text-outline', html: 'code-slash-outline',
};

const NONE: string[] = [];

// iOS cannot show a sheet while the previous one is still sliding away.
const AFTER_SHEET_MS = Platform.OS === 'ios' ? 450 : 0;

/** Tree beside the file from this width up (tablets, a phone on its side). */
const TWO_PANE = 600;

type Prompt = { title: string; confirm: string; initial: string; run: (value: string) => void };

/**
 * The project's files, as on the desktop: a tab for the project folder and
 * one for each attached folder, each a tree. Tapping a file opens it (beside
 * the tree on a wide screen); a long press offers the explorer's actions.
 */
export function FilesTab({ project }: { project: Project }) {
  const openInTab = useOpenSession();
  const queryClient = useQueryClient();
  const online = useConnection((s) => s.status.state === 'online');
  const live = useConnection((s) => s.live);
  // The file opens beside the tree, or on a Surface Duo's other screen, rather than on its own page.
  const wide = usePaneMode(TWO_PANE) !== 'single';
  const roots = useMemo(() => filesRoots(project), [project]);
  const [ui, patchUi] = useProjectUi(project.id, (u) => u.files);
  const root = roots.some((r) => r.path === ui?.root) ? ui!.root! : project.root;
  const expandedList = ui?.expanded?.[root] ?? NONE;
  const expanded = useMemo(() => new Set(expandedList), [expandedList]);
  const selected = ui?.selected?.[root] ?? null;
  const clip = useFilesClipboard((s) => s.clip);
  const [menu, setMenu] = useState<FileEntry | 'root' | null>(null);
  const [chats, setChats] = useState<{ entry: FileEntry; sessions: Session[] } | null>(null);
  const [prompt, setPrompt] = useState<Prompt | null>(null);

  const can = {
    create: useCapability('create-project-entry'),
    duplicate: useCapability('duplicate-project-entry'),
    paste: useCapability('paste-project-entry'),
    timeline: useCapability('get-file-timeline'),
    manage: useCapability('manage-project-entry'),
    download: useCapability('read-project-file-chunk'),
  };

  const patchFiles = useCallback((partial: { root?: string; expanded?: Record<string, string[]>; selected?: Record<string, string | null> }) => {
    patchUi({ files: { ...ui, ...partial } });
  }, [patchUi, ui]);

  const folders = foldersToList(expanded);
  const listings = useQueries({
    queries: folders.map((rel) => ({
      queryKey: ['directory', root, rel],
      queryFn: () => request<Listing>('list-project-directory', [root, rel]),
      enabled: online,
    })),
  });
  const byFolder: Record<string, FileEntry[] | undefined> = {};
  folders.forEach((rel, i) => { byFolder[rel] = listings[i]?.data?.entries; });
  const rows = treeRows(byFolder, expanded);
  const rootListing = listings[0];
  const refreshing = listings.some((q) => q.isRefetching);

  const setExpanded = (next: string[]) => patchFiles({ expanded: { ...(ui?.expanded ?? {}), [root]: next } });
  const select = (rel: string | null) => patchFiles({ selected: { ...(ui?.selected ?? {}), [root]: rel } });
  const toggle = (rel: string) => setExpanded(expanded.has(rel) ? expandedList.filter((r) => r !== rel) : [...expandedList, rel]);

  const refresh = () => { queryClient.invalidateQueries({ queryKey: ['directory'] }); };
  const afterChange = () => {
    queryClient.invalidateQueries({ queryKey: ['directory'] });
    queryClient.invalidateQueries({ queryKey: ['file'] });
  };
  const run = async (what: string, fn: () => Promise<unknown>) => {
    try { await fn(); } catch (err: any) { Alert.alert(`Could not ${what}`, err.message); }
    afterChange();
  };

  const open = (entry: FileEntry) => {
    if (entry.type === 'directory') { toggle(entry.relativePath); return; }
    if (wide) select(entry.relativePath);
    else router.push({ pathname: '/file', params: { root, path: entry.relativePath } });
  };

  // --- Actions ---

  const newEntry = (folderRel: string, kind: 'file' | 'folder') => setPrompt({
    title: kind === 'file' ? 'New file (a/b.md makes folders too)' : 'New folder',
    confirm: 'Create',
    initial: '',
    run: (name) => {
      if (!name) return;
      run(`create the ${kind}`, async () => {
        const result = await act<{ relativePath: string }>('create-project-entry', [root, folderRel, name, kind]);
        const parts = result.relativePath.split('/');
        const open = new Set(expandedList);
        for (let i = 1; i < parts.length; i++) open.add(parts.slice(0, i).join('/'));
        if (kind === 'folder') open.add(result.relativePath);
        setExpanded([...open]);
        if (kind === 'file') {
          if (wide) select(result.relativePath);
          else router.push({ pathname: '/file', params: { root, path: result.relativePath } });
        }
      });
    },
  });

  const rename = (entry: FileEntry) => setPrompt({
    title: `Rename ${entry.name}`,
    confirm: 'Rename',
    initial: entry.name,
    run: (name) => {
      if (!name || name === entry.name) return;
      run('rename it', async () => {
        const result = await act<{ newRelativePath: string }>('manage-project-entry', [root, entry.relativePath, 'rename', name]);
        setExpanded(remapExpanded(expandedList, entry.relativePath, result.newRelativePath));
        if (selected === entry.relativePath) select(result.newRelativePath);
      });
    },
  });

  const trash = (entry: FileEntry) => Alert.alert(
    `Delete “${entry.name}”?`,
    `${entry.type === 'directory' ? 'The folder and everything in it go' : 'The file goes'} to the Trash on the computer.`,
    [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete', style: 'destructive', onPress: () => run('delete it', async () => {
          await act('manage-project-entry', [root, entry.relativePath, 'trash']);
          setExpanded(remapExpanded(expandedList, entry.relativePath, null));
          if (selected === entry.relativePath) select(null);
        }),
      },
    ],
  );

  // Started once the menu has slid away: iOS cannot show the share sheet over a sheet still closing.
  const download = (entry: FileEntry) => setTimeout(() => {
    downloadProjectFile(root, entry.relativePath, entry.name)
      .then((outcome) => { if (outcome === 'saved' && Platform.OS === 'android') ToastAndroid.show(`Saved ${entry.name}`, ToastAndroid.SHORT); })
      .catch((err: any) => Alert.alert(`Could not download “${entry.name}”`, err?.message || String(err)));
  }, AFTER_SHEET_MS);

  const paste = (target: FileEntry | null) => {
    const current = useFilesClipboard.getState().clip;
    if (!current) return;
    const folderRel = pasteTarget(target);
    run('paste', async () => {
      await act('paste-project-entry', [current.root, current.rel, root, folderRel, current.mode === 'cut' ? 'move' : 'copy']);
      if (current.mode === 'cut') useFilesClipboard.setState({ clip: null });
      if (folderRel && !expanded.has(folderRel)) setExpanded([...expandedList, folderRel]);
    });
  };

  /** Running Claude and Codex sessions of the project, the most recent first. */
  const runningChats = () => projectSessions(project)
    .filter((s) => s.type !== 'terminal' && live[s.sessionId] && !live[s.sessionId].exited)
    .sort((a, b) => Date.parse(b.modified || '') - Date.parse(a.modified || ''));

  const addToChat = (session: Session, entry: FileEntry) => {
    const mention = chatMention(session.runtime, session.projectPath, joinPath(root, entry.relativePath));
    setDraftText(session.sessionId, appendMention(getDraft(session.sessionId).text, mention));
    openInTab(session.sessionId, 'chat');
  };

  const addToNewChat = (entry: FileEntry) => {
    const cwd = project.defaultCwd || project.root;
    router.push({ pathname: '/new', params: { target: `p:${project.id}`, prompt: chatMention('claude', cwd, joinPath(root, entry.relativePath)) } });
  };

  const openTerminal = (folderRel: string) => run('open a terminal', async () => {
    const result = await act<{ sessionId?: string }>('launch-session', [{ mode: 'new', projectPath: joinPath(root, folderRel), projectId: project.id, runtime: 'terminal' }]);
    if (result.sessionId) openInTab(result.sessionId, 'terminal');
  });

  const menuOptions = (target: FileEntry | 'root'): SheetOption[] => {
    const entry = target === 'root' ? null : target;
    const isDir = !entry || entry.type === 'directory';
    const rel = entry?.relativePath ?? '';
    const folderRel = isDir ? rel : parentRelative(rel);
    const options: SheetOption[] = [];
    if (isDir && can.create) {
      options.push({ label: 'New File…', onPress: () => newEntry(rel, 'file') }, { label: 'New Folder…', onPress: () => newEntry(rel, 'folder') });
    }
    if (entry && !isDir) options.push({ label: 'Open', onPress: () => open(entry) });
    options.push({ label: 'Open in Terminal', hint: 'a terminal session in this folder on the computer', onPress: () => openTerminal(folderRel) });
    if (entry) {
      const kind = isDir ? 'Folder' : 'File';
      const running = runningChats();
      options.push({
        label: `Add ${kind} to Chat`,
        hint: running.length === 1 ? sessionTitle(running[0]) : running.length ? `${running.length} running chats` : 'no running chat',
        onPress: () => {
          if (!running.length) Alert.alert('No running chat', 'Start a Claude or Codex session in this project first, or use Add to New Chat.');
          else if (running.length === 1) addToChat(running[0], entry);
          else setChats({ entry, sessions: running });
        },
      });
      options.push({ label: `Add ${kind} to New Chat`, onPress: () => addToNewChat(entry) });
      if (can.timeline) {
        options.push({ label: 'Open Timeline', onPress: () => router.push({ pathname: '/timeline', params: { root, path: rel, name: entry.name, dir: isDir ? '1' : '' } }) });
      }
      if (can.paste) {
        options.push(
          { label: 'Cut', onPress: () => useFilesClipboard.setState({ clip: { mode: 'cut', root, rel, name: entry.name } }) },
          { label: 'Copy', onPress: () => useFilesClipboard.setState({ clip: { mode: 'copy', root, rel, name: entry.name } }) },
        );
      }
    }
    if (can.paste && clip) options.push({ label: `Paste “${clip.name}”`, hint: clip.mode === 'cut' ? 'move it here' : 'a copy here', onPress: () => paste(entry) });
    options.push({ label: 'Copy Path', onPress: () => { Clipboard.setStringAsync(joinPath(root, rel)).catch(() => {}); } });
    if (entry) {
      options.push({ label: 'Copy Relative Path', onPress: () => { Clipboard.setStringAsync(rel).catch(() => {}); } });
      if (can.manage) options.push({ label: 'Rename…', onPress: () => rename(entry) });
      if (can.duplicate) options.push({ label: 'Duplicate', onPress: () => run('duplicate it', () => act('duplicate-project-entry', [root, rel])) });
      // Always offered on a phone, so it is not missed: a computer whose Switchboard
      // cannot send files yet says how to get there.
      if (downloadSupported() && entry.type === 'file') {
        options.push(can.download
          ? { label: 'Download', hint: byteSize(entry.size), onPress: () => download(entry) }
          : {
            label: 'Download',
            hint: 'update Switchboard on the computer first',
            onPress: () => Alert.alert(
              'Update Switchboard on the computer',
              'Downloading a file to this phone needs a newer Switchboard on the computer (Switchboard Fork 1.1 or later). Update it there, then try again.',
            ),
          });
      }
      if (can.manage) options.push({ label: 'Delete', destructive: true, onPress: () => trash(entry) });
    }
    return options;
  };

  // --- Drawing ---

  const rootTabs = (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.roots} contentContainerStyle={styles.rootsContent}>
      {roots.map((r) => {
        const active = r.path === root;
        return (
          <Pressable
            key={r.path}
            onPress={() => patchFiles({ root: r.path })}
            style={[styles.rootTab, active && styles.rootTabActive]}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
          >
            <Ionicons name={r.kind === 'project' ? 'document-text-outline' : r.kind === 'worktree' ? 'git-branch-outline' : 'folder-outline'} size={14} color={active ? colors.accent : colors.textFaint} />
            <Text style={[styles.rootLabel, active && styles.rootLabelActive]} numberOfLines={1}>{r.label}</Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );

  const toolbar = (
    <View style={styles.toolbar}>
      <Text style={styles.toolbarTitle} numberOfLines={1}>{root === project.root ? 'Project folder' : root.split('/').pop()}</Text>
      {can.create ? <ToolButton icon="document-outline" label="New file" onPress={() => newEntry('', 'file')} /> : null}
      {can.create ? <ToolButton icon="folder-outline" label="New folder" onPress={() => newEntry('', 'folder')} /> : null}
      {can.paste && clip ? <ToolButton icon="clipboard-outline" label={`Paste ${clip.name}`} onPress={() => paste(null)} /> : null}
      <ToolButton icon="remove-circle-outline" label="Collapse folders" onPress={() => setExpanded([])} />
      <ToolButton icon="ellipsis-horizontal" label="Folder actions" onPress={() => setMenu('root')} />
    </View>
  );

  const list = (
    <FlatList
      data={rows}
      keyExtractor={(row) => row.entry.relativePath}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.accent} />}
      renderItem={({ item: { entry, depth } }) => {
        const isDir = entry.type === 'directory';
        const isOpen = isDir && expanded.has(entry.relativePath);
        const cut = clip?.mode === 'cut' && clip.root === root && clip.rel === entry.relativePath;
        const dim = (!isDir && !entry.viewable) || cut;
        return (
          <Pressable
            onPress={() => open(entry)}
            onLongPress={() => setMenu(entry)}
            style={({ pressed }) => [styles.row, { paddingLeft: spacing.md + depth * 18 }, wide && selected === entry.relativePath && styles.rowSelected, pressed && styles.pressed]}
            accessibilityRole="button"
            accessibilityLabel={`${entry.name}${isDir ? (isOpen ? ', open folder' : ', folder') : ''}`}
          >
            <View style={styles.chevron}>{isDir ? <Ionicons name={isOpen ? 'chevron-down' : 'chevron-forward'} size={13} color={colors.textFaint} /> : null}</View>
            <Ionicons name={isDir ? (isOpen ? 'folder-open-outline' : 'folder-outline') : ICONS[entry.previewType || ''] || 'document-outline'} size={16} color={isDir ? colors.accent : dim ? colors.textFaint : colors.textDim} />
            <Text style={[styles.name, isDir && styles.folderName, dim && { color: colors.textFaint }]} numberOfLines={1}>{entry.name}</Text>
          </Pressable>
        );
      }}
      ListEmptyComponent={rootListing?.isLoading ? <ActivityIndicator style={{ margin: spacing.lg }} color={colors.accent} />
        : <Text style={styles.empty}>{rootListing?.data?.error || (root === project.root ? 'The project folder is empty.' : 'This folder is empty.')}</Text>}
      ListFooterComponent={root === project.root && !wide ? <Text style={styles.hint}>Each attached folder has its own tab above. Long-press a file or folder for more.</Text> : undefined}
    />
  );

  return (
    <View style={styles.screen}>
      {rootTabs}
      <PaneLayout
        list={<>{toolbar}{list}</>}
        detail={selected ? <FileView key={`${root}:${selected}`} root={root} path={selected} inline /> : null}
        placeholder="Pick a file to read or edit it here."
        minWidth={TWO_PANE}
        listWidth={(width) => (width >= 840 ? 290 : 250)}
      />
      <DownloadBar />

      <Sheet visible={!!menu} title={menu === 'root' ? (root === project.root ? 'Project folder' : root) : menu?.relativePath} options={menu ? menuOptions(menu) : []} onClose={() => setMenu(null)} />
      <Sheet
        visible={!!chats}
        title="Add to which chat?"
        options={(chats?.sessions || []).map((s) => ({ label: sessionTitle(s), hint: s.runtime === 'codex' ? 'Codex' : 'Claude', onPress: () => chats && addToChat(s, chats.entry) }))}
        onClose={() => setChats(null)}
      />
      <TextPrompt
        visible={!!prompt}
        title={prompt?.title || ''}
        initialValue={prompt?.initial || ''}
        confirm={prompt?.confirm}
        onClose={() => setPrompt(null)}
        onSubmit={(value) => prompt?.run(value)}
      />
    </View>
  );
}

function ToolButton({ icon, label, onPress }: { icon: keyof typeof Ionicons.glyphMap; label: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} hitSlop={6} style={({ pressed }) => [styles.tool, pressed && styles.pressed]} accessibilityRole="button" accessibilityLabel={label}>
      <Ionicons name={icon} size={18} color={colors.textDim} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  roots: { flexGrow: 0, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  rootsContent: { gap: spacing.sm, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  rootTab: { flexDirection: 'row', alignItems: 'center', gap: 6, height: 34, paddingHorizontal: spacing.md, borderRadius: 8, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, maxWidth: 220 },
  rootTabActive: { borderColor: 'rgba(128,136,255,0.5)', backgroundColor: 'rgba(128,136,255,0.16)' },
  rootLabel: { color: colors.textDim, fontSize: 13.5, fontWeight: '600', flexShrink: 1 },
  rootLabelActive: { color: '#e4e4fa' },
  toolbar: { flexDirection: 'row', alignItems: 'center', gap: 2, paddingLeft: spacing.lg, paddingRight: spacing.sm, height: 44 },
  toolbarTitle: { flex: 1, color: colors.textDim, fontSize: 12.5, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5 },
  tool: { width: 40, height: 40, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: 44, paddingRight: spacing.lg },
  rowSelected: { backgroundColor: 'rgba(120,130,255,0.14)' },
  pressed: { backgroundColor: colors.surface },
  chevron: { width: 13, alignItems: 'center' },
  name: { color: colors.text, fontSize: 14.5, flex: 1 },
  folderName: { fontWeight: '500' },
  empty: { color: colors.textFaint, textAlign: 'center', marginTop: spacing.xl, paddingHorizontal: spacing.lg },
  hint: { color: colors.textFaint, fontSize: 12, lineHeight: 17, padding: spacing.lg },
});
