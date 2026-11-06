'use strict';
// Kurapify desktop: the Kurapify web player in its own window, with the
// browser extension's job (web/extension) done here in the main process:
//  - the YouTube header/CORS rules (extension/lib/rules.ts) as webRequest hooks,
//  - the page <-> extension bridge (shared/src/bridge) answered over IPC.
// Not covered yet: YouTube sign-in, Spotify and Discord (they report "unavailable").
const { app, BrowserWindow, ipcMain, session, shell, dialog, Menu } = require('electron');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const ytauth = require('./ytauth');
const spotify = require('./spotify');
const local = require('./local');

const HOST = '127.0.0.1';
const PORT = Number(process.env.KURAPIFY_PORT) || 47183;
const ORIGIN = `http://${HOST}:${PORT}`;
const ROOT = path.join(__dirname, 'app-dist');

const CHANNEL = 'kurapify-bridge';
const PROTOCOL = 1;

// ---- Static server for the built web app -------------------------------------

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.wasm': 'application/wasm',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
};

function sendFile(res, file, stat) {
  const ext = path.extname(file).toLowerCase();
  res.writeHead(200, {
    'Content-Type': MIME[ext] ?? 'application/octet-stream',
    'Content-Length': stat.size,
    'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=3600',
  });
  fs.createReadStream(file).pipe(res);
}

function serve(req, res) {
  // Only the app's own window talks to this server (guards against DNS rebinding).
  if (req.headers.host !== `${HOST}:${PORT}`) return res.writeHead(403).end();
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(req.url, ORIGIN).pathname);
  } catch {
    return res.writeHead(400).end();
  }
  // The listener's own files (local.js), outside the app's folder.
  if (pathname.startsWith('/__local/') && local.serveLocal(req, res, pathname)) return;
  const file = path.normalize(path.join(ROOT, pathname));
  if (file !== ROOT && !file.startsWith(ROOT + path.sep)) return res.writeHead(403).end();
  fs.stat(file, (err, stat) => {
    if (!err && stat.isFile()) return sendFile(res, file, stat);
    const index = path.join(ROOT, 'index.html');
    // A path with an extension that isn't there is a real 404; anything else is a client-side route.
    if (path.extname(pathname)) return res.writeHead(404).end();
    fs.stat(index, (e2, s2) => (e2 ? res.writeHead(500).end() : sendFile(res, index, s2)));
  });
}

// ---- YouTube header rules (extension/lib/rules.ts) ------------------------------

const YT = 'https://www.youtube.com';
const YTM = 'https://music.youtube.com';

function classify(rawUrl) {
  let u;
  try {
    u = new URL(rawUrl);
  } catch {
    return null;
  }
  if (u.protocol !== 'https:') return null;
  const h = u.hostname;
  const p = u.pathname;
  const impersonate = (o) => ({ set: { Origin: o, Referer: `${o}/`, 'X-Origin': o } });
  if (h === 'music.youtube.com' && p.startsWith('/youtubei/')) return impersonate(YTM);
  if (h === 'www.youtube.com' && p.startsWith('/youtubei/')) return impersonate(YT);
  if (h === 'www.youtube.com' && (p === '/sw.js_data' || p === '/iframe_api' || p.startsWith('/s/player/'))) return {};
  if (h === 'googlevideo.com' || h.endsWith('.googlevideo.com')) {
    // VISIONOS direct URLs are fetched with no Origin or Referer at all.
    if (rawUrl.includes('c=VISIONOS')) return { remove: ['Origin', 'Referer'] };
    return { set: { Origin: YT, Referer: `${YT}/` } };
  }
  return null;
}

const dropHeader = (headers, name) => {
  for (const key of Object.keys(headers)) if (key.toLowerCase() === name.toLowerCase()) delete headers[key];
};

function installRules(ses) {
  const kinds = new Set(['xhr', 'media']);
  ses.webRequest.onBeforeSendHeaders({ urls: ['https://*/*'] }, (details, callback) => {
    const rule = kinds.has(details.resourceType) ? classify(details.url) : null;
    if (!rule) return callback({});
    const headers = { ...details.requestHeaders };
    for (const name of rule.remove ?? []) dropHeader(headers, name);
    for (const [name, value] of Object.entries(rule.set ?? {})) {
      dropHeader(headers, name);
      headers[name] = value;
    }
    callback({ requestHeaders: headers });
  });
  ses.webRequest.onHeadersReceived({ urls: ['https://*/*'] }, (details, callback) => {
    if (!kinds.has(details.resourceType) || !classify(details.url)) return callback({});
    const headers = { ...details.responseHeaders };
    dropHeader(headers, 'Access-Control-Allow-Origin');
    dropHeader(headers, 'Access-Control-Expose-Headers');
    headers['Access-Control-Allow-Origin'] = ['*'];
    headers['Access-Control-Expose-Headers'] = ['*'];
    callback({ responseHeaders: headers });
  });
}

