import { Maximize2, PanelRightClose } from 'lucide-react';
import { useState } from 'react';
import { Artwork } from '@/components/music/Artwork';
import { CreditsModal } from '@/components/music/CreditsModal';
import { FavoriteButton } from '@/components/music/FavoriteButton';
import { TrackMenu } from '@/components/music/TrackMenu';
import { artistHref } from '@/components/music/links';
import { PrefetchLink } from '@/components/PrefetchLink';
import { isLocalId } from '@/data/local/ids';
import { useArtist, useCredits } from '@/data/music/queries';
import { usePlayer } from '@/state/player';
import { useUi } from '@/state/ui';
import { Credits } from './Lcd';

const card = 'flex flex-col gap-3 rounded-[12px] bg-quinary p-4';
const cardTitle = 'type-[700_15px/20px]';
const ghost = 'type-callout-emphasized text-secondary hover:text-primary hover:underline';
const iconButton = 'grid size-8 place-items-center rounded-full text-secondary transition-colors hover:bg-quinary hover:text-primary';

/** "About the artist": the picture, the audience, and what YouTube Music says of them. */
function AboutArtist({ artistId }: { artistId: string }) {
  const artist = useArtist(artistId);
  const page = artist.data;
  const [more, setMore] = useState(false);
  if (!page) return null;
  const href = artistHref(page.id);
  return (
    <section className="overflow-hidden rounded-[12px] bg-quinary" aria-label="About the artist">
      {page.heroImage && (
        <PrefetchLink to={href ?? '#'} className="relative block">
          <Artwork src={page.heroImage} displayWidth={336} aspect={16 / 10} radius={0} />
          <span className="pointer-events-none absolute inset-x-0 top-0 bg-gradient-to-b from-black/60 to-transparent px-4 pt-3 pb-8 type-[700_15px/20px] text-white">
            About the artist
          </span>
        </PrefetchLink>
      )}
      <div className="flex flex-col gap-2 p-4">
        {!page.heroImage && <h3 className={cardTitle}>About the artist</h3>}
        <PrefetchLink to={href ?? '#'} className="type-[700_15px/20px] hover:underline">
          {page.name}
        </PrefetchLink>
        {page.audience && <span className="type-callout-medium text-secondary">{page.audience}</span>}
        {page.description && (
          <>
            <p className={`type-callout whitespace-pre-line text-secondary ${more ? '' : 'line-clamp-4'}`}>{page.description}</p>
            <button className={`${ghost} self-start`} onClick={() => setMore(!more)}>
              {more ? 'Show less' : 'Show more'}
            </button>
          </>
        )}
      </div>
    </section>
  );
}

/** The song's credits, a few of them, with the rest behind "Show all". */
function CreditsCard({ track }: { track: NonNullable<ReturnType<typeof useQueuedTrack>> }) {
  const credits = useCredits(track, !isLocalId(track.videoId));
  const [all, setAll] = useState(false);
  const rows = (credits.data?.sections ?? [])
    .filter((section) => !/metadata/i.test(section.role))
    .flatMap((section) => section.names.map((name) => ({ name, role: section.role })));
  if (!rows.length) return null;
  return (
    <section className={card} aria-label="Credits">
      <div className="flex items-center justify-between">
        <h3 className={cardTitle}>Credits</h3>
        <button className={ghost} onClick={() => setAll(true)}>
          Show all
        </button>
      </div>
      <ul className="flex flex-col gap-3">
        {rows.slice(0, 4).map((row) => (
          <li key={`${row.role}:${row.name}`} className="min-w-0">
            <div className="truncate type-callout-emphasized">{row.name}</div>
            <div className="truncate type-callout text-secondary">{row.role}</div>
          </li>
        ))}
      </ul>
      {all && <CreditsModal track={track} onClose={() => setAll(false)} />}
    </section>
  );
}

/** The queue's entry for what plays: the full track, with its album and each artist's channel. */
function useQueuedTrack() {
  return usePlayer((s) => {
    const entry = s.queue[s.index]?.track;
    return entry && entry.videoId === s.nowPlaying?.videoId ? entry : null;
  });
}

/** What plays after this, and a way into the whole queue. */
function NextInQueue() {
  const next = usePlayer((s) => s.queue[s.index + 1]?.track ?? null);
  const index = usePlayer((s) => s.index);
  const toggleSidePanel = useUi((s) => s.toggleSidePanel);
  if (!next) return null;
  return (
    <section className={card} aria-label="Next in queue">
      <div className="flex items-center justify-between">
        <h3 className={cardTitle}>Next in queue</h3>
        <button className={ghost} onClick={() => toggleSidePanel('up-next')}>
          Open queue
        </button>
      </div>
      <button className="flex min-w-0 items-center gap-3 rounded-[8px] text-start hover:bg-quinary" onClick={() => usePlayer.getState().jumpTo(index + 1)}>
        <Artwork src={next.thumbnail} displayWidth={48} radius={6} className="!w-12 flex-none" />
        <span className="flex min-w-0 flex-col">
          <span className="truncate type-callout-emphasized">{next.title}</span>
          <span className="truncate type-callout text-secondary">{next.artists.map((a) => a.name).join(', ')}</span>
        </span>
      </button>
    </section>
  );
}

/**
 * The Now Playing view, Spotify's right-hand column: the cover large, the song and who made it, then cards for the
 * artist, the credits and what comes next. It opens and closes from the player bar.
 */
export function NowPlayingView() {
  const nowPlaying = usePlayer((s) => s.nowPlaying);
  const track = useQueuedTrack();
  const closeSidePanel = useUi((s) => s.closeSidePanel);
  const setFullScreen = useUi((s) => s.setFullScreen);

  if (!nowPlaying) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 px-8 text-center text-secondary">
        <p className="type-title-3 text-primary">Nothing playing</p>
        <p className="type-callout">Pick a song and its cover, credits and what comes next show up here.</p>
      </div>
    );
  }
  const { videoId, title, artist, artworkUrl } = nowPlaying;
  const artistId = track?.artists.find((a) => a.id)?.id ?? '';
  const local = isLocalId(videoId);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-1 px-4 pb-2">
        <h2 className="min-w-0 flex-1 truncate type-[700_15px/20px]">{track?.album?.name || 'Now Playing'}</h2>
        {track && <TrackMenu track={track} className={iconButton} placement="below-end" />}
        <button className={iconButton} aria-label="Open full screen player" onClick={() => setFullScreen(true)}>
          <Maximize2 size={16} />
        </button>
        <button className={iconButton} aria-label="Close Now Playing view" onClick={closeSidePanel}>
          <PanelRightClose size={17} />
        </button>
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-4 pb-4 [&>*]:shrink-0">
        <Artwork src={artworkUrl} displayWidth={336} radius={12} eager />
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <h3 className="type-[800_22px/28px] break-words">{title}</h3>
            <p className="mt-0.5 type-callout-medium text-secondary">
              {artist && <Credits videoId={videoId} line={artist} artists={track?.artists ?? []} />}
            </p>
          </div>
          <FavoriteButton videoId={videoId} className="grid size-9 flex-none place-items-center rounded-full text-secondary hover:text-primary aria-pressed:text-key" size={20} />
        </div>
        {!local && artistId && <AboutArtist artistId={artistId} />}
        {!local && track && <CreditsCard track={track} />}
        <NextInQueue />
      </div>
    </div>
  );
}
