// The Actions view on the phone: what the computer's actions.js answers, and
// the pure logic of the screens. What is the same as on the desktop (states,
// what started a run, the search's qualifiers, the job graph, the "Run
// workflow" fields, log lines) comes from the shared actions-model.js; keep
// the rest in step with the desktop's project-actions-view.js.

import type Ionicons from '@expo/vector-icons/Ionicons';

import { colors } from '@/theme';
import { isActive, runState, type RunStateInfo, type StateBucket } from '@/shared/vendor/actions-model';

export * from '@/shared/vendor/actions-model';

export type ErrorCode = 'gh-missing' | 'gh-auth' | 'no-github-remote' | 'not-found' | 'rate-limited' | 'bad-request' | 'gh-failed' | 'git-failed' | 'not-admin' | 'conflict' | 'forbidden';

type Failure = { ok?: false; error?: string; code?: ErrorCode | string };
type Remotes = { remote?: string; remotes?: { name: string; host: string; slug: string }[] };
export type Rate = { limit: number; remaining: number; resetAt: number | null };

export type ActionsRepo = {
  nameWithOwner: string;
  url: string;
  host: string;
  owner: string;
  repo: string;
  permission: string | null;
  canWrite: boolean;
  isAdmin: boolean;
  archived: boolean;
  fork: boolean;
  defaultBranch: string | null;
};

export type Workflow = { id: number; name: string; path: string; file: string; state: string; url: string; dynamic: boolean };
export type WorkflowsAnswer = (Remotes & { ok: true; repo: ActionsRepo; workflows: Workflow[]; lockfile: boolean; rate: Rate | null }) | (Failure & Remotes);

export type Run = {
  id: number;
  number: number;
  attempt: number;
  title: string;
  workflowId: number | null;
  workflow: string;
  path: string;
  event: string;
  status: string | null;
  conclusion: string | null;
  branch: string;
  sha: string;
  actor: string;
  triggeringActor: string;
  headRepository: string;
  fromFork: boolean;
  pullRequests: { number: number; head: string; base: string }[];
  commit: { id: string; message: string; author: string } | null;
  createdAt: string | null;
  startedAt: string | null;
  updatedAt: string | null;
  url: string;
};
export type RunsAnswer = (Remotes & { ok: true; total: number; page: number; perPage: number; runs: Run[]; text: string; notice?: string; rate: Rate | null }) | (Failure & Remotes);

export type Step = { number: number; name: string; status: string | null; conclusion: string | null; startedAt: string | null; completedAt: string | null };
export type Job = {
  id: number;
  name: string;
  status: string | null;
  conclusion: string | null;
  startedAt: string | null;
  completedAt: string | null;
  url: string;
  runId: number | null;
  attempt: number;
  runnerName: string;
  runnerGroup: string;
  labels: string[];
  sha: string;
  steps: Step[];
};
export type Artifact = { id: number; name: string; size: number; digest: string | null; expiresAt: string | null };
export type PendingDeployment = {
  environment: { id: number | null; name: string; url: string };
  waitTimer: number;
  waitTimerStartedAt: string | null;
  canApprove: boolean;
  reviewers: { type: string; name: string }[];
};
export type Approval = { state: string; user: string; comment: string; environments: string[] };
export type Annotation = { path: string; startLine: number | null; endLine: number | null; level: string; title: string; message: string; details: string; url: string };
export type YamlJob = { key: string; name: string; needs: string[]; matrix: boolean; uses: string | null };

export type RunAnswer = (Remotes & {
  ok: true;
  run: Run;
  attempt: number;
  attempts: number;
  jobs: Job[];
  artifacts: Artifact[];
  pendingDeployments: PendingDeployment[];
  approvals: Approval[];
  concurrency: { name: string; members: { runId: number | null; position: number | null }[] }[];
  annotations: Record<string, { items: Annotation[]; total: number }>;
  workflow: { jobs: YamlJob[]; error: string | null; dynamic: boolean };
  rate: Rate | null;
}) | (Failure & Remotes);

