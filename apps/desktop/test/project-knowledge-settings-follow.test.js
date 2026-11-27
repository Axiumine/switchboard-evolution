// Settings › Node Knowledge (project-knowledge-settings.js) follows CBM's
// settings changed elsewhere (a phone, the defaults the app applies) through
// the knowledge-changed listener the settings panel hands it: the controls take
// the values read again, all but a field being typed in, and a new program
// draws the section again. The section's source runs here over fake controls.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const read = (f) => fs.readFileSync(path.join(__dirname, '../public', f), 'utf8');
const utils = read('utils.js');
const escapeAttrSource = utils.slice(utils.indexOf('function escapeAttr('), utils.indexOf('\n}\n', utils.indexOf('function escapeAttr(')) + 3);

const KEYS = { auto_watch: 'bool', doc_candidates: ['auto', 'true', 'false'], auto_index_limit: 'count', ui_enabled: 'bool', ui_port: 'port' };

/** A control as the section finds it by its data-kn-key. */
function control(key, type) {
  const listeners = {};
  return {
    dataset: { knKey: key },
    type,
    value: '',
    checked: false,
    addEventListener(name, fn) { (listeners[name] ||= []).push(fn); },
    fire(name) { for (const fn of listeners[name] || []) fn(); listeners[name] = []; },
  };
}

function setup() {
  const controls = {
    auto_watch: control('auto_watch', 'checkbox'),
    doc_candidates: control('doc_candidates', 'select-one'),
    auto_index_limit: control('auto_index_limit', 'text'),
    ui_port: control('ui_port', 'text'),
  };
  const all = Object.values(controls);
  const el = {
    innerHTML: '',
    isConnected: true,
    querySelector: (sel) => (sel === '[data-kn-saved]' ? { textContent: '', classList: { toggle() {} } } : null),
    querySelectorAll: (sel) => (sel === '[data-kn-key]' ? all : []),
    contains: (node) => all.includes(node),
  };
  const config = { values: { auto_watch: 'false', doc_candidates: 'auto', auto_index_limit: '50000', ui_port: '9749' } };
  const calls = { binary: 0, config: 0 };
  const api = {
    getKnowledgeBinary: async () => { calls.binary++; return { binary: { found: { ok: true, version: '0.8.1', source: 'agents', path: '/Users/demo/.local/bin/codebase-memory-mcp' } } }; },
    getKnowledgeConfig: async () => { calls.config++; return { ok: true, values: { ...config.values }, keys: KEYS }; },
  };
  const document = { activeElement: null };
  const context = vm.createContext({
    escapeHtml: (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'),
    window: { api, SettingsModel: require('../public/settings-model') },
    document,
    console,
  });
  vm.runInContext(`${escapeAttrSource}\n${read('project-knowledge-settings.js')}\nthis.kn = { knRenderGlobalSettings, knShowConfigValues };`, context);
  return { kn: context.kn, el, controls, config, calls, api, document };
}

const settle = () => new Promise((resolve) => setImmediate(resolve));

test('the values read again go into every control but a field being typed in', () => {
  const { kn, el, controls } = setup();
  controls.auto_index_limit.value = '123';
  kn.knShowConfigValues(el, { auto_watch: 'true', doc_candidates: 'false', auto_index_limit: '7' }, controls.auto_index_limit);
  assert.equal(controls.auto_watch.checked, true);
  assert.equal(controls.doc_candidates.value, 'false');
  assert.equal(controls.auto_index_limit.value, '123', 'the field being typed in keeps what is typed');
  assert.equal(controls.ui_port.value, '9749', 'the Lens port shows its default when CBM lists none');
});

test('a switch or a choice that has the focus still follows', () => {
  const { kn, el, controls } = setup();
  kn.knShowConfigValues(el, { auto_watch: 'true', doc_candidates: 'true' }, controls.auto_watch);
  assert.equal(controls.auto_watch.checked, true);
  kn.knShowConfigValues(el, { auto_watch: 'false', doc_candidates: 'true' }, controls.doc_candidates);
  assert.equal(controls.doc_candidates.value, 'true');
});

test('a change of the config elsewhere reaches the open section', async () => {
  const { kn, el, controls, config, document } = setup();
  let onChange = null;
  await kn.knRenderGlobalSettings(el, { follow: (fn) => { onChange = fn; } });
  assert.equal(typeof onChange, 'function', 'the section follows knowledge-changed');

  config.values = { auto_watch: 'true', doc_candidates: 'false', auto_index_limit: '7', ui_port: '9750' };
  document.activeElement = controls.auto_index_limit;
  controls.auto_index_limit.value = '12';
  await onChange({ projectId: null, reason: 'config' });
  assert.equal(controls.auto_watch.checked, true);
  assert.equal(controls.doc_candidates.value, 'false');
  assert.equal(controls.ui_port.value, '9750');
  assert.equal(controls.auto_index_limit.value, '12', 'not the field being typed in');

  document.activeElement = null;
  await onChange({ projectId: null, reason: 'config' });
  assert.equal(controls.auto_index_limit.value, '7');
});

test('a new program draws the section again, once no field of it is being typed in', async () => {
  const { kn, el, controls, calls, document } = setup();
  const follows = [];
  await kn.knRenderGlobalSettings(el, { follow: (fn) => follows.push(fn) });
  assert.equal(calls.binary, 1);

  await follows[0]({ projectId: null, reason: 'download' });
  await follows[0]({ projectId: 'p1', reason: 'job' });
  await settle();
  assert.equal(calls.binary, 1, 'a download step or a project\'s change draws nothing');

  document.activeElement = controls.auto_index_limit;
  await follows[0]({ projectId: null, reason: 'binary' });
  await settle();
  assert.equal(calls.binary, 1, 'not while a field is typed in');
  document.activeElement = null;
  controls.auto_index_limit.fire('blur');
  await settle();
  assert.equal(calls.binary, 2);
  assert.equal(follows.length, 2, 'the new drawing follows in its turn');
});

test('a drawing overtaken by a later one stops before it follows', async () => {
  const { kn, el, api } = setup();
  const slow = [];
  const real = api.getKnowledgeBinary;
  api.getKnowledgeBinary = () => new Promise((resolve) => slow.push(() => resolve(real())));
  const follows = [];
  const first = kn.knRenderGlobalSettings(el, { follow: (fn) => follows.push(['first', fn]) });
  const second = kn.knRenderGlobalSettings(el, { follow: (fn) => follows.push(['second', fn]) });
  slow[1]();
  await second;
  slow[0]();
  await first;
  assert.deepEqual(follows.map(([name]) => name), ['second']);
});
