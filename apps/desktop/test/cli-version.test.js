const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { wantsVersion, printVersionAndExit } = require('../cli-version');

function fakeApp(version = '1.2.3') {
  const exits = [];
  return { exits, getVersion: () => version, exit: (code) => exits.push(code) };
}

test('--v asks for the version, packaged or from source', () => {
  assert.ok(wantsVersion(['/opt/app/switchboard-e', '--v']));
  assert.ok(wantsVersion(['/path/electron', '.', '--v']));
  assert.ok(wantsVersion(['/opt/app/switchboard-e', '--no-sandbox', '--v']));
});

test('other arguments start the app as usual', () => {
  assert.ok(!wantsVersion(['/opt/app/switchboard-e']));
  // Chromium's verbose-logging switches
  assert.ok(!wantsVersion(['/opt/app/switchboard-e', '--v=1']));
  assert.ok(!wantsVersion(['/opt/app/switchboard-e', '--vmodule=foo=2']));
  // argv[0] is the program, not an argument
  assert.ok(!wantsVersion(['--v']));
});

test('prints the version on a line of its own and exits with 0', () => {
  const app = fakeApp('4.5.6');
  const written = [];
  assert.strictEqual(printVersionAndExit(['app', '--v'], app, (text) => written.push(text)), true);
  assert.deepStrictEqual(written, ['4.5.6\n']);
  assert.deepStrictEqual(app.exits, [0]);
});

test('does nothing without the flag', () => {
  const app = fakeApp();
  const written = [];
  assert.strictEqual(printVersionAndExit(['app'], app, (text) => written.push(text)), false);
  assert.deepStrictEqual(written, []);
  assert.deepStrictEqual(app.exits, []);
});

test('main.js answers --v before it loads any other module', () => {
  const main = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
  const requires = [...main.matchAll(/require\('([^']+)'\)/g)].map((m) => m[1]);
  assert.deepStrictEqual(requires.slice(0, 2), ['electron', './cli-version']);
});