export type JobAnswer = { ok: true; job: Job; annotations: Annotation[]; rate: Rate | null } | Failure;
export type LogAnswer = { ok: true; text: string; truncated: boolean } | (Failure & { pending?: boolean });
// `error` on an answer that is ok: the file is there but YAML cannot read it.
export type FileAnswer = { ok: true; path: string; ref: string; text: string; error?: string } | Failure;

export type DispatchField = { name: string; type: 'string' | 'boolean' | 'choice' | 'number' | 'environment'; description: string; required: boolean; default: string; options: string[] };
export type DispatchAnswer = {
  ok: true;
  workflow: Workflow;
  ref: string;
  defaultBranch: string | null;
  canWrite: boolean;
  fields: DispatchField[];
  environments: string[];
  events: string[];
  schedule: { cron: string; timezone: string }[];
  available: boolean;
  reason: string;
} | Failure;
export type RefsAnswer = { ok: true; defaultBranch: string | null; branches: string[]; tags: string[] } | Failure;

export type Cache = { id: number; key: string; ref: string; version: string; size: number; createdAt: string | null; lastAccessedAt: string | null };
export type CachesAnswer = { ok: true; caches: Cache[]; total: number; page: number; perPage: number; usage: { count: number; size: number } | null } | Failure;
export type Runner = { id: number; name: string; os: string; status: 'idle' | 'active' | 'offline'; busy: boolean; ephemeral: boolean; labels: { name: string; custom: boolean }[] };
export type RunnersAnswer = { ok: true; admin: boolean; runners: Runner[]; total: number; repo: ActionsRepo } | Failure;
export type Deployment = {
  id: number; environment: string; state: string; ref: string; sha: string; creator: string; createdAt: string | null;
  status: string; logUrl: string; environmentUrl: string; actions: { runId: number; jobId: number | null } | null;
};
export type DeploymentsAnswer = {
  ok: true;
  environments: { id: number; name: string; active: Deployment | null }[];
  deployments: Deployment[];
  totalCount: number;
  hasNextPage: boolean;
  endCursor: string | null;
} | Failure;

export type EditParams =
  | { kind: 'dispatch'; workflowId: number | string; ref: string; inputs?: Record<string, string> }
  | { kind: 'rerun'; runId: number; failedOnly?: boolean; debug?: boolean }
  | { kind: 'rerun-job'; jobId: number; debug?: boolean }
  | { kind: 'cancel' | 'force-cancel' | 'delete-run' | 'delete-logs' | 'approve-fork'; runId: number }
  | { kind: 'enable' | 'disable'; workflowId: number | string }
  | { kind: 'review-deployments'; runId: number; environmentIds: number[]; state: 'approved' | 'rejected'; comment?: string }
  | { kind: 'delete-artifact'; artifactId: number }
  | { kind: 'delete-cache'; cacheId: number }
  | { kind: 'runner-remove'; runnerId: number }
  | { kind: 'runner-labels'; runnerId: number; labels: string[] };
export type EditAnswer = { ok: true; kind: string; message: string; runId?: number; url?: string | null } | Failure;

// --- Words and icons ---

export function errorTitle(code: string | undefined): string {
  switch (code) {
    case 'gh-missing': return 'The GitHub CLI is needed';
    case 'gh-auth': return 'Sign in to GitHub';
    case 'no-github-remote': return 'No GitHub remote';
    case 'not-found': return 'Not found on GitHub';
    case 'rate-limited': return 'GitHub needs a pause';
    default: return 'GitHub Actions could not be read';
  }
}

type IconName = keyof typeof Ionicons.glyphMap;

