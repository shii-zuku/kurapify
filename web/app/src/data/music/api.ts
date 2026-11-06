import type { YTMusic, YTNodes } from 'youtubei.js/web';
import type { Candidate } from '@/playback/queue/builder';
import { getInnertube, getMusicClient, getSignedInnertube } from '@/playback/youtube/innertube';
import { isExactArtistMatch, normalizedArtistName } from '@/lib/artistCredits';
import { LIBRARY_SECTIONS, LIKED_MUSIC_PLAYLIST, type LibrarySection } from './library';
import {
  mapAlbum,
  mapArtist,
  mapBrowse,
  mapCategories,
  mapHome,
  mapPlaylist,
  mapPlaylistTracks,
  mapSearch,
  mapShelves,
  mapSuggestions,
} from './mappers';
import type {
  AlbumPage,
  MusicItem,
  ArtistPage,
  BrowseLink,
  BrowsePage,
  CategoryGroup,
  PlaylistPage,
  SearchResults,
  Shelf,
  Suggestions,
  Track,
} from './types';

// The browse pages' requests, through YouTube.js's music namespace (prompt
// §5.1). Each returns a view model; continuations are passed back as opaque
// handles, so pages never see a YouTube.js object.

export interface Paged<T> {
  data: T;
  /** Fetches the next page; null when there isn't one. */
  next: (() => Promise<Paged<T>>) | null;
}

/**
 * YouTube often offers one more page than it has: the continuation comes back
 * empty and YouTube.js throws ("Continuation did not have any content"). That
 * is the end of the list, not a failure; anything else still is one.
 */
async function orEnd<T>(nextPage: () => Promise<Paged<T>>, empty: T): Promise<Paged<T>> {
  try {
    return await nextPage();
  } catch (error) {
    if (/did not have any content|no continuation/i.test(String(error))) return { data: empty, next: null };
    throw error;
  }
}

function homePage(feed: YTMusic.HomeFeed): Paged<Shelf[]> {
  return {
    data: mapHome(feed),
    next: feed.has_continuation ? () => orEnd(async () => homePage(await feed.getContinuation()), []) : null,
  };
}

export async function fetchHome(): Promise<Paged<Shelf[]>> {
  const yt = await getMusicClient();
  return homePage(await yt.music.getHomeFeed());
}

/** The New page: YouTube Music's Explore, minus its podcast and mood carousels (mappers drop those). */
export async function fetchExplore(): Promise<Shelf[]> {
  const yt = await getMusicClient();
  return mapShelves((await yt.music.getExplore()).sections);
}

/** Moods & genres, read raw because YouTube.js drops the tiles' colours. */
export async function fetchCategories(): Promise<CategoryGroup[]> {
  const yt = await getInnertube();
  const response = await yt.actions.execute('/browse', { browseId: 'FEmusic_moods_and_genres', client: 'YTMUSIC' });
  return mapCategories(response.data);
}

export async function fetchSearch(query: string): Promise<SearchResults> {
  const yt = await getMusicClient();
  return mapSearch(await yt.music.search(query));
}

/** YouTube Music's Songs shelf for [query]: what an import or a match is chosen from. */
export async function searchSongs(query: string): Promise<Track[]> {
  const yt = await getMusicClient();
  const search = await yt.music.search(query, { type: 'song' });
  const shelf = search.songs ?? search.contents?.find((c) => c.type === 'MusicShelf');
  return mapPlaylistTracks((shelf as { contents?: readonly unknown[] } | undefined)?.contents ?? []);
}

export async function fetchSuggestions(input: string): Promise<Suggestions> {
  const yt = await getInnertube();
  return mapSuggestions(await yt.music.getSearchSuggestions(input));
}

export async function fetchAlbum(id: string): Promise<AlbumPage> {
  const yt = await getMusicClient();
  return mapAlbum(id, await yt.music.getAlbum(id));
}

/** How many top songs an artist page lists, as on the phone. */
const ARTIST_TOP_SONGS = 20;

/**
 * An artist. The landing page only lists five songs, so its linked "Top
 * songs" playlist fills the list out (YtMusicRepository.artistPage); if that
 * fails, the five stand.
 */
export async function fetchArtist(id: string): Promise<ArtistPage> {
  const yt = await getMusicClient();
  const page = mapArtist(id, await yt.music.getArtist(id));
  const playlistId = page.topSongsSeeAll?.browseId;
  if (playlistId?.startsWith('VL') && page.topSongs.length < ARTIST_TOP_SONGS) {
    try {
      const { page: playlist } = await fetchPlaylist(playlistId);
      if (playlist.tracks.length > page.topSongs.length) page.topSongs = playlist.tracks.slice(0, ARTIST_TOP_SONGS);
    } catch {
      // The landing page's songs are still the right ones, just fewer.
    }
  }
  return page;
}

