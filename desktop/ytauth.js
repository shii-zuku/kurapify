'use strict';
// YouTube Music sign-in for the desktop app: a port of web/extension/lib/ytAuth.ts.
// The user signs in to Google in a window of their own (the credentials go to
// Google's page, never through this code). The cookies stay in a persistent
// session; signed requests are made from here with the SAPISIDHASH computed
// here, and the page only ever learns names and pictures.
const { app, BrowserWindow, session } = require('electron');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const MUSIC = 'https://music.youtube.com';
const YT = 'https://www.youtube.com';
const SIGNING_COOKIES = ['SAPISID', '__Secure-3PAPISID', '__Secure-1PAPISID'];
const SESSION_COOKIES = new Set([...SIGNING_COOKIES, 'SID', '__Secure-1PSID', '__Secure-3PSID']);
const WEB_REMIX_VERSION = '1.20251006.03.00';
const MAX_LOGINS = 10;
const ACCOUNTS_TTL_MS = 10 * 60_000;

class SignedOutError extends Error {
  constructor(message) {
    super(message);
    this.code = 'unauthenticated';
  }
}

// ---- Session ----------------------------------------------------------------------

let ses = null;
let emit = () => {};

/** Called by main.js: how pushes reach the page. */
function setEmitter(fn) {
  emit = fn;
}

function getSession() {
  if (ses) return ses;
  ses = session.fromPartition('persist:ytauth');
  // Google refuses sign-in from a browser that calls itself Electron.
  ses.setUserAgent(session.defaultSession.getUserAgent().replace(/\s*Electron\/\S+/, '').replace(/\s*kurapify[\w-]*\/\S+/i, ''));

  // Requests made from the main process (not a page of the login window) are dressed as YouTube's own web clients.
  const origins = { 'music.youtube.com': MUSIC, 'www.youtube.com': YT, 's.youtube.com': MUSIC, 'accounts.google.com': 'https://accounts.google.com' };
  ses.webRequest.onBeforeSendHeaders({ urls: ['https://music.youtube.com/*', 'https://www.youtube.com/*', 'https://s.youtube.com/*', 'https://accounts.google.com/RotateCookies*'] }, (details, callback) => {
    const origin = origins[new URL(details.url).hostname];
    if (details.webContents || !origin) return callback({});
    const headers = { ...details.requestHeaders };
    for (const key of Object.keys(headers)) if (/^(origin|referer)$/i.test(key)) delete headers[key];
    headers.Origin = origin;
    headers.Referer = `${origin}/`;
    if (process.env.KURAPIFY_TRACE) console.log('[ytauth]', details.method, details.url.split('?')[0], JSON.stringify(headers));
    callback({ requestHeaders: headers });
  });

  let timer;
  let flushTimer;
  ses.cookies.on('changed', (_event, cookie) => {
    // YouTube rotates its session cookies as it is used; the new values must reach the disk, or a restart
    // comes back with ones YouTube has already retired and the account looks signed out.
    clearTimeout(flushTimer);
    flushTimer = setTimeout(() => void ses.cookies.flushStore().catch(() => {}), 3000);
    if (!SESSION_COOKIES.has(cookie.name) || !/(^|\.)youtube\.com$/.test(cookie.domain.replace(/^\./, ''))) return;
    cache = null;
    clearTimeout(timer);
    // Signing in sets several cookies in a burst; answer the last one.
    timer = setTimeout(() => {
      authState(true)
        .then((data) => emit({ event: 'yt.authState', data }))
        .catch((error) => console.warn('Kurapify: reading the YouTube session failed', error));
    }, 1000);
  });
  setTimeout(() => void rotateCookies(), 5_000).unref();
  setInterval(() => void rotateCookies(), ROTATE_EVERY_MS).unref();
  return ses;
}

// ---- Keeping the session alive ------------------------------------------------------

const ROTATE_EVERY_MS = 9 * 60_000;

/**
 * Google retires `__Secure-1PSIDTS` / `__Secure-3PSIDTS` within hours unless the client keeps swapping them for fresh
 * ones; a browser does that on its own, an app that only calls youtubei does not, so an imported session used to
 * lapse after a while. This is the same request a signed-in Google page makes; the new cookies arrive as Set-Cookie
 * and are flushed to disk by the `changed` handler above.
 */
