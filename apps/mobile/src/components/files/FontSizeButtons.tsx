import { StyleSheet, View } from 'react-native';

import { HeaderButton } from '@/components/HeaderButton';
import { FONT_MAX, FONT_MIN, useEditorFont } from '@/editor/font';

/** A− and A+: the text size of every editor and of Markdown shown formatted. */
export function FontSizeButtons() {
  const size = useEditorFont((s) => s.size);
  const { bigger, smaller } = useEditorFont.getState();
  return (
    <View style={styles.row}>
      <HeaderButton text="A−" accessibilityLabel="Smaller text" onPress={smaller} disabled={size <= FONT_MIN} />
      <HeaderButton text="A+" accessibilityLabel="Larger text" onPress={bigger} disabled={size >= FONT_MAX} />
    </View>
  );
}

const styles = StyleSheet.create({ row: { flexDirection: 'row', alignItems: 'center', gap: 4 } });
