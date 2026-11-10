// Matching that ignores case and accents, as the backend search does, so
// that "reunion" finds "Reunión".

const MARKS = /\p{M}/gu;

/** Lower case without accents. */
export const fold = (text: string) => text.normalize('NFD').replace(MARKS, '').toLowerCase();

/** The words of a query, folded. */
export const terms = (query: string) => fold(query).split(/\s+/).filter(Boolean);

const FILTERS = /^(ruta|path|carpeta|folder|etiqueta|tag|tipo|type):/;

/**
 * What to mark of a search query, as the backend reads it: words and
 * "phrases", folded, leaving out -exclusions, filters and /expressions/.
 */
export function queryMarks(query: string): string[] {
  const out: string[] = [];
  const pieces = query.match(/-?"[^"]*"?|\/(?:[^/\\]|\\.)+\/|\S+/g) ?? [];
  for (const piece of pieces) {
    const folded = fold(piece);
    if (piece.startsWith('-') && piece.length > 1) continue;
    if (piece.length > 2 && piece.startsWith('/') && piece.endsWith('/')) continue;
    if (FILTERS.test(folded)) continue;
    const text = piece.startsWith('"') ? folded.replace(/^"|"$/g, '') : folded;
    if (text.trim()) out.push(text);
  }
  return out;
}

/** Where any of `words` (already folded) occurs in `text`, as sorted, merged [from, to) ranges. */
export function findTerms(text: string, words: string[]): [number, number][] {
  if (!words.length) return [];
  let folded = '';
  // For each code unit of `folded`, the range of `text` it comes from.
  const from: number[] = [];
  const to: number[] = [];
  let at = 0;
  for (const char of text) {
    const f = fold(char);
    for (let i = 0; i < f.length; i++) {
      from.push(at);
      to.push(at + char.length);
    }
    folded += f;
    at += char.length;
  }
  const found: [number, number][] = [];
  for (const word of words) {
    for (let i = folded.indexOf(word); i >= 0; i = folded.indexOf(word, i + word.length)) {
      found.push([from[i], to[i + word.length - 1]]);
    }
  }
  found.sort((a, b) => a[0] - b[0]);
  const merged: [number, number][] = [];
  for (const r of found) {
    const last = merged.at(-1);
    if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]);
    else merged.push([...r]);
  }
  return merged;
}

/** Splits `text` into plain and matching pieces, for display. */
export function pieces(text: string, words: string[]) {
  const out: { text: string; match: boolean }[] = [];
  let at = 0;
  for (const [a, b] of findTerms(text, words)) {
    if (a > at) out.push({ text: text.slice(at, a), match: false });
    out.push({ text: text.slice(a, b), match: true });
    at = b;
  }
  if (at < text.length) out.push({ text: text.slice(at), match: false });
  return out;
}
