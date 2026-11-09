// The note's properties: the `key: value` lines of its frontmatter. Only
// simple values are edited here; lists and multi-line values stay in the text.
import { frontmatterChange } from './themes';

export interface Property {
  key: string;
  value: string;
  /** A list or a multi-line value, which this form does not edit. */
  complex: boolean;
}

const BLOCK = /^---\r?\n([\s\S]*?)\r?\n---/;
const LINE = /^([^\s:#'"-][^:]*?):(?:\s+(.*))?$/;

function unquote(value: string) {
  const v = value.trim();
  if (v.length >= 2 && v.startsWith('"') && v.endsWith('"')) return v.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, '\\');
  if (v.length >= 2 && v.startsWith("'") && v.endsWith("'")) return v.slice(1, -1).replace(/''/g, "'");
  return v;
}

/** Quotes a value when YAML would read it as something else than plain text. */
export function quote(value: string) {
  const plain = /^[^\s#:'"[\]{},&*!|>%@`-][^#]*$/.test(value) && !value.includes(': ') && !/\s$/.test(value);
  const reserved = /^(true|false|yes|no|null|~|\d[\d.:e+-]*)$/i.test(value);
  return plain && !reserved ? value : `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

/** The note's properties in order, or an empty list when it has no frontmatter. */
export function properties(note: string): Property[] {
  const block = BLOCK.exec(note)?.[1];
  if (!block) return [];
  const out: Property[] = [];
  for (const line of block.split(/\r?\n/)) {
    if (!line.trim() || line.trimStart().startsWith('#')) continue;
    const m = LINE.exec(line);
    if (m) {
      const raw = m[2] ?? '';
      out.push({ key: m[1].trim(), value: unquote(raw), complex: raw === '' || /^[[{|>]/.test(raw.trim()) });
    } else if (out.length) {
      // An indented or list line belongs to the property above.
      out[out.length - 1].complex = true;
    }
  }
  return out;
}

/** The note with `key` set to `value`, or removed when `value` is empty. */
export function setProperty(note: string, key: string, value: string) {
  const change = frontmatterChange(note, key, value.trim() ? quote(value.trim()) : null);
  return change ? note.slice(0, change.from) + change.insert + note.slice(change.to) : note;
}

/** A key a person can type: no colon, no spaces at the ends, not empty. */
export const validKey = (key: string) => /^[^\s:#'"-][^:]*$/.test(key.trim()) && key.trim() === key.trim().replace(/\s+/g, ' ');
