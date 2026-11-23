const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { planTitle, readPlans, projectResolver, linkPlans } = require('../plans-source');

function tempPlans(t, files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'plans-source-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  for (const [name, { content, mtime }] of Object.entries(files)) {
    const file = path.join(dir, name);
    fs.writeFileSync(file, content);
    if (mtime) fs.utimesSync(file, mtime, mtime);
  }
  return dir;
}

test('planTitle: the first heading, else the file name', () => {
  assert.equal(planTitle('\n\n# Add filters  \n\nbody', 'x.md'), 'Add filters');
  assert.equal(planTitle('Some text first\n# Later heading', 'brave-otter.md'), 'brave-otter');
  assert.equal(planTitle('## Not a title', 'quiet-fox.md'), 'quiet-fox');
  assert.equal(planTitle('', 'empty.md'), 'empty');
});

test('readPlans: markdown files only, newest edit first, each read once', (t) => {
  const dir = tempPlans(t, {
    'older-plan.md': { content: '# Older\n', mtime: new Date('2026-01-01T10:00:00Z') },
    'newer-plan.md': { content: '# Newer\n\n- [ ] item\n', mtime: new Date('2026-03-01T10:00:00Z') },
    'notes.txt': { content: 'not a plan' },
  });
  let reads = 0;
  const countingFs = { ...fs, readFileSync: (...args) => { reads++; return fs.readFileSync(...args); } };
  const plans = readPlans(dir, countingFs);
  assert.equal(reads, 2);
  assert.deepEqual(plans.map(p => [p.filename, p.title]), [['newer-plan.md', 'Newer'], ['older-plan.md', 'Older']]);
  assert.equal(plans[0].modified, '2026-03-01T10:00:00.000Z');
  assert.equal(plans[0].content, '# Newer\n\n- [ ] item\n');
  for (const p of plans) assert.ok(Date.parse(p.created) <= Date.parse(p.modified), 'created is never after modified');
});

test('readPlans: no folder gives no plans', () => {
  assert.deepEqual(readPlans(path.join(os.tmpdir(), 'plans-source-missing-' + process.pid)), []);
});

test('readPlans: created falls back to the last edit without a usable birth time', () => {
  const mtime = new Date('2026-02-02T08:00:00Z');
  const fakeFs = {
    existsSync: () => true,
    readdirSync: () => ['a.md', 'b.md'],
    statSync: (p) => p.endsWith('a.md')
      ? { mtime, mtimeMs: mtime.getTime(), birthtime: new Date(0), birthtimeMs: 0 }
      : { mtime, mtimeMs: mtime.getTime(), birthtime: new Date('2026-05-05T00:00:00Z'), birthtimeMs: Date.parse('2026-05-05T00:00:00Z') },
    readFileSync: () => '# T\n',
  };
  const plans = readPlans('/plans', fakeFs);
  assert.deepEqual(plans.map(p => p.created), [mtime.toISOString(), mtime.toISOString()]);
});

test('readPlans: a file that cannot be read is left out', () => {
  const mtime = new Date('2026-02-02T08:00:00Z');
  const fakeFs = {
    existsSync: () => true,
    readdirSync: () => ['ok.md', 'locked.md'],
    statSync: () => ({ mtime, mtimeMs: mtime.getTime(), birthtime: mtime, birthtimeMs: mtime.getTime() }),
    readFileSync: (p) => { if (p.endsWith('locked.md')) throw new Error('EACCES'); return '# Ok\n'; },
  };
  assert.deepEqual(readPlans('/plans', fakeFs).map(p => p.filename), ['ok.md']);
});

const PLAN = (slug, extra = {}) => ({ filename: `${slug}.md`, title: slug, modified: '2026-03-01T00:00:00.000Z', created: '2026-02-01T00:00:00.000Z', content: '# x', ...extra });
const PROJECTS = [
  { id: 'p-app', name: 'App', root: '/work/app' },
  { id: 'p-site', name: 'Site', root: '/work/site' },
];
const byRoot = (cwd, rows) => rows.find(r => cwd === r.root || cwd.startsWith(r.root + '/')) || null;

