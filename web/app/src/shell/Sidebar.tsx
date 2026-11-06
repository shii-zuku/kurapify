import { ArrowDown, ArrowUp, ChevronRight, Folder, FolderPlus, HardDrive, ListMusic, MoreHorizontal, Settings } from 'lucide-react';
import { useCallback, useRef, useState } from 'react';
import { MdOutlineExtension } from 'react-icons/md';
import { PrefetchLink, PrefetchNavLink } from '@/components/PrefetchLink';
import { Menu, MenuHeader, MenuItem, MenuSeparator } from '@/components/Menu';
import { LogoMark } from '@/components/icons/LogoMark';
import { BackButton } from './BackButton';
import {
  AlbumsIcon,
  AllPlaylistsIcon,
  ArtistsIcon,
  HomeIcon,
  MadeForYouIcon,
  NewIcon,
  RecentlyAddedIcon,
  SearchIcon,
  SongsIcon,
  type NavIconProps,
} from '@/components/icons/NavIcons';
import { hrefFor } from '@/components/music/links';
import { config } from '@/config';
import { LIBRARY_SECTIONS, type LibrarySection } from '@/data/music/library';
import type { MusicItem } from '@/data/music/types';
import { useLocalSupported } from '@/data/local/localFiles';
import { useLibraryPlaylists, useSignedIn } from '@/data/music/queries';
import { useSpotifyPlaylists } from '@/data/spotify/queries';
import { useExtensionUpdate } from '@/extension/useExtensionUpdate';
import { useSpotifySignedIn } from '@/extension/useSpotifyAuth';
import { bareId, inOrder, usePlaylistFolders, type PlaylistFolder } from '@/state/playlistFolders';
import { useUi } from '@/state/ui';
import { AccountButton } from './AccountButton';

/** Your own files: a drive, in the weight and place of the other library glyphs. */
const LocalFilesIcon = ({ size = 20, className }: NavIconProps) => <HardDrive size={size - 3} strokeWidth={1.9} className={className} aria-hidden="true" />;

interface NavItem {
  to: string;
  label: string;
  Icon: (props: NavIconProps) => React.ReactNode;
}

const PRIMARY: NavItem[] = [
  { to: '/search', label: 'Search', Icon: SearchIcon },
  { to: '/home', label: 'Home', Icon: HomeIcon },
  { to: '/new', label: 'New', Icon: NewIcon },
];

const LIBRARY_ICONS: Record<Exclude<LibrarySection, 'playlists'>, NavItem['Icon']> = {
  recent: RecentlyAddedIcon,
  artists: ArtistsIcon,
  albums: AlbumsIcon,
  songs: SongsIcon,
  'made-for-you': MadeForYouIcon,
};

const LIBRARY: NavItem[] = (Object.keys(LIBRARY_ICONS) as (keyof typeof LIBRARY_ICONS)[]).map((section) => ({
  to: `/library/${section}`,
  label: LIBRARY_SECTIONS[section].title,
  Icon: LIBRARY_ICONS[section],
}));

// Your own files, which the desktop app adds from disk: there with or without a sign-in.
const LOCAL: NavItem[] = [{ to: '/local', label: 'Local Files', Icon: LocalFilesIcon }];

// A sidebar row: roomy, quiet, and only the page you are on takes a fill.
const item =
  'group flex h-8 items-center gap-2.5 mb-px rounded-[8px] px-2.5 type-body-reduced font-medium text-primary/90 transition-colors duration-150 hover:bg-quinary hover:text-primary aria-[current=page]:bg-nav-selected aria-[current=page]:text-primary';
// Icons: the pages' glyphs in the key colour, as Apple's are; playlists and folders in the quiet label colour.
const icon = 'inline-grid size-5 flex-none place-items-center text-secondary transition-colors duration-150 group-hover:text-primary group-aria-[current=page]:text-primary';
const iconKey = 'inline-grid size-5 flex-none place-items-center text-key';
const navLabel = 'min-w-0 truncate';
// "Library", "Playlists": small, spaced capitals in the faintest label colour.
const sectionHeader = 'mt-5 mb-1 px-2.5 type-[600_11px/14px] tracking-[0.07em] text-tertiary uppercase';
const list = 'flex flex-col';