async function rotateCookies() {
  try {
    if ((await signingSecret()) === null) return;
    const response = await getSession().fetch('https://accounts.google.com/RotateCookies', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '[000,"-0000000000000000000"]',
      credentials: 'include',
    });
    if (process.env.KURAPIFY_TRACE) console.log('[ytauth] RotateCookies', response.status);
  } catch (error) {
    if (process.env.KURAPIFY_TRACE) console.log('[ytauth] RotateCookies failed', error);
  }
}

// ---- Preferences ------------------------------------------------------------------

const prefsFile = () => path.join(app.getPath('userData'), 'yt-prefs.json');

function loadPrefs() {
  try {
    const stored = JSON.parse(fs.readFileSync(prefsFile(), 'utf8'));
    return { connected: stored.connected ?? true, selectedChannelId: stored.selectedChannelId ?? null };
  } catch {
    return { connected: true, selectedChannelId: null };
  }
}

function savePrefs(change) {
  fs.writeFileSync(prefsFile(), JSON.stringify({ ...loadPrefs(), ...change }));
}

// ---- Signing ----------------------------------------------------------------------

async function signingSecret() {
  const jar = getSession().cookies;
  for (const name of SIGNING_COOKIES) {
    const [cookie] = await jar.get({ url: `${MUSIC}/`, name }).catch(() => []);
    if (cookie?.value) return cookie.value;
  }
  return null;
}

/** `SAPISIDHASH <seconds>_<sha1(seconds + " " + secret + " " + origin)>`. */
function sapisidHash(secret, origin) {
  const timestamp = Math.floor(Date.now() / 1000);
  const hex = crypto.createHash('sha1').update(`${timestamp} ${secret} ${origin}`).digest('hex');
  return `SAPISIDHASH ${timestamp}_${hex}`;
}

/** A request made as [identity], signed for [signAs] when that isn't the URL's own origin. */
async function signedFetch(url, init, identity, signAs) {
  const secret = await signingSecret();
  if (!secret) throw new SignedOutError('Not signed in to YouTube.');
  const origin = signAs ?? new URL(url).origin;
  const headers = { ...(init.headers ?? {}), Authorization: sapisidHash(secret, origin), 'X-Goog-AuthUser': identity.authUser, 'X-Origin': origin };
  if (identity.pageId) headers['X-Goog-PageId'] = identity.pageId;
  return getSession().fetch(url, { method: init.method ?? 'GET', headers, body: init.body ?? undefined, credentials: 'include' });
}

async function musicApi(endpoint, identity) {
  const response = await signedFetch(
    `${MUSIC}/youtubei/v1/${endpoint}?prettyPrint=false`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Youtube-Client-Name': '67', 'X-Youtube-Client-Version': WEB_REMIX_VERSION },
      body: JSON.stringify({ context: { client: { clientName: 'WEB_REMIX', clientVersion: WEB_REMIX_VERSION, hl: 'en', gl: 'US' }, user: {} } }),
    },
    identity,
  );
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

// ---- Reading the account renderers ------------------------------------------------

function renderers(root, key, out = []) {
  if (Array.isArray(root)) for (const item of root) renderers(item, key, out);
  else if (root && typeof root === 'object') {
    for (const [k, v] of Object.entries(root)) {
      if (k === key && v && typeof v === 'object' && !Array.isArray(v)) out.push(v);
      else renderers(v, key, out);
    }
  }
  return out;
}

function findString(root, key) {
  if (Array.isArray(root)) {
    for (const item of root) {
      const found = findString(item, key);
      if (found) return found;
    }
  } else if (root && typeof root === 'object') {
    for (const [k, v] of Object.entries(root)) {
      if (k === key && typeof v === 'string' && v) return v;
      const found = findString(v, key);
      if (found) return found;
    }
  }
  return null;
}

