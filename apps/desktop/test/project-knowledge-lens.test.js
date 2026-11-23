// project-knowledge-lens.js and project-knowledge-settings.js: the Lens view
// registers with the tab, and CBM's settings become the right controls with
// their values escaped.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const read = (f) => fs.readFileSync(path.join(__dirname, '../public', f), 'utf8');
const utils = read('utils.js');
const escapeAttrSource = utils.slice(utils.indexOf('function escapeAttr('), utils.indexOf('\n}\n', utils.indexOf('function escapeAttr(')) + 3);

function load() {
  const context = vm.createContext({
    KnowledgeModel: require('../public/knowledge-model'),
    escapeHtml: (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'),
    PICONS: new Proxy({}, { get: (_t, name) => () => `<i:${String(name)}>` }),
    pathBasename: (p) => String(p).split('/').filter(Boolean).pop() || p,
    window: {},
    console,
  });
  vm.runInContext(`${escapeAttrSource}\n${read('project-knowledge-view.js')}\n${read('project-knowledge-lens.js')}\n${read('project-knowledge-settings.js')}
    this.api = { knViewRenderers, knConfigControl, KN_CONFIG_FIELDS, KN_LENS_PARTITION };`, context);
  return context.api;
}

test('the Lens view registers, in the session main allows for it', () => {
  const api = load();
  assert.equal(typeof api.knViewRenderers.lens, 'function');
  assert.equal(api.KN_LENS_PARTITION, require('../web-page').LENS_PARTITION);
});

test('CBM settings become a switch, a list or a field, with the value escaped', () => {
  const api = load();
  const keys = { auto_watch: 'bool', doc_candidates: ['auto', 'true', 'false'], index_max_files: 'limit', ui_port: 'port' };
  assert.match(api.knConfigControl({ key: 'auto_watch' }, 'true', keys), /type="checkbox"[^>]* checked/);
  assert.doesNotMatch(api.knConfigControl({ key: 'auto_watch' }, 'false', keys), /checked/);
  assert.match(api.knConfigControl({ key: 'doc_candidates' }, 'false', keys), /<option value="false" selected>/);
  const limit = api.knConfigControl({ key: 'index_max_files' }, undefined, keys);
  assert.match(limit, /placeholder="off"/, 'a limit CBM does not list is off');
  assert.doesNotMatch(api.knConfigControl({ key: 'ui_port' }, '"><b>', keys), /<b>/);
  for (const field of api.KN_CONFIG_FIELDS) assert.ok(field.label && field.help, field.key);
});
