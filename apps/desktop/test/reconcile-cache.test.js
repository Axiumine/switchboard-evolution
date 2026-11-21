const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const sessionCache = require('../session-cache');
const { getFolderIndexMtimeMs } = require('../folder-index-state');

// Keep the machine's real OpenCode database out of these tests: the OpenCode
// ones below point OPENCODE_DB at a fixture of their own.
const NO_OPENCODE_DB = path.join(os.tmpdir(), `switchboard-no-opencode-${process.pid}.db`);
process.env.OPENCODE_DB = NO_OPENCODE_DB;

// Minimal valid session transcript: one line carries `cwd` (for deriveProjectPath)
// and a user message (so readSessionFile yields a non-null session).
function writeSession(folderPath, cwd) {
  fs.mkdirSync(folderPath, { recursive: true });
  const line = JSON.stringify({ type: 'user', cwd, message: { role: 'user', content: 'hello' } });
  fs.writeFileSync(path.join(folderPath, 'session.jsonl'), line + '\n', 'utf8');
}

function writeNamedSession(folderPath, cwd, sessionId, timestamp) {
  fs.mkdirSync(folderPath, { recursive: true });
  const line = JSON.stringify({
    type: 'user', cwd, timestamp,
    message: { role: 'user', content: 'hello' },
  });
  fs.writeFileSync(path.join(folderPath, sessionId + '.jsonl'), line + '\n', 'utf8');
}

// In-memory fake of the db layer that init() expects, recording which folders
// actually got (re)indexed (i.e. had refreshFolder do work and upsert sessions).
function makeFakeDb(metaMap, globalSettings = {}) {
  const indexedFolders = new Set();
  const cachedRows = [];
  return {
    indexedFolders,
    cachedRows,
    db: {
      deleteCachedFolder() {},
      getCachedByFolder() { return []; },
      getCachedSession() { return null; },
      upsertCachedSessions(sessions) {
        for (const s of sessions) { indexedFolders.add(s.folder); cachedRows.push(s); }
      },
      deleteCachedSession() {},
      deleteSearchFolder() {},
      deleteSearchSession() {},
      upsertSearchEntries() {},
      setFolderMeta(folder, projectPath, indexMtimeMs) { metaMap.set(folder, { folder, projectPath, indexMtimeMs }); },
      getAllFolderMeta() { return metaMap; },
      getAllMeta() { return new Map(); },
      getAllCached() { return cachedRows; },
      getSetting(key) { return key === 'global' ? globalSettings : {}; },
      setSetting(key, value) {
        if (key !== 'global' || value === globalSettings) return;
        for (const existingKey of Object.keys(globalSettings)) delete globalSettings[existingKey];
        Object.assign(globalSettings, value);
      },
      getMeta() { return null; },
      setName() {},
      updateCachedAiTitle(sessionId, aiTitle, runtime) {
        const row = cachedRows.find(r => r.sessionId === sessionId && r.runtime === runtime);
        if (!row) return 0;
        row.aiTitle = aiTitle;
        return 1;
      },
      updateSearchTitle() {},
    },
  };
}

test('refreshFolder upgrades only new or changed transcripts to full conversation search', () => {
  const projectsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'switchboard-conversation-search-'));
  try {
    const folder = 'project';
    const folderPath = path.join(projectsDir, folder);
    fs.mkdirSync(folderPath);
    const oldText = 'original conversation '.repeat(500) + ' move_fna_lines';
    const write = (id, text) => fs.writeFileSync(path.join(folderPath, `${id}.jsonl`),
      JSON.stringify({ type: 'user', cwd: '/tmp/project', message: { content: text } }) + '\n');
    write('changed', oldText);
    write('unchanged', oldText);

    const fake = makeFakeDb(new Map());
    const searchEntries = new Map();
    const writes = [];
    for (const id of ['changed', 'unchanged']) {
      const row = require('../harnesses/claude').readSessionFile(
        path.join(folderPath, `${id}.jsonl`), folder, '/tmp/project');
      fake.cachedRows.push({ ...row, headHash: 'v2:' + row.headHash.slice(3), textContent: 'legacy excerpt' });
      searchEntries.set(id, 'legacy excerpt');
    }
    fake.db.getCachedByFolder = key => fake.cachedRows.filter(row => row.folder === key);
    fake.db.getCachedSession = id => fake.cachedRows.find(row => row.sessionId === id) || null;
    fake.db.upsertCachedSessions = sessions => {
      for (const session of sessions) {
        const old = fake.cachedRows.find(row => row.sessionId === session.sessionId);
        if (old) Object.assign(old, session);
        else fake.cachedRows.push(session);
      }
    };
    fake.db.deleteSearchSession = id => searchEntries.delete(id);
    fake.db.upsertSearchEntries = entries => {
      for (const entry of entries) {
        writes.push(entry.id);
        searchEntries.set(entry.id, entry.body);
      }
    };
    sessionCache.init({ PROJECTS_DIR: projectsDir, activeSessions: new Map(),
      getMainWindow: () => null, log: console, db: fake.db });

    sessionCache.refreshFolder(folder);
    assert.deepEqual(writes, [], 'deploying the parser must not reindex unchanged files');

    const changedFile = path.join(folderPath, 'changed.jsonl');
    const previousMtime = fs.statSync(changedFile).mtimeMs;
    fs.appendFileSync(changedFile, JSON.stringify({ type: 'assistant', message: { content: 'new reply' } }) + '\n');
    fs.utimesSync(changedFile, new Date(), new Date(previousMtime + 5000));
    write('new', oldText);
    sessionCache.refreshFolder(folder);

    assert.deepEqual(writes.sort(), ['changed', 'new']);
    assert.equal(searchEntries.get('changed'), oldText + '\nnew reply', 'a changed file contributes its entire history');
    assert.equal(searchEntries.get('new'), oldText);
    assert.equal(searchEntries.get('unchanged'), 'legacy excerpt');

    writes.length = 0;
    sessionCache.refreshFolder(folder);
    assert.deepEqual(writes, [], 'the updated file mtime must prevent repeated indexing');
  } finally {
    fs.rmSync(projectsDir, { recursive: true, force: true });
  }
});