function NavList({ items, onNavigate }: { items: NavItem[]; onNavigate: () => void }) {
  return (
    <ul className={list}>
      {items.map(({ to, label, Icon }) => (
        <li key={to}>
          <PrefetchNavLink to={to} className={item} onClick={onNavigate}>
            <Icon size={20} className={iconKey} />
            <span className={navLabel}>{label}</span>
          </PrefetchNavLink>
        </li>
      ))}
    </ul>
  );
}

const smallButton =
  'absolute top-1/2 right-1 hidden size-6 -translate-y-1/2 place-items-center rounded-full text-secondary hover:bg-quinary hover:text-primary group-hover/row:grid data-open:grid';

/** A folder's name, being typed: Enter keeps it, Escape keeps what it was. */
function NameField({ initial, onDone }: { initial: string; onDone: (name: string | null) => void }) {
  const [value, setValue] = useState(initial);
  const done = useRef(false);
  const finish = (name: string | null) => {
    if (done.current) return;
    done.current = true;
    onDone(name);
  };
  return (
    <input
      className="mb-0.5 h-8 w-full rounded-nav bg-quinary px-2 type-body-reduced text-primary outline-none focus-visible:ring-2 focus-visible:ring-key"
      value={value}
      autoFocus
      maxLength={60}
      aria-label="Folder name"
      onFocus={(e) => e.currentTarget.select()}
      onChange={(e) => setValue(e.target.value)}
      onBlur={() => finish(value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') finish(value);
        else if (e.key === 'Escape') finish(null);
      }}
    />
  );
}

const PLAYLIST_DRAG = 'text/kurapify-playlist';
const FOLDER_DRAG = 'text/kurapify-folder';
// Where a drop would land: a key-colour line along the top of the row.
const dropLine = 'data-over:shadow-[inset_0_2px_0_0_var(--keyColor)]';

/** One playlist: its link, a ⋯ to move it (to a folder, up or down), and draggable to where it should go. */
function PlaylistRow({
  playlist,
  folderId,
  loose,
  indented,
  onNavigate,
}: {
  playlist: MusicItem;
  /** The folder it is in, or null among the loose playlists. */
  folderId: string | null;
  /** The loose playlists' ids, in order: what a drop among them is placed in. */
  loose: string[];
  indented: boolean;
  onNavigate: () => void;
}) {
  const folders = usePlaylistFolders((s) => s.folders);
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [over, setOver] = useState(false);
  const close = useCallback(() => setAnchor(null), []);
  const bare = bareId(playlist.id);
  const current = folders.find((f) => f.playlistIds.includes(bare));
  const siblings = current ? current.playlistIds : loose;
  const at = siblings.indexOf(bare);
  const { assign, create, place, shift } = usePlaylistFolders.getState();
  return (
    <li
      className={`group/row relative rounded-[8px] ${dropLine}`}
      data-over={over || undefined}
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData(PLAYLIST_DRAG, bare);
        e.dataTransfer.effectAllowed = 'move';
      }}
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes(PLAYLIST_DRAG)) return;
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        setOver(false);
        const dragged = e.dataTransfer.getData(PLAYLIST_DRAG);
        if (!dragged) return;
        e.preventDefault();
        e.stopPropagation();
        place(dragged, bare, folderId, loose);
      }}
    >
      <PrefetchNavLink to={hrefFor(playlist) ?? '/library/playlists'} className={`${item} pr-7${indented ? ' ml-5' : ''}`} onClick={onNavigate}>
        <span className={icon}>
          <ListMusic size={16} strokeWidth={1.8} />
        </span>
        <span className={navLabel}>{playlist.title}</span>
      </PrefetchNavLink>
      <button
        className={smallButton}
        data-open={anchor !== null || undefined}
        aria-label={`Options for ${playlist.title}`}
        aria-haspopup="menu"
        onClick={(e) => setAnchor(anchor ? null : e.currentTarget)}
      >
        <MoreHorizontal size={15} />
      </button>
      {anchor && (
        <Menu anchor={anchor} placement="below-end" onClose={close} label={playlist.title}>
          <MenuItem icon={<ArrowUp size={15} />} disabled={at <= 0} onSelect={() => (close(), shift(playlist.id, -1, loose))}>
            Move Up
          </MenuItem>
          <MenuItem icon={<ArrowDown size={15} />} disabled={at < 0 || at >= siblings.length - 1} onSelect={() => (close(), shift(playlist.id, 1, loose))}>
            Move Down
          </MenuItem>
          <MenuSeparator />
          <MenuHeader>Move to Folder</MenuHeader>
          {folders.map((folder) => (
            <MenuItem
              key={folder.id}
              icon={<Folder size={15} />}
              checked={current?.id === folder.id}
              onSelect={() => (close(), assign(playlist.id, current?.id === folder.id ? null : folder.id))}
            >
              {folder.name}
            </MenuItem>
          ))}
          <MenuItem icon={<FolderPlus size={15} />} onSelect={() => (close(), create(playlist.id))}>
            New Folder…
          </MenuItem>
          {current && (
            <>
              <MenuSeparator />
              <MenuItem onSelect={() => (close(), assign(playlist.id, null))}>Remove from Folder</MenuItem>
            </>
          )}
        </Menu>
      )}
    </li>
  );
}

