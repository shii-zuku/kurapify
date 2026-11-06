import { MoreHorizontal } from 'lucide-react';
import { useCallback, useState } from 'react';
import { Menu } from '@/components/Menu';
import { useSignedIn } from '@/data/music/queries';
import type { MusicItem } from '@/data/music/types';
import { FeedbackItems } from './FeedbackItems';

/** The ⋯ on a feed card that is not a song (an album, a playlist): YouTube Music's "Not interested" and "Don't recommend artist". */
export function FeedbackMenu({ item, className }: { item: MusicItem; className: string }) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const close = useCallback(() => setAnchor(null), []);
  const signedIn = useSignedIn();
  if (!signedIn || !item.feedback) return null;
  const artist = item.artists.find((a): a is { name: string; id: string } => !!a.id);
  return (
    <>
      <button
        className={className}
        aria-label={`More options for ${item.title}`}
        aria-haspopup="menu"
        aria-expanded={anchor !== null}
        data-open={anchor !== null || undefined}
        onClick={(event) => {
          event.stopPropagation();
          setAnchor(anchor ? null : event.currentTarget);
        }}
      >
        <MoreHorizontal size={18} strokeWidth={2} />
      </button>
      {anchor && (
        <Menu anchor={anchor} onClose={close} label={item.title}>
          <FeedbackItems feedback={item.feedback} onClose={close} hide={{ item, artist }} />
        </Menu>
      )}
    </>
  );
}
