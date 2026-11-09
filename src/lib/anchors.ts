// The part of a link after the note: `#Heading`, `#a#b` for a nested heading,
// or `^block` for a line ending in `^block`. Markdown links bring slugs such
// as `#mi-titulo`, so headings compare without case, accents or punctuation.
import { fold } from './fold';
import { outline } from './markdown';

export type Anchor = { kind: 'heading'; text: string } | { kind: 'block'; id: string };

export function parseAnchor(raw: string | null | undefined): Anchor | null {
  if (!raw) return null;
  if (raw.startsWith('^')) {
    const id = raw.slice(1).trim();
    return id ? { kind: 'block', id } : null;
  }
  const text = raw.replace(/^#/, '').split('#').at(-1)?.trim() ?? '';
  return text ? { kind: 'heading', text } : null;
}

const comparable = (text: string) => fold(text).replace(/[^\p{L}\p{N}]+/gu, '');

/** Where an anchor points in a note: its line, and for a heading its place among the headings. */
export function findAnchor(content: string, anchor: Anchor): { line: number; heading?: number } | null {
  if (anchor.kind === 'heading') {
    const headings = outline(content);
    const wanted = comparable(anchor.text);
    const index = headings.findIndex((h) => comparable(h.text) === wanted);
    return index < 0 ? null : { line: headings[index].line, heading: index };
  }
  const id = anchor.id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const ending = new RegExp(`(^|\\s)\\^${id}\\s*$`);
  const index = content.split(/\r?\n/).findIndex((line) => ending.test(line));
  return index < 0 ? null : { line: index + 1 };
}

/** How the anchor reads to a person, for messages. */
export const anchorLabel = (anchor: Anchor) => (anchor.kind === 'heading' ? anchor.text : `^${anchor.id}`);
