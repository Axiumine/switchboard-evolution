// actions-edits.js — what the Actions view changes on GitHub, as the buttons of
// GitHub's Actions tab do: run a workflow by hand ("Run workflow"), re-run a
// run, its failed jobs or one job (with debug logging), cancel or force-cancel
// a run, delete a run or its logs, enable and disable a workflow, approve a
// fork's run, approve or reject the deployments a run waits for, delete an
// artifact or a cache, remove a self-hosted runner or set its labels; and the
// two downloads, an artifact and a log.
//
// Each change is one `kind` from KINDS, which names its fields, the check of
// each field, the REST method and path, and the body. The path holds only
// validated ids and file names; every text (inputs, comments, labels) travels
// as the JSON body on gh's stdin.

const fs = require('fs');
const path = require('path');
const pr = require('./pull-requests');
const actions = require('./actions');
const AM = require('./public/actions-model');

const MAX_COMMENT = 65536;
const MAX_LIST = 100;
const MAX_INPUTS_SIZE = 65535;

// --- Checks of the fields ---

const isId = v => Number.isSafeInteger(v) && v > 0;
const isBool = v => typeof v === 'boolean';
const isWorkflow = v => (Number.isSafeInteger(v) && v > 0) || (typeof v === 'string' && /^[A-Za-z0-9._-]{1,200}\.ya?ml$/.test(v));
const isRef = v => typeof v === 'string' && !/^[0-9a-f]{40}$/.test(v) && actions.isRef(v);
const isComment = v => typeof v === 'string' && v.length <= MAX_COMMENT;
const listOf = check => v => Array.isArray(v) && v.length > 0 && v.length <= MAX_LIST && v.every(check);
const oneOf = (...values) => v => values.includes(v);
// A runner's custom label: what GitHub takes (letters, digits, - _ . : and no spaces).
const isLabel = v => typeof v === 'string' && /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,99}$/.test(v);
const isCacheKey = v => typeof v === 'string' && v.length > 0 && v.length <= 512 && !/[\x00-\x1f\x7f]/.test(v);
const isCacheRef = v => typeof v === 'string' && /^refs\/(heads|tags|pull)\/\S{1,250}$/.test(v) && !/[\x00-\x20\x7f]/.test(v);

/** The "Run workflow" inputs: at most 25 names GitHub takes, each value a string, 65,535 characters together. */
function isInputs(v) {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return false;
  const keys = Object.keys(v);
  if (keys.length > AM.MAX_INPUTS) return false;
  if (!keys.every(k => /^[A-Za-z_][A-Za-z0-9_-]{0,99}$/.test(k) && typeof v[k] === 'string')) return false;
  return JSON.stringify(v).length <= MAX_INPUTS_SIZE;
}

const runs = (p, repo) => `repos/${repo}/actions/runs/${p.runId}`;

/**
 * Each kind: `fields` (name → check), `optional` field names, the REST
 * `method`, the `path` from the fields, the JSON `body` when it has one, and
 * `done`, the sentence shown afterwards.
 */
