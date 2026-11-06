import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { useParams } from 'react-router';
import { PlayIcon } from '@/components/icons/Transport';
import { Artwork } from '@/components/music/Artwork';
import { MotionArtwork } from '@/components/music/MotionArtwork';
import { useReducedMotion } from '@/lib/motionPref';
import { browseHref } from '@/components/music/links';
import { playList } from '@/components/music/play';
import { ArtistFeatured, type LatestRelease } from '@/components/music/ArtistFeatured';
import { hrefFor } from '@/components/music/links';
import { Shelves } from '@/components/music/ShelfView';
import { LoadError, NeedsExtension } from '@/components/music/States';
import { requestAppleAccess, useAppleArtistArtLookup, useUngrantedAppleOrigins, type AppleArtistArt } from '@/data/apple/artistArt';
import type { AppleTopSong } from '@/data/apple/artistPage';
import { useArtist, useYouTubeReady } from '@/data/music/queries';
import { normalizeForMatch } from '@/data/apple/motion';
import type { MusicItem, Shelf, Track } from '@/data/music/types';
import type { ArtworkColor } from '@/lib/artworkColor';
import { usePageTint } from '@/lib/usePageTint';
import { ArtistSkeleton } from '@/skeletons/PageSkeletons';

/** What names an artist: "Red Velvet - IRENE & SEULGI" is "red velvet", "irene" and "seulgi". */
function nameTokens(name: string): string[] {
  return name
    .split(/\s[-–]\s|[&,/]|\bx\b|\bfeat\.?/i)
    .map((part) => normalizeForMatch(part))
    .filter((part) => part.length >= 3);
}

/**
 * YouTube's "Videos" shelf on an artist page takes in whatever its search finds, and sometimes it is a stranger's video
 * (a fan's subtitle of another group's song). A video stays when its title, channel or credits name the artist.
 */
function relevantShelves(shelves: Shelf[], name: string, artistId: string): Shelf[] {
  const tokens = nameTokens(name);
  if (!tokens.length) return shelves;
  return shelves
    .map((shelf) => {
      if (shelf.layout !== 'video') return shelf;
      const items = shelf.items.filter((item) => {
        if (item.artists.some((a) => a.id === artistId)) return true;
        const text = normalizeForMatch(`${item.title} ${item.subtitle} ${item.artists.map((a) => a.name).join(' ')}`);
        return tokens.some((token) => text.includes(token));
      });
      return { ...shelf, items };
    })
    .filter((shelf) => shelf.layout !== 'video' || shelf.items.length > 0);
}

/**
 * What Apple prints under a top song: the release and its year ("Cheetah - EP · 2026"). YouTube's songs know their album,
 * and the artist's own album, single and EP shelves know each release's type and year.
 */
function releaseLine(shelves: Shelf[], appleSongs: AppleTopSong[]): (track: Track) => string | null {
  const key = (text: string) => text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  const fromApple = new Map(appleSongs.map((song) => [key(song.title), song.release] as const));
  const releases = shelves.flatMap((shelf) => shelf.items.filter((item) => item.kind === 'album'));
  const info = (item: MusicItem) => ({ year: /([0-9]{4})/.exec(item.subtitle)?.[1] ?? '', type: /^(EP|Single)/i.exec(item.subtitle)?.[1] ?? '' });
  return (track) => {
    // Apple's own line for the song, where it lists it: the same words as its page.
    const apple = fromApple.get(key(track.title));
    if (apple) return apple;
    // YouTube's title may carry a second language ("놀이 Naughty") that Apple's lacks, or the other way round.
    const mine = key(track.title);
    const near = appleSongs.find((song) => key(song.title).length >= 4 && (mine.includes(key(song.title)) || key(song.title).includes(mine)));
    if (near) return near.release;
    const name = track.album?.name;
    if (!name) return null;
    const release =
      releases.find((r) => !!track.album?.id && r.id === track.album.id) ?? releases.find((r) => normalizeForMatch(r.title) === normalizeForMatch(name));
    const { year, type } = release ? info(release) : { year: '', type: '' };
    const label = type && !name.toLowerCase().includes(type.toLowerCase()) ? `${name} - ${type.toUpperCase() === 'EP' ? 'EP' : 'Single'}` : name;
    return year ? `${label} · ${year}` : label;
  };
}

const bareTitle = (title: string) =>
  normalizeForMatch(title)
    .replace(/\b(ep|single|the \d+(st|nd|rd|th) (mini )?album)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/** Apple's Latest Release card, opening the matching album here; without Apple, the newest album by its year. */
function latestRelease(apple: AppleArtistArt | null, shelves: Shelf[]): LatestRelease | null {
  const albums = shelves.flatMap((shelf) => shelf.items.filter((item) => item.kind === 'album'));
  if (apple?.latest) {
    const want = bareTitle(apple.latest.title);
    const match = albums.find((a) => {
      const have = bareTitle(a.title);
      return !!have && !!want && (have === want || have.includes(want) || want.includes(have));
    });
    return { ...apple.latest, href: match ? hrefFor(match) : null };
  }
  const year = (item: MusicItem) => Number(/(\d{4})\s*$/.exec(item.subtitle)?.[1] ?? 0);
  const newest = [...albums].sort((a, b) => year(b) - year(a))[0];
  if (!newest || !year(newest)) return null;
  return { title: newest.title, date: String(year(newest)), songs: '', artworkUrl: newest.thumbnail, href: hrefFor(newest) };
}

function luminance(color: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(color.slice(i, i + 2), 16) / 255);
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}

