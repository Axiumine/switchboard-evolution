// prompt-improver.js — rewrites the prompt a user is writing to a session's
// CLI, with that CLI (or the one chosen in Settings) run once and out of
// sight under the user's own sign-in (prompt-improver-runners.js).
//
// What the CLI receives is built by the shared model
// (public/prompt-improver-model.js): the user's improver prompt, then a
// context block (the session's CLI, its last turns, the commands, skills and
// MCP servers it has) and the prompt. The run goes through the user's login
// shell, as open-terminal starts a session, with the project's local.env.sh
// files sourced first: a CLI's keys may live only there.
//
// One run per session at a time; `cancel` stops it. Nothing the run makes
// stays in the session lists (see the runners).

const fs = require('fs');
const os = require('os');
const path = require('path');
const cp = require('child_process');
const crypto = require('crypto');
const M = require('./public/prompt-improver-model');
const R = require('./prompt-improver-runners');
const { shellArgs, quoteArgvForShell, envSourcePrefix, isPosixShell } = require('./shell-profiles');

const MAX_OUTPUT = 4 * 1024 * 1024;
const KILL_AFTER_MS = 2000;
const CLEANUP_TIMEOUT_MS = 20000;

/**
 * The conversation's turns from a transcript's viewer entries (the shape
 * transcript-reader.js gives for all three CLIs): what the user wrote and
 * what the assistant answered, text only, a run of the same role as one turn.
 * Tool results, Claude's command wrappers and side chains are left out.
 */
function turnsFromEntries(entries, count) {
  if (!(count > 0)) return [];
  const turns = [];
  for (const e of entries || []) {
    if (!e || e.isMeta || e.isSidechain) continue;
    const role = e.type === 'assistant' || e.message?.role === 'assistant'
      ? 'assistant'
      : (e.type === 'user' || e.message?.role === 'user') ? 'user' : null;
    if (!role) continue;
    const c = e.message?.content;
    let text = typeof c === 'string'
      ? c
      : Array.isArray(c) ? c.filter((b) => b && b.type === 'text' && typeof b.text === 'string').map((b) => b.text).join('\n\n') : '';
    text = text.trim();
    if (!text || /^<(command-name|command-message|local-command-stdout|local-command-stderr|system-reminder)>/.test(text)) continue;
    const last = turns[turns.length - 1];
    if (last && last.role === role) last.text += `\n\n${text}`;
    else turns.push({ role, text });
  }
  return turns.slice(-count);
}

/**
 * Runs `binary args` through the user's shell like a session's command:
 * `<shell> -l -i -c "<env files> exec <binary> <args>"`, the input on stdin.
 * Resolves `{ code, stdout, stderr, timedOut, cancelled }`; `onKill` gets a
 * function that stops the run (its whole process group on macOS and Linux).
 */
function runThroughShell(spec, deps = {}) {
  const { spawn = cp.spawn, platform = process.platform } = deps;
  const { binary, args, stdin, cwd, env, timeoutMs, onKill } = spec;
  const { shell, extraArgs = [], envFiles = [] } = spec.launch || {};
  return new Promise((resolve) => {
    let cmd = quoteArgvForShell(shell, [binary, ...args]);
    if (isPosixShell(shell)) cmd = `${envSourcePrefix(shell, envFiles)}exec ${cmd}`;
    let child;
    try {
      child = spawn(shell, shellArgs(shell, cmd, extraArgs), {
        cwd, env, stdio: ['pipe', 'pipe', 'pipe'], detached: platform !== 'win32', windowsHide: true,
      });
    } catch (err) {
      resolve({ code: -1, stdout: '', stderr: err.message, timedOut: false, cancelled: false });
      return;
    }
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let cancelled = false;
    let done = false;
    let killTimer = null;
    const kill = (why) => {
      if (done) return;
      if (why === 'timeout') timedOut = true;
      else cancelled = true;
      const signal = (sig) => {
        try {
          if (platform !== 'win32' && child.pid) process.kill(-child.pid, sig);
          else child.kill(sig);
        } catch {
          try { child.kill(sig); } catch { /* gone */ }
        }
      };
      signal('SIGTERM');
      killTimer = setTimeout(() => signal('SIGKILL'), KILL_AFTER_MS);
    };
    const timer = timeoutMs > 0 ? setTimeout(() => kill('timeout'), timeoutMs) : null;
    if (onKill) onKill(() => kill('cancel'));
    child.stdout.on('data', (d) => { if (stdout.length < MAX_OUTPUT) stdout += d; });
    child.stderr.on('data', (d) => { if (stderr.length < MAX_OUTPUT) stderr += d; });
    child.stdin.on('error', () => {}); // the CLI may exit before reading it all
    const finish = (code) => {
      if (done) return;
      done = true;
      if (timer) clearTimeout(timer);
      if (killTimer) clearTimeout(killTimer);
      resolve({ code, stdout, stderr, timedOut, cancelled });
    };
    child.on('error', (err) => { stderr += `\n${err.message}`; finish(-1); });
    child.on('close', (code) => finish(code == null ? -1 : code));
    child.stdin.end(stdin || '');
  });
}

/**
 * deps:
 *   getSettings()                   the stored settings (normalized here)
 *   getContext(sessionId, runtime)  { runtime, isPlainTerminal, projectPath, project, version,
 *                                     entries, readEntries(), launch: { shell, extraArgs, envFiles }, env }
 *   run(spec)                       runThroughShell by default
 *   newOpencodeId()                 an id for OpenCode's helper session
 *   hideSession(id)                 keeps a helper session out of the lists (archived)
 *   tmpDir, fsImpl, now, log
 */
