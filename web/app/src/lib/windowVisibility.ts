/**
 * Whether anyone can see the window. The desktop window keeps its pages unthrottled so the music never stops, and a
 * page kept like that goes on reporting `document.hidden === false`, and on painting at full rate, even minimised
 * (measured: 230+ frames a second in a minimised window). So the desktop app says when it is minimised
 * (preload's kurapifyWindow.onState), and everything that only paints something asks here.
 */
let minimized = false;
const listeners = new Set<() => void>();

/** True when the window is minimised or the page is hidden. */
export const windowHidden = (): boolean => document.hidden || minimized;

/** Calls [listener] whenever the window is hidden or shown again; returns how to stop. */
export function onWindowVisibility(listener: () => void): () => void {
  listeners.add(listener);
  document.addEventListener('visibilitychange', listener);
  return () => {
    listeners.delete(listener);
    document.removeEventListener('visibilitychange', listener);
  };
}

function setMinimized(next: boolean) {
  if (next === minimized) return;
  minimized = next;
  // CSS animations stop too (global.css).
  document.documentElement.toggleAttribute('data-minimized', minimized);
  listeners.forEach((listener) => listener());
}

interface DesktopWindow {
  act: (action: 'state') => Promise<{ minimized?: boolean } | null>;
  onState: (listener: (state: { minimized?: boolean }) => void) => () => void;
}

const desktop = (window as unknown as { kurapifyWindow?: DesktopWindow }).kurapifyWindow;
if (desktop) {
  desktop.onState((state) => setMinimized(!!state.minimized));
  void desktop.act('state').then((state) => setMinimized(!!state?.minimized));
}