const text = (node) => (node?.runs ? node.runs.map((r) => r.text ?? '').join('') : (node?.simpleText ?? ''));
const photo = (item) => item.accountPhoto?.thumbnails?.at(-1)?.url ?? null;
const channelId = (authUser, pageId) => `${authUser}:${pageId ?? 'own'}`;

function parseChannels(root, authUser) {
  const channels = [];
  for (const item of renderers(root, 'accountItem')) {
    const name = text(item.accountName);
    if (!name) continue;
    const pageId = findString(item, 'pageId');
    const id = channelId(authUser, pageId);
    if (channels.some((c) => c.id === id)) continue;
    channels.push({
      id,
      name,
      handle: text(item.channelHandle) || text(item.accountByline) || null,
      avatarUrl: photo(item),
      brand: pageId !== null,
      authUser,
      pageId,
      selectedOnWeb: item.isSelected === true,
    });
  }
  return channels;
}

let problem = null;

function describeEmpty(endpoint, body) {
  const services = body?.responseContext?.serviceTrackingParams ?? [];
  const loggedIn = services.flatMap((s) => s.params ?? []).find((p) => p.key === 'logged_in')?.value;
  if (loggedIn === '0') return `${endpoint}: YouTube answered as if signed out (the session wasn't accepted)`;
  const keys = body && typeof body === 'object' ? Object.keys(body).join(', ') : typeof body;
  return `${endpoint}: no account in the answer (${keys})`;
}

async function readLogin(authUser) {
  const identity = { authUser, pageId: null };
  let header;
  try {
    const menu = await musicApi('account/account_menu', identity);
    header = renderers(menu, 'activeAccountHeaderRenderer')[0];
    if (!header) return { account: null, why: describeEmpty('account_menu', menu) };
  } catch (error) {
    return { account: null, why: `account_menu: ${error instanceof Error ? error.message : String(error)}` };
  }
  const name = text(header.accountName) || 'YouTube Music';
  const email = text(header.email) || null;
  const handle = text(header.channelHandle) || null;
  const avatarUrl = photo(header);
  let channels = [];
  try {
    channels = parseChannels(await musicApi('account/accounts_list', identity), authUser);
  } catch {
    // The switcher isn't answered for every account; the login's own channel always exists.
  }
  if (!channels.length) {
    channels = [{ id: channelId(authUser, null), name, handle: handle ?? email, avatarUrl, brand: false, authUser, pageId: null, selectedOnWeb: true }];
  }
  return { account: { authUser, name, email, avatarUrl, channels }, why: null };
}

async function webSessionIndex() {
  try {
    const response = await signedFetch(`${MUSIC}/`, { headers: { Accept: 'text/html' } }, { authUser: '0', pageId: null });
    return /"SESSION_INDEX":"?(\d+)/.exec(await response.text())?.[1] ?? null;
  } catch {
    return null;
  }
}

async function readAccounts() {
  problem = null;
  const [results, webIndex] = await Promise.all([
    Promise.all(Array.from({ length: MAX_LOGINS }, (_, i) => readLogin(String(i)))),
    webSessionIndex(),
  ]);
  const list = [];
  const seen = new Set();
  for (const { account } of results) {
    if (!account) continue;
    const key = account.email ?? `${account.name}|${account.channels.map((c) => c.id.split(':')[1]).join(',')}`;
    if (seen.has(key)) continue;
    seen.add(key);
    list.push(account);
  }
  if (!list.length) {
    problem = results[Number(webIndex ?? 0)]?.why ?? results[0]?.why ?? 'no signed-in Google account found';
    console.warn(`Kurapify: no YouTube account found: ${problem}`);
  }
  return { list, webIndex };
}

// ---- State ------------------------------------------------------------------------

let cache = null;
let reading = null;

async function accounts(refresh) {
  if (!refresh && cache && Date.now() - cache.at < ACCOUNTS_TTL_MS) return cache;
  reading ??= readAccounts()
    .then((read) => {
      cache = { ...read, at: Date.now() };
      return read;
    })
    .finally(() => (reading = null));
  return reading;
}

