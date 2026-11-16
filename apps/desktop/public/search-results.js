// What a session search shows, and what its "Stop" button ends, for the
// Sessions and Projects tabs. Pure functions over the session lists, so the
// rules hold the same in both tabs and can be tested without a window.

/**
 * Whether the title a session row shows contains the query. It catches the
 * sessions the search index has not seen: terminals, and sessions with no
 * transcript yet, which are often the ones still running.
 */
function sessionTitleMatches(session, query) {
  const q = String(query || '').trim().toLowerCase();
  if (!q || !session) return false;
  return [session.name, session.aiTitle, session.summary]
    .some(text => typeof text === 'string' && text.toLowerCase().includes(q));
}

/** The search's matches: the index's hits, plus every session whose title matches. */
function searchMatchesWithTitles(hitIds, folders, query) {
  const ids = new Set(hitIds);
  for (const folder of folders || []) {
    for (const session of folder.sessions || []) {
      if (sessionTitleMatches(session, query)) ids.add(session.sessionId);
    }
  }
  return ids;
}

/**
 * The Sessions tab's folders for a search: each with only its matching
 * sessions, minus those left out of this search. A folder whose name matched
 * stays with no sessions; any other folder left with none goes.
 */
function filterFoldersForSearch(folders, { matchIds, projectPaths = null, excluded = new Set() }) {
  return folders.map(folder => {
    const sessions = folder.sessions.filter(s => matchIds.has(s.sessionId) && !excluded.has(s.sessionId));
    const projectMatched = !!projectPaths && projectPaths.has(folder.projectPath);
    if (!sessions.length && !projectMatched) return null;
    return { ...folder, sessions, _projectMatchedOnly: projectMatched && !sessions.length };
  }).filter(Boolean);
}

/**
 * The Projects tab's results: each project the search found, with the
 * sessions to list under it. Those are the ones that match and, when the
 * project's own name matches, the ones running in it. Projects and sessions
 * left out of this search are gone. A project whose sessions were all left
 * out still shows, as it was found.
 */
function projectSearchResults(projects, { query, matchIds, excludedProjects = new Set(), excludedSessions = new Set(), sessionsOf, isRunning }) {
  const q = String(query || '').trim().toLowerCase();
  const results = [];
  for (const project of projects) {
    if (excludedProjects.has(project.id)) continue;
    const nameMatched = !!q && String(project.name || '').toLowerCase().includes(q);
    const all = sessionsOf(project);
    if (!nameMatched && !all.some(s => matchIds.has(s.sessionId))) continue;
    const sessions = all.filter(s => !excludedSessions.has(s.sessionId) &&
      (matchIds.has(s.sessionId) || (nameMatched && isRunning(s.sessionId))));
    results.push({ project, sessions });
  }
  return results;
}

/** The running sessions among those shown, once each: what "Stop" ends. */
function runningAmong(sessions, isRunning) {
  const seen = new Set();
  return sessions.filter(s => {
    if (seen.has(s.sessionId) || !isRunning(s.sessionId)) return false;
    seen.add(s.sessionId);
    return true;
  });
}

/** The sessions shown, once each, in order. */
function uniqueSessions(sessions) {
  const seen = new Set();
  return sessions.filter(s => !seen.has(s.sessionId) && seen.add(s.sessionId));
}
