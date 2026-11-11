// Notes shown inside other notes, as Obsidian does with ![[note]],
// ![[note#Heading]] and ![[note#^block]]. The preview and the reading fill
// them in the page; exports get the text itself.
import { parseAnchor } from './anchors';
import { fold } from './fold';
import { tr } from './i18n.svelte';
import { outline, renderMarkdown, type RenderContext } from './markdown';
import { kindOf, stem } from './paths';

/** How deep notes may be shown inside notes shown inside notes. */
export const MAX_DEPTH = 3;

/** Reads a note of the vault, or null when it cannot. */
export type ReadNote = (path: string) => Promise<string | null>;

/** Whether `![[target]]` shows a note rather than an image or a file. */
export const isNoteEmbed = (target: string) => kindOf(target) === 'md' || !target.includes('.');

function withoutFrontmatter(text: string) {
  const m = /^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/.exec(text);
  return m ? text.slice(m[0].length) : text;
}

/** The part of a note an embed shows: all of it, one section, or one block. Null if it is not there. */
export function embedSlice(content: string, raw: string | null | undefined): string | null {
  // Obsidian writes a block as `#^id`.
  const anchor = parseAnchor(raw?.replace(/^#\^/, '^'));
  if (!anchor) return withoutFrontmatter(content);
  const lines = content.split('\n');
  if (anchor.kind === 'block') {
    const marker = new RegExp(`\\s\\^${anchor.id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`);
    const at = lines.findIndex((l) => marker.test(l));
    if (at < 0) return null;
    // The paragraph that ends with the marker.
    let start = at;
    while (start > 0 && lines[start - 1].trim() !== '') start--;
    return [...lines.slice(start, at), lines[at].replace(marker, '')].join('\n');
  }
  const headings = outline(content);
  const index = headings.findIndex((h) => fold(h.text) === fold(anchor.text));
  if (index < 0) return null;
  const heading = headings[index];
  const next = headings.slice(index + 1).find((h) => h.level <= heading.level);
  return lines.slice(heading.line - 1, next ? next.line - 1 : lines.length).join('\n').trimEnd();
}

const EMBED = /!\[\[([^\]|#^\n]+)([#^][^\]|\n]*)?(?:\|[^\]\n]*)?\]\]/g;

/**
 * The note's text with each embedded note written in its place, for exports.
 * Images stay as they are; a note already on the way in stays a link.
 */
export async function expandEmbeds(
  content: string,
  path: string,
  resolve: (target: string, from: string) => string | null,
  read: ReadNote,
  chain: string[] = [path],
): Promise<string> {
  let out = '';
  let at = 0;
  for (const match of content.matchAll(EMBED)) {
    const [whole, rawTarget, anchor] = match;
    const target = rawTarget.trim();
    if (!isNoteEmbed(target)) continue;
    const found = resolve(target, path);
    out += content.slice(at, match.index);
    at = match.index + whole.length;
    const text = found && !chain.includes(found) && chain.length <= MAX_DEPTH ? await read(found) : null;
    const slice = text === null ? null : embedSlice(text, anchor);
    out += slice === null ? `[[${target}${anchor ?? ''}]]` : `\n${await expandEmbeds(slice, found!, resolve, read, [...chain, found!])}\n`;
  }
  return out + content.slice(at);
}

/**
 * Fills the embedded notes of a rendered page. Each shows in a box with its
 * name, which opens it; missing ones and loops stay as a plain link.
 */
export async function fillEmbeds(root: ParentNode, ctx: RenderContext, read: ReadNote, chain: string[] = [ctx.path]) {
  const boxes = [...root.querySelectorAll<HTMLElement>('[data-embed-note]')].filter((el) => !el.dataset.filled);
  await Promise.all(boxes.map(async (box) => {
    box.dataset.filled = '1';
    const path = box.dataset.path;
    const text = path && !chain.includes(path) && chain.length <= MAX_DEPTH ? await read(path) : null;
    const slice = text === null ? null : embedSlice(text, box.dataset.anchor);
    if (slice === null) {
      box.classList.add('broken');
      box.title = tr('embed.missing');
      return;
    }
    const head = document.createElement('a');
    head.className = 'embed-source';
    head.href = '#';
    head.dataset.note = path;
    if (box.dataset.anchor) head.dataset.anchor = box.dataset.anchor;
    head.textContent = `${stem(path!)}${box.dataset.anchor ?? ''}`;
    const inner = renderMarkdown(slice, { ...ctx, path: path! });
    const body = document.createElement('div');
    body.className = 'embed-body';
    body.append(inner);
    box.replaceChildren(head, body);
    box.classList.add('filled');
    await fillEmbeds(body, { ...ctx, path: path! }, read, [...chain, path!]);
  }));
}
