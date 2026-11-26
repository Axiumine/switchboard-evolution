// Types for prompt-improver-model.js, next to this file.

export type ImproverCli = 'claude' | 'codex' | 'opencode';
export type ImproverEngine = 'session' | ImproverCli;
export type ImproverMode = 'recent' | 'none';

export interface PromptImproverSettings {
  enabled: boolean;
  /** Ask before improving (the phone; the desktop's window is the question). */
  confirm: boolean;
  /** 'session' = the CLI of the session. */
  engine: ImproverEngine;
  /** 'recent' adds the last turns of the conversation, 'none' only the prompt. */
  context: ImproverMode;
  recentTurns: number;
  /** A model per CLI; '' = the CLI's own default. */
  models: Record<ImproverCli, string>;
  timeoutSec: number;
  /** The user's improver prompt; null = DEFAULT_TEMPLATE. */
  template: string | null;
}

export interface CatalogEntryLike {
  kind: string;
  command: string;
  name?: string;
  inputArgs?: string;
  description?: string;
  flags?: string[];
  bundled?: string;
}

export interface RecentTurn {
  role: 'user' | 'assistant';
  text: string;
}

export const ENGINES: readonly ImproverEngine[];
export const CLIS: readonly ImproverCli[];
export const MODES: readonly ImproverMode[];
export const DEFAULT_TEMPLATE: string;
export const DEFAULT_SETTINGS: PromptImproverSettings;
export const SYSTEM_PROMPT: string;
export const PLACEHOLDERS: readonly { name: string; description: string }[];
export const MAX_PROMPT: number;
export const MAX_TEMPLATE: number;

export function normalizeSettings(raw: unknown): PromptImproverSettings;
export function validateSettings(raw: unknown): { ok: true; value: PromptImproverSettings } | { ok: false; error: string };
export function templateOf(settings: { template?: string | null } | null | undefined): string;
export function engineFor(settings: { engine?: ImproverEngine } | null | undefined, runtime?: string): ImproverCli;
export function cliLabel(cli: string | null | undefined): string;
export function invocationRules(cli: string): readonly string[];
export function usefulEntries<T extends CatalogEntryLike>(entries: readonly T[] | null | undefined): T[];
export function capabilitiesBlock(entries: readonly CatalogEntryLike[] | null | undefined, prompt: string, options?: { maxChars?: number }): string;
export function recentBlock(turns: readonly RecentTurn[] | null | undefined, options?: { perTurn?: number; maxChars?: number }): string;
export function fillTemplate(template: string, values: { prompt?: string; cli?: string; project?: string }): string;
export function buildImproverInput(input: {
  template?: string | null;
  prompt: string;
  cli: string;
  version?: string;
  project?: string;
  mode?: ImproverMode;
  recent?: readonly RecentTurn[];
  entries?: readonly CatalogEntryLike[];
}): string;
export function extractImproved(output: string): string | null;
export function checkPrompt(prompt: unknown): { ok: boolean; error?: string };
export function cleanMultiline(text: unknown): string;