// ---- The bridge (extension/entrypoints/background.ts) ---------------------------

const LYRIC_ORIGINS = [
  'https://lrc.red',
  'https://lyrics-api.binimum.org',
  'https://lyrics-api.boidu.dev',
  'https://unison.boidu.dev',
  'https://lyrics.paxsenix.org',
  'https://api.paxsenix.org',
  'https://lyricsplus.prjktla.my.id',
  'https://lyricsplus.atomix.one',
  'https://lyricsplus.binimum.org',
  'https://lyricsplus.prjktla.workers.dev',
  'https://lyricsplus-seven.vercel.app',
  'https://lyrics-plus-backend.vercel.app',
  'https://lrclib.net',
  'https://mobileservice.kugou.com',
  'https://lyrics.kugou.com',
  'https://apic.musixmatch.com',
  'https://www.musixmatch.com',
  'https://genius.com',
  'https://music.apple.com',
  'https://amp-api.music.apple.com',
  // Comment translation (the same endpoint Chrome's page translator uses).
  'https://translate.googleapis.com',
];

const ok = (id, result) => ({ channel: CHANNEL, protocol: PROTOCOL, direction: 'to-page', id, ok: true, result });
const fail = (id, code, message) => ({
  channel: CHANNEL,
  protocol: PROTOCOL,
  direction: 'to-page',
  id,
  ok: false,
  error: { code, message },
});

/** Pushes an event (a sign-in elsewhere, a channel change) to the page. */
function sendEvent(event) {
  if (win && !win.isDestroyed()) win.webContents.send('kurapify:event', event);
}
ytauth.setEmitter(sendEvent);

async function serialise(response) {
  const headers = {};
  response.headers.forEach((value, key) => (headers[key] = value));
  const type = response.headers.get('content-type') ?? '';
  const textual = /json|text|javascript|xml|html/.test(type) || !type;
  return {
    status: response.status,
    headers,
    url: response.url,
    bodyEncoding: textual ? 'text' : 'base64',
    body: textual ? await response.text() : Buffer.from(await response.arrayBuffer()).toString('base64'),
  };
}

const bodyOf = (r) => (r.body === undefined ? undefined : r.bodyEncoding === 'base64' ? Buffer.from(r.body, 'base64') : r.body);

const lowerKeys = (headers) => Object.fromEntries(Object.entries(headers ?? {}).map(([k, v]) => [k, String(v)]));

/** Where a signed request may go: InnerTube only, plus the play-reporting pings a player response nominates. */
const ALLOWED_SIGNED = /^https:\/\/(music|www)\.youtube\.com\/youtubei\/v1\//;
const STATS = /^https:\/\/(s|music|www)\.youtube\.com\/api\/stats\/(playback|watchtime|atr)(\?|$)/;
/** Identity is ours to set; the page's copies of these are dropped. */
const IDENTITY_HEADERS = ['authorization', 'cookie', 'x-goog-authuser', 'x-goog-pageid', 'x-origin', 'origin', 'referer'];

async function signedYtFetch(request) {
  const stats = STATS.test(request.url) && (request.method ?? 'GET') === 'GET';
  if (!stats && !ALLOWED_SIGNED.test(request.url)) {
    const { origin, pathname } = new URL(request.url);
    throw Object.assign(new Error(`yt.fetch doesn't serve ${origin}${pathname}`), { code: 'forbidden' });
  }
  const identity = await ytauth.activeIdentity();
  if (!identity) throw new ytauth.SignedOutError('Not signed in to YouTube Music.');
  const headers = Object.fromEntries(Object.entries(lowerKeys(request.headers)).filter(([k]) => !IDENTITY_HEADERS.includes(k.toLowerCase())));
  const response = await ytauth.signedFetch(
    request.url,
    { method: request.method ?? 'GET', headers, body: bodyOf(request) },
    identity,
    // A stats ping is signed for YouTube Music, whichever host it goes to.
    stats ? 'https://music.youtube.com' : undefined,
  );
  return serialise(response);
}