function playlistTracks(page: YTMusic.Playlist): Paged<Track[]> {
  return {
    data: mapPlaylistTracks(page.items),
    next: page.has_continuation ? () => orEnd(async () => playlistTracks(await page.getContinuation()), []) : null,
  };
}

/** The header and first page of tracks; `more` fetches the rest page by page. */
export async function fetchPlaylist(id: string): Promise<{ page: PlaylistPage; more: Paged<Track[]>['next'] }> {
  const yt = await getMusicClient();
  const playlist = await yt.music.getPlaylist(id);
  return { page: mapPlaylist(id, playlist), more: playlistTracks(playlist).next };
}

/** See All, moods and genres: whatever the browse id renders as. */
export async function fetchBrowse({ browseId, params }: BrowseLink): Promise<BrowsePage> {
  const yt = await getMusicClient();
  const { YTNodes } = await import('youtubei.js/web');
  const response = await yt.actions.execute('/browse', {
    browseId,
    ...(params && { params }),
    client: 'YTMUSIC',
    parse: true,
  });
  const memo = response.contents_memo;
  const sections = [
    ...(memo?.getType(YTNodes.Grid) ?? []),
    ...(memo?.getType(YTNodes.MusicCarouselShelf) ?? []),
    ...(memo?.getType(YTNodes.MusicShelf) ?? []),
    ...(memo?.getType(YTNodes.MusicPlaylistShelf) ?? []),
  ];
  const header = memo?.getType(YTNodes.MusicHeader)?.[0] ?? (response.header as unknown);
  return mapBrowse({ header, sections }, '');
}

// ---- Signed in (prompt §5.3) ------------------------------------------------------

type Raw = Record<string, unknown>;

/** Every object stored under [key], anywhere inside a raw response. */
function collect(root: unknown, key: string, out: Raw[] = []): Raw[] {
  if (Array.isArray(root)) for (const item of root) collect(item, key, out);
  else if (root && typeof root === 'object') {
    for (const [k, v] of Object.entries(root)) {
      if (k === key && v && typeof v === 'object' && !Array.isArray(v)) out.push(v as Raw);
      else collect(v, key, out);
    }
  }
  return out;
}

function runsText(node: unknown): string {
  const n = node as { runs?: { text?: string }[]; simpleText?: string } | undefined;
  return n?.runs?.map((r) => r.text ?? '').join('') ?? n?.simpleText ?? '';
}

/** One library page, a page of it at a time: grids continue as grids, song lists as song lists. */
export async function fetchLibrary(section: LibrarySection): Promise<Paged<BrowsePage>> {
  const yt = await getSignedInnertube();
  const { YTNodes } = await import('youtubei.js/web');
  const { title, browseId } = LIBRARY_SECTIONS[section];
  const response = await yt.actions.execute('/browse', { browseId, client: 'YTMUSIC', parse: true });
  const memo = response.contents_memo;
  const grids = memo?.getType(YTNodes.Grid) ?? [];
  const lists = [...(memo?.getType(YTNodes.MusicShelf) ?? []), ...(memo?.getType(YTNodes.MusicPlaylistShelf) ?? [])];
  const carousels = memo?.getType(YTNodes.MusicCarouselShelf) ?? [];
  const page = mapBrowse({ sections: [...grids, ...lists, ...carousels] }, title);
  // History is several lists ("Today", "Yesterday"); the rest is one grid or one list.
  const token = (grids[0]?.continuation ?? (lists.length === 1 ? lists[0]?.continuation : null)) || null;
  return { data: { ...page, title }, next: token ? () => orEnd(() => libraryContinuation(token, title), emptyPage(title)) : null };
}

const emptyPage = (title: string): BrowsePage => ({ title, shelves: [], grid: [], tracks: [] });

async function libraryContinuation(token: string, title: string): Promise<Paged<BrowsePage>> {
  const yt = await getSignedInnertube();
  const response = await yt.actions.execute('/browse', { continuation: token, client: 'YTMUSIC', parse: true });
  const contents = response.continuation_contents as unknown as
    | { type: string; items?: unknown[]; contents?: unknown[]; continuation?: string | null }
    | undefined;
  const section =
    contents?.type === 'GridContinuation'
      ? { type: 'Grid', items: contents.items ?? [] }
      : { type: 'MusicShelf', contents: contents?.contents ?? [] };
  const next = contents?.continuation || null;
  return {
    data: mapBrowse({ sections: [section] }, title),
    next: next ? () => orEnd(() => libraryContinuation(next, title), emptyPage(title)) : null,
  };
}

/** The user's playlists for the sidebar, in YouTube's order (most recent activity first). */
export async function fetchLibraryPlaylists(): Promise<MusicItem[]> {
  const { data } = await fetchLibrary('playlists');
  return data.grid.filter((item) => item.kind === 'playlist');
}

export type LikeStatus = 'LIKE' | 'DISLIKE' | 'INDIFFERENT';

