// Start, resume and fork sessions for a remote client, the way the window
// does (public/dialogs.js resolveDefaultSessionOptions, public/app.js
// launchNewSession and openSession), but with the session id minted here so
// the caller knows it before the PTY writes anything.

const crypto = require('crypto');

function createSessionLauncher({ openTerminal, effectiveSettings, sessionConfig, getCachedSession, activeSessions, onLaunched = () => {}, resolveScheduleLaunch = () => null }) {
  /** The folder's defaults for every option any CLI reads, as the window resolves them. */
  function defaultOptions(projectPath) {
    const effective = effectiveSettings(projectPath) || {};
    const keys = new Set(Object.keys(sessionConfig.FIELDS).flatMap(runtime =>
      sessionConfig.fieldsFor(runtime).map(field => field.key)));
    return Object.fromEntries([...keys].filter(key => sessionConfig.own(effective, key)).map(key => [key, effective[key]]));
  }

  function isRunning(sessionId) {
    for (const [key, session] of activeSessions) {
      if (!session.exited && (key === sessionId || session.realSessionId === sessionId)) return true;
    }
    return false;
  }

  /**
   * spec: { mode: 'new'|'resume'|'fork', sessionId (resume, fork), projectPath,
   * projectId, trackId, runtime ('claude'|'codex'|'terminal'), initialPrompt,
   * options, planItem { file, itemText }, scheduleId }. Resolves { sessionId }
   * or { error }.
   */
  async function launch(spec) {
    const mode = spec.mode;
    let sessionId;
    let projectPath;
    let isNew;
    let options;

    if (mode === 'resume' || mode === 'fork') {
      const row = getCachedSession(spec.sessionId);
      if (!row) return { error: 'Session not found' };
      projectPath = row.projectPath;
      options = { ...(spec.options || defaultOptions(projectPath)) };
      if (row.runtime) options.runtime = row.runtime;
      if (mode === 'resume') {
        if (isRunning(spec.sessionId)) return { sessionId: spec.sessionId, alreadyRunning: true };
        sessionId = spec.sessionId;
        isNew = false;
      } else {
        sessionId = crypto.randomUUID();
        isNew = true;
        options.forkFrom = spec.sessionId;
      }
    } else if (mode === 'new') {
      if (!spec.projectPath) return { error: 'A new session needs a folder' };
      projectPath = spec.projectPath;
      sessionId = crypto.randomUUID();
      isNew = true;
      if (spec.runtime === 'terminal') {
        options = { type: 'terminal' };
      } else {
        options = { ...(spec.options || defaultOptions(projectPath)), runtime: spec.runtime || 'claude' };
        if (spec.initialPrompt) options.initialPrompt = spec.initialPrompt;
        if (spec.scheduleId) options.scheduleId = spec.scheduleId;
      }
      if (spec.projectId) {
        options.projectId = spec.projectId;
        if (spec.trackId) options.trackId = spec.trackId;
        // The project page links the item to the session, as from the window.
        if (spec.planItem && options.type !== 'terminal') options.planItem = spec.planItem;
      }
    } else {
      return { error: `Unknown launch mode: ${mode}` };
    }

    // Nobody may be at the desktop to review a diff: Claude asks for
    // permission in the terminal instead, where the phone can answer.
    // Nor to answer the desktop's question about trusting attached folders:
    // Claude's own question shows in the terminal the phone sees.
    if (options.type !== 'terminal') {
      options.mcpEmulation = false;
      options.unattended = true;
    }

    const result = await openTerminal(sessionId, projectPath, isNew, options);
    if (!result?.ok) return { error: result?.error || 'Could not start the session' };
    onLaunched(sessionId);
    return { sessionId };
  }

  /** Start a schedule's session now, with the schedule's own options, as the window's Run now does. */
  async function runSchedule(scheduleId) {
    const resolved = resolveScheduleLaunch(scheduleId);
    if (!resolved || resolved.error) return { error: resolved?.error || 'Schedule not found' };
    const { schedule, target } = resolved;
    const runtime = resolved.runtime || 'claude';
    const options = sessionConfig.resolveOptions(runtime, effectiveSettings(target.projectPath) || {}, schedule.sessionConfig?.[runtime] || {});
    return launch({
      mode: 'new', projectPath: target.projectPath, projectId: target.projectId, trackId: target.trackId,
      runtime, initialPrompt: schedule.prompt, scheduleId: schedule.id, options,
    });
  }

  return { launch, runSchedule, defaultOptions };
}

module.exports = { createSessionLauncher };
