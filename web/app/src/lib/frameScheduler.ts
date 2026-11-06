import { onWindowVisibility, windowHidden } from './windowVisibility';

/**
 * requestAnimationFrame for loops that only paint something: it waits while the window is hidden (minimised, or behind
 * another) and, if asked, lets a frame through only every so often. The desktop window keeps its pages unthrottled so
 * the music never stops, which also keeps every animation loop running in a window nobody can see; these don't.
 *
 * One scheduler per loop: `request(tick)` arms the next frame (and replaces any already armed), `cancel()` stops it.
 * A tick re-arms itself with request() as it would with requestAnimationFrame.
 */
export function frameScheduler(defaultEveryMs = 0) {
  let handle = 0;
  let waiting: (() => void) | null = null;
  let stopWaiting: (() => void) | null = null;
  let last = -Infinity;

  const cancel = () => {
    if (handle) cancelAnimationFrame(handle);
    handle = 0;
    stopWaiting?.();
    stopWaiting = null;
    waiting = null;
  };

  const request = (callback: (now: number) => void, everyMs = defaultEveryMs) => {
    cancel();
    const arm = () => {
      if (windowHidden()) {
        waiting = () => {
          if (windowHidden()) return;
          cancel();
          arm();
        };
        stopWaiting = onWindowVisibility(waiting);
        return;
      }
      handle = requestAnimationFrame((now) => {
        handle = 0;
        if (now - last < everyMs - 2) return arm();
        last = now;
        callback(now);
      });
    };
    arm();
  };

  return { request, cancel };
}