/** The thumbs state YouTube Music shows on its player for this track. */
export async function fetchLikeStatus(videoId: string): Promise<LikeStatus> {
  const yt = await getSignedInnertube();
  const response = await yt.actions.execute('/next', { videoId, client: 'YTMUSIC' });
  const button = collect((response.data as Raw).playerOverlays, 'likeButtonRenderer')[0];
  const status = button?.likeStatus;
  return status === 'LIKE' || status === 'DISLIKE' ? status : 'INDIFFERENT';
}

/** Likes a track (it joins Liked Music) or takes the like back. */
export async function setTrackLiked(videoId: string, liked: boolean): Promise<void> {
  const yt = await getSignedInnertube();
  await yt.actions.execute(liked ? '/like/like' : '/like/removelike', { target: { videoId }, client: 'YTMUSIC' });
}

export interface LibraryToggle {
  /** The song is in the account's library now. */
  saved: boolean;
  addToken: string | null;
  removeToken: string | null;
}

const feedbackToken = (endpoint: unknown): string | null => {
  const token = ((endpoint as Raw | undefined)?.feedbackEndpoint as Raw | undefined)?.feedbackToken;
  return typeof token === 'string' ? token : null;
};

/**
 * Whether a song is saved in the library, and the two feedback tokens that flip it: YouTube Music's own menu for the
 * song carries them in a toggle whose icon says which way it stands (LIBRARY_ADD, or LIBRARY_SAVED / LIBRARY_REMOVE
 * once it is in).
 */
export async function fetchLibraryToggle(videoId: string): Promise<LibraryToggle> {
  const yt = await getSignedInnertube();
  const response = await yt.actions.execute('/next', { videoId, client: 'YTMUSIC' });
  const panel = collect(response.data, 'playlistPanelVideoRenderer').find((row) => row.videoId === videoId);
  for (const toggle of collect(panel?.menu, 'toggleMenuServiceItemRenderer')) {
    const icon = String((toggle.defaultIcon as Raw | undefined)?.iconType ?? '');
    if (!/^(LIBRARY_|BOOKMARK)/.test(icon)) continue;
    // Saved is the icon that offers to take it out: LIBRARY_SAVED / LIBRARY_REMOVE, or the filled BOOKMARK.
    const saved = icon !== 'LIBRARY_ADD' && icon !== 'BOOKMARK_BORDER';
    const first = feedbackToken(toggle.defaultServiceEndpoint);
    const second = feedbackToken(toggle.toggledServiceEndpoint);
    return { saved, addToken: saved ? second : first, removeToken: saved ? first : second };
  }
  return { saved: false, addToken: null, removeToken: null };
}

/** Sends a feedback token (a library toggle, "Not interested", "Don't recommend artist") to YouTube Music as the account. */
export async function sendLibraryFeedback(token: string): Promise<void> {
  const yt = await getSignedInnertube();
  const response = await yt.actions.execute('/feedback', { feedbackTokens: [token], client: 'YTMUSIC' });
  // YouTube answers 200 either way; the verdict is in the body.
  const processed = (response.data as { feedbackResponses?: { isProcessed?: boolean }[] } | undefined)?.feedbackResponses;
  if (processed && processed.some((r) => r.isProcessed === false)) throw new Error('YouTube Music did not process the feedback');
}

/** Adds an album or playlist to the library, or removes it: YouTube saves both by liking the list. */
export async function setListSaved(playlistId: string, saved: boolean): Promise<void> {
  const yt = await getSignedInnertube();
  await yt.actions.execute(saved ? '/like/like' : '/like/removelike', { target: { playlistId }, client: 'YTMUSIC' });
}

export interface PlaylistOption {
  playlistId: string;
  title: string;
}

/**
 * The playlists a track can be added to, as YouTube Music's "Save to
 * playlist" lists them. YouTube doesn't say which already hold the track
 * (adding is deduplicated instead), and its "Liked Music" entry is really a
 * like, which Favorite already does, so it's left out.
 */
export async function fetchPlaylistOptions(videoId: string): Promise<PlaylistOption[]> {
  const yt = await getSignedInnertube();
  const response = await yt.actions.execute('/playlist/get_add_to_playlist', { videoIds: [videoId], client: 'YTMUSIC' });
  return collect(response.data, 'playlistAddToOptionRenderer')
    .map((option) => ({
      playlistId: typeof option.playlistId === 'string' ? option.playlistId : '',
      title: runsText(option.title),
    }))
    .filter((option) => option.playlistId && option.playlistId !== LIKED_MUSIC_PLAYLIST && option.title);
}

export async function addToPlaylist(playlistId: string, videoId: string): Promise<void> {
  const yt = await getSignedInnertube();
  await yt.actions.execute('/browse/edit_playlist', {
    playlistId: playlistId.replace(/^VL/, ''),
    actions: [{ action: 'ACTION_ADD_VIDEO', addedVideoId: videoId, dedupeOption: 'DEDUPE_OPTION_SKIP' }],
    client: 'YTMUSIC',
  });
}

