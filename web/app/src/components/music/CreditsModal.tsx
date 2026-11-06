import { useCredits } from '@/data/music/queries';
import type { Track } from '@/data/music/types';
import { DescriptionModal } from './DescriptionModal';

/** "Show credits": who performed, wrote and produced the song, as YouTube Music lists them. */
export function CreditsModal({ track, onClose }: { track: Track; onClose: () => void }) {
  const credits = useCredits(track, true);
  return (
    <DescriptionModal title="Song Credits" subtitle={[track.title, track.artists.map((a) => a.name).join(', ')].filter(Boolean).join(' — ')} onClose={onClose}>
      {credits.isPending && <p className="text-secondary">Loading…</p>}
      {credits.isError && <p className="text-secondary">Couldn’t load the credits.</p>}
      {credits.data?.sections.length === 0 && <p className="text-secondary">YouTube Music has no credits for this song.</p>}
      <div className="flex flex-col gap-5">
        {credits.data?.sections.map((section) => (
          <section key={section.role}>
            <h3 className="type-callout-emphasized text-secondary">{section.role}</h3>
            <p className="mt-1">{section.names.join('\n')}</p>
          </section>
        ))}
      </div>
    </DescriptionModal>
  );
}
