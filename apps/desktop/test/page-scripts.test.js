const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const PUBLIC = path.join(__dirname, '../public');
const read = file => fs.readFileSync(path.join(PUBLIC, file), 'utf8');

// utils.js reads other scripts' globals while it loads. A page that leaves one
// out gets an error in its console, and none of utils.js's tables.
test('every page that loads utils.js loads before it what it needs to run', () => {
  const pages = fs.readdirSync(PUBLIC).filter(file => file.endsWith('.html'))
    .map(page => ({ page, scripts: [...read(page).matchAll(/<script\b[^>]*\bsrc="([^"]+)"/g)].map(match => match[1]) }))
    .filter(({ scripts }) => scripts.includes('utils.js'));
  assert.ok(pages.some(({ page }) => page === 'index.html'), 'the pages and their scripts are read');

  const broken = [];
  for (const { page, scripts } of pages) {
    const context = vm.createContext({});
    vm.runInContext('var window = globalThis;', context);
    for (const script of scripts.slice(0, scripts.indexOf('utils.js'))) {
      // Libraries and built bundles are not what utils.js reads.
      if (script.startsWith('../') || script.endsWith('-bundle.js')) continue;
      // Some need a real page; if utils.js needs one of those, it fails below.
      try { vm.runInContext(read(script), context); } catch {}
    }
    try { vm.runInContext(read('utils.js'), context); } catch (err) { broken.push(`${page}: ${err.message}`); }
  }
  assert.deepEqual(broken, []);
});
