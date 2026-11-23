const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// The project page has a Plan tab (the phases of plan-tracker.md) and a Todos
// tab (todos.md), drawn from the same get-project-plan data.

const source = fs.readFileSync(path.join(__dirname, '../public/projects-view.js'), 'utf8');
const mainSource = fs.readFileSync(path.join(__dirname, '../main.js'), 'utf8');
const between = (text, from, to) => {
  const start = text.indexOf(from);
  const end = text.indexOf(to, start);
  assert.ok(start >= 0 && end > start, `markers ${from} … ${to}`);
  return text.slice(start, end);
};

function load(code) {
  const context = vm.createContext({});
  vm.runInContext(code, context);
  return context;
}

test('Plan and Todos are two tabs of the project page, Todos right after Plan', () => {
  const nav = load(`${between(source, 'const PROJECT_WORKSPACE_TABS', '\nfunction projectTab(')}\nthis.tabs = PROJECT_WORKSPACE_TABS; this.planTabs = PLAN_TABS;`);
  assert.deepEqual([...nav.tabs], ['overview', 'session', 'plan', 'todos', 'files', 'git', 'knowledge', 'settings']);
  assert.deepEqual([...nav.planTabs], ['plan', 'todos']);

  const strip = between(source, '<div class="ws-tabs">', '</div>`;');
  assert.ok(strip.indexOf('data-tab="plan"') < strip.indexOf('data-tab="todos"'), 'the tab strip has Plan, then Todos');
  assert.ok(strip.indexOf('data-tab="todos"') < strip.indexOf('data-tab="files"'));
});

test('each tab opens in a window of its own, Todos as well', () => {
  const windows = load(`${between(source, 'const PROJECT_WINDOW_TAB_LABELS', '\n/**')}\nthis.labels = PROJECT_WINDOW_TAB_LABELS; this.order = PROJECT_WINDOW_TAB_ORDER;`);
  assert.deepEqual([...windows.order], ['overview', 'plan', 'todos', 'files', 'git', 'knowledge', 'settings']);
  assert.equal(windows.labels.plan, 'Plan');
  assert.equal(windows.labels.todos, 'Todos');

  const main = load(`${between(mainSource, 'const PROJECT_WINDOW_TABS', '\nconst PROJECT_WINDOW_SPEC')}\nthis.tabs = PROJECT_WINDOW_TABS;`);
  for (const tab of windows.order) assert.ok(main.tabs.has(tab), `main.js opens a window for ${tab}`);
});

test('a tab redraws only when what it shows moved', () => {
  const { planSignature } = load(between(source, '/**\n * What the Plan tab', '/** The Plan tab'));
  const data = {
    plan: { phases: [{ line: 0, title: 'Phase 1: Start', done: false, items: [{ line: 1, text: 'a', done: false }] }] },
    todos: [{ line: 0, text: 'buy milk', done: false }],
    links: [],
  };
  const state = { data, error: null };
  const plan = planSignature(state, 'plan');
  const todos = planSignature(state, 'todos');

  data.todos = [{ line: 0, text: 'buy milk', done: true }];
  data.links = [{ file: 'todos', itemText: 'buy milk', sessionId: 's1', kind: 'ticked' }];
  assert.equal(planSignature(state, 'plan'), plan, 'a ticked todo leaves the Plan tab alone');
  assert.notEqual(planSignature(state, 'todos'), todos);

  const todosNow = planSignature(state, 'todos');
  data.plan.phases[0].items[0].done = true;
  data.links = [...data.links, { file: 'plan', itemText: 'a', sessionId: 's2', kind: 'ticked' }];
  assert.equal(planSignature(state, 'todos'), todosNow, 'a ticked phase item leaves the Todos tab alone');
  assert.notEqual(planSignature(state, 'plan'), plan);

  assert.equal(planSignature({ data: null, error: 'gone' }, 'todos'), 'error:gone');
});
