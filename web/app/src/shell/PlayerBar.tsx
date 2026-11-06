import { MessageSquare, Maximize2, PanelRight, PanelRightClose } from 'lucide-react';
import {
  BackwardIcon,
  ForwardIcon,
  LyricsActiveIcon,
  LyricsIcon,
  PauseIcon,
  PlayIcon,
  RepeatIcon,
  RepeatOneIcon,
  ShuffleIcon,
  UpNextIcon,
  VolumeIcon,
} from '@/components/icons/Transport';
import { LogoMark } from '@/components/icons/LogoMark';
import { ExplicitBadge } from '@/components/music/ExplicitBadge';
import { FavoriteButton } from '@/components/music/FavoriteButton';
import { TrackMenu } from '@/components/music/TrackMenu';
import { VideoSurface } from '@/components/music/VideoSurface';
import { albumHref } from '@/components/music/links';
import { sizedArtwork } from '@/lib/artwork';
import { usePlayer } from '@/state/player';
import { useUi } from '@/state/ui';
import { useHasVideo } from '@/state/video';
import { CutToggle } from './CutSwitch';
import { Credits, PageLink, pageLink } from './Lcd';
import { MixWindowHighlight } from './NerdStats';
import { albumPageFor } from './nowPlayingLinks';
import { useScrubber } from './useScrubber';

// Quiet glyph buttons: secondary until pointed at, the key colour when on.
const control = 'grid place-items-center rounded-[8px] disabled:opacity-40';
const toggle = `${control} size-8 text-secondary hover:text-primary aria-pressed:bg-quinary aria-pressed:text-primary`;
const skip = `${control} size-9 text-primary`;
const action = `${control} size-8 text-secondary hover:bg-quinary hover:text-primary aria-pressed:text-key`;

const volumeTrack =
  'h-4 w-[88px] flex-none max-[1100px]:hidden cursor-pointer appearance-none bg-transparent [&::-webkit-slider-runnable-track]:h-1 [&::-webkit-slider-runnable-track]:rounded-[2px] ' +
  '[&::-webkit-slider-runnable-track]:bg-[linear-gradient(to_right,var(--systemPrimary)_var(--fill),var(--systemQuaternary)_var(--fill))] ' +
  '[&::-webkit-slider-thumb]:-mt-1 [&::-webkit-slider-thumb]:size-3 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full ' +
  '[&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:shadow-[0_0_2px_#0006]';

/** The speaker and its level, always in sight. */
function Volume() {
  const volume = usePlayer((s) => s.volume);
  const muted = usePlayer((s) => s.muted);
  const setVolume = usePlayer((s) => s.setVolume);
  const toggleMute = usePlayer((s) => s.toggleMute);
  const level = muted ? 0 : volume;
  return (
    <div className="flex items-center gap-1.5">
      <button className={action} aria-label={muted ? 'Unmute' : 'Mute'} aria-pressed={muted} onClick={toggleMute}>
        <VolumeIcon level={level} size={20} />
      </button>
      <input
        className={volumeTrack}
        type="range"
        min={0}
        max={1}
        step={0.01}
        value={level}
        aria-label="Volume"
        style={{ '--fill': `${level * 100}%` } as React.CSSProperties}
        onChange={(e) => setVolume(Number(e.currentTarget.value))}
      />
    </div>
  );
}