/** Adds a whole list's songs to a playlist in one edit; ones it already holds are skipped. */
export async function addTracksToPlaylist(playlistId: string, videoIds: string[]): Promise<void> {
  if (!videoIds.length) return;
  const yt = await getSignedInnertube();
  await yt.actions.execute('/browse/edit_playlist', {
    playlistId: playlistId.replace(/^VL/, ''),
    actions: videoIds.map((addedVideoId) => ({ action: 'ACTION_ADD_VIDEO', addedVideoId, dedupeOption: 'DEDUPE_OPTION_SKIP' })),
    client: 'YTMUSIC',
  });
}

export interface SongCredits {
  /** "Performed by", "Written by", "Music metadata provided by" … each with the names under it. */
  sections: { role: string; names: string[] }[];
}

/** One id's credits, from the page YouTube Music's "Show song credits" opens (browse id MPTC + the video's). */
async function creditsOf(yt: Awaited<ReturnType<typeof getInnertube>>, videoId: string): Promise<SongCredits> {
  const response = await yt.actions.execute('/browse', { browseId: `MPTC${videoId}`, client: 'YTMUSIC' });
  const sections = collect(response.data, 'dismissableDialogContentSectionRenderer')
    .map((section) => ({
      role: runsText(section.title),
      names: runsText(section.subtitle)
        .split('\n')
        .map((name) => name.trim())
        .filter(Boolean),
    }))
    .filter((section) => section.role && section.names.length);
  return { sections };
}

/**
 * A song's credits. They belong to the song's own recording, which an album listing the music video doesn't carry, so
 * when the track's own id has none, the song it is the video of is looked for by name and length.
 */
export async function fetchCredits(track: { videoId: string; title: string; artist: string; seconds: number }): Promise<SongCredits> {
  const yt = await getInnertube();
  const own = await creditsOf(yt, track.videoId);
  if (own.sections.length || !track.title) return own;
  const found = await yt.music.search(`${track.artist} ${track.title}`.trim(), { type: 'song' });
  const items = ((found.contents ?? []) as unknown as { contents?: Raw[] }[]).flatMap((shelf) => shelf.contents ?? []);
  const want = titleKey(track.title);
  const wantArtist = normalizedArtistName(track.artist);
  const song = items.find((item) => {
    if (!item.id || item.id === track.videoId || titleKey(String(item.title ?? '')) !== want) return false;
    const length = Number((item.duration as { seconds?: number } | undefined)?.seconds ?? 0);
    if (track.seconds && length && Math.abs(length - track.seconds) > 15) return false;
    const names = [...((item.artists as { name?: string }[] | undefined) ?? []), ...((item.authors as { name?: string }[] | undefined) ?? [])].map((a) => normalizedArtistName(a.name ?? ''));
    return !wantArtist || names.some((name) => name === wantArtist || name.includes(wantArtist) || wantArtist.includes(name));
  });
  return song ? creditsOf(yt, String(song.id)) : own;
}

/**
 * A new private playlist holding [videoIds], as YtMusicRepository.createPlaylist
 * makes one (InnerTube `playlist/create`). Returns its id, without the VL.
 */
export async function createPlaylist(title: string, videoIds: string[], description = ''): Promise<string> {
  const yt = await getSignedInnertube();
  const response = await yt.actions.execute('/playlist/create', {
    title,
    description,
    privacyStatus: 'PRIVATE',
    videoIds,
    client: 'YTMUSIC',
  });
  const id = (response.data as { playlistId?: string } | undefined)?.playlistId;
  if (!id) throw new Error('YouTube Music did not make the playlist');
  return id;
}

// ---- Editing your own playlists ----------------------------------------------------

interface PlaylistRow {
  videoId: string;
  setVideoId: string;
}

/** The continuation token of a raw browse response, when there is another page. */
function continuationOf(data: unknown): string | null {
  const next = collect(data, 'nextContinuationData')[0]?.continuation;
  if (typeof next === 'string') return next;
  const command = collect(data, 'continuationCommand')[0]?.token;
  return typeof command === 'string' ? command : null;
}

/**
 * Every row of a playlist with the id YouTube names it by inside that playlist
 * (`playlistSetVideoId`), in order. The parsed nodes don't keep it, so the
 * raw response is read, page by page.
 */
