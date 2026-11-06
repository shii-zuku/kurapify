import { create } from 'zustand';

/**
 * Folders for the sidebar's playlists, and their order. YouTube Music has neither, so they live here, on this machine:
 * a folder is a name and the playlists put in it, in order (by bare id, without the "VL" a page address may carry), and
 * the playlists outside any folder have an order of their own.
 */
export interface PlaylistFolder {
  id: string;
  name: string;
  open: boolean;
  playlistIds: string[];
}

const KEY = 'kurapify:playlist-folders';
const ORDER_KEY = 'kurapify:playlist-order';

export const bareId = (id: string) => id.replace(/^VL/, '');

function read<T>(key: string, fallback: T): unknown {
  try {
    return JSON.parse(localStorage.getItem(key) ?? 'null') ?? fallback;
  } catch {
    return fallback;
  }
}

function storedFolders(): PlaylistFolder[] {
  const value = read<unknown[]>(KEY, []);
  if (!Array.isArray(value)) return [];
  return value
    .filter((f): f is PlaylistFolder => !!f && typeof f.id === 'string' && typeof f.name === 'string' && Array.isArray(f.playlistIds))
    .map((f) => ({ id: f.id, name: f.name, open: f.open !== false, playlistIds: f.playlistIds.filter((p) => typeof p === 'string') }));
}

function storedOrder(): string[] {
  const value = read<unknown[]>(ORDER_KEY, []);
  return Array.isArray(value) ? value.filter((p): p is string => typeof p === 'string') : [];
}

function save(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // kept for this session only
  }
}

/** [items] with [moved] taken out and put before [before] (the end when it is null or not there). */
function placed<T>(items: readonly T[], moved: T, before: T | null): T[] {
  const rest = items.filter((item) => item !== moved);
  const at = before === null ? -1 : rest.indexOf(before);
  return at < 0 ? [...rest, moved] : [...rest.slice(0, at), moved, ...rest.slice(at)];
}

/** [ids] in the order the listener gave them; ones they never placed come first, as YouTube lists them. */
export function inOrder<T extends { id: string }>(items: readonly T[], order: readonly string[]): T[] {
  const rank = new Map(order.map((id, i) => [id, i]));
  const fresh = items.filter((item) => !rank.has(bareId(item.id)));
  const known = items.filter((item) => rank.has(bareId(item.id))).sort((a, b) => rank.get(bareId(a.id))! - rank.get(bareId(b.id))!);
  return [...fresh, ...known];
}

interface PlaylistFolders {
  folders: PlaylistFolder[];
  /** The playlists outside folders, in the order the listener put them. */
  order: string[];
  /** The folder whose name is being typed, new or renamed. */
  editingId: string | null;
  /** A new folder, named for typing; resolves to its id. [playlistId] goes into it at once. */
  create: (playlistId?: string) => string;
  rename: (id: string, name: string) => void;
  remove: (id: string) => void;
  toggle: (id: string) => void;
  /** Puts a playlist in [folderId], out of any other, at the end; null takes it out of its folder. */
  assign: (playlistId: string, folderId: string | null) => void;
  /**
   * Puts a playlist before [beforeId] in [folderId] (or among the loose ones, whose ids as shown are [loose]); with no
   * [beforeId], at the end.
   */
  place: (playlistId: string, beforeId: string | null, folderId: string | null, loose: string[]) => void;
  /** One step up or down in whichever list the playlist is in. */
  shift: (playlistId: string, delta: -1 | 1, loose: string[]) => void;
  /** Puts a folder before another (the end when null). */
  moveFolder: (folderId: string, beforeFolderId: string | null) => void;
  edit: (id: string | null) => void;
}

export const usePlaylistFolders = create<PlaylistFolders>()((set, get) => {
  const apply = (folders: PlaylistFolder[], extra: Partial<PlaylistFolders> = {}) => {
    save(KEY, folders);
    set({ folders, ...extra });
  };
  const withoutPlaylist = (folders: PlaylistFolder[], bare: string) => folders.map((f) => ({ ...f, playlistIds: f.playlistIds.filter((p) => p !== bare) }));
  return {
    folders: storedFolders(),
    order: storedOrder(),
    editingId: null,
    create: (playlistId) => {
      const id = `f-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
      const folder: PlaylistFolder = { id, name: 'New Folder', open: true, playlistIds: playlistId ? [bareId(playlistId)] : [] };
      const others = playlistId ? withoutPlaylist(get().folders, bareId(playlistId)) : get().folders;
      apply([...others, folder], { editingId: id });
      return id;
    },
    rename: (id, name) => {
      const text = name.trim();
      apply(
        get().folders.map((f) => (f.id === id && text ? { ...f, name: text } : f)),
        { editingId: null },
      );
    },
    remove: (id) => apply(get().folders.filter((f) => f.id !== id)),
    toggle: (id) => apply(get().folders.map((f) => (f.id === id ? { ...f, open: !f.open } : f))),
    assign: (playlistId, folderId) => {
      const bare = bareId(playlistId);
      apply(
        get().folders.map((f) => {
          const without = f.playlistIds.filter((p) => p !== bare);
          return f.id === folderId ? { ...f, open: true, playlistIds: [...without, bare] } : { ...f, playlistIds: without };
        }),
      );
    },
    place: (playlistId, beforeId, folderId, loose) => {
      const bare = bareId(playlistId);
      const before = beforeId === null ? null : bareId(beforeId);
      if (folderId === null) {
        const order = placed(loose.map(bareId), bare, before);
        save(ORDER_KEY, order);
        apply(withoutPlaylist(get().folders, bare), { order });
        return;
      }
      apply(
        get().folders.map((f) => {
          const without = f.playlistIds.filter((p) => p !== bare);
          return f.id === folderId ? { ...f, open: true, playlistIds: placed(f.playlistIds, bare, before) } : { ...f, playlistIds: without };
        }),
      );
    },
    shift: (playlistId, delta, loose) => {
      const bare = bareId(playlistId);
      const folder = get().folders.find((f) => f.playlistIds.includes(bare));
      const list = folder ? folder.playlistIds : loose.map(bareId);
      const at = list.indexOf(bare);
      const to = at + delta;
      if (at < 0 || to < 0 || to >= list.length) return;
      const next = [...list];
      [next[at], next[to]] = [next[to]!, next[at]!];
      if (folder) apply(get().folders.map((f) => (f.id === folder.id ? { ...f, playlistIds: next } : f)));
      else {
        save(ORDER_KEY, next);
        set({ order: next });
      }
    },
    moveFolder: (folderId, beforeFolderId) => {
      const folders = get().folders;
      const moving = folders.find((f) => f.id === folderId);
      if (!moving) return;
      const rest = folders.filter((f) => f.id !== folderId);
      const at = beforeFolderId === null ? -1 : rest.findIndex((f) => f.id === beforeFolderId);
      apply(at < 0 ? [...rest, moving] : [...rest.slice(0, at), moving, ...rest.slice(at)]);
    },
    edit: (id) => set({ editingId: id }),
  };
});
