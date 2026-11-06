'use strict';
// Spotify stream counts for the track lists: web/extension/lib/spotify.ts reduced to what a count needs.
// Nothing here signs in to Spotify: it uses the anonymous token the web player itself starts with,
// reads the player's own query hashes out of its bundle (as the extension does), finds the track by
// search and reads `playcount` from `getTrack`. Unofficial: Spotify may change or retire any of it,
// in which case the counts simply stay blank.
const { app } = require('electron');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const WEB_PLAYER = 'https://open.spotify.com';
const CDN = 'https://open.spotifycdn.com/cdn/build/web-player/';
const PATHFINDER = 'https://api-partner.spotify.com/pathfinder/v2/query';
const CLIENT_TOKEN = 'https://clienttoken.spotify.com/v1/clienttoken';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';

/** The last hashes seen working; used when the bundle can't be read. */
const KNOWN_HASHES = {
  searchTracks: 'b02683192a98dde7966b5e6655a79eeb62713eab703eda9902c932818dd52751',
  getTrack: 'fe16b8083eec2305854db612ca75589bcb71e009dc7a4d014f29bd534a4c01f5',
};
const WEB_PLAYER_TTL_MS = 12 * 3600_000;
const FOUND_TTL_MS = 24 * 3600_000;
const MISSED_TTL_MS = 6 * 3600_000;
const CONCURRENCY = 4;

const userFile = (name) => path.join(app.getPath('userData'), name);

function readJson(name, fallback) {
  try {
    return JSON.parse(fs.readFileSync(userFile(name), 'utf8'));
  } catch {
    return fallback;
  }
}

async function text(url) {
  try {
    const response = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(30_000) });
    return response.ok ? await response.text() : null;
  } catch {
    return null;
  }
}

// ---- The web player's own values ----------------------------------------------------

function unescapeJs(body) {
  return body.replace(/\\(u\{[0-9a-fA-F]+\}|u[0-9a-fA-F]{4}|x[0-9a-fA-F]{2}|[\s\S])/g, (_, esc) => {
    if (esc[0] === 'u') return String.fromCodePoint(parseInt(esc.replace(/[u{}]/g, ''), 16));
    if (esc[0] === 'x') return String.fromCharCode(parseInt(esc.slice(1), 16));
    return { n: '\n', r: '\r', t: '\t', 0: '\0' }[esc] ?? esc;
  });
}

