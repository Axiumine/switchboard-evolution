#!/usr/bin/env node
// Turn src/terminal/terminal-buttons.yml, the terminal's key bar, into
// src/terminal/terminal-buttons.generated.ts, which the app imports. The
// output is committed; a test fails while it differs from the YAML.
//
//   node scripts/build-terminal-keys.mjs          write the module
//   node scripts/build-terminal-keys.mjs --check  exit 1 if it is out of date

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const { readButtons, renderModule } = createRequire(import.meta.url)('./terminal-buttons.cjs');

const source = join(root, 'src/terminal/terminal-buttons.yml');
const target = join(root, 'src/terminal/terminal-buttons.generated.ts');
const content = renderModule(readButtons(readFileSync(source, 'utf8')));
const current = existsSync(target) ? readFileSync(target, 'utf8') : null;

if (process.argv.includes('--check')) {
  if (current !== content) {
    console.error('src/terminal/terminal-buttons.generated.ts is out of date: run npm run build-terminal-keys.');
    process.exit(1);
  }
} else if (current !== content) {
  writeFileSync(target, content);
  console.log('terminal-buttons.yml → src/terminal/terminal-buttons.generated.ts');
}
