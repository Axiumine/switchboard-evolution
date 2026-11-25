// lsp/manager.js — the language servers the editors use, run by the main
// process and spoken to over IPC.
//
// A session is one server process for one window, one project folder and one
// server: the window's editors share it through their LSPClient (the editor's
// add-on, public/editor/addons/lsp.mjs). A second client on the same process
// would break the documents' versions, so another window gets its own.
//
// The manager sits between the client and the server:
// - it completes the client's initialize: the folder as workspace folder, its
//   own process id, the server's initializationOptions, workspace
//   configuration support, and no pull diagnostics (the client only takes the
//   ones the server sends);
// - it answers the server's requests the client does not know
//   (workspace/configuration from the table's settings, capability
//   registrations, progress tokens, workspace folders, refreshes);
// - it follows $/progress for the status bar ("Indexing…") and counts the
//   open documents: a server with none left stops after IDLE_MS;
// - at most MAX_SERVERS run together (the least recently used idle one makes
//   room); a server that exits on its own starts again, up to CRASH_LIMIT
//   times in CRASH_WINDOW_MS, after which it waits for a Restart.
//
// Events to the window that owns a session: send(ownerId, 'lsp-message',
// sessionId, json) and send(ownerId, 'lsp-state', sessionId, { state, message }).
// States: starting, ready, indexing, restarted (the client connects again),
// error, stopped. With the app's "Language servers" switched off (`isOn`),
// nothing starts.

const path = require('path');
const { pathToFileURL } = require('url');
const { spawn: nodeSpawn } = require('child_process');
const { encodeMessage, MessageReader } = require('./framing');
const { serverForFile, DEFAULT_TIMEOUT } = require('./servers');

const IDLE_MS = 5 * 60 * 1000;
const MAX_SERVERS = 6;
const CRASH_LIMIT = 3;
const CRASH_WINDOW_MS = 60 * 1000;
const STOP_GRACE_MS = 2000;
const LOG_LINES_PER_MINUTE = 30;

/** The value of a dotted `section` ('python.analysis') in a settings object, or the whole object; null when absent. */
function settingsSection(settings, section) {
  if (!settings) return null;
  if (!section) return settings;
  let value = settings;
  for (const key of String(section).split('.')) {
    if (!value || typeof value !== 'object' || !(key in value)) return null;
    value = value[key];
  }
  return value;
}

/** The client's initialize params, completed for this folder and server. */
function completeInitialize(params, { rootUri, folder, server, pid = process.pid }) {
  const p = { ...(params || {}) };
  p.processId = pid;
  p.rootUri = rootUri;
  p.rootPath = folder;
  p.workspaceFolders = [{ uri: rootUri, name: path.basename(folder) }];
  p.clientInfo = { name: 'Switchboard Evolution' };
  const caps = { ...(p.capabilities || {}) };
  caps.workspace = { ...(caps.workspace || {}), configuration: true, workspaceFolders: true };
  caps.window = { ...(caps.window || {}), workDoneProgress: true };
  if (caps.textDocument && caps.textDocument.diagnostic) {
    caps.textDocument = { ...caps.textDocument };
    delete caps.textDocument.diagnostic;
  }
  p.capabilities = caps;
  if (server.initializationOptions && p.initializationOptions === undefined) p.initializationOptions = server.initializationOptions;
  return p;
}

const REFRESHES = new Set([
  'workspace/semanticTokens/refresh', 'workspace/inlayHint/refresh', 'workspace/codeLens/refresh',
  'workspace/diagnostic/refresh', 'workspace/inlineValue/refresh', 'workspace/foldingRange/refresh',
]);

/**
 * The answer to a server's request the manager gives itself, or undefined to
 * pass it to the client.
 */
function answerServerRequest(message, { server, rootUri, folder }) {
  const { method, params } = message;
  if (method === 'workspace/configuration') {
    return ((params && params.items) || []).map(item => settingsSection(server.settings, item.section));
  }
  if (method === 'workspace/workspaceFolders') return [{ uri: rootUri, name: path.basename(folder) }];
  if (method === 'client/registerCapability' || method === 'client/unregisterCapability') return null;
  if (method === 'window/workDoneProgress/create' || method === 'window/showMessageRequest') return null;
  if (method === 'workspace/applyEdit') return { applied: false, failureReason: 'The editor does not apply edits a server sends on its own' };
  if (REFRESHES.has(method)) return null;
  return undefined;
}

