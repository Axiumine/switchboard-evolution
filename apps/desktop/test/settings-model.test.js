const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const M = require('../public/settings-model');
const PUBLIC = path.join(__dirname, '../public');

test('tabs: desktop order, the phone starts with Computer', () => {
  assert.deepEqual(M.DESKTOP_TABS.map(t => t.key), ['application', 'agents', 'editor', 'knowledge', 'improver']);
  assert.deepEqual(M.PHONE_TABS.map(t => t.key), ['computer', 'application', 'agents', 'editor', 'knowledge', 'improver']);
  assert.deepEqual(M.DESKTOP_TABS.map(t => t.label), ['Application', 'Agents', 'Editor', 'Node Knowledge', 'Prompt Improver']);
  assert.equal(M.PHONE_TABS[0].label, 'Computer');
});

test('global patch: bounds, choices, unknown keys', () => {
  const ctx = { harnessIds: ['claude', 'codex'], shellProfileIds: ['zsh'] };
  assert.deepEqual(M.validateGlobalPatch({ visibleSessionCount: 8 }, ctx), { ok: true, patch: { visibleSessionCount: 8 } });
  for (const bad of [0, 101, '8', 7.5]) assert.equal(M.validateGlobalPatch({ visibleSessionCount: bad }, ctx).ok, false);
  assert.equal(M.validateGlobalPatch({ sidebarWidth: 400 }, ctx).ok, false);
  assert.equal(M.validateGlobalPatch({}, ctx).ok, false);
  assert.equal(M.validateGlobalPatch({ disabledHarnesses: ['nope'] }, ctx).ok, false);
  assert.equal(M.validateGlobalPatch({ accentColor: null }, ctx).ok, true);
  assert.deepEqual(M.validateGlobalPatch({ accentColor: '#2FC4B2' }, ctx).patch, { accentColor: '#2fc4b2' });
  assert.equal(M.validateGlobalPatch({ accentColor: 'red' }, ctx).ok, false);
  assert.equal(M.validateGlobalPatch({ editorPrefs: { vim: true } }, ctx).ok, true);
  assert.equal(M.validateGlobalPatch({ editorPrefs: { emacs: true } }, ctx).ok, false);
  for (const ok of ['', '~/Code', '/Users/demo/Code']) assert.equal(M.validateGlobalPatch({ projectsRoot: ok }, ctx).ok, true, ok);
  assert.equal(M.validateGlobalPatch({ projectsRoot: 'relative/path' }, ctx).ok, false);
  assert.equal(M.validateGlobalPatch({ preLaunchCmd: 'a\nb' }, ctx).ok, false);
  assert.deepEqual(M.validateGlobalPatch({ codexModel: ' gpt-5 ' }, ctx).patch, { codexModel: 'gpt-5' });
  assert.equal(M.validateGlobalPatch({ shellProfile: 'fish' }, ctx).ok, false);
  assert.equal(M.validateGlobalPatch({ terminalEngine: 'tmux' }, ctx).ok, false);
});

test('global patch: the rest of the kinds', () => {
  const ctx = { harnessIds: ['claude', 'codex'], shellProfileIds: ['zsh'] };
  assert.equal(M.validateGlobalPatch({ shellProfile: 'zsh' }, ctx).ok, true);
  assert.equal(M.validateGlobalPatch({ shellProfile: 'auto' }, ctx).ok, true);
  assert.equal(M.validateGlobalPatch({ shellProfile: 'zsh' }).ok, false, 'no context, no profile but auto');
  assert.equal(M.validateGlobalPatch({ disabledHarnesses: ['codex'] }, ctx).ok, true);
  assert.equal(M.validateGlobalPatch({ disabledHarnesses: [] }, ctx).ok, true);
  assert.equal(M.validateGlobalPatch({ disabledHarnesses: 'codex' }, ctx).ok, false);
  assert.equal(M.validateGlobalPatch({ worktree: 'yes' }, ctx).ok, false);
  assert.equal(M.validateGlobalPatch({ mcpEmulation: true }, ctx).ok, true);
  assert.equal(M.validateGlobalPatch({ permissionMode: 'plan' }, ctx).ok, true);
  assert.equal(M.validateGlobalPatch({ permissionMode: null }, ctx).ok, true);
  assert.equal(M.validateGlobalPatch({ permissionMode: 'yolo' }, ctx).ok, false);
  assert.equal(M.validateGlobalPatch({ codexSandbox: 'read-only' }, ctx).ok, true);
  assert.equal(M.validateGlobalPatch({ codexApproval: 'always' }, ctx).ok, false);
  assert.equal(M.validateGlobalPatch({ terminalTheme: 'dracula' }, ctx).ok, true);
  assert.equal(M.validateGlobalPatch({ terminalTheme: 'nope' }, ctx).ok, false);
  assert.equal(M.validateGlobalPatch({ terminalEngine: 'inside' }, ctx).ok, true);
  assert.equal(M.validateGlobalPatch({ sessionMaxAgeDays: 365 }, ctx).ok, true);
  assert.equal(M.validateGlobalPatch({ sessionMaxAgeDays: 366 }, ctx).ok, false);
  assert.equal(M.validateGlobalPatch({ codexModel: 'x'.repeat(121) }, ctx).ok, false);
  assert.equal(M.validateGlobalPatch({ projectsRoot: `/${'a'.repeat(4096)}` }, ctx).ok, false);
  assert.equal(M.validateGlobalPatch({ languageServers: false }, ctx).ok, true);
  assert.deepEqual(M.validateGlobalPatch({ editorPrefs: { vim: true, minimap: false } }, ctx).patch, { editorPrefs: { vim: true, minimap: false } });
  assert.equal(M.validateGlobalPatch({ editorPrefs: { vim: 'on' } }, ctx).ok, false);
  assert.equal(M.validateGlobalPatch({ editorPrefs: {} }, ctx).ok, false);
  assert.equal(M.validateGlobalPatch(null, ctx).ok, false);
  assert.equal(M.validateGlobalPatch({ visibleSessionCount: 8, nope: 1 }, ctx).ok, false, 'one bad key rejects the patch');
  assert.equal(M.validateGlobalPatch({ ['__proto__']: 1 }, ctx).ok, false);
  const bad = M.validateGlobalPatch({ visibleSessionCount: 0 }, ctx);
  assert.equal(typeof bad.error, 'string');
});

