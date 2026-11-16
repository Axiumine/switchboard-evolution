// What an expanded tool row shows: the lines an edit changes, the command a
// shell tool ran. Inputs come as Claude Code writes them, or as Codex's
// arguments (a JSON string) mapped by the desktop.

export type DiffLine = { sign: '+' | '-'; text: string };

/** A tool's input as an object: Codex passes its arguments as JSON text. */
export function inputObject(input: unknown): Record<string, any> | null {
  if (input && typeof input === 'object') return input as Record<string, any>;
  if (typeof input === 'string') {
    try {
      const parsed = JSON.parse(input);
      return parsed && typeof parsed === 'object' ? parsed : null;
    } catch {
      return null;
    }
  }
  return null;
}

const linesOf = (text: unknown) => (typeof text === 'string' && text ? text.replace(/\n$/, '').split('\n') : []);

/** The lines an Edit, MultiEdit, Write or patch removes and adds, at most `max` of them, and how many more there are. */
export function diffLines(name: string, input: unknown, max = 60): { lines: DiffLine[]; more: number } {
  const lines: DiffLine[] = [];
  const add = (sign: '+' | '-', text: unknown) => { for (const line of linesOf(text)) lines.push({ sign, text: line }); };
  const value = inputObject(input);
  if (name === 'Edit' && value) {
    add('-', value.old_string);
    add('+', value.new_string);
  } else if (name === 'MultiEdit' && Array.isArray(value?.edits)) {
    for (const edit of value.edits) { add('-', edit?.old_string); add('+', edit?.new_string); }
  } else if (name === 'Write' && value) {
    add('+', value.content);
  } else if (name === 'NotebookEdit' && value) {
    add('+', value.new_source);
  } else if (name === 'apply_patch') {
    const patch = typeof input === 'string' && !value ? input : value?.input ?? value?.patch ?? '';
    for (const line of linesOf(patch)) {
      if (/^(\+\+\+|---|\*\*\*)/.test(line)) continue;
      if (line.startsWith('+')) lines.push({ sign: '+', text: line.slice(1) });
      else if (line.startsWith('-')) lines.push({ sign: '-', text: line.slice(1) });
    }
  }
  return { lines: lines.slice(0, max), more: Math.max(0, lines.length - max) };
}

/** The command a shell tool ran: Bash's `command`, or Codex's `cmd` / argv (the script of `bash -lc`). */
export function commandOf(input: unknown): string {
  const value = inputObject(input);
  if (!value) return '';
  const command = value.command ?? value.cmd;
  if (typeof command === 'string') return command;
  if (Array.isArray(command)) {
    const shell = command.length === 3 && /(^|\/)(ba|z)?sh$/.test(command[0]) && /^-l?c$/.test(command[1]);
    return shell ? String(command[2]) : command.join(' ');
  }
  return '';
}
