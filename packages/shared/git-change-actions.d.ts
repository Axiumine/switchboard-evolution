// Types for git-change-actions.js, next to this file.

/** One entry of the desktop's parsePorcelain(), as get-project-git-info sends it. */
export type PorcelainChange = { path: string; status: string; indexStatus?: string; worktreeStatus?: string };
/** A file or folder row; null stands for every change. */
export type ChangeTarget = { path: string; dir: boolean };
export type Question = { title: string; detail: string; confirm: string };

/** Whether `path` is the target itself or, for a folder, inside it. */
export function inTarget(path: string, target: ChangeTarget | null): boolean;
/** The changes a Discard of `target` (null: all) reaches: working-tree changes, untracked files too, no conflicts. */
export function discardTargets<T extends PorcelainChange>(changes: T[], target: ChangeTarget | null): T[];
/** What a row's menu offers: Add to .gitignore, and Add to .gitignore and Remove from Git. */
export function ignoreOptions(changes: PorcelainChange[], target: ChangeTarget | null): { ignore: boolean; untrack: boolean };
/** The anchored .gitignore line for a path relative to the repository's root. */
export function ignorePattern(path: string, isDir: boolean): string;
/** The question before a Discard; `name` is the folder's for a folder row. */
export function discardQuestion(targets: PorcelainChange[], name?: string | null, options?: { trash?: string }): Question;
/** The question before Add to .gitignore and Remove from Git. */
export function untrackQuestion(name: string, isDir: boolean): Question;
