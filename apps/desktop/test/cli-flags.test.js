const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { flagAnswer, answerCliFlags } = require('../cli-flags');

function fakeApp(version = '1.2.3') {
  const exits = [];
  return { exits, getName: () => 'Some App', getVersion: () => version, exit: (code) => exits.push(code) };
}

const answer = (...args) => flagAnswer(['/opt/app/switchboard-e', ...args], fakeApp('4.5.6'));

test('-v and --version answer with the version on a line of its own', () => {
  for (const flag of ['-v', '--version']) assert.strictEqual(answer(flag), '4.5.6\n', flag);
  assert.strictEqual(answer('--no-sandbox', '--version'), '4.5.6\n');
  // from source, the app's folder comes before the flag
  assert.strictEqual(flagAnswer(['/path/electron', '.', '-v'], fakeApp('4.5.6')), '4.5.6\n');
});

test('-h and --help answer with the usage and every flag', () => {
  for (const flag of ['-h', '--help']) {
    const text = answer(flag);
    assert.match(text, /^Some App 4\.5\.6\n/, flag);
    assert.match(text, /^Usage: switchboard-e \[options\]$/m);
    assert.match(text, /^ +-h, --help /m);
    assert.match(text, /^ +-v, --version /m);
    assert.ok(text.endsWith('\n'));
  }
});

test('help wins over version, whichever comes first', () => {
  assert.strictEqual(answer('--version', '--help'), answer('--help'));
  assert.strictEqual(answer('-h', '-v'), answer('-h'));
});

test('other arguments start the app as usual', () => {
  assert.strictEqual(answer(), null);
  // Chromium's verbose-logging switches
  assert.strictEqual(answer('--v'), null);
  assert.strictEqual(answer('--v=1'), null);
  assert.strictEqual(answer('--vmodule=foo=2'), null);
  assert.strictEqual(answer('-V', '--helper', '-help'), null);
  // argv[0] is the program, not an argument
  assert.strictEqual(flagAnswer(['--help'], fakeApp()), null);
});

test('writes the answer and exits with 0', () => {
  const app = fakeApp('4.5.6');
  const written = [];
  assert.strictEqual(answerCliFlags(['app', '--version'], app, (text) => written.push(text)), true);
  assert.deepStrictEqual(written, ['4.5.6\n']);
  assert.deepStrictEqual(app.exits, [0]);
});

test('does nothing without a flag', () => {
  const app = fakeApp();
  const written = [];
  assert.strictEqual(answerCliFlags(['app'], app, (text) => written.push(text)), false);
  assert.deepStrictEqual(written, []);
  assert.deepStrictEqual(app.exits, []);
});

test('main.js answers the flags before it loads any other module', () => {
  const main = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
  const requires = [...main.matchAll(/require\('([^']+)'\)/g)].map((m) => m[1]);
  assert.deepStrictEqual(requires.slice(0, 2), ['electron', './cli-flags']);
});
