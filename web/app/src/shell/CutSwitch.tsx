import { Clapperboard } from 'lucide-react';
import { useCuts } from '@/data/music/queries';
import { usePlayer } from '@/state/player';

/**
 * Song | Video: the catalogue recording or its music video, where there is one (YouTube Music's own pairing, else a
 * match by search). Switching keeps the place in the song and in the queue; the video's view count sits beside it.
 */
export function CutSwitch({ className }: { className?: string }) {
  const videoId = usePlayer((s) => s.nowPlaying?.videoId ?? null);
  const cuts = useCuts(videoId);
  const { song, video, videoViews } = cuts.data ?? { song: null, video: null, videoViews: null };
  if (!video) return null;
  const onVideo = videoId === video.videoId;
  // Without a catalogue cut to go back to, the switch has only the one side to show: the video's views.
  const option = (label: string, on: boolean, track: typeof video | null, title?: string) => (
    <button
      className="relative z-1 w-[68px] rounded-[8px] py-1 text-center type-callout-emphasized text-secondary transition-colors duration-300 aria-pressed:text-primary"
      aria-pressed={on}
      title={title}
      disabled={!track}
      onClick={() => track && !on && usePlayer.getState().swapCurrent(track)}
    >
      {label}
    </button>
  );
  return (
    <div className={`flex items-center gap-2.5 ${className ?? ''}`}>
      {song && (
        <div className="relative inline-flex rounded-[10px] bg-quinary p-0.5 [backdrop-filter:blur(20px)]" role="group" aria-label="Song or video">
          {/* The rounded block that slides under the chosen side. */}
          <span
            className="absolute inset-y-0.5 left-0.5 w-[calc(50%-2px)] rounded-[8px] bg-quaternary transition-transform duration-500 ease-panel"
            style={{ transform: onVideo ? 'translateX(100%)' : 'none' }}
            aria-hidden="true"
          />
          {option('Song', !onVideo, song)}
          {option('Video', onVideo, video, [video.title, videoViews].filter(Boolean).join(' · '))}
        </div>
      )}
      {videoViews && <span className="type-callout text-secondary tabular-nums">{videoViews}</span>}
    </div>
  );
}

/** The mini player's one-tap version: a clapperboard that swaps between the song and its music video. */
export function CutToggle({ className }: { className?: string }) {
  const videoId = usePlayer((s) => s.nowPlaying?.videoId ?? null);
  const cuts = useCuts(videoId);
  const { song, video, videoViews } = cuts.data ?? { song: null, video: null, videoViews: null };
  if (!video || !song) return null;
  const onVideo = videoId === video.videoId;
  return (
    <button
      className={className}
      aria-label={onVideo ? 'Play the song' : 'Play the music video'}
      aria-pressed={onVideo}
      title={onVideo ? 'Switch to the song' : videoViews ? `Music video · ${videoViews}` : 'Switch to the music video'}
      onClick={() => usePlayer.getState().swapCurrent(onVideo ? song : video)}
    >
      <Clapperboard size={17} fill={onVideo ? 'currentColor' : 'none'} />
    </button>
  );
}