async function playlistRows(playlistId: string): Promise<PlaylistRow[]> {
  const yt = await getSignedInnertube();
  const rows: PlaylistRow[] = [];
  let response = await yt.actions.execute('/browse', { browseId: `VL${playlistId.replace(/^VL/, '')}`, client: 'YTMUSIC' });
  for (let page = 0; page < 60; page++) {
    for (const item of collect(response.data, 'musicResponsiveListItemRenderer')) {
      const data = item.playlistItemData as { videoId?: string; playlistSetVideoId?: string } | undefined;
      if (data?.videoId && data.playlistSetVideoId) rows.push({ videoId: data.videoId, setVideoId: data.playlistSetVideoId });
    }
    const token = continuationOf(response.data);
    if (!token) break;
    response = await yt.actions.execute('/browse', { continuation: token, client: 'YTMUSIC' });
  }
  return rows;
}

async function editPlaylist(playlistId: string, actions: Raw[]): Promise<void> {
  const yt = await getSignedInnertube();
  await yt.actions.execute('/browse/edit_playlist', { playlistId: playlistId.replace(/^VL/, ''), actions, client: 'YTMUSIC' });
}

/** The row at [index] when it is [videoId] (the list on screen is the playlist in order), else the first row of that song. */
function rowAt(rows: PlaylistRow[], videoId: string, index: number): PlaylistRow {
  const row = rows[index]?.videoId === videoId ? rows[index] : rows.find((r) => r.videoId === videoId);
  if (!row) throw new Error('That song is no longer in the playlist');
  return row;
}

export async function removeFromPlaylist(playlistId: string, videoId: string, index: number): Promise<void> {
  const row = rowAt(await playlistRows(playlistId), videoId, index);
  await editPlaylist(playlistId, [{ action: 'ACTION_REMOVE_VIDEO', removedVideoId: row.videoId, setVideoId: row.setVideoId }]);
}

/** Moves the song at [from] to sit at [to] (both positions in the playlist as listed). */
export async function moveInPlaylist(playlistId: string, videoId: string, from: number, to: number): Promise<void> {
  if (from === to) return;
  const rows = await playlistRows(playlistId);
  const moved = rowAt(rows, videoId, from);
  const target = rows[Math.max(0, Math.min(to, rows.length - 1))];
  if (!target) return;
  await editPlaylist(
    playlistId,
    to < from
      ? [{ action: 'ACTION_MOVE_VIDEO_BEFORE', setVideoId: moved.setVideoId, movedSetVideoIdSuccessor: target.setVideoId }]
      : [{ action: 'ACTION_MOVE_VIDEO_AFTER', setVideoId: moved.setVideoId, movedSetVideoIdPredecessor: target.setVideoId }],
  );
}

export async function renamePlaylist(playlistId: string, name: string): Promise<void> {
  await editPlaylist(playlistId, [{ action: 'ACTION_SET_PLAYLIST_NAME', playlistName: name }]);
}

export async function deletePlaylist(playlistId: string): Promise<void> {
  const yt = await getSignedInnertube();
  await yt.actions.execute('/playlist/delete', { playlistId: playlistId.replace(/^VL/, ''), client: 'YTMUSIC' });
}

// ---- AutoPlay (phase 6) -------------------------------------------------------------

/**
 * A music video rather than the catalogue song: YouTube marks each watch
 * endpoint with its type, ATV for the song and OMV/UGC for videos. (A radio
 * seeded on a video id is all videos; one seeded on a song is mostly songs.)
 */
function isMusicVideo(item: YTNodes.PlaylistPanelVideo): boolean {
  const type = (item.endpoint?.payload as { watchEndpointMusicSupportedConfigs?: { watchEndpointMusicConfig?: { musicVideoType?: string } } } | undefined)
    ?.watchEndpointMusicSupportedConfigs?.watchEndpointMusicConfig?.musicVideoType;
  return type !== undefined ? type !== 'MUSIC_VIDEO_TYPE_ATV' : !item.album;
}

/** A station, and which cut it was seeded on: a music video's station is built from music videos. */
export interface Radio {
  candidates: Candidate[];
  /** [videoId] is itself a music video, not the catalogue song. */
  seedIsVideo: boolean;
}

/**
 * The radio YouTube Music would play after [videoId]: its "RDAMVM" mix, as
 * Innertube.next asks for it on the phone. Signed in it's the user's own
 * station.
 *
 * Most rows carry both cuts of a track, and which one is taken follows what
 * is playing: a music video's station stays on music videos, a song's on the
 * catalogue cuts. The seed's own row says which of the two it is.
 */
export async function fetchRadio(videoId: string): Promise<Radio> {
  const yt = await getMusicClient();
  const panel = await yt.music.getUpNext(videoId, true);
  const rows = panel.contents as unknown as Raw[];
  const seedCut = rows.flatMap(panelCuts).find((cut) => cut.video_id === videoId);
  const seedIsVideo = seedCut ? isMusicVideo(seedCut) : false;
  return {
    candidates: rows.map((raw) => panelCandidate(raw, seedIsVideo)).filter((c): c is Candidate => c !== null),
    seedIsVideo,
  };
}

/**
 * A watch-queue row's cuts. A wrapper pairs the two cuts of one track (song
 * and music video), with either as its primary.
 */
