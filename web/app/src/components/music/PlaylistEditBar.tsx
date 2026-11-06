import { useState } from 'react';
import { useNavigate } from 'react-router';
import { useDeletePlaylist, useRenamePlaylist } from '@/data/music/queries';

const button =
  'rounded-full px-3.5 py-1.5 type-callout-emphasized text-key hover:bg-quinary disabled:opacity-50 disabled:hover:bg-transparent';

/**
 * Rename and delete, for a playlist the signed-in account owns. (Electron has no
 * window.prompt or confirm, so both are small inline forms.)
 */
export function PlaylistEditBar({ playlistId, title }: { playlistId: string; title: string }) {
  const rename = useRenamePlaylist();
  const remove = useDeletePlaylist();
  const navigate = useNavigate();
  const [mode, setMode] = useState<'idle' | 'rename' | 'delete'>('idle');
  const [name, setName] = useState(title);
  const error = rename.isError || remove.isError;

  return (
    <div className="mx-(--body-gutter) mb-4 flex flex-wrap items-center gap-2 px-3" role="toolbar" aria-label="Edit playlist">
      {mode === 'idle' && (
        <>
          <button
            className={button}
            onClick={() => {
              setName(title);
              setMode('rename');
            }}
          >
            Rename
          </button>
          <button className={button} onClick={() => setMode('delete')}>
            Delete Playlist
          </button>
        </>
      )}
      {mode === 'rename' && (
        <form
          className="flex items-center gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            const next = name.trim();
            if (!next || next === title) return setMode('idle');
            rename.mutate({ playlistId, name: next }, { onSuccess: () => setMode('idle') });
          }}
        >
          <input
            className="w-64 rounded-md bg-quinary px-3 py-1.5 type-body text-primary outline-none focus-visible:ring-2 focus-visible:ring-[var(--keyColor,#fa233b)]"
            value={name}
            maxLength={150}
            autoFocus
            aria-label="Playlist name"
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => event.key === 'Escape' && setMode('idle')}
          />
          <button className={button} type="submit" disabled={rename.isPending || !name.trim()}>
            Save
          </button>
          <button className={button} type="button" onClick={() => setMode('idle')}>
            Cancel
          </button>
        </form>
      )}
      {mode === 'delete' && (
        <>
          <span className="type-callout text-secondary">Delete “{title}” for good?</span>
          <button
            className={button}
            disabled={remove.isPending}
            onClick={() => remove.mutate({ playlistId }, { onSuccess: () => void navigate('/home') })}
          >
            Delete
          </button>
          <button className={button} onClick={() => setMode('idle')}>
            Cancel
          </button>
        </>
      )}
      {error && <span className="type-callout text-secondary">YouTube Music didn’t accept that change.</span>}
    </div>
  );
}