/** A folder row (it opens and closes, can be dragged to a new place, and takes playlists dropped on it) and, when open, the playlists in it. */
function FolderRow({ folder, playlists, loose, onNavigate }: { folder: PlaylistFolder; playlists: MusicItem[]; loose: string[]; onNavigate: () => void }) {
  const editing = usePlaylistFolders((s) => s.editingId === folder.id);
  const { toggle, rename, remove, edit, assign, moveFolder } = usePlaylistFolders.getState();
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [over, setOver] = useState<'into' | 'before' | null>(null);
  const close = useCallback(() => setAnchor(null), []);
  return (
    <li>
      {editing ? (
        <NameField initial={folder.name} onDone={(name) => (name === null ? edit(null) : rename(folder.id, name))} />
      ) : (
        <div
          className={`group/row relative rounded-[8px] data-[over=into]:bg-nav-selected data-[over=before]:shadow-[inset_0_2px_0_0_var(--keyColor)]`}
          data-over={over ?? undefined}
          draggable
          onDragStart={(e) => {
            e.dataTransfer.setData(FOLDER_DRAG, folder.id);
            e.dataTransfer.effectAllowed = 'move';
          }}
          onDragOver={(e) => {
            const types = e.dataTransfer.types;
            if (types.includes(PLAYLIST_DRAG)) setOver('into');
            else if (types.includes(FOLDER_DRAG)) setOver('before');
            else return;
            e.preventDefault();
          }}
          onDragLeave={() => setOver(null)}
          onDrop={(e) => {
            setOver(null);
            const playlist = e.dataTransfer.getData(PLAYLIST_DRAG);
            const dragged = e.dataTransfer.getData(FOLDER_DRAG);
            e.stopPropagation();
            if (playlist) {
              e.preventDefault();
              assign(playlist, folder.id);
            } else if (dragged) {
              e.preventDefault();
              moveFolder(dragged, folder.id);
            }
          }}
        >
          <button className={`${item} w-full pr-7 text-start`} aria-expanded={folder.open} onClick={() => toggle(folder.id)}>
            <span className={icon}>
              <ChevronRight size={14} strokeWidth={2.4} className={`transition-transform duration-200 ${folder.open ? 'rotate-90' : ''}`} />
            </span>
            <Folder size={15} className="-ml-1 flex-none text-secondary" />
            <span className={`${navLabel} flex-1`}>{folder.name}</span>
            <span className="type-callout text-tertiary">{playlists.length || ''}</span>
          </button>
          <button
            className={smallButton}
            data-open={anchor !== null || undefined}
            aria-label={`Options for ${folder.name}`}
            aria-haspopup="menu"
            onClick={(e) => setAnchor(anchor ? null : e.currentTarget)}
          >
            <MoreHorizontal size={15} />
          </button>
          {anchor && (
            <Menu anchor={anchor} placement="below-end" onClose={close} label={folder.name}>
              <MenuItem onSelect={() => (close(), edit(folder.id))}>Rename</MenuItem>
              <MenuItem destructive onSelect={() => (close(), remove(folder.id))}>
                Delete Folder
              </MenuItem>
            </Menu>
          )}
        </div>
      )}
      {folder.open && playlists.length > 0 && (
        <ul className={list}>
          {playlists.map((playlist) => (
            <PlaylistRow key={playlist.id} playlist={playlist} folderId={folder.id} loose={loose} indented onNavigate={onNavigate} />
          ))}
        </ul>
      )}
    </li>
  );
}