/**
 * The name, or Apple's title logo in its place (AppleArtistArt.kt). Until the
 * logo has drawn, the name stands in, so the header is never left empty; a
 * logo that fails to load leaves the name.
 */
function ArtistName({ name, apple }: { name: string; apple: AppleArtistArt | null }) {
  const logo = apple?.logoUrl ?? null;
  const [shown, setShown] = useState<string | null>(null);
  const logoShown = !!logo && shown === logo;
  return (
    <h1
      className="type-header-emphasized text-[clamp(34px,5vw,64px)] leading-[1.05] [text-shadow:0_2px_20px_#00000059] data-logo:w-full data-logo:[text-shadow:none]"
      data-logo={logoShown || undefined}
    >
      {!logoShown && name}
      {logo && (
        <img
          key={logo}
          // Apple's title logo in place of the name: at most 82% of the page's width and 30% of the
          // photo's height (the photo is the column's width over 1.93, and never taller than 70vh).
          className="mx-auto mt-0 mb-1.5 block h-auto max-h-[min(calc((100vw-var(--web-navigation-width))/1.93*0.3),21vh)] w-auto max-w-[min(82%,640px)] [filter:drop-shadow(0_2px_16px_#00000040)]"
          src={logo}
          alt={logoShown ? name : ''}
          hidden={!logoShown}
          // Its proportions are known before it decodes; the CSS caps its size.
          style={{ aspectRatio: String(apple!.logoAspect) }}
          decoding="async"
          onLoad={() => setShown(logo)}
        />
      )}
    </h1>
  );
}

/**
 * An artist (report §4): full-bleed hero with the name and Play, Top Songs,
 * then shelves. Where Apple Music has the artist, the page takes Apple's
 * header as the phone does: its photograph, its title logo over it, its
 * colour behind the whole page, and its colour on the Play button.
 */
/** The hero while Apple's photograph is on its way: drifting light and a small equaliser, in the page's own colours. */
function HeroWaiting() {
  return (
    <div
      className="relative grid animate-aurora place-items-center bg-[length:300%_300%] bg-[linear-gradient(115deg,#ffffff0a_0%,#ffffff26_25%,#fa2d4829_50%,#ffffff1a_75%,#ffffff0a_100%)]"
      style={{ aspectRatio: 1165 / 604 }}
      role="status"
      aria-label="Loading"
    >
      <div className="flex h-9 items-end gap-1.5" aria-hidden="true">
        {[0, 1, 2, 3, 4].map((i) => (
          <span key={i} className="h-full w-1.5 origin-bottom animate-bar rounded-full bg-[#ffffffb3]" style={{ animationDelay: `${i * 130}ms` }} />
        ))}
      </div>
    </div>
  );
}