test('reconcileCacheFromFilesystem indexes new and stale folders but skips up-to-date ones', () => {
  const projectsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'switchboard-reconcile-'));
  try {
    // never-indexed (no meta), stale (meta older than disk), and up-to-date folders
    writeSession(path.join(projectsDir, 'proj-new'), '/tmp/proj-new');
    writeSession(path.join(projectsDir, 'proj-stale'), '/tmp/proj-stale');
    writeSession(path.join(projectsDir, 'proj-current'), '/tmp/proj-current');

    const metaMap = new Map();
    metaMap.set('proj-stale', { folder: 'proj-stale', projectPath: '/tmp/proj-stale', indexMtimeMs: 0 });
    metaMap.set('proj-current', {
      folder: 'proj-current', projectPath: '/tmp/proj-current',
      indexMtimeMs: getFolderIndexMtimeMs(path.join(projectsDir, 'proj-current')),
    });

    // Keep the machine's real ~/.codex out of a Claude-only test.
    const fake = makeFakeDb(metaMap, { disabledHarnesses: ['codex'] });
    sessionCache.init({
      PROJECTS_DIR: projectsDir,
      activeSessions: new Map(),
      getMainWindow: () => null,
      log: console,
      db: fake.db,
    });

    sessionCache.reconcileCacheFromFilesystem();

    assert.ok(fake.indexedFolders.has('proj-new'), 'new folder should be indexed');
    assert.ok(fake.indexedFolders.has('proj-stale'), 'stale folder (older indexMtimeMs) should be re-indexed');
    assert.ok(!fake.indexedFolders.has('proj-current'), 'up-to-date folder should be skipped');
  } finally {
    fs.rmSync(projectsDir, { recursive: true, force: true });
  }
});

test('an append arriving during refresh remains eligible for the next reconciliation', () => {
  const claude = require('../harnesses/claude');
  const originalRead = claude.readSessionFile;
  const projectsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'switchboard-concurrent-append-'));
  const folder = 'project';
  const folderPath = path.join(projectsDir, folder);
  try {
    writeSession(folderPath, '/tmp/project');
    const file = path.join(folderPath, 'session.jsonl');
    const before = getFolderIndexMtimeMs(folderPath);
    const metaMap = new Map();
    const fake = makeFakeDb(metaMap, { disabledHarnesses: ['codex'] });
    fake.db.getCachedByFolder = () => fake.cachedRows;
    fake.db.getCachedSession = id => fake.cachedRows.find(r => r.sessionId === id) || null;
    sessionCache.init({ PROJECTS_DIR: projectsDir, activeSessions: new Map(),
      getMainWindow: () => null, log: console, db: fake.db });
    claude.readSessionFile = (...args) => {
      const row = originalRead(...args);
      fs.appendFileSync(file, JSON.stringify({ type: 'assistant', message: 'arrived during refresh' }) + '\n');
      const later = new Date(before + 5000);
      fs.utimesSync(file, later, later);
      return row;
    };
    sessionCache.refreshFolder(folder);
    claude.readSessionFile = originalRead;
    assert.equal(fake.cachedRows[0].messageCount, 1);
    assert.ok(metaMap.get(folder).indexMtimeMs < getFolderIndexMtimeMs(folderPath));
    fake.indexedFolders.clear();
    sessionCache.reconcileCacheFromFilesystem();
    assert.ok(fake.indexedFolders.has(folder), 'the late append must not be acknowledged without parsing it');
    assert.equal(fake.cachedRows.at(-1).messageCount, 2);
  } finally {
    claude.readSessionFile = originalRead;
    fs.rmSync(projectsDir, { recursive: true, force: true });
  }
});

test('a new session restores a hidden project', () => {
  const projectsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'switchboard-restore-hidden-'));
  const projectPath = '/tmp/hidden-worktree';
  const folder = 'hidden-worktree';
  const hiddenAt = Date.now();
  const settings = {
    hiddenProjects: [projectPath],
    hiddenProjectTimestamps: { [projectPath]: hiddenAt },
  };

  try {
    writeNamedSession(
      path.join(projectsDir, folder), projectPath, 'new-session',
      new Date(hiddenAt + 1000).toISOString(),
    );
    const fake = makeFakeDb(new Map(), settings);
    sessionCache.init({
      PROJECTS_DIR: projectsDir, activeSessions: new Map(),
      getMainWindow: () => null, log: console, db: fake.db,
    });

    sessionCache.refreshFolder(folder);

    assert.deepEqual(settings.hiddenProjects, []);
    assert.equal(settings.hiddenProjectTimestamps[projectPath], undefined);
  } finally {
    fs.rmSync(projectsDir, { recursive: true, force: true });
  }
});

