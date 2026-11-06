import { lazy, Suspense } from 'react';
import { CommentsView } from '@/components/music/CommentsView';
import { usePlayer } from '@/state/player';
import { useUi } from '@/state/ui';
import { UpNext } from './UpNext';

// am-lyrics is large; it loads the first time the panel opens (prompt §3).
const LyricsPanel = lazy(() => import('./LyricsPanel').then((m) => ({ default: m.LyricsPanel })));

/** Up Next / Lyrics glass panel (report §7). */
export function SidePanel() {
  const panel = useUi((s) => s.sidePanel);
  const videoId = usePlayer((s) => s.nowPlaying?.videoId ?? null);
  // Hidden under the full-screen player, which has its own lyrics: one am-lyrics at a time.
  const fullScreen = useUi((s) => s.fullScreen);
  if (!panel || fullScreen) return null;

  return (
    <aside
      className="absolute inset-y-0 right-0 z-(--z-web-chrome) flex w-(--side-panel-width) animate-slide-in flex-col glass-material pt-10 shadow-glass max-sm:w-full max-sm:pt-0"
      aria-label={panel === 'up-next' ? 'Up Next' : panel === 'comments' ? 'Comments' : 'Lyrics'}
    >
      {panel === 'up-next' ? (
        <UpNext />
      ) : panel === 'comments' ? (
        <CommentsView videoId={videoId} />
      ) : (
        <Suspense fallback={null}>
          <LyricsPanel />
        </Suspense>
      )}
    </aside>
  );
}
