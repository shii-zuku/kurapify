import { useState, type ReactNode } from 'react';

/**
 * Emoji drawn as Apple's own pictures (the emoji-datasource-apple set, from jsDelivr) instead of whatever the system's
 * emoji font looks like. Flags, skin tones, keycaps and joined families are one emoji each. An emoji the set doesn't have
 * (newer than it) stays as the system draws it.
 */
const BASE = 'https://cdn.jsdelivr.net/npm/emoji-datasource-apple@15.1.2/img/apple/64';

const EMOJI = /\p{Regional_Indicator}{2}|[0-9#*]\p{Variation_Selector}?\p{Me}|\p{Extended_Pictographic}(?:\p{Variation_Selector}|\p{Join_Control}\p{Extended_Pictographic}|\p{Emoji_Modifier})*/gu;

const VS16 = 0xfe0f;
/** ©, ® and ™ are only emoji when asked to be (with the emoji variation selector). */
const TEXT_DEFAULT = new Set([0xa9, 0xae, 0x2122]);

const hex = (codes: number[]) => codes.map((c) => c.toString(16)).join('-');

/** The file names to try, the likeliest first: the sequence as typed, without its variation selectors, with one added. */
function candidates(emoji: string): string[] {
  const codes = [...emoji].map((c) => c.codePointAt(0)!);
  const bare = codes.filter((c) => c !== VS16);
  const withSelector = [bare[0]!, VS16, ...bare.slice(1)];
  return [...new Set([hex(codes), hex(bare), hex(withSelector)])];
}

function Emoji({ text }: { text: string }) {
  const [attempt, setAttempt] = useState(0);
  const names = candidates(text);
  if (attempt >= names.length) return <>{text}</>;
  return (
    <img
      className="inline-block size-[1.25em] align-[-0.25em]"
      src={`${BASE}/${names[attempt]}.png`}
      alt={text}
      draggable={false}
      loading="lazy"
      decoding="async"
      onError={() => setAttempt((n) => n + 1)}
    />
  );
}

export function Emojified({ text }: { text: string }): ReactNode {
  const out: ReactNode[] = [];
  let last = 0;
  let key = 0;
  for (const match of text.matchAll(EMOJI)) {
    const at = match.index ?? 0;
    const first = match[0].codePointAt(0)!;
    if (TEXT_DEFAULT.has(first) && ![...match[0]].some((c) => c.codePointAt(0) === VS16)) continue;
    if (at > last) out.push(text.slice(last, at));
    out.push(<Emoji key={key++} text={match[0]} />);
    last = at + match[0].length;
  }
  if (!out.length) return text;
  if (last < text.length) out.push(text.slice(last));
  return <>{out}</>;
}
