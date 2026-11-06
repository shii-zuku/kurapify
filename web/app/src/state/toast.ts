import { create } from 'zustand';

/** A short line at the foot of the window to say an action took ("Link copied"): one at a time, gone after a moment. */
interface Toast {
  message: string | null;
  /** Changes with every message, so one shown twice in a row restarts. */
  id: number;
  show: (message: string) => void;
}

let timer: ReturnType<typeof setTimeout> | undefined;

export const useToast = create<Toast>()((set) => ({
  message: null,
  id: 0,
  show: (message) => {
    clearTimeout(timer);
    set((s) => ({ message, id: s.id + 1 }));
    timer = setTimeout(() => set({ message: null }), 2400);
  },
}));

export const toast = (message: string) => useToast.getState().show(message);
