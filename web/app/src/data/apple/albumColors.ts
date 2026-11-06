import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import type { ArtworkColor } from '@/lib/artworkColor';
import { onGranted } from '@/lyrics/http';
import { queryClient } from '@/lib/queryClient';
import { obj, str } from './artistPage';
import { isCompilation, matches, ranked } from './motion';
import { catalog, hitsOf, useAppleSettings } from './motionArt';

/**
 * The colour Apple picked by hand for an album: the `bgColor` its catalogue gives the artwork. Apple's own pages
 * tint the album page with it, so taking the same value (rather than averaging the cover) is what makes the two match.
 */
export interface AppleAlbumInfo {
  /** Apple's `bgColor` for the artwork. */
  color: string | null;
  /** Apple's editorial notes (the long text it shows under the title), with a little markup (<i>, <b>). */
  notes: string | null;
}

export async function fetchAlbumInfo(album: string, artist: string): Promise<AppleAlbumInfo | null> {
  const term = album.toLowerCase().includes(artist.toLowerCase()) ? album : `${artist} ${album}`;
  const root = await catalog('search', { term, types: 'albums', limit: 10 });
  for (const record of ranked(hitsOf(root, 'albums'), album, artist, album, true)) {
    const attributes = obj(record.attributes);
    const name = str(attributes?.name);
    if (!attributes || isCompilation(name)) continue;
    if (!matches({ title: name, artist: str(attributes.artistName) || null, album: name }, album, artist, album)) continue;
    const bg = str(obj(attributes.artwork)?.bgColor);
    const notes = obj(attributes.editorialNotes);
    return {
      color: /^[0-9a-f]{6}$/i.test(bg) ? `#${bg.toLowerCase()}` : null,
      notes: str(notes?.standard).trim() || str(notes?.short).trim() || null,
    };
  }
  return null;
}

/** Relative luminance, 0 (black) to 1 (white). */
function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}

/**
 * Apple shows its colours on a dark page with light text: a bright pick (a lime green, a yellow) is brought down to a
 * deep shade of the same hue, and a pick that is already dark is left as it is.
 */
export function appleTint(bg: string): ArtworkColor {
  const target = 0.035;
  const l = luminance(bg);
  if (l <= target) return { background: bg, dark: true };
  const k = (target / l) ** (1 / 2.4);
  const channel = (i: number) =>
    Math.round(parseInt(bg.slice(i, i + 2), 16) * k)
      .toString(16)
      .padStart(2, '0');
  return { background: `#${channel(1)}${channel(3)}${channel(5)}`, dark: true };
}

const KEY = (album: string, artist: string) => `kurapify:apple-album-info:v1:${album.toLowerCase()}|${artist.toLowerCase()}`;
const TTL_MS = 14 * 24 * 3600_000;
const MISS_TTL_MS = 12 * 3600_000;

type Kept = { hit: true; info: AppleAlbumInfo | null } | { hit: false };

function kept(album: string, artist: string): Kept {
  try {
    const raw = localStorage.getItem(KEY(album, artist));
    if (!raw) return { hit: false };
    const { at, info } = JSON.parse(raw) as { at: number; info: AppleAlbumInfo | null };
    return Date.now() - at < (info ? TTL_MS : MISS_TTL_MS) ? { hit: true, info } : { hit: false };
  } catch {
    return { hit: false };
  }
}

onGranted(() => void queryClient.invalidateQueries({ queryKey: ['apple', 'album-color'] }));

/**
 * Apple's tint for an album page, and whether the lookup has finished. The page waits briefly for it rather than
 * showing the cover's average colour first and changing it.
 */
export function useAppleAlbum(
  album: string | null | undefined,
  artist: string | null | undefined,
): { tint: ArtworkColor | null; notes: string | null; settled: boolean } {
  const on = useAppleSettings((s) => s.artistArt);
  const ready = on && !!album?.trim() && !!artist?.trim();
  const remembered = ready ? kept(album!, artist!) : ({ hit: false } as const);
  const query = useQuery({
    queryKey: ['apple', 'album-color', album ?? '', artist ?? ''],
    queryFn: async () => {
      const info = await fetchAlbumInfo(album!, artist!);
      try {
        localStorage.setItem(KEY(album!, artist!), JSON.stringify({ at: Date.now(), info }));
      } catch {
        // the lookup runs again next time
      }
      return info;
    },
    ...(remembered.hit && { initialData: remembered.info }),
    enabled: ready,
    staleTime: Infinity,
    gcTime: 30 * 60_000,
    retry: false,
  });
  const [gaveUp, setGaveUp] = useState(false);
  useEffect(() => {
    setGaveUp(false);
    const timer = setTimeout(() => setGaveUp(true), 1800);
    return () => clearTimeout(timer);
  }, [album, artist]);
  const info = on ? (query.data ?? null) : null;
  return {
    tint: info?.color ? appleTint(info.color) : null,
    notes: info?.notes ?? null,
    settled: !ready || !query.isPending || query.isError || gaveUp,
  };
}
