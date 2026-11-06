import { Ban, CircleMinus } from 'lucide-react';
import { MenuItem } from '@/components/Menu';
import { sendLibraryFeedback } from '@/data/music/api';
import { trackLog } from '@/playback/trackLog';
import type { FeedbackTokens, MusicItem } from '@/data/music/types';
import { useHidden } from '@/state/hidden';
import { toast } from '@/state/toast';

/**
 * "Not interested" and "Don't recommend artist", for an item of YouTube Music's own feed: each sends the item's token to
 * YouTube Music, and on success the item (or the artist) goes from this screen too. They appear only where YouTube Music
 * offers them, which is only on some of its pages: an item that carries no token gets neither.
 */
export function FeedbackItems({
  feedback,
  onClose,
  hide,
}: {
  feedback: FeedbackTokens;
  onClose: () => void;
  /** What goes from view on success: a song, or any other item, and the artist. */
  hide: { song?: string; item?: Pick<MusicItem, 'kind' | 'id'>; artist?: { id: string; name: string } | undefined };
}) {
  // Sent directly, not through a mutation hook: the menu closes at once and takes this component with it, and a
  // mutation's per-call callbacks are dropped when its component unmounts, which left no word and nothing hidden.
  const sendToken = (token: string, done: () => void, said: string) => {
    onClose();
    sendLibraryFeedback(token).then(
      () => {
        done();
        toast(said);
        trackLog.i('feedback sent to YouTube Music');
      },
      (error: unknown) => {
        toast('YouTube Music didn’t take that. Try again in a moment.');
        trackLog.w(`feedback failed: ${error instanceof Error ? error.message : String(error)}`);
      },
    );
  };
  const { hideSong, hideItem, hideArtist } = useHidden.getState();
  return (
    <>
      {feedback.notInterested && (
        <MenuItem
          icon={<Ban size={15} />}
          onSelect={() =>
            sendToken(
              feedback.notInterested!,
              () => (hide.song ? hideSong(hide.song) : hide.item ? hideItem(hide.item) : undefined),
              'Got it. YouTube Music will show you less like this.',
            )
          }
        >
          Not Interested
        </MenuItem>
      )}
      {feedback.dontRecommendArtist && (
        <MenuItem
          icon={<CircleMinus size={15} />}
          onSelect={() => sendToken(feedback.dontRecommendArtist!, () => hide.artist && hideArtist(hide.artist), 'Got it. YouTube Music won’t recommend this artist.')}
        >
          Don’t Recommend Artist
        </MenuItem>
      )}
    </>
  );
}
