const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// The Session Overview (session-overview.js) reaches the files shared with
// upstream only through one-line hooks guarded with typeof. This checks that
// each one is where the page needs it.

const read = name => fs.readFileSync(path.join(__dirname, '..', 'public', name), 'utf8');

/** The source of a top-level function: from its header to its closing brace. */
function body(source, header) {
  const start = source.indexOf(header);
  assert.ok(start !== -1, `${header} not found`);
  return source.slice(start, source.indexOf('\n}\n', start) + 2);
}

test('the overview hooks are in place', () => {
  const html = read('index.html');
  const scripts = [...html.matchAll(/<script src="([^"]+)"><\/script>/g)].map(match => match[1]);
  assert.equal(scripts[scripts.indexOf('grid-view.js') + 1], 'session-overview.js');
  assert.ok(scripts.indexOf('session-list.js') !== -1);
  assert.ok(scripts.indexOf('session-overview-model.js') > scripts.indexOf('session-list.js'));
  const head = html.slice(0, html.indexOf('</head>'));
  assert.ok(head.includes('<link rel="stylesheet" href="session-overview.css">'));

  const close = "if (typeof closeSessionOverview === 'function') closeSessionOverview('page');";
  assert.ok(body(read('plans-memory-view.js'), 'function hideViewerPanels()').includes(close));
  assert.ok(body(read('projects-view.js'), 'function hideProjectChrome()').includes(close));
  const app = read('app.js');
  assert.ok(body(app, 'function showStatsPage()').includes(close));

  const toggle = body(read('grid-view.js'), 'function toggleGridView()');
  assert.ok(toggle.startsWith(
    "function toggleGridView() {\n  if (typeof toggleSessionOverview === 'function') return toggleSessionOverview();\n",
  ), toggle);

  // The old grid no longer comes back on its own after a restart.
  assert.ok(!app.includes("localStorage.getItem('gridViewActive')"));
  assert.match(app, /^let gridViewActive = false;$/m);
  assert.ok(app.includes("localStorage.removeItem('gridViewActive');"));
});

test('Settings and the Task Manager close back onto the overview they covered', () => {
  const hook = "if (typeof reopenCoveredOverview === 'function' && reopenCoveredOverview()) return;";
  const settings = read('settings-panel.js');
  const closeSettings = settings.slice(settings.indexOf('function closeSettingsViewer() {'));
  const tasks = read('process-viewer.js');
  const closeTasks = tasks.slice(tasks.indexOf('function closeProcessViewer() {'));
  for (const [name, close, viewer] of [['settings', closeSettings, 'settingsViewer'], ['tasks', closeTasks, 'viewer']]) {
    const at = close.indexOf(hook);
    assert.ok(at !== -1, name);
    // After the viewer is hidden, before it restores the terminal area.
    assert.ok(close.indexOf(`${viewer}.style.display = 'none';`) < at, name);
    assert.ok(at < close.indexOf("terminalArea.style.display = '';"), name);
  }
});

test('the overview opens once the active session is restored', () => {
  const app = read('app.js');
  const start = app.indexOf('loadProjects().then(async () => {');
  const boot = app.slice(start, app.indexOf('\n});\n', start));
  const restored = boot.indexOf('revealActiveSessionInSidebar();');
  const hook = boot.indexOf("if (typeof onAppRestored === 'function') onAppRestored();");
  assert.ok(restored !== -1 && hook > restored, boot);
});