/** The cover (it opens the full-screen player), the song and who sings it. */
function NowPlaying() {
  const nowPlaying = usePlayer((s) => s.nowPlaying);
  const status = usePlayer((s) => s.status);
  const error = usePlayer((s) => s.error);
  const openFullScreen = useUi((s) => s.setFullScreen);
  // The queue's row for what's playing: it carries the album and each artist's channel.
  const track = usePlayer((s) => {
    const entry = s.queue[s.index]?.track;
    return entry && entry.videoId === s.nowPlaying?.videoId ? entry : null;
  });
  const video = useHasVideo(nowPlaying?.videoId);

  if (!nowPlaying) {
    return (
      <div className="flex items-center gap-3 text-tertiary">
        <span className="grid size-[52px] place-items-center rounded-[8px] bg-quinary">
          <LogoMark size={24} />
        </span>
        <span className="type-callout-medium">Nothing playing</span>
      </div>
    );
  }

  const { videoId, title, artist, artworkUrl } = nowPlaying;
  const album = track?.album ?? null;
  return (
    <div className="flex min-w-0 items-center gap-3">
      <button
        // A music video plays here in small, at 16:9.
        className={`group/art relative block h-[52px] flex-none overflow-hidden rounded-[8px] bg-joe p-0 ${video ? 'w-[92px] bg-black' : 'w-[52px]'}`}
        aria-label="Open full screen player"
        onClick={() => openFullScreen(true)}
      >
        {artworkUrl && (
          <img
            key={artworkUrl}
            src={sizedArtwork(artworkUrl, 52)}
            alt=""
            referrerPolicy="no-referrer"
            decoding="async"
            className="size-full object-cover opacity-0 transition-opacity duration-200 ease-in data-loaded:opacity-100"
            onLoad={(e) => e.currentTarget.setAttribute('data-loaded', '')}
          />
        )}
        <VideoSurface className={`absolute inset-0 transition-opacity duration-300 ${video ? 'opacity-100' : 'opacity-0'}`} />
        <span
          className="absolute inset-0 grid place-items-center bg-[rgb(0_0_0/0.5)] text-white opacity-0 transition-opacity duration-200 group-hover/art:opacity-100 group-focus-visible/art:opacity-100"
          aria-hidden="true"
        >
          <Maximize2 size={16} strokeWidth={2.25} />
        </span>
      </button>
      <div className="flex min-w-0 flex-col gap-0.5">
        {title ? (
          <div className="flex min-w-0 items-center">
            <PageLink
              className={`min-w-0 max-w-full self-start truncate type-[600_15px/20px] ${pageLink}`}
              href={albumHref(album?.id ?? null)}
              resolve={() => albumPageFor(videoId, album, [title, artist].filter(Boolean).join(' '))}
            >
              {title}
            </PageLink>
            {track?.explicit && <ExplicitBadge size={12} />}
          </div>
        ) : (
          <span className="truncate type-[600_15px/20px]">{status === 'loading' ? 'Loading…' : ''}</span>
        )}
        {status === 'error' ? (
          <span className="truncate type-callout-medium text-key">{error}</span>
        ) : (
          <span className="truncate type-callout-medium text-secondary">
            {artist ? <Credits videoId={videoId} line={artist} artists={track?.artists ?? []} /> : status === 'loading' ? 'Loading…' : ''}
            {artist && album?.name && ' · '}
            {album?.name && (
              <PageLink
                className={pageLink}
                href={albumHref(album.id ?? null)}
                resolve={() => albumPageFor(videoId, album, [title, artist].filter(Boolean).join(' '))}
              >
                {album.name}
              </PageLink>
            )}
          </span>
        )}
      </div>
    </div>
  );
}

const time = 'w-10 flex-none type-[500_11px/14px] tabular-nums text-secondary';

/** Elapsed, the seek line, and what is left; pressing or dragging on the line seeks. */
function SeekLine() {
  const { bar, elapsed, remaining, dragging, handlers } = useScrubber();
  return (
    <div className="flex w-full items-center gap-3">
      <span ref={elapsed} className={`${time} text-right`} />
      <div className="group/scrub relative h-4 min-w-0 flex-1 cursor-pointer touch-none" data-scrubber data-dragging={dragging || undefined} {...handlers}>
        <div
          className="absolute inset-x-0 top-1/2 h-1 -translate-y-1/2 overflow-hidden rounded-full bg-quaternary transition-[height] duration-100 ease-in group-hover/scrub:h-1.5 group-data-dragging/scrub:h-1.5"
          aria-hidden="true"
        >
          <MixWindowHighlight />
          <div ref={bar} className="relative size-full origin-left scale-x-(--progress) rounded-full bg-primary [--progress:0]" />
        </div>
      </div>
      <span ref={remaining} className={`${time} text-left`} />
    </div>
  );
}

/**
 * The player: one bar along the bottom. The song on the left, the transport with its seek line in the middle, and
 * the actions and the volume on the right.
 */
