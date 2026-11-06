import { Search, X } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'react-router';
import { DetailHeader } from '@/components/music/DetailHeader';
import { ListMenu } from '@/components/music/ListMenu';
import { playList, shuffleList } from '@/components/music/play';
import { LoadError, LoadMoreError, NeedsExtension } from '@/components/music/States';
import { TrackList } from '@/components/music/TrackList';
import { PlaylistEditBar } from '@/components/music/PlaylistEditBar';
import { useLibraryPlaylists, usePlaylist, useSignedIn, useYouTubeReady } from '@/data/music/queries';
import { useArtworkColor } from '@/lib/artworkColor';
import { usePageTint } from '@/lib/usePageTint';
import { PlaylistSkeleton } from '@/skeletons/PageSkeletons';
import { detailFooter } from './pageStyles';

/** A playlist (report §14): header, then the artwork track list, loading on as you scroll. */
export default function PlaylistPage() {
  const id = decodeURIComponent(useParams().id ?? '');
  const { missing } = useYouTubeReady();
  const signedIn = useSignedIn();
  const libraryPlaylists = useLibraryPlaylists();
  const playlist = usePlaylist(id);
  const header = playlist.data?.pages[0]?.header ?? null;
  usePageTint(useArtworkColor(header?.thumbnail));

  const { hasNextPage, isFetchingNextPage, isFetchNextPageError, fetchNextPage } = playlist;
  // Find in Playlist: a field over the list; while it is open the whole playlist is loaded, so the search sees every song.
  const [finding, setFinding] = useState(false);
  const [needle, setNeedle] = useState('');
  useEffect(() => {
    if (finding && hasNextPage && !isFetchingNextPage && !isFetchNextPageError) void fetchNextPage();
  }, [finding, hasNextPage, isFetchingNextPage, isFetchNextPageError, fetchNextPage]);
  const onNearEnd = useCallback(() => {
    if (hasNextPage && !isFetchingNextPage && !isFetchNextPageError) void fetchNextPage();
  }, [hasNextPage, isFetchingNextPage, isFetchNextPageError, fetchNextPage]);

  if (missing) return <NeedsExtension />;
  if (playlist.isError && !playlist.data) return <LoadError error={playlist.error} onRetry={() => void playlist.refetch()} />;
  if (!playlist.data || !header) return <PlaylistSkeleton />;

  const tracks = playlist.data.pages.flatMap((page) => page.tracks);
  const query = finding ? needle.trim().toLowerCase() : '';
  const shown = query
    ? tracks.filter((t) => [t.title, t.album?.name ?? '', ...t.artists.map((a) => a.name)].some((text) => text.toLowerCase().includes(query)))
    : tracks;
  // YouTube marks an account's own playlist with an editable header; failing that, a playlist in the library with
  // no "save to library" toggle (which only other people's lists have) is the account's own.
  const bare = id.replace(/^VL/, '');
  const inLibrary = libraryPlaylists.data?.some((item) => 'id' in item && String(item.id).replace(/^VL/, '') === bare) ?? false;
  const editable = signedIn && (header.editable === true || (inLibrary && header.library === null));
  const context = { source: { title: header.title, type: 'playlist' as const, id } };
  return (
    <>
      <DetailHeader
        info={header}
        canPlay={tracks.length > 0}
        onPlay={() => playList(tracks, 0, context)}
        onShuffle={() => shuffleList(tracks, context)}
        extra={
          <ListMenu
            tracks={tracks}
            context={context}
            link={`https://music.youtube.com/playlist?list=${bare}`}
            pin={{ kind: 'playlist', id, title: header.title, subtitle: header.subtitle, artists: header.artists, album: null, thumbnail: header.thumbnail, wide: false, durationSec: null, explicit: false }}
            onFind={() => setFinding(true)}
          />
        }
      />
      {editable && <PlaylistEditBar playlistId={id} title={header.title} />}
      {finding && (
        <div className="mx-(--body-gutter) mb-3 flex items-center gap-2 rounded-pill bg-quinary px-3 py-1.5">
          <Search size={15} className="text-secondary" aria-hidden="true" />
          <input
            className="min-w-0 flex-1 bg-transparent type-body text-primary outline-none placeholder:text-tertiary"
            value={needle}
            autoFocus
            placeholder="Find in Playlist"
            aria-label="Find in Playlist"
            onChange={(event) => setNeedle(event.target.value)}
            onKeyDown={(event) => event.key === 'Escape' && (setFinding(false), setNeedle(''))}
          />
          {query && <span className="type-callout text-secondary">{shown.length} of {tracks.length}</span>}
          <button className="grid size-6 place-items-center rounded-full text-secondary hover:bg-quaternary" aria-label="Close search" onClick={() => (setFinding(false), setNeedle(''))}>
            <X size={14} />
          </button>
        </div>
      )}
      {/* Rows move and remove by their place in the playlist, which a filtered list has lost: editing waits for the search to close. */}
      <TrackList tracks={shown} variant="playlist" onNearEnd={onNearEnd} source={context.source} editPlaylistId={editable && !query ? id : undefined} />
      {query && shown.length === 0 && <p className="mx-(--body-gutter) py-6 type-callout text-secondary">No songs match “{needle.trim()}”.</p>}
      {isFetchingNextPage && <div className="flex justify-center py-5 type-callout text-secondary">Loading more songs…</div>}
      {playlist.isFetchNextPageError && <LoadMoreError onRetry={() => void fetchNextPage()} />}
      <footer className={detailFooter}>
        <p>{header.meta}</p>
      </footer>
    </>
  );
}