test('activity in an old session does not restore a hidden project', () => {
  const projectsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'switchboard-keep-hidden-'));
  const projectPath = '/tmp/hidden-worktree';
  const folder = 'hidden-worktree';

  try {
    const oldCreatedAt = Date.now() - 1000;
    writeNamedSession(
      path.join(projectsDir, folder), projectPath, 'old-session',
      new Date(oldCreatedAt).toISOString(),
    );
    const sessionFile = path.join(projectsDir, folder, 'old-session.jsonl');
    const hiddenAt = Math.max(Date.now(), fs.statSync(sessionFile).birthtimeMs + 1);
    const settings = {
      hiddenProjects: [projectPath],
      hiddenProjectTimestamps: { [projectPath]: hiddenAt },
    };
    fs.appendFileSync(sessionFile, JSON.stringify({
      type: 'assistant', timestamp: new Date(hiddenAt + 1000).toISOString(),
      message: { role: 'assistant', content: 'new activity' },
    }) + '\n');
    const fake = makeFakeDb(new Map(), settings);
    sessionCache.init({
      PROJECTS_DIR: projectsDir, activeSessions: new Map(),
      getMainWindow: () => null, log: console, db: fake.db,
    });

    sessionCache.refreshFolder(folder);

    assert.deepEqual(settings.hiddenProjects, [projectPath]);
  } finally {
    fs.rmSync(projectsDir, { recursive: true, force: true });
  }
});

test('hidden projects from older settings receive a baseline timestamp', () => {
  const settings = { hiddenProjects: ['/tmp/legacy-hidden'] };
  const fake = makeFakeDb(new Map(), settings);
  sessionCache.init({
    PROJECTS_DIR: os.tmpdir(), activeSessions: new Map(),
    getMainWindow: () => null, log: console, db: fake.db,
  });

  sessionCache.initializeHiddenProjectTimestamps(12345);

  assert.equal(settings.hiddenProjectTimestamps['/tmp/legacy-hidden'], 12345);
});

test('a live plain terminal keeps its project filing across renderer reloads', () => {
  const fake = makeFakeDb(new Map());
  sessionCache.init({
    PROJECTS_DIR: os.tmpdir(),
    activeSessions: new Map([['terminal-1', {
      exited: false,
      isPlainTerminal: true,
      projectPath: '/tmp/attached-repo',
      projectId: 'project-1',
      trackId: 'track-1',
      _openedAt: 12345,
    }]]),
    getMainWindow: () => null,
    log: console,
    db: fake.db,
  });

  const projects = sessionCache.buildProjectsFromCache(false);
  const terminal = projects.flatMap(project => project.sessions)
    .find(session => session.sessionId === 'terminal-1');
  assert.equal(terminal.projectId, 'project-1');
  assert.equal(terminal.trackId, 'track-1');
});

test('a CLI session with no transcript yet is listed once, under its real id', () => {
  const fake = makeFakeDb(new Map());
  const forked = { exited: false, runtime: 'claude', realSessionId: 'real-fork', projectPath: '/tmp/app', _openedAt: 20 };
  sessionCache.init({
    PROJECTS_DIR: os.tmpdir(),
    activeSessions: new Map([
      ['phone-1', { exited: false, runtime: 'codex', projectPath: '/tmp/app', projectId: 'p1', trackId: null, _openedAt: 10 }],
      ['temp-fork', forked],
      ['real-fork', forked],
      ['gone', { exited: true, runtime: 'claude', projectPath: '/tmp/app', _openedAt: 5 }],
    ]),
    getMainWindow: () => null,
    log: console,
    db: fake.db,
  });

  const sessions = sessionCache.buildProjectsFromCache(false).flatMap(project => project.sessions);
  assert.deepEqual(sessions.map(s => s.sessionId).sort(), ['phone-1', 'real-fork']);
  const fromPhone = sessions.find(s => s.sessionId === 'phone-1');
  assert.equal(fromPhone.runtime, 'codex');
  assert.equal(fromPhone.projectId, 'p1');
  assert.equal(fromPhone.summary, 'New session');
});

test('a CLI session with no transcript yet keeps the name it was given and shows the CLI title', () => {
  const fake = makeFakeDb(new Map());
  fake.db.getAllMeta = () => new Map([
    ['named', { sessionId: 'named', name: 'Sw app', starred: 1, archived: 0, projectId: 'p1', trackId: 't1' }],
    ['hidden', { sessionId: 'hidden', name: null, archived: 1 }],
  ]);
  sessionCache.init({
    PROJECTS_DIR: os.tmpdir(),
    activeSessions: new Map([
      ['named', { exited: false, runtime: 'claude', projectPath: '/tmp/app', _openedAt: 10, _cliTitle: 'Files tab explorer' }],
      ['titled', { exited: false, runtime: 'claude', projectPath: '/tmp/app', _openedAt: 20, _cliTitle: 'Fix the rename' }],
      ['hidden', { exited: false, runtime: 'claude', projectPath: '/tmp/app', _openedAt: 30 }],
    ]),
    getMainWindow: () => null,
    log: console,
    db: fake.db,
  });

  const sessions = sessionCache.buildProjectsFromCache(false).flatMap(project => project.sessions);
  const named = sessions.find(s => s.sessionId === 'named');
  // Renamed by hand before the CLI wrote anything: the name wins, as for any session.
  assert.equal(named.name, 'Sw app');
  assert.equal(named.aiTitle, 'Files tab explorer');
  assert.equal(named.starred, 1);
  assert.equal(named.projectId, 'p1');
  assert.equal(named.trackId, 't1');
  const titled = sessions.find(s => s.sessionId === 'titled');
  assert.equal(titled.name, null);
  assert.equal(titled.aiTitle, 'Fix the rename');
  assert.equal(sessions.some(s => s.sessionId === 'hidden'), false);
  assert.equal(sessionCache.buildProjectsFromCache(true).flatMap(p => p.sessions).some(s => s.sessionId === 'hidden'), true);
});