async function ytFetch(request) {
  if (request.auth) return signedYtFetch(request);
  // Only BotGuard: the page can't call it with YouTube's Origin.
  if (!/^https:\/\/www\.youtube\.com\/api\/jnn\//.test(request.url)) {
    const { origin, pathname } = new URL(request.url);
    throw Object.assign(new Error(`yt.fetch doesn't serve ${origin}${pathname}`), { code: 'forbidden' });
  }
  const response = await fetch(request.url, {
    method: request.method ?? 'GET',
    headers: { ...lowerKeys(request.headers), Origin: YT, Referer: `${YT}/` },
    body: bodyOf(request),
    signal: AbortSignal.timeout(20_000),
  });
  return serialise(response);
}

/** Recent answers to GETs (Apple's pages and catalogue, lyric lookups): a page revisited within the window costs nothing. */
const lyricsCache = new Map();
const LYRICS_CACHE_MS = 20 * 60_000;
const LYRICS_CACHE_MAX = 300;

async function lyricsFetch(request) {
  const url = new URL(request.url);
  if (!LYRIC_ORIGINS.includes(url.origin)) {
    throw Object.assign(new Error(`lyrics.fetch doesn't serve ${url.origin}`), { code: 'forbidden' });
  }
  const cacheable = (request.method ?? 'GET') === 'GET' && request.body === undefined;
  const cacheKey = cacheable ? `${url.href}\n${JSON.stringify(request.headers ?? {})}` : null;
  const kept = cacheKey ? lyricsCache.get(cacheKey) : null;
  if (kept && Date.now() - kept.at < LYRICS_CACHE_MS) return kept.response;
  const response = await lyricsFetchUncached(request, url);
  if (cacheKey && response.status === 200) {
    if (lyricsCache.size >= LYRICS_CACHE_MAX) lyricsCache.delete(lyricsCache.keys().next().value);
    lyricsCache.set(cacheKey, { at: Date.now(), response });
  }
  return response;
}

/** A GET through Node's own TLS stack: Google's translate endpoint refuses requests that come through Chromium's. */
function nodeGet(url) {
  return new Promise((resolve, reject) => {
    const request = require('node:https').get(url, { headers: { 'User-Agent': 'Mozilla/5.0', Accept: '*/*' }, timeout: 15_000 }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        const headers = {};
        for (const [key, value] of Object.entries(res.headers)) headers[key] = Array.isArray(value) ? value.join(', ') : String(value);
        resolve({ status: res.statusCode ?? 0, headers, url: url.href, bodyEncoding: 'text', body: Buffer.concat(chunks).toString('utf8') });
      });
    });
    request.on('timeout', () => request.destroy(new Error('Translation timed out')));
    request.on('error', reject);
  });
}

async function lyricsFetchUncached(request, url) {
  if (url.hostname === 'translate.googleapis.com') return nodeGet(url);
  const headers = lowerKeys(request.headers);
  if (url.hostname === 'amp-api.music.apple.com') {
    headers.Origin = 'https://music.apple.com';
    headers.Referer = 'https://music.apple.com/';
  }
  if (url.hostname.endsWith('musixmatch.com')) headers.Cookie = 'mxm_bab=AB';
  const response = await fetch(url, {
    method: request.method ?? 'GET',
    headers,
    body: request.body,
    signal: AbortSignal.timeout(15_000),
  });
  return serialise(response);
}

