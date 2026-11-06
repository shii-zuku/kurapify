import { lyricsGet } from '@/lyrics/http';

let appleToken: Promise<string | null> | null = null;

const TOKEN_KEY = 'kurapify:apple-token';

/** The token kept from an earlier session while it has over an hour left (it is a JWT with an `exp`). */
function storedToken(): string | null {
  try {
    const token = localStorage.getItem(TOKEN_KEY);
    const payload = token?.split('.')[1];
    if (!token || !payload) return null;
    const { exp } = JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/'))) as { exp?: number };
    return exp && exp * 1000 - Date.now() > 3_600_000 ? token : null;
  } catch {
    return null;
  }
}

/**
 * Apple's web player token, scraped from its own script (through the
 * extension: no CORS there). Shared by the Apple lyrics lookup and the artist
 * page's Apple art.
 */
export function appleWebToken(): Promise<string | null> {
  appleToken ??= (async () => {
    const kept = storedToken();
    if (kept) return kept;
    const page = await lyricsGet('https://music.apple.com/us/new', { route: 'extension' });
    const script = page?.match(/\/assets\/index~[^"]+\.js/)?.[0];
    if (!script) return null;
    const source = await lyricsGet(`https://music.apple.com${script}`, { route: 'extension' });
    return source?.match(/eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/)?.[0] ?? null;
  })().then((token) => {
    if (!token) appleToken = null;
    else {
      try {
        localStorage.setItem(TOKEN_KEY, token);
      } catch {
        /* storage unavailable: the token is just fetched again next session */
      }
    }
    return token;
  });
  return appleToken;
}
