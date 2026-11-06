import { useParams } from 'react-router';
import { DetailHeader } from '@/components/music/DetailHeader';
import { ListMenu } from '@/components/music/ListMenu';
import { playList, shuffleList } from '@/components/music/play';
import { Shelves } from '@/components/music/ShelfView';
import { LoadError, NeedsExtension } from '@/components/music/States';
import { TrackList } from '@/components/music/TrackList';
import { useAppleAlbum } from '@/data/apple/albumColors';
import { useAlbumMotion } from '@/data/apple/motionArt';
import { useAlbum, useArtist, useYouTubeReady } from '@/data/music/queries';
import type { AlbumPage as AlbumData, Shelf } from '@/data/music/types';
import { useArtworkColor } from '@/lib/artworkColor';
import { usePageTint } from '@/lib/usePageTint';
import { AlbumSkeleton } from '@/skeletons/PageSkeletons';
import { detailFooter } from './pageStyles';

/**
 * Apple's three shelves under an album, from what YouTube Music has: "More By <artist>" (the artist's albums, singles and
 * EPs, minus this one), "Featured On" (the playlists the artist is on), and "You Might Also Like" (YouTube's own picks
 * for the album); anything else YouTube adds under the album stays at the end.
 */
function albumShelves(album: AlbumData, artistShelves: Shelf[]): Shelf[] {
  const artist = album.artists[0]?.name ?? '';
  const same = (title: string) => title.trim().toLowerCase() === album.title.trim().toLowerCase();
  const releases = artistShelves
    .filter((shelf) => /^(albums|singles)/i.test(shelf.title))
    .flatMap((shelf) => shelf.items)
    .filter((item) => item.id !== album.id && !same(item.title));
  const out: Shelf[] = [];
  if (releases.length) out.push({ title: artist ? `More By ${artist}` : 'More By This Artist', strapline: null, layout: 'square', items: releases, seeAll: null });
  const featured = artistShelves.find((shelf) => /^featured on/i.test(shelf.title));
  if (featured) out.push({ ...featured, title: 'Featured On' });
  album.more.forEach((shelf, i) => out.push(i === 0 && /releases for you|you might/i.test(shelf.title) ? { ...shelf, title: 'You Might Also Like' } : shelf));
  return out;
}

/** An album (report §3): header, numbered tracks, footer, "more" shelves. */
export default function AlbumPage() {
  const id = decodeURIComponent(useParams().id ?? '');
  const { missing } = useYouTubeReady();
  const album = useAlbum(id);
  // The artist's own page supplies "More By" and "Featured On", as Apple's album page has them.
  const artistPage = useArtist(album.data?.artists[0]?.id ?? '');
  const apple = useAppleAlbum(album.data?.title, album.data?.artists.map((a) => a.name).join(', '));
  const cover = useArtworkColor(album.data?.thumbnail);
  // Apple's hand-picked colour where it has one; the cover's average only once Apple has answered with nothing.
  usePageTint(apple.tint ?? (apple.settled ? cover : null));
  const motion = useAlbumMotion(album.data?.title, album.data?.artists.map((a) => a.name).join(', '));

  if (missing) return <NeedsExtension />;
  if (album.isError) return <LoadError error={album.error} onRetry={() => void album.refetch()} />;
  if (!album.data) return <AlbumSkeleton />;

  const data = album.data;
  const shelves = albumShelves(data, artistPage.data?.shelves ?? []);
  const artists = data.artists.map((a) => a.name).join(', ');
  const tracks = data.tracks;
  // Album tracks carry no artist or artwork of their own; the queue credits the album's.
  const context = {
    source: { title: data.title, type: 'album' as const, id: data.id },
    fallbackArtwork: data.thumbnail,
    fallbackArtists: data.artists,
  };
  return (
    <>
      <DetailHeader
        info={data}
        canPlay={tracks.length > 0}
        motion={motion}
        notes={apple.notes}
        onPlay={() => playList(tracks, 0, context)}
        onShuffle={() => shuffleList(tracks, context)}
        extra={
          <ListMenu
            tracks={tracks}
            context={context}
            link={`https://music.youtube.com/browse/${data.id}`}
            pin={{ kind: 'album', id: data.id, title: data.title, subtitle: data.subtitle, artists: data.artists, album: null, thumbnail: data.thumbnail, wide: false, durationSec: null, explicit: false }}
          />
        }
      />
      <TrackList
        tracks={tracks}
        variant="album"
        fallbackArtwork={data.thumbnail}
        fallbackArtists={data.artists}
        fallbackAlbum={{ name: data.title, id: data.id }}
        source={context.source}
      />
      <footer className={detailFooter}>
        <p>{data.subtitle}</p>
        <p>{data.meta}</p>
        {artists && <p>{artists}</p>}
      </footer>
      {shelves.length > 0 && (
        // "More By" and friends sit on the alternate shelf background (report §3, section--alternate).
        <div className="bg-shelf pb-5">
          <Shelves shelves={shelves} />
        </div>
      )}
    </>
  );
}