export function PlayerBar() {
  const sidePanel = useUi((s) => s.sidePanel);
  const toggleSidePanel = useUi((s) => s.toggleSidePanel);
  const openFullScreen = useUi((s) => s.setFullScreen);
  const hasTrack = usePlayer((s) => s.nowPlaying !== null);
  const videoId = usePlayer((s) => s.nowPlaying?.videoId ?? null);
  const track = usePlayer((s) => {
    const entry = s.queue[s.index]?.track;
    return entry && entry.videoId === s.nowPlaying?.videoId ? entry : null;
  });
  const playing = usePlayer((s) => s.status === 'playing' || s.status === 'buffering');
  const hasNext = usePlayer((s) => s.index + 1 < s.queue.length || s.repeat !== 'off' || (s.autoplay && s.index >= 0));
  const shuffle = usePlayer((s) => s.shuffle);
  const repeat = usePlayer((s) => s.repeat);
  const { togglePlay, next, previous, toggleShuffle, cycleRepeat } = usePlayer.getState();

  return (
    // The bar is the whole foot of the window: edge to edge, with no gap around it, under the sidebar, the page and the side panel.
    <div
      className="pointer-events-none absolute right-0 bottom-(--player-bottom-offset) left-0 z-[calc(var(--z-web-chrome)+1)] max-sm:hidden">
      <div
        className="group/pill pointer-events-auto relative flex h-(--player-pill-height) items-center border-t border-[var(--labelDivider)] bg-[color-mix(in_srgb,var(--pageBG)_93%,black)] pl-5 pr-5"
        role="region"
        aria-label="Player"
        style={{ '--np-center': 'clamp(240px, 34vw, 460px)' } as React.CSSProperties}
      >
        {/* The transport sits on the window's own middle; the song and the actions take what is left either side. */}
        <div className="min-w-0 flex-none pr-4" style={{ width: 'calc(50% - var(--np-center) / 2)' }}>
          <NowPlaying />
        </div>

        <div className="absolute inset-y-0 left-1/2 flex -translate-x-1/2 flex-col items-center justify-center gap-0.5" style={{ width: 'var(--np-center)' }}>
          <div className="flex items-center gap-2">
            <button className={toggle} aria-label="Shuffle" aria-pressed={shuffle} onClick={toggleShuffle}>
              <ShuffleIcon size={26} />
            </button>
            <button className={skip} disabled={!hasTrack} aria-label="Previous" onClick={previous}>
              <BackwardIcon size={24} />
            </button>
            <button
              className="grid size-10 place-items-center rounded-full bg-white text-black transition-transform duration-100 hover:scale-105 disabled:opacity-40"
              disabled={!hasTrack}
              aria-label={playing ? 'Pause' : 'Play'}
              onClick={togglePlay}
            >
              {playing ? <PauseIcon size={24} /> : <PlayIcon size={24} />}
            </button>
            <button className={skip} disabled={!hasTrack || !hasNext} aria-label="Next" onClick={next}>
              <ForwardIcon size={24} />
            </button>
            <button
              className={toggle}
              aria-label={repeat === 'one' ? 'Repeat one' : repeat === 'all' ? 'Repeat all' : 'Repeat'}
              aria-pressed={repeat !== 'off'}
              onClick={cycleRepeat}
            >
              {repeat === 'one' ? <RepeatOneIcon size={26} /> : <RepeatIcon size={26} />}
            </button>
          </div>
          <SeekLine />
        </div>

        <div className="ml-auto flex items-center justify-end gap-0.5">
          <FavoriteButton videoId={videoId} className={action} />
          {track && <TrackMenu track={track} className={action} placement="above-end" />}
          {/* Always here: the panel itself says whether this track has lyrics, and from where. */}
          <button className={action} aria-label="Lyrics" aria-pressed={sidePanel === 'lyrics'} onClick={() => toggleSidePanel('lyrics')}>
            {sidePanel === 'lyrics' ? <LyricsActiveIcon size={18} /> : <LyricsIcon size={18} />}
          </button>
          <CutToggle className={action} />
          <button className={action} aria-label="Comments" aria-pressed={sidePanel === 'comments'} disabled={!hasTrack} onClick={() => toggleSidePanel('comments')}>
            <MessageSquare size={17} fill={sidePanel === 'comments' ? 'currentColor' : 'none'} />
          </button>
          <button className={action} aria-label="Up Next" aria-pressed={sidePanel === 'up-next'} onClick={() => toggleSidePanel('up-next')}>
            <UpNextIcon size={18} />
          </button>
          {/* The Now Playing view: the cover, the artist, the credits and what is next, in a column on the right. */}
          <button className={action} aria-label="Now Playing view" title="Now Playing view" aria-pressed={sidePanel === 'now-playing'} onClick={() => toggleSidePanel('now-playing')}>
            {sidePanel === 'now-playing' ? <PanelRightClose size={18} /> : <PanelRight size={18} />}
          </button>
          <span className="mx-1 h-5 w-px bg-quaternary max-[1100px]:hidden" aria-hidden="true" />
          <Volume />
          <button className={action} disabled={!hasTrack} aria-label="Open full screen player" onClick={() => openFullScreen(true)}>
            <Maximize2 size={17} />
          </button>
        </div>
      </div>
    </div>
  );
}
