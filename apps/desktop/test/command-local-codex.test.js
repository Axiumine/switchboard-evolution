// The user's own Codex commands (codex-local-commands.js), on throwaway
// folders laid out as Codex expects them.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { scanCodexLocal, readCodexConfig } = require('../codex-local-commands');

function tempDir(t) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'codex-local-')));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function write(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
}

const skill = (name, description) => `---\nname: ${name}\ndescription: ${description}\n---\n\nInstructions.\n`;
const byName = (entries) => Object.fromEntries(entries.map((e) => [e.name, e]));

function layout(t) {
  const root = tempDir(t);
  const home = path.join(root, 'home');
  const repo = path.join(root, 'work', 'shop');
  const cwd = path.join(repo, 'apps', 'web');
  fs.mkdirSync(path.join(repo, '.git'), { recursive: true });
  fs.mkdirSync(cwd, { recursive: true });
  return { root, home, repo, cwd, codexHome: path.join(home, '.codex') };
}

test('config.toml: the skills rules and the MCP servers, sub-tables and comments aside', () => {
  const config = readCodexConfig([
    'model = "gpt-6"',
    '[[skills.config]]',
    'path = "/x/SKILL.md"',
    'enabled = false',
    '[[skills.config]]',
    "name = 'lint'",
    'enabled = true # back on',
    '[mcp_servers.github]',
    'url = "https://mcp.example.com/github"',
    '[mcp_servers.github.env]',
    'TOKEN = "secret"',
    '[mcp_servers."db-local"]',
    'command = "db-server"',
    'enabled = false',
    '[profiles.fast]',
    'model = "x"',
  ].join('\n'));
  assert.deepEqual(config.skills, [{ path: '/x/SKILL.md', enabled: false }, { name: 'lint', enabled: true }]);
  assert.deepEqual(config.servers, { github: { url: 'https://mcp.example.com/github' }, 'db-local': { command: 'db-server', enabled: false } });
});

test('skills from the folders up to the repository root, the user\'s, and the old place; typed as $name', (t) => {
  const { home, repo, cwd, codexHome } = layout(t);
  write(path.join(cwd, '.agents', 'skills', 'web-check', 'SKILL.md'), skill('web-check', 'Check the web app'));
  write(path.join(repo, '.agents', 'skills', 'deploy', 'SKILL.md'), skill('deploy', 'Project deploy'));
  write(path.join(home, '.agents', 'skills', 'deploy', 'SKILL.md'), skill('deploy', 'Personal deploy'));
  write(path.join(home, '.agents', 'skills', 'notes', 'SKILL.md'), skill('notes', 'Write notes'));
  write(path.join(codexHome, 'skills', 'legacy', 'SKILL.md'), skill('legacy', 'From the old place'));
  write(path.join(repo, '..', '.agents', 'skills', 'outside', 'SKILL.md'), skill('outside', 'Above the repository'));
  const e = byName(scanCodexLocal({ cwd, home, env: {}, etc: null }));
  assert.equal(e['web-check'].command, '$web-check');
  assert.equal(e['web-check'].origin, '.agents/skills/web-check');
  assert.equal(e.deploy.description, 'Project deploy');
  assert.equal(e.notes.source, 'user');
  assert.equal(e.legacy.origin, '~/.codex/skills/legacy');
  assert.equal(e.outside, undefined);
});

test('[[skills.config]] switches a skill off by path or by name, the last rule winning', (t) => {
  const { home, cwd, codexHome } = layout(t);
  const lint = path.join(home, '.agents', 'skills', 'lint', 'SKILL.md');
  write(lint, skill('lint', 'Lint'));
  write(path.join(home, '.agents', 'skills', 'fmt', 'SKILL.md'), skill('fmt', 'Format'));
  write(path.join(codexHome, 'config.toml'), `[[skills.config]]\npath = "${lint}"\nenabled = false\n[[skills.config]]\nname = "fmt"\nenabled = false\n[[skills.config]]\nname = "fmt"\nenabled = true\n`);
  const e = byName(scanCodexLocal({ cwd, home, env: {}, etc: null }));
  assert.equal(e.lint, undefined);
  assert.ok(e.fmt);
});

test('custom prompts as /prompts:<name>, and MCP servers from config.toml, under CODEX_HOME', (t) => {
  const { home, cwd, root } = layout(t);
  const codexHome = path.join(root, 'custom-codex');
  write(path.join(codexHome, 'prompts', 'draftpr.md'), '---\ndescription: Prep a branch and open a draft PR\nargument-hint: [FILES=<paths>] [PR_TITLE="<title>"]\n---\nDo it.\n');
  write(path.join(codexHome, 'prompts', 'notes.txt'), 'ignored');
  write(path.join(codexHome, 'config.toml'), '[mcp_servers.github]\nurl = "https://mcp.example.com/github"\n[mcp_servers.local]\ncommand = "srv"\nenabled = false\n');
  const e = byName(scanCodexLocal({ cwd, home, env: { CODEX_HOME: codexHome }, etc: null }));
  assert.equal(e['prompts:draftpr'].command, '/prompts:draftpr');
  assert.equal(e['prompts:draftpr'].inputArgs, '[FILES=<paths>] [PR_TITLE="<title>"]');
  assert.equal(e.github.kind, 'mcp');
  assert.equal(e.github.command, '/mcp');
  assert.match(e.local.description, /switched off/);
  assert.equal(Object.keys(e).length, 3);
});
