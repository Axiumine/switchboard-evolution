import { useQuery } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import { useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Image, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View, type ScrollViewInstance } from 'react-native';
import Markdown from 'react-native-markdown-display';

import { fileLinkPress, markdownParser, pathCodeRule, taskItemRule } from '@/components/chat/ChatMarkdown';
import { openPath } from '@/components/chat/OpenFile';
import { markdownStyles } from '@/components/ChatView';
import { DownloadBar } from '@/components/files/DownloadBar';
import { HeaderButton } from '@/components/HeaderButton';
import { downloadSupported, shareProjectFile, type KnownContent } from '@/files/download';
import { joinPath, parentRelative } from '@/files/model';
import { splitAtLine } from '@/files/search';
import { act } from '@/projects/queries';
import { request, useCapability, useConnection } from '@/store/connection';
import { colors, spacing } from '@/theme';

type FileData = { ok: boolean; error?: string; previewType?: 'text' | 'html' | 'image' | 'pdf' | 'pptx'; content?: string; mimeType?: string; base64?: string; version?: string };

const mono = Platform.select({ ios: 'Menlo', default: 'monospace' });

const CODE_LINE_HEIGHT = 18;
/** Lines of the file kept above the line a search result points at. */
const SCROLL_CONTEXT = 3;

/**
 * A project file: text and Markdown to read or edit, images to look at, and
 * any file to share. `inline` draws its own bar (beside the tree of the Files
 * tab on a wide screen); otherwise its buttons go in the screen's header.
 * Give it a `key` per file, so another file starts with no edit in progress.
 * With `line` (a search result) a text file opens scrolled to that line, which
 * is marked; a Markdown file then opens as raw text, where lines are lines.
 */
