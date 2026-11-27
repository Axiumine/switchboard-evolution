// The app's global settings, and codebase-memory-mcp's (CBM) settings, for a
// paired phone: which channels a phone may call (remote-api.js), and the event
// it hears. settings-patch.js and the shared model (public/settings-model.js)
// check every value again, so this file only checks the shape of each
// parameter. Parameters are positional, in the order of the IPC handlers in
// main.js.
//
// What a phone may do here: read the global settings with the options its
// fields need (get-global-settings), save a patch of them
// (set-global-settings, the same patch as the desktop panel), read CBM's
// program and settings, and change the CBM settings the shared catalog lists.
//
// What this changes for security: a paired phone can now change the Pre-launch
// Command, the Projects Folder, the permission mode and the sandbox. That is
// no new power: a paired phone already types into terminals (terminal-input)
// and starts sessions.
//
// Still desktop-only: the generic get-setting and set-setting, which program
// CBM runs (set-knowledge-global, knowledge-pick-binary,
// knowledge-download-binary), its installer for the agents, the Lens
// (ui_enabled and ui_port: a web page on the desktop, without a login), the
// updater and open-path (which opens the Finder).

const { allow, allowEvent } = require('./remote-api');
const { KNOWLEDGE_CONFIG_FIELDS } = require('./public/settings-model');

const isText = (max) => v => typeof v === 'string' && v.length <= max;
const isPlainObject = v => !!v && typeof v === 'object' && !Array.isArray(v);
const oneOf = (values) => v => values.includes(v);
/** A JSON value no larger than `max` bytes. */
const smallJson = (max) => v => {
  try { return Buffer.byteLength(JSON.stringify(v)) <= max; } catch { return false; }
};

// The values are checked by the patch; here only the shape, and a size well
// above the longest field (a command, a path, a prompt).
const MAX_PATCH_BYTES = 64 * 1024;
const isPatch = v => isPlainObject(v) && smallJson(MAX_PATCH_BYTES)(v);

allow('get-global-settings', []);
allow('set-global-settings', [isPatch]);
allow('get-knowledge-binary', []);
allow('get-knowledge-config', []);
allow('set-knowledge-config', [oneOf(KNOWLEDGE_CONFIG_FIELDS.map(field => field.key)), isText(64)]);
allowEvent('global-settings-changed');
