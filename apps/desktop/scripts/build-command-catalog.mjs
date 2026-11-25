#!/usr/bin/env node
// Write public/command-catalog.generated.json: the CLIs' built-in commands
// that the command catalog shows, read from their documentation by the
// modules in harnesses/commands/. The app packs this snapshot and falls back
// on it whenever it cannot refresh the docs itself.
//
//   node scripts/build-command-catalog.mjs               fetch the docs, update the snapshot
//   node scripts/build-command-catalog.mjs --from DIR    read DIR/<cli>/<source id>.* (and version.txt) instead
//   node scripts/build-command-catalog.mjs --check       check the snapshot as it is (no network)
//   … --cli claude                                       only that CLI
//
// Some sources are the CLI's own output (`codex completion fish`) or its
// source code at its release's tag: those run the CLI, so it must be
// installed (the workflow installs it; locally, --cli claude skips it).
// A CLI whose pages did not change keeps its part as it is, generatedAt
// included, so a run without changes leaves the file untouched. No
// dependencies: the weekly workflow (.github/workflows/command-docs-sync.yml)
// runs it with Node alone.

import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const catalog = require(join(root, 'harnesses', 'commands', 'index.js'));
const file = join(root, 'public', 'command-catalog.generated.json');

const args = process.argv.slice(2);
const option = (name) => {
  const at = args.indexOf(name);
  return at >= 0 ? args[at + 1] : undefined;
};
const check = args.includes('--check');
const from = option('--from');
const only = option('--cli');

function fail(message) {
  console.error(message);
  process.exit(1);
}

const current = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : { schema: catalog.SCHEMA, clis: {} };

if (check) {
  const problems = catalog.validateSnapshot(current);
  if (problems.length) fail(`${file}:\n  ${problems.join('\n  ')}`);
  for (const [cli, part] of Object.entries(current.clis)) console.log(`${cli}: ${part.entries.length} entries, ${part.generatedAt}`);
  process.exit(0);
}

/** The output of a CLI's command (`codex completion fish`), read whole. */
function runCommand(argv) {
  const res = spawnSync(argv[0], argv.slice(1), { encoding: 'utf8', timeout: 60000, maxBuffer: 32 * 1024 * 1024 });
  if (res.error) throw new Error(`${argv.join(' ')}: ${res.error.code === 'ENOENT' ? `${argv[0]} is not installed` : res.error.message}`);
  if (res.status !== 0) throw new Error(`${argv.join(' ')} exited with ${res.status}: ${res.stderr}`);
  return res.stdout;
}

/** DIR/<cli>/<id>.<any extension>. */
function readFrom(dir, cli, id) {
  const folder = join(dir, cli);
  const name = readdirSync(folder).find((f) => f === id || f.startsWith(`${id}.`));
  if (!name) throw new Error(`${folder}: no file for ${id}`);
  return readFileSync(join(folder, name), 'utf8');
}

async function fetchPage(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(30000), redirect: 'follow' });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return { text: await res.text(), lastModified: res.headers.get('last-modified') || undefined };
}

const next = { schema: catalog.SCHEMA, clis: { ...current.clis } };
let changed = current.schema !== catalog.SCHEMA;
for (const cli of catalog.catalogClis()) {
  if (only && cli !== only) continue;
  const mod = catalog.commandsOf(cli);
  const pages = {};
  const meta = {};
  let version;
  try {
    const needsVersion = mod.SOURCES.some((s) => s.url && s.url.includes('{tag}'));
    if (needsVersion) {
      const said = from ? readFrom(from, cli, 'version') : runCommand(mod.VERSION_COMMAND);
      version = (/(\d+\.\d+\.\d+)/.exec(said) || [])[1];
      if (!version) throw new Error(`${cli}: no version in "${said.trim()}"`);
    }
    for (const source of mod.SOURCES) {
      if (from) {
        pages[source.id] = readFrom(from, cli, source.id);
      } else if (source.run) {
        pages[source.id] = runCommand(source.run);
      } else {
        const page = await fetchPage(catalog.sourceUrl(cli, source, version));
        pages[source.id] = page.text;
        meta[source.id] = { lastModified: page.lastModified };
      }
    }
  } catch (err) {
    fail(`${cli}: ${err.message}`);
  }
  if (catalog.samePages(current.clis[cli], cli, pages) && (current.clis[cli].cliVersion || undefined) === version) {
    console.log(`${cli}: docs unchanged`);
    continue;
  }
  try {
    next.clis[cli] = catalog.buildCli(cli, pages, { meta, version });
  } catch (err) {
    fail(err.message);
  }
  changed = true;
  console.log(`${cli}: ${next.clis[cli].entries.length} entries${version ? ` (version ${version})` : ''}`);
}

const problems = catalog.validateSnapshot(next);
if (problems.length) fail(`The new snapshot is not valid:\n  ${problems.join('\n  ')}`);
if (changed) {
  writeFileSync(file, catalog.serializeSnapshot(next));
  console.log(`Wrote ${file}`);
} else {
  console.log('No change.');
}
