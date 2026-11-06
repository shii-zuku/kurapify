import { useEffect, useState } from 'react';

interface WindowState {
  maximized: boolean;
  fullScreen: boolean;
}

/** The desktop app's window, as its preload hands it over (desktop/preload.js); absent in a browser. */
interface DesktopWindow {
  act: (action: 'minimize' | 'toggle-maximize' | 'close' | 'state') => Promise<WindowState | null>;
  onState: (listener: (state: WindowState) => void) => () => void;
}

const desktop = (): DesktopWindow | undefined => (window as unknown as { kurapifyWindow?: DesktopWindow }).kurapifyWindow;

const button =
  'grid h-7 w-[42px] place-items-center rounded-[9px] text-secondary transition-[background-color,color] duration-150 [-webkit-app-region:no-drag] hover:bg-quinary hover:text-primary active:bg-quaternary';

/** Drawn with round caps and joins at a hairline, to sit with the rest of the app's glyphs rather than the system's. */
const glyph = { width: 12, height: 12, viewBox: '0 0 12 12', fill: 'none', stroke: 'currentColor', strokeWidth: 1.25, strokeLinecap: 'round', strokeLinejoin: 'round' } as const;

/**
 * Minimise, maximise (or restore) and close, in the window's top-right corner: the window has no frame, so these are
 * the page's own. They leave a strip along the top free to drag the window by (main.js reserves --wco-right for them).
 */
export function WindowControls() {
  const [state, setState] = useState<WindowState>({ maximized: false, fullScreen: false });
  const api = desktop();
  useEffect(() => {
    if (!api) return;
    void api.act('state').then((s) => s && setState(s));
    return api.onState(setState);
  }, [api]);
  if (!api) return null;
  // In full screen the system takes the corner, and there is nothing to minimise out of.
  if (state.fullScreen) return null;
  return (
    <div className="fixed top-1.5 right-2 z-[2147483647] flex gap-0.5 [-webkit-app-region:no-drag]" role="group" aria-label="Window controls">
      <button className={button} aria-label="Minimize" title="Minimize" onClick={() => void api.act('minimize')}>
        <svg {...glyph} aria-hidden="true">
          <path d="M2 6.5h8" />
        </svg>
      </button>
      <button className={button} aria-label={state.maximized ? 'Restore' : 'Maximize'} title={state.maximized ? 'Restore' : 'Maximize'} onClick={() => void api.act('toggle-maximize')}>
        <svg {...glyph} aria-hidden="true">
          {state.maximized ? (
            <>
              <rect x="2.25" y="3.75" width="6" height="6" rx="1.4" />
              <path d="M4 2.25h4.1a1.65 1.65 0 0 1 1.65 1.65V8" />
            </>
          ) : (
            <rect x="2" y="2" width="8" height="8" rx="2" />
          )}
        </svg>
      </button>
      <button
        className={`${button} hover:bg-[#e5314a] hover:text-white active:bg-[#c92a40]`}
        aria-label="Close"
        title="Close"
        onClick={() => void api.act('close')}
      >
        <svg {...glyph} aria-hidden="true">
          <path d="M2.5 2.5l7 7M9.5 2.5l-7 7" />
        </svg>
      </button>
    </div>
  );
}
