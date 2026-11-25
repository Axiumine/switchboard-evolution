import Ionicons from '@expo/vector-icons/Ionicons';
import { useEffect, useRef, useState, type RefObject } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import type { CodeEditorHandle } from '@/components/files/CodeEditor';
import { SearchIconButton, SearchToggle, searchStyles } from '@/components/search/SearchControls';
import type { FindOptions, FindResult } from '@/editor/bridge';
import { FIND_DEFAULTS, findCountText, findDelay } from '@/files/find';
import { colors, spacing } from '@/theme';

/**
 * Find and replace in the file's editor, as the desktop's find bar: the
 * query with Match Case, Match Whole Word and Use Regular Expression, the
 * count ("3 of 12"), the previous and next match, and (when the text can be
 * edited) a replace row with Preserve Case, Replace and Replace All. The
 * matching is the page's (scripts/editor-page/find.js, the shared
 * text-search.js). The bar sits over the editor; closing it clears the marks.
 */
export function FindBar({ editor, result, canReplace, textLength, onClose }: {
  editor: RefObject<CodeEditorHandle | null>;
  result: FindResult | null;
  canReplace: boolean;
  textLength: number;
  onClose: () => void;
}) {
  const [query, setQuery] = useState('');
  const [replace, setReplace] = useState('');
  const [options, setOptions] = useState<FindOptions>(FIND_DEFAULTS);
  const [replaceOpen, setReplaceOpen] = useState(false);
  const optionsRef = useRef(options);
  useEffect(() => { optionsRef.current = options; }, [options]);

  // Search as the query or an option changes, after a short pause in the typing.
  useEffect(() => {
    const timer = setTimeout(() => editor.current?.find(query, optionsRef.current), findDelay(textLength));
    return () => clearTimeout(timer);
  }, [query, textLength, editor]);
  const setOption = (key: keyof FindOptions) => {
    const next = { ...options, [key]: !options[key] };
    setOptions(next);
    if (key !== 'preserveCase') editor.current?.find(query, next);
  };

  // Closing: the marks go with the bar.
  useEffect(() => () => editor.current?.clearFind(), [editor]);

  const count = findCountText(result, query);
  const failed = !!query && !!result?.error && result.error !== 'read-only';
  const none = !query || !result?.count;
  const showReplace = canReplace && replaceOpen;

  return (
    <View style={styles.bar}>
      <View style={styles.row}>
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
        <View style={[searchStyles.field, failed && searchStyles.fieldError]}>
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Find"
            placeholderTextColor={colors.textFaint}
            autoCapitalize="none"
            autoCorrect={false}
            autoFocus
            returnKeyType="search"
            blurOnSubmit={false}
            onSubmitEditing={() => editor.current?.findNext(1)}
            style={searchStyles.input}
            accessibilityLabel="Find"
          />
          <SearchToggle on={options.matchCase} label="Match case" onPress={() => setOption('matchCase')}>
            <Text style={[searchStyles.toggleText, options.matchCase && searchStyles.toggleTextOn]}>Aa</Text>
          </SearchToggle>
          <SearchToggle on={options.wholeWord} label="Match whole word" onPress={() => setOption('wholeWord')}>
            <Text style={[searchStyles.toggleText, searchStyles.underline, options.wholeWord && searchStyles.toggleTextOn]}>ab</Text>
          </SearchToggle>
          <SearchToggle on={options.isRegex} label="Use regular expression" onPress={() => setOption('isRegex')}>
            <Text style={[searchStyles.toggleText, searchStyles.mono, options.isRegex && searchStyles.toggleTextOn]}>.*</Text>
          </SearchToggle>
        </View>
        <SearchIconButton icon="close" label="Close find" small onPress={onClose} />
      </View>

      <View style={[styles.row, styles.statusRow]}>
        {canReplace ? <View style={styles.chevron} /> : null}
        <Text style={[styles.count, failed && styles.countError]} numberOfLines={1} accessibilityLiveRegion="polite">{count}</Text>
        <SearchIconButton icon="arrow-up" label="Previous match" small disabled={none} onPress={() => editor.current?.findNext(-1)} />
        <SearchIconButton icon="arrow-down" label="Next match" small disabled={none} onPress={() => editor.current?.findNext(1)} />
      </View>

      {showReplace ? (
        <View style={styles.row}>
          <View style={styles.chevron} />
          <View style={searchStyles.field}>
            <TextInput
              value={replace}
              onChangeText={setReplace}
              placeholder="Replace"
              placeholderTextColor={colors.textFaint}
              autoCapitalize="none"
              autoCorrect={false}
              returnKeyType="done"
              blurOnSubmit={false}
              onSubmitEditing={() => editor.current?.replace(replace, options)}
              style={searchStyles.input}
              accessibilityLabel="Replace with"
            />
            <SearchToggle on={options.preserveCase} label="Preserve case" onPress={() => setOption('preserveCase')}>
              <Text style={[searchStyles.toggleText, options.preserveCase && searchStyles.toggleTextOn]}>AB</Text>
            </SearchToggle>
          </View>
          <SearchIconButton icon="swap-horizontal" label="Replace" small disabled={none} onPress={() => editor.current?.replace(replace, options)} />
          <Pressable
            onPress={() => editor.current?.replaceAll(replace, options)}
            disabled={none}
            style={({ pressed }) => [styles.replaceAll, none && searchStyles.disabled, pressed && searchStyles.pressed]}
            accessibilityRole="button"
            accessibilityLabel="Replace all"
          >
            <Text style={styles.replaceAllText}>All</Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { gap: 4, paddingHorizontal: spacing.sm, paddingVertical: 6, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border, backgroundColor: colors.background },
  row: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  statusRow: { minHeight: 30 },
  chevron: { width: 22, height: 36, alignItems: 'center', justifyContent: 'center' },
  count: { flex: 1, color: colors.textDim, fontSize: 12, paddingHorizontal: spacing.md },
  countError: { color: colors.danger },
  replaceAll: { height: 34, paddingHorizontal: spacing.md, borderRadius: 8, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(128,136,255,0.14)' },
  replaceAllText: { color: colors.accent, fontSize: 14, fontWeight: '600' },
});
