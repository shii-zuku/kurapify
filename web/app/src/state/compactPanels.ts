import { create } from 'zustand';

/**
 * How the lyrics and the comments over a music video in the full-screen player are laid out, each on its own:
 * whether it is compact (lyric lines at about two thirds of their size, comments with small type, avatars and
 * spacing, in a narrow pane) and which side of the video it sits on (Settings > Full-Screen Player). Beside the
 * artwork nothing of this applies; it is for the video only. Kept across sessions.
 */
export type PaneSide = 'left' | 'right';

const LYRICS = 'kurapify:compact-lyrics';
const COMMENTS = 'kurapify:compact-comments';
const LYRICS_SIDE = 'kurapify:lyrics-side';
const COMMENTS_SIDE = 'kurapify:comments-side';

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // kept for this session only
  }
}

const side = (key: string): PaneSide => (read(key) === 'left' ? 'left' : 'right');

interface CompactPanels {
  lyrics: boolean;
  comments: boolean;
  lyricsSide: PaneSide;
  commentsSide: PaneSide;
  toggleLyrics: () => void;
  toggleComments: () => void;
  setLyricsSide: (side: PaneSide) => void;
  setCommentsSide: (side: PaneSide) => void;
}

export const useCompactPanels = create<CompactPanels>()((set, get) => ({
  lyrics: read(LYRICS) === '1',
  comments: read(COMMENTS) === '1',
  lyricsSide: side(LYRICS_SIDE),
  commentsSide: side(COMMENTS_SIDE),
  toggleLyrics: () => {
    const lyrics = !get().lyrics;
    write(LYRICS, lyrics ? '1' : '0');
    set({ lyrics });
  },
  toggleComments: () => {
    const comments = !get().comments;
    write(COMMENTS, comments ? '1' : '0');
    set({ comments });
  },
  setLyricsSide: (lyricsSide) => {
    write(LYRICS_SIDE, lyricsSide);
    set({ lyricsSide });
  },
  setCommentsSide: (commentsSide) => {
    write(COMMENTS_SIDE, commentsSide);
    set({ commentsSide });
  },
}));
