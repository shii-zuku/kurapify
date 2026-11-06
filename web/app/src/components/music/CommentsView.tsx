import { ChevronDown, Heart, Languages, Pin } from 'lucide-react';
import { useState } from 'react';
import { useComments, useCuts } from '@/data/music/queries';
import type { CommentItem, CommentSort, RepliesPage } from '@/data/music/api';
import { targetLanguage, translate } from '@/lib/translate';
import { Emojified } from '@/components/Emojified';

const SORTS: { value: CommentSort; label: string }[] = [
  { value: 'TOP_COMMENTS', label: 'Top' },
  { value: 'NEWEST_FIRST', label: 'Newest' },
];

/** Top | Newest, with a rounded block that slides under the chosen side. */
function SortSwitch({ sort, onChange }: { sort: CommentSort; onChange: (sort: CommentSort) => void }) {
  return (
    <div className="relative inline-flex rounded-[10px] bg-quinary p-0.5" role="group" aria-label="Sort comments">
      <span
        className="absolute inset-y-0.5 left-0.5 w-[calc(50%-2px)] rounded-[8px] bg-key-bg shadow-[0_1px_3px_#0003] transition-transform duration-500 ease-panel"
        style={{ transform: sort === 'NEWEST_FIRST' ? 'translateX(100%)' : 'none' }}
        aria-hidden="true"
      />
      {SORTS.map(({ value, label }) => (
        <button
          key={value}
          className="relative z-1 w-[62px] rounded-[8px] py-[3px] text-center type-callout-emphasized text-secondary transition-colors duration-300 aria-pressed:text-white"
          aria-pressed={sort === value}
          onClick={() => onChange(value)}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

function Avatar({ comment, size = 32 }: { comment: CommentItem; size?: number }) {
  return (
    <span
      className="relative grid flex-none place-items-center overflow-hidden rounded-full bg-quinary type-callout-emphasized text-secondary"
      data-comment-avatar
      style={{ width: size, height: size }}
    >
      {comment.author.charAt(0).toUpperCase()}
      {comment.avatar && (
        <img
          className="absolute inset-0 size-full object-cover opacity-0 transition-opacity duration-300 data-loaded:opacity-100"
          src={comment.avatar}
          alt=""
          referrerPolicy="no-referrer"
          loading="lazy"
          decoding="async"
          onLoad={(e) => e.currentTarget.setAttribute('data-loaded', '')}
        />
      )}
    </span>
  );
}

/** One comment's words and numbers; its replies hang under it. */
function Body({ comment, small }: { comment: CommentItem; small?: boolean }) {
  const [translation, setTranslation] = useState<{ state: 'off' } | { state: 'loading' } | { state: 'done'; text: string; from: string } | { state: 'failed' }>({ state: 'off' });
  const target = targetLanguage();
  const toggle = () => {
    if (translation.state === 'done') return setTranslation({ state: 'off' });
    setTranslation({ state: 'loading' });
    translate(comment.text, target).then(
      (t) => setTranslation({ state: 'done', text: t.text, from: t.from }),
      () => setTranslation({ state: 'failed' }),
    );
  };
  const shown = translation.state === 'done' ? translation.text : comment.text;
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-1.5">
      <div className="flex min-w-0 items-center gap-2 type-callout text-secondary">
        {comment.pinned && <Pin size={11} className="flex-none" aria-label="Pinned" />}
        <span className={`truncate type-callout-emphasized ${comment.byCreator ? 'text-key' : 'text-primary'}`}>{comment.author}</span>
        <span className="flex-none">{comment.published}</span>
      </div>
      <p className="text-[13px] leading-[20px] break-words whitespace-pre-wrap text-primary" data-comment-text>
        <Emojified text={shown} />
      </p>
      <div className="mt-1 flex items-center gap-4 type-callout text-secondary">
        {comment.likes && (
          <span className="inline-flex items-center gap-1">
            <Heart size={12} />
            {comment.likes}
          </span>
        )}
        <button className="inline-flex items-center gap-1 hover:text-primary disabled:opacity-60" disabled={translation.state === 'loading'} onClick={toggle}>
          <Languages size={12} />
          {translation.state === 'loading'
            ? 'Translating…'
            : translation.state === 'done'
              ? translation.from === target
                ? 'Already in this language · Show original'
                : 'Translated · See original'
              : translation.state === 'failed'
                ? 'Couldn’t translate · Try again'
                : 'Translate'}
        </button>
      </div>
    </div>
  );
}

/** The "N replies" row under a comment: opens the thread, a batch at a time. */
function Replies({ comment }: { comment: CommentItem }) {
  const [open, setOpen] = useState(false);
  const [replies, setReplies] = useState<CommentItem[]>([]);
  const [next, setNext] = useState<RepliesPage['next']>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const load = async (read: () => Promise<RepliesPage>, append: boolean) => {
    setBusy(true);
    setFailed(false);
    try {
      const page = await read();
      setReplies((current) => (append ? [...current, ...page.replies] : page.replies));
      setNext(() => page.next);
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };
  const toggle = () => {
    const opening = !open;
    setOpen(opening);
    if (opening && !replies.length && comment.loadReplies) void load(comment.loadReplies, false);
  };
  if (!comment.loadReplies) return null;
  return (
    <div className="mt-3">
      <button className="-ml-1 inline-flex items-center gap-1.5 rounded-md px-1 py-1 type-callout-emphasized text-key" aria-expanded={open} onClick={toggle}>
        <ChevronDown size={14} className={`transition-transform duration-300 ease-panel ${open ? 'rotate-180' : ''}`} />
        {comment.replies ? `${comment.replies} ${comment.replies === '1' ? 'reply' : 'replies'}` : 'Replies'}
      </button>
      {open && (
        <div className="mt-4 flex flex-col gap-6 border-l border-(--vibrantDivider,#ffffff26) pl-4" data-comment-thread>
          {replies.map((reply, i) => (
            <div key={reply.id} className="flex animate-row-in gap-3" style={{ animationDelay: `${Math.min(i, 8) * 25}ms` }}>
              <Avatar comment={reply} size={24} />
              <Body comment={reply} small />
            </div>
          ))}
          {busy && <p className="type-callout text-secondary">Loading…</p>}
          {failed && (
            <p className="type-callout text-secondary">
              Replies couldn’t be loaded.{' '}
              <button className="text-key" onClick={() => void load(next ?? comment.loadReplies!, !!next)}>
                Try again
              </button>
            </p>
          )}
          {!busy && next && (
            <button className="self-start type-callout-emphasized text-key" onClick={() => void load(next, true)}>
              Show more replies
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function Comment({ comment, index }: { comment: CommentItem; index: number }) {
  return (
    <li className="flex animate-row-in gap-3.5 px-6 py-4" data-comment style={{ animationDelay: `${Math.min(index, 10) * 30}ms` }}>
      <Avatar comment={comment} />
      <div className="flex min-w-0 flex-1 flex-col">
        <Body comment={comment} />
        <Replies comment={comment} />
      </div>
    </li>
  );
}

function Skeleton() {
  return (
    <ul className="flex flex-col" aria-label="Loading comments">
      {Array.from({ length: 6 }, (_, i) => (
        <li key={i} className="flex animate-matching gap-3 px-5 py-3" style={{ animationDelay: `${i * 120}ms` }}>
          <span className="size-8 flex-none rounded-full bg-quinary" />
          <div className="flex flex-1 flex-col gap-2 pt-1">
            <span className="h-2.5 w-1/3 rounded-full bg-quinary" />
            <span className="h-2.5 w-full rounded-full bg-quinary" />
            <span className="h-2.5 w-2/3 rounded-full bg-quinary" />
          </div>
        </li>
      ))}
    </ul>
  );
}

/** A video's comments: Top or Newest, with replies, loading on as you ask for more. Works for the song and the music video alike. */
export function CommentsView({ videoId }: { videoId: string | null }) {
  const [sort, setSort] = useState<CommentSort>('TOP_COMMENTS');
  // A song's own video rarely has comments; its music video's are the ones people wrote.
  const cuts = useCuts(videoId);
  const target = cuts.data?.video?.videoId ?? videoId;
  const query = useComments(target, sort, !cuts.isPending);
  const comments = query.data?.pages.flatMap((page) => page.comments) ?? [];
  const total = query.data?.pages[0]?.total ?? null;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-3 px-6 pt-7 pb-2" data-comments-head>
        <div className="min-w-0 flex-1">
          <h3 className="type-title-2-emphasized">Comments</h3>
          {total && <p className="type-callout text-secondary">{total}</p>}
        </div>
        <SortSwitch sort={sort} onChange={setSort} />
      </div>
      <div className="mt-3 min-h-0 flex-1 overflow-y-auto pb-28">
        {query.isPending && !query.isError ? (
          <Skeleton />
        ) : query.isError && !comments.length ? (
          <div className="px-5 py-6 type-callout text-secondary">
            Comments couldn’t be loaded.{' '}
            <button className="text-key" onClick={() => void query.refetch()}>
              Try again
            </button>
          </div>
        ) : !comments.length ? (
          <p className="px-5 py-6 type-callout text-secondary">No comments, or they’re turned off for this video.</p>
        ) : (
          <ul className="flex flex-col">
            {comments.map((comment, i) => (
              <Comment key={comment.id} comment={comment} index={i % 20} />
            ))}
          </ul>
        )}
        {query.hasNextPage && (
          <div className="flex justify-center py-3">
            <button
              className="rounded-full bg-quinary px-4 py-1.5 type-callout-emphasized text-primary hover:bg-quaternary disabled:opacity-50"
              disabled={query.isFetchingNextPage}
              onClick={() => void query.fetchNextPage()}
            >
              {query.isFetchingNextPage ? 'Loading…' : 'Show more'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
