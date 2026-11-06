import { useEffect, useMemo, useState } from 'react';
import type { ArtistRef, Track } from '@/data/music/types';
import { getBridge } from './bridge';
import { useExtension } from './useExtension';

/** Spotify play counts, looked up by title and artist; remembered for the session (the app also caches them on disk). */
const known = new Map<string, number | null>();
const BATCH = 6;
const LANES = 3;
/** A long playlist is looked up as far as this; the rest stays blank rather than hammering Spotify. */
const MAX_TRACKS = 150;

const keyOf = (title: string, artist: string) => `${title}\u0001${artist}`;

const compact = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 });
export const formatStreams = (n: number): string => compact.format(n);
export const formatStreamsFull = (n: number): string => `${n.toLocaleString('en')} streams on Spotify`;

export interface StreamCounts {
  /** The app can look counts up at all (Kurapify Desktop). */
  enabled: boolean;
  /** Count for a row: a number, null when none was found, undefined while it is being looked up. */
  of: (track: Track) => number | null | undefined;
}

/**
 * Spotify stream counts for a track list, through the bridge's `spotify.streams`
 * (answered by the desktop app; a browser extension doesn't have it, so the
 * column stays hidden there).
 */
const NO_ARTISTS: ArtistRef[] = [];

export function useStreamCounts(tracks: Track[], fallbackArtists: ArtistRef[] = NO_ARTISTS): StreamCounts {
  const status = useExtension();
  const enabled = status.state === 'present' && status.extension.info.capabilities.includes('streams');
  const [, bump] = useState(0);

  const wanted = useMemo(
    () =>
      tracks
        .filter((t) => !t.unavailable && t.title)
        .slice(0, MAX_TRACKS)
        .map((t) => ({ videoId: t.videoId, title: t.title, artist: (t.artists.length ? t.artists : fallbackArtists)[0]?.name ?? '' })),
    [tracks, fallbackArtists],
  );

  useEffect(() => {
    if (!enabled) return;
    const bridge = getBridge();
    if (!bridge) return;
    const todo = wanted.filter((t) => !known.has(keyOf(t.title, t.artist)));
    if (!todo.length) return;
    let cancelled = false;
    let failed = false;
    // Small batches, a few in flight at once: the first rows fill in within a second or two instead of
    // after the whole list, and the app caps the total at ten requests to Spotify.
    const batches: (typeof todo)[] = [];
    for (let i = 0; i < todo.length; i += BATCH) batches.push(todo.slice(i, i + BATCH));
    let next = 0;
    const lane = async () => {
      while (next < batches.length && !cancelled && !failed) {
        const batch = batches[next++]!;
        try {
          const { counts } = await bridge.call(
            'spotify.streams',
            { tracks: batch.map((t) => ({ key: keyOf(t.title, t.artist), title: t.title, artist: t.artist })) },
            { timeoutMs: 120_000 },
          );
          for (const t of batch) known.set(keyOf(t.title, t.artist), counts[keyOf(t.title, t.artist)] ?? null);
          if (!cancelled) bump((n) => n + 1);
        } catch {
          failed = true; // Spotify unreachable: leave the cells blank and try again next time the list is shown.
        }
      }
    };
    for (let i = 0; i < LANES; i++) void lane();
    return () => {
      cancelled = true;
    };
  }, [enabled, wanted]);

  return {
    enabled,
    of: (track) => {
      const artist = (track.artists.length ? track.artists : fallbackArtists)[0]?.name ?? '';
      return known.get(keyOf(track.title, artist));
    },
  };
}
