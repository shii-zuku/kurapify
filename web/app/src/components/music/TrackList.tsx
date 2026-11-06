import { useVirtualizer } from '@tanstack/react-virtual';
import { useEffect, useRef, useState } from 'react';
import { PrefetchLink } from '@/components/PrefetchLink';
import { PauseIcon, PlayIcon } from '@/components/icons/Transport';
import type { AlbumRef, ArtistRef, Track } from '@/data/music/types';
import { formatStreams, formatStreamsFull, useStreamCounts } from '@/extension/useStreamCounts';
import { usePlayer } from '@/state/player';
import { ArtistLinks } from './ArtistLink';
import { Artwork } from './Artwork';
import { ExplicitBadge } from './ExplicitBadge';
import { albumHref, artistHref, formatDuration } from './links';
import { playList, playTrack, type ListContext } from './play';
import { TrackMenu } from './TrackMenu';

type Variant = 'album' | 'playlist';

const ROW_HEIGHT: Record<Variant, number> = { album: 46, playlist: 54 };
/** Below this, plain rows: an album or a short playlist gains nothing from virtualizing. */
const VIRTUALIZE_FROM = 80;

interface TrackListProps {
  tracks: Track[];
  variant: Variant;
  /** Album artwork, for rows that have none of their own (album tracks). */
  fallbackArtwork?: string | null;
  /** The album's artists, credited when a track has none of its own. */
  fallbackArtists?: ArtistRef[];
  /** The album these rows are on, for the row menu's Go to Album when a row has none of its own. */
  fallbackAlbum?: AlbumRef | null;
  /** Called when the list nears its end, to load the next page of a long playlist. */
  onNearEnd?: () => void;
  /** Where the list comes from: playing a row queues the list from there. Without it, a row plays alone. */
  source?: ListContext['source'];
  /** The playlist's id when it is the account's own: rows then offer Move and Remove. */
  editPlaylistId?: string | undefined;
}

/* Track lists (report §3 album rows, §14 playlist rows). */

const cell = 'flex h-full min-w-0 items-center';
// 396 / 274 / 274 / 141 at 1440px (report §14).
const playlistColumns = 'grid-cols-[minmax(0,36.5fr)_minmax(0,25.25fr)_minmax(0,25.25fr)_minmax(0,13fr)]';
// The same with a Spotify "Streams" column ahead of the time, where the app can look those up.
const playlistColumnsStreams = 'grid-cols-[minmax(0,34fr)_minmax(0,23fr)_minmax(0,23fr)_minmax(0,10fr)_minmax(0,12fr)]';
// Artist and album: playlists only, and not below 768px.
const secondary = `${cell} pe-2.5 max-md:hidden`;
const tertiary = `${cell} pe-4 max-md:hidden`;
// A row from another catalogue with no YouTube Music song (yet) is dimmed.
const dimmed = 'group-data-unavailable/row:opacity-45';
const link = 'text-inherit hover:underline group-data-current/row:text-primary';

/**
 * A hairline on top of every row, hidden on hover and around the playing row;
 * a fill on hover, a stronger one for the playing row.
 */
const row = [
  'group/row relative grid items-center bg-transparent hover:bg-tracklist-hover data-unavailable:cursor-default',
  'data-current:bg-[color-mix(in_srgb,var(--systemPrimary)_12%,transparent)]',
  'before:pointer-events-none before:absolute before:inset-x-0 before:top-0 before:border-t-[0.5px] before:border-t-divider',
  'hover:before:border-t-transparent data-current:before:border-t-transparent [&:hover+&]:before:border-t-transparent [&[data-current]+&]:before:border-t-transparent',
].join(' ');

function rowVariant(variant: Variant, streams: boolean): string {
  if (variant === 'album') return `h-[46px] ${streams ? 'grid-cols-[minmax(0,1fr)_auto_auto]' : 'grid-cols-[minmax(0,1fr)_auto]'} rounded-row`;
  return `h-[54px] ${streams ? playlistColumnsStreams : playlistColumns} rounded-[12px] max-md:grid-cols-[minmax(0,1fr)_auto]`;
}

function Artists({ artists }: { artists: ArtistRef[] }) {
  return <ArtistLinks artists={artists} className={link} />;
}

const time: Record<Variant, string> = {
  album: 'relative justify-end pe-3 type-body tabular-nums',
  playlist: 'relative justify-end pe-[18px] type-body tabular-nums',
};

interface RowProps {
  track: Track;
  variant: Variant;
  position: number;
  fallbackArtwork: string | null | undefined;
  onPlayRow: () => void;
  /** Whether the list has a Streams column; `count` is this row's Spotify play count (undefined while looked up). */
  showStreams: boolean;
  count: number | null | undefined;
  /** Set on rows of the account's own playlist, with the number of rows in the list. */
  editPlaylistId: string | undefined;
  total: number;
  fallbackArtists: ArtistRef[] | undefined;
  fallbackAlbum: AlbumRef | null | undefined;
}