test('folder patch: only folder fields, null is "use global"', () => {
  assert.equal(M.validateFolderPatch({ permissionMode: null }).ok, true);
  assert.equal(M.validateFolderPatch({ worktree: true }).ok, true);
  assert.equal(M.validateFolderPatch({ terminalTheme: 'switchboard' }).ok, false);
  assert.deepEqual(M.validateFolderPatch({ worktreeName: null }), { ok: true, patch: { worktreeName: null } });
  assert.deepEqual(M.validateFolderPatch({ addDirs: ' /Users/demo/a ' }).patch, { addDirs: '/Users/demo/a' });
  assert.equal(M.validateFolderPatch({ codexSandbox: 'bogus' }).ok, false);
  assert.equal(M.validateFolderPatch({ preLaunchCmd: 'a\nb' }).ok, false);
  assert.equal(M.validateFolderPatch({}).ok, false);
  const folderKeys = M.FIELDS.filter(f => f.folder).map(f => f.key);
  assert.deepEqual(folderKeys, ['permissionMode', 'worktree', 'worktreeName', 'chrome', 'addDirs', 'codexSandbox', 'codexApproval', 'codexModel', 'preLaunchCmd']);
});

test('effective values: stored, then app defaults, then the catalog', () => {
  const v = M.effectiveGlobalValues({ chrome: true }, { visibleSessionCount: 5, codexSandbox: 'workspace-write', mcpEmulation: false });
  assert.equal(v.chrome, true);
  assert.equal(v.visibleSessionCount, 5);
  assert.equal(v.sessionMaxAgeDays, 3);
  assert.equal(v.accentColor, '#8088ff');
  assert.equal(v.terminalEngine, 'hc');
  assert.deepEqual(v.editorPrefs, { minimap: true, stickyScroll: true, whitespace: false, vim: false });
  assert.equal(v.languageServers, true);
});

test('effective values: precedence, partial editor prefs, engine and accent', () => {
  const v = M.effectiveGlobalValues(
    { visibleSessionCount: 7, accentColor: '#2FC4B2', terminalEngine: 'inside', editorPrefs: { vim: true }, codexModel: '' },
    { visibleSessionCount: 5, sessionMaxAgeDays: 9, terminalEngine: 'inside', codexModel: 'gpt-5' },
  );
  assert.equal(v.visibleSessionCount, 7);
  assert.equal(v.sessionMaxAgeDays, 9);
  assert.equal(v.accentColor, '#2fc4b2');
  assert.equal(v.terminalEngine, 'inside');
  assert.equal(v.codexModel, '', 'an empty saved text still wins');
  assert.deepEqual(v.editorPrefs, { minimap: true, stickyScroll: true, whitespace: false, vim: true });
  // The engine is 'inside' only when it is saved so, whatever the app defaults say.
  assert.equal(M.effectiveGlobalValues({}, { terminalEngine: 'inside' }).terminalEngine, 'hc');
  assert.equal(M.effectiveGlobalValues({ accentColor: 'red' }, {}).accentColor, '#8088ff');
  assert.equal(M.effectiveGlobalValues(null, null).visibleSessionCount, 5);
  assert.deepEqual(M.effectiveGlobalValues({}, {}).disabledHarnesses, []);
  for (const field of M.FIELDS) assert.ok(field.key in M.effectiveGlobalValues({}, {}), field.key);
});

