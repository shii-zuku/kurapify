import { FolderPlus, Play, Plus, Shuffle } from 'lucide-react';
import { useMemo } from 'react';
import { PageHeader } from '@/components/PageHeader';
import { EmptyState } from '@/components/music/States';
import { TrackList } from '@/components/music/TrackList';
import { trackOfLocal, useAddLocalFiles, useLocalFiles, useLocalSupported } from '@/data/local/localFiles';
import { toast } from '@/state/toast';
import { usePlayer } from '@/state/player';
import { seeAllTracks } from './pageStyles';

const SOURCE = { title: 'Local Files', type: 'library', id: 'local' } as const;
const button =
  'inline-flex h-8 items-center gap-1.5 rounded-full bg-quinary px-3.5 type-callout-emphasized text-primary transition-colors hover:bg-quaternary disabled:opacity-50';

/** Your own music: audio files and folders from this computer, played in the same player as everything else. */
export default function LocalFilesPage() {
  const supported = useLocalSupported();
  const files = useLocalFiles();
  const add = useAddLocalFiles();
  const tracks = useMemo(() => (files.data ?? []).map((file, i) => trackOfLocal(file, i + 1)), [files.data]);

  if (!supported) {
    return (
      <>
        <PageHeader title="Local Files" />
        <EmptyState title="Needs the desktop app" detail="Your own music files can be added in Kurapify Desktop." />
      </>
    );
  }

  const pick = (folder: boolean) => {
    const before = files.data?.length ?? 0;
    add.mutate(folder, {
      onSuccess: (after) => {
        const added = after.length - before;
        if (added > 0) toast(added === 1 ? 'Added 1 song' : `Added ${added} songs`);
      },
      onError: (error) => toast(error instanceof Error ? error.message : 'Couldn’t add music'),
    });
  };
  const play = (shuffled: boolean) => {
    const list = shuffled ? [...tracks].sort(() => Math.random() - 0.5) : tracks;
    usePlayer.getState().playTracks(list, 0, SOURCE);
  };

  return (
    <>
      <PageHeader title="Local Files" />
      <div className="mx-(--body-gutter) mt-4 flex flex-wrap items-center gap-2">
        <button className={button} disabled={add.isPending} onClick={() => pick(false)}>
          <Plus size={15} />
          Add Music
        </button>
        <button className={button} disabled={add.isPending} onClick={() => pick(true)}>
          <FolderPlus size={15} />
          Add Folder
        </button>
        {tracks.length > 0 && (
          <>
            <button className={button} onClick={() => play(false)}>
              <Play size={14} fill="currentColor" />
              Play
            </button>
            <button className={button} onClick={() => play(true)}>
              <Shuffle size={14} />
              Shuffle
            </button>
            <span className="ml-1 type-callout text-secondary">{tracks.length === 1 ? '1 song' : `${tracks.length} songs`}</span>
          </>
        )}
      </div>
      {files.isPending ? null : tracks.length === 0 ? (
        <EmptyState
          title="No music added yet"
          detail="Add songs or a whole folder from this computer: MP3, FLAC, M4A, WAV, Ogg, Opus and more. They play here with their own covers and tags, and with lyrics where they can be found."
        />
      ) : (
        <div className={seeAllTracks}>
          <TrackList tracks={tracks} variant="playlist" source={SOURCE} />
        </div>
      )}
    </>
  );
}
