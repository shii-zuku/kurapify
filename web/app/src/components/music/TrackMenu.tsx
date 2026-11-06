import {
  ArrowDown,
  ArrowUp,
  Bookmark,
  BookmarkCheck,
  ChevronLeft,
  ChevronRight,
  Activity,
  Disc3,
  Flag,
  Pin,
  PinOff,
  UsersRound,
  Link2,
  ListEnd,
  ListPlus,
  ListStart,
  MoreHorizontal,
  Plus,
  Radio,
  Star,
  Trash2,
  User,
} from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { Menu, MenuHeader, MenuItem, MenuSeparator, type MenuPlacement } from '@/components/Menu';
import {
  useAddToPlaylist,
  useCreatePlaylist,
  useLibraryToggle,
  useLikeStatus,
  useToggleLibrarySong,
  useMoveInPlaylist,
  usePlaylistOptions,
  useRemoveFromPlaylist,
  useSetLiked,
  useSignedIn,
} from '@/data/music/queries';
import { isLocalId, localIdOf } from '@/data/local/ids';
import { useRemoveLocalFile } from '@/data/local/localFiles';
import type { Track } from '@/data/music/types';
import { albumHref, artistHref } from './links';
import { usePlayer } from '@/state/player';
import { isPinned, songItem, usePins } from '@/state/pins';
import { toast } from '@/state/toast';
import { CreditsModal } from './CreditsModal';
import { FeedbackItems } from './FeedbackItems';

/** The playlist a row is listed in, when it is the signed-in account's own: what its menu can change. */
export interface PlaylistEdit {
  playlistId: string;
  /** The row's position, and how many rows the list has. */
  index: number;
  count: number;
}

function PlaylistChoices({ videoId, onDone, onBack }: { videoId: string; onDone: () => void; onBack: () => void }) {
  const options = usePlaylistOptions(videoId, true);
  const add = useAddToPlaylist();
  const create = useCreatePlaylist();
  return (
    <>
      <MenuItem icon={<ChevronLeft size={14} />} onSelect={onBack}>
        Back
      </MenuItem>
      <MenuSeparator />
      <MenuItem
        icon={<Plus size={15} />}
        onSelect={() => {
          create.mutate({ title: 'New Playlist', videoIds: [videoId] });
          onDone();
        }}
      >
        New Playlist
      </MenuItem>
      <MenuSeparator />
      <MenuHeader>Add to Playlist</MenuHeader>
      {options.isPending && (
        <MenuItem disabled onSelect={() => {}}>
          Loading…
        </MenuItem>
      )}
      {options.isError && (
        <MenuItem disabled onSelect={() => {}}>
          Couldn’t load your playlists
        </MenuItem>
      )}
      {options.data?.length === 0 && (
        <MenuItem disabled onSelect={() => {}}>
          No playlists yet
        </MenuItem>
      )}
      {options.data?.map((option) => (
        <MenuItem
          key={option.playlistId}
          onSelect={() => {
            add.mutate({ playlistId: option.playlistId, videoId });
            onDone();
          }}
        >
          {option.title}
        </MenuItem>
      ))}
    </>
  );
}

/** Favorite, Save to Library and Add to Playlist: the account's actions, signed in only. */
function AccountItems({ track, onClose, onPlaylists }: { track: Track; onClose: () => void; onPlaylists: () => void }) {
  const status = useLikeStatus(track.videoId);
  const setLiked = useSetLiked();
  const liked = status.data === 'LIKE';
  const library = useLibraryToggle(track.videoId, true);
  const toggleSaved = useToggleLibrarySong();
  const toggle = library.data;
  return (
    <>
      <MenuSeparator />
      {/* Only where YouTube Music offered the song's library toggle: its token is what saves it. */}
      {toggle && (toggle.addToken || toggle.removeToken) && (
        <MenuItem
          icon={toggle.saved ? <BookmarkCheck size={15} /> : <Bookmark size={15} />}
          onSelect={() => {
            toggleSaved.mutate({ videoId: track.videoId, toggle });
            onClose();
          }}
        >
          {toggle.saved ? 'Remove from Library' : 'Save to Library'}
        </MenuItem>
      )}
      <MenuItem
        icon={<Star size={15} fill={liked ? 'currentColor' : 'none'} />}
        disabled={status.isPending}
        onSelect={() => {
          setLiked.mutate({ videoId: track.videoId, liked: !liked });
          onClose();
        }}
      >
        {liked ? 'Remove from Liked Songs' : 'Add to Liked Songs'}
      </MenuItem>
      <MenuItem icon={<ListPlus size={15} />} trailing={<ChevronRight size={14} />} onSelect={onPlaylists}>
        Add to Playlist
      </MenuItem>
    </>
  );
}

