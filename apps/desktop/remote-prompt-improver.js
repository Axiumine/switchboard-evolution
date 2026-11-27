// The prompt improver for a paired phone: which of its channels a phone may
// call (remote-api.js), and the event it hears. prompt-improver.js and the
// shared model check every value again, so this file only checks the shape
// of each parameter. Parameters are positional, in the order of the IPC
// handlers in main.js.
//
// The app's other global settings, and CBM's, are in remote-settings.js
// (a phone may change them, Pre-launch Command, Projects Folder, permission
// mode and sandbox included: no new power, since a paired phone already types
// into terminals and starts sessions). The generic get-setting and
// set-setting stay desktop-only; the prompt improver's settings, improver
// prompt included, are edited through the two channels below.

const { allow, allowEvent } = require('./remote-api');
const { MODES, ENGINES, CLIS, MAX_PROMPT, MAX_TEMPLATE } = require('./public/prompt-improver-model');

const isString = (max) => v => typeof v === 'string' && v.length > 0 && v.length <= max;
const isText = (max) => v => typeof v === 'string' && v.length <= max;
const isId = isString(200);
const isBool = v => typeof v === 'boolean';
const isInt = (min, max) => v => Number.isInteger(v) && v >= min && v <= max;
const optional = check => v => v === undefined || v === null || check(v);
const isPlainObject = v => !!v && typeof v === 'object' && !Array.isArray(v);
const oneOf = (values) => v => values.includes(v);
const fields = (checks, required = []) => v => isPlainObject(v)
  && required.every(key => v[key] !== undefined)
  && Object.keys(v).every(key => Object.hasOwn(checks, key) && checks[key](v[key]));

const IMPROVE_OPTIONS = fields({ mode: oneOf(MODES), runtime: oneOf(CLIS) });
const SETTINGS_PATCH = fields({
  enabled: isBool,
  confirm: isBool,
  engine: oneOf(ENGINES),
  context: oneOf(MODES),
  recentTurns: isInt(0, 20),
  timeoutSec: isInt(20, 600),
  models: fields({ claude: isText(120), codex: isText(120), opencode: isText(120) }),
  template: v => v === null || isText(MAX_TEMPLATE)(v),
});

allow('improve-prompt', [isId, isString(MAX_PROMPT), optional(IMPROVE_OPTIONS)]);
allow('cancel-prompt-improvement', [isId]);
allow('get-prompt-improver-settings', []);
allow('set-prompt-improver-settings', [SETTINGS_PATCH]);
allowEvent('prompt-improver-settings-changed');