async function handle(request) {
  if (request.protocol !== PROTOCOL) return fail(request.id, 'protocol', `Bridge protocol ${request.protocol} is not supported.`);
  try {
    switch (request.method) {
      case 'ping':
        return ok(request.id, { version: app.getVersion(), protocol: PROTOCOL, browser: 'chromium', capabilities: ['yt', 'yt.auth', 'yt.stats', 'lyrics', 'streams', 'local'] });
      case 'spotify.streams': {
        const list = Array.isArray(request.params?.tracks) ? request.params.tracks.slice(0, 60) : [];
        const tracks = list.filter((t) => t && typeof t.key === 'string' && typeof t.title === 'string').map((t) => ({ key: t.key, title: t.title, artist: String(t.artist ?? '') }));
        return ok(request.id, { counts: await spotify.streams(tracks) });
      }
      case 'yt.fetch':
        return ok(request.id, await ytFetch(request.params));
      case 'yt.authState':
        return ok(request.id, await ytauth.authState(request.params.refresh === true));
      case 'yt.selectChannel': {
        const state = await ytauth.selectChannel(request.params.channelId);
        sendEvent({ event: 'yt.authState', data: state });
        return ok(request.id, state);
      }
      case 'yt.setConnected': {
        const state = await ytauth.setConnected(request.params.connected === true);
        sendEvent({ event: 'yt.authState', data: state });
        return ok(request.id, state);
      }
      case 'local.list':
        return ok(request.id, local.list());
      case 'local.pick': {
        // Files or folders chosen in the system's own dialog; folders are read for the audio under them.
        const picked = await dialog.showOpenDialog(win && !win.isDestroyed() ? win : undefined, {
          title: request.params.folder ? 'Add a folder of music' : 'Add music',
          properties: request.params.folder ? ['openDirectory', 'multiSelections'] : ['openFile', 'multiSelections'],
          filters: request.params.folder ? [] : [{ name: 'Audio', extensions: local.EXTENSIONS }],
        });
        return ok(request.id, picked.canceled ? local.list() : await local.add(picked.filePaths));
      }
      case 'local.remove':
        return ok(request.id, local.remove(String(request.params.id ?? '')));
      case 'lyrics.fetch':
        return ok(request.id, await lyricsFetch(request.params));
      case 'lyrics.permissions':
        return ok(request.id, { granted: (request.params.origins ?? []).filter((o) => LYRIC_ORIGINS.includes(o)) });
      case 'lyrics.requestPermissions':
        return ok(request.id, {});
      case 'spotify.authState':
      case 'spotify.setConnected':
        return ok(request.id, { browserSignedIn: false, connected: false, signedIn: false, user: null, problem: null });
      case 'discord.state':
      case 'discord.disconnect':
      case 'discord.setEnabled':
        return ok(request.id, { available: false, connected: false, enabled: false, user: null, gateway: 'off', problem: null });
      case 'discord.presence':
        return ok(request.id, {});
      default:
        return fail(request.id, 'unsupported', `${request.method} isn't available in Kurapify Desktop yet.`);
    }
  } catch (error) {
    const code = error && error.code;
    if (code === 'forbidden' || code === 'unauthenticated') return fail(request.id, code, error.message);
    return fail(request.id, error instanceof TypeError ? 'network' : 'internal', error instanceof Error ? error.message : String(error));
  }
}

ipcMain.handle('kurapify:bridge', (event, request) => {
  let origin = '';
  try {
    origin = new URL(event.senderFrame.url).origin;
  } catch {}
  const id = request && typeof request.id === 'string' ? request.id : '';
  if (origin !== ORIGIN) return fail(id, 'forbidden', `Origin ${origin || 'unknown'} isn't allowed.`);
  if (!request || request.channel !== CHANNEL || request.direction !== 'to-extension' || typeof request.method !== 'string') {
    return fail(id, 'protocol', 'Malformed request.');
  }
  return handle(request);
});

// ---- Menu: YouTube account ----------------------------------------------------------

async function importYoutubeCookies() {
  const pick = await dialog.showOpenDialog(win, {
    title: 'Dışa aktarılmış YouTube çerezlerini seçin',
    message: 'Tarayıcınızdan dışa aktardığınız cookies.txt (Netscape) veya JSON dosyası',
    properties: ['openFile'],
    filters: [{ name: 'Çerez dosyası', extensions: ['txt', 'json'] }, { name: 'Tüm dosyalar', extensions: ['*'] }],
  });
  if (pick.canceled || !pick.filePaths[0]) return;
  try {
    const content = fs.readFileSync(pick.filePaths[0], 'utf8');
    const { stored, total, state } = await ytauth.importCookies(content);
    const who = state.signedIn ? `Giriş yapıldı: ${state.active.name}` : `Giriş doğrulanamadı: ${state.problem ?? 'oturum kabul edilmedi'}`;
    await dialog.showMessageBox(win, {
      type: state.signedIn ? 'info' : 'warning',
      message: who,
      detail: `${stored}/${total} Google/YouTube çerezi alındı. Güvenliğiniz için dışa aktardığınız dosyayı şimdi silmeniz önerilir.`,
    });
  } catch (error) {
    dialog.showErrorBox('Çerezler içe aktarılamadı', error instanceof Error ? error.message : String(error));
  }
}

