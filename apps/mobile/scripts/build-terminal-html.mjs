#!/usr/bin/env node
// Build the page the terminal WebView loads: xterm.js and its fit addon
// inlined (no network), a monospace font, plus a small bridge to the app.
// Runs after npm install; the output is generated, not committed.
//
//   node scripts/build-terminal-html.mjs

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (path) => readFileSync(join(root, 'node_modules', path), 'utf8');

const xtermJs = read('@xterm/xterm/lib/xterm.js');
const xtermCss = read('@xterm/xterm/css/xterm.css');
const fitJs = read('@xterm/addon-fit/lib/addon-fit.js');
// The terminal answers no questions: see terminal-replies.cjs.
const { quietReplies, isFocusReport } = createRequire(import.meta.url)('./terminal-replies.cjs');

// The terminal font. A WebView cannot use the app's fonts, and Android has
// neither Menlo nor the symbols Claude Code and Codex print, so the page
// carries its own. Adwaita Mono (SIL OFL 1.1, @fontsource/adwaita-mono) has
// ASCII, box drawing, block elements, arrows, and ⏵ ⏺ ⏸ ✻ ✳ ✢ ⎿ ❯ ● ✓ … all
// one cell wide, which a terminal needs: xterm's DOM renderer draws every
// character from the font (its own box drawing only works with WebGL).
// The usual coding fonts fall short here: the JetBrains Mono package has no
// box drawing (its Google Fonts subsets leave it out), and Fira Code,
// Cascadia Mono and DejaVu Sans Mono have no ⏵ ⏺ ⏸.
//
// The font is cut down to the blocks a terminal shows, which takes it from
// about 360 KB to under 100 KB per weight.
const TERMINAL_FONT_FAMILY = 'Adwaita Mono';
const FONT_RANGES = [
  [0x0020, 0x007e], [0x00a0, 0x024f], // Latin, Latin-1, Latin Extended A and B
  [0x0300, 0x036f], // combining accents
  [0x0370, 0x03ff], [0x0400, 0x04ff], // Greek, Cyrillic
  [0x2000, 0x20cf], // punctuation (… • ›), super- and subscripts, currency
  [0x2100, 0x21ff], // letterlike, number forms, arrows
  [0x2200, 0x23ff], // math operators, technical (⌘ ⏎ ⏵ ⏺ ⏸ ⎿)
  [0x2400, 0x24ff], // control pictures, enclosed alphanumerics
  [0x2500, 0x25ff], // box drawing, block elements, geometric shapes (● ○ ■ ▶)
  [0x2600, 0x27bf], // symbols, dingbats (⚠ ★ ✓ ✗ ✻ ✳ ✶ ✢ ❯)
  [0x27c0, 0x28ff], // arrows, braille (spinners)
  [0x2900, 0x297f], [0x2b00, 0x2bff], // more arrows and symbols
  [0xe0a0, 0xe0d7], // powerline
  [0xfffd, 0xfffd],
  [0x1fb00, 0x1fbff], // legacy computing (sextants)
];

const fontDir = join(root, 'node_modules', '@fontsource/adwaita-mono');

async function terminalFont(weight) {
  const full = readFileSync(join(fontDir, 'files', `adwaita-mono-latin-${weight}-normal.woff2`));
  let text = '';
  for (const [from, to] of FONT_RANGES) for (let c = from; c <= to; c++) text += String.fromCodePoint(c);
  try {
    const { default: subsetFont } = await import('subset-font');
    // No layout features: a terminal must not join "->" or "fi" into one glyph.
    // The copyright and license stay in the font's name table (ids 0, 13, 14).
    return await subsetFont(full, text, { targetFormat: 'woff2', keepFeatures: [], noHinting: true, preserveNameIds: [0, 13, 14] });
  } catch (err) {
    console.warn(`terminal page: could not cut down the ${weight} font (${err.message}); using all of it`);
    return full;
  }
}

