const test = require('node:test');
const assert = require('node:assert/strict');
const {
  LIST_MAX, isWithin, selectAll, invertSelection, togglePicked, topLevelPicks, trashQuestion, remapAfterTrash, failuresText, collectFolders,
} = require('../public/file-selection');

const sorted = set => [...set].sort();

test('select all, invert and toggle work on the rows the tree shows', () => {
  const visible = ['a', 'a/x.md', 'b.md', 'c'];
  assert.deepEqual(sorted(selectAll(visible)), visible);
  assert.deepEqual(sorted(invertSelection(visible, new Set(['a', 'c', 'hidden/z.md']))), ['a/x.md', 'b.md'],
    'ticks on rows the tree no longer shows go');
  assert.deepEqual(sorted(invertSelection(visible, new Set())), visible);
  const once = togglePicked(new Set(['a']), 'b.md');
  assert.deepEqual(sorted(once), ['a', 'b.md']);
  assert.deepEqual(sorted(togglePicked(once, 'a')), ['b.md']);
});

test('a ticked folder takes what is inside it: only the shallowest entries are trashed', () => {
  assert.deepEqual(topLevelPicks(['src/a.js', 'src', 'docs/x.md', 'src/lib/b.js', 'docs/x.md', 'srcx/c.js']),
    ['src', 'docs/x.md', 'srcx/c.js']);
  assert.deepEqual(topLevelPicks(['a\\b.md', 'a']), ['a']);
  assert.deepEqual(topLevelPicks([]), []);
  assert.equal(isWithin('src/lib', 'src'), true);
  assert.equal(isWithin('srcx', 'src'), false);
});

test('the question lists up to ten entries, then gives only how many', () => {
  const one = trashQuestion([{ rel: 'docs/notes.md', isDir: false }], { platform: 'darwin' });
  assert.equal(one.title, 'Move “notes.md” to the Trash?');
  assert.match(one.detail, /^docs\/notes\.md\n\nThey can be restored from the Trash/);
  assert.equal(one.confirm, 'Move to Trash');

  const few = trashQuestion([{ rel: 'src', isDir: true }, { rel: 'a.md', isDir: false }, { rel: 'b.md', isDir: false }], { platform: 'darwin' });
  assert.equal(few.title, 'Move 3 items to the Trash?');
  assert.match(few.detail, /^src\/\na\.md\nb\.md\n\nFolders go with everything in them\./);

  const many = Array.from({ length: LIST_MAX + 5 }, (_, i) => ({ rel: `f${i}`, isDir: i < 3 }));
  const big = trashQuestion(many, { platform: 'darwin' });
  assert.equal(big.title, 'Move 15 items to the Trash?');
  assert.match(big.detail, /^3 folders and 12 files\.\n\n/);
  assert.doesNotMatch(big.detail, /f0/);

  const win = trashQuestion([{ rel: 'a', isDir: false }, { rel: 'b', isDir: false }], { platform: 'win32' });
  assert.equal(win.title, 'Move 2 items to the Recycle Bin?');
  assert.equal(win.confirm, 'Move to Recycle Bin');
});

test('after the Trash, what was inside the removed entries is forgotten', () => {
  assert.deepEqual(remapAfterTrash(['src', 'src/a', 'docs', 'docs/x', 'srcx'], ['src', 'docs/x']), ['docs', 'srcx']);
  assert.deepEqual(remapAfterTrash(['a'], []), ['a']);
});

test('failures read as a short list', () => {
  assert.equal(failuresText([]), '');
  assert.equal(failuresText([{ rel: 'a.md', error: 'No longer exists' }]), '1 item could not be moved:\na.md: No longer exists');
  const many = Array.from({ length: 10 }, (_, i) => ({ rel: `f${i}`, error: 'x' }));
  assert.match(failuresText(many, 3), /^10 items could not be moved:\nf0: x\nf1: x\nf2: x\n\+ 7 more$/);
});

test('Expand All opens folders level by level, without node_modules or .git, up to a limit', async () => {
  const tree = {
    '': [{ name: 'src', relativePath: 'src', type: 'directory' }, { name: 'node_modules', relativePath: 'node_modules', type: 'directory' }, { name: '.git', relativePath: '.git', type: 'directory' }, { name: 'a.md', relativePath: 'a.md', type: 'file' }],
    src: [{ name: 'lib', relativePath: 'src/lib', type: 'directory' }],
    'src/lib': [{ name: 'deep', relativePath: 'src/lib/deep', type: 'directory' }],
    'src/lib/deep': [],
  };
  const asked = [];
  const listDir = async (rel) => { asked.push(rel); return tree[rel]; };
  assert.deepEqual(await collectFolders(listDir), ['src', 'src/lib', 'src/lib/deep']);
  assert.ok(!asked.includes('node_modules') && !asked.includes('.git'));
  assert.deepEqual(await collectFolders(listDir, { maxFolders: 2 }), ['src', 'src/lib']);
  assert.deepEqual(await collectFolders(listDir, { maxDepth: 1 }), ['src']);
  assert.deepEqual(await collectFolders(async () => { throw new Error('gone'); }), []);
});