const KINDS = {
  dispatch: {
    fields: { workflowId: isWorkflow, ref: isRef, inputs: isInputs },
    optional: ['inputs'],
    method: 'POST',
    path: (p, repo) => `repos/${repo}/actions/workflows/${encodeURIComponent(String(p.workflowId))}/dispatches`,
    body: p => ({ ref: p.ref, inputs: p.inputs || {}, return_run_details: true }),
    done: () => 'Workflow run was successfully requested.',
  },
  rerun: {
    // All the jobs, or (failedOnly) the failed ones and what depends on them.
    fields: { runId: isId, failedOnly: isBool, debug: isBool },
    optional: ['failedOnly', 'debug'],
    method: 'POST',
    path: (p, repo) => `${runs(p, repo)}/${p.failedOnly ? 'rerun-failed-jobs' : 'rerun'}`,
    body: p => (p.debug ? { enable_debug_logging: true } : null),
    done: p => (p.failedOnly ? 'Re-running the failed jobs.' : 'Re-running all jobs.'),
  },
  'rerun-job': {
    fields: { jobId: isId, debug: isBool },
    optional: ['debug'],
    method: 'POST',
    path: (p, repo) => `repos/${repo}/actions/jobs/${p.jobId}/rerun`,
    body: p => (p.debug ? { enable_debug_logging: true } : null),
    done: () => 'Re-running the job.',
  },
  cancel: {
    fields: { runId: isId },
    method: 'POST',
    path: (p, repo) => `${runs(p, repo)}/cancel`,
    done: () => 'Cancelling the workflow run.',
  },
  'force-cancel': {
    // Stops the run even past `always()` steps: for a run a cancel does not stop.
    fields: { runId: isId },
    method: 'POST',
    path: (p, repo) => `${runs(p, repo)}/force-cancel`,
    done: () => 'Force-cancelling the workflow run.',
  },
  'delete-run': {
    fields: { runId: isId },
    method: 'DELETE',
    path: runs,
    done: () => 'The workflow run is deleted.',
  },
  'delete-logs': {
    fields: { runId: isId },
    method: 'DELETE',
    path: (p, repo) => `${runs(p, repo)}/logs`,
    done: () => 'The run\'s logs are deleted.',
  },
  enable: {
    fields: { workflowId: isWorkflow },
    method: 'PUT',
    path: (p, repo) => `repos/${repo}/actions/workflows/${encodeURIComponent(String(p.workflowId))}/enable`,
    done: () => 'Workflow enabled.',
  },
  disable: {
    fields: { workflowId: isWorkflow },
    method: 'PUT',
    path: (p, repo) => `repos/${repo}/actions/workflows/${encodeURIComponent(String(p.workflowId))}/disable`,
    done: () => 'Workflow disabled.',
  },
  'approve-fork': {
    // A first-time contributor's pull request from a fork waits for this.
    fields: { runId: isId },
    method: 'POST',
    path: (p, repo) => `${runs(p, repo)}/approve`,
    done: () => 'Approved: the workflows run now.',
  },
  'review-deployments': {
    fields: { runId: isId, environmentIds: listOf(isId), state: oneOf('approved', 'rejected'), comment: isComment },
    optional: ['comment'],
    method: 'POST',
    path: (p, repo) => `${runs(p, repo)}/pending_deployments`,
    body: p => ({ environment_ids: p.environmentIds, state: p.state, comment: p.comment || '' }),
    done: p => (p.state === 'approved'
      ? `Approved: deploying to ${p.environmentIds.length === 1 ? 'the environment' : `${p.environmentIds.length} environments`}.`
      : 'Rejected: the run will not deploy.'),
  },
  'delete-artifact': {
    fields: { artifactId: isId },
    method: 'DELETE',
    path: (p, repo) => `repos/${repo}/actions/artifacts/${p.artifactId}`,
    done: () => 'Artifact deleted.',
  },
  'delete-cache': {
    // One cache by its id, or every cache with a key (on one ref).
    fields: { cacheId: isId, key: isCacheKey, ref: isCacheRef },
    optional: ['cacheId', 'key', 'ref'],
    check: p => (p.cacheId ? (p.key || p.ref ? 'A cache is deleted by its id or by its key, not both' : null) : (p.key ? null : 'A cache needs its id or its key')),
    method: 'DELETE',
    path: (p, repo) => (p.cacheId
      ? `repos/${repo}/actions/caches/${p.cacheId}`
      : `repos/${repo}/actions/caches?key=${encodeURIComponent(p.key)}${p.ref ? `&ref=${encodeURIComponent(p.ref)}` : ''}`),
    done: p => (p.cacheId ? 'Cache deleted.' : 'The caches with that key are deleted.'),
  },
  'runner-remove': {
    fields: { runnerId: isId },
    method: 'DELETE',
    path: (p, repo) => `repos/${repo}/actions/runners/${p.runnerId}`,
    done: () => 'Runner removed.',
  },
  'runner-labels': {
    // The runner's custom labels, all of them: GitHub replaces the set.
    fields: { runnerId: isId, labels: v => Array.isArray(v) && v.length <= MAX_LIST && v.every(isLabel) },
    method: 'PUT',
    path: (p, repo) => `repos/${repo}/actions/runners/${p.runnerId}/labels`,
    body: p => ({ labels: p.labels }),
    done: () => 'Labels saved.',
  },
};

