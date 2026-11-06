// Renders banner.html to PNG with Electron, so the type is the app's own font.
//   cd desktop && npx electron ../docs/assets/render.mjs                 (banner.png)
//   cd desktop && SHOT=social npx electron ../docs/assets/render.mjs     (social-preview.png)
// banner.png is 2x; social-preview.png is 1x, for Settings > Social preview.
// INTER_FONT can point at Inter's variable woff2 when the web app's dependencies are not installed here.
import { app, BrowserWindow } from 'electron';
import { copyFileSync, existsSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const font =
  process.env.INTER_FONT ||
  path.resolve(here, '../../web/app/node_modules/@fontsource-variable/inter/files/inter-latin-wght-normal.woff2');
if (!existsSync(font)) throw new Error(`Install the web app's dependencies first (missing ${font}).`);
copyFileSync(font, path.join(here, 'inter.woff2'));

// A 2x picture is the same layout through the page's zoom: sharper, not different.
async function shot(search, width, height, zoom, file) {
  const win = new BrowserWindow({ show: false, useContentSize: true, width: width * zoom, height: height * zoom, frame: false, transparent: true });
  win.webContents.setZoomFactor(zoom);
  await win.loadFile(path.join(here, 'banner.html'), { search });
  await new Promise((resolve) => setTimeout(resolve, 900));
  const image = await win.webContents.capturePage();
  writeFileSync(path.join(here, file), image.toPNG());
  console.log('wrote', file, image.getSize());
  win.destroy();
}

// One picture per run (SHOT=banner, the default, or SHOT=social): a second window in the same run fails to load.
app.whenReady().then(async () => {
  try {
    if (process.env.SHOT === 'social') await shot('social', 1280, 640, 1, 'social-preview.png');
    else await shot('', 1280, 400, 2, 'banner.png');
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  }
  app.quit();
});
