import Ionicons from '@expo/vector-icons/Ionicons';
import { useQueries, useQueryClient } from '@tanstack/react-query';
import * as Clipboard from 'expo-clipboard';
import { router } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Platform, Pressable, ScrollView, StyleSheet, Text, ToastAndroid, View } from 'react-native';
import { create } from 'zustand';

import { FileIcon } from '@/components/files/FileIcon';
import { SearchPanel } from '@/components/files/SearchPanel';
import { FileView } from '@/components/files/FileView';
import { usePullRefresh } from '@/components/PullRefresh';
import { Sheet, type SheetOption } from '@/components/Sheet';
import { TextPrompt } from '@/components/TextPrompt';
import { downloadProjectFile, downloadProjectFiles, downloadSupported, type DownloadItem, type TransferOutcome } from '@/files/download';
import {
  appendMention, byteSize, chatMention, filesRoots, foldersToList, joinPath, parentRelative, pasteTarget, remapExpanded, treeRows,
  type FileEntry,
} from '@/files/model';
import { afterTrash, downloadItems, trashPicked } from '@/files/selection';
import { downloadQuestion, transferDoneText, transferFailures, uploadClashQuestion } from '@/files/transfer-text';
import { pickUploads, uploadFiles, type UploadConflict, type UploadItem, type UploadSource } from '@/files/upload';
import { PaneLayout, usePaneMode } from '@/layout/PaneLayout';
import { projectSessions, type Project } from '@/projects/model';
import { act } from '@/projects/queries';
import { useProjectUi, useProjectUiStore } from '@/projects/ui-store';
import { useOpenSession } from '@/projects/open-session';
import { getDraft, setDraftText } from '@/sessions/drafts';
import { cliLabel, sessionTitle, type Session } from '@/sessions/model';
import { collectFolders, failuresText, invertSelection, selectAll, topLevelPicks, trashQuestion } from '@/shared/vendor/file-selection';
import { request, useCapability, useConnection } from '@/store/connection';
import { colors, spacing } from '@/theme';

type Listing = { ok: boolean; entries?: FileEntry[]; error?: string };

/** What Cut or Copy picked, for Paste: in this tab or another project's. */
const useFilesClipboard = create<{ clip: { mode: 'copy' | 'cut'; root: string; rel: string; name: string } | null }>(() => ({ clip: null }));

const NONE: string[] = [];
const NOTHING: ReadonlySet<string> = new Set();

// iOS cannot show a sheet while the previous one is still sliding away.
const AFTER_SHEET_MS = Platform.OS === 'ios' ? 450 : 0;

/** Room for the checkboxes before the indent, with Enable Selection on. */
const CHECK_COLUMN = 28;

/** Tree beside the file from this width up (tablets, a phone on its side). */
const TWO_PANE = 600;

type Prompt = { title: string; confirm: string; initial: string; run: (value: string) => void };

/**
 * Open `folderRel` of `root` in the project's tree, from the store as it is
 * now: an upload takes a while, and the tab may have moved on meanwhile.
 */
function expandFolder(projectId: string, root: string, folderRel: string) {
  const { get, patch } = useProjectUiStore.getState();
  const files = get(projectId).files;
  const open = files?.expanded?.[root] ?? [];
  if (!folderRel || open.includes(folderRel)) return;
  patch(projectId, { files: { ...files, expanded: { ...(files?.expanded ?? {}), [root]: [...open, folderRel] } } });
}