/** Remove from, and move within, the playlist the row is listed in. */
function EditItems({ track, edit, onClose }: { track: Track; edit: PlaylistEdit; onClose: () => void }) {
  const remove = useRemoveFromPlaylist();
  const move = useMoveInPlaylist();
  const { playlistId, index, count } = edit;
  return (
    <>
      <MenuSeparator />
      <MenuItem
        icon={<ArrowUp size={15} />}
        disabled={index <= 0}
        onSelect={() => {
          move.mutate({ playlistId, videoId: track.videoId, from: index, to: index - 1 });
          onClose();
        }}
      >
        Move Up
      </MenuItem>
      <MenuItem
        icon={<ArrowDown size={15} />}
        disabled={index >= count - 1}
        onSelect={() => {
          move.mutate({ playlistId, videoId: track.videoId, from: index, to: index + 1 });
          onClose();
        }}
      >
        Move Down
      </MenuItem>
      <MenuItem
        icon={<Trash2 size={15} />}
        onSelect={() => {
          remove.mutate({ playlistId, videoId: track.videoId, index });
          onClose();
        }}
      >
        Remove from Playlist
      </MenuItem>
    </>
  );
}

/** Where the song's credited artists are: one goes straight there, several are listed. */
function ArtistChoices({ artists, onBack, onGo }: { artists: { name: string; id: string }[]; onBack: () => void; onGo: (id: string) => void }) {
  return (
    <>
      <MenuItem icon={<ChevronLeft size={14} />} onSelect={onBack}>
        Back
      </MenuItem>
      <MenuSeparator />
      <MenuHeader>Go to Artist</MenuHeader>
      {artists.map((artist) => (
        <MenuItem key={artist.id} onSelect={() => onGo(artist.id)}>
          {artist.name}
        </MenuItem>
      ))}
    </>
  );
}

/** Puts [link] on the clipboard and says so. */
export function copyLink(link: string) {
  void navigator.clipboard
    ?.writeText(link)
    .then(() => toast('Link copied'))
    .catch(() => toast('Couldn’t copy the link'));
}

/** The link YouTube Music itself would share for a song. */
export const songLink = (videoId: string) => `https://music.youtube.com/watch?v=${videoId}`;

/** A file from Local Files: it can be queued and removed from the library (never from disk), and nothing else applies. */
function LocalItems({ track, onClose }: { track: Track; onClose: () => void }) {
  const remove = useRemoveLocalFile();
  const { playNext, addToQueue } = usePlayer.getState();
  return (
    <>
      <MenuItem icon={<ListStart size={15} />} onSelect={() => (onClose(), playNext([track]))}>
        Play Next
      </MenuItem>
      <MenuItem icon={<ListEnd size={15} />} onSelect={() => (onClose(), addToQueue([track]))}>
        Add to Queue
      </MenuItem>
      <MenuSeparator />
      <MenuItem icon={<Trash2 size={15} />} onSelect={() => (onClose(), remove.mutate(localIdOf(track.videoId)))}>
        Remove from Local Files
      </MenuItem>
    </>
  );
}