// --- codex folders ---

const ROLLOUT = 'rollout-2026-08-26T11-55-02-01a03f6c-fdf9-7c83-86e3-c388f81d765c.jsonl';

function writeRollout(dayDir, cwd) {
  fs.mkdirSync(dayDir, { recursive: true });
  const lines = [
    { timestamp: '2026-08-26T10:00:00Z', type: 'session_meta', payload: { session_id: 'root', cwd } },
    { timestamp: '2026-08-26T10:00:01Z', type: 'response_item',
      payload: { type: 'message', role: 'user', content: [{ type: 'text', text: 'hello' }] } },
  ];
  fs.writeFileSync(path.join(dayDir, ROLLOUT), lines.map(l => JSON.stringify(l)).join('\n') + '\n', 'utf8');
}

// A codex date folder holds sessions from many projects, so it has no
// folder-level project path. refreshFolder used to bail on exactly that
// condition, which would have skipped every codex folder silently.
test('reconcile indexes codex date folders even though they have no folder project', () => {
  const projectsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'switchboard-claude-'));
  const codexHome = fs.mkdtempSync(path.join(os.tmpdir(), 'switchboard-codex-'));
  const prevHome = process.env.CODEX_HOME;
  try {
    process.env.CODEX_HOME = codexHome;
    writeRollout(path.join(codexHome, 'sessions', '2026', '08', '26'), '/tmp/some-project');

    const metaMap = new Map();
    const fake = makeFakeDb(metaMap);
    sessionCache.init({
      PROJECTS_DIR: projectsDir, activeSessions: new Map(),
      getMainWindow: () => null, log: console, db: fake.db,
    });

    sessionCache.reconcileCacheFromFilesystem();
    assert.ok(fake.indexedFolders.has('codex/2026/08/26'), 'codex folder should be indexed');
    // cache_meta records a null project for it — many projects share the folder.
    assert.equal(metaMap.get('codex/2026/08/26').projectPath, null);

    // Second pass: unchanged on disk, so the mtime gate must skip it. Without
    // this the date folders would be fully re-read on every get-projects call.
    const second = makeFakeDb(metaMap);
    sessionCache.init({
      PROJECTS_DIR: projectsDir, activeSessions: new Map(),
      getMainWindow: () => null, log: console, db: second.db,
    });
    sessionCache.reconcileCacheFromFilesystem();
    assert.equal(second.indexedFolders.size, 0, 'up-to-date codex folder should be skipped');
  } finally {
    if (prevHome === undefined) delete process.env.CODEX_HOME; else process.env.CODEX_HOME = prevHome;
    fs.rmSync(projectsDir, { recursive: true, force: true });
    fs.rmSync(codexHome, { recursive: true, force: true });
  }
});

// A cleared cache can mean gigabytes of Codex transcripts to re-read. Doing that
// on the main process stalls the window and every terminal until it finishes.
test('a large reconcile pass reads transcripts on a worker, then writes them', async () => {
  const projectsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'switchboard-claude-'));
  const codexHome = fs.mkdtempSync(path.join(os.tmpdir(), 'switchboard-codex-'));
  const prevHome = process.env.CODEX_HOME;
  try {
    process.env.CODEX_HOME = codexHome;
    writeRollout(path.join(codexHome, 'sessions', '2026', '08', '26'), '/tmp/some-project');

    const metaMap = new Map();
    const fake = makeFakeDb(metaMap);
    sessionCache.init({
      PROJECTS_DIR: projectsDir, activeSessions: new Map(),
      getMainWindow: () => null, log: console, db: fake.db,
      inlineReadLimitBytes: 0,
    });

    const pending = sessionCache.reconcileCacheFromFilesystem();
    assert.ok(pending, 'a pass over the limit hands its reads to a worker');
    assert.equal(fake.cachedRows.length, 0, 'nothing is written before the worker reports');
    assert.equal(sessionCache.reconcileCacheFromFilesystem(), pending,
      'a folder the worker owns is not planned again while it reads');

    await pending;
    assert.ok(fake.indexedFolders.has('codex/2026/08/26'));
    assert.equal(fake.cachedRows.length, 1);
    assert.equal(fake.cachedRows[0].projectPath, '/tmp/some-project');
    assert.equal(metaMap.get('codex/2026/08/26').projectPath, null);

    assert.equal(sessionCache.reconcileCacheFromFilesystem(), null, 'an up-to-date folder needs no worker');
    assert.equal(fake.cachedRows.length, 1);
  } finally {
    if (prevHome === undefined) delete process.env.CODEX_HOME; else process.env.CODEX_HOME = prevHome;
    fs.rmSync(projectsDir, { recursive: true, force: true });
    fs.rmSync(codexHome, { recursive: true, force: true });
  }
});

