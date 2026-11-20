// subagent-activity.js — whether a Claude session has a subagent at work.
//
// While the main agent waits for a subagent (one launched in the background,
// above all) the CLI is idle, so the session shows no spinner although work
// goes on. Claude keeps each subagent beside the session's transcript:
//
//   <dir>/<session id>.jsonl                      the session
//   <dir>/<session id>/subagents/agent-<id>.jsonl  a subagent's transcript
//   <dir>/<session id>/subagents/agent-<id>.meta.json  { …, "finished": true }
//
// A subagent is at work while its meta.json does not say `finished` and its
// transcript was written recently: one left unfinished by a CLI that quit or
// crashed stops counting once it has been quiet for STALE_MS.

const fs = require('fs');
const path = require('path');

// A subagent writes a record for every step; one quiet for this long is not working.
const STALE_MS = 30 * 60 * 1000;

/** The folder of a session's subagents, from the session's transcript path. */
function subagentsDirFor(transcriptFile) {
  if (!transcriptFile) return null;
  return path.join(path.dirname(transcriptFile), path.basename(transcriptFile, '.jsonl'), 'subagents');
}

/** True when a subagent in `dir` is still working. */
function subagentsRunning(dir, { now = Date.now(), staleMs = STALE_MS, fsImpl = fs } = {}) {
  if (!dir) return false;
  let names;
  try { names = fsImpl.readdirSync(dir); } catch { return false; }
  for (const name of names) {
    if (!name.endsWith('.meta.json')) continue;
    const metaFile = path.join(dir, name);
    let meta;
    try { meta = JSON.parse(fsImpl.readFileSync(metaFile, 'utf8')); } catch { continue; }
    if (!meta || meta.finished === true) continue;
    // The transcript moves with every step; the meta file only when it starts and ends.
    let written = 0;
    for (const file of [path.join(dir, name.replace(/\.meta\.json$/, '.jsonl')), metaFile]) {
      try { written = Math.max(written, fsImpl.statSync(file).mtimeMs); } catch {}
    }
    if (written && now - written <= staleMs) return true;
  }
  return false;
}

module.exports = { subagentsDirFor, subagentsRunning, STALE_MS };
