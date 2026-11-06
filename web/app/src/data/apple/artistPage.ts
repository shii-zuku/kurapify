/**
 * Reading an Apple Music artist page (no network here, so it can be tested on its own).
 */

/**
 * What Apple Music's artist page shows at the top, as the phone reads it
 * (app/…/data/canvas/AppleArtistArt.kt): the hero photograph, usually the
 * artist's title logo drawn over it as a separate transparent image, and
 * Apple's own colours for that photograph. Most artists have no logo.
 */
export interface AppleArtistArt {
  heroUrl: string;
  /** Width over height of the photograph. */
  heroAspect: number;
  /** A transparent PNG, or null for the many artists without one. */
  logoUrl: string | null;
  /** Width over height, so the logo can be sized before it decodes. */
  logoAspect: number;
  /** Apple's `bgColor` for the photograph: what the page is tinted with. */
  background: string;
  /** Apple's `textColor1`. */
  accent: string;
  /** The colour Apple fills the artist's Play button with; absent for some artists. */
  keyColor: string | null;
  /** Apple's moving header: a muted HLS clip over the photograph. Most big artists have one; null otherwise. */
  video: AppleArtistVideo | null;
  /** Apple's "About" text for the artist, when it has one. */
  bio: string | null;
  /** The "Latest Release" card Apple's page opens with. */
  latest: AppleLatestRelease | null;
  /** Apple's Top Songs, each with the line it prints under the title ("Cheetah - EP · 2026"). */
  songs: AppleTopSong[];
}

export interface AppleTopSong {
  title: string;
  release: string;
}

export interface AppleLatestRelease {
  title: string;
  /** "Sep 23, 2026", as Apple words it. */
  date: string;
  /** "4 songs". */
  songs: string;
  artworkUrl: string | null;
}

export interface AppleArtistVideo {
  /** An HLS playlist (.m3u8) on Apple's CDN. */
  url: string;
  /** The clip's first frame, shown until it plays. */
  posterUrl: string | null;
  /** Width over height. */
  aspect: number;
}

const HERO_WIDTH = 1200;
const LOGO_WIDTH = 1000;

export type Json = Record<string, unknown>;
export const obj = (v: unknown): Json | null => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Json) : null);
export const str = (v: unknown): string => (typeof v === 'string' ? v : '');
export const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
export function parse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/** Case, accents and punctuation are not what makes two names different (AppleArtistArt.kt's normalized()). */
export function normalized(name: string): string {
  return name.toLowerCase().normalize('NFD').replace(/[^\p{L}\p{N}]/gu, '');
}

/** Apple's colours are six hex digits with no prefix. */
function hex(value: unknown): string | null {
  const v = str(value);
  return /^[0-9a-f]{6}$/i.test(v) ? `#${v.toLowerCase()}` : null;
}

/** Fills Apple's image URL template ({w}x{h}{c}.{f}). */
function fill(template: unknown, w: number, h: number, format: string): string | null {
  const url = str(template);
  if (!url.includes('{w}')) return null;
  return url.replace('{w}', String(w)).replace('{h}', String(h)).replace('{c}', 'bb').replace('{f}', format);
}

/** The first object anywhere in [node] that has an `artistLogo` key: the artist page's header. */
function findHeader(node: unknown): Json | null {
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = findHeader(child);
      if (found) return found;
    }
    return null;
  }
  const o = obj(node);
  if (!o) return null;
  if ('artistLogo' in o) return o;
  for (const child of Object.values(o)) {
    const found = findHeader(child);
    if (found) return found;
  }
  return null;
}

/** The first object anywhere in [node] holding [key]. */
function findWith(node: unknown, key: string): Json | null {
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = findWith(child, key);
      if (found) return found;
    }
    return null;
  }
  const o = obj(node);
  if (!o) return null;
  if (key in o) return o;
  for (const child of Object.values(o)) {
    const found = findWith(child, key);
    if (found) return found;
  }
  return null;
}

function parseSongs(root: unknown): AppleTopSong[] {
  const tracks = findWith(root, 'tracks')?.tracks;
  if (!Array.isArray(tracks)) return [];
  return tracks
    .map((track) => {
      const row = obj(track);
      return { title: str(row?.title), release: str(obj((row?.subtitleLinks as unknown[] | undefined)?.[0])?.title) };
    })
    .filter((song) => song.title && song.release);
}

function parseLatest(root: unknown): AppleLatestRelease | null {
  const featured = obj(findWith(root, 'featuredContent')?.featuredContent);
  const detail = obj(featured?.detailText);
  const title = str(detail?.title);
  if (!featured || !title) return null;
  const art = obj(obj(featured.artwork)?.dictionary);
  const w = num(art?.width);
  const h = num(art?.height);
  return {
    title,
    date: str(detail?.headline),
    songs: str(detail?.subtitle),
    artworkUrl: art && w && h ? fill(art.url, 360, Math.round((360 * h) / w), 'jpg') : null,
  };
}

/** The header art in an artist page's hydration JSON; null when it has none. */
export function parseArtistPage(html: string): AppleArtistArt | null {
  const marker = html.indexOf('id="serialized-server-data"');
  if (marker < 0) return null;
  const start = html.indexOf('>', marker) + 1;
  const end = html.indexOf('</script>', start);
  if (start <= 0 || end < 0) return null;
  const root = parse(html.slice(start, end));
  const header = findHeader(root);
  if (!header) return null;

  // Absent for most artists: the key is there and null.
  const logo = obj(obj(header.artistLogo)?.dictionary);
  const hero = obj(obj(header.artwork)?.dictionary) ?? obj(obj(header.colorBackdropArtwork)?.dictionary);
  if (!hero) return null;
  const heroW = num(hero.width);
  const heroH = num(hero.height);
  if (!heroW || !heroH) return null;
  const heroUrl = fill(hero.url, HERO_WIDTH, Math.round((HERO_WIDTH * heroH) / heroW), 'jpg');
  if (!heroUrl) return null;

  const logoW = num(logo?.width);
  const logoH = num(logo?.height);
  const logoUrl = logo && logoW && logoH ? fill(logo.url, LOGO_WIDTH, Math.round((LOGO_WIDTH * logoH) / logoW), 'png') : null;

  const background = hex(hero.bgColor);
  if (!background) return null;

  // The moving header: its own colours are the ones Apple's page takes (the clip's first frame, not the still photograph).
  const wide = obj(obj(header.wideVideoArtwork)?.dictionary);
  const clip = obj(wide?.motionArtistWide16x9) ?? obj(wide?.motionArtistFullscreen16x9);
  const frame = obj(clip?.previewFrame);
  const clipUrl = str(clip?.video);
  const frameW = num(frame?.width);
  const frameH = num(frame?.height);
  const video: AppleArtistVideo | null =
    clipUrl.startsWith('https://') && frameW && frameH
      ? { url: clipUrl, posterUrl: fill(frame?.url, 1600, Math.round((1600 * frameH) / frameW), 'jpg'), aspect: frameW / frameH }
      : null;
  const frameBackground = video ? hex(frame?.bgColor) : null;
  return {
    heroUrl,
    heroAspect: heroW / heroH,
    logoUrl,
    logoAspect: logoUrl ? logoW / logoH : 1,
    background: frameBackground ?? background,
    accent: (video && hex(frame?.textColor1)) || hex(hero.textColor1) || background,
    keyColor: hex(header.keyColor),
    video,
    bio: str(header.bio).trim() || null,
    latest: parseLatest(root),
    songs: parseSongs(root),
  };
}