function chooseChannel({ list, webIndex }, selectedId) {
  const all = list.flatMap((a) => a.channels);
  const web = list.find((a) => a.authUser === webIndex) ?? list[0];
  return all.find((c) => c.id === selectedId) ?? web?.channels.find((c) => c.selectedOnWeb) ?? web?.channels[0] ?? null;
}

const publicChannel = ({ id, name, handle, avatarUrl, brand }) => ({ id, name, handle, avatarUrl, brand });

async function authState(refresh = false) {
  const prefs = loadPrefs();
  const browserSignedIn = (await signingSecret()) !== null;
  if (!browserSignedIn || !prefs.connected) {
    return { browserSignedIn, connected: prefs.connected, signedIn: false, accounts: [], active: null, problem: null };
  }
  const read = await accounts(refresh);
  const active = chooseChannel(read, prefs.selectedChannelId);
  // Cookies YouTube no longer accepts are as good as none: the page then offers "Sign In" (which leads to the import).
  if (!active && /answered as if signed out/.test(problem ?? '')) {
    return { browserSignedIn: false, connected: true, signedIn: false, accounts: [], active: null, problem: null };
  }
  return {
    browserSignedIn,
    connected: true,
    signedIn: active !== null,
    problem: active ? null : problem,
    accounts: read.list.map((a) => ({ ...a, channels: a.channels.map(publicChannel) })),
    active: active && { ...publicChannel(active), authUser: active.authUser },
  };
}

async function activeIdentity() {
  const prefs = loadPrefs();
  if (!prefs.connected || (await signingSecret()) === null) return null;
  const active = chooseChannel(await accounts(false), prefs.selectedChannelId);
  return active && { authUser: active.authUser, pageId: active.pageId };
}

async function selectChannel(id) {
  const { list } = await accounts(false);
  if (!list.some((a) => a.channels.some((c) => c.id === id))) throw new Error(`No channel ${id} in this session`);
  savePrefs({ selectedChannelId: id });
  return authState();
}

async function setConnected(connected) {
  savePrefs({ connected });
  return authState(connected);
}

// ---- Importing cookies exported from a browser -------------------------------------

const GOOGLE_COOKIE_DOMAIN = /(^|\.)(google\.com|youtube\.com)$/;
const DEFAULT_LIFETIME_S = 30 * 24 * 3600;

/** Cookies from a Netscape cookies.txt or a Cookie-Editor style JSON array, Google and YouTube only. */
function parseCookieExport(content) {
  const text = content.replace(/^﻿/, '').trim();
  const rows = [];
  if (text.startsWith('[') || text.startsWith('{')) {
    const json = JSON.parse(text);
    for (const c of Array.isArray(json) ? json : (json.cookies ?? [])) {
      rows.push({
        domain: String(c.domain ?? ''),
        path: c.path || '/',
        secure: c.secure !== false,
        httpOnly: c.httpOnly === true,
        expires: Number(c.expirationDate ?? c.expires ?? 0) || 0,
        name: String(c.name ?? ''),
        value: String(c.value ?? ''),
        sameSite: c.sameSite,
      });
    }
  } else {
    for (const raw of text.split(/\r?\n/)) {
      let line = raw.trim();
      let httpOnly = false;
      if (line.startsWith('#HttpOnly_')) {
        httpOnly = true;
        line = line.slice('#HttpOnly_'.length);
      } else if (!line || line.startsWith('#')) continue;
      const parts = line.split('\t');
      if (parts.length < 7) continue;
      const [domain, , path, secure, expires, name, ...value] = parts;
      rows.push({ domain, path: path || '/', secure: secure.toUpperCase() === 'TRUE', httpOnly, expires: Number(expires) || 0, name, value: value.join('\t') });
    }
  }
  return rows.filter((r) => r.name && GOOGLE_COOKIE_DOMAIN.test(r.domain.replace(/^\./, '')));
}

const SAME_SITE = { no_restriction: 'no_restriction', none: 'no_restriction', lax: 'lax', strict: 'strict' };

/** Stores the cookies in the sign-in session; returns how many were accepted. */
async function importCookies(content) {
  return importRows(parseCookieExport(content));
}

