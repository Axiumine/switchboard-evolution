import { useMemo } from 'react';
import { ScrollView, StyleSheet } from 'react-native';
import Markdown from 'react-native-markdown-display';

import { fileLinkPress, markdownParser, pathCodeRule, taskItemRule } from '@/components/chat/ChatMarkdown';
import { openPath } from '@/components/chat/OpenFile';
import { markdownStyles } from '@/components/ChatView';
import { FONT_DEFAULT, scaleTextStyles, useEditorFont } from '@/editor/font';
import { joinPath, parentRelative } from '@/files/model';
import { useCapability } from '@/store/connection';
import { spacing } from '@/theme';

/**
 * A Markdown file formatted, at the text size of the editors (the styles are
 * made for the default size and scaled with it). Paths in it open the files
 * they name, relative ones from the file's folder, when the computer can find
 * them: a plan names the files it changes.
 */
export function MarkdownPreview({ root, path, content }: { root: string; path: string; content: string }) {
  const canLocate = useCapability('locate-file');
  const size = useEditorFont((s) => s.size);
  const styles = useMemo(() => scaleTextStyles(markdownStyles, size / FONT_DEFAULT), [size]);
  const links = useMemo(() => {
    const openFile = canLocate && root ? (ref: string) => { openPath(ref, joinPath(root, parentRelative(path || ''))); } : null;
    return { rules: { code_inline: pathCodeRule(openFile), list_item: taskItemRule }, onLinkPress: fileLinkPress(openFile) };
  }, [canLocate, root, path]);
  return (
    <ScrollView contentContainerStyle={layout.content}>
      <Markdown style={styles} rules={links.rules} onLinkPress={links.onLinkPress} markdownit={markdownParser}>{content}</Markdown>
    </ScrollView>
  );
}

const layout = StyleSheet.create({ content: { padding: spacing.lg } });
