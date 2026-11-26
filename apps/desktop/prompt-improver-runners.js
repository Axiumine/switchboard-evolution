// prompt-improver-runners.js — how each CLI is run once, out of sight, to
// rewrite a prompt, and how its answer is read (prompt-improver.js runs them).
//
// Every run uses the CLI the user installed and signed in to, unmodified:
// the user's own subscription, no API key. The prompt goes in on stdin,
// never on the command line. Nothing is left behind for the session lists:
//
//   - Claude Code: `claude -p --no-session-persistence` writes no transcript;
//     `--safe-mode` keeps the user's CLAUDE.md, rules, skills, plugins, hooks
//     and MCP servers out (the app lists the session's own in the prompt) but
//     keeps the sign-in and the model. `--bare` would not: it skips the OAuth
//     sign-in. No tools, one turn.
//   - Codex: `codex exec --ephemeral` writes no rollout; read-only sandbox;
//     the answer is read from the `-o` file, so whatever the shell prints
//     cannot get in the way. The originator tag keeps codex.js from taking
//     the run for a session the app launched (`switchboard_` prefix).
//   - OpenCode 2.x: `opencode run --session <id>` with an id the app chose
//     (marked archived before the run), deleted afterwards with
//     `opencode session delete` (`--archived` does not archive, 2.4.2).
//
// Verified with Claude Code 2.1.332, Codex 0.167.0 and 0.172.0, OpenCode 2.4.2.

const { SYSTEM_PROMPT } = require('./public/prompt-improver-model');

const LABELS = { claude: 'Claude Code', codex: 'Codex', opencode: 'OpenCode' };

// eslint-disable-next-line no-control-regex
const ANSI = /\u001b\[[0-9;?]*[ -/]*[@-~]|\u001b\][^\u0007\u001b]*(\u0007|\u001b\\)/g;

function stripAnsi(text) {
  return String(text || '').replace(ANSI, '');
}

/** The last line that says what went wrong, from a CLI's stderr. */
function errorLine(stderr) {
  const lines = stripAnsi(stderr).split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i--) {
    const l = lines[i];
    if (/\berror\b|failed|not found|denied|unauthori[sz]ed|forbidden|invalid|expired|log ?in|rate limit|quota|token/i.test(l)) {
      return l.replace(/^.*?\bERROR:?\s*/, '').replace(/^Error:\s*/, '').slice(0, 300);
    }
  }
  return lines.length ? lines[lines.length - 1].slice(0, 300) : '';
}

// --- Claude Code ---

function claudeSpec({ model } = {}) {
  const args = [
    '-p', '--safe-mode', '--output-format', 'json', '--no-session-persistence',
    '--tools', '', '--max-turns', '1', '--system-prompt', SYSTEM_PROMPT, '--effort', 'low',
  ];
  if (model) args.push('--model', model);
  return { cli: 'claude', binary: 'claude', args, env: {} };
}

/** `{ text }` or `{ error }` from `claude -p --output-format json`: the last JSON line of type result. */
function parseClaude({ stdout, stderr, code }) {
  const lines = String(stdout || '').split(/\r?\n/);
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].trim();
    if (!line.startsWith('{')) continue;
    let d;
    try { d = JSON.parse(line); } catch { continue; }
    if (!d || d.type !== 'result') continue;
    if (d.is_error || d.subtype !== 'success') return { error: stripAnsi(String(d.result || d.subtype || 'Claude Code stopped with an error.')).slice(0, 300) };
    return { text: String(d.result || '') };
  }
  return { error: errorLine(stderr) || (code ? `Claude Code exited with code ${code}.` : 'Claude Code gave back no answer.') };
}

// --- Codex ---

function codexSpec({ model, outFile } = {}) {
  const args = ['exec', '--ephemeral', '--skip-git-repo-check', '--sandbox', 'read-only', '-o', outFile];
  if (model) args.push('-m', model);
  args.push('-');
  return { cli: 'codex', binary: 'codex', args, env: { CODEX_INTERNAL_ORIGINATOR_OVERRIDE: 'switchboard_improver' } };
}

/** `{ text }` or `{ error }`: the `-o` file, or what stderr says went wrong. */
function parseCodex({ fileText, stderr, code }) {
  if (code === 0 && fileText && fileText.trim()) return { text: fileText };
  return { error: errorLine(stderr) || (code ? `Codex exited with code ${code}.` : 'Codex gave back no answer.') };
}

// --- OpenCode ---

function opencodeSpec({ model, sessionId } = {}) {
  const args = ['run', '--session', sessionId, '--format', 'json'];
  if (model) args.push('-m', model);
  return { cli: 'opencode', binary: 'opencode', args, env: {}, helperSession: sessionId };
}

/** `{ text }` or `{ error }` from `opencode run --format json`: the text parts, in order. */
function parseOpencode({ stdout, stderr, code }) {
  const texts = [];
  let error = null;
  for (const raw of String(stdout || '').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line.startsWith('{')) continue;
    let d;
    try { d = JSON.parse(line); } catch { continue; }
    if (d && d.type === 'text' && d.part && typeof d.part.text === 'string') texts.push(d.part.text);
    if (d && d.type === 'error') {
      const e = d.error || d.part || {};
      error = String(e.message || e.data?.message || e.name || 'OpenCode stopped with an error.').slice(0, 300);
    }
  }
  if (texts.length) return { text: texts.join('\n') };
  return { error: error || errorLine(stderr) || (code ? `OpenCode exited with code ${code}.` : 'OpenCode gave back no answer.') };
}

function opencodeCleanupSpec(sessionId) {
  return { cli: 'opencode', binary: 'opencode', args: ['session', 'delete', sessionId], env: {} };
}

/** A message for a run that did not finish well. */
function failureMessage(cli, { code, timedOut, timeoutSec, stderr }) {
  const label = LABELS[cli] || cli;
  if (timedOut) return `${label} took longer than ${timeoutSec} s. You can raise the limit in Settings → Prompt improver.`;
  if (code === 127 || /command not found|not found: /i.test(stripAnsi(stderr))) {
    return `${label} was not found in your login shell. Install it, or pick another CLI in Settings → Prompt improver.`;
  }
  return null;
}

module.exports = {
  LABELS, stripAnsi, errorLine,
  claudeSpec, parseClaude, codexSpec, parseCodex, opencodeSpec, parseOpencode, opencodeCleanupSpec, failureMessage,
};