function TrackMenuItems({ track, onClose, edit, onCredits }: { track: Track; onClose: () => void; edit?: PlaylistEdit | undefined; onCredits: () => void }) {
  const [view, setView] = useState<'main' | 'playlists' | 'artists'>('main');
  const signedIn = useSignedIn();
  const navigate = useNavigate();
  const go = (to: string) => {
    onClose();
    void navigate(to);
  };
  const artists = track.artists.filter((a): a is { name: string; id: string } => !!a.id);
  // Every hook above the early returns below: the menu swaps between its views, and a view that returns early must not skip any.
  const pins = usePins((p) => p.items);
  const pinned = isPinned(pins, { kind: 'song', id: track.videoId });
  const playing = usePlayer((p) => p.nowPlaying?.videoId === track.videoId);
  const showNerdStats = usePlayer((p) => p.showNerdStats);
  if (view === 'playlists') {
    return <PlaylistChoices videoId={track.videoId} onDone={onClose} onBack={() => setView('main')} />;
  }
  if (view === 'artists') {
    return <ArtistChoices artists={artists} onBack={() => setView('main')} onGo={(id) => go(artistHref(id)!)} />;
  }
  const { playNext, addToQueue, playTrack, setShowNerdStats } = usePlayer.getState();
  const albumId = track.album?.id ?? null;
  if (isLocalId(track.videoId)) return <LocalItems track={track} onClose={onClose} />;
  return (
    <>
      <MenuItem icon={<Radio size={15} />} onSelect={() => (onClose(), playTrack(track, { title: `${track.title} Mix`, type: 'radio' }))}>
        Start Mix
      </MenuItem>
      <MenuItem icon={<ListStart size={15} />} onSelect={() => (onClose(), playNext([track]))}>
        Play Next
      </MenuItem>
      <MenuItem icon={<ListEnd size={15} />} onSelect={() => (onClose(), addToQueue([track]))}>
        Add to Queue
      </MenuItem>
      {signedIn && <AccountItems track={track} onClose={onClose} onPlaylists={() => setView('playlists')} />}
      {signedIn && edit && <EditItems track={track} edit={edit} onClose={onClose} />}
      <MenuSeparator />
      {albumId && (
        <MenuItem icon={<Disc3 size={15} />} onSelect={() => go(albumHref(albumId)!)}>
          Go to Album
        </MenuItem>
      )}
      {artists.length > 0 && (
        <MenuItem
          icon={<User size={15} />}
          trailing={artists.length > 1 ? <ChevronRight size={14} /> : undefined}
          onSelect={() => (artists.length > 1 ? setView('artists') : go(artistHref(artists[0]!.id)!))}
        >
          Go to Artist
        </MenuItem>
      )}
      <MenuItem icon={<UsersRound size={15} />} onSelect={() => (onClose(), onCredits())}>
        Show Credits
      </MenuItem>
      <MenuItem icon={<Link2 size={15} />} onSelect={() => (onClose(), copyLink(songLink(track.videoId)))}>
        Share
      </MenuItem>
      <MenuItem icon={pinned ? <PinOff size={15} /> : <Pin size={15} />} onSelect={() => (onClose(), usePins.getState().toggle(songItem(track)), toast(pinned ? 'Unpinned' : 'Pinned to Listen Again'))}>
        {pinned ? 'Unpin from Listen Again' : 'Pin to Listen Again'}
      </MenuItem>
      {playing && (
        <MenuItem icon={<Activity size={15} />} checked={showNerdStats} onSelect={() => (onClose(), setShowNerdStats(!showNerdStats))}>
          Stats for Nerds
        </MenuItem>
      )}
      {/* YouTube's report form is on its own pages: the song opens there, where its menu has Report. */}
      <MenuItem icon={<Flag size={15} />} onSelect={() => (onClose(), void window.open(songLink(track.videoId), '_blank'))}>
        Report
      </MenuItem>
      {/* Only for songs that came from YouTube Music's feed, which is the only place it offers these. */}
      {signedIn && track.feedback && (
        <>
          <MenuSeparator />
          <FeedbackItems feedback={track.feedback} onClose={onClose} hide={{ song: track.videoId, artist: artists[0] }} />
        </>
      )}
    </>
  );
}

/**
 * The ⋯ button at the end of a track row (report §14): Play Next and Add to
 * Queue for everyone; Favorite and Add to Playlist signed in.
 */
export function TrackMenu({
  track,
  className,
  placement,
  onOpenChange,
  edit,
}: {
  track: Track;
  className?: string;
  /** Set on rows of the account's own playlists: adds Move and Remove. */
  edit?: PlaylistEdit | undefined;
  /** Where the menu opens from the button; the player's sit at the bottom of the window. */
  placement?: MenuPlacement;
  /** Told when the menu opens and closes; most mounts don't need to know. */
  onOpenChange?: (open: boolean) => void;
}) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [credits, setCredits] = useState(false);
  const close = useCallback(() => setAnchor(null), []);
  useEffect(() => {
    onOpenChange?.(anchor !== null);
  }, [anchor, onOpenChange]);
  return (
    <>
      <button
        className={className}
        aria-label={`More options for ${track.title}`}
        aria-haspopup="menu"
        aria-expanded={anchor !== null}
        data-open={anchor !== null || undefined}
        onClick={(event) => {
          event.stopPropagation();
          setAnchor(anchor ? null : event.currentTarget);
        }}
        onDoubleClick={(event) => event.stopPropagation()}
      >
        <MoreHorizontal size={18} strokeWidth={2} />
      </button>
      {anchor && (
        <Menu anchor={anchor} placement={placement} onClose={close} label={track.title}>
          <TrackMenuItems track={track} onClose={close} edit={edit} onCredits={() => setCredits(true)} />
        </Menu>
      )}
      {credits && <CreditsModal track={track} onClose={() => setCredits(false)} />}
    </>
  );
}
