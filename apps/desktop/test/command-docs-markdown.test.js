const test = require('node:test');
const assert = require('node:assert/strict');
const md = require('../harnesses/commands/markdown');

test('table rows split on unescaped pipes only', () => {
  assert.deepEqual(md.splitRow('| `/advisor [model\\|off]` | Enable it |'), ['`/advisor [model|off]`', 'Enable it']);
  assert.deepEqual(md.splitRow('| `cat file \\| claude -p "query"` | Process piped content | x |'),
    ['`cat file | claude -p "query"`', 'Process piped content', 'x']);
  assert.deepEqual(md.splitRow('a | b'), ['a', 'b']);
});

test('tables come with their columns, rows and the headings above them', () => {
  const page = [
    '# Title',
    '## Keyboard shortcuts',
    '### General controls',
    '| Shortcut | Description |',
    '| :- | :- |',
    '| `Ctrl+C` | Interrupt |',
    '| `Ctrl+D` | Exit |',
    '',
    '```',
    '| Not | A table |',
    '| - | - |',
    '```',
    '## Other',
    '| A | B |',
    '|---|---|',
    '| 1 | 2 |',
  ].join('\n');
  const all = md.tables(page);
  assert.equal(all.length, 2);
  assert.deepEqual(all[0].headers, ['Shortcut', 'Description']);
  assert.deepEqual(all[0].headings, ['Title', 'Keyboard shortcuts', 'General controls']);
  assert.deepEqual(all[0].rows, [['`Ctrl+C`', 'Interrupt'], ['`Ctrl+D`', 'Exit']]);
  assert.deepEqual(all[1].headings, ['Title', 'Other']);
  assert.equal(md.findTable(page, ['A', 'B']).rows[0][1], '2');
  assert.equal(md.findTable(page, ['A', 'B'], { under: 'Keyboard shortcuts' }), null);
});

test('inline text drops links, emphasis, code marks and inline tags but keeps <placeholders>', () => {
  assert.equal(md.inlineText('Enable the [advisor tool](https://x/advisor.md) with `opus`'), 'Enable the advisor tool with opus');
  assert.equal(md.inlineText('**[Skill](https://x/skills.md#bundled-skills).** Do it'), 'Skill. Do it');
  assert.equal(md.inlineText('Press <kbd>Ctrl</kbd>+<kbd>R</kbd> to search'), 'Press Ctrl+R to search');
  assert.equal(md.inlineText('Press `<Esc>` twice, or type <path>'), 'Press <Esc> twice, or type <path>');
  assert.equal(md.inlineText('<nobr><code>{"--model"}</code></nobr>'), '--model');
  assert.equal(md.inlineText('see [`/code-review`](https://x/code-review-local)'), 'see /code-review');
});

test('code spans, in order', () => {
  assert.deepEqual(md.codeSpans('Aliases: `/reset`, `/new`'), ['/reset', '/new']);
  assert.deepEqual(md.codeSpans('none here'), []);
});

test('sentences do not break inside versions or before lower case', () => {
  assert.deepEqual(md.sentences('Requires Claude Code v2.1.212 or later. Alias: x. e.g. this stays'),
    ['Requires Claude Code v2.1.212 or later.', 'Alias: x. e.g. this stays']);
  assert.equal(md.firstSentences('One. Two. Three.', 2), 'One. Two.');
  const long = `${'word '.repeat(100)}end.`;
  assert.ok(md.firstSentences(long, 1, 50).length <= 50);
  assert.ok(md.firstSentences(long, 1, 50).endsWith('…'));
});

test('slug', () => {
  assert.equal(md.slug('/design consent'), 'design-consent');
  assert.equal(md.slug('claude -p "query"'), 'claude-p-query');
  assert.equal(md.slug('Ctrl+X Ctrl+K'), 'ctrl-x-ctrl-k');
});
