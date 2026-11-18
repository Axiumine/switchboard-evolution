// Reads src/terminal/terminal-buttons.yml, the terminal's key bar, and writes
// it as the TypeScript module the app imports. What each action sends is
// decided in src/terminal/keys.ts; here only the file's shape is checked.

const yaml = require('js-yaml');

const fail = (message) => { throw new Error(`terminal-buttons.yml: ${message}`); };
const isText = (value) => typeof value === 'string' && value.length > 0;

function button(value, where) {
  if (!value || typeof value !== 'object') fail(`${where} is not a key`);
  if (!isText(value.label)) fail(`${where} has no label`);
  if (!isText(value.action)) fail(`${where} has no action`);
  const out = { label: value.label, action: value.action };
  if (value.up !== undefined) {
    if (!value.up || !isText(value.up.label) || !isText(value.up.action)) fail(`${where}: "up" needs a label and an action`);
    out.up = { label: value.up.label, action: value.up.action };
  }
  return out;
}

function number(value, where) {
  if (typeof value !== 'number' || !(value >= 0)) fail(`${where} is not a number`);
  return value;
}

/** The bar described by the YAML text, checked. */
function readButtons(text) {
  const doc = yaml.load(text);
  if (!doc || typeof doc !== 'object') fail('the file is empty');
  const { look, rows, modifiers, repeat_while_held: repeat = [], more_keys: more = [] } = doc;

  if (!look || !look.swipe_text) fail('"look" needs height, key_text and swipe_text');
  const opacity = number(look.swipe_text.opacity, 'look.swipe_text.opacity');
  if (opacity > 1) fail('look.swipe_text.opacity goes from 0 to 1');

  if (!Array.isArray(rows) || rows.length === 0) fail('"rows" needs at least one row');
  const columns = Array.isArray(rows[0]) ? rows[0].length : 0;
  rows.forEach((row, r) => {
    if (!Array.isArray(row) || row.length === 0) fail(`row ${r + 1} has no keys`);
    // Every key is as wide as the others, so every row has as many.
    if (row.length !== columns) fail(`row ${r + 1} has ${row.length} keys, row 1 has ${columns}`);
  });

  const fn = (modifiers && modifiers.fn) || {};
  for (const [from, to] of Object.entries(fn)) if (!isText(to)) fail(`modifiers.fn "${from}" has no key`);
  if (!Array.isArray(repeat) || !repeat.every(isText)) fail('"repeat_while_held" is a list of actions');
  if (!Array.isArray(more)) fail('"more_keys" is a list of keys');

  return {
    look: {
      height: number(look.height, 'look.height'),
      keyText: number(look.key_text, 'look.key_text'),
      swipeText: { size: number(look.swipe_text.size, 'look.swipe_text.size'), opacity },
    },
    rows: rows.map((row, r) => row.map((key, k) => button(key, `row ${r + 1}, key ${k + 1}`))),
    fn: Object.fromEntries(Object.entries(fn).map(([from, to]) => [String(from), to])),
    repeat,
    more: more.map((key, k) => button(key, `more_keys, key ${k + 1}`)),
  };
}

/** The module src/terminal/terminal-buttons.generated.ts holds. */
function renderModule(buttons) {
  return [
    '// Generated from terminal-buttons.yml by scripts/build-terminal-keys.mjs.',
    '// Do not edit: change the YAML and run npm run build-terminal-keys.',
    '',
    "import type { TerminalButtons } from './keys';",
    '',
    `export const TERMINAL_BUTTONS: TerminalButtons = ${JSON.stringify(buttons, null, 2)};`,
    '',
  ].join('\n');
}

module.exports = { readButtons, renderModule };
