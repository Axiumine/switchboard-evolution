// The plans Claude Code's plan mode writes to ~/.claude/plans, for the
// sidebar's Plans tab (main.js get-plans).
//
// A plan file is named after its session's slug (`<slug>.md`), and the session
// cache keeps every Claude session's slug (session_cache.slug, from the
// transcript). So each plan finds the session that wrote it, and through the
// session its folder and its project, by the rule the Projects tab files
// sessions with (projects.js buildProjectTree): the project a session was filed
// under, or else the project whose root holds its folder. A plan whose session
// is gone (its transcript was deleted) stays in the list, linked to nothing.
//
// No Electron and no database here, so node --test loads it.

const fs = require('fs');
const path = require('path');

/** The text after `# ` on the first line with text, or the file's name without `.md`. */
function planTitle(content, filename) {
  const firstLine = String(content || '').split('\n').find(l => l.trim());
  return firstLine && firstLine.startsWith('# ')
    ? firstLine.slice(2).trim()
    : String(filename).replace(/\.md$/, '');
}

/**
 * Every plan in `plansDir`, newest edit first: { filename, title, modified,
 * created, content }. Each file is read once; `content` feeds the search index
 * and stays in main. `created` is the file's birth time, or its last change
 * where the file system has none (or claims a birth after the last change).
 * Claude rewrites a plan whole, so the birth time is mostly the last write:
 * linkPlans puts the start of the plan's first session in its place.
 */
function readPlans(plansDir, fsImpl = fs) {
  if (!fsImpl.existsSync(plansDir)) return [];
  const plans = [];
  for (const filename of fsImpl.readdirSync(plansDir).filter(f => f.endsWith('.md'))) {
    try {
      const filePath = path.join(plansDir, filename);
      const stat = fsImpl.statSync(filePath);
      const content = fsImpl.readFileSync(filePath, 'utf8');
      const born = stat.birthtimeMs > 0 && stat.birthtimeMs <= stat.mtimeMs ? stat.birthtime : stat.mtime;
      plans.push({
        filename,
        title: planTitle(content, filename),
        modified: stat.mtime.toISOString(),
        created: born.toISOString(),
        content,
      });
    } catch {}
  }
  plans.sort((a, b) => new Date(b.modified) - new Date(a.modified));
  return plans;
}

/**
 * Which project a plan's sessions (latest first) belong to: the first one filed
 * under a project that still exists, or else the project whose root holds the
 * latest session's folder. `projectForCwd` is projects.js's.
 */
function projectResolver(projectRows, projectForCwd) {
  const rows = projectRows || [];
  const byId = new Map(rows.map(r => [r.id, r]));
  const byCwd = new Map();
  return (sessions) => {
    for (const s of sessions) if (s.projectId && byId.has(s.projectId)) return byId.get(s.projectId);
    const cwd = sessions[0] && sessions[0].projectPath;
    if (!cwd || typeof projectForCwd !== 'function') return null;
    if (!byCwd.has(cwd)) byCwd.set(cwd, projectForCwd(cwd, rows) || null);
    return byCwd.get(cwd);
  };
}

/**
 * The plans as the renderer gets them, each with the session that wrote it.
 * `slugSessions` are db.js getSlugSessions() rows ({ slug, sessionId,
 * projectPath, created, modified, projectId, archived }); several sessions can
 * share a slug (the one that carries out an accepted plan takes it on), and the
 * latest stands for the plan. `archived` is true when every one of them is
 * archived. `created` is when the first of them started (the plan cannot be
 * older), or the file's own date without a session.
 */
/** When the earliest of a plan's sessions started (never after the plan's last edit), else the file's date. */
function firstSessionStart(sessions, plan) {
  let first = null;
  for (const s of sessions) {
    const t = Date.parse(s.created || '');
    if (Number.isFinite(t) && (first === null || t < first)) first = t;
  }
  const edited = Date.parse(plan.modified || '');
  if (first === null) return plan.created;
  return new Date(Number.isFinite(edited) ? Math.min(first, edited) : first).toISOString();
}

function linkPlans(plans, slugSessions, resolveProject) {
  const bySlug = new Map();
  for (const row of slugSessions || []) {
    if (!row || !row.slug) continue;
    const list = bySlug.get(row.slug);
    if (list) list.push(row); else bySlug.set(row.slug, [row]);
  }
  return (plans || []).map(plan => {
    const sessions = (bySlug.get(String(plan.filename).replace(/\.md$/, '')) || [])
      .slice()
      .sort((a, b) => String(b.modified || '').localeCompare(String(a.modified || '')));
    const latest = sessions[0] || null;
    const project = latest && resolveProject ? resolveProject(sessions) : null;
    return {
      filename: plan.filename,
      title: plan.title,
      modified: plan.modified,
      created: firstSessionStart(sessions, plan),
      sessionId: latest ? latest.sessionId : null,
      sessionCount: sessions.length,
      projectPath: latest ? latest.projectPath || null : null,
      archived: sessions.length > 0 && sessions.every(s => !!s.archived),
      projectId: project ? project.id : null,
      projectName: project ? project.name : null,
    };
  });
}

module.exports = { planTitle, readPlans, projectResolver, linkPlans };
