// The user's own Claude Code commands (claude-local-commands.js), on
// throwaway folders laid out as Claude Code expects them, and how the catalog
// puts them with the built-in ones (command-catalog.js).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { scanClaudeLocal, readFrontmatter, boolField, repoOf } = require('../claude-local-commands');
const { createCommandCatalog, mergeEntries } = require('../command-catalog');

function tempDir(t) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'claude-local-')));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function write(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
}

const skill = (fields, body = 'Do the thing.') => `---\n${Object.entries(fields).map(([k, v]) => `${k}: ${v}`).join('\n')}\n---\n\n${body}\n`;
const byName = (entries) => Object.fromEntries(entries.map((e) => [e.name, e]));

/** A home with ~/.claude, and a repository with the session's folder two levels down. */
function layout(t) {
  const root = tempDir(t);
  const home = path.join(root, 'home');
  const repo = path.join(root, 'work', 'shop');
  const cwd = path.join(repo, 'apps', 'web');
  fs.mkdirSync(path.join(repo, '.git'), { recursive: true });
  fs.mkdirSync(cwd, { recursive: true });
  return { root, home, repo, cwd, config: path.join(home, '.claude') };
}

test('frontmatter: only at the top, YAML that does not parse gives no fields, booleans as Claude reads them', () => {
  assert.deepEqual(readFrontmatter('---\nname: x\ndescription: Y\n---\nbody').data, { name: 'x', description: 'Y' });
  assert.deepEqual(readFrontmatter('---\r\nname: x\r\n---\r\nbody').data, { name: 'x' });
  assert.deepEqual(readFrontmatter('intro\n---\nname: x\n---\n').data, {});
  assert.deepEqual(readFrontmatter('---\nname: [unclosed\n---\nbody').data, {});
  // An unquoted hint is a YAML list: it is shown as written.
  assert.equal(readFrontmatter('---\nargument-hint: [issue-number]\n---\n').data['argument-hint'], '[issue-number]');
  assert.equal(readFrontmatter('---\nargument-hint: "[a] [b]"\n---\n').data['argument-hint'], '[a] [b]');
  for (const v of [true, 'true', 'Yes', 'ON', '1', 1]) assert.equal(boolField(v), true, String(v));
  for (const v of [false, 'false', 'no', 'Off', '0', 0]) assert.equal(boolField(v), false, String(v));
  assert.equal(boolField('maybe'), undefined);
});

test('personal and project skills, project folders up to the repository root, personal first', (t) => {
  const { home, repo, cwd, config } = layout(t);
  write(path.join(config, 'skills', 'deploy', 'SKILL.md'), skill({ description: 'Personal deploy', 'argument-hint': '[env]' }));
  write(path.join(repo, '.claude', 'skills', 'deploy', 'SKILL.md'), skill({ description: 'Project deploy' }));
  write(path.join(repo, '.claude', 'skills', 'review-api', 'SKILL.md'), skill({ name: 'api-review', description: 'Review the API' }));
  write(path.join(cwd, '.claude', 'skills', 'web-check', 'SKILL.md'), skill({}, '# Title\nCheck the web app before a release.'));
  write(path.join(repo, '.claude', 'skills', 'hidden', 'SKILL.md'), skill({ 'user-invocable': 'false', description: 'Only for Claude' }));
  write(path.join(repo, '.claude', 'skills', 'synced', 'SKILL.md'), skill({ description: 'Reserved name' }));
  // Above the repository: not loaded.
  write(path.join(repo, '..', '.claude', 'skills', 'outside', 'SKILL.md'), skill({ description: 'Outside' }));
  const e = byName(scanClaudeLocal({ cwd, home, env: {} }));
  assert.equal(e.deploy.description, 'Personal deploy');
  assert.equal(e.deploy.source, 'user');
  assert.equal(e.deploy.inputArgs, '[env]');
  assert.equal(e.deploy.command, '/deploy');
  assert.equal(e['api-review'].description, 'Review the API');
  assert.equal(e['api-review'].source, 'project');
  // No description: the first line of the text that is not a heading.
  assert.equal(e['web-check'].description, 'Check the web app before a release.');
  assert.equal(e['web-check'].origin, '.claude/skills/web-check');
  assert.equal(e.hidden, undefined);
  assert.equal(e.synced, undefined);
  assert.equal(e.outside, undefined);
});