test('linkPlans: the session of the same slug gives folder and project; content stays in main', () => {
  const plans = linkPlans([PLAN('brave-otter')], [
    { slug: 'brave-otter', sessionId: 's1', projectPath: '/work/app/web', modified: '2026-03-01T00:00:00Z', projectId: null, archived: false },
    { slug: 'someone-else', sessionId: 's9', projectPath: '/work/site', modified: '2026-03-01T00:00:00Z', projectId: null, archived: false },
  ], projectResolver(PROJECTS, byRoot));
  assert.deepEqual(plans, [{
    filename: 'brave-otter.md', title: 'brave-otter',
    modified: '2026-03-01T00:00:00.000Z', created: '2026-02-01T00:00:00.000Z',
    sessionId: 's1', sessionCount: 1, projectPath: '/work/app/web', archived: false,
    projectId: 'p-app', projectName: 'App',
  }]);
});

test('linkPlans: the latest of several sessions stands for the plan; archived only when all are', () => {
  const rows = [
    { slug: 'quiet-fox', sessionId: 'old', projectPath: '/work/site', modified: '2026-01-01T00:00:00Z', projectId: null, archived: true },
    { slug: 'quiet-fox', sessionId: 'new', projectPath: '/work/app', modified: '2026-02-01T00:00:00Z', projectId: null, archived: false },
  ];
  const [p] = linkPlans([PLAN('quiet-fox')], rows, projectResolver(PROJECTS, byRoot));
  assert.equal(p.sessionId, 'new');
  assert.equal(p.sessionCount, 2);
  assert.equal(p.projectPath, '/work/app');
  assert.equal(p.projectName, 'App');
  assert.equal(p.archived, false);
  const [all] = linkPlans([PLAN('quiet-fox')], rows.map(r => ({ ...r, archived: true })), projectResolver(PROJECTS, byRoot));
  assert.equal(all.archived, true);
});

test('linkPlans: created is when the first session started, never after the last edit', () => {
  const rows = [
    { slug: 'quiet-fox', sessionId: 'impl', created: '2026-02-20T09:00:00Z', modified: '2026-02-21T00:00:00Z' },
    { slug: 'quiet-fox', sessionId: 'plan', created: '2026-02-10T08:30:00Z', modified: '2026-02-11T00:00:00Z' },
    { slug: 'quiet-fox', sessionId: 'odd', created: 'not a date', modified: '2026-02-12T00:00:00Z' },
  ];
  const [p] = linkPlans([PLAN('quiet-fox')], rows, null);
  assert.equal(p.created, '2026-02-10T08:30:00.000Z');
  const [late] = linkPlans([PLAN('late', { modified: '2026-01-01T00:00:00.000Z' })],
    [{ slug: 'late', sessionId: 's', created: '2026-01-05T00:00:00Z', modified: '2026-01-05T00:00:00Z' }], null);
  assert.equal(late.created, '2026-01-01T00:00:00.000Z');
  const [none] = linkPlans([PLAN('none')], [{ slug: 'none', sessionId: 's', created: null, modified: 'x' }], null);
  assert.equal(none.created, '2026-02-01T00:00:00.000Z');
});

test('linkPlans: a session filed under a project beats the folder, a removed project does not', () => {
  const resolve = projectResolver(PROJECTS, byRoot);
  const [filed] = linkPlans([PLAN('a')], [{ slug: 'a', sessionId: 's', projectPath: '/work/app', modified: 'x', projectId: 'p-site', archived: false }], resolve);
  assert.equal(filed.projectId, 'p-site');
  const [gone] = linkPlans([PLAN('a')], [{ slug: 'a', sessionId: 's', projectPath: '/work/app', modified: 'x', projectId: 'p-removed', archived: false }], resolve);
  assert.equal(gone.projectId, 'p-app');
});

test('linkPlans: a plan without a session, or outside every project, is linked to nothing', () => {
  const resolve = projectResolver(PROJECTS, byRoot);
  const [orphan, loose] = linkPlans([PLAN('orphan'), PLAN('loose')], [
    { slug: 'loose', sessionId: 's', projectPath: '/tmp/loose', modified: 'x', projectId: null, archived: false },
  ], resolve);
  assert.deepEqual(
    [orphan.sessionId, orphan.sessionCount, orphan.projectPath, orphan.archived, orphan.projectId, orphan.projectName],
    [null, 0, null, false, null, null]);
  assert.deepEqual([loose.sessionId, loose.projectPath, loose.projectId], ['s', '/tmp/loose', null]);
});

test('projectResolver: asks for each folder once', () => {
  let calls = 0;
  const resolve = projectResolver(PROJECTS, (cwd, rows) => { calls++; return byRoot(cwd, rows); });
  resolve([{ projectPath: '/work/app' }]);
  resolve([{ projectPath: '/work/app' }]);
  resolve([{ projectPath: '/work/site' }]);
  assert.equal(calls, 2);
  assert.equal(resolve([{ projectPath: null }]), null);
});