function panelCuts(raw: Raw): YTNodes.PlaylistPanelVideo[] {
  const cuts = (raw.type === 'PlaylistPanelVideoWrapper'
    ? [raw.primary, ...((raw.counterpart as unknown[] | undefined) ?? [])]
    : [raw]) as (YTNodes.PlaylistPanelVideo | null | undefined)[];
  return cuts.filter((c): c is YTNodes.PlaylistPanelVideo => c?.type === 'PlaylistPanelVideo');
}

/** One watch-queue row as a track: the catalogue song (the cut with an album), or its music video for [wantVideo]. */
function panelCandidate(raw: Raw, wantVideo = false): Candidate | null {
  const panelVideos = panelCuts(raw);
  const item = panelVideos.find((c) => isMusicVideo(c) === wantVideo) ?? panelVideos[0];
  if (!item?.video_id) return null;
  const thumbs = [...(item.thumbnail ?? [])].sort((a, b) => b.width - a.width);
  return {
    track: {
      videoId: item.video_id,
      title: item.title?.toString() ?? '',
      artists: (item.artists ?? []).map((a) => ({ name: a.name, id: a.channel_id ?? null })),
      album: item.album ? { name: item.album.name, id: item.album.id ?? null } : null,
      durationSec: item.duration?.seconds || null,
      explicit: (item.badges ?? []).some((b) => /explicit/i.test(JSON.stringify(b))),
      thumbnail: thumbs[0]?.url ?? null,
      index: null,
      plays: null,
    },
    isVideo: isMusicVideo(item),
  };
}

// ---- Player links ---------------------------------------------------------------

/**
 * The album and artist pages a track links out to (YtMusicRepository.trackLinks).
 * Queue rows from home cards often lack them; the track's own watch-queue
 * entry always names both.
 */
export async function fetchTrackLinks(videoId: string): Promise<Track | null> {
  const yt = await getMusicClient();
  const panel = await yt.music.getUpNext(videoId, false);
  // The row holding this video, by either of its cuts; its catalogue cut names the album.
  const row = (panel.contents as unknown as Raw[]).find((raw) => panelCuts(raw).some((cut) => cut.video_id === videoId));
  return (row && panelCandidate(row)?.track) ?? null;
}

/**
 * The page of the artist called exactly [name] (YtMusicRepository.findArtistPageId):
 * a name is not an identity, so only a result that answers to it exactly is
 * opened, never the nearest one.
 */
export async function findArtistPageId(name: string): Promise<string | null> {
  if (!normalizedArtistName(name)) return null;
  const results = await fetchSearch(name);
  return [...results.top, ...results.artists].find((item) => item.kind === 'artist' && isExactArtistMatch(item.title, name))?.id ?? null;
}

// ---- Song and video cuts ------------------------------------------------------------

export interface Cuts {
  song: Track | null;
  video: Track | null;
  /** "146M views", for the music video when YouTube Music says. */
  videoViews: string | null;
}