function createPromptImprover(deps) {
  const {
    getSettings, getContext, run = runThroughShell, newOpencodeId, hideSession = () => {},
    tmpDir = os.tmpdir(), fsImpl = fs, now = () => Date.now(), log = console,
  } = deps;
  const running = new Map();

  function specFor(engine, { model, outFile, helperId }) {
    if (engine === 'codex') return R.codexSpec({ model, outFile });
    if (engine === 'opencode') return R.opencodeSpec({ model, sessionId: helperId });
    return R.claudeSpec({ model });
  }

  function parse(engine, result, outFile) {
    if (engine === 'codex') {
      let fileText = '';
      try { fileText = fsImpl.readFileSync(outFile, 'utf8'); } catch { fileText = ''; }
      return R.parseCodex({ fileText, stderr: result.stderr, code: result.code });
    }
    if (engine === 'opencode') return R.parseOpencode(result);
    return R.parseClaude(result);
  }

  /**
   * Improves `prompt` for the session `sessionId`. options: { mode?, runtime? }
   * (`runtime` is the caller's idea of the session's CLI, for one main has
   * not seen yet). Resolves `{ ok: true, text, engine, mode, ms }` or
   * `{ ok: false, error, cancelled? }`.
   */
  async function improve(sessionId, prompt, options = {}) {
    if (typeof sessionId !== 'string' || !sessionId) return { ok: false, error: 'No session.' };
    const check = M.checkPrompt(prompt);
    if (!check.ok) return { ok: false, error: check.error };
    if (running.has(sessionId)) return { ok: false, error: 'This prompt is already being improved.' };
    const settings = M.normalizeSettings(getSettings());
    if (!settings.enabled) return { ok: false, error: 'The prompt improver is off in Settings.' };

    const control = { cancelled: false, kill: null };
    running.set(sessionId, control);
    const started = now();
    let outFile = null;
    let helperId = null;
    let ctx = null;
    try {
      ctx = await getContext(sessionId, options.runtime || null);
      if (!ctx || ctx.isPlainTerminal) return { ok: false, error: 'Only a CLI session\'s prompt can be improved.' };
      const mode = M.MODES.includes(options.mode) ? options.mode : settings.context;
      const engine = M.engineFor(settings, ctx.runtime);
      let recent = [];
      if (mode === 'recent' && settings.recentTurns > 0 && ctx.readEntries) {
        try { recent = turnsFromEntries(await ctx.readEntries(), settings.recentTurns); } catch { recent = []; }
      }
      const input = M.buildImproverInput({
        template: settings.template, prompt, cli: ctx.runtime, version: ctx.version, project: ctx.project,
        mode, recent, entries: ctx.entries,
      });
      if (engine === 'codex') outFile = path.join(tmpDir, `switchboard-improver-${crypto.randomBytes(6).toString('hex')}.txt`);
      if (engine === 'opencode') {
        helperId = newOpencodeId();
        try { hideSession(helperId); } catch (err) { log.warn?.('[prompt-improver] hide', err.message); }
      }
      if (control.cancelled) return { ok: false, cancelled: true, error: 'Cancelled.' };
      const spec = specFor(engine, { model: settings.models[engine] || '', outFile, helperId });
      const result = await run({
        ...spec,
        stdin: input,
        cwd: ctx.projectPath || os.homedir(),
        env: { ...(ctx.env || {}), ...spec.env, NO_COLOR: '1' },
        launch: ctx.launch,
        timeoutMs: settings.timeoutSec * 1000,
        onKill: (kill) => {
          control.kill = kill;
          if (control.cancelled) kill();
        },
      });
      if (control.cancelled || result.cancelled) return { ok: false, cancelled: true, error: 'Cancelled.' };
      const failure = R.failureMessage(engine, { ...result, timeoutSec: settings.timeoutSec });
      if (failure) return { ok: false, error: failure };
      const parsed = parse(engine, result, outFile);
      if (parsed.error) return { ok: false, error: `${R.LABELS[engine]}: ${parsed.error}` };
      const text = M.extractImproved(parsed.text);
      if (!text) return { ok: false, error: `${R.LABELS[engine]} gave back no prompt.` };
      return { ok: true, text, engine, mode, ms: now() - started };
    } catch (err) {
      log.error?.('[prompt-improver]', err);
      return { ok: false, error: err.message || String(err) };
    } finally {
      running.delete(sessionId);
      if (outFile) {
        try { fsImpl.rmSync(outFile, { force: true }); } catch { /* already gone */ }
      }
      if (helperId) {
        // Not awaited: the answer is ready, the helper session goes in the background.
        const id = helperId;
        Promise.resolve()
          .then(() => run({
            ...R.opencodeCleanupSpec(id), stdin: '', cwd: (ctx && ctx.projectPath) || os.homedir(),
            env: { ...((ctx && ctx.env) || {}), NO_COLOR: '1' }, launch: ctx && ctx.launch, timeoutMs: CLEANUP_TIMEOUT_MS,
          }))
          .then((r) => { if (r && r.code !== 0) log.warn?.(`[prompt-improver] opencode session delete ${id}: ${R.errorLine(r.stderr)}`); })
          .catch((err) => log.warn?.('[prompt-improver] cleanup', err.message));
      }
    }
  }

  /** Stops the run for `sessionId`; false when there is none. */
  function cancel(sessionId) {
    const control = running.get(sessionId);
    if (!control) return false;
    control.cancelled = true;
    if (control.kill) control.kill();
    return true;
  }

  function isRunning(sessionId) {
    return running.has(sessionId);
  }

  return { improve, cancel, isRunning };
}

module.exports = { createPromptImprover, runThroughShell, turnsFromEntries };