/** "Playlists": All Playlists, the folders, then what isn't in one. Dropping a playlist in the list's gaps puts it last among the loose ones. */
function PlaylistsNav({ onNavigate }: { onNavigate: () => void }) {
  const playlists = useLibraryPlaylists();
  const folders = usePlaylistFolders((s) => s.folders);
  const order = usePlaylistFolders((s) => s.order);
  const all = playlists.data ?? [];
  const filed = new Set(folders.flatMap((f) => f.playlistIds));
  const loosePlaylists = inOrder(
    all.filter((p) => !filed.has(bareId(p.id))),
    order,
  );
  const looseIds = loosePlaylists.map((p) => bareId(p.id));
  return (
    <>
      <div className="flex items-center justify-between">
        <h2 className={sectionHeader}>Playlists</h2>
        <button
          className="mt-4 grid size-6 place-items-center rounded-full text-secondary hover:bg-quinary hover:text-primary"
          aria-label="New Folder"
          title="New Folder"
          onClick={() => usePlaylistFolders.getState().create()}
        >
          <FolderPlus size={15} />
        </button>
      </div>
      <ul
        className={list}
        onDragOver={(e) => (e.dataTransfer.types.includes(PLAYLIST_DRAG) || e.dataTransfer.types.includes(FOLDER_DRAG)) && e.preventDefault()}
        onDrop={(e) => {
          const playlist = e.dataTransfer.getData(PLAYLIST_DRAG);
          const folder = e.dataTransfer.getData(FOLDER_DRAG);
          if (playlist) usePlaylistFolders.getState().place(playlist, null, null, looseIds);
          else if (folder) usePlaylistFolders.getState().moveFolder(folder, null);
        }}
      >
        <li>
          <PrefetchNavLink to="/library/playlists" className={item} onClick={onNavigate}>
            <AllPlaylistsIcon size={20} className={icon} />
            <span className={navLabel}>{LIBRARY_SECTIONS.playlists.title}</span>
          </PrefetchNavLink>
        </li>
        {folders.map((folder) => (
          <FolderRow
            key={folder.id}
            folder={folder}
            playlists={folder.playlistIds.map((id) => all.find((p) => bareId(p.id) === id)).filter((p): p is MusicItem => !!p)}
            loose={looseIds}
            onNavigate={onNavigate}
          />
        ))}
        {loosePlaylists.map((playlist) => (
          <PlaylistRow key={playlist.id} playlist={playlist} folderId={null} loose={looseIds} indented={false} onNavigate={onNavigate} />
        ))}
      </ul>
    </>
  );
}

/** Library and Playlists (report §1), once YouTube requests are made as the user. */
function LibraryNav({ onNavigate }: { onNavigate: () => void }) {
  return (
    <>
      <h2 className={sectionHeader}>Library</h2>
      <NavList items={LIBRARY} onNavigate={onNavigate} />
      <PlaylistsNav onNavigate={onNavigate} />
    </>
  );
}

/** Your own music files, in the desktop app. */
function LocalNav({ onNavigate }: { onNavigate: () => void }) {
  if (!useLocalSupported()) return null;
  return (
    <>
      <h2 className={sectionHeader}>On This Computer</h2>
      <NavList items={LOCAL} onNavigate={onNavigate} />
    </>
  );
}