function Row({ track, variant, position, fallbackArtwork, onPlayRow, showStreams, count, editPlaylistId, total, fallbackArtists, fallbackAlbum }: RowProps) {
  // The row's own credits, else the list's, so its menu can go to the album and the artist.
  const menuTrack =
    track.album && track.artists.length && track.thumbnail
      ? track
      : { ...track, artists: track.artists.length ? track.artists : (fallbackArtists ?? []), album: track.album ?? fallbackAlbum ?? null, thumbnail: track.thumbnail ?? fallbackArtwork ?? null };
  const current = usePlayer((s) => s.nowPlaying?.videoId === track.videoId);
  const playing = usePlayer((s) => s.nowPlaying?.videoId === track.videoId && (s.status === 'playing' || s.status === 'buffering'));
  const togglePlay = usePlayer((s) => s.togglePlay);
  const unavailable = track.unavailable;
  const onPlay = () => (unavailable ? undefined : current ? togglePlay() : onPlayRow());

  return (
    <div
      className={`${row} ${rowVariant(variant, showStreams)}`}
      data-variant={variant}
      data-current={current || undefined}
      data-unavailable={unavailable}
      title={unavailable === 'matching' ? 'Looking for this on YouTube Music…' : unavailable === 'missing' ? 'Not found on YouTube Music' : undefined}
      onDoubleClick={onPlay}
    >
      <div className={`${cell} gap-3`}>
        <div className={`relative grid w-10 shrink-0 place-items-center${variant === 'playlist' ? ' ms-[7px]' : ''}`}>
          {variant === 'playlist' ? (
            <>
              <Artwork src={track.thumbnail ?? fallbackArtwork ?? null} displayWidth={40} radius="var(--radius-artwork-small)" />
              {current && (
                // The playing row's marker: a still play glyph over the artwork (or where the number was).
                <span
                  className="absolute inset-0 grid place-items-center rounded-artwork-sm bg-[rgb(0_0_0/0.45)] text-white group-hover/row:invisible"
                  aria-label="Now playing"
                >
                  <PlayIcon size={18} />
                </span>
              )}
            </>
          ) : (
            <span className="type-body text-secondary group-hover/row:invisible">
              {current ? (
                <span className="grid place-items-center text-primary group-hover/row:invisible" aria-label="Now playing">
                  <PlayIcon size={14} />
                </span>
              ) : (
                (track.index ?? position)
              )}
            </span>
          )}
          <button
            className={`absolute inset-0 grid place-items-center rounded-artwork-sm opacity-0 group-hover/row:opacity-100 focus-visible:opacity-100 group-data-unavailable/row:hidden ${
              variant === 'playlist' ? 'bg-lockup-hover text-white' : 'text-primary'
            }`}
            aria-label={playing ? `Pause ${track.title}` : `Play ${track.title}`}
            onClick={onPlay}
            disabled={!!unavailable}
          >
            {playing ? <PauseIcon size={variant === 'playlist' ? 18 : 16} /> : <PlayIcon size={variant === 'playlist' ? 18 : 16} />}
          </button>
        </div>
        <div
          className={`flex min-w-0 flex-col ${dimmed} group-data-[unavailable=matching]/row:animate-matching motion-reduce:group-data-[unavailable=matching]/row:animate-none`}
        >
          <div className="flex min-w-0 items-center">
            <span className="truncate type-body text-primary">{track.title}</span>
            {track.explicit && <ExplicitBadge />}
          </div>
          {variant === 'album' && track.artists.length > 0 && (
            <div className="truncate type-callout">
              <Artists artists={track.artists} />
            </div>
          )}
        </div>
      </div>
      {variant === 'playlist' && (
        <>
          <div className={`${secondary} ${dimmed}`}>
            <span className="truncate type-body">
              <Artists artists={track.artists} />
            </span>
          </div>
          <div className={`${tertiary} ${dimmed}`}>
            <span className="truncate type-body">
              {track.album &&
                (albumHref(track.album.id) ? (
                  <PrefetchLink to={albumHref(track.album.id)!} className={link}>
                    {track.album.name}
                  </PrefetchLink>
                ) : (
                  track.album.name
                ))}
            </span>
          </div>
        </>
      )}
      {showStreams && (
        <div className={`${cell} justify-end ${variant === 'album' ? 'pe-3' : 'pe-2.5 max-md:hidden'} type-body tabular-nums ${dimmed}`}>
          {count ? <span title={formatStreamsFull(count)}>{formatStreams(count)}</span> : null}
        </div>
      )}
      <div className={`${cell} ${time[variant]} ${dimmed}`}>
        {/* The ⋯ button (TrackMenu) takes the time's place on hover, as Apple's rows do. */}
        <span className={unavailable ? undefined : 'group-focus-within/row:invisible group-hover/row:invisible group-has-[[data-open]]/row:invisible'}>
          {unavailable === 'missing' ? 'Not found' : formatDuration(track.durationSec)}
        </span>
        {!unavailable && (
          <TrackMenu
            track={menuTrack}
            edit={editPlaylistId ? { playlistId: editPlaylistId, index: position - 1, count: total } : undefined}
            className="absolute end-2.5 hidden size-7 place-items-center rounded-full text-key group-focus-within/row:grid group-hover/row:grid hover:bg-quinary data-open:grid"
          />
        )}
      </div>
    </div>
  );
}

