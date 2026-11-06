import { create } from 'zustand';

/** What was searched for, newest first: the field lists these when it is focused and empty. */
const KEY = 'kurapify:search-history';
const LIMIT = 15;

function stored(): string[] {
  try {
    const value = JSON.parse(localStorage.getItem(KEY) ?? '[]') as unknown;
    return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string').slice(0, LIMIT) : [];
  } catch {
    return [];
  }
}

function save(items: string[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(items));
  } catch {
    // kept for this session only
  }
}

interface SearchHistory {
  items: string[];
  /** A search made: it moves to the top, case aside. */
  add: (query: string) => void;
  remove: (query: string) => void;
  clear: () => void;
}

export const useSearchHistory = create<SearchHistory>()((set, get) => ({
  items: stored(),
  add: (query) => {
    const text = query.trim();
    if (!text) return;
    const items = [text, ...get().items.filter((q) => q.toLowerCase() !== text.toLowerCase())].slice(0, LIMIT);
    save(items);
    set({ items });
  },
  remove: (query) => {
    const items = get().items.filter((q) => q !== query);
    save(items);
    set({ items });
  },
  clear: () => {
    save([]);
    set({ items: [] });
  },
}));