function secretsIn(script) {
  return [...script.matchAll(/\{secret:(['"])((?:\\.|(?!\1).)*)\1,version:(\d+)\}/g)]
    .map((m) => ({ version: Number(m[3]), codes: [...unescapeJs(m[2])].map((c) => c.charCodeAt(0)) }))
    .sort((a, b) => b.version - a.version);
}

const queryHashIn = (script, operation) =>
  script.match(new RegExp(`["']${operation}["']\\s*,\\s*["']query["']\\s*,\\s*["']([0-9a-f]{64})["']`))?.[1] ?? null;

async function readWebPlayer() {
  const html = (await text(`${WEB_PLAYER}/`)) ?? '';
  const config = html.match(/<script id="appServerConfig" type="text\/plain">([^<]+)<\/script>/)?.[1];
  let clientVersion = '';
  try {
    clientVersion = config ? (JSON.parse(Buffer.from(config, 'base64').toString()).clientVersion ?? '') : '';
  } catch {}
  const bundleUrl = html.match(/https:\/\/open\.spotifycdn\.com\/cdn\/build\/web-player\/web-player\.[0-9a-f]+\.js/)?.[0];
  const bundle = bundleUrl ? ((await text(bundleUrl)) ?? '') : '';
  // searchTracks is declared in the search route's chunk, which the player loads on demand.
  let searchChunk = '';
  const searchId = bundle.match(/(\d+):"xpui-routes-search"/)?.[1];
  if (searchId) {
    for (const [, part] of bundle.matchAll(new RegExp(`\\b${searchId}:"([0-9a-f]{8})"`, 'g'))) {
      searchChunk = (await text(`${CDN}xpui-routes-search.${part}.js`)) ?? '';
      if (searchChunk) break;
    }
  }
  const secret = secretsIn(bundle)[0] ?? null;
  return {
    clientVersion: clientVersion || '1.2.77.0',
    secret,
    hashes: {
      searchTracks: queryHashIn(searchChunk, 'searchTracks') ?? queryHashIn(bundle, 'searchTracks') ?? KNOWN_HASHES.searchTracks,
      getTrack: queryHashIn(bundle, 'getTrack') ?? KNOWN_HASHES.getTrack,
    },
    at: Date.now(),
  };
}

let webPlayerCache = null;
async function webPlayer(force = false) {
  if (!force) {
    webPlayerCache ??= readJson('spotify-webplayer.json', null);
    if (webPlayerCache?.secret && Date.now() - webPlayerCache.at < WEB_PLAYER_TTL_MS) return webPlayerCache;
  }
  const fresh = await readWebPlayer();
  if (!fresh.secret) throw new Error('Spotify web player could not be read');
  webPlayerCache = fresh;
  try {
    fs.writeFileSync(userFile('spotify-webplayer.json'), JSON.stringify(fresh));
  } catch {}
  return fresh;
}

// ---- Token ---------------------------------------------------------------------------

/** Six digits over SHA-1, thirty-second steps, from the secret's codes XORed with their index. */
function totp(codes, epochMs) {
  const key = Buffer.from(codes.map((code, i) => code ^ ((i % 33) + 9)).join(''));
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(epochMs / 1000 / 30)));
  const hash = crypto.createHmac('sha1', key).update(counter).digest();
  const offset = hash[hash.length - 1] & 0x0f;
  const binary = ((hash[offset] & 0x7f) << 24) | (hash[offset + 1] << 16) | (hash[offset + 2] << 8) | hash[offset + 3];
  return String(binary % 1_000_000).padStart(6, '0');
}

let access = null;
let client = null;
let minting = null;
let retryAfter = 0;

async function mint() {
  if (Date.now() < retryAfter) throw new Error('Spotify would not mint a token; trying again shortly');
  for (const force of [false, true]) {
    const player = await webPlayer(force);
    const code = totp(player.secret.codes, Date.now());
    const query = new URLSearchParams({ reason: 'init', productType: 'web-player', totp: code, totpServer: code, totpVer: String(player.secret.version) });
    const response = await fetch(`${WEB_PLAYER}/api/token?${query}`, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(20_000) });
    const body = await response.json().catch(() => ({}));
    if (body.totpVerExpired && !force) continue;
    if (body.accessToken) {
      access = { token: body.accessToken, expiresAt: body.accessTokenExpirationTimestampMs ?? Date.now() + 3_600_000, clientId: body.clientId ?? null };
      return access;
    }
    if (force) break;
  }
  retryAfter = Date.now() + 60_000;
  throw new Error('Spotify would not mint a token');
}

async function accessToken() {
  if (access && Date.now() < access.expiresAt - 30_000) return access;
  minting ??= mint().finally(() => (minting = null));
  return minting;
}

/** Best effort: a request without it is still sent. */
async function clientToken() {
  if (client && Date.now() < client.expiresAt - 30_000) return client.token;
  const bearer = await accessToken();
  if (!bearer.clientId) return null;
  const player = await webPlayer();
  try {
    const response = await fetch(CLIENT_TOKEN, {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'User-Agent': UA },
      body: JSON.stringify({
        client_data: {
          client_version: player.clientVersion,
          client_id: bearer.clientId,
          js_sdk_data: { device_brand: 'unknown', device_model: 'unknown', os: 'windows', os_version: 'unknown', device_id: deviceId(), device_type: 'computer' },
        },
      }),
      signal: AbortSignal.timeout(20_000),
    });
    const body = await response.json();
    if (body.response_type !== 'RESPONSE_GRANTED_TOKEN_RESPONSE' || !body.granted_token?.token) return null;
    client = { token: body.granted_token.token, expiresAt: Date.now() + (body.granted_token.expires_after_seconds ?? 3600) * 1000 };
    return client.token;
  } catch {
    return null;
  }
}

let device = null;
function deviceId() {
  device ??= crypto.randomUUID().replaceAll('-', '');
  return device;
}

// ---- Pathfinder ----------------------------------------------------------------------

async function gql(operation, variables, retried = false) {
  const bearer = await accessToken();
  const player = await webPlayer();
  const clientTok = await clientToken();
  const response = await fetch(PATHFINDER, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${bearer.token}`,
      Accept: 'application/json',
      'Content-Type': 'application/json;charset=UTF-8',
      'App-Platform': 'WebPlayer',
      'User-Agent': UA,
      ...(clientTok && { 'Client-Token': clientTok }),
    },
    body: JSON.stringify({ variables, operationName: operation, extensions: { persistedQuery: { version: 1, sha256Hash: player.hashes[operation] } } }),
    signal: AbortSignal.timeout(20_000),
  });
  if (response.status === 401 && !retried) {
    access = null;
    client = null;
    return gql(operation, variables, true);
  }
  const body = await response.json().catch(() => null);
  const errors = (body?.errors ?? []).map((e) => e.message ?? '');
  // A rebuilt web player retires the old hash: look it up again once.
  if (errors.some((m) => /PersistedQueryNotFound/i.test(m)) && !retried) {
    await webPlayer(true);
    return gql(operation, variables, true);
  }
  if (!response.ok) throw new Error(`Spotify ${operation} failed (${response.status})`);
  if (!body) throw new Error(`Spotify ${operation} answered with something other than JSON`);
  if (errors.length && !body.data) throw new Error(errors.join('; '));
  return body;
}

// ---- Matching a YouTube Music track to a Spotify one -----------------------------------

/** Lowercase, accents and bracketed qualifiers dropped, punctuation flattened. */
function norm(value) {
  return String(value ?? '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\(.*?\)|\[.*?\]/g, ' ')
    .replace(/\s+[-–]\s+(remaster\w*|live|.*version|.*mix)\b.*$/, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

const splitArtists = (artist) => String(artist ?? '').split(/,|&|\bfeat\.?\b|\bft\.?\b| x /i).map(norm).filter(Boolean);

/**
 * The names a track may go by on Spotify: the title without its brackets, then what the brackets hold
 * ("퀸카 (Queencard)" is "Queencard" there), then the whole thing flattened.
 */
function titleVariants(title) {
  const text = String(title ?? '');
  const inside = [...text.matchAll(/\(([^)]*)\)|\[([^\]]*)\]/g)].map((m) => norm(m[1] ?? m[2])).filter((v) => v && !/^(feat|ft|with|live|remaster|from)\b/.test(v));
  const flat = text.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  // A title in two scripts side by side ("피카부 Peek-A-Boo", "봐 Look") is one of them on Spotify: its Latin words,
  // or the rest.
  const words = norm(text).split(' ').filter(Boolean);
  const latin = (word) => /^[\p{Script=Latin}\p{N}]+$/u.test(word);
  const latinPart = words.filter(latin).join(' ');
  const otherPart = words.filter((word) => !latin(word)).join(' ');
  const split = latinPart && otherPart ? [latinPart, otherPart] : [];
  return [...new Set([norm(text), ...inside, ...split, flat].filter(Boolean))];
}

function pick(items, title, artist) {
  const variants = titleVariants(title);
  const artists = splitArtists(artist);
  const candidates = items
    .map((entry) => entry?.item?.data)
    .filter((data) => data?.uri && data.name)
    .map((data) => ({
      uri: data.uri,
      name: norm(data.name),
      artists: (data.artists?.items ?? []).map((a) => norm(a?.profile?.name)).filter(Boolean),
    }));
  const byArtist = (c) => !artists.length || c.artists.some((a) => artists.some((w) => a === w || a.includes(w) || w.includes(a)));
  return (
    candidates.find((c) => variants.includes(c.name) && byArtist(c)) ??
    candidates.find((c) => c.name && variants.some((v) => c.name.startsWith(v) || v.startsWith(c.name)) && byArtist(c)) ??
    null
  );
}

/** Resolves the Spotify track (by search, unless its uri is already known) and reads its play count. */
async function playcountFor(title, artist, knownUri) {
  let uri = knownUri;
  if (!uri) {
    // The first spelling that finds the track wins; a Latin spelling inside brackets is the usual second try.
    const lead = splitArtists(artist)[0] ?? '';
    for (const term of titleVariants(title).slice(0, 3)) {
      const search = await gql('searchTracks', {
        searchTerm: `${term} ${lead}`.trim(),
        offset: 0,
        limit: 10,
        numberOfTopResults: 3,
        includeAudiobooks: false,
        includePreReleases: false,
        includeAuthors: false,
      });
      uri = pick(search?.data?.searchV2?.tracksV2?.items ?? [], title, artist)?.uri ?? null;
      if (uri) break;
    }
    if (!uri) return { n: null, uri: null };
  }
  const track = await gql('getTrack', { uri });
  const count = Number(track?.data?.trackUnion?.playcount);
  return { n: Number.isFinite(count) && count > 0 ? count : null, uri };
}

// ---- Cache and the bridge's entry point --------------------------------------------------

let cache = null;
let saveTimer;
function loaded() {
  cache ??= readJson('spotify-streams.json', {});
  return cache;
}
function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      fs.writeFileSync(userFile('spotify-streams.json'), JSON.stringify(cache));
    } catch {}
  }, 2000);
}

/** Every request to Spotify, from every call, shares this many slots. */
const MAX_PARALLEL = 10;
let active = 0;
const waiting = [];
function limited(task) {
  return new Promise((resolve, reject) => {
    const run = () => {
      active++;
      task()
        .then(resolve, reject)
        .finally(() => {
          active--;
          waiting.shift()?.();
        });
    };
    if (active < MAX_PARALLEL) run();
    else waiting.push(run);
  });
}

/** Lookups already running, so two lists asking for the same track share one. */
const inflight = new Map();

/**
 * `{ key, title, artist }[]` → `{ [key]: count | null }`. Answers from the cache at once; a track
 * whose count is stale but whose Spotify uri is known costs one request instead of two. A track
 * that fails to resolve is null and isn't remembered.
 */
async function streams(tracks) {
  const store = loaded();
  const counts = {};
  let failure = null;
  const jobs = [];
  for (const { key, title, artist } of tracks) {
    const cacheKey = `${norm(title)}|${splitArtists(artist).join(',')}`;
    const hit = store[cacheKey];
    if (hit && Date.now() - hit.at < (hit.n ? FOUND_TTL_MS : MISSED_TTL_MS)) {
      counts[key] = hit.n;
      continue;
    }
    jobs.push(
      (async () => {
        if (failure) return void (counts[key] = null);
        let pending = inflight.get(cacheKey);
        if (!pending) {
          pending = limited(() => playcountFor(title, artist, hit?.uri)).finally(() => inflight.delete(cacheKey));
          inflight.set(cacheKey, pending);
        }
        try {
          const { n, uri } = await pending;
          store[cacheKey] = { n, uri, at: Date.now() };
          counts[key] = n;
        } catch (error) {
          failure = error;
          counts[key] = null;
        }
      })(),
    );
  }
  await Promise.all(jobs);
  if (jobs.length) scheduleSave();
  // Everything failed: say so, so the page can try again later instead of treating it as "no counts".
  if (failure && !tracks.some((t) => counts[t.key])) throw failure;
  for (const { key } of tracks) counts[key] ??= null;
  return counts;
}

module.exports = { streams, norm, pick, totp };