test('changed patch: nothing when the value is the saved one', () => {
  assert.equal(M.changedPatch('codexModel', ' gpt-5 ', 'gpt-5'), null);
  assert.deepEqual(M.changedPatch('worktree', true, false), { worktree: true });
  assert.deepEqual(M.changedPatch('editorPrefs.vim', true, false), { editorPrefs: { vim: true } });
  assert.equal(M.changedPatch('editorPrefs.vim', true, true), null);
  assert.deepEqual(M.changedPatch('codexModel', ' gpt-6 ', 'gpt-5'), { codexModel: 'gpt-6' });
  assert.equal(M.changedPatch('disabledHarnesses', ['codex', 'claude'], ['claude', 'codex']), null);
  assert.deepEqual(M.changedPatch('disabledHarnesses', ['codex'], []), { disabledHarnesses: ['codex'] });
  assert.equal(M.changedPatch('permissionMode', null, undefined), null);
  assert.throws(() => M.changedPatch('sidebarWidth', 1, 2));
});

test('editor prefs: migrate once, then follow the saved ones', () => {
  const current = { minimap: false, stickyScroll: true, whitespace: false, vim: true };
  assert.deepEqual(M.editorPrefsSync({}, current), { migrate: current, apply: {} });
  assert.deepEqual(M.editorPrefsSync({ editorPrefs: { minimap: true, stickyScroll: true, whitespace: false, vim: true } }, current), { migrate: null, apply: { minimap: true } });
  assert.deepEqual(M.editorPrefsSync({ editorPrefs: { vim: false } }, current), { migrate: null, apply: { vim: false } });
});

test('the catalog matches terminal-themes.js, accent.js and prefs.mjs', () => {
  // terminal-themes.js: a browser script whose const is not on the context, so ask for it.
  const themes = vm.runInNewContext(`${fs.readFileSync(path.join(PUBLIC, 'terminal-themes.js'), 'utf8')}\nTERMINAL_THEMES`);
  assert.deepEqual(M.TERMINAL_THEME_CHOICES, Object.entries(themes).map(([value, t]) => ({ value, label: t.label })));

  const accentWindow = { addEventListener() {} };
  vm.runInContext(fs.readFileSync(path.join(PUBLIC, 'accent.js'), 'utf8'), vm.createContext({
    window: accentWindow,
    document: { documentElement: { style: { setProperty() {}, removeProperty() {} } } },
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
  }));
  // Through JSON: an array made in the vm's realm is not the test's own kind of array.
  assert.deepEqual(M.ACCENT_PRESETS, JSON.parse(JSON.stringify(accentWindow.AccentColor.PRESETS)));
  assert.equal(M.ACCENT_DEFAULT, accentWindow.AccentColor.normalize(null));

  // prefs.mjs imports CodeMirror, so it is read as text: each definePref has a label and maybe a fallback.
  const prefs = fs.readFileSync(path.join(PUBLIC, 'editor/prefs.mjs'), 'utf8');
  const defined = {};
  for (const m of prefs.matchAll(/^definePref\('(\w+)', \{([\s\S]*?)^\}\);/gm)) {
    defined[m[1]] = { label: /label: '([^']+)'/.exec(m[2])[1], fallback: /fallback: (true|false)/.exec(m[2])?.[1] === 'true' };
  }
  assert.deepEqual(Object.keys(defined).sort(), M.EDITOR_PREFS.map(p => p.name).sort());
  for (const pref of M.EDITOR_PREFS) {
    assert.equal(pref.label, defined[pref.name].label, pref.name);
    assert.equal(pref.fallback, defined[pref.name].fallback, pref.name);
  }
  assert.deepEqual(M.EDITOR_PREFS.map(p => p.name), ['minimap', 'stickyScroll', 'whitespace', 'vim', 'languageServers']);

  // The help of an editor preference is the one the panel shows today.
  const { EDITOR_SETTINGS } = require('../public/editor-settings');
  for (const s of EDITOR_SETTINGS) assert.equal(M.EDITOR_PREFS.find(p => p.name === s.name).help, s.help, s.name);
});

test('the permission and sandbox choices are the session form\'s', () => {
  const S = require('../public/session-config');
  const byKey = Object.fromEntries(M.FIELDS.map(f => [f.key, f]));
  assert.deepEqual(byKey.permissionMode.choices.map(c => c.value), S.PERMISSION_MODES.map(c => c.value));
  assert.deepEqual(byKey.codexSandbox.choices.map(c => c.value), S.CODEX_SANDBOX_MODES.map(c => c.value));
  assert.deepEqual(byKey.codexApproval.choices.map(c => c.value), S.CODEX_APPROVAL_POLICIES.map(c => c.value));
});

test('the Node Knowledge catalog is the panel\'s', () => {
  assert.deepEqual(M.KNOWLEDGE_CONFIG_FIELDS.map(f => f.key), ['auto_watch', 'watch_non_git', 'ignore_worktrees', 'auto_index', 'auto_index_limit', 'doc_candidates', 'index_max_files', 'index_max_source_mb', 'index_max_rss_mb', 'index_max_duration_seconds']);
  assert.equal(M.KNOWLEDGE_CONFIG_FIELDS.find(f => f.key === 'auto_index_limit').number, true);
  assert.equal(M.KNOWLEDGE_CONFIG_FIELDS.find(f => f.key === 'index_max_files').limit, true);
  assert.deepEqual(Object.keys(M.KNOWLEDGE_SOURCE_LABELS), ['override', 'settings', 'agents', 'installed']);
});