async function importRows(rows) {
  const jar = getSession().cookies;
  const now = Math.floor(Date.now() / 1000);
  let stored = 0;
  for (const r of rows) {
    const host = r.domain.replace(/^\./, '');
    const hostOnly = r.name.startsWith('__Host-');
    try {
      await jar.set({
        url: `https://${host}${r.path}`,
        name: r.name,
        value: r.value,
        ...(!hostOnly && { domain: r.domain.startsWith('.') ? r.domain : `.${host}` }),
        path: r.path,
        secure: true,
        httpOnly: r.httpOnly,
        sameSite: SAME_SITE[String(r.sameSite ?? '').toLowerCase()] ?? 'unspecified',
        expirationDate: r.expires > now ? r.expires : now + DEFAULT_LIFETIME_S,
      });
      stored++;
    } catch {
      // A cookie Chromium refuses (malformed, or a prefix rule) is skipped; the rest still count.
    }
  }
  cache = null;
  const state = await authState(true);
  emit({ event: 'yt.authState', data: state });
  return { stored, total: rows.length, state };
}

// ---- Signing in with the user's own browser ------------------------------------------

const SIGN_IN_URL = 'https://accounts.google.com/ServiceLogin?service=youtube&continue=https%3A%2F%2Fmusic.youtube.com%2F';
const SIGN_IN_TIMEOUT_MS = 10 * 60_000;

/** The browser Windows opens links with, when it is a Chromium one (Chrome, Edge, Brave, Helium, Vivaldi…) that takes a debugging port. */
function defaultBrowser() {
  try {
    const { execFileSync } = require('node:child_process');
    const query = (key, ...args) => execFileSync('reg', ['query', key, ...args], { encoding: 'utf8', windowsHide: true });
    const progId = /ProgId\s+REG_SZ\s+(\S+)/.exec(query('HKCU\\Software\\Microsoft\\Windows\\Shell\\Associations\\UrlAssociations\\https\\UserChoice', '/v', 'ProgId'))?.[1];
    if (!progId) return null;
    const command = /REG_SZ\s+(.+)/.exec(query(`HKCR\\${progId}\\shell\\open\\command`, '/ve'))?.[1] ?? '';
    const exe = /^"([^"]+)"/.exec(command.trim())?.[1] ?? /^(\S+\.exe)/i.exec(command.trim())?.[1];
    if (!exe || !fs.existsSync(exe) || /(firefox|iexplore|zen|librewolf|waterfox|floorp)/i.test(path.basename(exe))) return null;
    return exe;
  } catch {
    return null;
  }
}

/** The default browser if it is a Chromium one; otherwise Chrome, Edge or Brave, whichever is installed. Google lets these sign in; an Electron window it refuses. */
function findBrowser() {
  const preferred = defaultBrowser();
  if (preferred) return preferred;
  const roots = [process.env.PROGRAMFILES, process.env['PROGRAMFILES(X86)'], process.env.LOCALAPPDATA].filter(Boolean);
  const relative = [
    'Google\\Chrome\\Application\\chrome.exe',
    'Microsoft\\Edge\\Application\\msedge.exe',
    'BraveSoftware\\Brave-Browser\\Application\\brave.exe',
    'Chromium\\Application\\chrome.exe',
  ];
  for (const rel of relative) for (const root of roots) if (fs.existsSync(path.join(root, rel))) return path.join(root, rel);
  return null;
}

/** A minimal DevTools-protocol client over the browser's own websocket. */
function cdpClient(url) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url);
    const pending = new Map();
    let next = 0;
    socket.onopen = () =>
      resolve({
        send: (method, params = {}) =>
          new Promise((ok, fail) => {
            const id = ++next;
            pending.set(id, { ok, fail });
            socket.send(JSON.stringify({ id, method, params }));
          }),
        close: () => socket.close(),
      });
    socket.onerror = () => reject(new Error('Could not reach the browser'));
    socket.onmessage = (event) => {
      const message = JSON.parse(String(event.data));
      const waiter = pending.get(message.id);
      if (!waiter) return;
      pending.delete(message.id);
      if (message.error) waiter.fail(new Error(message.error.message));
      else waiter.ok(message.result);
    };
    socket.onclose = () => {
      for (const { fail } of pending.values()) fail(new Error('The browser was closed'));
    };
  });
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const toRow = (c) => ({
  domain: c.domain,
  path: c.path || '/',
  secure: c.secure,
  httpOnly: c.httpOnly,
  expires: c.expires > 0 ? c.expires : 0,
  name: c.name,
  value: c.value,
  sameSite: c.sameSite === 'None' ? 'no_restriction' : String(c.sameSite ?? '').toLowerCase(),
});