// The @font-face rules, and the license comment that goes with them. Without
// the dev dependencies (an install that leaves them out) the page falls back
// to the system's monospace font.
async function fontStyles() {
  if (!existsSync(fontDir)) {
    console.warn('terminal page: @fontsource/adwaita-mono is not installed; the terminal uses the system font');
    return '';
  }
  const faces = await Promise.all([400, 700].map(async (weight) => `@font-face {
  font-family: '${TERMINAL_FONT_FAMILY}';
  font-style: normal;
  font-weight: ${weight};
  font-display: block;
  src: url(data:font/woff2;base64,${(await terminalFont(weight)).toString('base64')}) format('woff2');
}`));
  // The LICENSE starts with the copyright lines, then a blank line.
  const copyright = readFileSync(join(fontDir, 'LICENSE'), 'utf8').split(/\r?\n\s*\r?\n/)[0].split(/\r?\n/).join('; ');
  return `/* ${TERMINAL_FONT_FAMILY}, licensed under the SIL Open Font License 1.1 (https://openfontlicense.org). ${copyright} */\n${faces.join('\n')}`;
}
const fontFaces = await fontStyles();

// The bridge: the app calls window.sb.* through injectJavaScript; the page
// answers with postMessage({ type, ... }).
//
// Scrolling is done here, not by the browser: at the computer's width the
// terminal is wider than the phone (one finger pans sideways) and often
// taller (the page scrolls the part of the screen below the fold), and xterm
// scrolls its scrollback only for a mouse wheel. A drag locks to one axis so
// sideways and up/down never fight.
const bridge = `
(function () {
  var post = function (message) { window.ReactNativeWebView.postMessage(JSON.stringify(message)); };
  ${quietReplies.toString()}
  ${isFocusReport.toString()}
  var family = '"${TERMINAL_FONT_FAMILY}", monospace';
  // xterm measures the cell from the font when it opens: with the font not
  // loaded yet it measures a fallback and spaces the real letters out.
  var loaded = false;
  var fonts = Promise.all(['400', '700'].map(function (weight) {
    return document.fonts.load(weight + ' 12px "${TERMINAL_FONT_FAMILY}"', 'M─⏵');
  })).then(function () { loaded = true; });
  var timeout = new Promise(function (resolve) { setTimeout(resolve, 3000); });
  Promise.race([fonts, timeout]).then(start, start);

  function start() {
    var term = new Terminal({
      fontSize: 12,
      fontFamily: family,
      // The font's own line height (1.25 em) already has room between rows,
      // and box drawing only joins up from row to row at that height.
      letterSpacing: 0,
      lineHeight: 1,
      scrollback: 5000,
      cursorBlink: false,
      theme: { background: '#111118', foreground: '#d0d0e0', cursor: '#8088ff', selectionBackground: 'rgba(128,136,255,0.35)' },
    });
    var fit = new FitAddon.FitAddon();
    term.loadAddon(fit);
    var wrap = document.getElementById('wrap');
    var el = document.getElementById('term');
    var bar = document.getElementById('hbar');
    quietReplies(term);
    term.open(el);
    term.onData(function (data) { if (!isFocusReport(data)) post({ type: 'input', data: data }); });

    // The terminal has the phone's size (Fit to phone), not the computer's.
    var fitted = false;
    // Keep the newest line in view: true until the user scrolls away from it.
    var follow = true;

    var screen = function () { return el.querySelector('.xterm-screen'); };
    var cellWidth = function () { var s = screen(); return s && term.cols ? s.clientWidth / term.cols : 7; };
    var cellHeight = function () { var s = screen(); return s && term.rows ? s.clientHeight / term.rows : 14; };
    var maxTop = function () { return Math.max(0, wrap.scrollHeight - wrap.clientHeight); };
    var maxLeft = function () { return Math.max(0, wrap.scrollWidth - wrap.clientWidth); };

    // The thin bar under the terminal that shows where the view is sideways.
    function showBar() {
      var view = wrap.clientWidth, all = wrap.scrollWidth;
      if (all <= view + 1) { bar.style.opacity = '0'; return; }
      var width = Math.max(24, view * view / all);
      bar.style.width = width + 'px';
      bar.style.transform = 'translateX(' + (wrap.scrollLeft / (all - view)) * (view - width) + 'px)';
      bar.style.opacity = '1';
    }

    // One vertical position over everything: the scrollback (xterm scrolls it
    // by lines), then the part of the screen below the fold (the page scrolls
    // that). The page is only scrolled down while xterm shows its newest lines.
    function position() { return term.buffer.active.viewportY * cellHeight() + wrap.scrollTop; }
    function limit() { return term.buffer.active.baseY * cellHeight() + maxTop(); }
    function setPosition(px) {
      var h = cellHeight(), scrollback = term.buffer.active.baseY * h;
      px = Math.max(0, Math.min(px, limit()));
      if (px < scrollback) {
        term.scrollToLine(Math.floor(px / h));
        wrap.scrollTop = 0;
      } else {
        term.scrollToBottom();
        wrap.scrollTop = px - scrollback;
      }
      follow = px >= limit() - 2;
      return px;
    }
    function setLeft(px) {
      wrap.scrollLeft = Math.max(0, Math.min(px, maxLeft()));
      showBar();
      return wrap.scrollLeft;
    }
    function keepNewestInView() {
      if (follow) { term.scrollToBottom(); wrap.scrollTop = maxTop(); }
      showBar();
    }
    // After a replay: the prompt and the cursor in view (the left edge, unless
    // the cursor is further right than the phone is wide).
    function revealCursor() {
      var x = (term.buffer.active.cursorX + 1) * cellWidth();
      setLeft(x > wrap.clientWidth ? x - wrap.clientWidth + 4 * cellWidth() : 0);
      follow = true;
      keepNewestInView();
    }

    var touch = null;
    var fling = 0;
    wrap.addEventListener('touchstart', function (e) {
      cancelAnimationFrame(fling);
      if (e.touches.length !== 1) { touch = null; return; }
      var t = e.touches[0];
      touch = { x: t.clientX, y: t.clientY, left: wrap.scrollLeft, pos: position(), axis: null, moves: [{ x: t.clientX, y: t.clientY, at: e.timeStamp }] };
    }, { passive: true });
    wrap.addEventListener('touchmove', function (e) {
      if (!touch || e.touches.length !== 1) return;
      var t = e.touches[0], dx = t.clientX - touch.x, dy = t.clientY - touch.y;
      if (!touch.axis) {
        // A tap stays a tap (it focuses the terminal); lock once it moves.
        if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
        touch.axis = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y';
      }
      e.preventDefault();
      if (touch.axis === 'x') setLeft(touch.left - dx);
      else setPosition(touch.pos - dy);
      touch.moves.push({ x: t.clientX, y: t.clientY, at: e.timeStamp });
      if (touch.moves.length > 6) touch.moves.shift();
    }, { passive: false });
    wrap.addEventListener('touchend', function (e) {
      var done = touch;
      touch = null;
      if (!done || !done.axis || done.moves.length < 2) return;
      // Keep going for a moment at the speed the finger left with.
      var first = done.moves[0], last = done.moves[done.moves.length - 1];
      var ms = last.at - first.at;
      if (ms <= 0 || e.timeStamp - last.at > 80) return;
      var speed = done.axis === 'x' ? (last.x - first.x) / ms : (last.y - first.y) / ms;
      var at = done.axis === 'x' ? wrap.scrollLeft : position();
      var before = performance.now();
      var step = function (now) {
        var dt = now - before;
        before = now;
        at -= speed * dt;
        var reached = done.axis === 'x' ? setLeft(at) : setPosition(at);
        speed *= Math.pow(0.996, dt);
        if (Math.abs(speed) > 0.03 && Math.abs(reached - at) < 1) fling = requestAnimationFrame(step);
      };
      fling = requestAnimationFrame(step);
    });
    wrap.addEventListener('touchcancel', function () { touch = null; });
    // A trackpad or mouse on a tablet: sideways wheel pans, up/down stays xterm's.
    wrap.addEventListener('wheel', function (e) {
      if (Math.abs(e.deltaX) <= Math.abs(e.deltaY)) return;
      e.preventDefault();
      setLeft(wrap.scrollLeft + e.deltaX);
    }, { passive: false });

    function postSize() {
      var s = screen();
      post({ type: 'size', cols: term.cols, rows: term.rows, width: s ? s.clientWidth : 0 });
    }
    term.onResize(function () { postSize(); keepNewestInView(); });

    // The page got shorter or taller (the keyboard, a rotation): keep the
    // newest line in view; a fitted terminal takes the new size.
    var refit = 0;
    window.addEventListener('resize', function () {
      keepNewestInView();
      if (fitted) { clearTimeout(refit); refit = setTimeout(function () { if (fitted) window.sb.measure(); }, 150); }
    });

    window.sb = {
      // The replay: once it is drawn the app takes its spinner away.
      reset: function (data, cols, rows) {
        term.reset();
        if (cols && rows) term.resize(cols, rows);
        term.write(data, function () { revealCursor(); post({ type: 'loaded' }); });
        postSize();
      },
      write: function (data) { term.write(data); },
      resize: function (cols, rows) { if (cols && rows) term.resize(cols, rows); },
      fontSize: function (size) {
        term.options.fontSize = size;
        requestAnimationFrame(function () { postSize(); keepNewestInView(); });
      },
      // The size that fills the screen at the current font size. The container
      // takes the screen's width for this; otherwise it grows with the
      // terminal (to scroll sideways) and the fit would measure the terminal.
      measure: function () {
        fitted = true;
        el.style.display = 'block';
        el.style.width = '100%';
        var size = fit.proposeDimensions();
        post({ type: 'measure', cols: size ? size.cols : null, rows: size ? size.rows : null });
      },
      // Back to the computer's width: let the container grow again.
      unfit: function () {
        fitted = false;
        el.style.display = '';
        el.style.width = '';
      },
      focus: function () { term.focus(); },
      blur: function () { term.blur(); },
    };
    // Started without the font (it took too long): measure again once it is there.
    if (!loaded) fonts.then(function () { term.options.fontFamily = 'monospace'; term.options.fontFamily = family; });
    post({ type: 'ready' });
  }
})();
`;