/** Spotify's playlists, once the extension can read them as the user (prompt §7.1). */
function SpotifyNav({ onNavigate }: { onNavigate: () => void }) {
  const playlists = useSpotifyPlaylists();
  return (
    <>
      <h2 className={sectionHeader}>Spotify</h2>
      <ul className={list}>
        <li>
          <PrefetchNavLink to="/spotify" end className={item} onClick={onNavigate}>
            <AllPlaylistsIcon size={20} className={icon} />
            <span className={navLabel}>All Spotify Playlists</span>
          </PrefetchNavLink>
        </li>
        {playlists.data?.map((playlist, i) => (
          <li key={playlist.id}>
            <PrefetchNavLink
              to={`/spotify/playlist/${encodeURIComponent(playlist.id)}`}
              className={item}
              onClick={onNavigate}
            >
              <span className={icon}>
                <ListMusic size={17} strokeWidth={1.8} />
              </span>
              <span className={navLabel}>{playlist.name}</span>
            </PrefetchNavLink>
          </li>
        ))}
      </ul>
    </>
  );
}

/** The left glass sidebar (report §1). */
export function Sidebar() {
  const drawerOpen = useUi((s) => s.drawerOpen);
  const setDrawerOpen = useUi((s) => s.setDrawerOpen);
  const update = useExtensionUpdate();
  const signedIn = useSignedIn();
  const spotifySignedIn = useSpotifySignedIn();
  const close = () => setDrawerOpen(false);

  return (
    <>
      {/* Below 484px the sidebar is a drawer opened from the top bar's menu button. */}
      <nav
        className="absolute inset-y-0 left-0 z-(--z-web-chrome) flex w-(--web-navigation-width) flex-col border-r border-[var(--labelDivider)] bg-[color-mix(in_srgb,var(--pageBG)_93%,black)] max-sm:w-[min(300px,82vw)] max-sm:-translate-x-full max-sm:shadow-glass max-sm:transition-transform max-sm:duration-(--duration-panel) max-sm:ease-panel max-sm:data-[open=true]:translate-none"
        data-open={drawerOpen}
        aria-label="Main"
      >
        <div className="mt-2 ml-2 flex h-18 items-center justify-between pr-3 pl-5 [-webkit-app-region:drag]">
          <PrefetchLink to="/home" className="inline-flex items-center gap-2 rounded-[6px] [-webkit-app-region:no-drag]" aria-label="Kurapify, Home" onClick={close}>
            {/* White on dark, as Apple's own wordmark; it follows the label colour so it stays visible in light. */}
            <LogoMark size={22} className="text-primary" />
            <span className="type-[700_19px/24px] tracking-[-0.01em]">Kurapify</span>
          </PrefetchLink>
          <BackButton className="max-sm:hidden" />
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto pr-3 pl-5 [scrollbar-width:none]">
          <NavList items={PRIMARY} onNavigate={close} />
          {signedIn && <LibraryNav onNavigate={close} />}
          <LocalNav onNavigate={close} />
          {spotifySignedIn && <SpotifyNav onNavigate={close} />}
        </div>
        <div className="flex flex-col gap-2 pt-3 pr-3 pb-5 pl-5">
          <PrefetchNavLink to="/extension" className={item} onClick={close}>
            {/* Chrome's own toolbar glyph for extensions (Material "extension"). */}
            <span className={icon}>
              <MdOutlineExtension size={18} />
            </span>
            <span className={navLabel}>Kurapify Extension</span>
            {update.state === 'available' && (
              <span className="ml-auto rounded-[10px] bg-key px-[7px] py-0.5 type-subhead-emphasized text-white" title={`Version ${update.latest.version} is available`}>
                Update
              </span>
            )}
          </PrefetchNavLink>
          <AccountButton />
          <div className="flex items-center justify-end">
            <PrefetchNavLink to="/settings" className="grid size-7 place-items-center rounded-nav text-secondary hover:bg-quinary hover:text-primary aria-[current=page]:bg-quinary aria-[current=page]:text-primary" aria-label="Settings" title="Settings" onClick={close}>
              <Settings size={17} strokeWidth={1.9} />
            </PrefetchNavLink>
          </div>
        </div>
      </nav>
      {drawerOpen && <div className="absolute inset-0 z-[calc(var(--z-web-chrome)-1)] hidden bg-scrim max-sm:block" onClick={close} aria-hidden="true" />}
    </>
  );
}
