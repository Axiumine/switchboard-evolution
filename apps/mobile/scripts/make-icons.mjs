// Draws the app's icons from the logo's sources in assets/logo:
//   icon.svg        the whole icon, a full square: the app icon on iOS and in the stores, and the favicon
//   mark.svg        its foreground, on transparency, inside Android's adaptive safe zone
//   background.svg  its dark surface, behind the mark on Android
//   monochrome.svg  the mark in white, for Android's themed icons
//
//   npm i --no-save @napi-rs/canvas && node scripts/make-icons.mjs
//
// The PNGs it writes are committed, so a build never needs this.

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

let canvas;
try {
  canvas = await import('@napi-rs/canvas');
} catch {
  console.error('make-icons: @napi-rs/canvas is missing. Run: npm i --no-save @napi-rs/canvas');
  process.exit(1);
}
const { createCanvas, loadImage } = canvas;

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const source = (name) => loadImage(readFileSync(join(root, 'assets/logo', name)));
const [icon, mark, background, monochrome] = await Promise.all(['icon.svg', 'mark.svg', 'background.svg', 'monochrome.svg'].map(source));

/** Draw layers (each [image, scale]) centred on a square of `size` and save it. */
async function draw(file, size, layers, { crop = null } = {}) {
  const width = crop ? Math.round(crop.width * size) : size;
  const height = crop ? Math.round(crop.height * size) : size;
  const out = createCanvas(width, height);
  const ctx = out.getContext('2d');
  for (const [image, scale = 1] of layers) {
    const s = size * scale;
    const x = (width - s) / 2;
    const y = (height - s) / 2 + (crop ? crop.shiftY * size : 0);
    ctx.drawImage(image, x, y, s, s);
  }
  writeFileSync(join(root, 'assets/images', file), await out.encode('png'));
  console.log(`assets/images/${file} ${width}x${height}`);
}

// iOS and the store: the full square, no transparency.
await draw('icon.png', 1024, [[icon]]);
// Android adaptive icon: the launcher masks and moves these layers itself.
await draw('android-icon-background.png', 512, [[background]]);
await draw('android-icon-foreground.png', 512, [[mark]]);
await draw('android-icon-monochrome.png', 432, [[monochrome]]);
// Splash: the mark alone on the splash colour, cropped to it and its glow (its box is 294..730 x 290..746 of 1024).
await draw('splash-icon.png', 1024, [[mark, 1]], { crop: { width: 0.5, height: 0.5, shiftY: -0.006 } });
await draw('favicon.png', 48, [[icon]]);
