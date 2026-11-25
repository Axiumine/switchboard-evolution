// Types for command-catalog-model.js, next to this file. The entries and the
// catalog are what the desktop's get-command-catalog returns (to the window
// and, through remote-api.js, to the phone).

export type CatalogCli = 'claude' | 'codex' | 'opencode';
export type CommandKind = 'slash' | 'cli' | 'flag' | 'skill' | 'custom' | 'mcp' | 'shortcut';
export type CommandFlag = 'endsSession' | 'replacesConversation' | 'account' | 'writesFiles'
  | 'opensMenu' | 'runsTask' | 'runsWhileBusy';
export type CommandSource = 'official-docs' | 'cli-source' | 'cli-completion' | 'project' | 'user' | 'plugin' | 'config';

export interface CommandDoc {
  /** `${cli}:${kind}:${name}`, unique in a catalog. */
  id: string;
  cli: CatalogCli;
  kind: CommandKind;
  /** What is typed: "/compact", "claude -p", "--output-format", "$deploy". */
  command: string;
  name: string;
  aliases?: string[];
  /** "[instructions]", "<path>". */
  inputArgs?: string;
  argsRequired?: boolean;
  /** ["text", "json", "stream-json"]. */
  acceptedValues?: string[];
  description: string;
  outputBehavior?: string;
  example?: string;
  /** The CLI version the entry needs, "2.1.221". */
  requires?: string;
  flags?: CommandFlag[];
  /** A bundled skill or workflow of the CLI. */
  bundled?: 'skill' | 'workflow';
  /** A section of the docs ("General controls"). */
  group?: string;
  source: CommandSource;
  /** Where a user's entry comes from: a plugin's name, a file relative to its folder. */
  origin?: string;
  docUrl?: string;
}

export interface CommandCatalog {
  cli: CatalogCli;
  /** A CLI's session, or a plain shell. */
  target: 'agent' | 'terminal';
  version: { session?: string; installed?: string; source?: string };
  docs: { generatedAt?: string; refreshedAt?: string; origin: 'bundled' | 'refreshed' };
  entries: CommandDoc[];
  notes?: string[];
}

/** The session's state as the apps keep it. */
export type CatalogSessionState = 'attention' | 'busy' | 'subagent' | 'running' | 'idle';

export type CatalogTab = { id: 'commands' | 'custom' | 'mcp' | 'cli' | 'shortcuts'; label: string };
export type CommandInsertion = { mode: 'insert' | 'copy'; text: string };
export type CommandBadge = { id: 'bundled' | 'source' | 'danger' | 'menu' | 'task' | 'requires' | 'newer'; label: string };

export const TABS: readonly (CatalogTab & { kinds: CommandKind[] })[];
export function tabOf(entry: CommandDoc): CatalogTab['id'];
export function tabsFor(catalog: Pick<CommandCatalog, 'entries' | 'target'> | null | undefined): CatalogTab[];
export function searchCommands(entries: readonly CommandDoc[], query: string, options?: { tab?: CatalogTab['id'] | null; limit?: number; tabs?: readonly CatalogTab['id'][] | null }): CommandDoc[];
export function typedCommand(text: string, catalog?: Pick<CommandCatalog, 'entries' | 'target'> | null): { sigil: '/' | '$' | '@'; query: string } | null;
export function suggestionsFor(catalog: Pick<CommandCatalog, 'entries' | 'target'> | null | undefined, text: string, options?: { limit?: number }): CommandDoc[];
export function insertionFor(entry: CommandDoc, options?: { target?: CommandCatalog['target'] }): CommandInsertion | null;
export function canRun(entry: CommandDoc, options?: { target?: CommandCatalog['target']; state?: CatalogSessionState }): { ok: boolean; reason?: string };
export function needsConfirm(entry: CommandDoc): string | null;
export function stateNotice(entry: CommandDoc, state: CatalogSessionState): string | null;
export function applyToDraft(draft: string, text: string): string;
export function appendToLine(line: string, text: string): string;
export function versionAtLeast(a: string | null | undefined, b: string | null | undefined): boolean | null;
export function availability(entry: CommandDoc, version: string | null | undefined): 'ok' | 'newer' | 'unknown';
export function badgesOf(entry: CommandDoc, version?: string | null): CommandBadge[];
export function cleanText(text: string): string;
export function safeName(name: unknown): string | null;
export function cliLabel(cli: string): string;
