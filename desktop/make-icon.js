// Draws the Kurapify icon once and writes every copy of it. Run with: npx electron make-icon.js
//   desktop/icon.png, desktop/icon.ico     the window, taskbar and installer icon (ico holds 16 to 256 px)
//   web/app/public/favicon.svg             the site and PWA icon
//   web/extension/public/icon/*.png        the browser extension's icons
//   docs/assets/logo.svg                   the README's logo
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');

/** A squircle, the superellipse Apple's icons use: rounder than a rounded square, with no flat-to-curve seam. */
function squircle(inset, n = 5) {
  const r = 512 - inset;
  const points = [];
  for (let i = 0; i < 360; i++) {
    const t = (i / 360) * Math.PI * 2;
    const c = Math.cos(t);
    const s = Math.sin(t);
    const x = 512 + r * Math.sign(c) * Math.abs(c) ** (2 / n);
    const y = 512 + r * Math.sign(s) * Math.abs(s) ** (2 / n);
    points.push(`${x.toFixed(1)} ${y.toFixed(1)}`);
  }
  return `M${points.join('L')}Z`;
}

const K = 'M372 224V800M372 536L684 224M488 452L700 800';

const SVG = `<svg width="1024" height="1024" viewBox="0 0 1024 1024" fill="none" xmlns="http://www.w3.org/2000/svg">
<defs>
  <linearGradient id="bg" x1="150" y1="0" x2="880" y2="1024" gradientUnits="userSpaceOnUse">
    <stop stop-color="#FF6F80"/><stop offset=".48" stop-color="#E5245F"/><stop offset="1" stop-color="#8E0F4E"/>
  </linearGradient>
  <radialGradient id="glow" cx="0" cy="0" r="1" gradientUnits="userSpaceOnUse" gradientTransform="translate(300 120) rotate(50) scale(760 640)">
    <stop stop-color="#fff" stop-opacity=".34"/><stop offset="1" stop-color="#fff" stop-opacity="0"/>
  </radialGradient>
  <linearGradient id="k" x1="0" y1="224" x2="0" y2="800" gradientUnits="userSpaceOnUse">
    <stop stop-color="#fff"/><stop offset="1" stop-color="#FFD9E0"/>
  </linearGradient>
  <linearGradient id="rim" x1="0" y1="0" x2="0" y2="1024" gradientUnits="userSpaceOnUse">
    <stop stop-color="#fff" stop-opacity=".5"/><stop offset=".4" stop-color="#fff" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".22"/>
  </linearGradient>
  <filter id="soft" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="22"/></filter>
</defs>
<path d="${squircle(16)}" fill="url(#bg)"/>
<path d="${squircle(16)}" fill="url(#glow)"/>
<path d="${K}" transform="translate(0 26)" stroke="#5B0630" stroke-opacity=".5" stroke-width="124" stroke-linecap="round" stroke-linejoin="round" filter="url(#soft)"/>
<path d="${K}" stroke="url(#k)" stroke-width="124" stroke-linecap="round" stroke-linejoin="round"/>
<path d="${squircle(19)}" stroke="url(#rim)" stroke-width="6"/>
</svg>`;

/** An .ico of PNG entries (Windows reads PNG-compressed images at any size). */
function ico(images) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(images.length, 4);
  const entries = [];
  let offset = 6 + images.length * 16;
  for (const { size, png } of images) {
    const entry = Buffer.alloc(16);
    entry.writeUInt8(size >= 256 ? 0 : size, 0); // 0 = 256
    entry.writeUInt8(size >= 256 ? 0 : size, 1);
    entry.writeUInt16LE(1, 4); // planes
    entry.writeUInt16LE(32, 6); // bits per pixel
    entry.writeUInt32LE(png.length, 8);
    entry.writeUInt32LE(offset, 12);
    entries.push(entry);
    offset += png.length;
  }
  return Buffer.concat([header, ...entries, ...images.map((i) => i.png)]);
}

app.whenReady().then(async () => {
  // One 1024 px drawing, scaled down to each size: the same picture at every size, with no re-rasterised blur.
  const win = new BrowserWindow({ show: false, width: 1024, height: 1024, useContentSize: true, frame: false, transparent: true, webPreferences: { offscreen: true } });
  await win.loadURL(`data:text/html,<body style="margin:0;background:transparent">${encodeURIComponent(SVG)}</body>`);
  await new Promise((resolve) => setTimeout(resolve, 600));
  const big = await win.webContents.capturePage();
  const at = (size) => big.resize({ width: size, height: size, quality: 'best' }).toPNG();

  fs.writeFileSync(path.join(__dirname, 'icon.png'), at(512));
  fs.writeFileSync(path.join(__dirname, 'icon.ico'), ico([16, 24, 32, 48, 64, 128, 256].map((size) => ({ size, png: at(size) }))));
  fs.writeFileSync(path.join(root, 'web/app/public/favicon.svg'), SVG);
  fs.writeFileSync(path.join(root, 'docs/assets/logo.svg'), SVG);
  const extension = path.join(root, 'web/extension/public/icon');
  fs.mkdirSync(extension, { recursive: true });
  for (const size of [16, 32, 48, 96, 128]) fs.writeFileSync(path.join(extension, `${size}.png`), at(size));
  console.log('icons written');
  app.quit();
});
