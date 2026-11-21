#!/usr/bin/env node
// Draws the app's icons from build/icon-source.svg, a full square:
//   build/icon.png   1024 px with round corners (the window's and the dock's in development, and the source of the others)
//   build/icon.icns  macOS: the rounded square inside the margin macOS icons keep (824 of 1024 px)
//   build/icon.ico   Windows
//   build/icons/     Linux, the hicolor sizes
//
//   npm run generate-icons
//
// The files it writes are committed, so a build never needs this.

const { execSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const png2icons = require('png2icons');
const { loadImage, createCanvas } = require('@napi-rs/canvas');

const OUTPUT_DIR = path.join(__dirname, '..', 'build');
const sourcePath = path.join(OUTPUT_DIR, 'icon-source.svg');
const pngPath = path.join(OUTPUT_DIR, 'icon.png');

const SIZE = 1024;
// Apple's icon grid: an 824 px body in a 1024 px canvas, with corners of 185 px.
const MAC_BODY = 824;
const CORNER = 185 / 824;

/** The source drawn as a square of `body` px with round corners, centred on a transparent `size` px canvas. */
function rounded(source, size, body) {
  const canvas = createCanvas(size, size);
  const ctx = canvas.getContext('2d');
  const offset = (size - body) / 2;
  ctx.beginPath();
  ctx.roundRect(offset, offset, body, body, body * CORNER);
  ctx.clip();
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(source, offset, offset, body, body);
  return canvas;
}

async function main() {
  // Drawn at 1024 px whatever size the SVG says it is.
  const svg = fs.readFileSync(sourcePath, 'utf8').replace(/<svg([^>]*?)\swidth="[^"]*"\s+height="[^"]*"/, `<svg$1 width="${SIZE}" height="${SIZE}"`);
  const source = await loadImage(Buffer.from(svg));

  fs.writeFileSync(pngPath, await rounded(source, SIZE, SIZE).encode('png'));
  console.log(`Created ${pngPath}`);

  const icnsPath = path.join(OUTPUT_DIR, 'icon.icns');
  const macIcon = rounded(source, SIZE, MAC_BODY);
  if (process.platform === 'darwin') {
    // iconutil keeps the transparency exactly.
    const iconsetDir = fs.mkdtempSync(path.join(os.tmpdir(), 'switchboard-icon-')) + '/icon.iconset';
    fs.mkdirSync(iconsetDir);
    const macImage = await loadImage(await macIcon.encode('png'));
    for (const size of [16, 32, 128, 256, 512]) {
      for (const [scale, suffix] of [[1, ''], [2, '@2x']]) {
        const c = createCanvas(size * scale, size * scale);
        const ctx = c.getContext('2d');
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(macImage, 0, 0, size * scale, size * scale);
        fs.writeFileSync(path.join(iconsetDir, `icon_${size}x${size}${suffix}.png`), await c.encode('png'));
      }
    }
    execSync(`iconutil -c icns "${iconsetDir}" -o "${icnsPath}"`, { stdio: 'inherit' });
    fs.rmSync(path.dirname(iconsetDir), { recursive: true });
  } else {
    const icnsBuffer = png2icons.createICNS(await macIcon.encode('png'), png2icons.BICUBIC2, 0);
    if (icnsBuffer) fs.writeFileSync(icnsPath, icnsBuffer);
  }
  console.log(`Created ${icnsPath} (with the macOS margin)`);

  // ICO (Windows): png2icons on every platform.
  const icoBuffer = png2icons.createICO(fs.readFileSync(pngPath), png2icons.BICUBIC2, 0, true);
  if (icoBuffer) {
    const icoPath = path.join(OUTPUT_DIR, 'icon.ico');
    fs.writeFileSync(icoPath, icoBuffer);
    console.log(`Created ${icoPath} (${icoBuffer.length} bytes)`);
  }

  // Linux: hicolor-sized PNGs for /usr/share/icons/hicolor/<size>x<size>/apps/;
  // electron-builder picks these up when linux.icon points at the directory.
  const linuxDir = path.join(OUTPUT_DIR, 'icons');
  fs.mkdirSync(linuxDir, { recursive: true });
  const img = await loadImage(pngPath);
  for (const size of [16, 32, 48, 64, 128, 256, 512]) {
    const c = createCanvas(size, size);
    const ctx = c.getContext('2d');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, 0, 0, size, size);
    fs.writeFileSync(path.join(linuxDir, `${size}x${size}.png`), c.toBuffer('image/png'));
  }
  console.log(`Created ${linuxDir} (Linux hicolor sizes)`);
  console.log('Icon generation complete.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