/** Takes the session the user's browser already has; the browser has to be closed for its cookie file to be copied. */
async function importFromProfile() {
  const browser = ytauth.defaultBrowserName() ?? 'Tarayıcı';
  try {
    const { stored, state } = await ytauth.importFromBrowserProfile(async () => {
      const { response } = await dialog.showMessageBox(win, {
        type: 'info',
        title: 'YouTube girişi',
        message: `${browser}'u tamamen kapatın`,
        detail: `Çerez dosyası ${browser} açıkken kilitli. Tüm ${browser} pencerelerini kapatıp Tamam'a basın; kapandığını anlayınca devam edeceğim. Sekmeleriniz ${browser}'u yeniden açınca geri gelir.`,
        buttons: ['Tamam', 'Vazgeç'],
        defaultId: 0,
        cancelId: 1,
      });
      if (response !== 0) throw new Error('İptal edildi.');
    });
    await dialog.showMessageBox(win, {
      type: state.signedIn ? 'info' : 'warning',
      message: state.signedIn ? `Giriş yapıldı: ${state.active.name}` : `Giriş doğrulanamadı: ${state.problem ?? 'oturum kabul edilmedi'}`,
      detail: `${stored} Google/YouTube çerezi ${browser}'dan alındı. ${browser}'u şimdi yeniden açabilirsiniz.`,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message === 'İptal edildi.') return;
    dialog.showErrorBox('Oturum aktarılamadı', message);
  }
}

/**
 * What the page's "Sign In" does: the user's own browser opens in a throwaway profile (the browser they have open is
 * left alone), they sign in there, and the session is copied out and the window closed. That session belongs to this app
 * alone, so nothing else rotates it behind its back; an imported copy of a browser's own session does not last, as the
 * browser and the app keep swapping its timestamp cookies and one of them ends up holding retired ones.
 */
async function promptSignIn() {
  try {
    const { stored, state } = await ytauth.signInWithBrowser();
    if (!state.signedIn) {
      dialog.showMessageBox(win, { type: 'warning', message: `Giriş doğrulanamadı: ${state.problem ?? 'oturum kabul edilmedi'}`, detail: `${stored} çerez alındı.` });
    } else if (win && !win.isDestroyed()) {
      win.show();
      win.focus();
    }
    return;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const browser = ytauth.defaultBrowserName();
    const buttons = ['Çerez dosyası seç…', ...(browser ? [`${browser} oturumunu aktar (${browser}'u kapatmak gerekir)`] : []), 'Vazgeç'];
    const { response } = await dialog.showMessageBox(win, {
      type: 'warning',
      title: 'YouTube girişi',
      message: 'Tarayıcıyla giriş tamamlanamadı.',
      detail: `${message}

Başka bir yol deneyebilirsiniz.`,
      buttons,
      defaultId: buttons.length - 1,
      cancelId: buttons.length - 1,
    });
    if (response === 0) await importYoutubeCookies();
    else if (browser && response === 1) await importFromProfile();
  }
}

async function signOutYoutube() {
  await ytauth.signOut();
  await dialog.showMessageBox(win, { type: 'info', message: 'YouTube oturumu kapatıldı', detail: 'Uygulamadaki Google/YouTube çerezleri silindi.' });
}

function buildMenu() {
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      // The account actions have no menu of their own: Ctrl+Shift+I imports cookies, Ctrl+Shift+O signs out
      // (handled in createWindow), and the page's Sign In button opens the same import.
      { label: 'Düzen', submenu: [{ role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }] },
      { label: 'Görünüm', submenu: [{ role: 'reload' }, { role: 'togglefullscreen' }, { type: 'separator' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { role: 'resetZoom' }] },
    ]),
  );
}

// ---- Window -----------------------------------------------------------------------

let win = null;

// What the page's own minimise / maximise / close buttons ask for; only this app's page may ask.
ipcMain.handle('kurapify:window', (event, action) => {
  let origin = '';
  try {
    origin = new URL(event.senderFrame?.url ?? '').origin;
  } catch {}
  if (origin !== ORIGIN || !win || win.isDestroyed()) return null;
  if (action === 'minimize') win.minimize();
  else if (action === 'toggle-maximize') (win.isMaximized() ? win.unmaximize() : win.maximize());
  else if (action === 'close') win.close();
  return { maximized: win.isMaximized(), fullScreen: win.isFullScreen(), minimized: win.isMinimized() || !win.isVisible() };
});

