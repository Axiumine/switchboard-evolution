const { app, BrowserWindow, clipboard, dialog, ipcMain, Menu, powerSaveBlocker, protocol, safeStorage, screen, shell, ShareMenu } = require('electron');
// Capture every IPC handler as it is registered, so the remote-access server
// can call the same functions. Must run before the first registration below.
require('./ipc-registry').install(ipcMain);
const { addSink, emit } = require('./broadcast');
const { getHandler } = require('./ipc-registry');
const nacl = require('tweetnacl');
const qrcode = require('qrcode-generator');
const { createRemoteProtocol } = require('./remote-protocol');
const { createRemoteAuth } = require('./remote-auth');
const { createRemoteApi } = require('./remote-api');
const { createRemoteServer, reachableAddresses, pairingLink } = require('./remote-server');
const { createRemoteTunnels } = require('./remote-tunnels');
const { sessionStates } = require('./session-states');
const { readTranscriptSince } = require('./transcript-reader');
const { createTerminalFanout } = require('./terminal-fanout');
const { createSessionLauncher } = require('./remote-launch');
const { createSessionNotices } = require('./session-notices');
const { listFolders, createFolder, createPhoneFiles } = require('./remote-files');
const { planLineText } = require('./remote-plan');
const { createRemoteTasks } = require('./remote-tasks');
const { createAttachments } = require('./remote-attachments');
const { keepWindowOnClose, showWindow, createPowerSaveGuard } = require('./window-lifecycle');
const { Worker } = require('worker_threads');
const { execFile } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const pty = require('node-pty');
const log = require('electron-log');
// getFolderIndexMtimeMs moved to session-cache.js
const { startMcpServer, shutdownMcpServer, shutdownAll: shutdownAllMcp, resolvePendingDiff, listPendingDiffs, rekeyMcpServer, cleanStaleLockFiles } = require('./mcp-bridge');
const { fetchAndTransformUsage } = require('./claude-auth');
const { runStatsCommand, refreshStatsCache } = require('./stats-refresh');
const { readHead } = require('./jsonl-scan');
const codexAuth = require('./codex-auth');

// SWITCHBOARD_DATA_DIR isolates a dev/test instance from the installed app:
// db.js puts switchboard.db under it, and pointing userData there gives the
// instance its own single-instance lock (requestSingleInstanceLock keys on
// userData), so both can run side by side.
if (process.env.SWITCHBOARD_DATA_DIR) {
  app.setPath('userData', path.resolve(process.env.SWITCHBOARD_DATA_DIR, 'electron'));
}

log.transports.file.level = app.isPackaged ? 'info' : 'debug';
log.transports.console.level = app.isPackaged ? 'info' : 'debug';

try { require('electron-reloader')(module, { watchRenderer: true }); } catch {};

// Clean env for child processes — strips Electron internals that cause nested
// Electron apps (or node-pty inside them) to malfunction, and pins a UTF-8
// LC_CTYPE when the launch environment has no locale. See pty-env.js.
const { buildPtyEnv } = require('./pty-env');
const cleanPtyEnv = buildPtyEnv(process.env);

// Sessions can run in herdr-core (hc-engine.js), which keeps them alive when
// Switchboard quits; with no hc, or with it turned off, they run here in node-pty.
const { createHcEngine, locateHc, hcSessionName } = require('./hc-engine');
let hcEngine = null;
let terminalEngineStatus = { engine: 'inside', reason: 'starting' };
// Handlers that list or start sessions wait until the ones hc kept are found again.
let sessionsReady = Promise.resolve();
const { shouldStartFresh, shouldBlockArchivedSession } = require('./session-launch');
const { createTerminalActivity } = require('./terminal-activity');

// Shell profiles → shell-profiles.js
const { discoverShellProfiles, getShellProfiles, resolveShell, isWindows, isWslShell, windowsToWslPath, shellArgs, quoteArgvForShell } = require('./shell-profiles');
const { scanSchedules } = require('./schedule-runner');
const { encodeProjectPath } = require('./encode-project-path');
const { resolveEffectiveSettings } = require('./resolve-effective-settings');
const { listProjectDirectory, readProjectFile, readPreviewFile, openFileExternally, resolveProjectEntry } = require('./project-files');
const { manageProjectEntry, revealFile, shareFile, createProjectEntry, duplicateProjectEntry, pasteProjectEntry } = require('./file-management');
const fileTimeline = require('./file-timeline');
const { resolveTerminalFiles } = require('./terminal-file-links');
const { PREVIEW_SCHEME, PREVIEW_SCHEMES, handlePreviewAssetRequest } = require('./preview-assets');
protocol.registerSchemesAsPrivileged(PREVIEW_SCHEMES);
const { createTaskManager } = require('./task-manager');
const { createProcessMonitor } = require('./process-monitor');
const { lastAssistantMessage } = require('./session-preview');


// --- Auto-updater (only in packaged builds that ship an update feed) ---
// A local build made with publish disabled has no app-update.yml, so it skips
// the updater instead of failing every check.
let autoUpdater = null;
if ((app.isPackaged && fs.existsSync(path.join(process.resourcesPath, 'app-update.yml'))) || process.env.FORCE_UPDATER) {
  autoUpdater = require('electron-updater').autoUpdater;
  autoUpdater.logger = log;
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  if (!app.isPackaged) autoUpdater.forceDevUpdateConfig = true;

  function sendUpdaterEvent(type, data) {
    log.info(`[updater] ${type}`, data || '');
    emit('updater-event', type, data);
  }
  autoUpdater.on('checking-for-update', () => sendUpdaterEvent('checking'));
  autoUpdater.on('update-available', (info) => sendUpdaterEvent('update-available', info));
  autoUpdater.on('update-not-available', (info) => sendUpdaterEvent('update-not-available', info));
  autoUpdater.on('download-progress', (progress) => sendUpdaterEvent('download-progress', progress));
  autoUpdater.on('update-downloaded', (info) => sendUpdaterEvent('update-downloaded', info));
  autoUpdater.on('error', (err) => {
    log.error('[updater] Error:', err?.message || String(err));
    emit('updater-event', 'error', { message: err?.message || String(err) });
  });
}
const {
  getMeta, getAllMeta, toggleStar, setName, setArchived,
  isCachePopulated, getAllCached, getCachedByFolder, getCachedSession, upsertCachedSessions,
  updateCachedAiTitle,
  deleteCachedSession, deleteCachedFolder,
  getFolderMeta, getAllFolderMeta, setFolderMeta,
  upsertSearchEntries, updateSearchTitle, deleteSearchSession, deleteSearchFolder, deleteSearchType,
  searchByType, isSearchIndexPopulated, searchFtsRecreated,
  getSetting, setSetting, deleteSetting,
  copySessionAssignment, moveSessionAssignment, rekeyPlanLinks,
  closeDb,
} = require('./db');
const dbModule = require('./db');

const { getHarness, DEFAULT_HARNESS, transcriptPath, availableHarnesses, allHarnesses, progressBusyState,
        harnessForFolder: getHarnessForFolder } = require('./harnesses');
const claudeHarness = getHarness(DEFAULT_HARNESS);
const PROJECTS_DIR = claudeHarness.sessionsRoot();
const PLANS_DIR = path.join(os.homedir(), '.claude', 'plans');
const CLAUDE_DIR = path.join(os.homedir(), '.claude');
const STATS_CACHE_PATH = path.join(CLAUDE_DIR, 'stats-cache.json');
const MAX_BUFFER_SIZE = 256 * 1024;

// Active PTY sessions
const activeSessions = new Map();
let mainWindow = null;
// The desktop window receives every event; see broadcast.js.
addSink((channel, args) => {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, ...args);
});
let appIsQuitting = false;

function createWindow() {
  // Restore saved window bounds
  const savedBounds = getSetting('global')?.windowBounds;
  let bounds = { width: 1400, height: 900 };

  let restorePosition = null;
  if (savedBounds && savedBounds.width && savedBounds.height) {
    bounds.width = savedBounds.width;
    bounds.height = savedBounds.height;

    // Only restore position if it's on a visible display
    if (savedBounds.x != null && savedBounds.y != null) {
      const displays = screen.getAllDisplays();
      const onScreen = displays.some(d => {
        const b = d.bounds;
        return savedBounds.x >= b.x - 100 && savedBounds.x < b.x + b.width &&
               savedBounds.y >= b.y - 100 && savedBounds.y < b.y + b.height;
      });
      if (onScreen) {
        restorePosition = { x: savedBounds.x, y: savedBounds.y };
      }
    }
  }

  // A build with a name of its own (OmniboardV) shows that name as the window
  // title too; a dev run is called "switchboard" (package.json) and keeps
  // the usual title.
  const windowTitle = app.name && app.name !== 'switchboard' ? app.name : 'Switchboard';
  mainWindow = new BrowserWindow({
    ...bounds,
    minWidth: 800,
    minHeight: 500,
    title: windowTitle,
    icon: path.join(__dirname, 'build', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      nodeIntegrationInSubFrames: false,
      contextIsolation: true,
    },
  });
  // index.html's <title> would rename the window back to "Switchboard".
  if (windowTitle !== 'Switchboard') mainWindow.on('page-title-updated', (event) => event.preventDefault());

  // Set position after creation to prevent macOS from clamping size
  if (restorePosition) {
    mainWindow.setBounds({ ...restorePosition, width: bounds.width, height: bounds.height });
  }

  mainWindow.loadFile(path.join(__dirname, 'public', 'index.html'));

  // Open external links in the system browser instead of a child BrowserWindow
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url).catch(() => {});
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (url !== mainWindow.webContents.getURL()) {
      event.preventDefault();
      if (/^https?:\/\//i.test(url)) shell.openExternal(url).catch(() => {});
    }
  });
  // Override window.open so xterm WebLinksAddon's default handler (which does
  // window.open() then sets location.href) routes through our IPC instead of
  // creating a child BrowserWindow.
  mainWindow.webContents.on('did-finish-load', () => {
    mainWindow.webContents.executeJavaScript(`
      window.open = function(url) {
        if (url && /^https?:\\/\\//i.test(url)) { window.api.openExternal(url); return null; }
        const proxy = {};
        Object.defineProperty(proxy, 'location', { get() {
          const loc = {};
          Object.defineProperty(loc, 'href', {
            set(u) { if (/^https?:\\/\\//i.test(u)) window.api.openExternal(u); }
          });
          return loc;
        }});
        return proxy;
      };
      void 0;
    `);
  });

  // Prevent Cmd+R / Ctrl+Shift+R from reloading the page (Chromium built-in).
  // Ctrl+R alone on macOS is NOT a reload shortcut and must pass through to xterm
  // for reverse-i-search.
  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return;
    const key = input.key.toLowerCase();
    if (key === 'r' && input.meta) event.preventDefault();
    if (key === 'r' && input.control && input.shift) event.preventDefault();
  });

  // Save window bounds on move/resize (debounced)
  let boundsTimer = null;
  const saveBounds = () => {
    if (boundsTimer) clearTimeout(boundsTimer);
    boundsTimer = setTimeout(() => {
      if (!mainWindow || mainWindow.isDestroyed() || mainWindow.isMinimized()) return;
      const b = mainWindow.getBounds();
      const global = getSetting('global') || {};
      global.windowBounds = { x: b.x, y: b.y, width: b.width, height: b.height };
      setSetting('global', global);
    }, 500);
  };
  mainWindow.on('resize', saveBounds);
  mainWindow.on('move', saveBounds);

  // Also save immediately before close (debounce may not have flushed)
  mainWindow.on('close', () => {
    if (boundsTimer) clearTimeout(boundsTimer);
    if (!mainWindow.isMinimized()) {
      const b = mainWindow.getBounds();
      const global = getSetting('global') || {};
      global.windowBounds = { x: b.x, y: b.y, width: b.width, height: b.height };
      setSetting('global', global);
    }
  });
  // With remote access on, closing on macOS only hides the window.
  keepWindowOnClose(mainWindow, {
    platform: process.platform,
    keepAlive: () => remoteServer.status().running,
    isQuitting: () => appIsQuitting,
    onVisibility: (visible) => emit('window-visibility', visible),
  });

  mainWindow.on('closed', () => {
    // On macOS the app stays alive in the dock after the last window closes.
    // Kill all running PTY processes so orphaned `claude` processes don't
    // accumulate in the background with no way for the user to interact.
    // Sessions in herdr-core are meant to outlive the window: they keep
    // running and stay attached, and the next window picks them up.
    for (const [id, session] of activeSessions) {
      if (session.pty?.detach) continue;
      if (!session.exited) {
        try { session.pty.kill(); } catch {}
      }
      activeSessions.delete(id);
    }
    taskManager.shutdown();
    for (const win of [...toolWindows.values(), ...projectWindows.values()]) if (!win.isDestroyed()) win.close();
    mainWindow = null;
  });
}

/** The explicit way out for sessions that would otherwise outlive Switchboard in herdr-core. */
async function quitStoppingSessions() {
  const running = [...new Set(activeSessions.values())].filter(s => !s.exited);
  if (running.length) {
    const { response } = await dialog.showMessageBox(mainWindow && !mainWindow.isDestroyed() ? mainWindow : undefined, {
      type: 'warning',
      buttons: ['Stop All and Quit', 'Cancel'],
      defaultId: 1,
      cancelId: 1,
      message: `Stop ${running.length} running session${running.length === 1 ? '' : 's'} and quit?`,
      detail: hcEngine ? 'A plain Quit leaves them running in herdr-core, to pick up on the next start.' : 'Quitting stops them either way.',
    });
    if (response !== 0) return;
    const stops = running.map(session => {
      session.stopRequested = true;
      try { return session.pty.kill(); } catch { return null; }
    });
    // hc ends them on its side; wait for the requests to go out before the connection closes.
    await Promise.race([Promise.allSettled(stops), new Promise(r => setTimeout(r, 3000))]);
  }
  app.quit();
}