let browserSignIn = null;

/**
 * The user signs in to Google in their own Chrome/Edge window, opened here with a throwaway profile; Google sees an
 * ordinary browser, and the password goes to Google's page only. Once the session cookies exist they are copied out
 * of that profile and the window is closed, so the browser never gets to rotate them behind the app's back.
 */
function signInWithBrowser() {
  browserSignIn ??= runBrowserSignIn().finally(() => (browserSignIn = null));
  return browserSignIn;
}

async function runBrowserSignIn() {
  const exe = findBrowser();
  if (!exe) throw new Error('Chrome, Edge veya Brave bulunamadı. Çerez dosyasıyla içe aktarmayı deneyin.');
  const profile = path.join(app.getPath('temp'), `kurapify-signin-${process.pid}`);
  fs.rmSync(profile, { recursive: true, force: true });
  const port = 20000 + Math.floor(Math.random() * 20000);
  const child = require('node:child_process').spawn(
    exe,
    [`--user-data-dir=${profile}`, `--remote-debugging-port=${port}`, '--remote-allow-origins=*', '--no-first-run', '--no-default-browser-check', '--new-window', SIGN_IN_URL],
    { stdio: 'ignore', detached: false },
  );
  let exited = false;
  child.on('exit', () => (exited = true));
  let cdp = null;
  try {
    const deadline = Date.now() + SIGN_IN_TIMEOUT_MS;
    let rows = null;
    while (!rows) {
      if (exited) throw new Error('Tarayıcı pencereniz kapatıldı, giriş tamamlanmadı.');
      if (Date.now() > deadline) throw new Error('Giriş zaman aşımına uğradı.');
      await sleep(1500);
      try {
        cdp ??= await cdpClient((await (await fetch(`http://127.0.0.1:${port}/json/version`)).json()).webSocketDebuggerUrl);
        const { cookies } = await cdp.send('Storage.getCookies');
        const names = new Set(cookies.filter((c) => /(^|\.)youtube\.com$/.test(c.domain.replace(/^\./, ''))).map((c) => c.name));
        // The session is complete once YouTube itself holds the signing cookie and the account's primary one.
        if (SIGNING_COOKIES.some((n) => names.has(n)) && (names.has('__Secure-3PSID') || names.has('SID'))) {
          await sleep(2500);
          rows = (await cdp.send('Storage.getCookies')).cookies.map(toRow).filter((r) => GOOGLE_COOKIE_DOMAIN.test(r.domain.replace(/^\./, '')));
        }
      } catch {
        cdp = null; // the browser is still starting
      }
    }
    await cdp.send('Browser.close').catch(() => {});
    return await importRows(rows);
  } finally {
    cdp?.close();
    if (!exited) child.kill();
    await sleep(1500);
    fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 });
  }
}

// ---- Using the browser's own signed-in profile ---------------------------------------

/** "Helium", "Chrome"…: the name of the folder above `Application`, else the exe's. */
function browserName(exe) {
  const parts = path.dirname(exe).split(path.sep);
  const at = parts.lastIndexOf('Application');
  return at > 0 ? parts[at - 1] : path.basename(exe, '.exe');
}

/** Where a Chromium browser keeps its profiles. */
function browserDataDir(exe) {
  const local = process.env.LOCALAPPDATA ?? '';
  const lower = exe.toLowerCase();
  const candidates = [
    lower.includes('\\microsoft\\edge\\') && path.join(local, 'Microsoft', 'Edge', 'User Data'),
    lower.includes('\\bravesoftware\\') && path.join(local, 'BraveSoftware', 'Brave-Browser', 'User Data'),
    lower.includes('\\google\\chrome\\') && path.join(local, 'Google', 'Chrome', 'User Data'),
    path.resolve(path.dirname(exe), '..', 'User Data'),
  ].filter(Boolean);
  return candidates.find((dir) => fs.existsSync(path.join(dir, 'Local State'))) ?? null;
}

