'use strict';
// The listener's own music: audio files picked from disk (Kurapify > Local Files). Only the files' paths are kept, in
// the app's data folder (local-library.json); tags and cover art are read once, when a file is added, and the audio
// is streamed from where it lies, over the same local server as the app (/__local/audio/<id>, with ranges).
const { app } = require('electron');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const AUDIO = new Map([
  ['.mp3', 'audio/mpeg'],
  ['.flac', 'audio/flac'],
  ['.m4a', 'audio/mp4'],
  ['.aac', 'audio/aac'],
  ['.ogg', 'audio/ogg'],
  ['.oga', 'audio/ogg'],
  ['.opus', 'audio/ogg; codecs=opus'],
  ['.wav', 'audio/wav'],
  ['.weba', 'audio/webm'],
  ['.wma', 'audio/x-ms-wma'],
]);
const EXTENSIONS = [...AUDIO.keys()].map((e) => e.slice(1));

const COVER_TYPES = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/gif': '.gif' };

const dataDir = () => app.getPath('userData');
const libraryFile = () => path.join(dataDir(), 'local-library.json');
const coverDir = () => path.join(dataDir(), 'local-covers');

let library = null;

function load() {
  if (library) return library;
  try {
    const parsed = JSON.parse(fs.readFileSync(libraryFile(), 'utf8'));
    library = Array.isArray(parsed) ? parsed.filter((e) => e && typeof e.id === 'string' && typeof e.path === 'string') : [];
  } catch {
    library = [];
  }
  return library;
}

function save() {
  try {
    fs.writeFileSync(libraryFile(), JSON.stringify(library));
  } catch {
    // The library stays in memory for this session.
  }
}

const idOf = (file) => crypto.createHash('sha1').update(path.resolve(file).toLowerCase()).digest('hex').slice(0, 16);

/** Every audio file under [target]: the file itself, or a folder's, any depth. */
function audioFilesIn(target, found = []) {
  let stat;
  try {
    stat = fs.statSync(target);
  } catch {
    return found;
  }
  if (stat.isDirectory()) {
    for (const name of fs.readdirSync(target)) audioFilesIn(path.join(target, name), found);
  } else if (AUDIO.has(path.extname(target).toLowerCase())) {
    found.push(target);
  }
  return found;
}

/** The part of a file name that says what it is: "Artist - Title" or just the title, without numbering. */
function fromFileName(file) {
  const base = path.basename(file, path.extname(file)).replace(/_/g, ' ').trim();
  const stripped = base.replace(/^\d{1,3}\s*[-.)]\s*/, '');
  const [artist, ...rest] = stripped.split(/\s+-\s+/);
  return rest.length ? { artist: artist.trim(), title: rest.join(' - ').trim() } : { artist: '', title: stripped || base };
}

async function describeFile(file) {
  const id = idOf(file);
  const guessed = fromFileName(file);
  const entry = { id, path: path.resolve(file), title: guessed.title, artist: guessed.artist, album: '', durationSec: 0, cover: '', format: path.extname(file).slice(1).toUpperCase(), addedAt: Date.now() };
  try {
    const { parseFile, selectCover } = await import('music-metadata');
    const meta = await parseFile(file, { skipPostHeaders: true });
    const { common, format } = meta;
    if (common.title) entry.title = common.title;
    entry.artist = common.artist || common.albumartist || entry.artist;
    entry.album = common.album || '';
    entry.durationSec = Math.round(format.duration || 0);
    entry.format = [format.container, format.codec].filter(Boolean).join(' ') || entry.format;
    if (format.lossless) entry.lossless = true;
    if (format.bitrate) entry.bitrateKbps = Math.round(format.bitrate / 1000);
    if (format.sampleRate) entry.sampleRateHz = format.sampleRate;
    const picture = selectCover(common.picture);
    const extension = picture && COVER_TYPES[picture.format];
    if (extension) {
      fs.mkdirSync(coverDir(), { recursive: true });
      const name = `${id}${extension}`;
      fs.writeFileSync(path.join(coverDir(), name), picture.data);
      entry.cover = name;
    }
  } catch {
    // A file whose tags can't be read is still music: its name stands in.
  }
  return entry;
}

/** Adds the files and folders to the library; returns the library as it now stands. */
async function add(targets) {
  const entries = load();
  const known = new Set(entries.map((e) => e.id));
  const files = [...new Set(targets.flatMap((target) => audioFilesIn(target)))].filter((f) => !known.has(idOf(f)));
  for (const file of files) entries.push(await describeFile(file));
  if (files.length) save();
  return list();
}

function list() {
  return load()
    .filter((e) => fs.existsSync(e.path))
    .map(({ path: _path, ...rest }) => rest);
}

function remove(id) {
  const entries = load();
  const at = entries.findIndex((e) => e.id === id);
  if (at < 0) return list();
  const [gone] = entries.splice(at, 1);
  if (gone.cover) fs.rmSync(path.join(coverDir(), gone.cover), { force: true });
  save();
  return list();
}

/** Serves /__local/audio/<id> and /__local/cover/<id>; false when the URL is not one of those. */
function serveLocal(req, res, pathname) {
  const match = /^\/__local\/(audio|cover)\/([0-9a-f]{16})$/.exec(pathname);
  if (!match) return false;
  const entry = load().find((e) => e.id === match[2]);
  const file = entry && (match[1] === 'audio' ? entry.path : entry.cover ? path.join(coverDir(), entry.cover) : null);
  let stat;
  try {
    stat = file ? fs.statSync(file) : null;
  } catch {
    stat = null;
  }
  if (!file || !stat || !stat.isFile()) return (res.writeHead(404).end(), true);

  const extension = path.extname(file).toLowerCase();
  const type = match[1] === 'audio' ? AUDIO.get(extension) ?? 'application/octet-stream' : { '.jpg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.gif': 'image/gif' }[extension] ?? 'application/octet-stream';
  const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? '');
  let start = 0;
  let end = stat.size - 1;
  if (range && (range[1] || range[2])) {
    if (range[1]) {
      start = Number(range[1]);
      if (range[2]) end = Math.min(Number(range[2]), end);
    } else {
      start = Math.max(0, stat.size - Number(range[2]));
    }
    if (start > end || start >= stat.size) return (res.writeHead(416, { 'Content-Range': `bytes */${stat.size}` }).end(), true);
  }
  res.writeHead(range ? 206 : 200, {
    'Content-Type': type,
    'Accept-Ranges': 'bytes',
    'Content-Length': end - start + 1,
    ...(range && { 'Content-Range': `bytes ${start}-${end}/${stat.size}` }),
    'Cache-Control': 'no-cache',
  });
  if (req.method === 'HEAD') return (res.end(), true);
  fs.createReadStream(file, { start, end }).pipe(res);
  return true;
}

module.exports = { add, list, remove, serveLocal, EXTENSIONS };