function createLspManager({
  projectServers, locate, send, log = console, dataDir, isOn = () => true,
  spawn = nodeSpawn, env = async () => process.env, platform = process.platform,
  now = Date.now, setTimer = setTimeout, clearTimer = clearTimeout,
}) {
  const sessions = new Map(); // sessionId → session
  let nextId = 1;
  let logBudget = { minute: 0, lines: 0 };

  function logServer(s, text) {
    const minute = Math.floor(now() / 60000);
    if (logBudget.minute !== minute) logBudget = { minute, lines: 0 };
    if (++logBudget.lines > LOG_LINES_PER_MINUTE) return;
    log.info?.(`[lsp ${s.server.id}] ${String(text).trim().slice(0, 500)}`);
  }

  function setState(s, state, message = '') {
    s.state = state;
    s.message = message;
    send(s.ownerId, 'lsp-state', s.id, { state, message, label: s.server.label });
  }

  function describe(s, languageId) {
    return {
      sessionId: s.id,
      serverId: s.server.id,
      label: s.server.label,
      languageId,
      rootUri: s.rootUri,
      folder: s.folder,
      projectId: s.projectId,
      state: s.state,
      message: s.message,
      timeout: s.server.timeout || DEFAULT_TIMEOUT,
    };
  }

  function live() {
    return [...sessions.values()].filter(s => !s.stopping);
  }

  /** Room for one more server: stop the least recently used idle one when MAX_SERVERS run. */
  function makeRoom() {
    const running = live();
    if (running.length < MAX_SERVERS) return true;
    const idle = running.filter(s => s.openDocs.size === 0).sort((a, b) => a.lastUsed - b.lastUsed);
    if (!idle.length) return false;
    stopSession(idle[0], 'Closed to make room for another language server');
    return true;
  }

  /**
   * A server for `filePath` in the window `ownerId`: the session to connect to
   * ({ sessionId, serverId, languageId, rootUri, timeout … }) or why there is none
   * ({ unavailable: 'no-server' | 'switched-off' | 'outside-project' | 'off' | 'not-installed' | 'too-many', … }).
   */
  async function open({ ownerId, filePath }) {
    if (!isOn()) return { unavailable: 'switched-off' };
    const match = serverForFile(filePath);
    if (!match) return { unavailable: 'no-server' };
    const { server, languageId } = match;
    const base = { serverId: server.id, label: server.label, languageId };
    const place = projectServers.folderOf(filePath);
    if (!place) return { unavailable: 'outside-project', ...base };
    if (!(await projectServers.isEnabled(place.projectId, server.id))) return { unavailable: 'off', projectId: place.projectId, ...base };
    const key = `${ownerId}|${server.id}|${place.folder}`;
    const existing = [...sessions.values()].find(s => s.key === key && !s.stopping);
    if (existing) {
      existing.lastUsed = now();
      return describe(existing, languageId);
    }
    const located = await locate(server, { root: place.folder, dataDir });
    if (!located) return { unavailable: 'not-installed', projectId: place.projectId, install: server.install, command: server.commands[0].bin, ...base };
    if (!makeRoom()) return { unavailable: 'too-many', projectId: place.projectId, ...base };
    const s = {
      id: `lsp-${nextId++}`,
      key,
      ownerId,
      server,
      located,
      folder: place.folder,
      projectId: place.projectId,
      rootUri: pathToFileURL(place.folder).href.replace(/\/$/, ''),
      openDocs: new Set(),
      progress: new Map(),
      crashes: [],
      lastUsed: now(),
      state: 'starting',
      message: '',
    };
    sessions.set(s.id, s);
    await start(s);
    return describe(s, languageId);
  }

  async function start(s) {
    s.stopping = false;
    s.reader = new MessageReader();
    s.awaitingInitialize = true;
    s.initializeId = null;
    s.progress.clear();
    const childEnv = await env();
    const isScript = platform === 'win32' && /\.(cmd|bat)$/i.test(s.located.path);
    const quote = arg => (/[\s"]/.test(arg) ? `"${arg.replace(/"/g, '\\"')}"` : arg);
    let child;
    try {
      child = isScript
        ? spawn(`"${s.located.path}"`, s.located.args.map(quote), { cwd: s.folder, env: childEnv, shell: true, windowsHide: true })
        : spawn(s.located.path, s.located.args, { cwd: s.folder, env: childEnv, windowsHide: true });
    } catch (err) {
      setState(s, 'error', `Could not start ${s.located.bin}: ${err.message}`);
      return;
    }
    s.child = child;
    setState(s, 'starting');
    child.stdout.on('data', (chunk) => {
      let messages;
      try { messages = s.reader.push(chunk); } catch (err) {
        logServer(s, err.message);
        if (s.child === child) child.kill();
        return;
      }
      for (const text of messages) fromServer(s, text);
    });
    child.stderr.on('data', chunk => logServer(s, chunk));
    child.on('error', (err) => {
      if (s.child !== child) return;
      setState(s, 'error', `Could not start ${s.located.bin}: ${err.message}`);
    });
    child.on('exit', (code, signal) => onExit(s, child, code, signal));
    scheduleIdle(s);
  }

  function write(s, message) {
    if (!s.child || !s.child.stdin || s.child.stdin.destroyed) return;
    try { s.child.stdin.write(encodeMessage(message)); } catch (err) { logServer(s, `write failed: ${err.message}`); }
  }

  /** A message from the window's client to the server. */
  function fromClient(ownerId, sessionId, text) {
    const s = sessions.get(sessionId);
    if (!s || s.ownerId !== ownerId || s.stopping || !s.child) return;
    let message;
    try { message = JSON.parse(text); } catch { return; }
    if (!message || typeof message !== 'object') return;
    if (message.method === 'initialize' && message.id !== undefined) {
      s.awaitingInitialize = false;
      s.initializeId = message.id;
      message.params = completeInitialize(message.params, s);
    } else if (s.awaitingInitialize) {
      // The process started again: what the old connection still sends waits for nothing.
      return;
    } else if (message.method === 'textDocument/didOpen') {
      s.openDocs.add(message.params && message.params.textDocument && message.params.textDocument.uri);
      cancelIdle(s);
    } else if (message.method === 'textDocument/didClose') {
      s.openDocs.delete(message.params && message.params.textDocument && message.params.textDocument.uri);
      if (!s.openDocs.size) scheduleIdle(s);
    }
    s.lastUsed = now();
    write(s, message);
  }

  function fromServer(s, text) {
    let message;
    try { message = JSON.parse(text); } catch { logServer(s, 'unreadable message'); return; }
    if (message.method && message.id !== undefined) {
      const answer = answerServerRequest(message, s);
      if (answer !== undefined) {
        write(s, { jsonrpc: '2.0', id: message.id, result: answer });
        return;
      }
    } else if (message.method === 'window/logMessage' || message.method === 'telemetry/event') {
      if (message.params && message.params.type === 1) logServer(s, message.params.message);
      return;
    } else if (message.method === '$/progress') {
      progress(s, message.params || {});
      return;
    } else if (!message.method && message.id !== undefined && message.id === s.initializeId) {
      s.initializeId = null;
      if (message.error) setState(s, 'error', message.error.message || 'The server refused to start');
      else setState(s, 'ready');
    }
    send(s.ownerId, 'lsp-message', s.id, text);
  }

  function progress(s, { token, value }) {
    if (!value) return;
    if (value.kind === 'begin') s.progress.set(token, value.title || '');
    else if (value.kind === 'report' && s.progress.has(token)) s.progress.set(token, value.message || s.progress.get(token));
    else if (value.kind === 'end') s.progress.delete(token);
    if (s.state === 'error' || s.state === 'starting') return;
    if (s.progress.size) setState(s, 'indexing', [...s.progress.values()].filter(Boolean).pop() || 'Indexing…');
    else if (s.state === 'indexing') setState(s, 'ready');
  }

  function scheduleIdle(s) {
    cancelIdle(s);
    s.idleTimer = setTimer(() => {
      if (!s.openDocs.size) stopSession(s, 'Stopped: no file open for a while');
    }, IDLE_MS);
  }

  function cancelIdle(s) {
    if (s.idleTimer) clearTimer(s.idleTimer);
    s.idleTimer = null;
  }

  function onExit(s, child, code, signal) {
    if (s.child !== child) return;
    s.child = null;
    for (const t of s.killTimers || []) clearTimer(t);
    if (s.stopping) {
      sessions.delete(s.id);
      setState(s, 'stopped', s.stopReason || '');
      if (s.onStopped) s.onStopped();
      return;
    }
    const t = now();
    s.crashes = s.crashes.filter(at => t - at < CRASH_WINDOW_MS);
    s.crashes.push(t);
    const why = signal ? `killed (${signal})` : `exited with code ${code}`;
    logServer(s, why);
    if (s.crashes.length < CRASH_LIMIT) {
      start(s).then(() => setState(s, 'restarted', `The server ${why} and started again`));
    } else {
      cancelIdle(s);
      setState(s, 'error', `The server ${why} ${CRASH_LIMIT} times in a minute`);
    }
  }

  /** Stop a session's server: shutdown and exit, then SIGTERM and SIGKILL if it lingers. */
  function stopSession(s, reason = '') {
    if (s.stopping) return s.stopped;
    s.stopping = true;
    s.stopReason = reason;
    cancelIdle(s);
    s.stopped = new Promise((resolve) => { s.onStopped = resolve; });
    const child = s.child;
    if (!child) {
      sessions.delete(s.id);
      setState(s, 'stopped', reason);
      s.onStopped();
      return s.stopped;
    }
    write(s, { jsonrpc: '2.0', id: '__sb_shutdown', method: 'shutdown', params: null });
    write(s, { jsonrpc: '2.0', method: 'exit', params: null });
    try { child.stdin.end(); } catch {}
    s.killTimers = [
      setTimer(() => { try { child.kill('SIGTERM'); } catch {} }, STOP_GRACE_MS),
      setTimer(() => { try { child.kill('SIGKILL'); } catch {} }, STOP_GRACE_MS * 2),
    ];
    return s.stopped;
  }

  function owned(ownerId, sessionId) {
    const s = sessions.get(sessionId);
    return s && s.ownerId === ownerId ? s : null;
  }

  /** The window's client is done with the session: stop its server. */
  function close(ownerId, sessionId) {
    const s = owned(ownerId, sessionId);
    return s ? stopSession(s, 'Closed') : Promise.resolve();
  }

  /** Start a session's server again (after it gave up, or on request): the client connects again. */
  async function restart(ownerId, sessionId) {
    const s = owned(ownerId, sessionId);
    if (!s) return { error: 'No such language server' };
    s.crashes = [];
    if (s.child) {
      const child = s.child;
      s.child = null; // its exit is not a crash
      try { child.kill(); } catch {}
    }
    await start(s);
    setState(s, 'restarted', 'Started again');
    return { ok: true };
  }

  /** A window closed: stop its servers. */
  function closeOwner(ownerId) {
    return Promise.all([...sessions.values()].filter(s => s.ownerId === ownerId).map(s => stopSession(s, 'Window closed')));
  }

  /** The app quits: stop every server, waiting at most `timeoutMs`. */
  function stopAll(timeoutMs = STOP_GRACE_MS * 2 + 500) {
    const all = Promise.all([...sessions.values()].map(s => stopSession(s, 'Quit')));
    return Promise.race([all, new Promise(r => setTimer(r, timeoutMs))]);
  }

  /** The app is going: kill what is left at once (stopAll's timers may not run any more). */
  function killAll() {
    for (const s of sessions.values()) {
      s.stopping = true;
      cancelIdle(s);
      if (s.child) { try { s.child.kill('SIGTERM'); } catch {} }
    }
  }

  function list() {
    return [...sessions.values()].map(s => ({ sessionId: s.id, ownerId: s.ownerId, serverId: s.server.id, folder: s.folder, state: s.state, openDocs: s.openDocs.size }));
  }

  return { open, fromClient, close, restart, closeOwner, stopAll, killAll, list, sessionFor: id => sessions.get(id) || null };
}

module.exports = {
  createLspManager, completeInitialize, answerServerRequest, settingsSection,
  IDLE_MS, MAX_SERVERS, CRASH_LIMIT, CRASH_WINDOW_MS,
};