test('a new Codex session also restores its hidden project', () => {
  const projectsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'switchboard-claude-'));
  const codexHome = fs.mkdtempSync(path.join(os.tmpdir(), 'switchboard-codex-'));
  const prevHome = process.env.CODEX_HOME;
  const projectPath = '/tmp/hidden-codex-project';
  const hiddenAt = Date.parse('2026-08-25T00:00:00Z');
  const settings = {
    hiddenProjects: [projectPath],
    hiddenProjectTimestamps: { [projectPath]: hiddenAt },
  };
  try {
    process.env.CODEX_HOME = codexHome;
    writeRollout(path.join(codexHome, 'sessions', '2026', '08', '26'), projectPath);
    const fake = makeFakeDb(new Map(), settings);
    sessionCache.init({
      PROJECTS_DIR: projectsDir, activeSessions: new Map(),
      getMainWindow: () => null, log: console, db: fake.db,
    });

    sessionCache.refreshFolder('codex/2026/08/26');

    assert.deepEqual(settings.hiddenProjects, []);
  } finally {
    if (prevHome === undefined) delete process.env.CODEX_HOME; else process.env.CODEX_HOME = prevHome;
    fs.rmSync(projectsDir, { recursive: true, force: true });
    fs.rmSync(codexHome, { recursive: true, force: true });
  }
});

test('reconcile captures Codex auto-titles and rename changes without a transcript change', () => {
  const projectsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'switchboard-claude-'));
  const codexHome = fs.mkdtempSync(path.join(os.tmpdir(), 'switchboard-codex-'));
  const prevHome = process.env.CODEX_HOME;
  try {
    process.env.CODEX_HOME = codexHome;
    writeRollout(path.join(codexHome, 'sessions', '2026', '08', '26'), '/tmp/titled-project');
    const indexPath = path.join(codexHome, 'session_index.jsonl');
    fs.writeFileSync(indexPath, JSON.stringify({
      id: '01a03f6c-fdf9-7c83-86e3-c388f81d765c',
      thread_name: 'Automatic title', updated_at: '2026-08-26T10:01:00Z',
    }) + '\n');

    const fake = makeFakeDb(new Map());
    sessionCache.init({
      PROJECTS_DIR: projectsDir, activeSessions: new Map(),
      getMainWindow: () => null, log: console, db: fake.db,
    });

    sessionCache.reconcileCacheFromFilesystem();
    assert.equal(fake.cachedRows[0].aiTitle, 'Automatic title');

    fs.appendFileSync(indexPath, JSON.stringify({
      id: '01a03f6c-fdf9-7c83-86e3-c388f81d765c',
      thread_name: 'Renamed in Codex', updated_at: '2026-08-26T10:02:00Z',
    }) + '\n');
    fake.indexedFolders.clear();

    sessionCache.reconcileCacheFromFilesystem();
    assert.equal(fake.indexedFolders.size, 0, 'the unchanged rollout stays behind the mtime gate');
    assert.equal(fake.cachedRows[0].aiTitle, 'Renamed in Codex');
  } finally {
    if (prevHome === undefined) delete process.env.CODEX_HOME; else process.env.CODEX_HOME = prevHome;
    fs.rmSync(projectsDir, { recursive: true, force: true });
    fs.rmSync(codexHome, { recursive: true, force: true });
  }
});

test('a codex home that does not exist contributes nothing and does not throw', () => {
  const projectsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'switchboard-nocodex-'));
  const prevHome = process.env.CODEX_HOME;
  try {
    process.env.CODEX_HOME = path.join(os.tmpdir(), 'switchboard-definitely-absent-' + process.pid);
    writeSession(path.join(projectsDir, 'proj'), '/tmp/proj');

    const metaMap = new Map();
    const fake = makeFakeDb(metaMap);
    sessionCache.init({
      PROJECTS_DIR: projectsDir, activeSessions: new Map(),
      getMainWindow: () => null, log: console, db: fake.db,
    });

    sessionCache.reconcileCacheFromFilesystem();
    assert.ok(fake.indexedFolders.has('proj'), 'claude folders still indexed');
    assert.equal([...fake.indexedFolders].filter(f => f.startsWith('codex/')).length, 0);
  } finally {
    if (prevHome === undefined) delete process.env.CODEX_HOME; else process.env.CODEX_HOME = prevHome;
    fs.rmSync(projectsDir, { recursive: true, force: true });
  }
});

// --- switching a CLI off and on ---

function setUpBoth(globalSettings) {
  const projectsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'switchboard-claude-'));
  const codexHome = fs.mkdtempSync(path.join(os.tmpdir(), 'switchboard-codex-'));
  process.env.CODEX_HOME = codexHome;
  writeSession(path.join(projectsDir, 'proj'), '/tmp/proj');
  writeRollout(path.join(codexHome, 'sessions', '2026', '08', '26'), '/tmp/codex-project');
  const metaMap = new Map();
  const fake = makeFakeDb(metaMap, globalSettings);
  sessionCache.init({
    PROJECTS_DIR: projectsDir, activeSessions: new Map(),
    getMainWindow: () => null, log: console, db: fake.db,
  });
  return { projectsDir, codexHome, metaMap, fake };
}

