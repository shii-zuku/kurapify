import { create } from 'zustand';
import type { MusicItem, Track } from '@/data/music/types';

/**
 * "Pin to Listen Again": songs, albums and playlists kept at the top of Home. YouTube Music keeps its own pins on its
 * server and gives no way to write them from here, so these live on this machine.
 */
const KEY = 'kurapify:pins';

function stored(): MusicItem[] {
  try {
    const value = JSON.parse(localStorage.getItem(KEY) ?? '[]') as unknown;
    return Array.isArray(value) ? value.filter((p): p is MusicItem => !!p && typeof p.id === 'string' && typeof p.title === 'string' && typeof p.kind === 'string') : [];
  } catch {
    return [];
  }
}

function save(items: MusicItem[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(items));
  } catch {
    // kept for this session only
  }
}

interface Pins {
  items: MusicItem[];
  /** Pins [item] (newest first), or unpins it if it is already. */
  toggle: (item: MusicItem) => void;
}

export const usePins = create<Pins>()((set, get) => ({
  items: stored(),
  toggle: (item) => {
    const key = (p: MusicItem) => `${p.kind}:${p.id}`;
    const has = get().items.some((p) => key(p) === key(item));
    const items = has ? get().items.filter((p) => key(p) !== key(item)) : [item, ...get().items];
    save(items);
    set({ items });
  },
}));

export const isPinned = (items: MusicItem[], item: Pick<MusicItem, 'kind' | 'id'>) => items.some((p) => p.kind === item.kind && p.id === item.id);

/** A song as a shelf item. */
export function songItem(track: Track): MusicItem {
  return {
    kind: 'song',
    id: track.videoId,
    title: track.title,
    subtitle: track.artists.map((a) => a.name).join(', '),
    artists: track.artists,
    album: track.album,
    thumbnail: track.thumbnail,
    wide: false,
    durationSec: track.durationSec,
    explicit: track.explicit,
  };
}