export function FileView({ root, path, line, inline = false }: { root: string; path: string; line?: number; inline?: boolean }) {
  const online = useConnection((s) => s.status.state === 'online');
  const file = useQuery({
    queryKey: ['file', root, path],
    queryFn: () => request<FileData>('read-project-file', [root, path]),
    enabled: online && !!root && !!path,
  });
  const [raw, setRaw] = useState(!!line);
  const scroller = useRef<ScrollViewInstance>(null);
  const scrolled = useRef(false);
  const [draft, setDraft] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const name = (path || '').split('/').pop() || 'File';
  const data = file.data;
  const isText = data?.previewType === 'text' || data?.previewType === 'html';
  const isMarkdown = /\.(md|markdown)$/i.test(name);
  const canDownload = useCapability('read-project-file-chunk');
  // Paths in a Markdown file (a plan names the files it changes) open them, relative ones from its folder.
  const canLocate = useCapability('locate-file');
  const links = useMemo(() => {
    const openFile = canLocate && root ? (ref: string) => { openPath(ref, joinPath(root, parentRelative(path || ''))); } : null;
    return { rules: { code_inline: pathCodeRule(openFile), list_item: taskItemRule }, onLinkPress: fileLinkPress(openFile) };
  }, [canLocate, root, path]);

  const save = async () => {
    if (draft === null) return;
    setSaving(true);
    try {
      await act('save-project-file', [root, path, draft, ...(data?.version ? [data.version] : [])]);
      await file.refetch();
      setDraft(null);
    } catch (err: any) {
      Alert.alert('Could not save', err.message);
    } finally {
      setSaving(false);
    }
  };

  // Text and images go as shown; any other file comes down from the computer first.
  const known: KnownContent | undefined = isText ? { text: data?.content ?? '' }
    : data?.previewType === 'image' && data.base64 ? { base64: data.base64 } : undefined;
  const canShare = !!data && downloadSupported();
  const share = () => {
    if (!known && !canDownload) {
      Alert.alert('Share', 'Sharing this kind of file needs a newer Switchboard Evolution on the computer. Update it there, then try again.');
      return;
    }
    shareProjectFile(root, path, name, known)
      .catch((err: any) => Alert.alert(`Could not share “${name}”`, err?.message || String(err)));
  };

  const buttons = () => {
    if (draft !== null) {
      return (
        <View style={styles.textButtons}>
          <Pressable onPress={() => setDraft(null)} hitSlop={10}><Text style={styles.headerButtonDim}>Cancel</Text></Pressable>
          <Pressable onPress={save} disabled={saving} hitSlop={10}><Text style={styles.headerButton}>{saving ? 'Saving…' : 'Save'}</Text></Pressable>
        </View>
      );
    }
    if (!isText && !canShare) return null;
    return (
      <View style={styles.headerButtons}>
        {isText && isMarkdown ? (
          <HeaderButton
            icon={raw ? 'document-text-outline' : 'code-slash-outline'}
            accessibilityLabel={raw ? 'Show formatted' : 'Show raw Markdown'}
            onPress={() => setRaw((r) => !r)}
          />
        ) : null}
        {canShare ? (
          <HeaderButton icon={Platform.OS === 'ios' ? 'share-outline' : 'share-social-outline'} accessibilityLabel={`Share ${name}`} onPress={share} />
        ) : null}
        {isText ? <HeaderButton icon="create-outline" accessibilityLabel={`Edit ${name}`} onPress={() => setDraft(data?.content ?? '')} /> : null}
      </View>
    );
  };

  let body;
  if (file.isLoading) body = <ActivityIndicator style={{ margin: spacing.xl }} color={colors.accent} />;
  else if (!data?.ok) body = <Text style={styles.error}>{data?.error || 'Could not open the file.'}</Text>;
  else if (draft !== null) {
    body = (
      <TextInput
        value={draft}
        onChangeText={setDraft}
        multiline
        autoFocus
        autoCapitalize="none"
        autoCorrect={false}
        textAlignVertical="top"
        style={styles.editor}
      />
    );
  } else if (data.previewType === 'image' && data.base64) {
    body = <ScrollView maximumZoomScale={4} minimumZoomScale={1} contentContainerStyle={styles.imageBox}><Image source={{ uri: `data:${data.mimeType};base64,${data.base64}` }} style={styles.image} resizeMode="contain" /></ScrollView>;
  } else if (isText) {
    const marked = line && !(isMarkdown && !raw) ? splitAtLine(data.content || '', line) : null;
    body = (
      <ScrollView
        ref={scroller}
        contentContainerStyle={styles.content}
        onContentSizeChange={() => {
          // Once, when the text is laid out: the line a few lines down from the top. Lines do not wrap, so each is one line high.
          if (!marked || scrolled.current) return;
          scrolled.current = true;
          scroller.current?.scrollTo({ y: Math.max(0, spacing.lg + (line! - 1 - SCROLL_CONTEXT) * CODE_LINE_HEIGHT), animated: false });
        }}
      >
        {isMarkdown && !raw ? <Markdown style={markdownStyles} rules={links.rules} onLinkPress={links.onLinkPress} markdownit={markdownParser}>{data.content || ''}</Markdown> : (
          <ScrollView horizontal>
            {marked ? (
              <Text style={styles.code} selectable>
                {marked.before}
                <Text style={styles.markedLine}>{marked.target || ' '}</Text>
                {marked.after}
              </Text>
            ) : <Text style={styles.code} selectable>{data.content}</Text>}
          </ScrollView>
        )}
      </ScrollView>
    );
  } else {
    body = <Text style={styles.error}>This kind of file opens on the computer only.</Text>;
  }

  return (
    <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={Platform.OS === 'ios' ? 100 : 0}>
      {inline ? (
        <View style={styles.bar}>
          <View style={styles.barText}>
            <Text style={styles.barName} numberOfLines={1}>{name}</Text>
            <Text style={styles.barPath} numberOfLines={1}>{path}</Text>
          </View>
          {buttons()}
        </View>
      ) : (
        <Stack.Screen options={{ title: name, headerRight: buttons }} />
      )}
      {body}
      {/* The Files tab shows the bar of its own downloads under its tree. */}
      {inline ? null : <DownloadBar />}
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  bar: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, minHeight: 48, paddingHorizontal: spacing.md, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border, backgroundColor: colors.surface },
  barText: { flex: 1, minWidth: 0 },
  barName: { color: colors.text, fontSize: 14, fontWeight: '600' },
  barPath: { color: colors.textFaint, fontSize: 11, fontFamily: mono },
  headerButtons: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  textButtons: { flexDirection: 'row', gap: spacing.lg, paddingHorizontal: spacing.sm },
  headerButton: { color: colors.accent, fontSize: 16, fontWeight: '600' },
  headerButtonDim: { color: colors.textDim, fontSize: 16 },
  content: { padding: spacing.lg },
  code: { color: colors.text, fontFamily: mono, fontSize: 12, lineHeight: CODE_LINE_HEIGHT },
  markedLine: { backgroundColor: 'rgba(128,136,255,0.28)' },
  editor: { flex: 1, color: colors.text, fontFamily: mono, fontSize: 13, lineHeight: 19, padding: spacing.lg },
  imageBox: { flexGrow: 1, alignItems: 'center', justifyContent: 'center' },
  image: { width: '100%', aspectRatio: 1 },
  error: { color: colors.textDim, padding: spacing.lg },
});
