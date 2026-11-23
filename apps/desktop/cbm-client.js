// The app's one MCP session with codebase-memory-mcp (CBM).
//
// CBM speaks MCP over stdio: JSON-RPC 2.0, one message per line. A session is
// a small client process (~5 MB); the indexing and the graph live in CBM's
// daemon, which every CBM process of the user shares (the agents' sessions
// too). The session starts on the first call and stays up until the app
// quits; when it dies, the next call starts it again, unless it keeps dying,
// and then it waits for reset().
//
// The tools' input schemas are read once per session (tools/list): a call
// keeps only the arguments its tool declares (some refuse any other), and asks
// for `format: "json"` where the tool has it. The answer is its
// structuredContent, or its text parsed as JSON. A tool that reports an error
// (isError) rejects with a CbmError of code 'cbm-tool-error' and CBM's words.

const { spawn } = require('child_process');
const readline = require('readline');
const { EventEmitter } = require('events');

const PROTOCOL_VERSION = '2025-06-18';
const CALL_TIMEOUT_MS = 60_000;
const START_TIMEOUT_MS = 20_000;
const STOP_GRACE_MS = 2000;
// Crashes in this window that stop the automatic restarts until reset().
const CRASH_WINDOW_MS = 60_000;
const CRASH_LIMIT = 3;

class CbmError extends Error {
  constructor(message, code, data) {
    super(message);
    this.code = code;
    if (data !== undefined) this.data = data;
  }
}

/** A tool result as data: structuredContent, else the text as JSON, else { text }. */
function toolResult(result) {
  const content = Array.isArray(result?.content) ? result.content : [];
  const text = content.filter(c => c && c.type === 'text').map(c => c.text).join('\n');
  if (result?.isError) throw new CbmError(text.trim() || 'codebase-memory-mcp reported an error', 'cbm-tool-error');
  if (result && result.structuredContent && typeof result.structuredContent === 'object') return result.structuredContent;
  try {
    return JSON.parse(text);
  } catch {
    return { text };
  }
}

/**
 * `locate()` gives the binary to run ({ path, version, ok } or null), `env()`
 * the environment for it, `cwd` its folder (or a function giving it, asked at
 * each start). `spawnImpl` is replaced in tests.
 */
