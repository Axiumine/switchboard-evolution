// REPL driver for the desktop app (apps/desktop), for agents: it launches the
// Electron app with Playwright and takes one command per line on stdin.
// drive.sh runs it inside tmux and sends it the commands.
//
// Always against a data folder of its own (SWITCHBOARD_DATA_DIR, by default
// ~/.switchboard-dev, as `npm run electron-dev`), never the real one.
//
// Commands:
//   launch                 start the app, wait for the sidebar
//   dismiss                close the "What's new" dialog of a fresh data folder
//   tab <name>             click a sidebar tab (projects, sessions, plans, memory = Files, stats)
//   wins                   list the windows
//   use <n>                act on window n (0 is the main window)
//   ss [name]              screenshot the current window
//   click <css selector>   click an element through the DOM
//   eval <expression>      evaluate in the current window (await allowed) and print the JSON result
//   dialogs accept|dismiss what to do with alert/confirm/prompt (default: dismiss, and log them)
//   wait <ms>              pause
//   quit                   close the app and the driver

import { createRequire } from 'node:module';
import * as readline from 'node:readline';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const REPO = path.resolve(import.meta.dirname, '../../..');
const APP_DIR = path.join(REPO, 'apps/desktop');
const DEPS_DIR = process.env.SB_DRIVER_DEPS || path.join(os.homedir(), '.cache', 'switchboard-desktop-driver');
const OUT_DIR = process.env.SB_DRIVER_OUT || path.join(os.tmpdir(), 'switchboard-desktop-driver');
const SHOT_DIR = path.join(OUT_DIR, 'shots');
const LOG = path.join(OUT_DIR, 'app.log');
const DATA_DIR = process.env.SWITCHBOARD_DATA_DIR || path.join(os.homedir(), '.switchboard-dev');
fs.mkdirSync(SHOT_DIR, { recursive: true });

let electron;
try {
  ({ _electron: electron } = createRequire(path.join(DEPS_DIR, 'package.json'))('playwright-core'));
} catch {
  console.log(`playwright-core is not installed in ${DEPS_DIR}: run drive.sh start, which installs it.`);
  process.exit(1);
}

const ELECTRON_BIN = {
  darwin: 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron',
  win32: 'node_modules/electron/dist/electron.exe',
}[process.platform] || 'node_modules/electron/dist/electron';

let app = null;
let page = null;
let dialogPolicy = 'dismiss';

const log = (line) => fs.appendFileSync(LOG, `${line}\n`);

function watch(win, label) {
  win.on('console', m => log(`[${label} ${m.type()}] ${m.text()}`));
  win.on('pageerror', e => log(`[${label} pageerror] ${e.message}`));
  // Playwright dismisses dialogs nobody listens to: confirm() would answer
  // false without a word. Log each one and follow the policy instead.
  win.on('dialog', async (d) => {
    console.log(`dialog (${d.type()}, ${dialogPolicy}): ${d.message().replace(/\n+/g, ' / ')}`);
    await (dialogPolicy === 'accept' ? d.accept() : d.dismiss()).catch(() => {});
  });
}

function need() {
  if (!page) throw new Error('launch first');
}

const commands = {
  async launch() {
    if (app) return console.log('already launched');
    const bin = path.join(APP_DIR, ELECTRON_BIN);
    if (!fs.existsSync(bin)) throw new Error(`no Electron at ${bin}: run npm ci in apps/desktop`);
    const args = process.platform === 'linux' ? ['--no-sandbox', APP_DIR] : [APP_DIR];
    app = await electron.launch({
      executablePath: bin, args, cwd: APP_DIR, timeout: 60_000,
      env: { ...process.env, SWITCHBOARD_DATA_DIR: DATA_DIR },
    });
    app.process().stdout?.on('data', d => fs.appendFileSync(LOG, d));
    app.process().stderr?.on('data', d => fs.appendFileSync(LOG, d));
    app.on('window', (win) => watch(win, `w${app.windows().indexOf(win)}`));
    page = await app.firstWindow();
    watch(page, 'w0');
    await page.waitForSelector('#sidebar-tabs', { timeout: 30_000 });
    console.log(`launched, data folder ${DATA_DIR}`);
  },
  async dismiss() {
    need();
    const closed = await page.evaluate(() => {
      const btn = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Dismiss');
      btn?.click();
      return !!btn;
    });
    console.log(closed ? 'dismissed' : 'no dialog');
  },
  async tab(name) {
    need();
    const r = await page.evaluate((n) => {
      const el = document.querySelector(`.sidebar-tab[data-tab="${n}"]`);
      if (!el) return 'NOT_FOUND';
      el.click();
      return 'OK';
    }, name);
    console.log('tab', name, '->', r);
  },
  async wins() {
    if (!app) throw new Error('launch first');
    app.windows().forEach((w, i) => console.log(i, decodeURIComponent(w.url().split('/public/').pop())));
  },
  async use(n) {
    const win = app?.windows()[Number(n)];
    if (!win) throw new Error(`no window ${n}`);
    page = win;
    console.log('using', n, decodeURIComponent(page.url().split('/public/').pop()));
  },
  async ss(name) {
    need();
    const file = path.join(SHOT_DIR, `${name || `ss-${Date.now()}`}.png`);
    await page.screenshot({ path: file });
    console.log('screenshot', file);
  },
  async click(selector) {
    need();
    const r = await page.evaluate((s) => {
      const el = document.querySelector(s);
      if (!el) return 'NOT_FOUND';
      el.click();
      return 'OK';
    }, selector);
    console.log('click', selector, '->', r);
  },
  async eval(expression) {
    need();
    const result = await page.evaluate(`(async () => (${expression}))()`);
    const text = JSON.stringify(result);
    console.log('=>', text === undefined ? 'undefined' : text.slice(0, 4000));
  },
  async dialogs(policy) {
    if (!['accept', 'dismiss'].includes(policy)) throw new Error('dialogs accept|dismiss');
    dialogPolicy = policy;
    console.log('dialogs', policy);
  },
  async wait(ms) {
    await new Promise(r => setTimeout(r, Number(ms) || 1000));
    console.log('waited', ms);
  },
  async quit() {
    await app?.close().catch(() => {});
    console.log('quit');
    console.log('---');
    process.exit(0);
  },
};

console.log(`ready (log ${LOG})`);
console.log('---');
const rl = readline.createInterface({ input: process.stdin });
for await (const line of rl) {
  const text = line.trim();
  if (!text) continue;
  const space = text.indexOf(' ');
  const cmd = space < 0 ? text : text.slice(0, space);
  const arg = space < 0 ? '' : text.slice(space + 1);
  try {
    if (!commands[cmd]) console.log(`unknown command: ${cmd}`);
    else await commands[cmd](arg);
  } catch (err) {
    console.log('ERROR', String(err.message).split('\n')[0]);
  }
  // Each answer ends with this line: drive.sh send waits for it.
  console.log('---');
}