test('a disabled CLI is not scanned at all', () => {
  const prev = process.env.CODEX_HOME;
  const { projectsDir, codexHome, fake } = setUpBoth({ disabledHarnesses: ['codex'] });
  try {
    sessionCache.reconcileCacheFromFilesystem();
    assert.ok(fake.indexedFolders.has('proj'), 'the enabled CLI is still scanned');
    assert.equal([...fake.indexedFolders].filter(f => f.startsWith('codex/')).length, 0,
      'the disabled CLI is not read from disk');
  } finally {
    if (prev === undefined) delete process.env.CODEX_HOME; else process.env.CODEX_HOME = prev;
    fs.rmSync(projectsDir, { recursive: true, force: true });
    fs.rmSync(codexHome, { recursive: true, force: true });
  }
});

test('Claude can be the one switched off', () => {
  const prev = process.env.CODEX_HOME;
  const { projectsDir, codexHome, fake } = setUpBoth({ disabledHarnesses: ['claude'] });
  try {
    sessionCache.reconcileCacheFromFilesystem();
    assert.ok(fake.indexedFolders.has('codex/2026/08/26'));
    assert.ok(!fake.indexedFolders.has('proj'), 'the Claude projects dir is not read');
  } finally {
    if (prev === undefined) delete process.env.CODEX_HOME; else process.env.CODEX_HOME = prev;
    fs.rmSync(projectsDir, { recursive: true, force: true });
    fs.rmSync(codexHome, { recursive: true, force: true });
  }
});

// The question this whole design turns on: if a disabled CLI is never scanned,
// does switching it back on actually pick up what it did in the meantime?
test('switching a CLI back on scans what it missed', () => {
  const prev = process.env.CODEX_HOME;
  const settings = { disabledHarnesses: ['codex'] };
  const { projectsDir, codexHome, metaMap, fake } = setUpBoth(settings);
  try {
    sessionCache.reconcileCacheFromFilesystem();
    assert.equal([...fake.indexedFolders].filter(f => f.startsWith('codex/')).length, 0);

    // A codex session happens while it is switched off.
    writeRollout(path.join(codexHome, 'sessions', '2026', '08', '27'), '/tmp/while-off');

    // Switch it on and reconcile, exactly as set-setting does.
    settings.disabledHarnesses = [];
    const after = makeFakeDb(metaMap, settings);
    sessionCache.init({
      PROJECTS_DIR: projectsDir, activeSessions: new Map(),
      getMainWindow: () => null, log: console, db: after.db,
    });
    sessionCache.reconcileCacheFromFilesystem();

    assert.ok(after.indexedFolders.has('codex/2026/08/26'), 'history from before it was switched off');
    assert.ok(after.indexedFolders.has('codex/2026/08/27'), 'the session it had while switched off');
  } finally {
    if (prev === undefined) delete process.env.CODEX_HOME; else process.env.CODEX_HOME = prev;
    fs.rmSync(projectsDir, { recursive: true, force: true });
    fs.rmSync(codexHome, { recursive: true, force: true });
  }
});

test('a disabled CLI\'s sessions are hidden but its cached rows are kept', () => {
  const prev = process.env.CODEX_HOME;
  const settings = {};
  const { projectsDir, codexHome, fake } = setUpBoth(settings);
  try {
    sessionCache.reconcileCacheFromFilesystem();
    const shown = () => sessionCache.buildProjectsFromCache(true)
      .flatMap(p => p.sessions).map(s => s.runtime || 'claude');

    assert.ok(shown().includes('codex'), 'listed while switched on');

    settings.disabledHarnesses = ['codex'];
    assert.ok(!shown().includes('codex'), 'hidden while switched off');
    assert.ok(shown().includes('claude'), 'the other CLI is unaffected');
    // Nothing was deleted — that is what makes switching back on cheap.
    assert.ok(fake.cachedRows.some(r => r.runtime === 'codex'), 'rows kept in the cache');

    settings.disabledHarnesses = [];
    assert.ok(shown().includes('codex'), 'listed again immediately, with no re-index');
  } finally {
    if (prev === undefined) delete process.env.CODEX_HOME; else process.env.CODEX_HOME = prev;
    fs.rmSync(projectsDir, { recursive: true, force: true });
    fs.rmSync(codexHome, { recursive: true, force: true });
  }
});

test('a live plain terminal keeps the name and star it was given', () => {
  const fake = makeFakeDb(new Map());
  fake.db.getAllMeta = () => new Map([['terminal-1', { name: 'dev server', starred: 1 }]]);
  sessionCache.init({
    PROJECTS_DIR: os.tmpdir(),
    activeSessions: new Map([['terminal-1', { exited: false, isPlainTerminal: true, projectPath: '/tmp/attached-repo', _openedAt: 12345 }]]),
    getMainWindow: () => null,
    log: console,
    db: fake.db,
  });

  const terminal = sessionCache.buildProjectsFromCache(false).flatMap(project => project.sessions)
    .find(session => session.sessionId === 'terminal-1');
  assert.equal(terminal.name, 'dev server');
  assert.equal(terminal.starred, 1);
});

// --- OpenCode: sessions in a database, not in files ---

const { DatabaseSync } = require('node:sqlite');
const opencode = require('../harnesses/opencode');

const OPENCODE_SCHEMA = `
  CREATE TABLE session_v2 (id text PRIMARY KEY, project_id text NOT NULL, parent_id text, slug text NOT NULL,
    directory text NOT NULL, title text, version text NOT NULL, time_created integer NOT NULL,
    time_updated integer NOT NULL, time_archived integer);
  CREATE TABLE session_message (id text PRIMARY KEY, session_id text NOT NULL, type text NOT NULL,
    seq integer NOT NULL, time_created integer NOT NULL, time_updated integer NOT NULL, data text NOT NULL);
`;

