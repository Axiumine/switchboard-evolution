import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { TabBar } from '@/components/TabBar';
import { CatalogTab } from '@/components/settings/CatalogTab';
import { ComputerTab } from '@/components/settings/ComputerTab';
import { KnowledgeSettingsTab } from '@/components/settings/KnowledgeSettingsTab';
import { PromptImproverTab } from '@/components/settings/PromptImproverTab';
import { settingsTabs, type PhoneSettingsTab } from '@/settings/tabs';
import { useCapability, useConnection } from '@/store/connection';
import { colors } from '@/theme';

/**
 * The Settings tab, with the desktop's tabs under a fixed bar: Computer (the
 * paired computer, always first and where the page starts), then, when the
 * computer offers them, Application, Agents, Editor, Node Knowledge and Prompt
 * Improver. A computer older than the global settings shows Computer and
 * the improver only. The tab's content scrolls under the bar.
 */
export default function SettingsScreen() {
  const desktop = useConnection((s) => s.desktop);
  const global = useCapability('get-global-settings');
  const knowledge = useCapability('get-knowledge-config');
  const improver = useCapability('get-prompt-improver-settings');
  const [selected, setSelected] = useState<PhoneSettingsTab>('computer');

  if (!desktop) return null;
  const tabs = settingsTabs({ global, knowledge, improver });
  // A tab that is gone (the computer went offline, or is older) leaves Computer, which is always there.
  const tab = tabs.some((t) => t.key === selected) ? selected : 'computer';

  return (
    <View style={styles.screen}>
      <TabBar tabs={tabs} active={tab} onChange={setSelected} />
      <View style={styles.body}>{body(tab)}</View>
    </View>
  );
}

function body(tab: PhoneSettingsTab) {
  switch (tab) {
    case 'computer': return <ComputerTab />;
    case 'improver': return <PromptImproverTab />;
    case 'application':
    case 'agents':
    case 'editor': return <CatalogTab key={tab} tab={tab} />;
    case 'knowledge': return <KnowledgeSettingsTab />;
    default: return null;
  }
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  body: { flex: 1 },
});
