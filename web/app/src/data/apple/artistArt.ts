import { useQuery } from '@tanstack/react-query';
import { useSyncExternalStore } from 'react';
import { requestHostAccess, useHostAccess } from '@/extension/useHostAccess';
import { lyricsGet, onGranted, onUngrantedChange, ungrantedOrigins, urlWith } from '@/lyrics/http';
import { queryClient } from '@/lib/queryClient';
import { normalized, num, obj, parse, parseArtistPage, str, type AppleArtistArt, type Json } from './artistPage';
import { useAppleSettings } from './motionArt';
import { appleWebToken } from './webToken';

export type { AppleArtistArt };

/**
 * The artist's music.apple.com page, found by exact name. The phone asks the
 * iTunes search API; a page may not be allowed to read it, so Apple's own
 * catalogue search (the web player's token, through the extension) stands in.
 * A search happily returns somebody else, so only an answer with the very
 * name asked for is taken. Null when there is no such artist; throws when
 * Apple couldn't be asked, so a miss from a network hiccup isn't remembered.
 */
async function artistPageUrl(name: string): Promise<string | null> {
  const key = normalized(name);
  const itunes = await lyricsGet(urlWith('https://itunes.apple.com/search', { term: name, entity: 'musicArtist', limit: 5 }));
  if (itunes) {
    const results = (obj(parse(itunes))?.results as Json[] | undefined) ?? [];
    const hit = results.find((r) => normalized(str(r.artistName)) === key);
    if (!hit) return null;
    // The link carries the artist's slug; the bare id answers with a redirect to it.
    const link = str(hit.artistLinkUrl).split('?')[0];
    return link || (num(hit.artistId) ? `https://music.apple.com/us/artist/${num(hit.artistId)}` : null);
  }

  const token = await appleWebToken();
  if (!token) throw new Error('Apple Music is out of reach');
  const search = await lyricsGet(
    urlWith('https://amp-api.music.apple.com/v1/catalog/us/search', { term: name, types: 'artists', limit: 5, l: 'en-US' }),
    { route: 'extension', headers: { Authorization: `Bearer ${token}` } },
  );
  if (!search) throw new Error('Apple Music search failed');
  const artists = (obj(obj(obj(parse(search))?.results)?.artists)?.data as Json[] | undefined) ?? [];
  const hit = artists.find((a) => normalized(str(obj(a.attributes)?.name)) === key);
  return hit ? str(obj(hit.attributes)?.url).split('?')[0] || null : null;
}

/** Apple's art for an artist, remembered across sessions: a week when there is some, half a day when there isn't. */
const ART_KEY = (name: string) => `kurapify:apple-art:v4:${normalized(name)}`;
const ART_TTL_MS = 7 * 24 * 3600_000;
const NO_ART_TTL_MS = 12 * 3600_000;

type KeptArt = { hit: true; art: AppleArtistArt | null } | { hit: false };

function keptArt(name: string): KeptArt {
  try {
    const raw = localStorage.getItem(ART_KEY(name));
    if (!raw) return { hit: false };
    const { at, art } = JSON.parse(raw) as { at: number; art: AppleArtistArt | null };
    return Date.now() - at < (art ? ART_TTL_MS : NO_ART_TTL_MS) ? { hit: true, art } : { hit: false };
  } catch {
    return { hit: false };
  }
}

function keepArt(name: string, art: AppleArtistArt | null): void {
  try {
    localStorage.setItem(ART_KEY(name), JSON.stringify({ at: Date.now(), art }));
  } catch {
    /* storage full or unavailable: it is looked up again next time */
  }
}

export async function fetchAppleArtistArt(name: string): Promise<AppleArtistArt | null> {
  if (!normalized(name)) return null;
  const kept = keptArt(name);
  if (kept.hit) return kept.art;
  const page = await artistPageUrl(name);
  if (!page) return (keepArt(name, null), null);
  const html = await lyricsGet(page, { route: 'extension' });
  if (!html) throw new Error('Apple Music artist page out of reach');
  const art = parseArtistPage(html);
  keepArt(name, art);
  return art;
}

// Apple's hosts are optional extension permissions: once one is allowed, the lookups it refused run again.
onGranted(() => void queryClient.invalidateQueries({ queryKey: ['apple', 'artist-art'] }));

export const APPLE_ORIGINS = ['https://music.apple.com', 'https://amp-api.music.apple.com'];

/**
 * The Apple hosts the extension refused (ungrantedOrigins, filled by
 * lyricsGet): the artist page offers to allow them. Empty until a lookup
 * has actually been refused.
 */
export function useUngrantedAppleOrigins(): string[] {
  return useSyncExternalStore(
    onUngrantedChange,
    () => APPLE_ORIGINS.filter((o) => ungrantedOrigins.has(o)).join(','),
    () => '',
  )
    .split(',')
    .filter(Boolean);
}

/** Opens the extension's permission page for both Apple hosts. */
export function requestAppleAccess(): void {
  requestHostAccess(APPLE_ORIGINS);
}

/** Whether the extension may reach both Apple hosts, for Settings. No Apple Music account is involved. */
export function useAppleAccess() {
  return useHostAccess(APPLE_ORIGINS);
}

/**
 * Apple's header art for [name]. Null until (and unless) it arrives: the
 * YouTube header stands in meanwhile, and stays when Apple has nothing.
 */
export function useAppleArtistArt(name: string | null | undefined): AppleArtistArt | null {
  return useAppleArtistArtLookup(name).art;
}

/** The art, and whether the lookup has finished (found or not), so a page can wait for it rather than show a stand-in first. */
export function useAppleArtistArtLookup(name: string | null | undefined): { art: AppleArtistArt | null; settled: boolean } {
  const on = useAppleSettings((s) => s.artistArt);
  // What an earlier visit kept is there on the first render, so the photograph doesn't wait for the lookup.
  const kept = on && name && normalized(name) ? keptArt(name) : ({ hit: false } as const);
  const query = useQuery({
    queryKey: ['apple', 'artist-art', normalized(name ?? '')],
    queryFn: () => fetchAppleArtistArt(name!),
    ...(kept.hit && { initialData: kept.art }),
    enabled: on && !!name && !!normalized(name),
    staleTime: Infinity,
    gcTime: 60 * 60_000,
    retry: false,
  });
  return { art: on ? (query.data ?? null) : null, settled: !on || !name || !query.isPending };
}
