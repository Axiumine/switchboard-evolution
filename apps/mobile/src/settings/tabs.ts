import { PHONE_TABS } from '@/shared/vendor/settings-model';

export type PhoneSettingsTab = 'computer' | 'application' | 'agents' | 'editor' | 'knowledge' | 'improver';

/**
 * The tabs the phone's Settings shows for the paired computer: Computer is the
 * phone's own and always there; the desktop's Application, Agents and Editor
 * need a computer that offers the global settings, Node Knowledge one that
 * offers the knowledge config, and Prompt Improver one that has the improver.
 * An older computer therefore shows less, never an empty tab.
 */
export function settingsTabs(caps: { global: boolean; knowledge: boolean; improver: boolean }): readonly { key: PhoneSettingsTab; label: string }[] {
  const shown = (key: string) => {
    switch (key) {
      case 'computer': return true;
      case 'application':
      case 'agents':
      case 'editor': return caps.global;
      case 'knowledge': return caps.knowledge;
      case 'improver': return caps.improver;
      default: return false;
    }
  };
  return PHONE_TABS.filter((t) => shown(t.key)) as { key: PhoneSettingsTab; label: string }[];
}
