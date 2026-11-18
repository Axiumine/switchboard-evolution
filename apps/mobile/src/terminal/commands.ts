// What the key bar asks of the terminal it sits under, beyond typing: paste,
// copy and select all happen in the terminal's page, which only TerminalView
// can reach.

export type TerminalCommand = { type: 'paste'; text: string } | { type: 'copy' } | { type: 'select-all' };

type Listener = (sessionId: string, command: TerminalCommand) => void;
const listeners = new Set<Listener>();

/** Ask the terminal of `sessionId` to do `command`. */
export function sendTerminalCommand(sessionId: string, command: TerminalCommand) {
  for (const listener of listeners) listener(sessionId, command);
}

/** Listen for commands; returns the function that stops listening. */
export function onTerminalCommand(listener: Listener): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
