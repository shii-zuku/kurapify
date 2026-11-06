// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest';
import { bareId, inOrder, usePlaylistFolders } from './playlistFolders';
import { useSearchHistory } from './searchHistory';

beforeEach(() => {
  localStorage.clear();
  usePlaylistFolders.setState({ folders: [], order: [], editingId: null });
  useSearchHistory.setState({ items: [] });
});

describe('playlist folders', () => {
  it('puts a playlist in one folder at a time, whichever way its id is spelled', () => {
    const { create, assign, rename } = usePlaylistFolders.getState();
    const a = create();
    rename(a, 'Workout');
    const b = create('VLPL123');
    expect(usePlaylistFolders.getState().folders.find((f) => f.id === b)?.playlistIds).toEqual(['PL123']);
    assign('PL123', a);
    const [first, second] = usePlaylistFolders.getState().folders;
    expect(first?.name).toBe('Workout');
    expect(first?.playlistIds).toEqual(['PL123']);
    expect(second?.playlistIds).toEqual([]);
    assign('VLPL123', null);
    expect(usePlaylistFolders.getState().folders.every((f) => f.playlistIds.length === 0)).toBe(true);
  });

  it('keeps a new folder in edit until it is named, and ignores an empty name', () => {
    const { create, rename } = usePlaylistFolders.getState();
    const id = create();
    expect(usePlaylistFolders.getState().editingId).toBe(id);
    rename(id, '   ');
    expect(usePlaylistFolders.getState().editingId).toBeNull();
    expect(usePlaylistFolders.getState().folders[0]?.name).toBe('New Folder');
  });

  it('survives a reload and deleting a folder frees its playlists', () => {
    const { create, assign, rename, remove } = usePlaylistFolders.getState();
    const id = create();
    rename(id, 'Chill');
    assign('PLabc', id);
    const saved = JSON.parse(localStorage.getItem('kurapify:playlist-folders') ?? '[]');
    expect(saved[0]).toMatchObject({ name: 'Chill', playlistIds: ['PLabc'] });
    remove(id);
    expect(usePlaylistFolders.getState().folders).toEqual([]);
    expect(bareId('VLPLabc')).toBe('PLabc');
  });
});

describe('playlist order', () => {
  it('shows ones never placed first, then the order the listener gave', () => {
    const items = [{ id: 'VLnew' }, { id: 'a' }, { id: 'b' }, { id: 'c' }];
    expect(inOrder(items, ['c', 'a', 'b']).map((i) => i.id)).toEqual(['VLnew', 'c', 'a', 'b']);
  });

  it('places a loose playlist before another, or last, and takes it out of its folder', () => {
    const { create, place, rename } = usePlaylistFolders.getState();
    const folder = create('PLc');
    rename(folder, 'Mix');
    place('PLc', 'PLa', null, ['PLa', 'PLb']);
    expect(usePlaylistFolders.getState().order).toEqual(['PLc', 'PLa', 'PLb']);
    expect(usePlaylistFolders.getState().folders[0]?.playlistIds).toEqual([]);
    place('PLc', null, null, ['PLc', 'PLa', 'PLb']);
    expect(usePlaylistFolders.getState().order).toEqual(['PLa', 'PLb', 'PLc']);
  });

  it('orders inside a folder, and moves one step at a time', () => {
    const { create, assign, place, shift, rename } = usePlaylistFolders.getState();
    const folder = create();
    rename(folder, 'Mix');
    for (const id of ['PL1', 'PL2', 'PL3']) assign(id, folder);
    place('PL3', 'PL1', folder, []);
    expect(usePlaylistFolders.getState().folders[0]?.playlistIds).toEqual(['PL3', 'PL1', 'PL2']);
    shift('PL3', 1, []);
    expect(usePlaylistFolders.getState().folders[0]?.playlistIds).toEqual(['PL1', 'PL3', 'PL2']);
    shift('PL1', -1, []);
    expect(usePlaylistFolders.getState().folders[0]?.playlistIds).toEqual(['PL1', 'PL3', 'PL2']);
    shift('PLx', 1, ['PLx', 'PLy']);
    expect(usePlaylistFolders.getState().order).toEqual(['PLy', 'PLx']);
  });

  it('moves folders among themselves', () => {
    const { create, moveFolder } = usePlaylistFolders.getState();
    const a = create();
    const b = create();
    const c = create();
    moveFolder(c, a);
    expect(usePlaylistFolders.getState().folders.map((f) => f.id)).toEqual([c, a, b]);
    moveFolder(c, null);
    expect(usePlaylistFolders.getState().folders.map((f) => f.id)).toEqual([a, b, c]);
  });
});

describe('search history', () => {
  it('keeps the newest first without repeats and forgets on request', () => {
    const { add, remove, clear } = useSearchHistory.getState();
    add('illit');
    add('aespa');
    add('ILLIT');
    expect(useSearchHistory.getState().items).toEqual(['ILLIT', 'aespa']);
    add('   ');
    expect(useSearchHistory.getState().items).toHaveLength(2);
    remove('aespa');
    expect(useSearchHistory.getState().items).toEqual(['ILLIT']);
    clear();
    expect(useSearchHistory.getState().items).toEqual([]);
    expect(localStorage.getItem('kurapify:search-history')).toBe('[]');
  });
});