test('command files: a subfolder is a prefix, a skill wins over a file of the same name', (t) => {
  const { home, repo, cwd, config } = layout(t);
  write(path.join(repo, '.claude', 'commands', 'frontend', 'component.md'), skill({ description: 'Make a component', 'argument-hint': '<name>' }));
  write(path.join(repo, '.claude', 'commands', 'deploy.md'), 'Deploy from a command file.');
  write(path.join(repo, '.claude', 'skills', 'deploy', 'SKILL.md'), skill({ description: 'Deploy skill' }));
  write(path.join(config, 'commands', 'standup.md'), skill({ description: 'Write the standup' }));
  write(path.join(config, 'commands', 'notes.txt'), 'not a command');
  const e = byName(scanClaudeLocal({ cwd, home, env: {} }));
  assert.equal(e['frontend:component'].command, '/frontend:component');
  assert.equal(e['frontend:component'].kind, 'custom');
  assert.equal(e.deploy.kind, 'skill');
  assert.equal(e.standup.source, 'user');
  assert.equal(Object.keys(e).length, 3);
});

test('a linked worktree without skills uses the main checkout\'s; with its own it does not', (t) => {
  const { root, home } = layout(t);
  const main = path.join(root, 'main');
  const wt = path.join(root, 'main.worktrees', 'feature');
  fs.mkdirSync(path.join(main, '.git', 'worktrees', 'feature'), { recursive: true });
  write(path.join(wt, '.git'), `gitdir: ${path.join(main, '.git', 'worktrees', 'feature')}\n`);
  write(path.join(main, '.claude', 'skills', 'ship-it', 'SKILL.md'), skill({ description: 'From main' }));
  assert.deepEqual(repoOf(wt), { root: wt, mainRoot: main });
  assert.ok(byName(scanClaudeLocal({ cwd: wt, home, env: {} }))['ship-it']);
  write(path.join(wt, '.claude', 'skills', 'own', 'SKILL.md'), skill({ description: 'Own' }));
  const e = byName(scanClaudeLocal({ cwd: wt, home, env: {} }));
  assert.ok(e.own);
  assert.equal(e['ship-it'], undefined);
});

test('an added folder\'s skill takes the folder name as a prefix when its name is taken', (t) => {
  const { root, home, cwd, repo } = layout(t);
  const cli = path.join(root, 'cli');
  write(path.join(repo, '.claude', 'skills', 'verify', 'SKILL.md'), skill({ description: 'Project verify' }));
  write(path.join(cli, '.claude', 'skills', 'verify', 'SKILL.md'), skill({ description: 'CLI verify' }));
  write(path.join(cli, '.claude', 'skills', 'release', 'SKILL.md'), skill({ description: 'CLI release' }));
  const e = byName(scanClaudeLocal({ cwd, addDirs: [cli], home, env: {} }));
  assert.equal(e.verify.description, 'Project verify');
  assert.equal(e['cli:verify'].description, 'CLI verify');
  assert.equal(e.release.description, 'CLI release');
});