/** The profile folders worth looking in, the last-used one first. */
function profileFolders(dataDir) {
  let lastUsed = 'Default';
  try {
    lastUsed = JSON.parse(fs.readFileSync(path.join(dataDir, 'Local State'), 'utf8')).profile?.last_used ?? 'Default';
  } catch {}
  const all = fs.readdirSync(dataDir, { withFileTypes: true }).filter((d) => d.isDirectory() && /^(Default|Profile \d+)$/.test(d.name)).map((d) => d.name);
  return [lastUsed, ...all.filter((name) => name !== lastUsed)].filter((name) => all.includes(name));
}

const cookieFile = (profileDir) => [path.join(profileDir, 'Network', 'Cookies'), path.join(profileDir, 'Cookies')].find((f) => fs.existsSync(f)) ?? null;

/** The cookies of one profile as the browser itself reads them: its cookie store is copied to a throwaway profile and opened headless. */
async function readProfileCookies(exe, dataDir, profile, waitForClose) {
  const from = cookieFile(path.join(dataDir, profile));
  if (!from) return [];
  const tmp = path.join(app.getPath('temp'), `kurapify-profile-${process.pid}`);
  fs.rmSync(tmp, { recursive: true, force: true });
  fs.mkdirSync(path.join(tmp, 'Default', 'Network'), { recursive: true });
  const to = path.join(tmp, 'Default', 'Network', 'Cookies');
  try {
    fs.copyFileSync(path.join(dataDir, 'Local State'), path.join(tmp, 'Local State'));
    // A running browser holds its cookie store open exclusively; ask for it to be closed, once, then wait for it to let go.
    let asked = false;
    for (let attempt = 0; ; attempt++) {
      try {
        fs.copyFileSync(from, to);
        break;
      } catch (error) {
        if (!['EBUSY', 'EPERM', 'EACCES'].includes(error.code)) throw error;
        if (!asked) {
          asked = true;
          await waitForClose();
          attempt = 0;
        }
        if (attempt >= 60) throw new Error(`${browserName(exe)} hâlâ açık görünüyor (arka planda çalışıyor olabilir). Tamamen kapatıp yeniden deneyin.`);
        await sleep(1000);
      }
    }
    const journal = `${from}-journal`;
    if (fs.existsSync(journal)) fs.copyFileSync(journal, `${to}-journal`);

    const port = 20000 + Math.floor(Math.random() * 20000);
    const child = require('node:child_process').spawn(
      exe,
      [`--user-data-dir=${tmp}`, `--remote-debugging-port=${port}`, '--remote-allow-origins=*', '--no-first-run', '--no-default-browser-check', '--headless=new', 'about:blank'],
      { stdio: 'ignore' },
    );
    let cdp = null;
    try {
      for (let i = 0; i < 30 && !cdp; i++) {
        await sleep(1000);
        try {
          cdp = await cdpClient((await (await fetch(`http://127.0.0.1:${port}/json/version`)).json()).webSocketDebuggerUrl);
        } catch {}
      }
      if (!cdp) throw new Error('Tarayıcı kopyası başlatılamadı');
      const { cookies } = await cdp.send('Storage.getCookies');
      await cdp.send('Browser.close').catch(() => {});
      return cookies.map(toRow).filter((r) => GOOGLE_COOKIE_DOMAIN.test(r.domain.replace(/^\./, '')) && r.value);
    } finally {
      cdp?.close();
      child.kill();
    }
  } finally {
    await sleep(1000);
    fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 });
  }
}

let profileImport = null;

/**
 * Takes the Google session the default browser already has: [waitForClose] is called (once) if the browser is open and
 * must resolve when the user has closed it, or reject to give up. Resolves to what importRows resolves to, or throws
 * when no profile holds a YouTube session.
 */
