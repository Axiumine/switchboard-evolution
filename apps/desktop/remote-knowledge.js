// The Node Knowledge tab for a paired phone: which of its channels a phone may
// call (remote-api.js), and the event it hears. knowledge.js checks every
// folder against the project and fills in the CBM project itself, so this file
// only checks the shape of each parameter. Parameters are positional, in the
// order of the IPC handlers in main.js.
//
// Exposed to a phone here: the tab's own queries and jobs. CBM's program and
// settings (get-knowledge-binary, get/set-knowledge-config) are in
// remote-settings.js, with the app's other global settings. That is a change
// for security: a paired phone can now change Pre-launch Command, Projects
// Folder, permission mode and sandbox. It is no new power, since a paired
// phone already types into terminals and starts sessions.
//
// Left out on purpose, desktop-only: which program the desktop runs
// (set-knowledge-global, the binary's pick and download), CBM's installer for
// the agents, the Lens (a web page on the desktop, without a login) and the
// native dialogs (the traces file, the program). The Lens keys ui_enabled and
// ui_port go through the desktop's own set-knowledge-config handler, but the
// phone's allow list in remote-settings.js refuses them. A phone sends traces
// as data instead.

const { allow, allowEvent } = require('./remote-api');

const isString = (max) => v => typeof v === 'string' && v.length > 0 && v.length <= max;
const isText = (max) => v => typeof v === 'string' && v.length <= max;
const isId = isString(200);
const isPath = v => isString(4096)(v) && v.startsWith('/');
const isBool = v => typeof v === 'boolean';
const isInt = (min, max) => v => Number.isInteger(v) && v >= min && v <= max;
const optional = check => v => v === undefined || v === null || check(v);
const isPlainObject = v => !!v && typeof v === 'object' && !Array.isArray(v);
const arrayOf = (check, max) => v => Array.isArray(v) && v.length <= max && v.every(check);
const oneOf = (...values) => v => values.includes(v);
const fields = (checks, required = []) => v => isPlainObject(v)
  && required.every(key => v[key] !== undefined)
  && Object.keys(v).every(key => Object.hasOwn(checks, key) && checks[key](v[key]));
/** A JSON value no larger than `max` bytes (a tool's arguments, a trace). */
const smallJson = (max) => v => {
  try { return Buffer.byteLength(JSON.stringify(v)) <= max; } catch { return false; }
};

// Same lists as knowledge.js.
const READ_TOOLS = [
  'search_graph', 'search_code', 'trace_path', 'get_code_snippet', 'get_file_outline',
  'get_graph_schema', 'get_architecture', 'query_graph', 'detect_changes', 'index_status',
  'check_index_coverage',
];
const isMode = oneOf('full', 'moderate', 'fast');

const SETTINGS_PATCH = fields({
  enabled: isBool,
  mode: isMode,
  toolProfile: oneOf('all', 'analysis', 'scout'),
  crossRepo: isBool,
  autoRefresh: isBool,
  share: v => isPlainObject(v) && Object.keys(v).length <= 100 && Object.entries(v).every(([k, b]) => isPath(k) && isBool(b)),
  savedQueries: arrayOf(fields({ name: isText(80), query: isString(4000) }, ['query']), 100),
});
const ADR_OPTS = fields({
  mode: oneOf('outline', 'get', 'update', 'set_sections'),
  content: isText(8000 * 4),
  section_updates: v => isPlainObject(v) && Object.keys(v).length <= 100 && Object.values(v).every(isText(16000)),
  section_limit: isInt(1, 500),
  section_offset: isInt(0, 100000),
});
const TRACE = v => isPlainObject(v) && smallJson(8192)(v);

allow('get-knowledge-status', [isId]);
allow('get-knowledge-settings', [isId]);
allow('set-knowledge-settings', [isId, SETTINGS_PATCH]);
allow('knowledge-query', [isId, isPath, oneOf(...READ_TOOLS), optional(v => isPlainObject(v) && smallJson(64 * 1024)(v))]);
allow('knowledge-compare', [isId, isPath, isPath, optional(fields({ limit: isInt(1, 1000), scan_limit: isInt(1, 10_000_000) }))]);
allow('knowledge-prompt', [isId, isPath, oneOf('explore_codebase', 'review_change_impact'), optional(fields({ question: isText(2000), change: isText(2000), base_branch: isText(200) }))]);
allow('knowledge-index', [isId, isPath, optional(fields({ mode: isMode }))]);
allow('knowledge-index-all', [isId, optional(fields({ mode: isMode }))]);
allow('knowledge-link-cross-repo', [isId]);
allow('knowledge-delete-index', [isId, isPath]);
allow('knowledge-modules', [isId, isPath]);
allow('knowledge-delete-inner-graph', [isId, isPath, isText(200)]);
allow('knowledge-adr', [isId, isPath, optional(ADR_OPTS)]);
allow('knowledge-ingest-traces', [isId, isPath, fields({ traces: arrayOf(TRACE, 10000), label: isText(100) }, ['traces'])]);

// Index jobs, settings, ADR and traces: the phone's queries refresh on it.
allowEvent('knowledge-changed');

module.exports = { READ_TOOLS };