test('plugins: installed and on, namespaced, with manifest paths, a root skill and enabledPlugins by scope', (t) => {
  const { home, repo, cwd, config, root } = layout(t);
  const tools = path.join(root, 'cache', 'tools');
  const off = path.join(root, 'cache', 'off');
  const other = path.join(root, 'cache', 'other');
  write(path.join(tools, '.claude-plugin', 'plugin.json'), JSON.stringify({ name: 'tools', skills: ['./extra/lint'] }));
  write(path.join(tools, 'skills', 'review', 'SKILL.md'), skill({ name: 'fancy', description: 'Fancy review' }));
  write(path.join(tools, 'extra', 'lint', 'SKILL.md'), skill({ description: 'Lint' }));
  write(path.join(tools, 'commands', 'ci', 'run.md'), skill({ description: 'Run CI' }));
  write(path.join(off, '.claude-plugin', 'plugin.json'), JSON.stringify({ name: 'off' }));
  write(path.join(off, 'SKILL.md'), skill({ name: 'solo', description: 'Off plugin' }));
  write(path.join(other, 'SKILL.md'), skill({ name: 'solo', description: 'Root skill' }));
  write(path.join(config, 'plugins', 'installed_plugins.json'), JSON.stringify({
    version: 2,
    plugins: {
      'tools@mkt': [{ scope: 'user', installPath: tools }],
      'off@mkt': [{ scope: 'user', installPath: off }],
      'other@mkt': [{ scope: 'user', installPath: other }],
      'gone@mkt': [{ scope: 'user', installPath: path.join(root, 'cache', 'gone') }],
      'elsewhere@mkt': [{ scope: 'project', projectPath: path.join(root, 'elsewhere'), installPath: tools }],
    },
  }));
  write(path.join(config, 'settings.json'), JSON.stringify({ enabledPlugins: { 'off@mkt': true, 'other@mkt': false } }));
  // The project's settings win over the user's; local ones over the project's.
  write(path.join(cwd, '.claude', 'settings.json'), JSON.stringify({ enabledPlugins: { 'other@mkt': true, 'off@mkt': false } }));
  write(path.join(cwd, '.claude', 'settings.local.json'), JSON.stringify({ enabledPlugins: { 'other@mkt': false } }));
  const e = byName(scanClaudeLocal({ cwd, home, env: {} }));
  assert.equal(e['tools:fancy'].description, 'Fancy review');
  assert.equal(e['tools:fancy'].origin, 'tools');
  assert.equal(e['tools:lint'].description, 'Lint');
  assert.equal(e['tools:ci:run'].kind, 'custom');
  assert.equal(e['off:solo'], undefined);
  assert.equal(e['other:solo'], undefined);
  assert.equal(Object.values(e).filter((x) => x.source === 'plugin').length, 3);
  assert.ok(repo);
});

test('synced skills and plugins: a short name only while free, a plugin switched off by name@synced', (t) => {
  const { home, cwd, config } = layout(t);
  write(path.join(config, 'skills', 'pdf', 'SKILL.md'), skill({ description: 'My pdf' }));
  write(path.join(config, 'skills', 'synced', 'pdf', 'SKILL.md'), skill({ description: 'Synced pdf' }));
  write(path.join(config, 'skills', 'synced', 'xlsx', 'SKILL.md'), skill({ description: 'Synced xlsx' }));
  const org = path.join(config, 'plugins', 'synced', 'org-1');
  write(path.join(org, 'design', '.claude-plugin', 'plugin.json'), JSON.stringify({ name: 'design' }));
  write(path.join(org, 'design', 'skills', 'critique', 'SKILL.md'), skill({ description: 'Critique' }));
  write(path.join(org, 'legal', '.claude-plugin', 'plugin.json'), JSON.stringify({ name: 'legal' }));
  write(path.join(org, 'legal', 'skills', 'brief', 'SKILL.md'), skill({ description: 'Brief' }));
  write(path.join(org, 'broken', 'skills', 'x', 'SKILL.md'), skill({ description: 'No manifest' }));
  write(path.join(config, 'settings.json'), JSON.stringify({ enabledPlugins: { 'legal@synced': false } }));
  const e = byName(scanClaudeLocal({ cwd, home, env: {} }));
  assert.equal(e.pdf.description, 'My pdf');
  assert.equal(e['anthropic-skills:pdf'].description, 'Synced pdf');
  assert.equal(e.xlsx.origin, 'claude.ai');
  assert.equal(e['design:critique'].description, 'Critique');
  assert.equal(e['legal:brief'], undefined);
  assert.equal(Object.keys(e).some((n) => n.endsWith(':x')), false);
});

test('MCP servers: local over project over user, each a /mcp reconnect entry', (t) => {
  const { home, cwd } = layout(t);
  write(path.join(home, '.claude.json'), JSON.stringify({
    mcpServers: { github: { type: 'http', url: 'https://mcp.example.com/github' }, shared: { command: 'user-shared' } },
    projects: { [cwd]: { mcpServers: { shared: { command: 'local-shared' } } } },
  }));
  write(path.join(cwd, '.mcp.json'), JSON.stringify({ mcpServers: { db: { command: 'db-server' }, 'bad name': { command: 'x' } } }));
  const servers = scanClaudeLocal({ cwd, home, env: {} }).filter((x) => x.kind === 'mcp');
  const e = byName(servers);
  assert.deepEqual(servers.map((x) => x.name), ['shared', 'db', 'github']);
  assert.match(e.shared.description, /local.*local-shared/);
  assert.equal(e.db.source, 'project');
  assert.equal(e.github.command, '/mcp reconnect github');
  assert.deepEqual(e.github.acceptedValues, ['reconnect', 'enable', 'disable']);
});

