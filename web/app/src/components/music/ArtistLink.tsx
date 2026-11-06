import { Fragment, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router';
import { PrefetchLink } from '@/components/PrefetchLink';
import { findArtistPageId } from '@/data/music/api';
import type { ArtistRef } from '@/data/music/types';
import { normalizedArtistName } from '@/lib/artistCredits';
import { queryClient } from '@/lib/queryClient';
import { artistHref } from './links';

const searchHref = (name: string) => `/search?q=${encodeURIComponent(name)}`;

/**
 * An artist's name that opens their page. With the channel id it is an ordinary link; many rows come without one
 * (a playlist's credit line, a video's channel), and then the name is looked up when it is pressed: the artist search's
 * exact match opens, and the search page opens on the name when there isn't one.
 */
export function ArtistLink({ artist, className, children }: { artist: ArtistRef; className?: string; children?: ReactNode }) {
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const href = artistHref(artist.id);
  if (href) {
    return (
      <PrefetchLink to={href} className={className}>
        {children ?? artist.name}
      </PrefetchLink>
    );
  }
  return (
    <button
      className={`${className ?? ''} cursor-pointer text-left`}
      aria-busy={busy || undefined}
      onClick={(event) => {
        event.stopPropagation();
        if (busy) return;
        setBusy(true);
        queryClient
          .fetchQuery({ queryKey: ['music', 'artist-by-name', normalizedArtistName(artist.name)], queryFn: () => findArtistPageId(artist.name), staleTime: Infinity })
          .catch(() => null)
          .then((id) => navigate(artistHref(id) ?? searchHref(artist.name)))
          .finally(() => setBusy(false));
      }}
    >
      {children ?? artist.name}
    </button>
  );
}

/** Credited names joined with commas, each its own link. */
export function ArtistLinks({ artists, className }: { artists: ArtistRef[]; className?: string }) {
  return (
    <>
      {artists.map((artist, i) => (
        <Fragment key={`${artist.name}-${i}`}>
          {i > 0 && ', '}
          <ArtistLink artist={artist} className={className} />
        </Fragment>
      ))}
    </>
  );
}

/**
 * A line of text as YouTube worded it ("Single • Ondab", "Red Velvet - IRENE & SEULGI • 146M views") with every credited
 * name in it turned into a link.
 */
export function LinkedText({ text, artists, className }: { text: string; artists: ArtistRef[]; className?: string }) {
  const names = [...new Set(artists.map((a) => a.name).filter((n) => n.trim().length > 1))].sort((a, b) => b.length - a.length);
  if (!names.length) return <>{text}</>;
  const pieces: ReactNode[] = [];
  let rest = text;
  let key = 0;
  while (rest) {
    let at = -1;
    let hit = '';
    for (const name of names) {
      const i = rest.toLowerCase().indexOf(name.toLowerCase());
      if (i >= 0 && (at < 0 || i < at)) {
        at = i;
        hit = name;
      }
    }
    if (at < 0) {
      pieces.push(rest);
      break;
    }
    if (at > 0) pieces.push(rest.slice(0, at));
    const artist = artists.find((a) => a.name === hit)!;
    pieces.push(
      <ArtistLink key={key++} artist={artist} className={className}>
        {rest.slice(at, at + hit.length)}
      </ArtistLink>,
    );
    rest = rest.slice(at + hit.length);
  }
  return <>{pieces}</>;
}