/** Lowercase, accents, brackets and punctuation dropped: "Monster (Official MV)" is "monster". */
function titleKey(text: string): string {
  return text
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\(.*?\)|\[.*?\]/g, ' ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

// Uploads that share a song's name but are not its video.
const NOT_THE_VIDEO = /lyric|karaoke|cover|reaction|loop|hours|slowed|sped up|nightcore|instrumental|practice|fancam|mashup|8d|türkçe|turkce|subtitle|sub indo|ringtone|choreo|teaser|trailer|behind|making|highlight|mirrored|reverb|in public|one take|inkigayo|music bank|m countdown|show champion|the show|music core/i;
/** Cuts of the song that are real but are not the music video: kept as a last resort, ranked below it. */
const NOT_THE_MV = /perform|dance|stage|live|session|visualizer|audio|official art|concept|film/i;

interface VideoHit {
  track: Track;
  views: string | null;
}

/** The words a music video's title adds to the song's: "Official MV", "(Official Music Video)", "[4K]". */
const VIDEO_TAGS = /official|music video|m\/v|\bmv\b|\bhd\b|\b4k\b|\b8k\b|\bvideo\b/g;
const OFFICIAL_MV = /official (mv|m\/v|music video|video)|music video|[( ]m\/v|[( ]mv[) ]|[( ]mv$/i;

/** Like titleKey, but a bracket's words stay and a video's own tags go: "체포하겠어 (You're Under Arrest) Official MV". */
function looseKey(text: string): string {
  return ` ${titleKey(text.replace(/[()\[\]]/g, ' ').replace(VIDEO_TAGS, ' '))} `.replace(/ +/g, ' ');
}

/** How a result's title stands to the song's: the whole title, its start, a part of it, or (a bracketed name) the same; -1 for none. */
function titleScore(name: string, want: string): number {
  const key = titleKey(name);
  if (key === want) return 30;
  if (key.startsWith(want)) return 18;
  if (key.includes(want)) return 6;
  // A Korean or Japanese title carries the English one in brackets: "체포하겠어 (You're Under Arrest)".
  const bracketed = [...name.matchAll(/[(\[]([^)\]]+)[)\]]/g)].map((m) => titleKey(m[1] ?? ''));
  if (bracketed.includes(want)) return 30;
  if (looseKey(name).includes(` ${want} `)) return 6;
  return -1;
}

/**
 * Of a video search's results, the music video that belongs to a song: the result whose title is the song's, of about
 * its length, uploaded by the artist (or, for an "Official MV" with the song's name in full, by their label), and not
 * a cover, a lyric video, a stage or a loop. Null when none is good enough.
 */
export function pickVideo(items: Raw[], title: string, artist: string, seconds: number, knownId?: string): { item: Raw; score: number } | null {
  const want = titleKey(title);
  const wantArtist = normalizedArtistName(artist);
  let best: { item: Raw; score: number } | null = null;
  for (const item of items) {
    const id = String(item.id);
    if (knownId) {
      if (id === knownId) best = { item, score: 1 };
      continue;
    }
    const name = String(item.title ?? (item.title as { toString(): string } | undefined)?.toString?.() ?? '');
    if (!want || !titleKey(name) || (NOT_THE_VIDEO.test(name) && !NOT_THE_VIDEO.test(title))) continue;
    const match = titleScore(name, want);
    if (match < 0) continue;
    let score = match;
    const length = Number((item.duration as { seconds?: number } | undefined)?.seconds ?? 0);
    const off = seconds && length ? Math.abs(length - seconds) : Infinity;
    if (off !== Infinity) score += off <= 10 ? 20 : off <= 30 ? 6 : -20;
    const authors = ((item.authors as { name?: string }[] | undefined) ?? []).map((a) => normalizedArtistName(a.name ?? ''));
    // The song's artist (or a channel named for them) uploaded it; a label's or a group's channel may carry a member's
    // song, so that case needs the title exact and the length within a few seconds as well.
    const byArtist = !!wantArtist && authors.some((a) => a === wantArtist || a.includes(wantArtist) || wantArtist.includes(a));
    const official = OFFICIAL_MV.test(name);
    if (byArtist) score += 10;
    else if (!(match >= 30 && off <= (official ? 12 : 4))) continue;
    if (official) score += 14;
    if (NOT_THE_MV.test(name) && !NOT_THE_MV.test(title)) score -= 12;
    // More watched is more likely the original: only a tie-breaker.
    const viewCount = Number(String(item.views ?? '').replace(/[^0-9.]/g, '')) || 0;
    score += Math.min(4, Math.log10(1 + viewCount) / 2);
    if (score >= 25 && (!best || score > best.score)) best = { item, score };
  }
  return best;
}

/**
 * The music video that belongs to a song YouTube Music didn't pair: a video search on "artist title", then pickVideo.
 * A song with no such result has no video here. [knownId] only looks that video's views up.
 */
async function findVideo(yt: Awaited<ReturnType<typeof getMusicClient>>, title: string, artist: string, seconds: number, knownId?: string): Promise<VideoHit | null> {
  const found = await yt.music.search(`${artist} ${title}`.trim(), { type: 'video' });
  const items = ((found.contents ?? []) as unknown as { contents?: Raw[] }[]).flatMap((shelf) => shelf.contents ?? []).filter((i) => i.item_type === 'video' && i.id);
  const best = pickVideo(items, title, artist, seconds, knownId);
  if (!best) return null;
  const item = best.item;
  const thumbs = [...((item.thumbnail as { contents?: { url: string; width: number }[] } | undefined)?.contents ?? [])].sort((a, b) => b.width - a.width);
  return {
    views: typeof item.views === 'string' && item.views.trim() ? item.views.trim() : null,
    track: {
      videoId: String(item.id),
      title: String(item.title ?? title),
      artists: ((item.authors as { name?: string; channel_id?: string }[] | undefined) ?? []).map((a) => ({ name: a.name ?? '', id: a.channel_id ?? null })),
      album: null,
      durationSec: Number((item.duration as { seconds?: number } | undefined)?.seconds ?? 0) || null,
      explicit: false,
      thumbnail: thumbs[0]?.url ?? null,
      index: null,
      plays: null,
    },
  };
}

/**
 * The two cuts of a track (the catalogue song and its music video). YouTube Music pairs most of them itself; the rest
 * are matched by searching for the video, so any song with a music video can switch to it.
 */
export async function fetchCuts(videoId: string): Promise<Cuts> {
  const yt = await getMusicClient();
  const panel = await yt.music.getUpNext(videoId, false);
  const row = (panel.contents as unknown as Raw[]).find((raw) => panelCuts(raw).some((cut) => cut.video_id === videoId));
  const paired = row ? panelCandidate(row, true) : null;
  const pairedSong = row ? panelCandidate(row, false) : null;
  let video = paired?.isVideo ? paired.track : null;
  let song = pairedSong && !pairedSong.isVideo ? pairedSong.track : null;

  const seed = row ? panelCuts(row).find((cut) => cut.video_id === videoId) : undefined;
  const title = seed?.title?.toString() ?? '';
  const artist = seed?.artists?.[0]?.name ?? '';
  const seconds = seed?.duration?.seconds ?? 0;
  let videoViews: string | null = null;
  if (title) {
    try {
      const hit = await findVideo(yt, title, artist, seconds, video?.videoId ?? (seed && isMusicVideo(seed) ? videoId : undefined));
      if (hit) {
        videoViews = hit.views;
        video ??= hit.track;
      }
    } catch {
      // the search failing leaves whatever YouTube Music paired
    }
  }
  if (!song && seed && !isMusicVideo(seed)) song = panelCandidate(row!, false)?.track ?? null;
  return { song, video, videoViews };
}

// ---- Comments -------------------------------------------------------------------------

export interface CommentItem {
  id: string;
  author: string;
  avatar: string | null;
  text: string;
  published: string;
  likes: string;
  /** "663", or '' when there are none. */
  replies: string;
  pinned: boolean;
  byCreator: boolean;
  /** Reads this comment's replies, a batch at a time; null when it has none. */
  loadReplies: (() => Promise<RepliesPage>) | null;
}

export interface RepliesPage {
  replies: CommentItem[];
  next: (() => Promise<RepliesPage>) | null;
}

export interface CommentsPage {
  comments: CommentItem[];
  /** "1,234 Comments", from the first page's header. */
  total: string | null;
  next: (() => Promise<CommentsPage>) | null;
}

export type CommentSort = 'TOP_COMMENTS' | 'NEWEST_FIRST';

interface ThreadLike {
  comment?: Raw | null;
  has_replies?: boolean;
  replies?: unknown;
  has_continuation?: boolean;
  getReplies(): Promise<ThreadLike>;
  getContinuation(): Promise<{ replies: unknown; has_continuation: boolean; getContinuation(): Promise<unknown> }>;
}

function commentOf(thread: ThreadLike): CommentItem | null {
  const comment = thread.comment;
  if (!comment) return null;
  const author = comment.author as { name?: string; thumbnails?: { url: string }[] } | undefined;
  const content = String(comment.content ?? '').trim();
  if (!content) return null;
  const strip = (value: unknown) => (typeof value === 'string' && value !== '0' ? value : '');
  return {
    id: String(comment.comment_id ?? `${author?.name}-${content.slice(0, 24)}`),
    author: (author?.name ?? '').replace(/^@/, '') || 'Unknown',
    avatar: (comment.creator_thumbnail_url as string | undefined) ?? author?.thumbnails?.[0]?.url ?? null,
    text: content,
    published: String(comment.published_time ?? ''),
    likes: strip(comment.like_count),
    replies: strip(comment.reply_count),
    pinned: comment.is_pinned === true,
    byCreator: comment.author_is_channel_owner === true,
    loadReplies: thread.has_replies || strip(comment.reply_count) ? () => repliesOf(thread) : null,
  };
}

function repliesFrom(threads: unknown): CommentItem[] {
  return [...((threads as ThreadLike[] | undefined) ?? [])].map(commentOf).filter((c): c is CommentItem => c !== null);
}

/** The first batch of a thread's replies; the batches after it come from the continuation. */
async function repliesOf(thread: ThreadLike): Promise<RepliesPage> {
  const loaded = await thread.getReplies();
  const page = (batch: { replies?: unknown; has_continuation?: boolean; getContinuation(): Promise<unknown> }): RepliesPage => ({
    replies: repliesFrom(batch.replies),
    next: batch.has_continuation ? async () => page((await batch.getContinuation()) as Parameters<typeof page>[0]) : null,
  });
  return page(loaded as unknown as Parameters<typeof page>[0]);
}

function commentsPage(source: { contents: unknown; has_continuation: boolean; getContinuation(): Promise<unknown> }, total: string | null): CommentsPage {
  return {
    comments: repliesFrom(source.contents),
    total,
    next: source.has_continuation
      ? async () => commentsPage((await source.getContinuation()) as Parameters<typeof commentsPage>[0], total)
      : null,
  };
}

/** A video's comments, signed out is fine: YouTube serves them to anyone. */
export async function fetchComments(videoId: string, sort: CommentSort): Promise<CommentsPage> {
  const yt = await getInnertube();
  const comments = await yt.getComments(videoId, sort);
  const count = (comments.header as { comments_count?: { toString(): string } } | undefined)?.comments_count?.toString().trim();
  return commentsPage(comments as unknown as Parameters<typeof commentsPage>[0], count ? count : null);
}