test('CLAUDE_CONFIG_DIR moves the personal folder and ~/.claude.json', (t) => {
  const { home, cwd, root } = layout(t);
  const custom = path.join(root, 'claude-config');
  write(path.join(custom, 'skills', 'mine', 'SKILL.md'), skill({ description: 'From the config dir' }));
  write(path.join(custom, '.claude.json'), JSON.stringify({ mcpServers: { cfg: { command: 'x' } } }));
  write(path.join(home, '.claude', 'skills', 'default', 'SKILL.md'), skill({ description: 'Default folder' }));
  const e = byName(scanClaudeLocal({ cwd, home, env: { CLAUDE_CONFIG_DIR: custom } }));
  assert.ok(e.mine);
  assert.ok(e.cfg);
  assert.equal(e.default, undefined);
});

test('names that could type keys are left out', (t) => {
  const { home, repo, cwd } = layout(t);
  write(path.join(repo, '.claude', 'skills', 'ok', 'SKILL.md'), skill({ name: '"bad name"', description: 'Falls back to the folder' }));
  write(path.join(repo, '.claude', 'skills', 'has space', 'SKILL.md'), skill({ description: 'x' }));
  write(path.join(repo, '.claude', 'commands', 'evil\u001b.md'), skill({ description: 'x' }));
  const names = scanClaudeLocal({ cwd, home, env: {} }).map((e) => e.name);
  assert.deepEqual(names, ['ok']);
});

test('a skill named like a built-in command runs instead of it, and both say so', () => {
  const builtIn = [
    { id: 'claude:slash:usage', kind: 'slash', command: '/usage', name: 'usage', description: 'Usage', source: 'official-docs' },
    { id: 'claude:slash:clear', kind: 'slash', command: '/clear', name: 'clear', description: 'Clear', source: 'official-docs' },
    { id: 'claude:flag:model', kind: 'flag', command: '--model', name: '--model', description: 'Model', source: 'official-docs' },
  ];
  const local = [{ id: 'claude:skill:project:usage', kind: 'skill', command: '/usage', name: 'usage', description: 'Mine', source: 'project' }];
  const merged = mergeEntries(builtIn, local);
  assert.deepEqual(merged.map((e) => e.id), ['claude:slash:usage', 'claude:slash:clear', 'claude:skill:project:usage', 'claude:flag:model']);
  assert.match(merged[0].outputBehavior, /runs your skill/);
  assert.match(merged[2].outputBehavior, /instead of the built-in \/usage/);
  assert.equal(merged[1].outputBehavior, undefined);
  assert.equal(mergeEntries(builtIn, []), builtIn);
});

test('the catalog reads a folder\'s own commands at most every ten seconds, and only for a CLI session', () => {
  let scans = 0;
  let clock = 0;
  const catalog = createCommandCatalog({
    loadSnapshot: () => ({ clis: { claude: { entries: [] } } }),
    localScanners: { claude: () => { scans++; return [{ id: 'claude:skill:user:x', kind: 'skill', command: '/x', name: 'x', description: 'X', source: 'user' }]; } },
    now: () => clock,
  });
  const ctx = { runtime: 'claude', projectPath: '/work/shop', addDirs: [] };
  assert.equal(catalog.forSession(ctx).entries.length, 1);
  catalog.forSession(ctx);
  assert.equal(scans, 1);
  clock = 11_000;
  catalog.forSession(ctx);
  assert.equal(scans, 2);
  assert.equal(catalog.forSession({ ...ctx, isPlainTerminal: true }).entries.length, 0);
  const failing = createCommandCatalog({ loadSnapshot: () => ({ clis: { claude: { entries: [] } } }), localScanners: { claude: () => { throw new Error('denied'); } } });
  assert.match(failing.forSession(ctx).notes[0], /could not be read: denied/);
});