/** The fields of a change once checked, or { error }: only the kind's own fields (and `remote`, `kind`). */
function checkParams(params) {
  if (!params || typeof params !== 'object' || Array.isArray(params)) return { error: 'Nothing to change' };
  const spec = Object.prototype.hasOwnProperty.call(KINDS, params.kind) ? KINDS[params.kind] : null;
  if (!spec) return { error: `Unknown Actions change: ${params.kind}` };
  const fields = {};
  for (const key of Object.keys(params)) {
    if (key === 'kind' || key === 'remote') continue;
    if (!Object.prototype.hasOwnProperty.call(spec.fields, key)) return { error: `A ${params.kind} change takes no ${key}` };
    const value = params[key];
    if (value === undefined || value === null) continue;
    if (!spec.fields[key](value)) return { error: `Not a valid ${key}` };
    fields[key] = value;
  }
  for (const key of Object.keys(spec.fields)) {
    if (fields[key] === undefined && !(spec.optional || []).includes(key)) return { error: `A ${params.kind} change needs ${key}` };
  }
  const refused = spec.check ? spec.check(fields) : null;
  if (refused) return { error: refused };
  return { spec, fields };
}

/** GitHub's refusals in plainer words, by kind; the rest as GitHub words them. */
function editFailure(kind, failure) {
  const text = String((failure && failure.error) || '');
  if (failure.code === 'not-found') {
    if (kind === 'dispatch' || kind === 'enable' || kind === 'disable') return { ...failure, error: 'GitHub does not know this workflow any more, or your account cannot change it.' };
    return { ...failure, error: 'GitHub no longer has it, or your account cannot change it. Refresh to see it as it is now.' };
  }
  if (/HTTP 409|Cannot cancel a workflow run that is completed/i.test(text)) return { ...failure, error: 'The run has already finished.', code: 'conflict' };
  if (/Resource not accessible|Must have admin rights|HTTP 403/i.test(text) && !/rate limit/i.test(text)) {
    return { ...failure, error: `Your account may not do this in this repository. (${text.replace(/\s*\(HTTP 403\)\s*$/, '') || 'GitHub said no'})`, code: 'forbidden' };
  }
  return failure;
}

/** One REST write through gh, the body as JSON on stdin: { ok, json } or an error result. */
async function restWrite(target, method, apiPath, body) {
  const args = ['api', '--hostname', target.host, '--method', method, apiPath];
  if (body) args.push('--input', '-');
  let result;
  try {
    result = await pr.run(args, { input: body ? JSON.stringify(body) : null, timeoutMs: pr.ACTION_TIMEOUT_MS });
  } catch (err) {
    return actions.reword(pr.thrownFailure(err));
  }
  if (result.code !== 0) return pr.ghFailure(result, target);
  let json = null;
  try { json = result.stdout && result.stdout.trim() ? JSON.parse(result.stdout) : null; } catch {}
  return { ok: true, json };
}

// GitHub answers "Run workflow" with the new run's id a few seconds before the
// run itself can be read: until then, GET runs/{id} is a 404. The view opens
// the run straight away, so wait until it is there (the tests shorten this).
const RUN_WAIT = { tries: 8, delayMs: 1500 };

/** False only when every try was a 404; any other answer stops waiting. */
async function runReadable(target, repo, runId) {
  for (let i = 0; i < RUN_WAIT.tries; i++) {
    if (i) await new Promise(resolve => setTimeout(resolve, RUN_WAIT.delayMs));
    let result;
    try {
      result = await pr.run(['api', '--hostname', target.host, `repos/${repo}/actions/runs/${runId}`, '--jq', '.id'], { timeoutMs: pr.ACTION_TIMEOUT_MS });
    } catch {
      return true;
    }
    if (result.code === 0 || !/HTTP 404/.test(String(result.stderr || ''))) return true;
  }
  return false;
}

/** One change to GitHub Actions: { ok, kind, message, … } or { error, code }. */
async function edit(dir, params = {}) {
  const checked = checkParams(params);
  if (checked.error) return { error: checked.error, code: 'bad-request' };
  const { spec, fields } = checked;
  const { target, failure } = await actions.withTarget(dir, params.remote || null);
  if (failure) return failure;
  const repo = `${target.owner}/${target.repo}`;
  const answer = await restWrite(target, spec.method, spec.path(fields, repo), spec.body ? spec.body(fields) : null);
  if (!answer.ok) return editFailure(params.kind, answer);
  pr.info('[actions]', params.kind, repo);
  const result = { ok: true, kind: params.kind, message: spec.done(fields) };
  // "Run workflow" answers with the run it started (GitHub, since 2026-02).
  // A run GitHub still cannot read is left out: the view shows the list instead.
  if (params.kind === 'dispatch' && answer.json && Number.isSafeInteger(answer.json.workflow_run_id)) {
    result.url = typeof answer.json.html_url === 'string' ? answer.json.html_url : null;
    if (await runReadable(target, repo, answer.json.workflow_run_id)) result.runId = answer.json.workflow_run_id;
  }
  return result;
}

