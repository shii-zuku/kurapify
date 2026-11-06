import { lyricsGet, urlWith } from '@/lyrics/http';

/** The language to translate into: the browser's own. */
export const targetLanguage = (): string => (typeof navigator === 'undefined' ? 'en' : (navigator.language.split('-')[0] ?? 'en').toLowerCase());

export interface Translation {
  text: string;
  /** The language it was written in, as detected. */
  from: string;
}

const cache = new Map<string, Promise<Translation>>();

/**
 * Translates [text] into [target] with Google Translate's public web endpoint, through the app's own fetch (the page
 * can't call it directly). Remembered for the session, so toggling back and forth costs nothing.
 */
export function translate(text: string, target = targetLanguage()): Promise<Translation> {
  const key = `${target}\u0000${text}`;
  let pending = cache.get(key);
  if (!pending) {
    pending = (async () => {
      const body = await lyricsGet(urlWith('https://translate.googleapis.com/translate_a/single', { client: 'gtx', sl: 'auto', tl: target, dt: 't', q: text }), {
        route: 'extension',
      });
      if (!body) throw new Error('Translation is out of reach');
      const parsed = JSON.parse(body) as [([string, ...unknown[]] | null)[] | null, unknown, string?];
      const translated = (parsed[0] ?? []).map((part) => part?.[0] ?? '').join('');
      if (!translated) throw new Error('Nothing came back');
      return { text: translated, from: parsed[2] ?? '' };
    })();
    cache.set(key, pending);
    pending.catch(() => cache.delete(key));
  }
  return pending;
}