function importFromBrowserProfile(waitForClose) {
  profileImport ??= runProfileImport(waitForClose).finally(() => (profileImport = null));
  return profileImport;
}

async function runProfileImport(waitForClose) {
  const exe = findBrowser();
  if (!exe) throw new Error('Chrome, Edge veya Brave bulunamadı.');
  const dataDir = browserDataDir(exe);
  if (!dataDir) throw new Error(`${browserName(exe)} profil klasörü bulunamadı.`);
  const localState = JSON.parse(fs.readFileSync(path.join(dataDir, 'Local State'), 'utf8'));
  if (localState.os_crypt?.app_bound_encrypted_key) {
    throw new Error(`${browserName(exe)} çerezleri yalnızca kendi uygulamasına bağlı şifreliyor; başka bir uygulama bunları aktaramaz.`);
  }
  for (const profile of profileFolders(dataDir)) {
    const rows = await readProfileCookies(exe, dataDir, profile, waitForClose);
    const names = new Set(rows.filter((r) => /(^|\.)youtube\.com$/.test(r.domain.replace(/^\./, ''))).map((r) => r.name));
    if (SIGNING_COOKIES.some((n) => names.has(n)) && (names.has('__Secure-3PSID') || names.has('SID'))) {
      const result = await importRows(rows);
      return { ...result, browser: browserName(exe) };
    }
  }
  throw new Error(`${browserName(exe)} profillerinde açık bir YouTube/Google oturumu bulunamadı.`);
}

/** Removes every cookie of the sign-in session (YouTube and Google), and tells the page. */
async function signOut() {
  await getSession().clearStorageData({ storages: ['cookies'] });
  cache = null;
  const state = await authState(true);
  emit({ event: 'yt.authState', data: state });
  return state;
}

// ---- The sign-in window -----------------------------------------------------------

let loginWindow = null;
const isGoogleHost = (host) => /(^|\.)(google\.com|youtube\.com|gstatic\.com|googleusercontent\.com)$/.test(host);

/** Opens Google's own sign-in page in its own window; closes itself once YouTube Music has a session. */
function openSignIn(url, parent) {
  if (loginWindow) return loginWindow.focus();
  loginWindow = new BrowserWindow({
    width: 520,
    height: 720,
    title: 'Sign in to YouTube Music',
    autoHideMenuBar: true,
    ...(parent && { parent }),
    webPreferences: { session: getSession(), contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  const wc = loginWindow.webContents;
  wc.setWindowOpenHandler(({ url: next }) => {
    try {
      if (isGoogleHost(new URL(next).hostname)) void wc.loadURL(next);
    } catch {}
    return { action: 'deny' };
  });
  wc.on('will-navigate', (event, next) => {
    try {
      const u = new URL(next);
      if (u.protocol !== 'https:' || !isGoogleHost(u.hostname)) event.preventDefault();
    } catch {
      event.preventDefault();
    }
  });
  const maybeDone = async () => {
    if (!loginWindow || new URL(wc.getURL()).hostname !== 'music.youtube.com') return;
    if (await signingSecret()) setTimeout(() => loginWindow?.close(), 800);
  };
  wc.on('did-navigate', () => void maybeDone());
  wc.on('did-finish-load', () => void maybeDone());
  loginWindow.on('closed', () => {
    loginWindow = null;
    cache = null;
    authState(true)
      .then((data) => emit({ event: 'yt.authState', data }))
      .catch(() => {});
  });
  void wc.loadURL(url);
}

/** Writes the sign-in session's cookies to disk now (on quit). */
async function flush() {
  if (ses) await ses.cookies.flushStore().catch(() => {});
}

module.exports = {
  flush,
  SignedOutError,
  setEmitter,
  authState,
  activeIdentity,
  selectChannel,
  setConnected,
  signedFetch,
  openSignIn,
  isGoogleHost,
  parseCookieExport,
  importCookies,
  signInWithBrowser,
  importFromBrowserProfile,
  defaultBrowserName: () => {
    const exe = findBrowser();
    return exe ? browserName(exe) : null;
  },
  signOut,
};