/** After several files went down or up: what did not go and why, or a short line that they did. */
function reportTransfer(kind: 'download' | 'upload', outcome: TransferOutcome, total: number) {
  const failures = transferFailures(kind, outcome, total);
  if (failures) Alert.alert(failures.title, failures.detail);
  else if (Platform.OS === 'android') ToastAndroid.show(transferDoneText(kind, outcome, total), ToastAndroid.SHORT);
  // On iOS the files are in a folder of Files, out of sight: say so. An upload shows in the tree.
  else if (kind === 'download' && outcome.done) Alert.alert(transferDoneText(kind, outcome, total));
}

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
    trashMany: useCapability('trash-project-entries'),
    download: useCapability('read-project-file-chunk'),
    upload: useCapability('upload-project-file-chunk'),
    search: useCapability('search-project-files'),
    replace: useCapability('replace-in-project-files'),
  };
  // Search mode replaces the tree in the list; its form is kept while the tab is on screen, so closing it and opening it again finds what was typed.
  const [searching, setSearching] = useState(false);
  const [searchOpened, setSearchOpened] = useState(false);
  const [selectedLine, setSelectedLine] = useState<number | null>(null);
  const searchOn = searching && can.search;
  // Enable Selection in the "•••" menu: a checkbox on every row, for Download N
  // Selected and Delete N Selected. Kept for the folder it was turned on in;
  // another tab drops it.
  const [selection, setSelection] = useState<{ root: string; picked: ReadonlySet<string> } | null>(null);
  const selecting = selection?.root === root;
  const picked = selecting ? selection.picked : NOTHING;
  const setPicked = (next: ReadonlySet<string>) => setSelection({ root, picked: next });
  const togglePick = (rel: string) => {
    const next = new Set(picked);
    if (next.has(rel)) next.delete(rel); else next.add(rel);
    setPicked(next);
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
  const visibleRels = rows.map((row) => row.entry.relativePath);

  const setExpanded = (next: string[]) => patchFiles({ expanded: { ...(ui?.expanded ?? {}), [root]: next } });
  const select = (rel: string | null) => patchFiles({ selected: { ...(ui?.selected ?? {}), [root]: rel } });
  const toggle = (rel: string) => setExpanded(expanded.has(rel) ? expandedList.filter((r) => r !== rel) : [...expandedList, rel]);

  const pull = usePullRefresh(() => queryClient.invalidateQueries({ queryKey: ['directory'] }));
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
    if (wide) { setSelectedLine(null); select(entry.relativePath); }
    else router.push({ pathname: '/file', params: { root, path: entry.relativePath } });
  };

  /** A search result: the file open at the line of the match. */
  const openAtLine = (path: string, line: number) => {
    if (wide) { setSelectedLine(line); select(path); }
    else router.push({ pathname: '/file', params: { root, path, line: String(line) } });
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

  /** The entries the tree has listed, by relative path. */
  const knownEntries = () => {
    const known = new Map<string, FileEntry>();
    for (const entries of Object.values(byFolder)) for (const entry of entries ?? []) known.set(entry.relativePath, entry);
    return known;
  };

  /** Delete N Selected: one question, then everything ticked to the Trash on the computer. */
  const trashSelection = () => {
    const known = knownEntries();
    const rels = topLevelPicks(picked);
    if (!rels.length) return;
    const question = trashQuestion(rels.map((rel) => ({ rel, isDir: known.get(rel)?.type === 'directory' })));
    setTimeout(() => Alert.alert(question.title, question.detail, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: question.confirm, style: 'destructive', onPress: () => run('delete them', async () => {
          const outcome = await trashPicked({ root, picked: rels, canTrashMany: can.trashMany, call: act });
          const next = afterTrash(expandedList, selected, outcome.removed);
          patchFiles({ expanded: { ...(ui?.expanded ?? {}), [root]: next.expanded }, selected: { ...(ui?.selected ?? {}), [root]: next.selected } });
          if (outcome.failed.length) {
            // What could not go stays ticked.
            setPicked(new Set(outcome.failed.map((item) => item.rel)));
            Alert.alert('Some items were not moved', failuresText(outcome.failed));
          } else {
            setSelection(null);
          }
        }),
      },
    ]), AFTER_SHEET_MS);
  };

  // Started once the menu has slid away: iOS cannot show the share sheet over a sheet still closing.
  const download = (entry: FileEntry) => setTimeout(() => {
    downloadProjectFile(root, entry.relativePath, entry.name)
      .then((outcome) => { if (outcome === 'saved' && Platform.OS === 'android') ToastAndroid.show(`Saved ${entry.name}`, ToastAndroid.SHORT); })
      .catch((err: any) => Alert.alert(`Could not download “${entry.name}”`, err?.message || String(err)));
  }, AFTER_SHEET_MS);

  /** A folder of this root as the computer lists it now; an error it sends back throws. */
  const listFolder = async (rel: string): Promise<FileEntry[]> => {
    const listing = await queryClient.fetchQuery({
      queryKey: ['directory', root, rel],
      queryFn: () => request<Listing>('list-project-directory', [root, rel]),
    });
    if (!listing?.ok) throw new Error(listing?.error || 'The computer did not list the folder');
    return listing.entries ?? [];
  };

  const startDownloads = (items: DownloadItem[]) => {
    downloadProjectFiles(root, items)
      .then((outcome) => { if (outcome) reportTransfer('download', outcome, items.length); })
      .catch((err: any) => Alert.alert('Could not download them', err?.message || String(err)));
  };

  /**
   * Download N Selected: the ticked files, and what is in the ticked folders,
   * into a folder picked on the phone. With folders ticked it says first how
   * many files that is. The ticks stay, for Delete N Selected after.
   */
  const downloadSelection = () => {
    const known = knownEntries();
    const rels = topLevelPicks(picked);
    if (!rels.length) return;
    setTimeout(async () => {
      let items: Awaited<ReturnType<typeof downloadItems>>;
      try {
        items = await downloadItems(rels, known, listFolder);
      } catch (err: any) {
        Alert.alert('Could not download them', err?.message || String(err));
        return;
      }
      if (!items.length) {
        Alert.alert('Nothing to download', 'There are no files in what is ticked.');
        return;
      }
      if (!rels.some((rel) => known.get(rel)?.type === 'directory')) {
        startDownloads(items);
        return;
      }
      const question = downloadQuestion(items.length, byteSize(items.reduce((sum, item) => sum + item.size, 0)));
      Alert.alert(question.title, question.detail, [
        { text: 'Cancel', style: 'cancel' },
        // The folder picker opens once the question has gone.
        { text: question.confirm, onPress: () => setTimeout(() => startDownloads(items), AFTER_SHEET_MS) },
      ]);
    }, AFTER_SHEET_MS);
  };

  const startUploads = (folderRel: string, items: UploadItem[], conflict: UploadConflict) => {
    const forRoot = root;
    uploadFiles(forRoot, folderRel, items, conflict)
      .then((outcome) => {
        reportTransfer('upload', outcome, items.length);
        // The folder open, to show what arrived.
        if (outcome.done) expandFolder(project.id, forRoot, folderRel);
      })
      .catch((err: any) => Alert.alert('Could not upload', err?.message || String(err)))
      .finally(afterChange);
  };

  /**
   * Upload Files… / Upload Photos…: picked on the phone, several at once, into
   * `folderRel`. Names already in the folder ask first: replace them (the old
   * ones to the Trash on the computer) or keep both.
   */
  const upload = (folderRel: string, source: UploadSource) => setTimeout(async () => {
    let items: UploadItem[];
    try {
      items = await pickUploads(source);
    } catch (err: any) {
      Alert.alert('Could not open the picker', err?.message || String(err));
      return;
    }
    if (!items.length) return;
    let taken: Set<string>;
    try {
      taken = new Set((await listFolder(folderRel)).map((entry) => entry.name));
    } catch (err: any) {
      Alert.alert('Could not upload', err?.message || String(err));
      return;
    }
    const clashes = items.filter((item) => taken.has(item.name)).map((item) => item.name);
    if (!clashes.length) {
      startUploads(folderRel, items, 'keep-both');
      return;
    }
    const question = uploadClashQuestion(clashes);
    Alert.alert(question.title, question.detail, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Keep Both', onPress: () => startUploads(folderRel, items, 'keep-both') },
      { text: 'Replace', style: 'destructive', onPress: () => startUploads(folderRel, items, 'replace') },
    ]);
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

  /** Running CLI sessions of the project, the most recent first. */
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

  /** The selection part of the folder's "•••" menu. */
  const selectionOptions = (): SheetOption[] => {
    const canDelete = can.manage || can.trashMany;
    // Always offered on a phone, as Download is: an older computer says how to get there.
    const canDownload = downloadSupported();
    if (!canDelete && !canDownload) return [];
    if (!selecting) {
      const then = canDelete && canDownload ? 'download or delete them' : canDelete ? 'delete them' : 'download them';
      return [{ label: 'Enable Selection', hint: `tick files and folders, then ${then} together`, onPress: () => setSelection({ root, picked: new Set() }) }];
    }
    const options: SheetOption[] = [
      { label: 'Select All', hint: `${visibleRels.length} shown`, onPress: () => setPicked(selectAll(visibleRels)) },
    ];
    if (picked.size) options.push({ label: 'Deselect All', onPress: () => setPicked(new Set()) });
    options.push({ label: 'Invert Selection', onPress: () => setPicked(invertSelection(visibleRels, picked)) });
    if (picked.size && canDownload) {
      options.push(can.download
        ? { label: `Download ${picked.size} Selected…`, hint: 'into a folder you pick on this phone', onPress: downloadSelection }
        : { label: `Download ${picked.size} Selected…`, hint: 'update Switchboard Evolution on the computer first', onPress: needsNewerComputer('Downloading files to this phone') });
    }
    if (picked.size && canDelete) options.push({ label: `Delete ${picked.size} Selected…`, destructive: true, onPress: trashSelection });
    options.push({ label: 'Cancel Selection', onPress: () => setSelection(null) });
    return options;
  };

  /** Expand All: every folder, level by level, without node_modules or .git, up to a limit (file-selection.js). */
  const expandAll = () => run('expand the folders', async () => {
    const folders = await collectFolders(async (rel) => {
      const listing = await queryClient.fetchQuery({
        queryKey: ['directory', root, rel],
        queryFn: () => request<Listing>('list-project-directory', [root, rel]),
      });
      return listing?.entries ?? [];
    });
    setExpanded(folders);
  });
  const treeOptions: SheetOption[] = [
    { label: 'Expand All', hint: 'not node_modules or .git', onPress: expandAll },
    { label: 'Collapse All', onPress: () => setExpanded([]) },
  ];

  const menuOptions = (target: FileEntry | 'root'): SheetOption[] => {
    // While ticking, the folder's menu is about the ticks first.
    if (target === 'root' && selecting) return [...selectionOptions(), ...treeOptions, ...entryMenuOptions(target)];
    if (target === 'root') return [...entryMenuOptions(target), ...treeOptions, ...selectionOptions()];
    return entryMenuOptions(target);
  };

  /** For an action an older computer lacks: what to do about it. */
  const needsNewerComputer = (what: string) => () => setTimeout(() => Alert.alert(
    'Update Switchboard Evolution on the computer',
    `${what} needs a newer Switchboard Evolution on the computer. Update it there, then try again.`,
  ), AFTER_SHEET_MS);

  const entryMenuOptions = (target: FileEntry | 'root'): SheetOption[] => {
    const entry = target === 'root' ? null : target;
    const isDir = !entry || entry.type === 'directory';
    const rel = entry?.relativePath ?? '';
    const folderRel = isDir ? rel : parentRelative(rel);
    const options: SheetOption[] = [];
    if (isDir && can.create) {
      options.push({ label: 'New File…', onPress: () => newEntry(rel, 'file') }, { label: 'New Folder…', onPress: () => newEntry(rel, 'folder') });
    }
    // Into this folder, from the phone; offered on a phone as Download is.
    if (isDir && downloadSupported()) {
      options.push(...(can.upload ? [
        { label: 'Upload Files…', hint: 'from this phone, several at once', onPress: () => upload(rel, 'files') },
        { label: 'Upload Photos…', hint: 'from the photo library, several at once', onPress: () => upload(rel, 'photos') },
      ] : [
        { label: 'Upload Files…', hint: 'update Switchboard Evolution on the computer first', onPress: needsNewerComputer('Uploading files from this phone') },
      ]));
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
          if (!running.length) Alert.alert('No running chat', 'Start a Claude, Codex or OpenCode session in this project first, or use Add to New Chat.');
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
          : { label: 'Download', hint: 'update Switchboard Evolution on the computer first', onPress: needsNewerComputer('Downloading a file to this phone') });
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
            <Text style={[styles.rootLabel, active && styles.rootLabelActive]} numberOfLines={1}>
              {r.branch ? <>{r.name}{' · '}<Text style={styles.rootBranch}>{r.branch}</Text></> : r.label}
            </Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );

  const toolbar = (
    <View style={styles.toolbar}>
      <Text style={[styles.toolbarTitle, selecting && styles.toolbarCount]} numberOfLines={1}>
        {selecting ? `${picked.size} selected` : root === project.root ? 'Project folder' : root.split('/').pop()}
      </Text>
      {can.create ? <ToolButton icon="document-outline" label="New file" onPress={() => newEntry('', 'file')} /> : null}
      {can.create ? <ToolButton icon="folder-outline" label="New folder" onPress={() => newEntry('', 'folder')} /> : null}
      {can.search ? <ToolButton icon="search-outline" label="Search in this folder" onPress={() => { setSearchOpened(true); setSearching(true); }} /> : null}
      {can.paste && clip ? <ToolButton icon="clipboard-outline" label={`Paste ${clip.name}`} onPress={() => paste(null)} /> : null}
      <ToolButton icon="remove-circle-outline" label="Collapse folders" onPress={() => setExpanded([])} />
      <ToolButton icon="ellipsis-horizontal" label="Folder actions" onPress={() => setMenu('root')} />
    </View>
  );

  const list = (
    <FlatList
      data={rows}
      extraData={picked}
      keyExtractor={(row) => row.entry.relativePath}
      refreshControl={pull}
      renderItem={({ item: { entry, depth } }) => {
        const isDir = entry.type === 'directory';
        const isOpen = isDir && expanded.has(entry.relativePath);
        const cut = clip?.mode === 'cut' && clip.root === root && clip.rel === entry.relativePath;
        const dim = (!isDir && !entry.viewable) || cut;
        return (
          <Pressable
            onPress={() => open(entry)}
            onLongPress={() => setMenu(entry)}
            style={({ pressed }) => [
              styles.row,
              { paddingLeft: spacing.md + (selecting ? CHECK_COLUMN : 0) + depth * 18 },
              wide && selected === entry.relativePath && styles.rowSelected,
              selecting && picked.has(entry.relativePath) && styles.rowPicked,
              pressed && styles.pressed,
            ]}
            accessibilityRole="button"
            accessibilityLabel={`${entry.name}${isDir ? (isOpen ? ', open folder' : ', folder') : ''}`}
          >
            {selecting ? (
              <Pressable
                onPress={() => togglePick(entry.relativePath)}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 4 }}
                style={styles.check}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: picked.has(entry.relativePath) }}
                accessibilityLabel={`Select ${entry.name}`}
              >
                <Ionicons
                  name={picked.has(entry.relativePath) ? 'checkbox' : 'square-outline'}
                  size={20}
                  color={picked.has(entry.relativePath) ? colors.accent : colors.textFaint}
                />
              </Pressable>
            ) : null}
            <View style={styles.chevron}>{isDir ? <Ionicons name={isOpen ? 'chevron-down' : 'chevron-forward'} size={13} color={colors.textFaint} /> : null}</View>
            <View style={dim && styles.dimIcon}><FileIcon name={entry.name} dir={isDir} open={isOpen} size={18} /></View>
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
        list={(
          <>
            <View style={[styles.fill, searchOn && styles.hidden]}>{toolbar}{list}</View>
            {searchOpened && can.search ? (
              <View style={[styles.fill, !searchOn && styles.hidden]}>
                <SearchPanel
                  root={root}
                  folderName={root === project.root ? 'the project folder' : root.split('/').pop() || root}
                  canReplace={can.replace}
                  onOpen={openAtLine}
                  onClose={() => setSearching(false)}
                />
              </View>
            ) : null}
          </>
        )}
        detail={selected ? <FileView key={`${root}:${selected}:${selectedLine ?? ''}`} root={root} path={selected} line={selectedLine ?? undefined} inline /> : null}
        placeholder="Pick a file to read or edit it here."
        minWidth={TWO_PANE}
        // Search needs more room than the tree.
        listWidth={(width) => (searchOn ? Math.min(Math.round(width * 0.5), 440) : width >= 840 ? 290 : 250)}
      />

      <Sheet
        visible={!!menu}
        title={menu === 'root' ? (selecting ? `${picked.size} selected` : root === project.root ? 'Project folder' : root) : menu?.relativePath}
        options={menu ? menuOptions(menu) : []}
        onClose={() => setMenu(null)}
      />
      <Sheet
        visible={!!chats}
        title="Add to which chat?"
        options={(chats?.sessions || []).map((s) => ({ label: sessionTitle(s), hint: cliLabel(s), onPress: () => chats && addToChat(s, chats.entry) }))}
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
  fill: { flex: 1 },
  hidden: { display: 'none' },
  roots: { flexGrow: 0, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  rootsContent: { gap: spacing.sm, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  rootTab: { flexDirection: 'row', alignItems: 'center', gap: 6, height: 34, paddingHorizontal: spacing.md, borderRadius: 8, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, maxWidth: 220 },
  rootTabActive: { borderColor: 'rgba(128,136,255,0.5)', backgroundColor: 'rgba(128,136,255,0.16)' },
  rootLabel: { color: colors.textDim, fontSize: 13.5, fontWeight: '600', flexShrink: 1 },
  rootLabelActive: { color: '#e4e4fa' },
  rootBranch: { fontWeight: '700' },
  toolbar: { flexDirection: 'row', alignItems: 'center', gap: 2, paddingLeft: spacing.lg, paddingRight: spacing.sm, height: 44 },
  toolbarTitle: { flex: 1, color: colors.textDim, fontSize: 12.5, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5 },
  tool: { width: 40, height: 40, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: 44, paddingRight: spacing.lg },
  rowSelected: { backgroundColor: 'rgba(120,130,255,0.14)' },
  rowPicked: { backgroundColor: 'rgba(128,136,255,0.08)' },
  check: { position: 'absolute', left: spacing.sm, top: 0, bottom: 0, width: 24, alignItems: 'center', justifyContent: 'center' },
  toolbarCount: { color: colors.accent },
  pressed: { backgroundColor: colors.surface },
  chevron: { width: 13, alignItems: 'center' },
  dimIcon: { opacity: 0.5 },
  name: { color: colors.text, fontSize: 14.5, flex: 1 },
  folderName: { fontWeight: '500' },
  empty: { color: colors.textFaint, textAlign: 'center', marginTop: spacing.xl, paddingHorizontal: spacing.lg },
  hint: { color: colors.textFaint, fontSize: 12, lineHeight: 17, padding: spacing.lg },
});
