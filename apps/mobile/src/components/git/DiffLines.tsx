import { useMemo } from 'react';
import { Text, type StyleProp, type TextStyle } from 'react-native';

import { CODE_LINE_STYLES, LINE_STYLES, SIGN_STYLES } from '@/components/git/diff-style';
import { diffCodeLines } from '@/diffs/highlight';
import type { DiffLine } from '@/git/model';

/**
 * A diff's lines, green the added ones and red the removed ones. With
 * `filename`, in a language the editor highlights, the code takes the editor's
 * colours instead and the lines keep only their green and red backgrounds, as
 * on the desktop (gitDiffLines in project-git-view.js).
 */
export function DiffLines({ lines, filename, style }: { lines: DiffLine[]; filename?: string; style: StyleProp<TextStyle> }) {
  const code = useMemo(() => (filename ? diffCodeLines(lines.map((line) => line.text), filename) : null), [lines, filename]);
  return lines.map((line, i) => {
    const pieces = code?.[i];
    if (!pieces) return <Text key={i} style={[style, LINE_STYLES[line.kind]]}>{line.text || ' '}</Text>;
    return (
      <Text key={i} style={[style, CODE_LINE_STYLES[line.kind]]}>
        {/* Inside a hunk the first character is the line's kind, whatever follows it. */}
        <Text style={SIGN_STYLES[line.kind]}>{line.text[0] || ' '}</Text>
        {pieces.map((piece, k) => <Text key={k} style={piece.style}>{piece.text}</Text>)}
      </Text>
    );
  });
}
