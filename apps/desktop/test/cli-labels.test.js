const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// The renderer's table of CLIs (public/utils.js), with the icons it draws from.
function load() {
  const context = vm.createContext({ window: {} });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../public/icons.js'), 'utf8'), context);
  context.ICONS = context.window.ICONS;
  const utils = fs.readFileSync(path.join(__dirname, '../public/utils.js'), 'utf8');
  const start = utils.indexOf('// --- CLIs ---');
  const end = utils.indexOf('// --- end CLIs ---');
  assert.ok(start >= 0 && end > start, 'utils.js has a CLIs section');
  vm.runInContext(utils.slice(start, end) + '\nthis.LAUNCH_CLIS = LAUNCH_CLIS;', context);
  return context;
}

test('every CLI has its name, and OpenCode comes after Codex', () => {
  const c = load();
  assert.deepEqual([...c.LAUNCH_CLIS], ['claude', 'codex', 'opencode']);
  assert.equal(c.harnessLabel('claude'), 'Claude');
  assert.equal(c.harnessLabel('codex'), 'Codex');
  assert.equal(c.harnessLabel('opencode'), 'OpenCode');
  // Rows written before the runtime column existed are Claude's.
  assert.equal(c.harnessLabel(undefined), 'Claude');
  assert.equal(c.harnessLabel('gemini'), 'gemini');
});

test('every CLI has its own mark', () => {
  const c = load();
  assert.equal(c.harnessIcon('codex', 14, 'x'), c.ICONS.codex(14, 'x'));
  assert.equal(c.harnessIcon('claude', 12), c.ICONS.claude(12, ''));
  const mark = c.harnessIcon('opencode', 13, 'opencode-icon');
  assert.match(mark, /^<svg class="opencode-icon" width="13" height="13"/);
  assert.notEqual(mark, c.ICONS.claude(13, 'opencode-icon'));
  assert.equal(c.harnessIcon('gemini', 14), c.ICONS.claude(14, ''));
  assert.equal(c.cliIconClass('claude'), '');
  assert.equal(c.cliIconClass('opencode'), 'opencode-icon');
});

test('OpenCode sessions cannot be forked yet', () => {
  const c = load();
  assert.equal(c.cliCanFork('claude'), true);
  assert.equal(c.cliCanFork('codex'), true);
  assert.equal(c.cliCanFork(undefined), true);
  assert.equal(c.cliCanFork('opencode'), false);
});
