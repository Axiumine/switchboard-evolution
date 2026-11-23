const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../public/projects-view.js'), 'utf8');
const between = (start, end) => source.slice(source.indexOf(start), source.indexOf(end));
const code = between('// A project is removed only once "delete" is typed', '// --- "Sessions start in" select');

const project = { id: 'p1', name: 'Auth', root: '/projects/auth' };

/** A dialog stub: the fields and the primary button, and the options the flow opened it with. */
function fakeDialog() {
  const listeners = {};
  const input = { value: '', addEventListener: (type, fn) => { listeners[type] = fn; } };
  const primary = { disabled: false };
  const opened = { closed: false };
  const dialog = { querySelector: (sel) => (sel === '#ws-remove-word' ? input : sel === '.gg-dialog-primary' ? primary : null) };
  const type = (text) => { input.value = text; listeners.input?.(); };
  return { input, primary, opened, dialog, type };
}

function load({ deleteResult = { ok: true } } = {}) {
  const ui = fakeDialog();
  const calls = { deleted: [], alerts: [], loaded: 0 };
  const context = vm.createContext({
    escapeHtml: (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'),
    gitGraphOpenDialog: (opts) => { Object.assign(ui.opened, opts); return { dialog: ui.dialog, close: () => { ui.opened.closed = true; } }; },
    window: { api: { deleteProject: async (id) => { calls.deleted.push(id); return deleteResult; } } },
    alert: (m) => calls.alerts.push(m),
    loadProjects: () => { calls.loaded++; },
    projectsUi: { navigationByProject: new Map(), selectedProjectId: null },
    saveProjectsUi: () => {}, leaveProjectViews: () => {}, placeholder: { style: {} },
  });
  vm.runInContext(code, context);
  return { context, ui, calls };
}

test('only the word confirms a removal, in any case and with spaces around it', () => {
  const { context } = load();
  for (const ok of ['delete', 'DELETE', ' Delete ']) assert.equal(context.isRemoveProjectWord(ok), true, ok);
  for (const no of ['', 'delet', 'deleted', 'remove', 'yes', null, undefined, 'de lete']) assert.equal(context.isRemoveProjectWord(no), false, String(no));
});

test('the Remove button waits for the word; Enter without it says what to type', async () => {
  const { context, ui, calls } = load();
  const flow = context.removeProjectFlow(project);
  assert.match(ui.opened.title, /Remove Auth/);
  assert.match(ui.opened.bodyHtml, /\/projects\/auth/);
  assert.match(ui.opened.bodyHtml, /Type <strong>delete<\/strong> to confirm/);
  assert.equal(ui.opened.primaryDanger, true);
  assert.equal(ui.primary.disabled, true);
  ui.type('delet');
  assert.equal(ui.primary.disabled, true);
  await assert.rejects(ui.opened.onSubmit(), /Type delete to remove the project/);
  assert.deepEqual(calls.deleted, []);
  ui.type('delete');
  assert.equal(ui.primary.disabled, false);
  await ui.opened.onSubmit();
  await flow;
  assert.equal(ui.opened.closed, true);
  assert.deepEqual(calls.deleted, ['p1']);
  assert.equal(calls.loaded, 1);
});

test('cancel removes nothing', async () => {
  const { context, ui, calls } = load();
  const flow = context.removeProjectFlow(project);
  ui.type('delete');
  ui.opened.onCancel();
  await flow;
  assert.deepEqual(calls.deleted, []);
  assert.equal(calls.loaded, 0);
});

test('a name or folder with markup stays text in the dialog', async () => {
  const { context, ui } = load();
  context.removeProjectFlow({ id: 'p2', name: '<b>x</b>', root: '/p/<img src=x>' });
  assert.doesNotMatch(ui.opened.bodyHtml, /<img/);
  ui.opened.onCancel();
});
