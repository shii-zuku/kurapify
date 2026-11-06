import { ChevronLeft, ChevronRight, Link2, ListEnd, ListPlus, ListStart, MoreHorizontal, Pin, PinOff, Plus, Radio, Search, Shuffle } from 'lucide-react';
import { useCallback, useState } from 'react';
import { Menu, MenuHeader, MenuItem, MenuSeparator } from '@/components/Menu';
import { useAddTracksToPlaylist, useCreatePlaylist, usePlaylistOptions, useSignedIn } from '@/data/music/queries';
import type { MusicItem, Track } from '@/data/music/types';
import { usePlayer } from '@/state/player';
import { isPinned, usePins } from '@/state/pins';
import { toast } from '@/state/toast';
import { copyLink } from './TrackMenu';
import { detailButton } from './DetailHeader';
import { shuffleList, type ListContext } from './play';

/** "Save to Playlist" for a whole list: the account's playlists to put every song of it in, or a new one. */
function SaveChoices({ title, videoIds, onDone, onBack }: { title: string; videoIds: string[]; onDone: () => void; onBack: () => void }) {
  const options = usePlaylistOptions(videoIds[0] ?? '', true);
  const add = useAddTracksToPlaylist();
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
          create.mutate({ title, videoIds });
          onDone();
        }}
      >
        New Playlist
      </MenuItem>
      <MenuSeparator />
      <MenuHeader>Save to Playlist</MenuHeader>
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
      {options.data?.map((option) => (
        <MenuItem
          key={option.playlistId}
          onSelect={() => {
            add.mutate({ playlistId: option.playlistId, videoIds });
            onDone();
          }}
        >
          {option.title}
        </MenuItem>
      ))}
    </>
  );
}

/**
 * The ⋯ beside an album's or playlist's Shuffle and Play, as YouTube Music's list menu: Shuffle, Find in Playlist (a
 * playlist page), Start Mix, Play Next, Add to Queue, Save to Playlist (signed in), the link, and Pin. (Renaming and
 * deleting a playlist stay on its edit bar.)
 */
export function ListMenu({
  tracks,
  context,
  link,
  pin,
  onFind,
}: {
  tracks: Track[];
  context: ListContext;
  link: string | null;
  /** The list as a Home shelf item, to pin it. */
  pin?: MusicItem;
  /** Opens the page's search-in-list field. */
  onFind?: () => void;
}) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [view, setView] = useState<'main' | 'save'>('main');
  const close = useCallback(() => (setAnchor(null), setView('main')), []);
  const signedIn = useSignedIn();
  const pins = usePins((p) => p.items);
  const playable = tracks.filter((t) => !t.unavailable);
  const empty = playable.length === 0;
  const { playNext, addToQueue, playTrack } = usePlayer.getState();
  const pinned = pin ? isPinned(pins, pin) : false;
  return (
    <>
      <button
        className={detailButton.circle}
        aria-label="More options"
        aria-haspopup="menu"
        aria-expanded={anchor !== null}
        onClick={(event) => setAnchor(anchor ? null : event.currentTarget)}
      >
        <MoreHorizontal size={18} strokeWidth={2.2} />
      </button>
      {anchor && (
        <Menu anchor={anchor} placement="below-end" onClose={close} label="List options">
          {view === 'save' ? (
            <SaveChoices title={context.source.title} videoIds={playable.map((t) => t.videoId)} onDone={close} onBack={() => setView('main')} />
          ) : (
            <>
              <MenuItem icon={<Shuffle size={15} />} disabled={empty} onSelect={() => (close(), shuffleList(playable, context))}>
                Shuffle
              </MenuItem>
              {onFind && (
                <MenuItem icon={<Search size={15} />} onSelect={() => (close(), onFind())}>
                  Find in Playlist
                </MenuItem>
              )}
              <MenuItem
                icon={<Radio size={15} />}
                disabled={empty}
                onSelect={() => (close(), playTrack(playable[0]!, { title: `${context.source.title} Mix`, type: 'radio' }))}
              >
                Start Mix
              </MenuItem>
              <MenuItem icon={<ListStart size={15} />} disabled={empty} onSelect={() => (close(), playNext(playable))}>
                Play Next
              </MenuItem>
              <MenuItem icon={<ListEnd size={15} />} disabled={empty} onSelect={() => (close(), addToQueue(playable))}>
                Add to Queue
              </MenuItem>
              {signedIn && (
                <MenuItem icon={<ListPlus size={15} />} trailing={<ChevronRight size={14} />} disabled={empty} onSelect={() => setView('save')}>
                  Save to Playlist
                </MenuItem>
              )}
              <MenuSeparator />
              {link && (
                <MenuItem icon={<Link2 size={15} />} onSelect={() => (close(), copyLink(link))}>
                  Share
                </MenuItem>
              )}
              {pin && (
                <MenuItem icon={pinned ? <PinOff size={15} /> : <Pin size={15} />} onSelect={() => (close(), usePins.getState().toggle(pin), toast(pinned ? 'Unpinned' : 'Pinned to Listen Again'))}>
                  {pinned ? 'Unpin from Listen Again' : 'Pin to Listen Again'}
                </MenuItem>
              )}
            </>
          )}
        </Menu>
      )}
    </>
  );
}
