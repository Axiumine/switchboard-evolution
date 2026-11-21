// What the Files tab says around several files going down to the phone or
// up to the computer.

import type { TransferOutcome } from './download';

type Kind = 'download' | 'upload';

const files = (n: number) => (n === 1 ? '1 file' : `${n} files`);

/** Before Download Selected with folders ticked: how much is in them. */
export function downloadQuestion(count: number, size: string): { title: string; detail: string; confirm: string } {
  return {
    title: `Download ${files(count)}?`,
    detail: `${size} in all, into a folder you pick on this phone. What is in a folder goes into a folder of the same name.`,
    confirm: 'Download',
  };
}

/** Names already in the folder an upload goes to: replace them, or keep both? */
export function uploadClashQuestion(names: string[], max = 5): { title: string; detail: string } {
  const one = names.length === 1;
  const listed = one ? '' : `\n\n${names.slice(0, max).join('\n')}${names.length > max ? `\n…and ${names.length - max} more` : ''}`;
  return {
    title: one ? `“${names[0]}” is already there` : `${names.length} files are already there`,
    detail: one
      ? 'Replace it (the old one goes to the Trash on the computer), or keep both, the new one under another name?'
      : `Replace them (the old ones go to the Trash on the computer), or keep both, the new ones under other names?${listed}`,
  };
}

/** The short line once files went down or up: "Saved 3 files", "Uploaded 2 of 5 files, then cancelled". */
export function transferDoneText(kind: Kind, outcome: TransferOutcome, total: number): string {
  const verb = kind === 'download' ? 'Saved' : 'Uploaded';
  if (outcome.cancelled) return outcome.done ? `${verb} ${outcome.done} of ${files(total)}, then cancelled` : 'Cancelled';
  return `${verb} ${files(outcome.done)}`;
}

/** What to show when some files did not go, each with why: null when none failed. */
export function transferFailures(kind: Kind, outcome: TransferOutcome, total: number, max = 8): { title: string; detail: string } | null {
  const { failed } = outcome;
  if (!failed.length) return null;
  const verb = kind === 'download' ? 'downloaded' : 'uploaded';
  const lines = failed.slice(0, max).map((item) => `${item.rel}: ${item.error}`);
  if (failed.length > max) lines.push(`+ ${failed.length - max} more`);
  return {
    title: total === 1 ? `Could not ${kind} the file` : `${failed.length} of ${files(total)} were not ${verb}`,
    detail: lines.join('\n'),
  };
}
