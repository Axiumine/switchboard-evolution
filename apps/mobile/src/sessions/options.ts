// Which launch options the form shows, as the desktop's form picks them
// (public/session-config-form.js in switchboard).

import { fieldsBehindMore, fieldsFor, type Field } from '@/shared/vendor/session-config';

/**
 * The fields of one CLI's options form, in order, and those of them that wait
 * behind "More options" until they have a value. Hidden fields never show,
 * and on resume neither do the ones only a new session reads (newOnly, such
 * as Worktree), since the CLI ignores them there.
 */
export function optionFields(runtime: string, values: Record<string, unknown>, { resume = false } = {}): { fields: Field[]; behindMore: Set<string> } {
  const fields = fieldsFor(runtime).filter((f) => !f.hidden && !(resume && f.newOnly));
  const shown = new Set(fields.map((f) => f.key));
  return { fields, behindMore: new Set(fieldsBehindMore(runtime, values).filter((key) => shown.has(key))) };
}
