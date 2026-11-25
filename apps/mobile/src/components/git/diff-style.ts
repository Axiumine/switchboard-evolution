import { Platform } from 'react-native';

import { CODE_COLOR } from '@/diffs/highlight';
import type { DiffLine } from '@/git/model';
import { colors } from '@/theme';

export const mono = Platform.select({ ios: 'Menlo', default: 'monospace' });

const ADD_COLOR = '#8fd19e';
const DEL_COLOR = '#f19aa1';
const ADD_BACKGROUND = 'rgba(76,175,143,0.12)';
const DEL_BACKGROUND = 'rgba(224,108,117,0.12)';

/** How each kind of diff line looks: one copy for the diff screen and the comparison. */
export const LINE_STYLES: Record<DiffLine['kind'], object> = {
  meta: { color: colors.textFaint },
  hunk: { color: colors.accent },
  add: { color: ADD_COLOR, backgroundColor: ADD_BACKGROUND },
  del: { color: DEL_COLOR, backgroundColor: DEL_BACKGROUND },
  context: { color: colors.text },
};

/** A line whose code is in the editor's colours (DiffLines): only its background says what it is. */
export const CODE_LINE_STYLES: Record<DiffLine['kind'], object> = {
  ...LINE_STYLES,
  add: { color: CODE_COLOR, backgroundColor: ADD_BACKGROUND },
  del: { color: CODE_COLOR, backgroundColor: DEL_BACKGROUND },
  context: { color: CODE_COLOR },
};

/** The + or - before such a line's code, in the colour of its kind. */
export const SIGN_STYLES: Record<DiffLine['kind'], object> = {
  meta: {}, hunk: {},
  add: { color: ADD_COLOR },
  del: { color: DEL_COLOR },
  context: { color: colors.textFaint },
};