function Header({ showStreams }: { showStreams: boolean }) {
  return (
    <div
      className={`grid h-8 items-center ${showStreams ? playlistColumnsStreams : playlistColumns} type-callout-emphasized text-secondary max-md:hidden`}
      aria-hidden="true"
    >
      <div className={`${cell} gap-3 ps-[7px]`}>Song</div>
      <div className={secondary}>Artist</div>
      <div className={tertiary}>Album</div>
      {showStreams && <div className={`${cell} justify-end pe-2.5`}>Streams</div>}
      <div className={`${cell} ${time.playlist}`}>Time</div>
    </div>
  );
}

/**
 * Album and playlist track lists (report §3, §14): hairline-divided rows,
 * hover fill, the number (or artwork) turning into a play button. Long lists
 * are virtualized against the page's scroll container (prompt §3).
 */
export function TrackList({ tracks, variant, fallbackArtwork, fallbackArtists, fallbackAlbum, onNearEnd, source, editPlaylistId }: TrackListProps) {
  const playRow = (i: number) => {
    // Rows from another catalogue that found no YouTube Music song stay out of the queue.
    if (source) {
      const playable = tracks.filter((t) => !t.unavailable);
      return playList(playable, Math.max(0, playable.indexOf(tracks[i]!)), { source, fallbackArtwork, fallbackArtists });
    }
    const track = tracks[i]!;
    playTrack(track.artists.length || !fallbackArtists ? track : { ...track, artists: fallbackArtists }, fallbackArtwork);
  };
  const streams = useStreamCounts(tracks, fallbackArtists);
  const container = useRef<HTMLDivElement>(null);
  const [scrollElement, setScrollElement] = useState<HTMLElement | null>(null);
  useEffect(() => setScrollElement(document.getElementById('scrollable-page')), []);
  const virtual = tracks.length >= VIRTUALIZE_FROM;

  const virtualizer = useVirtualizer({
    count: virtual ? tracks.length : 0,
    getScrollElement: () => scrollElement,
    estimateSize: () => ROW_HEIGHT[variant],
    overscan: 10,
    scrollMargin: container.current?.offsetTop ?? 0,
  });

  const items = virtual ? virtualizer.getVirtualItems() : [];
  const last = items[items.length - 1];
  useEffect(() => {
    if (!onNearEnd) return;
    if (virtual ? last && last.index >= tracks.length - 20 : true) onNearEnd();
  }, [last?.index, tracks.length, virtual, onNearEnd]);

  return (
    <div className="mx-(--body-gutter) type-callout text-secondary" data-variant={variant} role="table" aria-label="Songs">
      {variant === 'playlist' && <Header showStreams={streams.enabled} />}
      <div ref={container}>
        {virtual ? (
          <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
            {items.map((item) => (
              <div
                key={item.key}
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  right: 0,
                  transform: `translateY(${item.start - virtualizer.options.scrollMargin}px)`,
                }}
              >
                <div className={item.index < 16 ? 'animate-row-in' : undefined} style={{ animationDelay: `${Math.min(item.index, 16) * 28}ms` }}>
                  <Row
                    track={tracks[item.index]!}
                    variant={variant}
                    position={item.index + 1}
                    fallbackArtwork={fallbackArtwork}
                    onPlayRow={() => playRow(item.index)}
                    showStreams={streams.enabled}
                    count={streams.of(tracks[item.index]!)}
                    editPlaylistId={editPlaylistId}
                    fallbackArtists={fallbackArtists}
                    fallbackAlbum={fallbackAlbum}
                    total={tracks.length}
                  />
                </div>
              </div>
            ))}
          </div>
        ) : (
          tracks.map((track, i) => (
            <Row
              key={`${track.videoId}-${i}`}
              track={track}
              variant={variant}
              position={i + 1}
              fallbackArtwork={fallbackArtwork}
              onPlayRow={() => playRow(i)}
              showStreams={streams.enabled}
              count={streams.of(track)}
              editPlaylistId={editPlaylistId}
                    fallbackArtists={fallbackArtists}
                    fallbackAlbum={fallbackAlbum}
              total={tracks.length}
            />
          ))
        )}
      </div>
    </div>
  );
}
