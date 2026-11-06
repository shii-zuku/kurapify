import { create } from 'zustand';
import type { ArtistRef, MusicItem, Track } from '@/data/music/types';

/**
 * What the listener turned away with "Not interested" and "Don't recommend artist". The request itself goes to YouTube
 * Music (FeedbackMenu), whose recommender it is for; this is what makes it show at once, here: what is hidden stays off
 * Home, and out of the stations AutoPlay builds, instead of waiting for the next feed.
 */
const KEY = 'kurapify:hidden';

interface Stored {
  songs: string[];
  /** Albums and playlists (and anything else), as "kind:id". */
  items: string[];
  artists: { id: string; name: string }[];
}

function stored(): Stored {
  try {
    const value = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<Stored>;
    return {
      songs: Array.isArray(value.songs) ? value.songs.filter((s) => typeof s === 'string') : [],
      items: Array.isArray(value.items) ? value.items.filter((s) => typeof s === 'string') : [],
      artists: Array.isArray(value.artists) ? value.artists.filter((a) => a && typeof a.id === 'string' && typeof a.name === 'string') : [],
    };
  } catch {
    return { songs: [], items: [], artists: [] };
  }
}

interface Hidden extends Stored {
  hideSong: (videoId: string) => void;
  hideItem: (item: Pick<MusicItem, 'kind' | 'id'>) => void;
  hideArtist: (artist: { id: string; name: string }) => void;
  /** Takes everything back. */
  reset: () => void;
}

const pick = (s: Stored): Stored => ({ songs: s.songs, items: s.items, artists: s.artists });

export const useHidden = create<Hidden>()((set, get) => {
  const apply = (next: Stored) => {
    try {
      localStorage.setItem(KEY, JSON.stringify(next));
    } catch {
      // kept for this session only
    }
    set(next);
  };
  return {
    ...stored(),
    hideSong: (videoId) => {
      if (!get().songs.includes(videoId)) apply({ ...pick(get()), songs: [...get().songs, videoId] });
    },
    hideItem: (item) => {
      const key = `${item.kind}:${item.id}`;
      if (!get().items.includes(key)) apply({ ...pick(get()), items: [...get().items, key] });
    },
    hideArtist: (artist) => {
      if (!get().artists.some((a) => a.id === artist.id)) apply({ ...pick(get()), artists: [...get().artists, artist] });
    },
    reset: () => apply({ songs: [], items: [], artists: [] }),
  };
});

/** Whether a song (by id and credited artists) is one the listener asked not to be shown. */
export function isHiddenSong(videoId: string, artists: readonly ArtistRef[]): boolean {
  const { songs, artists: blocked } = useHidden.getState();
  return songs.includes(videoId) || artists.some((a) => a.id !== null && blocked.some((b) => b.id === a.id));
}

/** Whether a shelf item is hidden: a song asked away, or anything credited to (or being) a blocked artist. */
export function isHiddenItem(item: MusicItem, state: Pick<Stored, 'songs' | 'items' | 'artists'> = useHidden.getState()): boolean {
  if (state.items.includes(`${item.kind}:${item.id}`)) return true;
  if ((item.kind === 'song' || item.kind === 'video') && state.songs.includes(item.id)) return true;
  if (item.kind === 'artist' && state.artists.some((a) => a.id === item.id)) return true;
  return item.artists.some((a) => a.id !== null && state.artists.some((b) => b.id === a.id));
}

export const trackIsHidden = (track: Track) => isHiddenSong(track.videoId, track.artists);
