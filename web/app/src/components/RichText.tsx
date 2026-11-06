import type { ReactNode } from 'react';

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

const decode = (text: string) =>
  text.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (whole, name: string) => {
    if (name[0] === '#') {
      const code = name[1]?.toLowerCase() === 'x' ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : whole;
    }
    return ENTITIES[name.toLowerCase()] ?? whole;
  });

/** The text with the markup stripped, for measuring and for places that can't style it. */
export function plainText(html: string): string {
  return decode(html.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]*>/g, ''));
}

/**
 * Apple's editorial text carries a little markup (<i> for a title, <b>, <br>). This draws those and nothing else:
 * every other tag is dropped, and text never becomes HTML, so nothing in it can run.
 */
export function RichText({ html }: { html: string }): ReactNode {
  const parts = html.split(/(<\/?(?:i|em|b|strong)>|<br\s*\/?>)/gi);
  const out: ReactNode[] = [];
  const open: ('i' | 'b')[] = [];
  const wrap = (text: string, key: number): ReactNode => {
    let node: ReactNode = text;
    for (const tag of [...open].reverse()) node = tag === 'i' ? <i key={`${key}${tag}`}>{node}</i> : <b key={`${key}${tag}`}>{node}</b>;
    return node;
  };
  parts.forEach((part, i) => {
    const tag = /^<(\/?)(i|em|b|strong)>$/i.exec(part);
    if (tag) {
      const kind = /^(i|em)$/i.test(tag[2]!) ? 'i' : 'b';
      if (tag[1]) {
        const at = open.lastIndexOf(kind);
        if (at >= 0) open.splice(at, 1);
      } else open.push(kind);
    } else if (/^<br/i.test(part)) out.push(<br key={i} />);
    else if (part) out.push(wrap(decode(part.replace(/<[^>]*>/g, '')), i));
  });
  return <>{out}</>;
}
