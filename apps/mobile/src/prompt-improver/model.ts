import { cliLabel, CLIS, type ImproverCli, type ImproverMode, type PromptImproverSettings } from '@/shared/vendor/prompt-improver-model';

// The prompt improver on the phone: what the "✦" button beside "/" does
// with the composer's text. The computer runs the CLI (prompt-improver.js);
// here only the steps of the button and what they say.

/** The button's step: nothing, a run for `sent`, or a rewrite that Undo can take back. */
export type ImproveStep =
  | { phase: 'idle' }
  | { phase: 'running'; sent: string }
  | { phase: 'done'; original: string; improved: string };

/** What the computer gives back for improve-prompt. */
export interface ImproveResult {
  ok: boolean;
  text?: string;
  engine?: ImproverCli;
  mode?: ImproverMode;
  ms?: number;
  error?: string;
  cancelled?: boolean;
}

/** What get-prompt-improver-settings gives back. */
export interface PromptImproverInfo {
  settings: PromptImproverSettings;
  defaultTemplate: string;
  placeholders: { name: string; description: string }[];
  clis: string[];
}

/** Does a session have a prompt the improver can take: a CLI session, the improver on. */
export function canImprove(session: { type?: string | null; runtime?: string | null } | null | undefined, settings: PromptImproverSettings | null | undefined): boolean {
  if (!session || session.type === 'terminal' || !settings || !settings.enabled) return false;
  return (CLIS as readonly string[]).includes(session.runtime || 'claude');
}

/** Undo is offered while the field still holds the rewrite, untouched. */
export function canUndo(step: ImproveStep, text: string): step is Extract<ImproveStep, { phase: 'done' }> {
  return step.phase === 'done' && text === step.improved;
}

/** The text was changed while it was being improved: ask before putting the rewrite in its place. */
export function changedMeanwhile(sent: string, now: string): boolean {
  return sent !== now;
}

/** How long the phone waits: the computer's own limit, and a margin for the way back. */
export function improveTimeoutMs(settings: Pick<PromptImproverSettings, 'timeoutSec'> | null | undefined): number {
  const sec = settings && Number.isInteger(settings.timeoutSec) ? settings.timeoutSec : 120;
  return (sec + 20) * 1000;
}

/** The engine for a session, as the computer will choose it. */
export function engineOf(settings: Pick<PromptImproverSettings, 'engine'> | null | undefined, runtime?: string | null): ImproverCli {
  const engine = settings?.engine;
  if (engine && engine !== 'session' && (CLIS as readonly string[]).includes(engine)) return engine as ImproverCli;
  return (CLIS as readonly string[]).includes(runtime || '') ? (runtime as ImproverCli) : 'claude';
}

/** The question before a run (settings.confirm). */
export function confirmText(settings: PromptImproverSettings, runtime?: string | null): { title: string; message: string } {
  const engine = cliLabel(engineOf(settings, runtime));
  const context = settings.context === 'recent' ? 'with the last turns of the conversation' : 'with the prompt only';
  return {
    title: 'Improve this prompt?',
    message: `${engine} on the computer rewrites it ${context}, using your subscription. The rewrite takes the place of your text; nothing is sent.`,
  };
}
