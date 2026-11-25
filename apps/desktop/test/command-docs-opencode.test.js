// The OpenCode parser (harnesses/commands/opencode.js) on short excerpts
// written like its sources: the TUI's command declarations
// (packages/tui/src in anomalyco/opencode) and the docs' cli/keybinds.md and
// cli/commands.md. And its own commands on disk (opencode-local-commands.js).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const opencode = require('../harnesses/commands/opencode');
const catalog = require('../harnesses/commands');
const { scanOpencodeLocal } = require('../opencode-local-commands');

const APP = `
export function App() {
  const commands = [
    {
      name: "session.list",
      title: "Switch session",
      category: "Session",
      suggested: data.session.list().length > 0,
      slash: { name: "sessions", aliases: ["resume", "continue"] },
      run: () => {
        dialog.replace(() => <DialogSessionList />)
      },
    },
    {
      name: "session.new",
      title: "New session",
      category: "Session",
      slash: { name: "new" },
      run: () => {
        if (agent) { local.agent.set(agent.id) }
      },
    },
    {
      title: "Exit the app",
      name: "app.exit",
      category: "System",
      slash: { name: "exit", aliases: ["quit", "q"] },
      run: () => exit(),
    },
  ]
}
`;

const SESSION = `
  command.register(() => [
    {
      title: "Rename session",
      value: "session.rename",
      slash: { name: "rename", arguments: true as const },
      onSelect: (dialog) => { dialog.replace(() => <DialogRename />) },
    },
    {
      title: "Compact session",
      value: "session.compact",
      slash: {
        name: "compact",
        aliases: ["summarize"],
      },
    },
  ])
`;

const BTW = `
  api.command.register(() => [{
    title: "Ask a side question",
    description: "One-shot answer from the session's context",
    slash: { name: "btw", arguments: true },
  }])
`;

const KEYBINDS = [
  '# Keybinds',
  '## Application',
  '| ID                     | Default                   | Description                 |',
  '| ---------------------- | ------------------------- | --------------------------- |',
  '| `leader`               | `ctrl+x`                  | Leader key                  |',
  '| `app.exit`             | `ctrl+c,ctrl+d,<leader>q` | Exit the application        |',
  '| `app.debug`            | `none`                    | Toggle debug panel          |',
  '## Session',
  '| ID                     | Default                   | Description                 |',
  '| ---------------------- | ------------------------- | --------------------------- |',
  '| `session.list`         | `<leader>l`               | List sessions               |',
].join('\n');

const CLI_COMMANDS = [
  '# CLI commands',
  '## run',
  '',
  'Sends a message and prints the reply without opening the interactive interface.',
  '',
  '```bash',
  '$ opencode run "Explain this repository"',
  '```',
  '',
  '### CI',
  'In CI, pass a key.',
  '## session',
  '',
  'Manages sessions.',
].join('\n');

test('declarations: the slash name, aliases and arguments, with the command\'s own title, id and category', () => {
  const d = opencode.parseDeclarations(APP);
  assert.deepEqual(d.map((x) => [x.name, x.aliases, x.id, x.title, x.category]), [
    ['sessions', ['resume', 'continue'], 'session.list', 'Switch session', 'Session'],
    ['new', [], 'session.new', 'New session', 'Session'],
    ['exit', ['quit', 'q'], 'app.exit', 'Exit the app', 'System'],
  ]);
  const s = opencode.parseDeclarations(SESSION);
  assert.deepEqual(s.map((x) => [x.name, x.args, x.title, x.aliases]), [['rename', true, 'Rename session', []], ['compact', false, 'Compact session', ['summarize']]]);
  assert.equal(opencode.parseDeclarations(BTW)[0].description, "One-shot answer from the session's context");
});

test('keybinds by command id, shown as people read them', () => {
  const keys = opencode.parseKeybinds(KEYBINDS);
  assert.equal(keys.get('session.list').keys, '<leader>l');
  assert.equal(keys.get('app.exit').group, 'Application');
  assert.equal(opencode.showKeys('ctrl+c,ctrl+d,<leader>q'), 'Ctrl+C, Ctrl+D, Leader+Q');
  assert.equal(opencode.showKeys('shift+g,end'), 'Shift+G, End');
});

test('CLI subcommands from the docs\' sections, with a first example', () => {
  const cli = opencode.parseCliCommands(CLI_COMMANDS);
  assert.deepEqual(cli.map((x) => [x.command, x.description, x.example]), [
    ['opencode run', 'Sends a message and prints the reply without opening the interactive interface.', 'opencode run "Explain this repository"'],
    ['opencode session', 'Manages sessions.', undefined],
  ]);
});