function createCbmClient({
  locate,
  env = () => process.env,
  cwd = undefined,
  spawnImpl = spawn,
  log = console,
  clientInfo = { name: 'switchboard-evolution', version: '0' },
  callTimeoutMs = CALL_TIMEOUT_MS,
  startTimeoutMs = START_TIMEOUT_MS,
  now = () => Date.now(),
} = {}) {
  const events = new EventEmitter();
  let child = null;
  let starting = null;
  let binary = null;
  let serverInfo = null;
  let nextId = 1;
  let lastError = null;
  let crashes = [];
  let halted = false;
  let schemas = new Map(); // tool → Set of argument names, from tools/list
  const pending = new Map();

  function failPending(err) {
    for (const { reject, timer } of pending.values()) {
      clearTimeout(timer);
      reject(err);
    }
    pending.clear();
  }

  function send(proc, message) {
    try {
      proc.stdin.write(JSON.stringify(message) + '\n');
    } catch (err) {
      log.warn?.('[cbm] write failed', err.message);
    }
  }

  function handleLine(proc, line) {
    if (!line.trim()) return;
    let msg;
    try { msg = JSON.parse(line); } catch { return; }
    if (!msg || typeof msg !== 'object' || Array.isArray(msg)) return;
    if (msg.id != null && ('result' in msg || 'error' in msg)) {
      const entry = pending.get(msg.id);
      if (!entry) return;
      pending.delete(msg.id);
      clearTimeout(entry.timer);
      if (msg.error) entry.reject(new CbmError(msg.error.message || 'codebase-memory-mcp error', 'cbm-rpc-error', msg.error));
      else entry.resolve(msg.result);
      return;
    }
    if (msg.method && msg.id != null) {
      // A request from the server: only ping is expected (no roots, no sampling).
      if (msg.method === 'ping') send(proc, { jsonrpc: '2.0', id: msg.id, result: {} });
      else send(proc, { jsonrpc: '2.0', id: msg.id, error: { code: -32601, message: 'Method not found' } });
      return;
    }
    if (msg.method) events.emit('notification', msg);
  }

  function rawRequest(proc, method, params, timeoutMs) {
    return new Promise((resolve, reject) => {
      const id = nextId++;
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new CbmError(`codebase-memory-mcp did not answer ${method} within ${Math.round(timeoutMs / 1000)} s`, 'cbm-timeout'));
      }, timeoutMs);
      pending.set(id, { resolve, reject, timer });
      send(proc, { jsonrpc: '2.0', id, method, params });
    });
  }

  async function start() {
    const found = locate();
    if (!found) throw new CbmError('codebase-memory-mcp is not installed', 'cbm-missing');
    if (!found.ok) throw new CbmError(`codebase-memory-mcp ${found.version} is too old for this app`, 'cbm-old', { version: found.version });
    let proc;
    try {
      proc = spawnImpl(found.path, [], { cwd: typeof cwd === 'function' ? cwd() : cwd, env: env(), stdio: ['pipe', 'pipe', 'pipe'] });
    } catch (err) {
      throw new CbmError(`codebase-memory-mcp could not start: ${err.message}`, 'cbm-start');
    }
    child = proc;
    binary = { path: found.path, version: found.version, source: found.source };
    const stderr = [];
    proc.stderr?.on('data', (d) => { if (stderr.length < 50) stderr.push(String(d)); });
    proc.stdin.on('error', () => {});
    readline.createInterface({ input: proc.stdout }).on('line', (line) => handleLine(proc, line));
    const exited = new Promise((resolve) => {
      proc.on('error', (err) => resolve({ error: err }));
      proc.on('exit', (code, signal) => resolve({ code, signal }));
    });
    exited.then((how) => {
      if (child !== proc) return;
      child = null;
      serverInfo = null;
      const why = how.error ? how.error.message : (how.signal || `code ${how.code}`);
      const tail = stderr.join('').trim().split('\n').slice(-2).join(' ');
      lastError = `codebase-memory-mcp stopped (${why})${tail ? `: ${tail}` : ''}`;
      failPending(new CbmError(lastError, 'cbm-exited'));
      if (!proc.stopping) {
        const at = now();
        crashes = crashes.filter(t => at - t < CRASH_WINDOW_MS).concat(at);
        if (crashes.length >= CRASH_LIMIT) halted = true;
        log.warn?.(`[cbm] ${lastError}`);
      }
      events.emit('change');
    });
    try {
      const init = await Promise.race([
        rawRequest(proc, 'initialize', { protocolVersion: PROTOCOL_VERSION, capabilities: {}, clientInfo }, startTimeoutMs),
        exited.then(() => { throw new CbmError(lastError || 'codebase-memory-mcp stopped while starting', 'cbm-exited'); }),
      ]);
      send(proc, { jsonrpc: '2.0', method: 'notifications/initialized', params: {} });
      schemas = new Map();
      try {
        const listed = await rawRequest(proc, 'tools/list', {}, startTimeoutMs);
        for (const tool of Array.isArray(listed?.tools) ? listed.tools : []) {
          const props = tool?.inputSchema?.properties;
          if (tool?.name && props && typeof props === 'object') schemas.set(tool.name, new Set(Object.keys(props)));
        }
      } catch (err) {
        log.warn?.('[cbm] tools/list failed; arguments are sent as given', err.message);
      }
      serverInfo = init?.serverInfo || null;
      lastError = null;
      events.emit('change');
      return proc;
    } catch (err) {
      stopProcess(proc);
      throw err;
    }
  }

  function stopProcess(proc) {
    if (!proc) return;
    proc.stopping = true;
    if (child === proc) child = null;
    try { proc.stdin.end(); } catch {}
    const timer = setTimeout(() => { try { proc.kill('SIGKILL'); } catch {} }, STOP_GRACE_MS);
    timer.unref?.();
    proc.on?.('exit', () => clearTimeout(timer));
    try { proc.kill('SIGTERM'); } catch {}
  }

  async function ensure() {
    if (child && serverInfo) return child;
    if (starting) return starting;
    if (halted) throw new CbmError(lastError || 'codebase-memory-mcp keeps stopping', 'cbm-halted');
    starting = start().finally(() => { starting = null; });
    return starting;
  }

  async function request(method, params, { timeoutMs = callTimeoutMs } = {}) {
    const proc = await ensure();
    return rawRequest(proc, method, params, timeoutMs);
  }

  /** The arguments a tool takes, with format: 'json' where it has one. */
  function argumentsFor(tool, args) {
    const known = schemas.get(tool);
    const out = {};
    for (const [key, value] of Object.entries(args || {})) {
      if (value === undefined || key === 'format') continue;
      if (known && !known.has(key)) continue;
      out[key] = value;
    }
    if (!known || known.has('format')) out.format = 'json';
    return out;
  }

  /** Call a tool; resolves to its JSON answer. */
  async function call(tool, args = {}, opts = {}) {
    await ensure();
    const result = await request('tools/call', { name: tool, arguments: argumentsFor(tool, args) }, opts);
    return toolResult(result);
  }

  /** A prompt's text: CBM's explore_codebase or review_change_impact. */
  async function prompt(name, args = {}, opts = {}) {
    const result = await request('prompts/get', { name, arguments: args }, opts);
    const messages = Array.isArray(result?.messages) ? result.messages : [];
    return messages.map(m => (m?.content?.type === 'text' ? m.content.text : '')).filter(Boolean).join('\n\n');
  }

  /**
   * Look for the binary again; when it changed (an update, a download), the
   * running session stops and the next call starts the new one.
   */
  function refresh() {
    const found = locate();
    if (child && (!found || found.path !== binary?.path || found.version !== binary?.version)) {
      stopProcess(child);
      serverInfo = null;
      events.emit('change');
    }
    return found;
  }

  /** Start again after repeated crashes or a fixed install. */
  function reset() {
    halted = false;
    crashes = [];
    lastError = null;
    refresh();
  }

  function stop() {
    const proc = child;
    serverInfo = null;
    failPending(new CbmError('codebase-memory-mcp was stopped', 'cbm-stopped'));
    stopProcess(proc);
  }

  function status() {
    return {
      running: !!(child && serverInfo),
      binary: binary ? { ...binary } : null,
      server: serverInfo ? { ...serverInfo } : null,
      error: lastError,
      halted,
    };
  }

  return { call, prompt, request, refresh, reset, stop, status, on: events.on.bind(events), off: events.off.bind(events) };
}

module.exports = { createCbmClient, toolResult, CbmError, PROTOCOL_VERSION };
