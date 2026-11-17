import { Platform } from 'react-native';

import type { DiffLine } from '@/git/model';
import { colors } from '@/theme';

export const mono = Platform.select({ ios: 'Menlo', default: 'monospace' });

/** How each kind of diff line looks: one copy for the diff screen and the comparison. */
export const LINE_STYLES: Record<DiffLine['kind'], object> = {
  meta: { color: colors.textFaint },
  hunk: { color: colors.accent },
  add: { color: '#8fd19e', backgroundColor: 'rgba(76,175,143,0.12)' },
  del: { color: '#f19aa1', backgroundColor: 'rgba(224,108,117,0.12)' },
  context: { color: colors.text },
};