test('all together: keys on slash commands, shortcuts but the leader and unbound keys', () => {
  const pages = { 'tui-app': APP, 'tui-session': SESSION, 'tui-btw': BTW, keybinds: KEYBINDS, 'cli-commands': CLI_COMMANDS };
  const entries = opencode.parseDocs(pages);
  const e = Object.fromEntries(entries.map((x) => [x.id, x]));
  assert.equal(e['opencode:slash:sessions'].outputBehavior, 'Key: Leader+L.');
  assert.equal(e['opencode:slash:sessions'].group, 'Session');
  assert.ok(e['opencode:slash:sessions'].flags.includes('opensMenu'));
  assert.ok(e['opencode:slash:exit'].flags.includes('endsSession'));
  assert.equal(e['opencode:slash:rename'].inputArgs, '[args]');
  assert.equal(e['opencode:slash:btw'].description, "Ask a side question: One-shot answer from the session's context.");
  assert.deepEqual(entries.filter((x) => x.kind === 'shortcut').map((x) => x.name), ['app.exit', 'session.list']);
});

test('the TUI files are read at the release\'s tag', () => {
  const app = opencode.SOURCES.find((s) => s.id === 'tui-app');
  assert.equal(catalog.sourceUrl('opencode', app, '2.4.1'), 'https://raw.githubusercontent.com/anomalyco/opencode/v2.4.1/packages/tui/src/app.tsx');
  assert.ok(opencode.sanity(opencode.parseDocs({ 'tui-app': APP, keybinds: KEYBINDS })).includes('slash: compact is missing'));
});

function tempDir(t) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'opencode-local-')));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function write(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
}

test('own commands: files and config, nested names, the nearer replacing the farther', (t) => {
  const root = tempDir(t);
  const home = path.join(root, 'home');
  const repo = path.join(root, 'shop');
  const cwd = path.join(repo, 'web');
  fs.mkdirSync(path.join(repo, '.git'), { recursive: true });
  fs.mkdirSync(cwd, { recursive: true });
  const config = path.join(home, '.config', 'opencode');
  write(path.join(config, 'commands', 'review.md'), '---\ndescription: Global review\n---\nReview $ARGUMENTS.');
  write(path.join(config, 'command', 'old.md'), 'The legacy folder.');
  write(path.join(repo, '.opencode', 'commands', 'review.md'), '---\ndescription: Project review\nagent: plan\n---\nReview.');
  write(path.join(repo, '.opencode', 'commands', 'git', 'release.md'), '---\ndescription: Release\n---\n');
  write(path.join(cwd, 'opencode.jsonc'), '{\n  // comments are fine\n  "commands": { "test": { "template": "Run the tests", "description": "Run tests" }, },\n  "mcp": { "servers": { "db": { "type": "local", "command": ["db-server"], "disabled": true } } }\n}');
  write(path.join(config, 'opencode.json'), JSON.stringify({ mcp: { servers: { docs: { type: 'remote', url: 'https://mcp.example.com' } } } }));
  // Skills: a later source replaces an earlier one with the same id.
  write(path.join(home, '.claude', 'skills', 'deploy', 'SKILL.md'), '---\nname: Deploy\ndescription: From Claude\n---\n');
  write(path.join(repo, '.opencode', 'skills', 'deploy', 'SKILL.md'), '---\ndescription: From OpenCode\n---\n');
  write(path.join(repo, '.agents', 'skills', 'teams', 'release', 'SKILL.md'), '---\ndescription: Nested release\n---\n');
  write(path.join(repo, '.agents', 'skills', 'quick.md'), '---\ndescription: A flat skill\n---\n');
  const e = Object.fromEntries(scanOpencodeLocal({ cwd, home, env: {} }).map((x) => [x.id, x]));
  assert.equal(e['opencode:custom:review'].description, 'Project review');
  assert.equal(e['opencode:custom:review'].outputBehavior, 'Runs with the plan agent.');
  assert.equal(e['opencode:custom:git-release'].command, '/git/release');
  assert.equal(e['opencode:custom:old'].source, 'user');
  assert.equal(e['opencode:custom:test'].description, 'Run tests');
  assert.equal(e['opencode:skill:deploy'].command, '@deploy');
  assert.equal(e['opencode:skill:deploy'].description, 'From OpenCode');
  assert.equal(e['opencode:skill:release'].description, 'Nested release');
  assert.equal(e['opencode:skill:quick'].description, 'A flat skill');
  assert.match(e['opencode:mcp:db'].description, /switched off: local: db-server/);
  assert.equal(e['opencode:mcp:docs'].command, '/mcps');
});