function buildMenu() {
  const template = [
    {
      label: app.name,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { label: 'Quit and Stop All Sessions…', click: () => { quitStoppingSessions(); } },
        { role: 'quit' },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
      ],
    },
    {
      label: 'View',
      submenu: [
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// --- Session cache helpers ---

const { deriveProjectPath } = claudeHarness;

// Session cache → session-cache.js
const sessionCache = require('./session-cache');
const { SessionIndexer } = require('./session-indexer');
const sessionIndexer = new SessionIndexer({
  projectsDir: PROJECTS_DIR,
  onStatus: (text, type) => sessionCache.sendStatus(text, type),
  onChanged: () => sessionCache.notifyRendererProjectsChanged('sessions'),
  onError: err => log.error('[indexer]', err),
});
sessionCache.init({
  indexer: sessionIndexer,
  PROJECTS_DIR,
  activeSessions,
  log,
  db: {
    deleteCachedFolder, getCachedByFolder, getCachedSession, upsertCachedSessions, deleteCachedSession,
    deleteSearchFolder, deleteSearchSession, upsertSearchEntries,
    setFolderMeta, getAllFolderMeta, getAllMeta, getAllCached, getSetting, setSetting, getMeta, setName,
    updateCachedAiTitle, updateSearchTitle,
  },
});
const { refreshFolder, reconcileCacheFromFilesystem, buildProjectsFromCache,
        notifyRendererProjectsChanged, sendStatus, populateCacheViaWorker,
        refreshHarnessTitles, initializeHiddenProjectTimestamps } = sessionCache;

// --- Projects (a piece of work with a folder on disk) ---
const projects = require('./projects');
projects.init({
  db: dbModule,
  log,
  buildProjectsFromCache,
  notifyRendererProjectsChanged,
  isHarnessId: (id) => allHarnesses().some(h => h.id === id),
  plansDir: PLANS_DIR,
});
// --- Git Graph tab: service + SSRF-safe avatar cache ---
const gitGraphService = require('./git-graph-service');
const gitGraphAvatars = require('./git-graph-avatars');
// What of the Git Graph a paired phone may use.
require('./remote-git-graph');
// What of the Worktrees tab a paired phone may use.
require('./remote-worktrees');
// What of the Task Manager a paired phone may use.
const { isOwner: isProcessOwner } = require('./remote-process-usage');
// Mirrors db.js's own DATA_DIR resolution (SWITCHBOARD_DATA_DIR override,
// else ~/.switchboard) without depending on db.js's internals.
const GIT_GRAPH_DATA_DIR = process.env.SWITCHBOARD_DATA_DIR
  ? path.resolve(process.env.SWITCHBOARD_DATA_DIR)
  : path.join(os.homedir(), '.switchboard');
gitGraphAvatars.init({
  dataDir: path.join(GIT_GRAPH_DATA_DIR, 'git-graph-avatars'),
  log,
});
gitGraphService.init({ db: dbModule, log, send: emit });

// An upgrade can change the working rules in the brief. Bring every project's
// managed blocks up to date once at startup; unchanged files are not written.
projects.syncAllProjectBriefs().catch(err => log.error('[projects] brief sync failed:', err?.message || String(err)));
// Watch every project's plan-tracker.md and todos.md so a tick made by a
// session is credited to it and the page refreshes.
projects.initPlanWatch({ activeSessions, send: emit });

// --- IPC: browse-folder ---
ipcMain.handle('browse-folder', async (event) => {
  // On the window that asked: a project's Settings can be in a window of its own.
  const result = await dialog.showOpenDialog(BrowserWindow.fromWebContents(event.sender) || mainWindow, {
    properties: ['openDirectory', 'createDirectory'],
    title: 'Select Project Folder',
  });
  if (result.canceled || !result.filePaths.length) return null;
  return result.filePaths[0];
});

// --- IPC: add-project ---
ipcMain.handle('add-project', async (_event, projectPath) => {
  try {
    // Validate the path exists and is a directory
    const stat = fs.statSync(projectPath);
    if (!stat.isDirectory()) return { error: 'Path is not a directory' };

    // Unhide if previously hidden
    const global = getSetting('global') || {};
    if (global.hiddenProjects && global.hiddenProjects.includes(projectPath)) {
      global.hiddenProjects = global.hiddenProjects.filter(p => p !== projectPath);
      if (global.hiddenProjectTimestamps) {
        delete global.hiddenProjectTimestamps[projectPath];
      }
      setSetting('global', global);
    }

    // Create the corresponding folder in ~/.claude/projects/ so it persists
    const folder = encodeProjectPath(projectPath);
    const folderPath = path.join(PROJECTS_DIR, folder);
    if (!fs.existsSync(folderPath)) {
      fs.mkdirSync(folderPath, { recursive: true });
    }

    // Seed a minimal .jsonl so deriveProjectPath can read the cwd
    if (!fs.readdirSync(folderPath).some(f => f.endsWith('.jsonl'))) {
      const seedId = require('crypto').randomUUID();
      const seedFile = path.join(folderPath, seedId + '.jsonl');
      const now = new Date().toISOString();
      const line = JSON.stringify({ type: 'user', cwd: projectPath, sessionId: seedId, uuid: require('crypto').randomUUID(), timestamp: now, message: { role: 'user', content: 'New project' } });
      fs.writeFileSync(seedFile, line + '\n');
    }

    // Immediately index the new folder so it's in cache before frontend renders
    await refreshFolder(folder);
    notifyRendererProjectsChanged();

    return { ok: true, folder, projectPath };
  } catch (err) {
    return { error: err.message };
  }
});

// --- IPC: remove-project ---
ipcMain.handle('remove-project', (_event, projectPath) => {
  try {
    // Add to hidden projects list
    const global = getSetting('global') || {};
    const hidden = global.hiddenProjects || [];
    if (!hidden.includes(projectPath)) hidden.push(projectPath);
    global.hiddenProjects = hidden;
    global.hiddenProjectTimestamps = {
      ...(global.hiddenProjectTimestamps || {}),
      [projectPath]: Date.now(),
    };
    setSetting('global', global);

    // Clean up DB cache and search index for this folder
    const folder = encodeProjectPath(projectPath);
    deleteCachedFolder(folder);
    deleteSearchFolder(folder);
    deleteSetting('project:' + projectPath);

    notifyRendererProjectsChanged();
    return { ok: true };
  } catch (err) {
    return { error: err.message };
  }
});

// --- IPC: projects ---
// Every mutating handler notifies the renderer itself (projects.js), so both
// the Sessions and the Projects tab refresh from one event.
function guarded(fn) {
  return async (_event, ...args) => {
    try { return await fn(...args); } catch (err) {
      log.error('[projects]', err);
      return { error: err.message };
    }
  };
}
ipcMain.handle('get-project-tree', guarded((showArchived) => {
  // Mirrors get-projects: until the cache is populated there is nothing to
  // file, and the renderer is told via projects-changed once there is.
  if (!isCachePopulated() || !isSearchIndexPopulated()) return { projects: [] };
  return projects.buildProjectTree(!!showArchived);
}));
ipcMain.handle('create-project', guarded((spec) => projects.createProject(spec || {})));
ipcMain.handle('update-project', guarded((id, patch) => projects.updateProject(id, patch || {})));
ipcMain.handle('delete-project', guarded((id) => projects.deleteProject(id)));
ipcMain.handle('attach-project-folder', guarded((id, spec) => projects.attachFolder(id, spec || {})));
ipcMain.handle('detach-project-folder', guarded((id, folderPath, opts) => projects.detachFolder(id, folderPath, opts || {})));
ipcMain.handle('set-session-assignment', guarded((sessionId, projectId, trackId) => {
  const cleanProjectId = projectId || null;
  const cleanTrackId = trackId || null;
  const result = projects.assignSession(sessionId, cleanProjectId, cleanTrackId);
  // Raw terminals have no transcript to rehydrate this relationship from.
  // Keep the live PTY metadata aligned with the durable renderer descriptor so
  // a renderer reload cannot put a moved terminal back in its old location.
  if (!result?.error) {
    const session = activeSessions.get(sessionId);
    if (session?.isPlainTerminal) {
      session.projectId = cleanProjectId;
      session.trackId = cleanProjectId ? cleanTrackId : null;
    }
  }
  return result;
}));
// Scheduled tasks. The tick that fires them is startScheduleTicker below.
ipcMain.handle('list-schedules', guarded(() => projects.listSchedules()));
ipcMain.handle('create-schedule', guarded((spec) => projects.createSchedule(spec || {})));
ipcMain.handle('update-schedule', guarded((id, patch) => projects.updateSchedule(id, patch || {})));
ipcMain.handle('delete-schedule', guarded((id) => projects.deleteSchedule(id)));
ipcMain.handle('resolve-schedule-launch', guarded((id) => projects.resolveScheduleLaunch(id)));
ipcMain.handle('get-schedule-context', guarded((spec) => projects.resolveScheduleContext(spec || {})));
ipcMain.handle('create-track', guarded((projectId, spec) => projects.createTrack(projectId, spec || {})));
ipcMain.handle('update-track', guarded((id, patch) => projects.updateTrack(id, patch || {})));
ipcMain.handle('delete-track', guarded((id, options = {}) => {
  const track = dbModule.getTrack(id);
  if (!track) return { error: 'Track not found' };
  const archiveSessions = options.archiveSessions === true;
  // Raw terminals have no transcript row, but participate in track deletion.
  for (const [sid, session] of activeSessions) {
    if (session.trackId === id && session.isPlainTerminal) dbModule.setSessionAssignment(sid, track.projectId, id);
  }
  const result = projects.deleteTrack(id, { archiveSessions });
  if (result.error) return result;
  const affected = new Set(result.sessionIds);
  for (const [sid, session] of activeSessions) {
    if (session.trackId !== id && !affected.has(sid)) continue;
    session.trackId = null;
    session.formerTrackName = track.name;
    if (archiveSessions && !session.exited) {
      session.stopRequested = true;
      try { session.pty.kill(); } catch (error) { log.error('[delete-track] stop failed', error); }
    }
  }
  return result;
}));
ipcMain.handle('get-projects-root', guarded(() => projects.projectsRoot()));
ipcMain.handle('get-project-git-status', guarded((id, opts) => projects.folderGitStatus(id, opts || {})));
ipcMain.handle('get-project-git-info', guarded((id) => projects.projectGitInfo(id)));
ipcMain.handle('get-project-git-diff', guarded((id, folderPath, filePath) => projects.projectGitDiff(id, folderPath, filePath)));
ipcMain.handle('get-folder-git-status', guarded((folderPath) => projects.folderGitInfo(String(folderPath || ''))));

// --- IPC: Git Graph tab ---
// Every handler delegates one line into projects.js, same shape as the four
// git handlers above; projects.js re-checks the attached-folder boundary.
ipcMain.handle('get-project-git-graph', guarded((id, folderPath, opts) => projects.projectGitGraph(id, String(folderPath || ''), opts || {})));
ipcMain.handle('get-git-graph-commit-detail', guarded((id, folderPath, hash) => projects.projectGitGraphCommitDetail(id, String(folderPath || ''), hash)));
ipcMain.handle('get-git-graph-compare-detail', guarded((id, folderPath, fromHash, toHash) => projects.projectGitGraphCompareDetail(id, String(folderPath || ''), fromHash, toHash)));
ipcMain.handle('get-git-graph-file-at-revision', guarded((id, folderPath, rev, filePath) => projects.projectGitGraphFileAtRevision(id, String(folderPath || ''), rev, filePath)));
ipcMain.handle('get-git-graph-file-diff-between', guarded((id, folderPath, fromRev, toRevOrNull, filePath) => projects.projectGitGraphFileDiffBetween(id, String(folderPath || ''), fromRev, toRevOrNull, filePath)));
ipcMain.handle('get-git-graph-repo-config', guarded((id, folderPath) => projects.projectGitGraphRepoConfig(id, String(folderPath || ''))));
ipcMain.handle('set-git-graph-repo-config', guarded((id, folderPath, patch) => projects.setProjectGitGraphRepoConfig(id, String(folderPath || ''), patch || {})));
ipcMain.handle('trust-git-graph-repo-config', guarded((id, folderPath, trusted) => projects.trustProjectGitGraphRepoConfig(id, String(folderPath || ''), !!trusted)));
// avatarsSelfHostedGitLabHost sends this repo's commit-author email
// addresses to whatever host it names, so — unlike every other repo setting,
// which round-trips through the generic set-git-graph-repo-config channel —
// it is only ever written after a real dialog, shown by this process and
// naming the exact host, that the renderer cannot fake or skip.
ipcMain.handle('confirm-git-graph-avatars-gitlab-host', guarded(async (id, folderPath, host) => {
  if (host !== null && typeof host === 'string' && host.trim()) {
    const choice = await dialog.showMessageBox(mainWindow, {
      type: 'question',
      buttons: ['Cancel', 'Confirm'],
      defaultId: 0,
      cancelId: 0,
      title: 'Confirm Self-Hosted GitLab Host',
      message: `Send this repository's commit author email addresses to "${host}" for avatar lookup?`,
      detail: 'Only confirm this for a self-hosted GitLab instance you trust — every avatar lookup for this repository will contact this host from now on.',
    });
    if (choice.response !== 1) return { cancelled: true };
  }
  return projects.setProjectGitGraphAvatarsSelfHostedGitLabHost(id, String(folderPath || ''), host || null);
}));
ipcMain.handle('export-git-graph-repo-config', guarded((id, folderPath) => projects.exportProjectGitGraphRepoConfig(id, String(folderPath || ''))));
ipcMain.handle('get-git-graph-user-details', guarded((id, folderPath) => projects.projectGitGraphUserDetails(id, String(folderPath || ''))));
ipcMain.handle('get-git-graph-global-preferences', guarded(() => gitGraphService.getGitGraphGlobalPreferences()));
ipcMain.handle('set-git-graph-global-preferences', guarded((patch) => gitGraphService.setGitGraphGlobalPreferences(patch || {})));
ipcMain.handle('get-git-graph-remotes', guarded((id, folderPath) => projects.projectGitGraphRemotes(id, String(folderPath || ''))));
ipcMain.handle('get-git-graph-tag-details', guarded((id, folderPath, tagName) => projects.projectGitGraphTagDetails(id, String(folderPath || ''), tagName)));
ipcMain.handle('get-git-graph-avatar-url', guarded((id, folderPath, email) => projects.projectGitGraphAvatarUrl(id, String(folderPath || ''), email)));
ipcMain.handle('clear-git-graph-avatar-cache', guarded(() => gitGraphAvatars.clearCache()));
// The single generic whitelisted-action dispatcher — actionId is
// looked up in git-actions.js's ACTIONS table, never a dynamic property/
// function-name lookup off the renderer's string.
ipcMain.handle('run-git-graph-action', guarded((id, folderPath, actionId, params) => projects.runProjectGitGraphAction(id, String(folderPath || ''), String(actionId || ''), params || {})));
ipcMain.handle('cancel-git-graph-action', guarded((id, folderPath, actionId) => projects.cancelProjectGitGraphAction(id, String(folderPath || ''), String(actionId || ''))));
// Create Archive's destination is never taken from the renderer: this shows
// the real native Save dialog itself and only ever hands createArchive the
// path *it* returned, the same way any other "Save As" in the app works —
// the renderer only supplies the ref being archived and a suggested filename.
ipcMain.handle('save-git-graph-archive', guarded(async (id, folderPath, opts = {}) => {
  const suggestedName = String(opts.suggestedName || 'archive').replace(/[\\/]/g, '-');
  const result = await dialog.showSaveDialog(mainWindow, {
    title: 'Create Archive',
    defaultPath: `${suggestedName}.zip`,
    filters: [
      { name: 'Zip Archive', extensions: ['zip'] },
      { name: 'Tar Archive', extensions: ['tar'] },
    ],
  });
  if (result.canceled || !result.filePath) return { cancelled: true };
  const format = path.extname(result.filePath).toLowerCase() === '.tar' ? 'tar' : 'zip';
  return projects.runProjectGitGraphAction(id, String(folderPath || ''), 'createArchive', {
    ref: opts.ref, refType: opts.refType, remote: opts.remote, format, absPath: result.filePath,
  });
}));
// The .env files a folder has, and the ones the dialog ticks by default,
// so a new worktree can be offered its repository's local environment.
ipcMain.handle('list-env-files', guarded((folderPath) => ({
  ok: true,
  files: projects.listEnvFiles(String(folderPath || '')),
  defaults: projects.defaultEnvSelection(String(folderPath || '')),
})));
ipcMain.handle('save-project-brief', guarded((id, content) => projects.saveBrief(id, content)));
ipcMain.handle('create-project-file', guarded((id, name, content) => projects.createProjectFile(id, name, content)));
ipcMain.handle('add-project-files', guarded((id, sourcePaths) => projects.addProjectFiles(id, sourcePaths)));
ipcMain.handle('list-recent-project-files', guarded((id) => projects.listRecentProjectFiles(id)));
ipcMain.handle('get-project-plan', guarded((id) => projects.readProjectPlan(id)));
// Every client hears of an edit, wherever it was made; the window redraws only what moved.
const planEdited = (id, result) => { if (result?.ok) emit('project-plan-changed', id); return result; };
ipcMain.handle('set-plan-item', guarded((id, kind, line, done) => planEdited(id, projects.setPlanItem(id, kind, line, done))));
ipcMain.handle('append-plan-item', guarded((id, kind, text) => planEdited(id, projects.appendPlanItem(id, kind, text))));
ipcMain.handle('edit-plan-item', guarded((id, kind, line, text) => planEdited(id, projects.editPlanItem(id, kind, line, text))));
ipcMain.handle('adopt-plan', guarded((id, filename, opts) => projects.adoptPlan(id, filename, opts || {})));
ipcMain.handle('list-templates', guarded(() => projects.listTemplates()));

// --- IPC: Worktrees tab ---
// worktrees.js checks every path against the project's repositories itself.
const worktrees = require('./worktrees');
worktrees.init({ db: dbModule, log, projects });
const wtPath = (value) => String(value || '');
ipcMain.handle('get-project-worktrees', guarded((id) => worktrees.listProjectWorktrees(id)));
ipcMain.handle('get-worktree-settings', guarded((id) => worktrees.getSettings(id)));
ipcMain.handle('set-worktree-settings', guarded((id, patch) => worktrees.setSettings(id, patch || {})));
ipcMain.handle('list-worktree-branches', guarded((id, repoPath) => worktrees.listRepoBranches(id, wtPath(repoPath))));
ipcMain.handle('suggest-worktree-path', guarded((id, repoPath, ref) => worktrees.suggestWorktreePath(id, wtPath(repoPath), String(ref || ''))));
ipcMain.handle('worktree-create', guarded((id, spec) => worktrees.createWorktree(id, spec || {})));
ipcMain.handle('worktree-run-post-create', guarded((id, worktreePath) => worktrees.runPostCreate(id, wtPath(worktreePath))));
ipcMain.handle('worktree-remove', guarded((id, worktreePath, opts) => worktrees.removeWorktree(id, wtPath(worktreePath), opts || {})));
ipcMain.handle('worktree-delete-branch', guarded((id, repoPath, branch, opts) => worktrees.deleteBranch(id, wtPath(repoPath), String(branch || ''), opts || {})));
ipcMain.handle('worktree-merged', guarded((id, repoPath, base) => worktrees.mergedWorktrees(id, wtPath(repoPath), String(base || ''))));
ipcMain.handle('worktree-lock', guarded((id, worktreePath, reason) => worktrees.lockWorktree(id, wtPath(worktreePath), String(reason || ''))));
ipcMain.handle('worktree-unlock', guarded((id, worktreePath) => worktrees.unlockWorktree(id, wtPath(worktreePath))));
ipcMain.handle('worktree-move', guarded((id, worktreePath, newPath) => worktrees.moveWorktree(id, wtPath(worktreePath), wtPath(newPath))));
ipcMain.handle('worktree-repair', guarded((id, repoPath, paths) => worktrees.repairWorktrees(id, wtPath(repoPath), Array.isArray(paths) ? paths.map(String) : [])));
ipcMain.handle('worktree-prune-preview', guarded((id, repoPath) => worktrees.prunePreview(id, wtPath(repoPath))));
ipcMain.handle('worktree-prune', guarded((id, repoPath, opts) => worktrees.pruneWorktrees(id, wtPath(repoPath), opts || {})));
ipcMain.handle('worktree-attach', guarded((id, worktreePath) => worktrees.attachToProject(id, wtPath(worktreePath))));
ipcMain.handle('worktree-detach', guarded((id, worktreePath) => worktrees.detachFromProject(id, wtPath(worktreePath))));

// --- IPC: get-projects ---
ipcMain.handle('open-external', (_event, url) => {
  log.info('[open-external IPC]', url);
  if (/^https?:\/\//i.test(url)) return shell.openExternal(url);
});

// Reveal a folder in the OS file manager. Only existing directories, so a
// renderer value can never launch a file.
ipcMain.handle('open-path', async (_event, target) => {
  try {
    const resolved = path.resolve(String(target || ''));
    if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) return { error: 'Not a folder' };
    const err = await shell.openPath(resolved);
    return err ? { error: err } : { ok: true };
  } catch (err) {
    return { error: err.message };
  }
});

// Show a viewer panel's file selected in the OS file manager.
ipcMain.handle('reveal-file', (_event, filePath) => {
  try {
    return { ok: true, ...revealFile(filePath, { shell }) };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

// --- IPC: clipboard write ---
// The renderer's navigator.clipboard.writeText is gated on focus/user-activation and
// is flaky-to-dead on Linux/Wayland (Ozone). The main-process clipboard has no such
// strings attached, so all terminal copies go through here.
ipcMain.handle('clipboard-write-text', (_event, text) => {
  if (typeof text === 'string') clipboard.writeText(text);
});

// --- IPC: MCP bridge ---
ipcMain.handle('mcp-diff-response', (_event, sessionId, diffId, action, editedContent) =>
  resolvePendingDiff(sessionId, diffId, action, editedContent));

ipcMain.handle('resolve-terminal-files', (_event, references, context) => resolveTerminalFiles(references, context));

ipcMain.handle('open-file-externally', async (_event, filePath, projectRoot) => {
  try {
    return { ok: true, ...await openFileExternally(filePath, projectRoot, shell) };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

// Share a viewer panel's file through the macOS share menu (AirDrop, Mail,
// Messages and any app with a share extension). Other systems have no such menu.
ipcMain.handle('share-file', (event, filePath) => {
  try {
    if (process.platform !== 'darwin') throw new Error('Sharing files is only available on macOS');
    const window = BrowserWindow.fromWebContents(event.sender);
    return { ok: true, ...shareFile(filePath, { share: file => new ShareMenu({ filePaths: [file] }).popup({ window }) }) };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('read-file-for-panel', async (_event, filePath) => {
  try {
    return { ok: true, ...readPreviewFile(filePath) };
  } catch (err) {
    return { ok: false, error: err.message, code: err.code };
  }
});

ipcMain.handle('list-project-directory', async (_event, projectPath, relativePath) => {
  try {
    return { ok: true, entries: listProjectDirectory(projectPath, relativePath) };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('manage-project-entry', async (_event, projectPath, relativePath, action, newName) => {
  try {
    const result = await manageProjectEntry(projectPath, relativePath, action, newName, {
      shell,
      confirmTrash: async (filePath, isDirectory) => {
        const destination = process.platform === 'win32' ? 'Recycle Bin' : 'Trash';
        const choice = await dialog.showMessageBox(mainWindow, {
          type: 'question',
          message: `Move "${path.basename(filePath)}" to the ${destination}?`,
          detail: `${isDirectory ? 'The folder and its contents' : 'The file'} can be restored from the ${destination}. Open previews of this item will close; unsaved edits will be discarded.`,
          buttons: ['Cancel', `Move to ${destination}`], defaultId: 0, cancelId: 0,
          noLink: true,
        });
        return choice.response === 1;
      },
    });
    return { ok: true, ...result };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

// The Files tab's explorer: new file or folder, duplicate, paste a copied or cut entry.
const explorerAction = (fn) => async (_event, ...args) => {
  try {
    return { ok: true, ...await fn(...args) };
  } catch (err) {
    return { ok: false, error: err.message };
  }
};
ipcMain.handle('create-project-entry', explorerAction((projectPath, folderRelative, name, kind) => createProjectEntry(projectPath, folderRelative, name, kind)));
ipcMain.handle('duplicate-project-entry', explorerAction((projectPath, relativePath) => duplicateProjectEntry(projectPath, relativePath)));
ipcMain.handle('paste-project-entry', explorerAction((sourcePath, sourceRelative, targetPath, targetRelative, mode) => pasteProjectEntry(sourcePath, sourceRelative, targetPath, targetRelative, mode)));
ipcMain.handle('get-file-timeline', explorerAction((projectPath, relativePath) => fileTimeline.getFileTimeline(projectPath, relativePath)));
ipcMain.handle('get-file-timeline-diff', explorerAction((projectPath, relativePath, hash, repoPath, oldPath) => fileTimeline.getFileTimelineDiff(projectPath, relativePath, hash, repoPath, oldPath)));
ipcMain.handle('get-file-at-commit', explorerAction((projectPath, relativePath, hash, repoPath) => fileTimeline.getFileAtCommit(projectPath, relativePath, hash, repoPath)));

// "Open With…": a file of a project in an application the user picks (macOS),
// or in the one given (a recent pick). Only an existing file, only an .app.
ipcMain.handle('open-file-with-app', explorerAction(async (filePath, projectRoot, appPath) => {
  if (process.platform !== 'darwin') throw new Error('Open With is only available on macOS');
  if (typeof filePath !== 'string' || !path.isAbsolute(filePath)) throw new Error('File path must be absolute');
  const root = resolveProjectEntry(projectRoot).root;
  const { resolved } = resolveProjectEntry(root, path.relative(root, fs.realpathSync(filePath)));
  if (!fs.statSync(resolved).isFile()) throw new Error('Not a file');
  let app = appPath;
  if (!app) {
    const picked = await dialog.showOpenDialog(mainWindow, {
      title: `Open ${path.basename(resolved)} with`,
      defaultPath: '/Applications',
      buttonLabel: 'Open',
      properties: ['openFile'],
      filters: [{ name: 'Applications', extensions: ['app'] }],
    });
    if (picked.canceled || !picked.filePaths[0]) return { cancelled: true };
    app = picked.filePaths[0];
  }
  if (typeof app !== 'string' || !path.isAbsolute(app) || !/\.app$/i.test(app) || !fs.existsSync(app)) throw new Error('Not an application');
  await new Promise((resolve, reject) => {
    execFile('open', ['-a', app, resolved], (err, _stdout, stderr) => (err ? reject(new Error(String(stderr || err.message).trim())) : resolve()));
  });
  return { appPath: app, appName: path.basename(app, '.app') };
}));

ipcMain.handle('read-project-file', async (_event, projectPath, relativePath) => {
  try {
    return { ok: true, ...readProjectFile(projectPath, relativePath) };
  } catch (err) {
    return { ok: false, error: err.message, code: err.code };
  }
});

ipcMain.handle('save-file-for-panel', async (_event, filePath, content) => {
  try {
    const resolved = path.resolve(filePath);
    if (!fs.existsSync(resolved)) return { ok: false, error: 'File does not exist' };
    fs.writeFileSync(resolved, content, 'utf8');
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

// ── File Watching (for viewer panels) ────────────────────────────────
const fileWatchers = new Map(); // filePath → FSWatcher

ipcMain.handle('watch-file', (_event, filePath) => {
  const resolved = path.resolve(filePath);
  if (fileWatchers.has(resolved)) return { ok: true };
  try {
    let debounce = null;
    const watcher = fs.watch(resolved, (eventType) => {
      if (eventType !== 'change') return;
      if (debounce) clearTimeout(debounce);
      debounce = setTimeout(() => emit('file-changed', resolved), 300);
    });
    fileWatchers.set(resolved, watcher);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('unwatch-file', (_event, filePath) => {
  const resolved = path.resolve(filePath);
  const watcher = fileWatchers.get(resolved);
  if (watcher) {
    watcher.close();
    fileWatchers.delete(resolved);
  }
  return { ok: true };
});

ipcMain.handle('get-projects', (_event, showArchived) => {
  try {
    const needsPopulate = !sessionIndexer.initialComplete && (!isCachePopulated() || !isSearchIndexPopulated());

    if (needsPopulate) {
      populateCacheViaWorker();
      return [];
    }

    // Pick up folders changed while the app was closed, or never indexed by an
    // older build, so sessions/worktrees don't silently go missing. Stat-gated,
    // so it's cheap when nothing has changed.
    reconcileCacheFromFilesystem();
    // Backstop for a dropped fs.watch event: a session waiting for its
    // transcript would otherwise stay stuck under its temporary id. Only runs
    // while something is actually waiting.
    if (hasPendingLaunches()) sweepPendingLaunches();
    return buildProjectsFromCache(showArchived);
  } catch (err) {
    console.error('Error listing projects:', err);
    return [];
  }
});

// --- IPC: get-plans ---
ipcMain.handle('get-plans', () => {
  try {
    if (!fs.existsSync(PLANS_DIR)) return [];
    const files = fs.readdirSync(PLANS_DIR).filter(f => f.endsWith('.md'));
    const plans = [];
    for (const file of files) {
      const filePath = path.join(PLANS_DIR, file);
      try {
        const stat = fs.statSync(filePath);
        const content = fs.readFileSync(filePath, 'utf8');
        const firstLine = content.split('\n').find(l => l.trim());
        const title = firstLine && firstLine.startsWith('# ')
          ? firstLine.slice(2).trim()
          : file.replace(/\.md$/, '');
        plans.push({ filename: file, title, modified: stat.mtime.toISOString() });
      } catch {}
    }
    plans.sort((a, b) => new Date(b.modified) - new Date(a.modified));

    // Index plans for FTS
    try {
      deleteSearchType('plan');
      upsertSearchEntries(plans.map(p => ({
        id: p.filename, type: 'plan', folder: null,
        title: p.title,
        body: fs.readFileSync(path.join(PLANS_DIR, p.filename), 'utf8'),
      })));
    } catch {}

    return plans;
  } catch (err) {
    console.error('Error reading plans:', err);
    return [];
  }
});

// --- IPC: read-plan ---
ipcMain.handle('read-plan', (_event, filename) => {
  try {
    const filePath = path.join(PLANS_DIR, path.basename(filename));
    const content = fs.readFileSync(filePath, 'utf8');
    return { content, filePath };
  } catch (err) {
    console.error('Error reading plan:', err);
    return { content: '', filePath: '' };
  }
});

// --- IPC: save-plan ---
ipcMain.handle('save-plan', (_event, filePath, content) => {
  try {
    const resolved = path.resolve(filePath);
    if (!resolved.startsWith(PLANS_DIR)) {
      return { ok: false, error: 'path outside plans directory' };
    }
    fs.writeFileSync(resolved, content, 'utf8');
    return { ok: true };
  } catch (err) {
    console.error('Error saving plan:', err);
    return { ok: false, error: err.message };
  }
});

// --- IPC: get-stats ---
ipcMain.handle('get-stats', () => {
  if (!harnessEnabled(DEFAULT_HARNESS)) return null;
  try {
    if (!fs.existsSync(STATS_CACHE_PATH)) return null;
    const raw = fs.readFileSync(STATS_CACHE_PATH, 'utf8');
    return JSON.parse(raw);
  } catch (err) {
    console.error('Error reading stats cache:', err);
    return null;
  }
});

// --- IPC: refresh-stats ---
let statsRefreshInFlight = null;
ipcMain.handle('refresh-stats', async () => {
  if (!harnessEnabled(DEFAULT_HARNESS)) return { stats: null, usage: {} };
  if (statsRefreshInFlight) return statsRefreshInFlight;

  statsRefreshInFlight = (async () => {
    const usagePromise = fetchAndTransformUsage().catch(() => ({}));
    const result = await refreshStatsCache(STATS_CACHE_PATH, () => {
      const globalSettings = getSetting('global') || {};
      const profile = resolveShell(globalSettings.shellProfile || SETTING_DEFAULTS.shellProfile);
      return runStatsCommand({
        spawn: (...args) => pty.spawn(...args),
        shell: profile.path,
        args: shellArgs(profile.path, 'claude "/stats"', profile.args || []),
        options: {
          name: 'xterm-256color', cols: 120, rows: 40, cwd: os.homedir(),
          env: {
            ...cleanPtyEnv,
            TERM: 'xterm-256color', COLORTERM: 'truecolor',
            TERM_PROGRAM: 'iTerm.app', TERM_PROGRAM_VERSION: '3.6.6',
            FORCE_COLOR: '3', ITERM_SESSION_ID: '1',
          },
        },
      });
    });
    if (result.statsError) log.warn('Error refreshing stats:', result.statsError);
    return { ...result, usage: await usagePromise || {} };
  })();
  try { return await statsRefreshInFlight; }
  finally { statsRefreshInFlight = null; }
});

// --- IPC: get-usage (lightweight, API-only, no PTY) ---
ipcMain.handle('get-usage', async () => {
  if (!harnessEnabled(DEFAULT_HARNESS)) return {};
  try {
    return await fetchAndTransformUsage() || {};
  } catch (err) {
    log.error('Error fetching usage:', err);
    return {};
  }
});

// --- IPC: get-codex-usage --- (same idea for the codex account)
ipcMain.handle('get-codex-usage', async () => {
  // Nothing is fetched for a CLI the user switched off, or one that was never
  // signed in — no request, no error surfaced.
  if (!harnessEnabled('codex')) return {};
  try {
    return await codexAuth.fetchAndTransformUsage() || {};
  } catch (err) {
    log.error('Error fetching codex usage:', err);
    return {};
  }
});

// --- IPC: get-memories ---
function folderToShortPath(folder) {
  // Convert "-Users-me-dev-my-app" → "dev/my-app"
  const parts = folder.replace(/^-/, '').split('-');
  const meaningful = parts.filter(Boolean);
  return meaningful.slice(-2).join('/');
}

/** Scan a directory for .md files (non-recursive). Returns array of { filename, filePath, modified }. */
function scanMdFiles(dir) {
  const results = [];
  try {
    if (!fs.existsSync(dir)) return results;
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const e of entries) {
      if (e.isFile() && e.name.endsWith('.md')) {
        const fp = path.join(dir, e.name);
        const content = fs.readFileSync(fp, 'utf8').trim();
        if (content) {
          const stat = fs.statSync(fp);
          results.push({ filename: e.name, filePath: fp, modified: stat.mtime.toISOString() });
        }
      }
    }
  } catch {}
  return results;
}

ipcMain.handle('get-memories', () => {
  const global = getSetting('global') || {};
  const hiddenProjects = new Set(global.hiddenProjects || []);

  // --- Global files ---
  const globalFiles = scanMdFiles(CLAUDE_DIR).map(f => ({ ...f, displayPath: '~/.claude' }));

  // --- Per-project files ---
  const projects = [];
  try {
    if (fs.existsSync(PROJECTS_DIR)) {
      const folders = fs.readdirSync(PROJECTS_DIR, { withFileTypes: true })
        .filter(d => d.isDirectory() && d.name !== '.git')
        .map(d => d.name);

      for (const folder of folders) {
        const folderPath = path.join(PROJECTS_DIR, folder);
        const projectPath = deriveProjectPath(folderPath, folder);
        if (projectPath && hiddenProjects.has(projectPath)) continue;

        // Use same 2-deep short path as Sessions tab (e.g. "dev/my-app")
        // Splits on both separators — `cwd` is backslash-separated on Windows,
        // where splitting on '/' alone left the whole path as one segment.
        const shortName = projectPath
          ? projectPath.split(/[\\/]/).filter(Boolean).slice(-2).join('/')
          : folderToShortPath(folder);
        const files = [];
        const seenPaths = new Set();

        // 1. ~/.claude/projects/{folder}/ — claude-home .md files
        const claudeHomeFiles = scanMdFiles(folderPath);
        for (const f of claudeHomeFiles) {
          files.push({ ...f, displayPath: '~/.claude', source: 'claude-home' });
          seenPaths.add(f.filePath);
        }
        // memory/MEMORY.md
        const memoryDir = path.join(folderPath, 'memory');
        const memoryFiles = scanMdFiles(memoryDir);
        for (const f of memoryFiles) {
          files.push({ ...f, displayPath: '~/.claude', source: 'claude-home' });
          seenPaths.add(f.filePath);
        }

        // 2. {projectPath}/ — project root CLAUDE.md, agents.md
        if (projectPath) {
          for (const name of ['CLAUDE.md', 'GEMINI.md', 'agents.md']) {
            const fp = path.join(projectPath, name);
            try {
              if (fs.existsSync(fp)) {
                const content = fs.readFileSync(fp, 'utf8').trim();
                if (content && !seenPaths.has(fp)) {
                  const stat = fs.statSync(fp);
                  files.push({ filename: name, filePath: fp, modified: stat.mtime.toISOString(), displayPath: shortName + '/', source: 'project' });
                  seenPaths.add(fp);
                }
              }
            } catch {}
          }

          // 3. {projectPath}/.claude/ — commands/*.md and other .md files
          const dotClaudeDir = path.join(projectPath, '.claude');
          const dotClaudeFiles = scanMdFiles(dotClaudeDir);
          for (const f of dotClaudeFiles) {
            if (!seenPaths.has(f.filePath)) {
              files.push({ ...f, displayPath: shortName + '/.claude/', source: 'project' });
              seenPaths.add(f.filePath);
            }
          }
          // commands/*.md
          const commandsDir = path.join(dotClaudeDir, 'commands');
          const commandFiles = scanMdFiles(commandsDir);
          for (const f of commandFiles) {
            if (!seenPaths.has(f.filePath)) {
              files.push({ ...f, displayPath: shortName + '/.claude/commands/', source: 'project' });
              seenPaths.add(f.filePath);
            }
          }
        }

        if (files.length > 0) {
          projects.push({ folder, projectPath: projectPath || '', shortName, files });
        }
      }
    }
  } catch (err) {
    console.error('Error scanning memories:', err);
  }

  // Sort projects by most recent file modified date
  projects.sort((a, b) => {
    const aMax = Math.max(...a.files.map(f => new Date(f.modified).getTime()));
    const bMax = Math.max(...b.files.map(f => new Date(f.modified).getTime()));
    return bMax - aMax;
  });

  const result = { global: { files: globalFiles }, projects };

  // Index all files for FTS
  try {
    deleteSearchType('memory');
    const allFiles = [
      ...globalFiles.map(f => ({ ...f, label: 'Global' })),
      ...projects.flatMap(p => p.files.map(f => ({ ...f, label: p.shortName }))),
    ];
    upsertSearchEntries(allFiles.map(f => ({
      id: f.filePath, type: 'memory', folder: null,
      title: f.label + ' ' + f.filename,
      body: fs.readFileSync(f.filePath, 'utf8'),
    })));
  } catch {}

  return result;
});

// --- IPC: read-memory ---
ipcMain.handle('read-memory', (_event, filePath) => {
  try {
    const resolved = path.resolve(filePath);
    // Allow paths under ~/.claude/ or any .md file that exists
    if (!resolved.endsWith('.md')) return '';
    if (!resolved.startsWith(CLAUDE_DIR) && !fs.existsSync(resolved)) return '';
    return fs.readFileSync(resolved, 'utf8');
  } catch (err) {
    console.error('Error reading memory file:', err);
    return '';
  }
});

// --- IPC: save-memory ---
ipcMain.handle('save-memory', (_event, filePath, content) => {
  try {
    const resolved = path.resolve(filePath);
    if (!resolved.endsWith('.md')) return { ok: false, error: 'not a .md file' };
    if (!fs.existsSync(resolved)) return { ok: false, error: 'file does not exist' };
    fs.writeFileSync(resolved, content, 'utf8');
    return { ok: true };
  } catch (err) {
    console.error('Error saving memory file:', err);
    return { ok: false, error: err.message };
  }
});

// --- IPC: search ---
ipcMain.handle('search-session-ids', (_event, query, sessionIds) => {
  if (typeof query !== 'string' || !Array.isArray(sessionIds) || sessionIds.some(id => typeof id !== 'string')) return [];
  return dbModule.searchSessionIds(query, sessionIds);
});

ipcMain.handle('search', (_event, type, query, titleOnly) => {
  return searchByType(type, query, 50, !!titleOnly);
});

// --- IPC: settings ---
ipcMain.handle('get-setting', (_event, key) => {
  return getSetting(key);
});

ipcMain.handle('set-setting', (_event, key, value) => {
  const beforeSet = key === 'global' ? disabledHarnessIds() : null;
  const before = beforeSet ? [...beforeSet].sort().join(',') : null;

  if (key === 'global' && Array.isArray(value?.disabledHarnesses)) {
    // At least one CLI has to stay on, or the app has nothing to show and no
    // way to start anything. The settings panel already prevents this; this is
    // the guard for any other writer. The id that was just switched off is the
    // one refused, which is what the UI does too.
    const launchable = allHarnesses().filter(h => h.buildLaunchArgs).map(h => h.id);
    const disabled = new Set(value.disabledHarnesses);
    if (launchable.length && launchable.every(id => disabled.has(id))) {
      const justAdded = launchable.filter(id => disabled.has(id) && !beforeSet.has(id));
      const keep = justAdded[0] || launchable[0];
      log.warn(`[harness-toggle] refusing to disable every CLI; keeping ${keep} on`);
      value = { ...value, disabledHarnesses: value.disabledHarnesses.filter(id => id !== keep) };
    }
  }

  setSetting(key, value);

  if (key === 'global') {
    const after = [...disabledHarnessIds()].sort().join(',');
    if (before !== after) {
      // Something was switched on or off. Watchers follow the new set, and a
      // reconcile picks up whatever a newly-enabled harness did while it was
      // being ignored — incremental, because its cached rows were kept and the
      // folder mtime gate re-reads only what actually changed.
      stopHarnessWatchers();
      startHarnessWatchers();
      try { projectsWatcher?.close(); } catch {}
      projectsWatcher = null;
      startProjectsWatcher();
      try { reconcileCacheFromFilesystem(); } catch (err) { log.error('[harness-toggle]', err.message); }
      notifyRendererProjectsChanged();
      // The status bar quota gauge only re-reads on a 5-minute timer, so
      // without this a switched-off CLI keeps its bars until the next tick.
      emit('harnesses-changed');
    }
  }
  return { ok: true };
});

ipcMain.handle('delete-setting', (_event, key) => {
  deleteSetting(key);
  return { ok: true };
});

// --- Scheduled tasks ---

const SETTING_DEFAULTS = {
  permissionMode: null,
  dangerouslySkipPermissions: false,
  worktree: false,
  worktreeName: '',
  chrome: false,
  preLaunchCmd: '',
  addDirs: '',
  // Claude's model and effort. Empty leaves the choice to claude.
  model: '',
  effort: '',
  visibleSessionCount: 5,
  sidebarWidth: 340,
  terminalTheme: 'switchboard',
  mcpEmulation: false,
  shellProfile: 'auto',
  // Codex equivalents of the permission settings above. Kept separate because
  // the vocabularies do not map: codex has no permission modes, and Claude has
  // no sandbox policy. An empty value means "leave it to codex's own config".
  // The app starts on workspace-write: a project's attached folders only reach
  // codex under that sandbox, and read-only sessions cannot do the work.
  codexSandbox: 'workspace-write',
  codexApproval: '',
  codexModel: '',
  codexEffort: '',
};

// --- Harness enablement ---
//
// A disabled harness is not scanned, not watched, not listed as something to
// start, and its sessions are hidden. Its cached rows are deliberately KEPT:
// re-enabling then costs an incremental reconcile rather than a full re-index,
// and nothing is lost if the toggle was a mistake.
function disabledHarnessIds() {
  const global = getSetting('global') || {};
  return new Set(global.disabledHarnesses || []);
}

function harnessEnabled(id) {
  return !disabledHarnessIds().has(id || DEFAULT_HARNESS);
}

// --- IPC: harnesses --- (which CLIs this machine has, and which are switched on)
ipcMain.handle('get-harnesses', () => {
  const disabled = disabledHarnessIds();
  return allHarnesses()
    .filter(h => h.buildLaunchArgs)
    .map(h => ({ id: h.id, label: h.label, enabled: !disabled.has(h.id) }));
});

// Codex's model catalog, for model suggestions and the per-model reasoning
// efforts in session and schedule settings.
ipcMain.handle('get-codex-models', () => getHarness('codex')?.readModelCatalog?.() || []);

ipcMain.handle('get-shell-profiles', () => {
  _shellProfiles = null; // refresh on each request
  return getShellProfiles();
});

function effectiveSettings(projectPath) {
  const global = getSetting('global') || {};
  const project = projectPath ? (getSetting('project:' + projectPath) || {}) : {};
  return resolveEffectiveSettings(SETTING_DEFAULTS, global, project);
}

ipcMain.handle('get-effective-settings', (_event, projectPath) => effectiveSettings(projectPath));

// Task processes deliberately live outside activeSessions. A server can be
// stopped, restarted, or reattached without changing an AI session lifecycle.
const taskManager = createTaskManager({
  baseEnv: cleanPtyEnv,
  getShellProfile: (projectPath) => resolveShell(effectiveSettings(projectPath).shellProfile),
  // A project worktree inherits its source repo's tasks.json.
  resolveWorktreeParent: (projectPath) => projects.worktreeParentFor(projectPath),
  log,
  send: emit,
});

ipcMain.handle('list-project-tasks', (_event, projectPath) => taskManager.listTasks(projectPath));
ipcMain.handle('list-tasks-for-projects', (_event, projectPaths) => taskManager.listTasksForProjects(projectPaths));
ipcMain.handle('get-task-run', (_event, projectPath, label) => taskManager.getRun(projectPath, label));
ipcMain.handle('start-task', (_event, projectPath, label) => taskManager.startTask(projectPath, label));
ipcMain.handle('stop-task', (_event, projectPath, label) => taskManager.stopTask(projectPath, label));
ipcMain.handle('stop-all-tasks', (_event, projectPath) => taskManager.stopAllTasks(projectPath));
ipcMain.handle('restart-task', (_event, projectPath, label) => taskManager.restartTask(projectPath, label));
ipcMain.on('task-input', (_event, projectPath, label, data) => taskManager.sendInput(projectPath, label, data));
ipcMain.on('task-resize', (_event, projectPath, label, cols, rows) => taskManager.resize(projectPath, label, cols, rows));

// --- IPC: get-active-sessions ---
ipcMain.handle('get-active-sessions', async () => {
  await sessionsReady;
  const active = [];
  for (const [sessionId, session] of activeSessions) {
    if (!session.exited) active.push(sessionId);
  }
  return active;
});

// --- IPC: get-active-terminals --- (plain terminal sessions for renderer restore)
ipcMain.handle('get-active-terminals', async () => {
  await sessionsReady;
  const terminals = [];
  for (const [sessionId, session] of activeSessions) {
    if (!session.exited && session.isPlainTerminal) {
      terminals.push({
        sessionId,
        projectPath: session.projectPath,
        projectId: session.projectId || null,
        trackId: session.trackId || null,
      });
    }
  }
  return terminals;
});

// --- IPC: stop-session ---
ipcMain.handle('stop-session', (_event, sessionId) => {
  const session = activeSessions.get(sessionId);
  if (!session || session.exited) return { ok: false, error: 'not running' };
  session.stopRequested = true;
  session.pty.kill();
  return { ok: true };
});

// --- IPC: RAM task manager ---
// What each live session and running task costs, measured over its whole
// process tree (the CLI, its MCP servers, whatever it started), so the heavy
// ones can be found and stopped. Root pids are always looked up here, never
// taken from the renderer.
const processMonitor = createProcessMonitor();

/** The live session behind an id, also under the real id a fork or plan-accept gave it. */
function ownedSession(sessionId) {
  let session = activeSessions.get(sessionId);
  if (!session) session = [...activeSessions.values()].find(s => s.realSessionId === sessionId);
  return session && !session.exited ? session : null;
}

/** One entry per live session and per running task, each with the pid its tree hangs from. */
function processOwners() {
  const owners = [];
  const seen = new Set();
  for (const [key, session] of activeSessions) {
    if (seen.has(session) || session.exited) continue;
    seen.add(session);
    owners.push({
      kind: 'session',
      id: session.realSessionId || key,
      pid: session.pty?.pid || null,
      type: session.isPlainTerminal ? 'terminal' : 'cli',
      runtime: session.isPlainTerminal ? null : session.runtime || null,
      projectPath: session.projectPath || null,
      startedAt: session._openedAt || null,
      busy: !!session._cliBusy,
      stopRequested: !!session.stopRequested,
    });
  }
  for (const task of taskManager.listProcesses()) {
    owners.push({ kind: 'task', id: `${task.projectPath}\0${task.label}`, type: 'task', ...task });
  }
  return owners;
}

function ownerRootPid(owner) {
  if (owner?.kind === 'session') return ownedSession(owner.id)?.pty?.pid || null;
  if (owner?.kind === 'task') {
    return taskManager.listProcesses().find(t => t.projectPath === owner.projectPath && t.label === owner.label)?.pid || null;
  }
  return null;
}

// Programs that host sessions outside the app's own process tree: their own
// memory is Switchboard's too (process-monitor.js usage()).
const TERMINAL_HOSTS = ['herdr-core', 'herdr-core.exe'];

// Free disk space changes slowly, and Windows reads it through PowerShell.
const DISKS_MAX_AGE_MS = 15000;
let diskSpace = null;

function readDisks() {
  if (diskSpace && Date.now() - diskSpace.at < DISKS_MAX_AGE_MS) return diskSpace.promise;
  // On Linux, the filesystems of the projects and of the app, besides home.
  const paths = [getSetting('global')?.projectsRoot, app.getAppPath()].filter(Boolean);
  const promise = processMonitor.disks({ paths }).catch(() => []);
  diskSpace = { at: Date.now(), promise };
  return promise;
}

/**
 * Everything the Task Manager shows: the memory installed and in use on the
 * computer, what Switchboard uses (the app, its terminal host, every session
 * and task), the free space on the disks, and each session and task.
 */
async function measureProcessUsage() {
  const [usage, memory, disks] = await Promise.all([
    processMonitor.usage(processOwners(), { appPid: process.pid, hostNames: TERMINAL_HOSTS }),
    processMonitor.systemMemory(),
    readDisks(),
  ]);
  return {
    platform: process.platform,
    totalMemBytes: memory.totalBytes,
    usedMemBytes: memory.usedBytes,
    // What each memory number is: 'footprint' (macOS), 'rss' or 'working-set'.
    memoryMeasure: usage.measure,
    app: usage.app,
    switchboard: usage.total,
    // { name, mount, totalBytes, freeBytes, primary }, the disk of home and projects first.
    disks,
    owners: usage.owners,
    sampledAt: Date.now(),
  };
}

// The window, a Task Manager window and a phone may all be refreshing: one
// measurement serves the requests that arrive while it runs, and for a moment after.
let processUsage = null;
ipcMain.handle('get-process-usage', () => {
  if (processUsage && (processUsage.pending || Date.now() - processUsage.at < 1500)) return processUsage.promise;
  const current = { pending: true, at: 0, promise: null };
  current.promise = measureProcessUsage().finally(() => { current.pending = false; current.at = Date.now(); });
  processUsage = current;
  return current.promise;
});

// --- Pages in a window of their own: the Task Manager and Stats ---
// From the button in their tab's tooltip: a small window that can stay above
// the others, so the numbers stay in sight while working. Each remembers its
// place and size, and whether it stays on top (the Task Manager does at
// first). They close with the main window.
const TOOL_WINDOWS = {
  'task-manager': { page: 'task-manager.html', title: 'Task Manager', width: 640, height: 560, minWidth: 380, minHeight: 280, onTop: true },
  stats: { page: 'stats.html', title: 'Stats', width: 760, height: 720, minWidth: 420, minHeight: 320, onTop: false },
};
const toolWindows = new Map(); // kind → BrowserWindow

function toolWindowSettings(kind) {
  const global = getSetting('global') || {};
  // 1.6.1 kept the Task Manager's window under its own key.
  return global.toolWindows?.[kind] || (kind === 'task-manager' ? global.taskManagerWindow : null) || {};
}

function saveToolWindowSettings(kind, patch) {
  const global = getSetting('global') || {};
  global.toolWindows = { ...(global.toolWindows || {}), [kind]: { ...toolWindowSettings(kind), ...patch } };
  setSetting('global', global);
}

function openToolWindow(kind) {
  const spec = TOOL_WINDOWS[kind];
  if (!spec) return;
  const open = toolWindows.get(kind);
  if (open && !open.isDestroyed()) {
    bringForward(open);
    return;
  }
  const win = createPageWindow(kind, spec);
  toolWindows.set(kind, win);
  win.loadFile(path.join(__dirname, 'public', spec.page));
  win.on('closed', () => {
    if (toolWindows.get(kind) === win) toolWindows.delete(kind);
  });
}

function bringForward(win) {
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

/**
 * A small window for a page of its own, `kind` naming where its place and
 * size are remembered. `offset` moves it down and right from that place, so
 * a second window of the same kind does not hide the first.
 */
function createPageWindow(kind, spec, { offset = 0 } = {}) {
  const saved = toolWindowSettings(kind);
  const bounds = { width: saved.width || spec.width, height: saved.height || spec.height };
  const onScreen = saved.x != null && saved.y != null && screen.getAllDisplays().some(d => {
    const b = d.workArea;
    return saved.x >= b.x - 100 && saved.x < b.x + b.width && saved.y >= b.y - 50 && saved.y < b.y + b.height;
  });
  if (onScreen) Object.assign(bounds, { x: saved.x + offset, y: saved.y + offset });
  const win = new BrowserWindow({
    ...bounds,
    minWidth: spec.minWidth,
    minHeight: spec.minHeight,
    title: spec.title,
    backgroundColor: '#111118',
    show: false,
    icon: path.join(__dirname, 'build', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      nodeIntegrationInSubFrames: false,
      contextIsolation: true,
    },
  });
  if (saved.onTop ?? spec.onTop) win.setAlwaysOnTop(true, 'floating');
  win.once('ready-to-show', () => win.show());
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url).catch(() => {});
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (event) => event.preventDefault());

  let boundsTimer = null;
  const saveBounds = () => {
    clearTimeout(boundsTimer);
    boundsTimer = setTimeout(() => {
      if (win.isDestroyed() || win.isMinimized()) return;
      const b = win.getBounds();
      saveToolWindowSettings(kind, { x: b.x, y: b.y, width: b.width, height: b.height });
    }, 500);
  };
  win.on('resize', saveBounds);
  win.on('move', saveBounds);
  win.on('closed', () => clearTimeout(boundsTimer));
  return win;
}

// --- A project's tab in a window of its own ---
// From the button beside each tab of a project's page: index.html again, as
// a window without the sidebar and the terminals (public/project-window.js).
// A session it opens goes to the main window, which has the terminals. One
// window per project and tab; each tab remembers its window's place and size,
// and whether it stays on top. They close with the main window.
const PROJECT_WINDOW_TABS = new Set(['overview', 'plan', 'files', 'git', 'settings']);
const PROJECT_WINDOW_SPEC = { title: 'Switchboard', width: 1000, height: 760, minWidth: 520, minHeight: 360, onTop: false };
// What a project window asks the main window to do (app.js runFromProjectWindow).
const PROJECT_WINDOW_RUN = new Set(['openSession', 'showSession', 'launchNewSession', 'openRawTerminalSession']);
// The events a project's page lives on. Terminal output, notices and the
// rest stay with the main window.
const PROJECT_WINDOW_EVENTS = new Set([
  'projects-changed', 'project-plan-changed', 'git-graph-repo-changed', 'git-graph-action-progress',
  'task-state-changed', 'project-tasks-changed', 'harnesses-changed', 'file-changed',
]);
const projectWindows = new Map(); // `${projectId}\n${tab}` → BrowserWindow

addSink((channel, args) => {
  if (!PROJECT_WINDOW_EVENTS.has(channel)) return;
  for (const win of projectWindows.values()) if (!win.isDestroyed()) win.webContents.send(channel, ...args);
});

function openProjectWindow(projectId, tab) {
  if (typeof projectId !== 'string' || !projectId || projectId.length > 200 || !PROJECT_WINDOW_TABS.has(tab)) return false;
  const key = `${projectId}\n${tab}`;
  const open = projectWindows.get(key);
  if (open && !open.isDestroyed()) {
    bringForward(open);
    return true;
  }
  const kind = `project-${tab}`;
  const sameKind = [...projectWindows.keys()].filter(k => k.endsWith(`\n${tab}`)).length;
  const win = createPageWindow(kind, PROJECT_WINDOW_SPEC, { offset: 24 * sameKind });
  projectWindows.set(key, win);
  win.loadFile(path.join(__dirname, 'public', 'index.html'), { query: { projectWindow: projectId, tab } });
  win.on('closed', () => {
    if (projectWindows.get(key) === win) projectWindows.delete(key);
  });
  return true;
}

/** The kind of the tool window a page runs in ('project-git' for a project's Git tab), or null for the main window. */
function toolWindowKindOf(webContents) {
  for (const [kind, win] of toolWindows) if (!win.isDestroyed() && win.webContents === webContents) return kind;
  for (const [key, win] of projectWindows) if (!win.isDestroyed() && win.webContents === webContents) return `project-${key.split('\n')[1]}`;
  return null;
}

ipcMain.handle('open-tool-window', (_event, kind) => { openToolWindow(String(kind)); return true; });
ipcMain.handle('open-project-window', (_event, projectId, tab) => openProjectWindow(projectId, tab));

// A project window opening a session: the main window does it and comes forward.
ipcMain.handle('project-window-run', (event, name, args) => {
  const fromProjectWindow = [...projectWindows.values()].some(win => !win.isDestroyed() && win.webContents === event.sender);
  if (!fromProjectWindow || !PROJECT_WINDOW_RUN.has(name) || !Array.isArray(args)) return false;
  if (!mainWindow || mainWindow.isDestroyed()) return false;
  bringForward(mainWindow);
  mainWindow.webContents.send('project-window-run', name, args);
  return true;
});

ipcMain.handle('get-window-on-top', (event) => !!BrowserWindow.fromWebContents(event.sender)?.isAlwaysOnTop());

ipcMain.handle('set-window-on-top', (event, onTop) => {
  const kind = toolWindowKindOf(event.sender);
  const win = kind && BrowserWindow.fromWebContents(event.sender);
  if (!win) return false;
  const value = !!onTop;
  win.setAlwaysOnTop(value, 'floating');
  saveToolWindowSettings(kind, { onTop: value });
  return value;
});

// Open from the Task Manager's window: the main window comes forward and shows
// the session or the task's output (process-viewer.js onTaskManagerOpenOwner).
ipcMain.handle('task-manager-open-owner', (_event, owner) => {
  if (!isProcessOwner(owner) || !mainWindow || mainWindow.isDestroyed()) return false;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
  mainWindow.webContents.send('task-manager-open-owner', owner);
  return true;
});

// The Task Manager's Stop: the usual stop, then nothing of the tree left behind,
// not even a child that ignored the hangup (see stopTree).
ipcMain.handle('stop-owner', async (_event, owner) => {
  const rootPid = ownerRootPid(owner);
  if (!rootPid) return { ok: false, error: 'Not running' };
  return processMonitor.stopTree(rootPid, () => {
    if (owner.kind === 'task') return taskManager.stopTask(owner.projectPath, owner.label);
    const session = ownedSession(owner.id);
    if (!session) return null;
    session.stopRequested = true;
    return session.pty.kill();
  });
});

// One process inside a session's or task's tree: SIGTERM, or SIGKILL when forced.
ipcMain.handle('kill-owned-process', async (_event, owner, pid, force) => {
  const rootPid = ownerRootPid(owner);
  if (!rootPid) return { ok: false, error: 'Not running' };
  return processMonitor.killInTree(rootPid, Number(pid), force ? 'SIGKILL' : 'SIGTERM');
});

// The way out when Stop is not enough: SIGKILL the whole tree, still counted as stopped by the user.
ipcMain.handle('force-stop-owner', async (_event, owner) => {
  const rootPid = ownerRootPid(owner);
  if (!rootPid) return { ok: false, error: 'Not running' };
  if (owner.kind === 'session') ownedSession(owner.id).stopRequested = true;
  else taskManager.stopTask(owner.projectPath, owner.label);
  return processMonitor.killTree(rootPid);
});

// --- IPC: toggle-star ---
ipcMain.handle('toggle-star', (_event, sessionId) => {
  const starred = toggleStar(sessionId);
  return { starred };
});

// --- IPC: rename-session ---
ipcMain.handle('rename-session', (_event, sessionId, name) => {
  setName(sessionId, name || null);
  // Update search index title to include the new name
  const cached = getCachedSession(sessionId);
  const summary = cached?.summary || '';
  updateSearchTitle(sessionId, 'session', (name ? name + ' ' : '') + summary);
  // A rename from a phone shows in the window, and the other way round.
  notifyRendererProjectsChanged('sessions');
  return { name: name || null };
});

function readSessionViewerEntries(row) {
  // The harness owns its transcript naming and its on-disk format. Normalize
  // here so neither transcript consumer needs runtime-specific branches.
  const jsonlPath = transcriptPath(row);
  const harness = getHarness(row.runtime);
  const content = fs.readFileSync(jsonlPath, 'utf-8');
  const entries = [];
  for (const line of content.split('\n')) {
    if (!line.trim()) continue;
    try { entries.push(JSON.parse(line)); } catch {}
  }
  return harness.toViewerEntries(entries);
}

ipcMain.handle('read-session-jsonl', (_event, sessionId) => {
  const row = getCachedSession(sessionId);
  if (!row) return { error: 'Session not found in cache' };
  try {
    return { entries: readSessionViewerEntries(row) };
  } catch (err) {
    return { error: err.message };
  }
});

ipcMain.handle('get-session-last-message', (_event, sessionId) => {
  const row = getCachedSession(sessionId);
  if (!row) return { error: 'Session not found in cache' };
  try {
    const { text, truncated } = lastAssistantMessage(readSessionViewerEntries(row));
    return { text, truncated };
  } catch (err) {
    return { error: err.message };
  }
});

// The entries written since `cursor` (a byte offset from the previous call),
// so a client following a live session does not re-read the whole transcript.
ipcMain.handle('read-session-entries', (_event, sessionId, cursor) => {
  const row = getCachedSession(sessionId);
  if (!row) return { error: 'Session not found in cache' };
  try {
    const read = readTranscriptSince(transcriptPath(row), cursor || 0);
    return { entries: getHarness(row.runtime).toViewerEntries(read.entries), cursor: read.cursor, reset: read.reset };
  } catch (err) {
    return { error: err.message };
  }
});

// The last `count` entries of a transcript, for a phone opening a long
// conversation: all of it would take seconds to decrypt and lay out there.
// `earlier` says how many are left out; `cursor` follows on as above.
ipcMain.handle('read-session-tail', (_event, sessionId, count) => {
  const row = getCachedSession(sessionId);
  if (!row) return { error: 'Session not found in cache' };
  try {
    const read = readTranscriptSince(transcriptPath(row), 0);
    const entries = getHarness(row.runtime).toViewerEntries(read.entries);
    const kept = entries.slice(-count);
    return { entries: kept, cursor: read.cursor, earlier: entries.length - kept.length };
  } catch (err) {
    return { error: err.message };
  }
});

// Busy, waiting-for-the-user and starting, for every live PTY at once.
ipcMain.handle('get-session-states', () => sessionStates(activeSessions));

// --- Remote access: the mobile companion app ---
// Off until the sidebar switch turns it on (remote-server.js).

// A dev or test instance (its own data dir) gets its own default port, so it
// can run next to the installed app.
const REMOTE_DEFAULT_PORT = process.env.SWITCHBOARD_DATA_DIR ? 47110 : 47100;
const desktopName = os.hostname().replace(/\.local$/, '');

function remoteAccessSettings() {
  const stored = getSetting('remoteAccess') || {};
  return { enabled: !!stored.enabled, port: Number.isInteger(stored.port) ? stored.port : REMOTE_DEFAULT_PORT };
}

// --- Remote terminals and launches ---

const terminalFanout = createTerminalFanout();

/** A live session, by the id the caller has for it. */
function liveSession(sessionId) {
  const session = activeSessions.get(sessionId);
  return session && !session.exited ? session : null;
}

/**
 * Resize a PTY for a phone. Unlike a window resize, this does not stop
 * buffering for a moment: the phone often types right after, and that
 * output must reach the replay; a redrawn prompt in it is the lesser harm.
 */
function resizeForRemote(session, cols, rows) {
  try { session.pty.resize(cols, rows); } catch {}
  terminalFanout.resized(session, cols, rows);
}

/** Give a PTY the window's size back, if this phone had fitted it to its screen. */
function releaseRemoteFit(session, client) {
  if (session.remoteFit !== client) return null;
  session.remoteFit = null;
  const { cols, rows } = session.desktopSize || { cols: 120, rows: 30 };
  resizeForRemote(session, cols, rows);
  return { cols, rows };
}

// Unread and needs-you marks, and what phones have on screen.
const sessionNotices = createSessionNotices({ emit });
addSink(sessionNotices.eventSink);
ipcMain.on('session-notices', (_event, notices) => sessionNotices.publish(notices));

// A phone's change to a line of the plan, only if the line still holds the
// text the phone saw there (remote-plan.js).
function remotePlanEdit(channel) {
  return async (_client, projectId, kind, line, value, expected) => {
    const plan = await getHandler('get-project-plan').fn(null, projectId);
    if (plan?.error) return plan;
    if (planLineText(plan, kind, line) !== expected) return { error: 'The plan changed meanwhile. Pull to refresh and try again.' };
    return getHandler(channel).fn(null, projectId, kind, line, value);
  };
}

// Files a phone may list, read and save: inside a project's folder or one attached to it.
// Claude's plans too, to read and save only: the chat opens the plan a session wrote.
const phoneRoots = () => [...dbModule.listProjects().map(p => p.root), ...dbModule.listAllProjectFolders().map(f => f.path)];
const phoneFiles = createPhoneFiles({ roots: phoneRoots, readRoots: () => [PLANS_DIR], shell });
const phoneTasks = createRemoteTasks({ roots: phoneRoots, taskManager });
const phoneAttachments = createAttachments({ dir: path.join(dbModule.DATA_DIR, 'attachments') });

// Remote methods that need to know which phone is calling, or are not IPC handlers.
const remoteLocalMethods = {
  'attach-terminal': (client, sessionId, sinceSeq) => {
    const session = liveSession(sessionId);
    if (!session) throw new Error('This session is not running');
    return terminalFanout.attach(session, sessionId, client, sinceSeq ?? null);
  },
  'detach-terminal': (client, sessionId) => {
    const session = activeSessions.get(sessionId);
    if (session) {
      terminalFanout.detach(session, client);
      releaseRemoteFit(session, client);
    }
    return true;
  },
  // The desktop reflows too while a phone has the PTY at its size.
  'fit-terminal': (client, sessionId, cols, rows) => {
    const session = liveSession(sessionId);
    if (!session) throw new Error('This session is not running');
    session.remoteFit = client;
    resizeForRemote(session, cols, rows);
    return { cols, rows };
  },
  'unfit-terminal': (client, sessionId) => {
    const session = activeSessions.get(sessionId);
    const size = session ? releaseRemoteFit(session, client) : null;
    return size || (session?.pty ? { cols: session.pty.cols, rows: session.pty.rows } : null);
  },
  'get-session-notices': () => sessionNotices.snapshot(),
  'mark-read': (_client, sessionId) => sessionNotices.setRead(sessionId, true),
  'mark-unread': (_client, sessionId) => sessionNotices.setRead(sessionId, false),
  'set-viewing': (client, sessionId) => sessionNotices.setViewing(client, sessionId || null),
  'list-pending-diffs': () => listPendingDiffs(),
  'run-schedule': (_client, scheduleId) => sessionLauncher.runSchedule(scheduleId),
  'list-folders': (_client, dir, hidden) => listFolders(dir || undefined, { hidden: !!hidden }),
  'create-folder': (_client, dir, name) => createFolder(dir, name),
  'list-project-directory': (_client, projectPath, relativePath) => phoneFiles.list(projectPath, relativePath),
  'read-project-file': (_client, projectPath, relativePath) => phoneFiles.read(projectPath, relativePath),
  'read-project-file-chunk': (_client, projectPath, relativePath, offset) => phoneFiles.chunk(projectPath, relativePath, offset),
  'locate-file': (_client, filePath, cwd) => phoneFiles.locate(filePath, cwd),
  'save-project-file': (_client, projectPath, relativePath, content, expectedVersion) => phoneFiles.save(projectPath, relativePath, content, expectedVersion),
  'manage-project-entry': (_client, projectPath, relativePath, action, newName) => phoneFiles.manage(projectPath, relativePath, action, newName),
  'create-project-entry': (_client, projectPath, folderRelative, name, kind) => phoneFiles.create(projectPath, folderRelative, name, kind),
  'duplicate-project-entry': (_client, projectPath, relativePath) => phoneFiles.duplicate(projectPath, relativePath),
  'paste-project-entry': (_client, sourcePath, sourceRelative, targetPath, targetRelative, mode) => phoneFiles.paste(sourcePath, sourceRelative, targetPath, targetRelative, mode),
  'get-file-timeline': (_client, projectPath, relativePath) => phoneFiles.timeline(projectPath, relativePath),
  'get-file-timeline-diff': (_client, projectPath, relativePath, hash, repoPath, oldPath) => phoneFiles.timelineDiff(projectPath, relativePath, hash, repoPath, oldPath),
  'add-project-file-bytes': (_client, projectId, name, base64) => projects.addProjectFileBytes(projectId, name, Buffer.from(base64, 'base64')),
  'save-session-attachment': (_client, sessionId, name, base64) => phoneAttachments.save(sessionId, name, Buffer.from(base64, 'base64')),
  ...phoneTasks.methods,
  'set-plan-item': remotePlanEdit('set-plan-item'),
  'edit-plan-item': remotePlanEdit('edit-plan-item'),
  'mcp-diff-response': (_client, sessionId, diffId, action) => ({ ok: resolvePendingDiff(sessionId, diffId, action, null) }),
};

function remoteClientClosed(client) {
  sessionNotices.clientClosed(client);
  terminalFanout.detachClient(client);
  for (const session of new Set(activeSessions.values())) releaseRemoteFit(session, client);
}

// Start, resume or fork a session with an id minted here, through the same
// open-terminal handler the window uses.
const sessionLauncher = createSessionLauncher({
  openTerminal: (...args) => getHandler('open-terminal').fn(null, ...args),
  effectiveSettings,
  sessionConfig: require('./public/session-config'),
  getCachedSession,
  activeSessions,
  onLaunched: () => notifyRendererProjectsChanged('sessions'),
  resolveScheduleLaunch: (id) => projects.resolveScheduleLaunch(id),
});
ipcMain.handle('launch-session', (_event, spec) => sessionLauncher.launch(spec || {}));

const remoteAuth = createRemoteAuth({ nacl, getSetting, setSetting });
const remoteServer = createRemoteServer({
  protocol: createRemoteProtocol(nacl),
  auth: remoteAuth,
  api: createRemoteApi({ getHandler, localMethods: remoteLocalMethods }),
  log,
  appVersion: app.getVersion(),
  desktopName,
  // From the Internet a phone comes through a tunnel, with the access key.
  accessKey: () => remoteAuth.accessKey(),
  routes: () => remoteTunnels.routes(),
  onStatus: (status) => emit('remote-access-status', remoteAccessStatus(status)),
  onClientClosed: remoteClientClosed,
});
addSink(remoteServer.eventSink);

// Cloudflare and ngrok, for the Fork: they run while remote access is on.
const remoteTunnels = createRemoteTunnels({
  getSetting,
  setSetting,
  encrypt: (text) => safeStorage.encryptString(text).toString('base64'),
  decrypt: (text) => safeStorage.decryptString(Buffer.from(text, 'base64')),
  spawn: require('child_process').spawn,
  fetch: (...args) => fetch(...args),
  log,
  port: () => remoteAccessSettings().port,
  configDir: path.join(app.getPath('userData'), 'tunnels'),
  onChange: () => emit('remote-access-status', remoteAccessStatus()),
});

// While remote access is on, a working session keeps the Mac from idle sleep.
const powerSaveGuard = createPowerSaveGuard({
  powerSaveBlocker,
  wanted: () => remoteServer.status().running && [...activeSessions.values()].some(s => !s.exited && s._cliBusy),
});
addSink((channel) => {
  if (channel === 'cli-busy-state' || channel === 'process-exited' || channel === 'remote-access-status') powerSaveGuard.update();
});

function remoteAccessStatus(status = remoteServer.status()) {
  const { enabled, port } = remoteAccessSettings();
  return { enabled, port, paired: remoteAuth.listDevices().length, running: status.running, error: status.error, clients: status.clients || [], tunnels: remoteTunnels.status() };
}

// A port held by another copy of the app (Switchboard, an older OmniboardV)
// frees up when that one quits. While access is switched on, keep trying,
// so paired phones get back in without anyone touching the switch.
const REMOTE_RETRY_MS = 5000;
let remoteRetryTimer = null;

async function startRemoteAccess() {
  clearTimeout(remoteRetryTimer);
  remoteRetryTimer = null;
  const started = await remoteServer.start(remoteAccessSettings().port);
  if (started.running) {
    remoteTunnels.start();
  } else if (remoteAccessSettings().enabled && /already in use/.test(started.error || '')) {
    remoteRetryTimer = setTimeout(() => {
      if (remoteAccessSettings().enabled && !remoteServer.status().running) startRemoteAccess();
    }, REMOTE_RETRY_MS);
    remoteRetryTimer.unref?.();
  }
  return started;
}

async function setRemoteAccessEnabled(enabled) {
  setSetting('remoteAccess', { ...remoteAccessSettings(), enabled });
  if (enabled) {
    await startRemoteAccess();
  } else {
    clearTimeout(remoteRetryTimer);
    remoteRetryTimer = null;
    remoteAuth.cancelPairing();
    remoteTunnels.stop();
    await remoteServer.stop();
  }
  return remoteAccessStatus();
}

ipcMain.handle('remote-access-status', () => remoteAccessStatus());
ipcMain.handle('remote-access-set-enabled', (_event, enabled) => setRemoteAccessEnabled(!!enabled));
ipcMain.handle('remote-access-set-port', async (_event, port) => {
  if (!Number.isInteger(port) || port < 1024 || port > 65535) return { error: 'Choose a port between 1024 and 65535' };
  setSetting('remoteAccess', { ...remoteAccessSettings(), port });
  if (remoteServer.status().running) {
    await remoteServer.stop();
    await remoteServer.start(port);
    remoteTunnels.portChanged();
  }
  return remoteAccessStatus();
});
ipcMain.handle('remote-access-start-pairing', () => {
  const status = remoteServer.status();
  if (!status.running) return { error: 'Turn remote access on first' };
  const { code, expiresAt } = remoteAuth.startPairing();
  const addresses = reachableAddresses(os.networkInterfaces(), os.hostname());
  const routes = remoteTunnels.routes();
  const link = pairingLink({ name: desktopName, addresses, port: status.port, publicKey: remoteAuth.identity().publicKey, code, expiresAt, accessKey: remoteAuth.accessKey(), routes });
  const qr = qrcode(0, 'M');
  qr.addData(link);
  qr.make();
  return { qrSvg: qr.createSvgTag({ cellSize: 4, margin: 4 }), expiresAt, addresses, port: status.port, routes };
});
// Set up or remove Cloudflare (API token, domain, name) or ngrok (authtoken, optional domain).
ipcMain.handle('remote-tunnel-setup', async (_event, provider, params = {}) => {
  try {
    if (provider === 'cloudflare') return { status: await remoteTunnels.setupCloudflare(params) };
    if (provider === 'ngrok') return { status: remoteTunnels.setupNgrok(params) };
    return { error: 'Unknown tunnel' };
  } catch (err) {
    return { error: err.message };
  }
});
ipcMain.handle('remote-tunnel-remove', async (_event, provider, params = {}) => {
  try {
    if (provider === 'cloudflare') return { status: await remoteTunnels.removeCloudflare(params) };
    if (provider === 'ngrok') return { status: remoteTunnels.removeNgrok() };
    return { error: 'Unknown tunnel' };
  } catch (err) {
    return { error: err.message };
  }
});
ipcMain.handle('remote-access-cancel-pairing', () => { remoteAuth.cancelPairing(); return true; });
ipcMain.handle('remote-access-list-devices', () => remoteAuth.listDevices());
ipcMain.handle('remote-access-revoke-device', (_event, id) => {
  if (remoteAuth.revokeDevice(String(id || ''))) remoteServer.disconnectDevice(id);
  // Removing a device that was not connected changes no connection, only the
  // paired count the window shows.
  emit('remote-access-status', remoteAccessStatus());
  return remoteAuth.listDevices();
});

// --- IPC: archive-session ---

ipcMain.handle('archive-session', (_event, sessionId, archived) => {
  const val = archived ? 1 : 0;
  setArchived(sessionId, val);
  return { archived: val };
});

// --- IPC: open-terminal ---
/**
 * Follow a session's PTY: busy/idle and notifications from its OSC output,
 * the replay buffer, the window, and its exit. For a session started here and
 * for one herdr-core kept running while Switchboard was closed alike.
 */
function wireSessionPty(sessionId, session, harness) {
  const ptyProcess = session.pty;
  ptyProcess.onData(data => {
    const currentId = session.realSessionId || sessionId;

    // Prompt marks for a plain terminal. Cheap on every chunk: the parse
    // returns immediately unless the chunk actually contains an OSC 133.
    if (session.activity) {
      const busy = session.activity.feedData(data);
      if (busy !== null) sendTerminalBusy(session, currentId, busy);
    }

    // Parse OSC sequences (title changes, progress, notifications, etc.)
    if (data.includes('\x1b]')) {
      const oscMatches = data.matchAll(/\x1b\](\d+);([^\x07\x1b]*)(?:\x07|\x1b\\)/g);
      for (const m of oscMatches) {
        const code = m[1];
        const payload = m[2].slice(0, 120);
        // Detect Claude CLI busy state from OSC 0 title (spinner chars = busy, ✳ = idle).
        // OSC 2 sets the title too: herdr-core repaints a kept session's title with it.
        if ((code === '0' || code === '2') && harness) {
          // What a title means is the harness's business: Claude marks idle with
          // ✳, codex drops the spinner prefix and says "Action Required" when
          // it is blocked on the user.
          const titleState = harness.parseTitleState(payload);
          // Remembered for the OSC 9;4 handler below, which trusts the title
          // over a progress report from any process in the PTY.
          if (titleState) session._titleBusy = titleState === 'busy';
          // The CLI's own title for the session: what it is called until its
          // transcript is indexed (session-cache.js), so the lists follow it.
          if (typeof harness.titleFromTerminal === 'function') {
            const cliTitle = harness.titleFromTerminal(payload);
            if (cliTitle && cliTitle !== session._cliTitle) {
              session._cliTitle = cliTitle;
              if (!getCachedSession(session.realSessionId || currentId)) notifyRendererProjectsChanged();
            }
          }
          const isBusy = titleState === 'busy';
          const isIdle = titleState === 'idle' || titleState === 'attention';
          log.debug(`[OSC 0] session=${currentId} state=${titleState || 'none'} wasBusy=${!!session._cliBusy}`);

          // A blocked session is announced by OSC 9 too, but only when the CLI's
          // notifications are on — which a session started before Switchboard
          // began forcing them is not. The title is the signal that is always
          // there, so it raises attention on its own. Latched, because the title
          // is rewritten on every repaint.
          if (titleState === 'attention') {
            if (!session._titleAttention) {
              session._titleAttention = true;
              log.info(`[OSC 0] session=${currentId} → ATTENTION "${payload}"`);
              emit('terminal-notification', currentId, payload, 'attention');
            }
          } else if (titleState) {
            session._titleAttention = false;
          }

          if (isBusy && !session._cliBusy) {
            session._cliBusy = true;
            session._oscIdle = false;
            session._needsAttention = false;
            log.debug(`[OSC 0] session=${currentId} → BUSY`);
            emit('cli-busy-state', currentId, true);
          } else if (isIdle && session._cliBusy) {
            session._cliBusy = false;
            session._oscIdle = true;
            log.debug(`[OSC 0] session=${currentId} → IDLE`);
            emit('cli-busy-state', currentId, false);
          }
        }
      }
      // Parse iTerm2 OSC 9 sequences (terminated by BEL \x07 or ST \x1b\\)
      const osc9Matches = data.matchAll(/\x1b\]9;([^\x07\x1b]*)(?:\x07|\x1b\\)/g);
      for (const osc9 of osc9Matches) {
        const payload = osc9[1];
        // OSC 9;4 progress: 4;0; = clear/done, 4;1;N = running at N%, 4;2;N = error, 4;3; = indeterminate
        if (payload.startsWith('4;')) {
          const level = payload.split(';')[1];
          const progressState = progressBusyState({ level, titleBusy: !!session._titleBusy });
          log.debug(`[OSC 9;4] session=${currentId} level=${level} payload="${payload}" state=${progressState || 'none'} titleBusy=${!!session._titleBusy} wasBusy=${!!session._cliBusy}`);
          if (progressState === 'busy' && !session._cliBusy) {
            session._cliBusy = true;
            session._oscIdle = false;
            session._needsAttention = false;
            log.debug(`[OSC 9;4] session=${currentId} → BUSY`);
            emit('cli-busy-state', currentId, true);
          } else if (progressState === 'idle' && session._cliBusy) {
            // The end of the progress run. Without acting on this, a busy state
            // raised by 9;4 could only be cleared by a spinner-to-idle title
            // change, which does not come for a slash command — the session sat
            // spinning until Claude's "waiting for your input" notice a full
            // minute later.
            session._cliBusy = false;
            session._oscIdle = true;
            log.debug(`[OSC 9;4] session=${currentId} → IDLE`);
            emit('cli-busy-state', currentId, false);
          }
        } else {
          // Regular notification (attention, permission, etc.). The harness
          // decides what its own wording means — codex says "Approval
          // requested: …" where Claude says "needs your permission…" — so the
          // renderer is handed a kind rather than re-deriving one from text.
          const kind = harness ? harness.classifyNotification(payload) : null;
          log.info(`[OSC 9] session=${currentId} kind=${kind || 'none'} message="${payload}"`);
          // Remembered for get-session-states, until the CLI is busy again.
          if (kind === 'attention') session._needsAttention = true;
          emit('terminal-notification', currentId, payload, kind);
        }
      }
    }

    // Standalone BEL (not part of an OSC sequence)
    if (data.includes('\x07') && !data.includes('\x1b]')) {
      log.info(`[BEL] session=${currentId}`);
    }

    // Track alternate screen mode (only if data contains the marker)
    if (data.includes('\x1b[?')) {
      if (data.includes('\x1b[?1049h') || data.includes('\x1b[?47h')) {
        session.altScreen = true;
        log.info(`[altscreen] session=${currentId} ON`);
      }
      if (data.includes('\x1b[?1049l') || data.includes('\x1b[?47l')) {
        session.altScreen = false;
        log.info(`[altscreen] session=${currentId} OFF`);
      }
    }

    // Buffer output (skip resize-triggered redraws for plain terminals)
    if (!session._suppressBuffer) {
      session.outputBuffer.push(data);
      session.outputBufferSize += data.length;
      while (session.outputBufferSize > MAX_BUFFER_SIZE && session.outputBuffer.length > 1) {
        session.outputBufferSize -= session.outputBuffer.shift().length;
      }
    }

    emit('terminal-data', currentId, data);
    terminalFanout.feed(session, data);
  });

  ptyProcess.onExit(({ exitCode, signal }) => {
    session.exited = true;
    // Clean up MCP server
    const mcpId = session.realSessionId || sessionId;
    shutdownMcpServer(mcpId);
    session.mcpServer = null;

    const realId = session.realSessionId || sessionId;
    // The renderer needs to tell "the user ended this" from "this died" to
    // decide whether to tear the terminal down or leave it up with a banner.
    // A signal kill reports exitCode 0, so pass the signal and the
    // stop-session flag along rather than making it guess from the code.
    const stopRequested = !!session.stopRequested;
    if (!appIsQuitting) {
      emit('process-exited', realId, exitCode, signal, stopRequested);
      // If a fork/plan-accept transition re-keyed this session under realId
      // but the PTY exited before transition detection ran, also notify the
      // renderer for the original sessionId so it doesn't stay stuck as "Running".
      if (realId !== sessionId && activeSessions.has(sessionId)) {
        emit('process-exited', sessionId, exitCode, signal, stopRequested);
      }
    }
    activeSessions.delete(realId);
    // Clean up the original key too in case transition detection hasn't run yet
    activeSessions.delete(sessionId);
  });
}

/** A session's PTY: in herdr-core when it runs, else node-pty. `labels` let a later start find it. */
function spawnSessionPty(file, args, options, labels) {
  if (hcEngine) {
    return hcEngine.spawn(file, args, { cwd: options.cwd, env: options.env, cols: options.cols, rows: options.rows, labels });
  }
  return pty.spawn(file, args, options);
}

/**
 * Start herdr-core unless it is turned off or missing, then pick up the
 * sessions it kept running while Switchboard was closed. Switchboard has its
 * own hc session (per data dir), started with the clean PTY environment:
 * the core keeps the environment of whoever starts it.
 */
async function startTerminalEngine() {
  const wanted = (getSetting('global') || {}).terminalEngine !== 'inside';
  if (!wanted) { terminalEngineStatus = { engine: 'inside', reason: 'Turned off in settings' }; return; }
  const found = locateHc({ userDataDir: app.getPath('userData') });
  if (!found) {
    terminalEngineStatus = { engine: 'inside', reason: 'herdr-core is not installed' };
    log.info('[hc] herdr-core not found; sessions run inside Switchboard');
    return;
  }
  const hcSession = hcSessionName(process.env.SWITCHBOARD_DATA_DIR);
  try {
    hcEngine = await createHcEngine({ binary: found.path, env: { ...cleanPtyEnv, HC_SESSION: hcSession }, log });
    terminalEngineStatus = { engine: 'hc', version: found.version, source: found.source, path: found.path, session: hcSession };
    log.info(`[hc] sessions run in herdr-core ${found.version} (${found.source}, session ${hcSession})`);
  } catch (err) {
    hcEngine = null;
    terminalEngineStatus = { engine: 'inside', reason: `herdr-core could not start: ${err.message}` };
    log.error('[hc] could not start herdr-core; sessions run inside Switchboard', err);
    return;
  }
  try { await adoptHcSessions(); } catch (err) { log.error('[hc] could not list kept sessions', err); }
}

/** The .jsonl files of a Claude project folder, and the slug of one session, as open-terminal reads them. */
function claudeFolderSnapshot(projectFolder, sessionId) {
  const dir = path.join(PROJECTS_DIR, projectFolder);
  let known = new Set();
  let slug = null;
  try { known = new Set(fs.readdirSync(dir).filter(f => f.endsWith('.jsonl'))); } catch {}
  try {
    for (const line of readHead(path.join(dir, sessionId + '.jsonl'), 8192).split('\n').filter(Boolean)) {
      const entry = JSON.parse(line);
      if (entry.slug) { slug = entry.slug; break; }
    }
  } catch {}
  return { known, slug };
}

/**
 * The sessions herdr-core kept running while Switchboard was closed: each is
 * rebuilt from its labels and attached again, its screen and history first,
 * so the list shows it running and opening it shows where it is.
 */
async function adoptHcSessions() {
  for (const record of await hcEngine.list()) {
    const labels = record.labels || {};
    const sessionId = labels.sid;
    if (!sessionId || activeSessions.has(sessionId)) continue;
    try {
      const isPlainTerminal = labels.kind === 'terminal';
      const runtimeId = isPlainTerminal ? null : (labels.runtime || DEFAULT_HARNESS);
      const harness = runtimeId ? getHarness(runtimeId) : null;
      const projectPath = labels.projectPath || record.cwd;
      const isClaude = runtimeId === DEFAULT_HARNESS;
      const projectFolder = isClaude ? encodeProjectPath(projectPath) : null;
      const { known, slug } = isClaude ? claudeFolderSnapshot(projectFolder, sessionId) : { known: new Set(), slug: null };
      const session = {
        pty: await hcEngine.adopt(record, { history: 1000 }),
        rendererAttached: false, exited: false,
        outputBuffer: [], outputBufferSize: 0, altScreen: false,
        projectPath, firstResize: true,
        projectFolder, knownJsonlFiles: known, sessionSlug: slug,
        isPlainTerminal, runtime: runtimeId, forkFrom: labels.forkFrom || null,
        activity: isPlainTerminal ? createTerminalActivity({
          shellName: labels.shell || 'zsh',
          canPollProcess: process.platform !== 'win32',
        }) : null,
        projectId: labels.projectId || null,
        trackId: labels.trackId || null,
        pendingLaunch: labels.pendingSpawnedAt ? {
          tag: labels.pendingTag || null, forkFrom: labels.forkFrom || null, projectPath, spawnedAt: Number(labels.pendingSpawnedAt),
        } : null,
        // Its IDE server went with the Switchboard that started it, and Claude
        // only reconnects to one that is back within seconds: its diffs now
        // show in the terminal until it is resumed.
        mcpServer: null, ideLost: labels.ide === '1',
        _openedAt: Number(labels.openedAt) || record.created_ms || Date.now(),
        adopted: true,
      };
      if (!isPlainTerminal && !session.projectId) {
        const meta = getMeta(sessionId);
        if (meta?.projectId) { session.projectId = meta.projectId; session.trackId = meta.trackId || null; }
      }
      activeSessions.set(sessionId, session);
      if (session.activity) startTerminalActivitySweep();
      wireSessionPty(sessionId, session, harness);
      log.info(`[hc] picked up ${sessionId} (${labels.kind || 'cli'}) running in ${record.address}`);
    } catch (err) {
      log.error(`[hc] could not pick up ${sessionId}`, err);
    }
  }
}

ipcMain.handle('get-terminal-engine', () => terminalEngineStatus);

ipcMain.handle('open-terminal', async (_event, sessionId, projectPath, isNew, sessionOptions) => {
  if (!mainWindow) return { ok: false, error: 'no window' };
  await sessionsReady;

  const isPlainTerminal = sessionOptions?.type === 'terminal';
  if (shouldBlockArchivedSession({
    isNew,
    isPlainTerminal,
    archived: getMeta(sessionId)?.archived,
  })) {
    return { ok: false, error: 'Session is archived. Unarchive it before resuming.' };
  }

  // Reattach to existing session
  if (activeSessions.has(sessionId)) {
    const session = activeSessions.get(sessionId);
    session.rendererAttached = true;
    session.firstResize = !session.isPlainTerminal;

    // The replay answers this window's request, so it goes to the window
    // only; a broadcast would repeat the backlog in every other client.
    // If TUI is in alternate screen mode, send escape to switch into it
    if (session.altScreen && !session.isPlainTerminal) {
      mainWindow.webContents.send('terminal-data', sessionId, '\x1b[?1049h');
    }

    // Send buffered output for reattach
    for (const chunk of session.outputBuffer) {
      mainWindow.webContents.send('terminal-data', sessionId, chunk);
    }

    if (!session.isPlainTerminal) {
      // Hide cursor after buffer replay — the live PTY stream or resize nudge
      // will re-show it at the correct position, avoiding a stale cursor artifact
      mainWindow.webContents.send('terminal-data', sessionId, '\x1b[?25l');
    }

    return { ok: true, reattached: true, mcpActive: !!session.mcpServer, ideLost: !!session.ideLost };
  }

  // Spawn new PTY
  if (!fs.existsSync(projectPath)) {
    return { ok: false, error: `project directory no longer exists: ${projectPath}` };
  }

  // A session that never wrote a transcript cannot be resumed — the CLI has no
  // record of the id, and asking it to resume one produces an error the user
  // can do nothing about ("No saved session found with ID ..."). Start it
  // fresh instead, which is what re-opening a session that never got going
  // means in practice.
  const cachedSession = getCachedSession(sessionId);
  const startFresh = shouldStartFresh({
    isNew,
    isPlainTerminal,
    hasCachedSession: !!cachedSession,
    resumeExisting: !!sessionOptions?.resumeExisting,
  });
  if (startFresh && !isNew && !isPlainTerminal) {
    log.info(`[open-terminal] ${sessionId} has no transcript; starting a new session instead of resuming`);
  }

  // A session that belongs to a project gets the project folder and every
  // attached folder as extra directories, so the brief loads wherever it
  // starts and the agent can edit the repos. New sessions say which project
  // in their options; resumed ones are looked up by their assignment.
  let projectEnv = {};
  // A fork of a project session belongs to the same project and track, even
  // when it is started from the Sessions tab where no project is in play.
  if (!isPlainTerminal && sessionOptions?.forkFrom && !sessionOptions.projectId) {
    const source = getMeta(sessionOptions.forkFrom);
    if (source?.projectId) sessionOptions = { ...sessionOptions, projectId: source.projectId, trackId: source.trackId || null };
  }
  if (!isPlainTerminal) {
    const launchProjectId = sessionOptions?.projectId || getMeta(sessionId)?.projectId || null;
    if (launchProjectId) {
      try {
        const ctx = projects.launchContext(launchProjectId, projectPath);
        if (ctx && ctx.addDirs.length) {
          sessionOptions = { ...(sessionOptions || {}), addDirs: projects.mergeAddDirs(sessionOptions?.addDirs, ctx.addDirs) };
          projectEnv = ctx.env;
        }
        // A project worktree is already the isolated checkout; asking Claude
        // for another one on top of it would nest worktrees.
        if (ctx?.worktree && sessionOptions?.worktree) {
          sessionOptions = { ...sessionOptions };
          delete sessionOptions.worktree;
          delete sessionOptions.worktreeName;
        }
      } catch (err) {
        log.error('[projects] launch context failed', err);
      }
    }
  }

  // Which CLI drives this session. The cached row is authoritative for anything
  // that already exists on disk; the caller only gets to say for a brand-new
  // session, which has no row yet.
  const runtimeId = isPlainTerminal
    ? null
    : (cachedSession?.runtime || sessionOptions?.runtime || DEFAULT_HARNESS);
  const harness = runtimeId ? getHarness(runtimeId) : null;
  const isClaudeSession = runtimeId === DEFAULT_HARNESS;

  if (harness && !harness.buildLaunchArgs) {
    return { ok: false, error: `${harness.label} sessions cannot be launched yet` };
  }

  // Resolve shell profile from effective settings
  const effectiveProfileId = (() => {
    const global = getSetting('global') || {};
    const project = projectPath ? (getSetting('project:' + projectPath) || {}) : {};
    let profileId = SETTING_DEFAULTS.shellProfile;
    if (global.shellProfile !== undefined && global.shellProfile !== null) profileId = global.shellProfile;
    if (project.shellProfile !== undefined && project.shellProfile !== null) profileId = project.shellProfile;
    return profileId;
  })();
  // WSL profiles only work for plain terminals — Claude CLI sessions need the
  // Windows shell because session data lives on the Windows filesystem.
  const requestedProfile = resolveShell(effectiveProfileId);
  const useWslProfile = isWslShell(requestedProfile.path) && isPlainTerminal;
  const shellProfile = (isWslShell(requestedProfile.path) && !isPlainTerminal)
    ? resolveShell('auto')
    : requestedProfile;
  const shell = shellProfile.path;
  const shellExtraArgs = [...(shellProfile.args || [])];
  const isWsl = isWslShell(shell);
  // For WSL, convert Windows path to /mnt/ path and pass via --cd;
  // the spawn cwd must remain a valid Windows path for wsl.exe itself.
  if (isWsl) {
    const wslCwd = windowsToWslPath(projectPath);
    shellExtraArgs.unshift('--cd', wslCwd);
  }
  log.info(`[shell] profile=${shellProfile.id} shell=${shell} args=${JSON.stringify(shellExtraArgs)}`);

  let knownJsonlFiles = new Set();
  let sessionSlug = null;
  let projectFolder = null;

  if (isClaudeSession) {
    // Snapshot existing .jsonl files before spawning (for new session + fork/plan detection)
    projectFolder = encodeProjectPath(projectPath);
    const claudeProjectDir = path.join(PROJECTS_DIR, projectFolder);
    if (fs.existsSync(claudeProjectDir)) {
      try {
        knownJsonlFiles = new Set(
          fs.readdirSync(claudeProjectDir).filter(f => f.endsWith('.jsonl'))
        );
      } catch {}
    }

    // Read slug from the session's jsonl file (for plan-accept detection)
    if (!startFresh) {
      try {
        const jsonlPath = path.join(claudeProjectDir, sessionId + '.jsonl');
        const head = readHead(jsonlPath, 8192);
        const firstLines = head.split('\n').filter(Boolean);
        for (const line of firstLines) {
          const entry = JSON.parse(line);
          if (entry.slug) { sessionSlug = entry.slug; break; }
        }
      } catch {}
    }
  }

  let ptyProcess;
  let mcpServer = null;
  try {
    if (isPlainTerminal) {
      // Plain terminal: interactive login shell, no claude command
      // Do not inherit Claude Code's nested-session marker if Switchboard was
      // itself launched from Claude; this is the user's shell and `claude`
      // should resolve normally from their profile/PATH.
      const terminalEnv = {
        ...cleanPtyEnv,
        TERM: 'xterm-256color', COLORTERM: 'truecolor', TERM_PROGRAM: 'iTerm.app', TERM_PROGRAM_VERSION: '3.6.6', FORCE_COLOR: '3', ITERM_SESSION_ID: '1',
      };
      delete terminalEnv.CLAUDECODE;
      ptyProcess = spawnSessionPty(shell, shellArgs(shell, undefined, shellExtraArgs), {
        name: 'xterm-256color',
        cols: 120,
        rows: 30,
        cwd: isWsl ? os.homedir() : projectPath,
        env: terminalEnv,
      }, {
        sid: sessionId, kind: 'terminal', shell: path.basename(shell), projectPath,
        projectId: sessionOptions?.projectId, trackId: sessionOptions?.trackId,
      });
    } else {
      // Argv is built by the harness and quoted here, so a value can never be
      // spliced into the command line as shell syntax.
      const cliArgs = harness.buildLaunchArgs({
        sessionId, isNew: startFresh, options: sessionOptions,
      });

      let claudeCmd = harness.binary;
      if (cliArgs.length) claudeCmd += ' ' + quoteArgvForShell(shell, cliArgs);

      // customArgs is raw shell too, like preLaunchCmd below: the user's shell
      // does the quoting, e.g. --settings '{"outputStyle": "Learning"}'
      if (sessionOptions?.customArgs) {
        const custom = String(sessionOptions.customArgs);
        if (/[\r\n]/.test(custom)) {
          return { ok: false, error: 'customArgs must not contain newlines' };
        }
        claudeCmd += ' ' + custom;
      }

      // preLaunchCmd is raw shell by design (e.g. "aws-vault exec profile --") — block newlines only
      if (sessionOptions?.preLaunchCmd) {
        const pre = String(sessionOptions.preLaunchCmd);
        if (/[\r\n]/.test(pre)) {
          return { ok: false, error: 'preLaunchCmd must not contain newlines' };
        }
        claudeCmd = pre + ' ' + claudeCmd;
      }

      // Start MCP server for this session so Claude CLI sends diffs/file opens to Switchboard
      // (skip if user disabled IDE emulation in global settings)
      if (isClaudeSession && sessionOptions?.mcpEmulation !== false) {
        try {
          mcpServer = await startMcpServer(sessionId, [projectPath], log);
          claudeCmd += ' --ide';
        } catch (err) {
          log.error(`[mcp] Failed to start MCP server for ${sessionId}: ${err.message}`);
        }
      }

      const ptyEnv = {
        ...cleanPtyEnv,
        TERM: 'xterm-256color', COLORTERM: 'truecolor',
        TERM_PROGRAM: 'iTerm.app', TERM_PROGRAM_VERSION: '3.6.6', FORCE_COLOR: '3', ITERM_SESSION_ID: '1',
        ...projectEnv,
      };
      // A harness that cannot be told its session id up front gets to stamp the
      // environment instead, so its transcript can be recognised afterwards.
      if (startFresh && harness.launchEnv) Object.assign(ptyEnv, harness.launchEnv(sessionId));
      if (mcpServer) {
        ptyEnv.CLAUDE_CODE_SSE_PORT = String(mcpServer.port);
      }

      ptyProcess = spawnSessionPty(shell, shellArgs(shell, claudeCmd, shellExtraArgs), {
        name: 'xterm-256color',
        cols: 120,
        rows: 30,
        cwd: isWsl ? os.homedir() : projectPath,
        // TERM_PROGRAM=iTerm.app: Claude Code checks this to decide whether to emit
        // OSC 9 notifications (e.g. "needs your attention"). Without it, the packaged
        // app's minimal Electron environment won't trigger those sequences.
        env: ptyEnv,
      }, {
        sid: sessionId, kind: 'cli', runtime: runtimeId, projectPath,
        projectId: sessionOptions?.projectId, trackId: sessionOptions?.trackId, forkFrom: sessionOptions?.forkFrom,
        ide: mcpServer ? '1' : undefined,
      });

    }
  } catch (err) {
    return { ok: false, error: `Error spawning PTY: ${err.message}` };
  }

  const session = {
    pty: ptyProcess, rendererAttached: true, exited: false,
    outputBuffer: [], outputBufferSize: 0, altScreen: false,
    projectPath, firstResize: true,
    projectFolder, knownJsonlFiles, sessionSlug,
    isPlainTerminal, runtime: runtimeId, forkFrom: sessionOptions?.forkFrom || null,
    // A plain terminal has no CLI to report a busy state, so one is derived
    // from the shell's own OSC 133 prompt marks, or from the PTY's foreground
    // process when the shell sends none. A harness session already has the
    // OSC 0 / OSC 9;4 handlers below.
    activity: isPlainTerminal ? createTerminalActivity({
      shellName: path.basename(shell),
      // On Windows `pty.process` is the console title, not a process name.
      canPollProcess: process.platform !== 'win32',
    }) : null,
    // Plain terminals have no transcript row to carry their project filing.
    // Keep the launch context on the live PTY so renderer reloads can put a
    // terminal started in an attached folder back into the same project/track.
    projectId: sessionOptions?.projectId || null,
    trackId: sessionOptions?.trackId || null,
    // Set for a harness whose real session id only appears once its transcript
    // does; cleared by resolvePendingLaunches when the transcript is matched.
    pendingLaunch: (harness?.needsIdDetection?.({ isNew: startFresh, options: sessionOptions })) ? {
      tag: harness.originatorTag ? harness.originatorTag(sessionId) : null,
      // A fork is identified by its parent, not by our env tag — codex copies
      // the originator from the thread being forked.
      forkFrom: sessionOptions?.forkFrom || null,
      projectPath,
      spawnedAt: Date.now(),
    } : null,
    mcpServer, _openedAt: Date.now(),
  };
  activeSessions.set(sessionId, session);
  if (session.activity) startTerminalActivitySweep();
  // In herdr-core, what a later start needs to pick this session up again.
  if (ptyProcess.relabel) {
    ptyProcess.relabel({
      openedAt: session._openedAt,
      pendingTag: session.pendingLaunch?.tag || '',
      pendingSpawnedAt: session.pendingLaunch ? session.pendingLaunch.spawnedAt : '',
    });
  }

  // A session launched from a project is filed there. Recorded under whatever
  // id the session has right now; resolvePendingLaunches moves it to the real
  // id for a harness that only learns its id from the transcript.
  if (startFresh && !isPlainTerminal && sessionOptions?.projectId) {
    try {
      const assignment = projects.recordLaunchAssignment(sessionId, sessionOptions);
      if (assignment) {
        session.projectId = assignment.projectId;
        session.trackId = assignment.trackId;
        // Started from a phase or a todo on the project page.
        const item = sessionOptions.planItem;
        if (item?.itemText) projects.recordPlanLink(assignment.projectId, item.file, item.itemText, sessionId, 'started');
      }
    } catch (err) {
      log.error('[projects] could not record launch assignment', err);
    }
  }
  // Started by a schedule: the session remembers which, the schedule
  // remembers the run. Folder schedules have no project, so this is separate
  // from the assignment above.
  if (startFresh && !isPlainTerminal && sessionOptions?.scheduleId) {
    try { projects.recordScheduleRun(sessionOptions.scheduleId, sessionId); } catch (err) {
      log.error('[schedule] could not record the run', err);
    }
  }
  // A resumed project session is a project session too, for the plan watcher.
  if (!isPlainTerminal && !session.projectId) {
    const meta = getMeta(session.realSessionId || sessionId);
    if (meta?.projectId) { session.projectId = meta.projectId; session.trackId = meta.trackId || null; }
  }

  wireSessionPty(sessionId, session, harness);

  if (sessionOptions?.forkFrom) {
    log.info(`[fork-spawn] tempId=${sessionId} forkFrom=${sessionOptions.forkFrom} folder=${projectFolder} knownFiles=${knownJsonlFiles.size}`);
  }

  return { ok: true, reattached: false, mcpActive: !!mcpServer };
});

// --- IPC: terminal-input (fire-and-forget) ---
ipcMain.on('terminal-input', (_event, sessionId, data) => {
  const session = activeSessions.get(sessionId);
  if (session && !session.exited) {
    session.pty.write(data);
  }
});

// --- IPC: terminal-resize (fire-and-forget) ---
ipcMain.on('terminal-resize', (_event, sessionId, cols, rows) => {
  const session = activeSessions.get(sessionId);
  if (session && !session.exited) {
    // The window's size, given back when a phone stops fitting the PTY to its own.
    session.desktopSize = { cols, rows };
    terminalFanout.resized(session, cols, rows);
    // For plain terminals, suppress buffering during resize to avoid
    // accumulating prompt redraws that pollute reattach replay
    if (session.isPlainTerminal) session._suppressBuffer = true;

    session.pty.resize(cols, rows);

    if (session.isPlainTerminal) {
      setTimeout(() => { session._suppressBuffer = false; }, 200);
    }

    // First resize: nudge to force TUI redraw on reattach (skip for plain terminals — causes duplicate prompts)
    if (session.firstResize && !session.isPlainTerminal) {
      session.firstResize = false;
      setTimeout(() => {
        try {
          session.pty.resize(cols + 1, rows);
          setTimeout(() => {
            try { session.pty.resize(cols, rows); } catch {}
          }, 50);
        } catch {}
      }, 50);
    }
  }
});

// --- IPC: close-terminal ---
ipcMain.on('close-terminal', (_event, sessionId) => {
  const session = activeSessions.get(sessionId);
  if (session) {
    session.rendererAttached = false;
    if (session.exited) {
      activeSessions.delete(sessionId);
    }
  }
});

// --- Plain-terminal activity: working, or waiting at the prompt? ---

/** One place to tell the renderer a terminal started or stopped working. */
function sendTerminalBusy(session, sessionId, busy) {
  session._cliBusy = busy;
  log.debug(`[terminal-activity] session=${sessionId} → ${busy ? 'BUSY' : 'IDLE'} ${JSON.stringify(session.activity.state())}`);
  emit('cli-busy-state', sessionId, busy);
}

// One sweep for every tracked terminal rather than a timer each. Reading
// `pty.process` costs ~18us, and only a shell that sends no prompt marks is
// read at all, so 50 terminals stay well under a millisecond per sweep.
const TERMINAL_ACTIVITY_INTERVAL_MS = 500;
let terminalActivityTimer = null;

function sweepTerminalActivity() {
  let tracked = 0;
  for (const [sessionId, session] of activeSessions) {
    if (!session.activity || session.exited) continue;
    tracked++;
    let busy = null;
    if (session.activity.needsPoll()) {
      // A PTY that has just exited throws here rather than returning a name.
      let name = null;
      try { name = session.pty.process; } catch {}
      busy = session.activity.feedProcess(name);
    }
    // Ticked either way: a silent command crosses the busy threshold with no
    // output to settle on.
    if (busy === null) busy = session.activity.tick();
    if (busy !== null) sendTerminalBusy(session, sessionId, busy);
  }
  if (tracked === 0) {
    clearInterval(terminalActivityTimer);
    terminalActivityTimer = null;
  }
}

/** Started when the first terminal appears, stopped when the last one goes. */
function startTerminalActivitySweep() {
  if (terminalActivityTimer) return;
  terminalActivityTimer = setInterval(sweepTerminalActivity, TERMINAL_ACTIVITY_INTERVAL_MS);
  terminalActivityTimer.unref?.();
}

// Session transitions → session-transitions.js
const sessionTransitions = require('./session-transitions');
sessionTransitions.init({ PROJECTS_DIR, activeSessions, log, rekeyMcpServer, copySessionAssignment });
const { detectSessionTransitions } = sessionTransitions;

// --- fs.watch on projects directory ---
let projectsWatcher = null;

function startProjectsWatcher() {
  if (!fs.existsSync(PROJECTS_DIR)) return;
  if (!harnessEnabled(DEFAULT_HARNESS)) return;

  const pendingFolders = new Set();
  let debounceTimer = null;

  function flushChanges() {
    debounceTimer = null;
    const folders = new Set(pendingFolders);
    pendingFolders.clear();

    // Claim a fork's transcript before indexing it, so the renderer learns the
    // real id in the same beat the row appears. A Claude fork mints its own id
    // (--fork-session ignores --session-id), so it needs this exactly as codex
    // sessions do.
    if (hasPendingLaunches()) {
      const candidates = [];
      for (const folder of folders) {
        try { candidates.push(...claudeHarness.listTranscripts(path.join(PROJECTS_DIR, folder))); } catch {}
      }
      resolvePendingLaunches(candidates);
    }

    let changed = false;
    for (const folder of folders) {
      const folderPath = path.join(PROJECTS_DIR, folder);
      if (fs.existsSync(folderPath)) {
        detectSessionTransitions(folder);
        refreshFolder(folder);
      } else refreshFolder(folder);
      changed = true;
    }

    if (changed) {
      // A transcript folder moved: sessions only, not the projects themselves.
      notifyRendererProjectsChanged('sessions');
    }
  }

  try {
    projectsWatcher = fs.watch(PROJECTS_DIR, { recursive: true }, (_eventType, filename) => {
      if (!filename) return;

      // filename is relative, e.g. "folder-name/sessions-index.json" or "folder-name/abc.jsonl"
      const parts = filename.split(path.sep);
      const folder = parts[0];
      if (!folder || folder === '.git') return;

      // Only care about .jsonl changes or top-level folder add/remove
      const basename = parts[parts.length - 1];
      if (parts.length === 1) {
        pendingFolders.add(folder);
      } else if (basename.endsWith('.jsonl')) {
        pendingFolders.add(folder);
      } else {
        return;
      }

      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(flushChanges, 500);
    });

    projectsWatcher.on('error', (err) => {
      console.error('Projects watcher error:', err);
    });
  } catch (err) {
    console.error('Failed to start projects watcher:', err);
  }
}

/**
 * Adopt a just-written transcript as the real identity of a pending session.
 *
 * A harness that cannot be told its session id up front (codex) is launched
 * under a temporary uuid. When its transcript appears, the session is re-keyed
 * onto the real id — everything downstream (terminal data, exit, the renderer's
 * sidebar row) follows session.realSessionId, exactly as fork detection does.
 */
function resolvePendingLaunches(candidatePaths) {
  for (const [tempId, session] of [...activeSessions]) {
    if (session.exited || !session.pendingLaunch || session.realSessionId) continue;
    const harness = getHarness(session.runtime);
    if (!harness.matchesLaunch) continue;

    for (const filePath of candidatePaths) {
      const signals = harness.readLaunchSignals(filePath);
      if (!harness.matchesLaunch(signals, session.pendingLaunch)) continue;
      // Another live session already owns this transcript.
      if (activeSessions.has(signals.sessionId)) continue;

      const realId = signals.sessionId;
      log.info(`[launch-detect] ${tempId} → ${realId} (originator=${signals.originator || 'none'})`);
      session.realSessionId = realId;
      session.pendingLaunch = null;
      activeSessions.delete(tempId);
      activeSessions.set(realId, session);
      // A Claude fork's IDE server was started under the launch id.
      rekeyMcpServer(tempId, realId);
      // In herdr-core the labels say which session this is on the next start.
      session.pty?.relabel?.({ sid: realId, pendingTag: '', pendingSpawnedAt: '' });
      if (session.projectId) {
        try {
          moveSessionAssignment(tempId, realId);
          rekeyPlanLinks(tempId, realId);
        } catch (err) { log.error('[projects] assignment move failed', err); }
      }
      try { dbModule.rekeyScheduleSession(tempId, realId); } catch (err) { log.error('[schedule] rekey failed', err); }
      emit('session-detected', tempId, realId);
      break;
    }
  }
}

/**
 * Look through every folder a pending session could have landed in.
 *
 * Only the folders that changed since the launch are worth reading, which in
 * practice is today's date directory.
 */
function sweepPendingLaunches() {
  const roots = new Map(); // harness → earliest spawn time still waiting
  for (const session of activeSessions.values()) {
    if (session.exited || !session.pendingLaunch || session.realSessionId) continue;
    const h = getHarness(session.runtime);
    if (!h.matchesLaunch) continue;
    const at = session.pendingLaunch.spawnedAt;
    roots.set(h, Math.min(roots.get(h) ?? at, at));
  }

  for (const [h, since] of roots) {
    const candidates = [];
    // Claude's folders live under the injected PROJECTS_DIR, not its own root.
    const dirs = h.folderPrefix
      ? h.listFolders().map(f => h.folderPath(f.slice(h.folderPrefix.length)))
      : h.listFolders().map(f => path.join(PROJECTS_DIR, f));
    for (const dir of dirs) {
      for (const filePath of h.listTranscripts(dir)) {
        try {
          if (fs.statSync(filePath).mtimeMs >= since - 60000) candidates.push(filePath);
        } catch {}
      }
    }
    resolvePendingLaunches(candidates);
  }
}

/** Is any session still waiting for its transcript to appear? */
function hasPendingLaunches() {
  for (const session of activeSessions.values()) {
    if (!session.exited && session.pendingLaunch && !session.realSessionId) return true;
  }
  return false;
}

// --- fs.watch on each non-Claude harness's sessions directory ---
//
// Separate from startProjectsWatcher because the path shape is different: a
// Claude event names <project-folder>/<file>, a codex event names
// <YYYY>/<MM>/<DD>/<file>. Both end up calling refreshFolder with a folder key.
const harnessWatchers = [];

function resolveHarnessFolderPath(folder) {
  const h = getHarnessForFolder(folder);
  return h.folderPath(h.folderPrefix ? folder.slice(h.folderPrefix.length) : folder);
}

function stopHarnessWatchers() {
  while (harnessWatchers.length) {
    try { harnessWatchers.pop().close(); } catch {}
  }
}

function startHarnessWatchers() {
  for (const h of availableHarnesses()) {
    if (!h.folderPrefix) continue; // Claude's root is startProjectsWatcher's job
    if (!harnessEnabled(h.id)) continue;
    const root = h.sessionsRoot();
    if (!fs.existsSync(root)) continue;

    const pendingFolders = new Set();
    let debounceTimer = null;

    function flush() {
      debounceTimer = null;
      const folders = new Set(pendingFolders);
      pendingFolders.clear();

      // Claim transcripts before indexing them, so the renderer learns the real
      // session id in the same beat the row appears.
      if (hasPendingLaunches()) {
        const candidates = [];
        for (const folder of folders) {
          try { candidates.push(...h.listTranscripts(resolveHarnessFolderPath(folder))); } catch {}
        }
        resolvePendingLaunches(candidates);
      }

      for (const folder of folders) {
        try { refreshFolder(folder); } catch (err) { log.error('[harness-watch]', folder, err.message); }
      }
      const titlesChanged = refreshHarnessTitles(h);
      if (folders.size || titlesChanged) notifyRendererProjectsChanged('sessions');
    }

    try {
      const watcher = fs.watch(root, { recursive: true }, (_eventType, filename) => {
        if (!filename) return;
        const parts = filename.split(path.sep);
        // Transcripts sit at <YYYY>/<MM>/<DD>/<file>; anything shallower is a
        // directory being created, which the next file event will cover.
        if (parts.length < 4 || !parts[parts.length - 1].endsWith('.jsonl')) return;
        pendingFolders.add(h.folderPrefix + parts.slice(0, 3).join('/'));
        if (debounceTimer) clearTimeout(debounceTimer);
        debounceTimer = setTimeout(flush, 500);
      });
      watcher.on('error', (err) => log.error(`[harness-watch] ${h.id}:`, err.message));
      harnessWatchers.push(watcher);
      log.info(`[harness-watch] watching ${h.id} at ${root}`);
    } catch (err) {
      log.error(`[harness-watch] failed to watch ${h.id}:`, err.message);
    }

    // Codex names live next to sessions/, not underneath it, so the recursive
    // transcript watcher above can never observe an auto-title or `/rename`.
    // Watch the containing directory so atomic replacement of the index is
    // handled as well as ordinary appends.
    if (h.titleIndexPath && h.readSessionTitles) {
      const indexPath = h.titleIndexPath();
      const indexDir = path.dirname(indexPath);
      const indexName = path.basename(indexPath);
      let titleTimer = null;
      try {
        const titleWatcher = fs.watch(indexDir, (_eventType, filename) => {
          if (filename && String(filename) !== indexName) return;
          if (titleTimer) clearTimeout(titleTimer);
          titleTimer = setTimeout(() => {
            titleTimer = null;
            if (refreshHarnessTitles(h)) notifyRendererProjectsChanged('sessions');
          }, 300);
        });
        titleWatcher.on('error', (err) => log.error(`[harness-title-watch] ${h.id}:`, err.message));
        harnessWatchers.push(titleWatcher);
        log.info(`[harness-title-watch] watching ${h.id} at ${indexPath}`);
      } catch (err) {
        log.error(`[harness-title-watch] failed to watch ${h.id}:`, err.message);
      }
    }
  }
}

// --- IPC: app version ---
ipcMain.handle('get-app-version', () => app.getVersion());

// --- IPC: auto-updater ---
ipcMain.handle('updater-check', () => {
  if (!autoUpdater) return { available: false, dev: true };
  return autoUpdater.checkForUpdates();
});
ipcMain.handle('updater-download', () => {
  if (!autoUpdater) return;
  return autoUpdater.downloadUpdate();
});
ipcMain.handle('updater-install', () => {
  if (!autoUpdater) return;
  autoUpdater.quitAndInstall();
});
// On macOS quitAndInstall closes the window before before-quit, and a closed
// window may only hide: mark the quit once Squirrel really starts it.
if (process.platform === 'darwin') {
  require('electron').autoUpdater.on('before-quit-for-update', () => { appIsQuitting = true; });
}

// --- App lifecycle ---
// Prevent a second Electron instance from killing active PTY sessions.
// This happens when the user replaces the AppImage while Switchboard is running:
// the OS spawns the new binary, which would otherwise initialise a second process
// and leave the first one's node-pty sessions orphaned or killed.
// requestSingleInstanceLock ensures only one instance runs at a time. The second
// launch quits immediately; the first brings its window to the front.
const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
} else {
  // Focus the existing window when a second launch is attempted.
  app.on('second-instance', () => {
    if (mainWindow) showWindow(mainWindow);
  });


// --- Scheduled task ticker ---
// Main owns the clock: a renderer timer is throttled while the window is
// hidden, and a schedule has to fire at the minute it names. Each fire is one
// 'schedule-due' event; the renderer launches the session, because the
// terminal lives there. A schedule whose last session is still working is
// skipped by projects.dueSchedules.
let scheduleTickerStop = null;
// "Still working" is the CLI being busy, not the PTY being open: an
// interactive session sits at its prompt until someone closes it, and that
// must not stop the next run.
function isSessionBusy(sessionId) {
  const session = activeSessions.get(sessionId);
  return !!session && !session.exited && !!session._cliBusy;
}
function fireSchedules(ids, reason) {
  if (!ids.length || !mainWindow || mainWindow.isDestroyed()) return;
  for (const id of ids) {
    const launch = projects.resolveScheduleLaunch(id);
    if (launch.error) { log.warn(`[schedule] ${id}: ${launch.error}`); continue; }
    log.info(`[schedule] ${reason}: ${launch.schedule.name}`);
    emit('schedule-due', launch);
  }
}
function startScheduleTicker() {
  if (scheduleTickerStop) return;
  let interval = null;
  const tick = () => {
    try { fireSchedules(projects.dueSchedules(new Date(), isSessionBusy), 'due'); } catch (err) {
      log.error('[schedule] tick failed', err);
    }
  };
  // Align to the minute so a 9:00 schedule fires at 9:00:00, not 9:00:37.
  const first = setTimeout(() => { tick(); interval = setInterval(tick, 60 * 1000); }, (60 - new Date().getSeconds()) * 1000);
  // Catch-up runs, for schedules that asked for it, once the renderer has had
  // time to load. Missed while the app was closed means missed since the last
  // run (projects.missedSchedules).
  const catchUp = setTimeout(() => {
    try { fireSchedules(projects.missedSchedules(new Date(), isSessionBusy), 'catch-up'); } catch (err) {
      log.error('[schedule] catch-up failed', err);
    }
  }, 20 * 1000);
  scheduleTickerStop = () => { clearTimeout(first); clearTimeout(catchUp); if (interval) clearInterval(interval); scheduleTickerStop = null; };
}

  app.whenReady().then(() => {
    protocol.handle(PREVIEW_SCHEME, handlePreviewAssetRequest);
    buildMenu();
    initializeHiddenProjectTimestamps();
    sessionsReady = startTerminalEngine();
    createWindow();
    startProjectsWatcher();
    startHarnessWatchers();
    // Retry legacy imports each launch; successful files are remembered in
    // the DB, including deleted tasks. Missing folders can be picked up later.
    // Then tick once a minute and launch due tasks through the renderer.
    try {
      const imported = projects.importLegacySchedules(scanSchedules(log));
      if (imported) log.info(`[schedule] Imported ${imported} schedule file(s) as folder schedules`);
    } catch (err) { log.error('[schedule] legacy import failed', err); }
    startScheduleTicker();
    // The remote-access switch stays where it was left.
    if (remoteAccessSettings().enabled) startRemoteAccess();

    // Re-index search if FTS table was recreated (e.g. tokenizer config change)
    if (searchFtsRecreated) populateCacheViaWorker();

    // Check for updates after launch
    if (autoUpdater) {
      setTimeout(() => autoUpdater.checkForUpdates().catch(e => log.error('[updater] check failed:', e?.message || String(e))), 5000);
      // Re-check every 4 hours for long-running sessions
      setInterval(() => autoUpdater.checkForUpdates().catch(e => log.error('[updater] check failed:', e?.message || String(e))), 4 * 60 * 60 * 1000);
    }

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
      else if (mainWindow) showWindow(mainWindow);
    });
  }); // end app.whenReady
} // end gotSingleInstanceLock else-branch

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  // The renderer persists raw-terminal descriptors and scrollback during its
  // unload. Do not report the shutdown kills as user-initiated terminal exits,
  // or that renderer cleanup would delete the descriptors before restart.
  appIsQuitting = true;
  remoteTunnels.stop();
  remoteServer.stop();
  // Shut down all MCP servers
  shutdownAllMcp();
  taskManager.shutdown();

  // Close filesystem watcher
  if (projectsWatcher) {
    projectsWatcher.close();
    projectsWatcher = null;
  }

  // Kill all PTY processes on quit. Sessions in herdr-core are left running:
  // Switchboard only stops viewing them, and the next start finds them again.
  for (const [, session] of activeSessions) {
    if (session.exited) continue;
    if (session.pty?.detach) continue;
    try { session.pty.kill(); } catch {}
  }
  if (hcEngine) { try { hcEngine.close(); } catch {} }
});

// Close SQLite after all windows are closed to avoid "connection is not open" errors
app.on('will-quit', () => {
  closeDb();
});