function createWindow() {
  const icon = path.join(__dirname, 'icon.ico');
  win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: '#000000',
    title: 'Kurapify',
    // No title bar and no menu bar: the page runs to the top, and draws its own minimise, maximise and close buttons
    // in the corner (WindowControls), which reach the window through the 'kurapify:window' channel below.
    autoHideMenuBar: true,
    titleBarStyle: 'hidden',
    ...(fs.existsSync(icon) && { icon }),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      autoplayPolicy: 'no-user-gesture-required',
      // Music keeps playing when the window is minimised or hidden.
      backgroundThrottling: false,
    },
  });

  // Google's sign-in opens in the app's own window (so its cookies stay here); everything else goes to the browser.
  const external = (url) => {
    try {
      const u = new URL(url);
      if (u.protocol !== 'https:') return;
      if (u.hostname === 'accounts.google.com') return void promptSignIn(url);
      void shell.openExternal(url);
    } catch {}
  };
  win.webContents.setWindowOpenHandler(({ url }) => {
    external(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (event, url) => {
    if (new URL(url).origin !== ORIGIN) {
      event.preventDefault();
      external(url);
    }
  });
  win.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown' || !input.control || !input.shift) return;
    const key = input.key.toLowerCase();
    if (key === 'i') (event.preventDefault(), void importYoutubeCookies());
    else if (key === 'o') (event.preventDefault(), void signOutYoutube());
  });
  // The window controls are laid over the page: a strip along the top to drag the window by (clear of them), and how much
  // room the page leaves them on the right (--wco-right, which the full-screen player's corner buttons respect).
  win.webContents.on('did-finish-load', () => {
    void win?.webContents.insertCSS(
      ':root{--wco-right:140px}html::before{content:"";position:fixed;top:0;left:0;right:140px;height:14px;-webkit-app-region:drag;z-index:2147483647}',
    );
  });
  // The page's own window buttons show the state the window is in.
  const sendWindowState = () => {
    if (!win || win.isDestroyed()) return;
    win.webContents.send('kurapify:window-state', { maximized: win.isMaximized(), fullScreen: win.isFullScreen(), minimized: win.isMinimized() || !win.isVisible() });
  };
  for (const event of ['maximize', 'unmaximize', 'enter-full-screen', 'leave-full-screen', 'minimize', 'restore', 'show', 'hide']) win.on(event, sendWindowState);
  win.webContents.on('did-finish-load', sendWindowState);
  // The mouse's back button, and Alt+Left, go back a page.
  win.on('app-command', (_event, command) => {
    if (command === 'browser-backward') win?.webContents.navigationHistory.goBack();
    else if (command === 'browser-forward') win?.webContents.navigationHistory.goForward();
  });
  void win.loadURL(ORIGIN);
  win.on('closed', () => (win = null));
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.focus();
  });

  // Hardware media keys drive the page's Media Session.
  app.commandLine.appendSwitch('enable-features', 'HardwareMediaKeyHandling,MediaSessionService');
  // A bigger on-disk cache, so artwork seen once is there the next time without a request (default is far smaller).
  app.commandLine.appendSwitch('disk-cache-size', String(1024 * 1024 * 1024));

  app.whenReady().then(() => {
    const allowed = new Set(['fullscreen', 'clipboard-sanitized-write']);
    session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => callback(allowed.has(permission)));
    installRules(session.defaultSession);
    // Connections to the artwork and catalogue hosts are opened before the first image asks for them.
    for (const origin of ['https://lh3.googleusercontent.com', 'https://i.ytimg.com', 'https://yt3.ggpht.com', 'https://is1-ssl.mzstatic.com', 'https://mvod.itunes.apple.com', 'https://music.youtube.com']) {
      session.defaultSession.preconnect({ url: origin, numSockets: 4 });
    }
    buildMenu();

    const server = http.createServer(serve);
    server.once('error', (error) => {
      dialog.showErrorBox('Kurapify', error.code === 'EADDRINUSE' ? `Port ${PORT} is already in use.` : String(error));
      app.quit();
    });
    server.listen(PORT, HOST, createWindow);
    let flushed = false;
    app.on('before-quit', (event) => {
      server.close();
      if (flushed) return;
      // Hold the quit for a moment so the account's cookies are on disk.
      event.preventDefault();
      flushed = true;
      void Promise.all([ytauth.flush(), session.defaultSession.cookies.flushStore().catch(() => {})]).finally(() => app.quit());
    });
  });

  app.on('window-all-closed', () => app.quit());
}