export default function ArtistPage() {
  const id = decodeURIComponent(useParams().id ?? '');
  const { missing } = useYouTubeReady();
  const artist = useArtist(id);
  const lookup = useAppleArtistArtLookup(artist.data?.name);
  // The photograph that shows first is the one that stays: wait for Apple's (briefly) instead of showing YouTube's and swapping.
  const [waited, setWaited] = useState(false);
  const [appleFailed, setAppleFailed] = useState(false);
  useEffect(() => {
    setWaited(false);
    setAppleFailed(false);
    const timer = setTimeout(() => setWaited(true), 2200);
    return () => clearTimeout(timer);
  }, [id]);
  const apple = lookup.art;
  const heroReady = lookup.settled || waited;
  const movingHeader = !!apple?.video && !appleFailed;
  const reducedMotion = useReducedMotion();
  const appleUngranted = useUngrantedAppleOrigins();
  const tint = useMemo<ArtworkColor | null>(
    () => (apple ? { background: apple.background, dark: luminance(apple.background) < 0.6 } : null),
    [apple],
  );
  usePageTint(tint);

  if (missing) return <NeedsExtension />;
  if (artist.isError) return <LoadError error={artist.error} onRetry={() => void artist.refetch()} />;
  if (!artist.data) return <ArtistSkeleton />;

  const data = artist.data;
  const shelves = relevantShelves(data.shelves, data.name, data.id);
  const latest = latestRelease(apple, shelves);
  const topSongs = { title: `${data.name}: Top Songs`, type: 'artist' as const, id: data.id };
  return (
    <>
      {/* The hero (report §4): full-bleed, ~1.93:1 of the content column, the name and actions centred near the bottom. */}
      <header className="relative max-h-[70vh] overflow-hidden">
        <div className="relative w-full" style={movingHeader ? { aspectRatio: apple!.video!.aspect, maxHeight: '70vh' } : undefined}>
          {/* Apple's moving header, as its own page plays it: the clip's first frame, then the clip fading in over it. */}
          {movingHeader && (
            <>
              <img
                key={apple!.video!.posterUrl ?? apple!.heroUrl}
                className="absolute inset-0 size-full object-cover opacity-0 transition-opacity duration-700 ease-out data-loaded:opacity-100"
                src={apple!.video!.posterUrl ?? apple!.heroUrl}
                alt=""
                decoding="async"
                onLoad={(e) => e.currentTarget.setAttribute('data-loaded', '')}
                onError={() => setAppleFailed(true)}
              />
              {!reducedMotion && (
                <MotionArtwork
                  key={apple!.video!.url}
                  motion={{ url: apple!.video!.url, fallbackUrl: null }}
                  className="absolute inset-0 size-full object-cover opacity-0 transition-opacity duration-1000 ease-out data-ready:opacity-100"
                />
              )}
            </>
          )}
          {/* Apple's photograph where there is one; YouTube's only when Apple has none (or hasn't answered in time). */}
          {movingHeader ? null : heroReady && (!apple || appleFailed) ? (
            <Artwork src={data.heroImage} displayWidth={1200} aspect={1165 / 604} eager />
          ) : (
            <HeroWaiting />
          )}
          {apple && !appleFailed && !movingHeader && (
            <img
              key={apple.heroUrl}
              className="absolute inset-0 size-full object-cover opacity-0 transition-opacity duration-500 ease-out data-loaded:opacity-100"
              src={apple.heroUrl}
              alt=""
              decoding="async"
              onLoad={(e) => e.currentTarget.setAttribute('data-loaded', '')}
              onError={() => setAppleFailed(true)}
            />
          )}
        </div>
        {/* The image melts into the page at the bottom (Apple's masked blur frame), into Apple's colour when the page is tinted with it. */}
        <div
          className="pointer-events-none absolute inset-0 bg-[linear-gradient(180deg,transparent_45%,color-mix(in_srgb,var(--page-tint,var(--pageBG))_70%,transparent)_80%,var(--page-tint,var(--pageBG))_100%)]"
          aria-hidden="true"
        />
        <div className="absolute inset-x-0 bottom-6 flex flex-col items-center gap-1.5 px-(--body-gutter) text-center">
          <ArtistName name={data.name} apple={apple} />
          {data.audience && <p className="type-callout-emphasized text-secondary">{data.audience}</p>}
          <button
            // The 56px key-colour play button.
            className="mt-2.5 grid size-14 place-items-center rounded-full bg-(--play-fill,var(--keyColorBG)) text-(--play-glyph,#fff) shadow-[0_2px_6px_-4px_#0006,inset_0_0_2px_#ffffff1a] disabled:opacity-40 enabled:hover:scale-[1.04]"
            // Apple's fill for the Play circle, with the triangle in the page's colour,
            // as the phone cuts it out of the circle; white without a key colour.
            style={
              apple
                ? ({ '--play-fill': apple.keyColor ?? '#ffffff', '--play-glyph': apple.background } as CSSProperties)
                : undefined
            }
            aria-label={`Play ${data.name}`}
            disabled={!data.topSongs.length}
            onClick={() => playList(data.topSongs, 0, { source: topSongs })}
          >
            <PlayIcon size={26} />
          </button>
          {!apple && appleUngranted.length > 0 && (
            // The lyrics panel's permission notice, as a pill over the photograph.
            <div className="mt-3 flex items-center gap-2.5 rounded-[999px] bg-[#0000004d] py-1.5 pr-2 pl-3.5 type-callout text-[#ffffffcc] [backdrop-filter:blur(20px)_saturate(1.6)]">
              <span>Apple Music artist art needs the extension’s permission.</span>
              <button
                className="flex-none rounded-[999px] bg-[#ffffff26] px-2.5 py-1 type-callout-emphasized text-white hover:bg-[#ffffff40]"
                // Stays until the extension confirms the grant (checked when this tab comes back).
                onClick={requestAppleAccess}
              >
                Allow
              </button>
            </div>
          )}
        </div>
      </header>

      {(data.topSongs.length > 0 || latest) && (
        <ArtistFeatured latest={latest} detailOf={releaseLine(shelves, apple?.songs ?? [])} tracks={data.topSongs} to={data.topSongsSeeAll ? browseHref(data.topSongsSeeAll) : null} source={topSongs} />
      )}

      <Shelves shelves={shelves} />

      {(apple?.bio ?? data.description) && (
        <section className="mx-(--body-gutter) mt-3 mb-10" aria-label={`About ${data.name}`}>
          <h2 className="type-title-2-emphasized">About {data.name}</h2>
          <p className="mt-2 max-w-[720px] type-body-tall whitespace-pre-line text-secondary">{apple?.bio ?? data.description}</p>
        </section>
      )}
    </>
  );
}
