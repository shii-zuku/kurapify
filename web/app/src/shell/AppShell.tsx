import { lazy, Suspense, useEffect, useLayoutEffect, useRef } from 'react';
import { resumeSession } from '@/party/listenTogether';
import { startPartySync } from '@/party/partySync';
import { useDiscordPresence } from '@/playback/discordPresence';
import { startHistoryReporting } from '@/playback/historyReporting';
import { startLivePresence } from '@/playback/livePresence';
import { Outlet, useLocation, useNavigationType } from 'react-router';
import { PrefetchLink } from '@/components/PrefetchLink';
import { config } from '@/config';
import { useExtension } from '@/extension/useExtension';
import { isMobileBrowser } from '@/lib/platform';
import { useUi } from '@/state/ui';
import { useKeyboardShortcuts } from './useKeyboardShortcuts';
import { Banner, bannerButtonClass } from './Banner';
import { MobileTopBar } from './MobileTopBar';
import { PlayerBar } from './PlayerBar';
import { SidePanel } from './SidePanel';
import { Sidebar } from './Sidebar';
import { Toaster } from './Toaster';
import { WindowControls } from './WindowControls';

const mobile = isMobileBrowser();

// It carries am-lyrics; loaded the first time it opens, as the side panel's lyrics are.
const FullScreenPlayer = lazy(() => import('./FullScreenPlayer').then((m) => ({ default: m.FullScreenPlayer })));

/**
 * The app frame (report §1): glass sidebar, the scrolling page, the floating
 * player pill, the side panel, and the bottom band when there is one.
 */
export function AppShell() {
  useKeyboardShortcuts();
  useDiscordPresence();
  // Listen Together: pick a party back up after a reload, and keep the player in step with it.
  useEffect(() => {
    resumeSession();
    return startPartySync();
  }, []);
  // Plays into the account's YouTube Music history (Settings › Share Listening Activity).
  useEffect(() => startHistoryReporting(), []);
  // Counts this tab in the "listening now" figure beside the phone and PC apps.
  useEffect(() => startLivePresence(), []);
  const extension = useExtension();
  const bannerDismissed = useUi((s) => s.installBannerDismissed);
  const dismissBanner = useUi((s) => s.dismissInstallBanner);
  const fullScreen = useUi((s) => s.fullScreen);
  // The side panel is glass laid over the page's right edge; the page makes room for it instead of running under it.
  const location = useLocation();
  const { pathname } = location;
  const navigationType = useNavigationType();
  // One scroller serves every page, so a new page would start wherever the last one was left. Going forward starts at
  // the top; Back and Forward return to where that entry was.
  const scrolls = useRef(new Map<string, number>());
  useLayoutEffect(() => {
    const page = document.getElementById('scrollable-page');
    if (!page) return;
    const key = location.key;
    // While a position is being brought back, the page is shorter than it will be and the browser clamps what is set;
    // those clamped readings must not overwrite the position being restored.
    let restoring = false;
    let cancelled = false;
    if (navigationType === 'POP') {
      const wanted = scrolls.current.get(key) ?? 0;
      let frames = 0;
      restoring = wanted > 0;
      const restore = () => {
        if (cancelled) return;
        page.scrollTop = wanted;
        // The page may still be loading in: keep trying until it is tall enough, for a few seconds.
        if (Math.abs(page.scrollTop - wanted) > 2 && frames++ < 240) requestAnimationFrame(restore);
        else restoring = false;
      };
      restore();
    } else page.scrollTop = 0;
    const onScroll = () => {
      if (!restoring) scrolls.current.set(key, page.scrollTop);
    };
    // The reader taking over (wheel, touch, keys) ends the restore: from then on what they scroll to is what counts.
    const takeOver = () => {
      restoring = false;
      cancelled = true;
    };
    page.addEventListener('scroll', onScroll, { passive: true });
    page.addEventListener('wheel', takeOver, { passive: true });
    page.addEventListener('pointerdown', takeOver, { passive: true });
    return () => {
      cancelled = true;
      page.removeEventListener('scroll', onScroll);
      page.removeEventListener('wheel', takeOver);
      page.removeEventListener('pointerdown', takeOver);
    };
  }, [location.key, navigationType]);
  const panelOpen = useUi((s) => s.sidePanel !== null && !s.fullScreen);

  let banner = null;
  if (mobile) {
    banner = (
      <Banner
        title="Kurapify is better in the app."
        detail="Phone browsers can’t run the Kurapify extension. The Android app has everything."
        action={
          <a className={bannerButtonClass} href={config.androidAppUrl} target="_blank" rel="noreferrer">
            Get the App
          </a>
        }
      />
    );
  } else if (extension.state === 'missing' && !bannerDismissed) {
    banner = (
      <Banner
        title="Play YouTube Music with the Kurapify extension."
        detail="Playback, YouTube Music sign-in, Spotify and Discord need the extension. Addons and lyrics work without it."
        action={
          <PrefetchLink className={bannerButtonClass} to="/extension">
            Get the Extension
          </PrefetchLink>
        }
        onDismiss={dismissBanner}
      />
    );
  }

  return (
    <div className="grid h-full grid-rows-[minmax(0,1fr)_auto]">
      {/* The side panel slides in from beyond the right edge; never let it scroll the page. */}
      <div className="relative min-h-0 overflow-hidden">
        <Sidebar />
        <MobileTopBar />
        {/* The page scrolls under the fixed sidebar and the floating player. */}
        <main
          id="scrollable-page"
          data-panel-open={panelOpen}
          className="absolute inset-x-0 top-0 bottom-(--player-reserve) overflow-x-hidden overflow-y-auto pl-(--web-navigation-width) max-sm:bottom-0 transition-[padding-inline-end] duration-(--duration-panel) ease-panel data-[panel-open=true]:pe-(--side-panel-width) max-sm:data-[panel-open=true]:pe-0 [scrollbar-gutter:stable] data-tint:bg-(--page-tint) data-tint:transition-[background-color] data-tint:duration-300 data-tint:ease-in max-sm:pt-(--mobile-top-bar-height) max-sm:pl-0"
        >
          {/* The player bar has its own row under the page: only some air at the foot. */}
          <div className="min-h-full pb-10">
            <div key={pathname} className="animate-page-in">
              <Outlet />
            </div>
          </div>
        </main>
        <PlayerBar />
        <SidePanel />
        <WindowControls />
        <Toaster />
      </div>
      {banner}
      {fullScreen && (
        <Suspense fallback={null}>
          <FullScreenPlayer />
        </Suspense>
      )}
    </div>
  );
}