// --- Downloads (the desktop only: main.js asks where, with the system's own dialog) ---

const isArtifactName = v => typeof v === 'string' && v.length > 0 && v.length <= 255 && !/[\x00-\x1f\x7f]/.test(v);

/** A folder name for an artifact: its name without what a file system refuses. */
function folderName(name) {
  const cleaned = String(name).replace(/[\\/:*?"<>|]/g, '-').replace(/^\.+/, '').trim();
  return cleaned || 'artifact';
}

/**
 * An artifact's files, into a folder named after it inside `destDir` (a
 * folder the user picked): gh downloads the artifact and unpacks it there.
 */
async function downloadArtifact(dir, { remote = null, runId, name, destDir } = {}) {
  if (!isId(runId)) return { error: 'Not a workflow run', code: 'bad-request' };
  if (!isArtifactName(name)) return { error: 'Not an artifact', code: 'bad-request' };
  if (typeof destDir !== 'string' || !path.isAbsolute(destDir)) return { error: 'Not a folder', code: 'bad-request' };
  const { target, failure } = await actions.withTarget(dir, remote);
  if (failure) return failure;
  const into = path.join(destDir, folderName(name));
  if (fs.existsSync(into)) return { error: `${path.basename(into)} is already there. Choose another folder or move it first.`, code: 'exists' };
  let result;
  try {
    result = await pr.run(['run', 'download', String(runId), '-R', pr.repoArg(target), `--name=${name}`, '--dir', into], { timeoutMs: 10 * 60_000 });
  } catch (err) {
    return actions.reword(pr.thrownFailure(err));
  }
  if (result.code !== 0) return actions.reword(pr.ghFailure(result, target), 'GitHub no longer has this artifact (it may have expired), or your account cannot see it.');
  return { ok: true, path: into, message: `Downloaded ${name}.` };
}

/**
 * A log into `filePath` (a file the user picked): a job's log as text, with
 * its timestamps, or a run's (or one attempt's) log archive as GitHub zips it.
 */
async function saveLog(dir, { remote = null, jobId = null, runId = null, attempt = null, filePath } = {}) {
  if (typeof filePath !== 'string' || !path.isAbsolute(filePath)) return { error: 'Not a file', code: 'bad-request' };
  if (jobId !== null) {
    if (!isId(jobId)) return { error: 'Not a job', code: 'bad-request' };
    const log = await actions.jobLog(dir, { remote, jobId });
    if (!log.ok) return log;
    await fs.promises.writeFile(filePath, log.text);
    return { ok: true, path: filePath, message: log.truncated ? 'Saved the end of the job\'s log (the app keeps the last 2 MB).' : 'Saved the job\'s log.' };
  }
  if (!isId(runId)) return { error: 'Not a workflow run', code: 'bad-request' };
  if (attempt !== null && !(Number.isInteger(attempt) && attempt >= 1 && attempt <= 100)) return { error: 'Not an attempt', code: 'bad-request' };
  const { target, failure } = await actions.withTarget(dir, remote);
  if (failure) return failure;
  const logsPath = `repos/${target.owner}/${target.repo}/actions/runs/${runId}${attempt ? `/attempts/${attempt}` : ''}/logs`;
  let result;
  try {
    result = await pr.run(['api', '--hostname', target.host, logsPath], { timeoutMs: 5 * 60_000, binary: true });
  } catch (err) {
    return actions.reword(pr.thrownFailure(err));
  }
  if (result.code !== 0) {
    const failed = pr.ghFailure({ ...result, stdout: Buffer.isBuffer(result.stdout) ? result.stdout.toString('utf8') : result.stdout }, target);
    if (failed.code === 'not-found') return { error: 'GitHub has no logs of this run: they come once it has finished, and go when they are deleted or expire.', code: 'not-found' };
    return actions.reword(failed);
  }
  await fs.promises.writeFile(filePath, result.stdout);
  return { ok: true, path: filePath, message: 'Saved the run\'s log archive.' };
}

module.exports = {
  edit, downloadArtifact, saveLog,
  // exported for tests
  KINDS, checkParams, editFailure, folderName, isInputs, RUN_WAIT,
};
