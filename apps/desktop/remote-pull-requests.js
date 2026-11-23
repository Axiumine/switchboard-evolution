// The Pull Requests tab for a paired phone: which of its channels a phone may
// call (remote-api.js). projects.js checks that the folder is attached to the
// project (requireAttachedFolder) and pull-requests.js allows only its own
// actions and merge methods, so this file only checks the shape of each
// parameter. Parameters are positional, in the order of the IPC handlers in
// main.js.
//
// A phone may merge and close pull requests: a paired phone can already run
// any command in a terminal session, so holding these back would protect
// nothing. The phone asks before each of them, as the desktop does.
//
// There are no events here: the phone reloads the list after an action.
//
// An open pull request's tabs read through pull-request-detail.js, and every
// other change goes through one channel, edit-pull-request, whose parameters
// are checked here against pull-request-edits.js's own table of kinds: what a
// phone may send is exactly what the desktop takes.

const { allow } = require('./remote-api');
const { checkParams } = require('./pull-request-edits');

const isString = (max) => v => typeof v === 'string' && v.length > 0 && v.length <= max;
const isId = isString(200);
const isPath = v => isString(4096)(v) && v.startsWith('/');
const isBool = v => typeof v === 'boolean';
const optional = check => v => v === undefined || v === null || check(v);
const isPlainObject = v => !!v && typeof v === 'object' && !Array.isArray(v);
const arrayOf = (check, max) => v => Array.isArray(v) && v.length > 0 && v.length <= max && v.every(check);
const oneOf = (...values) => v => values.includes(v);
/** An object with only these keys, each passing its check; `required` keys must be there. */
const fields = (checks, required = []) => v => isPlainObject(v)
  && required.every(key => v[key] !== undefined)
  && Object.keys(v).every(key => Object.hasOwn(checks, key) && checks[key](v[key]));

// A remote's name, never something that reads as an option.
const isRemote = v => isString(200)(v) && !v.startsWith('-');
const isNumber = v => Number.isInteger(v) && v > 0 && v < 1e9;
const isPageSize = v => Number.isInteger(v) && v >= 1 && v <= 100;
const isHash = v => typeof v === 'string' && /^[0-9a-f]{40}$/.test(v);
const isJobId = v => Number.isSafeInteger(v) && v > 0; // GitHub Actions job ids pass 10^9
const isQuery = v => typeof v === 'string' && v.length <= 200;
const isText = v => typeof v === 'string' && v.length <= 65536;

const LIST_OPTS = optional(fields({ remote: optional(isRemote) }));
const PAGE_OPTS = fields({
  remote: optional(isRemote),
  states: arrayOf(oneOf('CLOSED', 'MERGED'), 2),
  first: optional(isPageSize),
  after: optional(isString(500)),
}, ['states']);
const FILES_OPTS = fields({ remote: optional(isRemote), number: isNumber }, ['number']);
// The same as ACTIONS and MERGE_METHODS in pull-requests.js.
const ACTION_PARAMS = fields({
  remote: optional(isRemote),
  number: isNumber,
  action: oneOf('merge', 'draft', 'ready', 'close', 'reopen'),
  method: optional(oneOf('merge', 'squash', 'rebase')),
  deleteBranch: optional(isBool),
  headOid: optional(isHash),
}, ['number', 'action']);

const NUMBER_OPTS = fields({ remote: optional(isRemote), number: isNumber }, ['number']);
const CONVERSATION_OPTS = fields({ remote: optional(isRemote), number: isNumber, after: optional(isString(500)) }, ['number']);
const COMMIT_OPTS = fields({ remote: optional(isRemote), sha: isHash }, ['sha']);
const LOG_OPTS = fields({ remote: optional(isRemote), jobId: isJobId }, ['jobId']);
const BRANCH_OPTS = optional(fields({ remote: optional(isRemote), query: optional(isQuery) }));
const CANDIDATE_OPTS = fields({ remote: optional(isRemote), kind: oneOf('labels', 'users'), query: optional(isQuery) }, ['kind']);
const MARKDOWN_OPTS = fields({ remote: optional(isRemote), text: isText }, ['text']);
// One of pull-request-edits.js's kinds, with its own fields and nothing else.
const EDIT_PARAMS = v => isPlainObject(v) && (v.remote === undefined || v.remote === null || isRemote(v.remote)) && !checkParams(v).error;

allow('get-pull-requests', [isId, isPath, LIST_OPTS]);
allow('get-pull-requests-page', [isId, isPath, PAGE_OPTS]);
allow('get-pull-request-files', [isId, isPath, FILES_OPTS]);
allow('run-pull-request-action', [isId, isPath, ACTION_PARAMS]);
allow('get-pull-request-conversation', [isId, isPath, CONVERSATION_OPTS]);
allow('get-pull-request-commits', [isId, isPath, NUMBER_OPTS]);
allow('get-pull-request-commit-files', [isId, isPath, COMMIT_OPTS]);
allow('get-pull-request-checks', [isId, isPath, NUMBER_OPTS]);
allow('get-pull-request-job-log', [isId, isPath, LOG_OPTS]);
allow('get-pull-request-viewed', [isId, isPath, NUMBER_OPTS]);
allow('get-pull-request-branches', [isId, isPath, BRANCH_OPTS]);
allow('get-pull-request-candidates', [isId, isPath, CANDIDATE_OPTS]);
allow('render-pull-request-markdown', [isId, isPath, MARKDOWN_OPTS]);
allow('edit-pull-request', [isId, isPath, EDIT_PARAMS]);
