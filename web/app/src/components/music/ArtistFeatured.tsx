import { ChevronRight } from 'lucide-react';
import { PrefetchLink } from '@/components/PrefetchLink';
import type { Track } from '@/data/music/types';
import { useStreamCounts } from '@/extension/useStreamCounts';
import type { QueueSource } from '@/playback/queue/timeline';
import { Artwork } from './Artwork';
import { TrackLockup } from './Lockups';
import { playList } from './play';
import { trackItem } from './ShelfView';

export interface LatestRelease {
  title: string;
  /** "Sep 23, 2026", or just a year. */
  date: string;
  /** "4 songs"; empty when unknown. */
  songs: string;
  artworkUrl: string | null;
  /** Where it opens, when it is an album this app has. */
  href: string | null;
}

/** A link when there is somewhere to go, a plain box when there isn't. */
function Maybe({ to, className, label, children }: { to: string | null; className: string; label?: string; children: React.ReactNode }) {
  return to ? (
    <PrefetchLink to={to} className={className} aria-label={label}>
      {children}
    </PrefetchLink>
  ) : (
    <div className={className.replace(/hover:[^ ]+/g, '')}>{children}</div>
  );
}

/**
 * The top of an artist page as Apple lays it out: the Latest Release card on the left, Top Songs beside it in three
 * columns of three, each song's album under its name (the artist is the page's own, so it isn't repeated).
 */
export function ArtistFeatured({
  latest,
  tracks,
  to,
  source,
  detailOf,
}: {
  latest: LatestRelease | null;
  tracks: Track[];
  to: string | null;
  source: QueueSource;
  /** The line under a song's title: its release, as "Monster - The 1st Mini Album - EP · 2020". */
  detailOf?: (track: Track) => string | null;
}) {
  const shown = tracks.slice(0, 9);
  const streams = useStreamCounts(shown);
  return (
    <div className="mx-(--body-gutter) mt-2 mb-8 grid grid-cols-[minmax(240px,340px)_minmax(0,1fr)] gap-x-10 gap-y-6 max-lg:grid-cols-1">
      {latest && (
        <section aria-label="Latest Release">
          <h2 className="type-title-2-emphasized">Latest Release</h2>
          <div className="mt-3 flex items-center gap-4">
            <Maybe to={latest.href} className="w-[140px] flex-none rounded-artwork-md transition-transform duration-500 ease-panel hover:scale-[1.03]" label={latest.title}>
              <Artwork src={latest.artworkUrl} displayWidth={140} radius="var(--radius-artwork-medium)" />
            </Maybe>
            <div className="flex min-w-0 flex-col gap-0.5">
              {latest.date && <span className="type-callout text-secondary">{latest.date}</span>}
              <Maybe to={latest.href} className="type-body-emphasized hover:underline">
                {latest.title}
              </Maybe>
              {latest.songs && <span className="type-body text-secondary">{latest.songs}</span>}
            </div>
          </div>
        </section>
      )}
      <section aria-label="Top Songs" className={latest ? '@container' : '@container col-span-2 max-lg:col-span-1'}>
        <h2 className="type-title-2-emphasized">
          {to ? (
            <PrefetchLink to={to} className="group/title inline-flex items-center gap-0.5">
              Top Songs
              <ChevronRight size={18} strokeWidth={2.6} className="text-secondary group-hover/title:text-primary" />
            </PrefetchLink>
          ) : (
            'Top Songs'
          )}
        </h2>
        <ul className="mt-2 grid grid-flow-row gap-x-6 @min-[480px]:grid-flow-col @min-[480px]:grid-cols-2 @min-[480px]:grid-rows-5 @min-[860px]:grid-cols-3 @min-[860px]:grid-rows-3">
          {shown.map((track, i) => (
            <li key={track.videoId} className="border-b border-quaternary/60">
              <TrackLockup item={trackItem(track)} detail="album" meta={detailOf?.(track)} onPlay={() => playList(tracks, i, { source })} streams={streams.of(track)} />
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
