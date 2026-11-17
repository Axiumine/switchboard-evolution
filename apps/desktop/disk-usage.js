// disk-usage.js — how much disk each project takes: its own folder and the
// folders attached to it, for the Task Manager's disk ring.
//
// Sizes come from `du -sk` (niced, one folder at a time, in the background);
// Windows, which has no du, walks the folder instead. A measurement can take a
// while on big repositories, so it is kept for half an hour and get() never
// waits for it: it answers with what it has and says whether it is measuring.
//
// Folders overlap: a project's checkouts sit inside its folder, an attached
// folder can hold another attached one, and one folder can be attached to
// several projects. A project's size counts each byte once; in the ring each
// folder is counted once over all projects (it goes to the largest project
// that has it), so the slices add up to what the projects really take.

const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

const MAX_AGE_MS = 30 * 60 * 1000;
const DU_TIMEOUT_MS = 10 * 60 * 1000;
const WALK_MAX_ENTRIES = 2_000_000;

function realPath(p) {
  try { return fs.realpathSync(p); } catch { return null; }
}

/** Whether `child` is `parent` or inside it. */
function isWithin(child, parent) {
  if (child === parent) return true;
  const rel = path.relative(parent, child);
  return !!rel && !rel.startsWith('..') && !path.isAbsolute(rel);
}

/** The bytes a folder takes on disk, or null when it cannot be measured. */
function duBytes(dir) {
  if (process.platform === 'win32') return walkBytes(dir);
  return new Promise((resolve) => {
    // du exits non-zero when it cannot read part of the tree but still prints
    // the total of what it could: take the number either way.
    execFile('nice', ['-n', '10', 'du', '-sk', '-x', dir], { timeout: DU_TIMEOUT_MS, maxBuffer: 1024 * 1024 }, (_err, stdout) => {
      const match = /^(\d+)\s/.exec(String(stdout || ''));
      resolve(match ? Number(match[1]) * 1024 : null);
    });
  });
}

/** Where there is no du: add up file sizes, without following links. */
async function walkBytes(dir) {
  let total = 0;
  let seen = 0;
  const stack = [dir];
  while (stack.length) {
    const current = stack.pop();
    let entries;
    try { entries = await fs.promises.readdir(current, { withFileTypes: true }); } catch { continue; }
    for (const entry of entries) {
      if (++seen > WALK_MAX_ENTRIES) return total;
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) stack.push(full);
      else if (entry.isFile()) {
        try { total += (await fs.promises.lstat(full)).size; } catch {}
      }
    }
  }
  return total;
}

/**
 * From projects ({ id, name, root, folders: [path] }) and the size of each
 * real folder path to what the ring and its legend show. Resolves
 * { projects: [{ id, name, bytes, ringBytes, folders }], totalBytes }, the
 * largest project first.
 */
function summarize(projects, sizes) {
  const list = projects.map((project) => {
    const reals = [];
    for (const p of [project.root, ...(project.folders || [])]) {
      const real = realPath(p);
      if (real && !reals.includes(real)) reals.push(real);
    }
    const tops = reals.filter(real => !reals.some(other => other !== real && isWithin(real, other)));
    const bytes = tops.reduce((sum, real) => sum + (sizes.get(real) || 0), 0);
    return { project, reals, tops, bytes };
  });

  // Each folder once over all projects: to the largest project that has it.
  const everything = [...new Set(list.flatMap(item => item.reals))];
  const globalTops = everything.filter(real => !everything.some(other => other !== real && isWithin(real, other)));
  const ring = new Map(list.map(item => [item.project.id, 0]));
  for (const top of globalTops) {
    const owner = list.filter(item => item.reals.includes(top)).sort((a, b) => b.bytes - a.bytes)[0];
    if (owner) ring.set(owner.project.id, ring.get(owner.project.id) + (sizes.get(top) || 0));
  }

  const result = list.map(({ project, reals, bytes }) => {
    const rootReal = realPath(project.root);
    const folders = reals.map((real) => {
      const container = reals.find(other => other !== real && isWithin(real, other));
      const alsoIn = list
        .filter(other => other.project.id !== project.id && other.reals.some(r => isWithin(real, r)))
        .map(other => other.project.name);
      return {
        path: real,
        name: path.basename(real) || real,
        bytes: sizes.get(real) ?? null,
        isRoot: real === rootReal,
        inside: container ? (path.basename(container) || container) : null,
        alsoIn,
      };
    });
    return { id: project.id, name: project.name, status: project.status || null, bytes, ringBytes: ring.get(project.id), folders };
  });
  result.sort((a, b) => b.bytes - a.bytes || a.name.localeCompare(b.name));
  const totalBytes = globalTops.reduce((sum, real) => sum + (sizes.get(real) || 0), 0);
  return { projects: result, totalBytes };
}

/**
 * listProjects() gives [{ id, name, root, status, folders: [path] }].
 * get({ force }) answers at once: { ok, measuring, measuredAt, projects,
 * totalBytes }, starting a measurement when there is none or it is old.
 */
function createDiskUsage({ listProjects, measure = duBytes, maxAgeMs = MAX_AGE_MS, now = Date.now, log = null }) {
  let result = null;
  let measuredAt = 0;
  let running = null;

  async function run() {
    const projects = listProjects();
    const reals = new Set();
    for (const project of projects) {
      for (const p of [project.root, ...(project.folders || [])]) {
        const real = realPath(p);
        if (real) reals.add(real);
      }
    }
    // Only the outermost folders need du; anything inside them is measured too,
    // but a folder's own size is shown in the legend, so measure each once.
    const sizes = new Map();
    for (const real of reals) {
      try { sizes.set(real, await measure(real)); } catch (err) { log?.warn?.('[disk-usage]', real, err); sizes.set(real, null); }
    }
    result = summarize(projects, sizes);
    measuredAt = now();
  }

  function start() {
    if (!running) {
      running = run().catch((err) => { log?.warn?.('[disk-usage] measuring failed', err); }).finally(() => { running = null; });
    }
    return running;
  }

  function get({ force = false } = {}) {
    if (force || !result || now() - measuredAt > maxAgeMs) start();
    return {
      ok: true,
      measuring: !!running,
      measuredAt: measuredAt || null,
      projects: result ? result.projects : null,
      totalBytes: result ? result.totalBytes : null,
    };
  }

  /** For tests and callers that can wait: resolves when no measurement runs. */
  function idle() {
    return running || Promise.resolve();
  }

  return { get, idle };
}

module.exports = { createDiskUsage, summarize, duBytes, walkBytes, isWithin, MAX_AGE_MS };
