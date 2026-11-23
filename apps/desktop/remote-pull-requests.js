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

const { allow } = require('./remote-api');

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
  action: oneOf('merge', 'draft', 'ready', 'close'),
  method: optional(oneOf('merge', 'squash', 'rebase')),
  deleteBranch: optional(isBool),
  headOid: optional(isHash),
}, ['number', 'action']);

allow('get-pull-requests', [isId, isPath, LIST_OPTS]);
allow('get-pull-requests-page', [isId, isPath, PAGE_OPTS]);
allow('get-pull-request-files', [isId, isPath, FILES_OPTS]);
allow('run-pull-request-action', [isId, isPath, ACTION_PARAMS]);
