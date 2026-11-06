/**
 * Carries settings saved under the app's earlier storage prefix over to the current one, once: the volume and mix
 * settings, the lyric and Spotify choices, the history. Without it everything would reset on the first start after the
 * rename. Imported first in main.tsx, before any store reads its settings; it can be deleted when nobody has the old
 * data left (a release or two).
 */
const OLD = 'bit' + 'chord:';
const NEW = 'kurapify:';

try {
  for (const key of Object.keys(localStorage)) {
    if (!key.startsWith(OLD)) continue;
    const next = NEW + key.slice(OLD.length);
    const value = localStorage.getItem(key);
    if (value !== null && localStorage.getItem(next) === null) localStorage.setItem(next, value);
    localStorage.removeItem(key);
  }
} catch {
  // storage unavailable: nothing to carry over
}
