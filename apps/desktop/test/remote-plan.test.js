const { test } = require('node:test');
const assert = require('node:assert/strict');

const { planLineText } = require('../remote-plan');

const data = {
  plan: { phases: [
    { title: 'Phase 1: Setup', line: 2, items: [{ line: 3, text: 'Repo' }, { line: 4, text: 'CI' }] },
    { title: 'Ship it', line: 7, items: [], single: true },
  ] },
  todos: [{ line: 2, text: 'Write docs' }],
};

test('the text at a line of the plan or the todos, or null', () => {
  assert.equal(planLineText(data, 'plan', 2), 'Phase 1: Setup');
  assert.equal(planLineText(data, 'plan', 4), 'CI');
  assert.equal(planLineText(data, 'plan', 7), 'Ship it');
  assert.equal(planLineText(data, 'todos', 2), 'Write docs');
  assert.equal(planLineText(data, 'todos', 3), null);
  assert.equal(planLineText(data, 'plan', 5), null);
});