/** A state's icon and colour on the phone, as the desktop draws them. */
export const STATE_ICONS: Record<StateBucket, { name: IconName; color: string }> = {
  success: { name: 'checkmark-circle-outline', color: colors.running },
  failure: { name: 'close-circle-outline', color: colors.danger },
  cancelled: { name: 'ban-outline', color: colors.textFaint },
  skipped: { name: 'ban-outline', color: colors.textFaint },
  neutral: { name: 'remove-circle-outline', color: colors.textFaint },
  action: { name: 'warning-outline', color: colors.attention },
  running: { name: 'sync-outline', color: '#d9b45c' },
  queued: { name: 'ellipse-outline', color: colors.textDim },
  waiting: { name: 'time-outline', color: '#d9b45c' },
};

export function stateOf(item: { status?: string | null; conclusion?: string | null }): RunStateInfo {
  return runState(item.status, item.conclusion);
}

export type RunMenuKey = 'view-file' | 'cancel' | 'rerun' | 'rerun-failed' | 'approve' | 'web' | 'browser' | 'delete';

/** A run's "…" on the phone, as the desktop's: only what the account may do. */
export function runMenu(run: Pick<Run, 'status' | 'conclusion'>, canWrite: boolean): RunMenuKey[] {
  const active = isActive(run.status);
  const keys: RunMenuKey[] = ['view-file'];
  if (canWrite) {
    if (active) keys.push('cancel');
    else keys.push('rerun');
    if (!active && ['failure', 'cancelled', 'timed_out', 'startup_failure'].includes(String(run.conclusion))) keys.push('rerun-failed');
    if (run.conclusion === 'action_required') keys.push('approve');
  }
  keys.push('web', 'browser');
  if (canWrite && !active) keys.push('delete');
  return keys;
}

export const RUN_MENU_LABELS: Record<RunMenuKey, string> = {
  'view-file': 'View workflow file',
  cancel: 'Cancel run',
  rerun: 'Re-run all jobs',
  'rerun-failed': 'Re-run failed jobs',
  approve: 'Approve and run',
  web: 'Open on GitHub here',
  browser: 'Open in the browser',
  delete: 'Delete workflow run',
};

/** "2,500+ workflow runs", "4 workflow run results" with a filter, as GitHub counts them. */
export function countText(total: number, filtered: boolean): string {
  const count = total > 2500 ? '2,500+' : total.toLocaleString('en-US');
  return `${count} workflow run${filtered ? ' result' : ''}${total === 1 ? '' : 's'}`;
}

/** A deployment's state as an icon's bucket and a word. */
export function deploymentState(d: Pick<Deployment, 'state' | 'status'>): { bucket: StateBucket; label: string } {
  const key = d.state === 'active' ? 'active' : (d.status || d.state);
  const buckets: Record<string, StateBucket> = { active: 'success', success: 'success', inactive: 'neutral', destroyed: 'neutral', abandoned: 'cancelled', failure: 'failure', error: 'failure', in_progress: 'running', queued: 'queued', pending: 'queued', waiting: 'waiting' };
  return { bucket: buckets[key] || 'neutral', label: key ? `${key.charAt(0).toUpperCase()}${key.slice(1).replace(/_/g, ' ')}` : '' };
}

/** How often a run or a job is read again while it runs, a list while it is shown; never once GitHub's hourly budget is nearly used. */
export const LIST_POLL_MS = 30_000;
export const RUN_POLL_MS = 5_000;
export const LOW_BUDGET = 200;

export function pollDelay(answer: unknown, running: boolean, list = false): number | false {
  const rate = answer && typeof answer === 'object' && 'rate' in answer ? (answer as { rate?: Rate | null }).rate : null;
  if (rate && rate.remaining < LOW_BUDGET) return false;
  if (list) return LIST_POLL_MS;
  return running ? RUN_POLL_MS : false;
}

/** The pages that stay on GitHub, opened in the browser inside the app. */
export function githubUrl(repo: Pick<ActionsRepo, 'host' | 'owner' | 'repo'>, path: string): string {
  return `https://${repo.host}/${repo.owner}/${repo.repo}/${path}`;
}
