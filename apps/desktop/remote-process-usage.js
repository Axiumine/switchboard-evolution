// The Task Manager for a paired phone: which of its channels a phone may call
// (remote-api.js). main.js looks up every root pid itself from the session or
// task an owner names (ownerRootPid), and a kill only reaches a process still
// in that tree, so this file only checks the shape of each parameter.
// Parameters are positional, in the order of the IPC handlers in main.js.
//
// A paired phone can already stop sessions and run any command in a terminal,
// so stopping or killing what a session started gives it nothing new.

const { allow } = require('./remote-api');

const isString = (max) => v => typeof v === 'string' && v.length > 0 && v.length <= max;
const isPlainObject = v => !!v && typeof v === 'object' && !Array.isArray(v);

/**
 * A session ({ kind: 'session', id }) or a running task ({ kind: 'task',
 * projectPath, label }), and nothing else: the phone sends back only what
 * names the owner, not the measurements it was given.
 */
function isOwner(v) {
  if (!isPlainObject(v)) return false;
  const keys = Object.keys(v).sort().join(',');
  if (v.kind === 'session') return keys === 'id,kind' && isString(500)(v.id);
  if (v.kind === 'task') return keys === 'kind,label,projectPath' && isString(4096)(v.projectPath) && isString(500)(v.label);
  return false;
}

const isPid = v => Number.isInteger(v) && v > 0 && v < 2 ** 31;
const isOptionalBool = v => v === undefined || v === null || typeof v === 'boolean';

allow('get-process-usage');
allow('stop-owner', [isOwner]);
allow('kill-owned-process', [isOwner, isPid, isOptionalBool]);
allow('force-stop-owner', [isOwner]);

module.exports = { isOwner };
