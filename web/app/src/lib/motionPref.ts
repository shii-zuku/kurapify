import { useSyncExternalStore } from 'react';

/**
 * Whether the app holds still. The system's "reduce motion" (on Windows, animation effects turned off) is often
 * switched off for speed rather than for comfort, and it silenced the artist header clips and every transition here,
 * so the app keeps a setting of its own: 'always' (the default) animates whatever the system says, 'system' obeys it.
 * It lands on <html data-reduce-motion>, which the stylesheet's reduced-motion rules and Tailwind's motion-reduce: key on.
 */
export type MotionPref = 'always' | 'system';

const KEY = 'kurapify:motion';
const media = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null;
const listeners = new Set<() => void>();

function stored(): MotionPref {
  try {
    return localStorage.getItem(KEY) === 'system' ? 'system' : 'always';
  } catch {
    return 'always';
  }
}

let pref = stored();

export const reducedNow = (): boolean => pref === 'system' && (media?.matches ?? false);

function apply() {
  document.documentElement.toggleAttribute('data-reduce-motion', reducedNow());
  listeners.forEach((l) => l());
}

export function setMotionPref(next: MotionPref): void {
  pref = next;
  try {
    localStorage.setItem(KEY, next);
  } catch {
    // kept for this session only
  }
  apply();
}

media?.addEventListener('change', apply);
apply();

const subscribe = (onChange: () => void) => {
  listeners.add(onChange);
  return () => listeners.delete(onChange);
};

export const useMotionPref = (): MotionPref => useSyncExternalStore(subscribe, () => pref);
export const useReducedMotion = (): boolean => useSyncExternalStore(subscribe, reducedNow);