// An OpenCode data folder with its database, and a Claude projects folder,
// both empty until a test writes to them.
function setUpOpencode(globalSettings = { disabledHarnesses: ['codex'] }, initOptions = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'switchboard-opencode-'));
  const projectsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'switchboard-claude-'));
  const file = path.join(dir, 'opencode.db');
  const db = new DatabaseSync(file);
  db.exec(OPENCODE_SCHEMA);
  process.env.OPENCODE_DB = file;
  let seq = 0;
  const T = Date.parse('2026-11-21T10:00:00.000Z');
  const oc = {
    dir, projectsDir, db,
    addSession(id, { project = 'p1', directory = '/tmp/oc-project', text = 'hello opencode', updated = T } = {}) {
      db.prepare(`INSERT INTO session_v2 (id, project_id, slug, directory, version, time_created, time_updated)
        VALUES (?, ?, 'calm-otter', ?, '2.3.2', ?, ?)`).run(id, project, directory, T, updated);
      oc.addMessage(id, text);
    },
    addMessage(sessionId, text) {
      seq++;
      db.prepare(`INSERT INTO session_message (id, session_id, type, seq, time_created, time_updated, data)
        VALUES (?, ?, 'user', ?, ?, ?, ?)`).run(`msg_${sessionId}_${seq}`, sessionId, seq, T + seq, T + seq,
        JSON.stringify({ text, time: { created: T + seq } }));
    },
    touch(sessionId, ms) {
      db.prepare('UPDATE session_v2 SET time_updated = ? WHERE id = ?').run(ms, sessionId);
    },
    metaMap: new Map(),
    init(fake) {
      sessionCache.init({ PROJECTS_DIR: projectsDir, activeSessions: new Map(),
        getMainWindow: () => null, log: console, db: fake.db, ...initOptions });
    },
    // A fake db whose cache reads see the rows written so far, like the real one.
    fake() {
      const fake = makeFakeDb(oc.metaMap, globalSettings);
      fake.deleted = [];
      fake.deletedFolders = [];
      fake.db.getCachedByFolder = key => oc.rows.filter(r => r.folder === key);
      fake.db.getCachedSession = id => oc.rows.find(r => r.sessionId === id) || null;
      fake.db.upsertCachedSessions = sessions => {
        for (const s of sessions) {
          fake.indexedFolders.add(s.folder);
          fake.cachedRows.push(s);
          oc.rows = oc.rows.filter(r => r.sessionId !== s.sessionId).concat(s);
        }
      };
      fake.db.deleteCachedSession = id => { fake.deleted.push(id); oc.rows = oc.rows.filter(r => r.sessionId !== id); };
      fake.db.deleteCachedFolder = folder => { fake.deletedFolders.push(folder); oc.rows = oc.rows.filter(r => r.folder !== folder); };
      oc.init(fake);
      return fake;
    },
    rows: [],
    cleanup() {
      opencode.closeDb();
      try { db.close(); } catch {}
      process.env.OPENCODE_DB = NO_OPENCODE_DB;
      fs.rmSync(dir, { recursive: true, force: true });
      fs.rmSync(projectsDir, { recursive: true, force: true });
    },
  };
  return oc;
}

test('reconcile indexes OpenCode projects from its database, then skips them while unchanged', () => {
  const oc = setUpOpencode();
  try {
    oc.addSession('ses_a', { directory: '/tmp/oc-project' });
    oc.addSession('ses_b', { project: 'p2', directory: '/tmp/oc-other' });

    const first = oc.fake();
    sessionCache.reconcileCacheFromFilesystem();
    assert.ok(first.indexedFolders.has('opencode/p1'));
    assert.ok(first.indexedFolders.has('opencode/p2'));
    const row = first.cachedRows.find(r => r.sessionId === 'ses_a');
    assert.equal(row.runtime, 'opencode');
    assert.equal(row.projectPath, '/tmp/oc-project');
    // Like a codex date folder, a project spans directories: no folder project.
    assert.equal(oc.metaMap.get('opencode/p1').projectPath, null);

    const second = oc.fake();
    sessionCache.reconcileCacheFromFilesystem();
    assert.equal(second.indexedFolders.size, 0, 'an unchanged database is not read again');
  } finally {
    oc.cleanup();
  }
});

test('an OpenCode session written to is read again, the others are not', () => {
  const oc = setUpOpencode();
  try {
    oc.addSession('ses_a');
    oc.addSession('ses_b');
    oc.fake();
    sessionCache.reconcileCacheFromFilesystem();

    oc.addMessage('ses_a', 'second turn zebra');
    oc.touch('ses_a', Date.parse('2026-11-21T11:00:00.000Z'));
    const after = oc.fake();
    sessionCache.reconcileCacheFromFilesystem();
    assert.deepEqual(after.cachedRows.map(r => r.sessionId), ['ses_a']);
    assert.match(after.cachedRows[0].textContent, /zebra/);
  } finally {
    oc.cleanup();
  }
});

