const { test } = require('node:test');
const assert = require('node:assert/strict');
const { lspServersHtml, lspFoundText } = require('../public/project-lsp-settings.js');

const row = (over = {}) => ({
  id: 'go', label: 'Go', languages: ['go'], enabled: false, found: null, installed: false, path: null,
  command: 'gopls', install: 'go install golang.org/x/tools/gopls@latest', runsProjectCode: true, weight: 'medium', ...over,
});

test('the counts read as the extensions found, most first', () => {
  assert.equal(lspFoundText({ files: 5, extensions: { '.tsx': 2, '.ts': 3 } }), '.ts 3, .tsx 2');
  assert.equal(lspFoundText(null), '');
});

test('the servers found come first; the others are folded under "Other languages"', () => {
  const html = lspServersHtml([
    row({ id: 'go', found: { files: 3, extensions: { '.go': 3 } }, enabled: true, installed: true, path: '/bin/gopls' }),
    row({ id: 'rust', label: 'Rust', languages: ['rust'], command: 'rust-analyzer', weight: 'heavy' }),
  ]);
  const others = html.indexOf('ws-lsp-others');
  assert.ok(html.indexOf('data-server="go"') < others && html.indexOf('data-server="rust"') > others);
  assert.match(html, /Found here: \.go 3/);
  assert.match(html, /class="ws-switch-input ws-lsp-toggle" data-server="go" checked/);
  assert.match(html, /title="\/bin\/gopls">gopls</);
  assert.match(html, /Not installed.*Copy install command/s, 'a missing server offers its install command');
  assert.match(html, /runs project code/);
  assert.match(html, /heavy/);
});

test('a project with nothing found says so', () => {
  assert.match(lspServersHtml([row()]), /No language found/);
});

test('text is escaped', () => {
  assert.ok(!lspServersHtml([row({ label: '<b>x</b>', found: { files: 1, extensions: { '.go': 1 } } })]).includes('<b>x</b>'));
});
