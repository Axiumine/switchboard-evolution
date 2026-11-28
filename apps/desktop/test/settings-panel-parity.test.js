// settings-panel.js and the shared catalog of the settings (settings-model.js):
// every setting of the catalog has its control in the panel, with the same
// label, the panel has a pane for each tab, and it saves each setting as it
// changes (no Save or Cancel). The help texts are the panel's own HTML and
// are not compared here.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { DESKTOP_TABS, FIELDS } = require('../public/settings-model');

const panel = fs.readFileSync(path.join(__dirname, '../public/settings-panel.js'), 'utf8');

// The control of each setting in the panel.
const PANEL_IDS = {
  permissionMode: 'sv-perm-mode',
  worktree: 'sv-worktree',
  worktreeName: 'sv-worktree-name',
  chrome: 'sv-chrome',
  addDirs: 'sv-add-dirs',
  codexSandbox: 'sv-codex-sandbox',
  codexApproval: 'sv-codex-approval',
  codexModel: 'sv-codex-model',
  preLaunchCmd: 'sv-pre-launch',
  terminalTheme: 'sv-terminal-theme',
  accentColor: 'sv-accent-color',
  shellProfile: 'sv-shell-profile',
  visibleSessionCount: 'sv-visible-count',
  sessionMaxAgeDays: 'sv-max-age',
  terminalEngine: 'sv-terminal-engine',
  projectsRoot: 'sv-projects-root',
  mcpEmulation: 'sv-mcp-emulation',
  desktopNotifications: 'sv-desktop-notifications',
  disabledHarnesses: 'sv-harness-toggle',
};
// editor-settings.js draws these, in the Editor tab.
const DRAWN_ELSEWHERE = new Set(['editorPrefs', 'languageServers']);

test('every setting of the catalog has its control in the panel, with its label', () => {
  for (const field of FIELDS) {
    if (DRAWN_ELSEWHERE.has(field.key)) continue;
    const id = PANEL_IDS[field.key];
    assert.ok(id, `${field.key}: no control of the panel is known for it`);
    assert.ok(panel.includes(id), `${field.key}: ${id} is not in the panel`);
    assert.ok(panel.includes(field.label), `${field.key}: the label "${field.label}" is not in the panel`);
  }
});

test('the panel has a pane for each tab of the desktop', () => {
  for (const tab of DESKTOP_TABS) assert.ok(panel.includes(`data-tab="${tab.key}"`), `no pane for ${tab.key}`);
});

test('each setting saves as it changes: no Save or Cancel, a Close', () => {
  assert.ok(!panel.includes('sv-save-btn'), 'the Save button is gone');
  assert.ok(!panel.includes('sv-cancel-btn'), 'the Cancel button is gone');
  assert.ok(panel.includes('sv-close-btn'), 'a Close button closes the page');
});