test('an archived or deleted OpenCode session leaves the cache, and so does an emptied project', () => {
  const oc = setUpOpencode();
  try {
    oc.addSession('ses_a');
    oc.addSession('ses_b');
    oc.addSession('ses_c', { project: 'p2' });
    oc.fake();
    sessionCache.reconcileCacheFromFilesystem();

    oc.db.prepare('UPDATE session_v2 SET time_archived = 1, time_updated = time_updated + 5 WHERE id = ?').run('ses_a');
    oc.db.prepare('DELETE FROM session_message WHERE session_id = ?').run('ses_c');
    oc.db.prepare('DELETE FROM session_v2 WHERE id = ?').run('ses_c');
    const after = oc.fake();
    sessionCache.reconcileCacheFromFilesystem();
    assert.deepEqual(after.deleted, ['ses_a']);
    // A project with nothing left is no longer listed, like a deleted Claude
    // folder: the watcher's refresh of the folders it knows is what drops it.
    assert.deepEqual(oc.rows.map(r => r.sessionId).sort(), ['ses_b', 'ses_c']);
    sessionCache.refreshFolder('opencode/p2');
    assert.deepEqual(after.deletedFolders, ['opencode/p2']);
    assert.deepEqual(oc.rows.map(r => r.sessionId), ['ses_b']);
  } finally {
    oc.cleanup();
  }
});

test('OpenCode sessions read on a worker are written once it reports', async () => {
  // A pass over the inline limit hands every planned read to a worker, OpenCode's
  // included. Its rows have no file to stat afterwards: the stamp comes from
  // the database, or they would be dropped on every pass.
  const codexHome = fs.mkdtempSync(path.join(os.tmpdir(), 'switchboard-codex-'));
  const prevHome = process.env.CODEX_HOME;
  const oc = setUpOpencode({}, { inlineReadLimitBytes: 0 });
  try {
    process.env.CODEX_HOME = codexHome;
    writeRollout(path.join(codexHome, 'sessions', '2026', '08', '26'), '/tmp/some-project');
    oc.addSession('ses_a');
    const fake = oc.fake();
    const pending = sessionCache.reconcileCacheFromFilesystem();
    assert.ok(pending, 'the pass is read on a worker');
    await pending;
    assert.ok(fake.indexedFolders.has('opencode/p1'));
    assert.ok(oc.rows.some(r => r.sessionId === 'ses_a'));
  } finally {
    if (prevHome === undefined) delete process.env.CODEX_HOME; else process.env.CODEX_HOME = prevHome;
    fs.rmSync(codexHome, { recursive: true, force: true });
    oc.cleanup();
  }
});

test('indexing on the worker reads OpenCode sessions and remembers the project stamp', async () => {
  const oc = setUpOpencode();
  try {
    oc.addSession('ses_a', { text: 'worker giraffe' });
    const fake = oc.fake();
    const result = await sessionCache.indexFoldersInWorker({ pauseMs: 0 });
    assert.ok(result.changed);
    assert.ok(oc.rows.some(r => r.sessionId === 'ses_a' && /giraffe/.test(r.textContent)));
    assert.equal(oc.metaMap.get('opencode/p1').indexMtimeMs, opencode.folderStamp('opencode/p1'));

    fake.indexedFolders.clear();
    const again = await sessionCache.indexFoldersInWorker({ pauseMs: 0 });
    assert.equal(again.count, 0, 'an unchanged project is skipped');
  } finally {
    oc.cleanup();
  }
});

test('a database change names no session: the folders whose stamp moved are found', () => {
  const oc = setUpOpencode();
  try {
    oc.addSession('ses_a');
    oc.addSession('ses_b', { project: 'p2' });
    oc.fake();
    sessionCache.reconcileCacheFromFilesystem();
    assert.deepEqual(sessionCache.changedFolders(opencode), []);

    oc.touch('ses_a', Date.parse('2026-11-21T12:00:00.000Z'));
    assert.deepEqual(sessionCache.changedFolders(opencode), ['opencode/p1']);

    // A project whose last session is gone is no longer listed by OpenCode,
    // but the cache still knows it, and it has to be refreshed to be dropped.
    oc.db.prepare('DELETE FROM session_v2 WHERE id = ?').run('ses_b');
    assert.deepEqual(sessionCache.changedFolders(opencode).sort(), ['opencode/p1', 'opencode/p2']);

    // A project OpenCode starts after the last pass is new to the cache.
    oc.addSession('ses_c', { project: 'p3' });
    assert.ok(sessionCache.changedFolders(opencode).includes('opencode/p3'));
  } finally {
    oc.cleanup();
  }
});

test('the database and its write-ahead log are what to watch', () => {
  const oc = setUpOpencode();
  try {
    assert.deepEqual(opencode.watchPaths(), [process.env.OPENCODE_DB, process.env.OPENCODE_DB + '-wal']);
  } finally {
    oc.cleanup();
  }
});

test('an OpenCode database that cannot be read leaves the cache as it was', () => {
  const oc = setUpOpencode();
  try {
    oc.addSession('ses_a');
    oc.fake();
    sessionCache.reconcileCacheFromFilesystem();
    assert.deepEqual(oc.rows.map(r => r.sessionId), ['ses_a']);

    // Replaced by something that is not a database (a broken copy, a lock).
    oc.db.close();
    opencode.closeDb();
    fs.writeFileSync(process.env.OPENCODE_DB, 'garbage '.repeat(500));
    const after = oc.fake();
    sessionCache.reconcileCacheFromFilesystem();
    assert.throws(() => sessionCache.refreshFolder('opencode/p1'));
    assert.deepEqual(after.deletedFolders, []);
    assert.deepEqual(after.deleted, []);
    assert.deepEqual(oc.rows.map(r => r.sessionId), ['ses_a']);
  } finally {
    oc.cleanup();
  }
});