const html = `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no">
<style>
${fontFaces}
${xtermCss}
html, body { margin: 0; height: 100%; background: #111118; }
/* Wider (and often taller) than the screen at the computer's size. The
   bridge scrolls it: touch-action none keeps the browser from panning too. */
#wrap { position: absolute; inset: 0; overflow: hidden; touch-action: none; }
#term { display: inline-block; min-width: 100%; height: 100%; }
#hbar { position: fixed; left: 0; bottom: 1px; height: 3px; border-radius: 2px; background: rgba(208, 208, 224, 0.28); opacity: 0; pointer-events: none; }
</style>
</head>
<body>
<div id="wrap"><div id="term"></div></div>
<div id="hbar"></div>
<script>${xtermJs}</script>
<script>${fitJs}</script>
<script>${bridge}</script>
</body>
</html>`;

const outFile = join(root, 'src', 'terminal', 'terminal-html.generated.ts');
mkdirSync(dirname(outFile), { recursive: true });
writeFileSync(outFile, `// Generated by scripts/build-terminal-html.mjs from @xterm/xterm and @fontsource/adwaita-mono. Do not edit.\nexport const TERMINAL_HTML = ${JSON.stringify(html)};\n`);
console.log(`terminal page → src/terminal/terminal-html.generated.ts (${Math.round(html.length / 1024)} KB)`);
