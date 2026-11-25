import { useMemo } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';

import { hasCommandCatalog, useCommandCatalog, useCommandCatalogClis } from '@/catalog/queries';
import type { Session } from '@/sessions/model';
import { insertionFor, suggestionsFor, typedCommand } from '@/shared/vendor/command-catalog-model';
import { colors, spacing } from '@/theme';

/**
 * Above a composer's field, while it holds only a command being typed (`/comp`,
 * `$dep` for a Codex skill, `@rev` for an OpenCode one): the commands of the
 * session's CLI that complete it. A tap puts the command and a space in the
 * field, ready for its arguments. Nothing in a plain terminal, or for a
 * computer without the catalog.
 */
export function CommandSuggestions({ sessionId, session, text, onPick }: {
  sessionId: string;
  session: Pick<Session, 'type' | 'runtime'> | null | undefined;
  text: string;
  onPick: (text: string) => void;
}) {
  const clis = useCommandCatalogClis();
  const typing = hasCommandCatalog(clis, session) && session?.type !== 'terminal' && !!typedCommand(text);
  // Asked once, when a command is first typed; kept half a minute.
  const { data: catalog } = useCommandCatalog(sessionId, { enabled: typing, runtime: session?.runtime || 'claude' });
  const items = useMemo(() => (typing && catalog ? suggestionsFor(catalog, text, { limit: 5 }) : []), [typing, catalog, text]);
  if (!items.length) return null;
  return (
    <View style={styles.list} accessibilityRole="menu" accessibilityLabel="Matching commands">
      {items.map((entry) => {
        const pick = insertionFor(entry, { target: 'agent' });
        return (
          <Pressable
            key={entry.id}
            onPress={() => { if (pick) onPick(pick.text); }}
            style={({ pressed }) => [styles.row, pressed && styles.pressed]}
            accessibilityRole="menuitem"
            accessibilityLabel={`${entry.command}${entry.inputArgs ? ` ${entry.inputArgs}` : ''}. ${entry.description}`}
          >
            <View style={styles.top}>
              <Text style={styles.command} numberOfLines={1}>{entry.command}</Text>
              {entry.inputArgs ? <Text style={styles.args} numberOfLines={1}>{entry.inputArgs}</Text> : null}
            </View>
            <Text style={styles.desc} numberOfLines={1}>{entry.description}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const mono = Platform.select({ ios: 'Menlo', default: 'monospace' });

const styles = StyleSheet.create({
  list: { marginHorizontal: spacing.sm, marginTop: spacing.sm, borderRadius: 10, backgroundColor: colors.raised, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border, overflow: 'hidden' },
  row: { paddingHorizontal: spacing.md, paddingVertical: 8, gap: 2, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  pressed: { backgroundColor: colors.surface },
  top: { flexDirection: 'row', alignItems: 'baseline', gap: 6 },
  command: { color: colors.text, fontFamily: mono, fontSize: 14, flexShrink: 0, maxWidth: '70%' },
  args: { color: colors.textFaint, fontFamily: mono, fontSize: 12, flexShrink: 1 },
  desc: { color: colors.textDim, fontSize: 12.5 },
});
