// The Actions view for a paired phone: which of its channels a phone may call
// (remote-api.js). projects.js checks that the folder is attached to the
// project (requireAttachedFolder) and actions.js and actions-edits.js check
// every value again, so this file only checks the shape of each parameter.
// Parameters are positional, in the order of the IPC handlers in main.js.
//
// A phone may run, re-run, cancel and delete runs, as the desktop does: a
// paired phone can already run any command in a terminal session, so holding
// these back would protect nothing. The phone asks before each of them.
//
// The downloads (an artifact, a log archive) stay on the desktop: they write
// into a folder the desktop's own dialog picks. The phone opens GitHub's page.
//
// Every change goes through one channel, edit-actions, whose parameters are
// checked here against actions-edits.js's own table of kinds: what a phone may
// send is exactly what the desktop takes.

const { allow } = require('./remote-api');
const { checkParams } = require('./actions-edits');

const isString = (max) => v => typeof v === 'string' && v.length > 0 && v.length <= max;
const isId = isString(200);
const isPath = v => isString(4096)(v) && v.startsWith('/');
const optional = check => v => v === undefined || v === null || check(v);
const isPlainObject = v => !!v && typeof v === 'object' && !Array.isArray(v);
const oneOf = (...values) => v => values.includes(v);
/** An object with only these keys, each passing its check; `required` keys must be there. */
const fields = (checks, required = []) => v => isPlainObject(v)
  && required.every(key => v[key] !== undefined)
  && Object.keys(v).every(key => Object.hasOwn(checks, key) && checks[key](v[key]));

// A remote's name, never something that reads as an option.
const isRemote = v => isString(200)(v) && !v.startsWith('-');
const isBigId = v => Number.isSafeInteger(v) && v > 0; // run, job and artifact ids pass 10^9
const isWorkflow = v => isBigId(v) || (typeof v === 'string' && /^[A-Za-z0-9._-]{1,200}\.ya?ml$/.test(v));
const isQuery = v => typeof v === 'string' && v.length <= 200;
const isPage = v => Number.isInteger(v) && v >= 1 && v <= 1000;
const isRef = v => isString(255)(v) && !v.startsWith('-') && !/[\x00-\x20\x7f~^:?*[\\]/.test(v);

const REMOTE_ONLY = optional(fields({ remote: optional(isRemote) }));
const RUNS_OPTS = optional(fields({
  remote: optional(isRemote),
  workflowId: optional(isWorkflow),
  page: optional(isPage),
  perPage: optional(v => Number.isInteger(v) && v >= 1 && v <= 100),
  query: optional(isQuery),
}));
const RUN_OPTS = fields({ remote: optional(isRemote), runId: isBigId, attempt: optional(v => Number.isInteger(v) && v >= 1 && v <= 100) }, ['runId']);
const JOB_OPTS = fields({ remote: optional(isRemote), jobId: isBigId }, ['jobId']);
const STEP_OPTS = fields({ remote: optional(isRemote), jobId: isBigId, step: v => Number.isInteger(v) && v >= 1 && v <= 1000 }, ['jobId', 'step']);
const FILE_OPTS = fields({ remote: optional(isRemote), path: v => typeof v === 'string' && /^\.github\/workflows\/[A-Za-z0-9._-]{1,200}\.ya?ml$/.test(v), ref: isRef }, ['path', 'ref']);
const DISPATCH_OPTS = fields({ remote: optional(isRemote), workflowId: isWorkflow, ref: optional(isRef) }, ['workflowId']);
const REFS_OPTS = optional(fields({ remote: optional(isRemote), query: optional(isQuery) }));
const CACHES_OPTS = optional(fields({
  remote: optional(isRemote),
  ref: optional(v => typeof v === 'string' && v.length <= 260 && /^refs\/(heads|tags|pull)\//.test(v)),
  key: optional(v => typeof v === 'string' && v.length <= 512),
  sort: optional(oneOf('last_accessed_at', 'created_at', 'size_in_bytes')),
  direction: optional(oneOf('asc', 'desc')),
  page: optional(isPage),
}));
const DEPLOYMENTS_OPTS = optional(fields({ remote: optional(isRemote), environment: optional(isString(255)), after: optional(isString(500)) }));
// One of actions-edits.js's kinds, with its own fields and nothing else.
const EDIT_PARAMS = v => isPlainObject(v) && (v.remote === undefined || v.remote === null || isRemote(v.remote)) && !checkParams(v).error;

allow('get-actions-workflows', [isId, isPath, REMOTE_ONLY]);
allow('get-actions-runs', [isId, isPath, RUNS_OPTS]);
allow('get-actions-run', [isId, isPath, RUN_OPTS]);
allow('get-actions-job', [isId, isPath, JOB_OPTS]);
allow('get-actions-step-log', [isId, isPath, STEP_OPTS]);
allow('get-actions-job-log', [isId, isPath, JOB_OPTS]);
allow('get-actions-workflow-file', [isId, isPath, FILE_OPTS]);
allow('get-actions-dispatch-form', [isId, isPath, DISPATCH_OPTS]);
allow('get-actions-refs', [isId, isPath, REFS_OPTS]);
allow('get-actions-caches', [isId, isPath, CACHES_OPTS]);
allow('get-actions-runners', [isId, isPath, REMOTE_ONLY]);
allow('get-actions-deployments', [isId, isPath, DEPLOYMENTS_OPTS]);
allow('edit-actions', [isId, isPath, EDIT_PARAMS]);
