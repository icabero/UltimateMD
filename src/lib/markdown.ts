/* eslint-disable @typescript-eslint/no-explicit-any -- markdown-it plugins reach internals it does not type */
import MarkdownIt from 'markdown-it';
import footnote from 'markdown-it-footnote';
import taskLists from 'markdown-it-task-lists';
import hljs from 'highlight.js/lib/common';
import DOMPurify from 'dompurify';
import { fileUrl } from './api';
import { shapeCallouts } from './callouts';
import { splitFence } from './diagramStyle';
import { dirName, kindOf, resolveLink, resolveRelative } from './paths';

export interface RenderContext {
  vaultId: string;
  path: string;
  files: string[];
  /** Other names of notes, in lower case, from `aliases:`. */
  aliases?: Map<string, string>;
}

const escapeHtml = (s: string) => new Option(s).innerHTML.replaceAll('"', '&quot;');

// The published types lag behind markdown-it 15's ESM entry point.
const md: any = new MarkdownIt({
  html: true,
  linkify: true,
  highlight(code: string, lang: string) {
    if (lang && hljs.getLanguage(lang)) {
      return `<pre class="hljs" data-lang="${escapeHtml(lang)}"><code>${hljs.highlight(code, { language: lang }).value}</code></pre>`;
    }
    return '';
  },
})
  .use(footnote)
  .use(taskLists, { enabled: false, label: true });

// Each top-level block says which lines of the note it comes from, so the
// preview can mark the ones that changed.
md.core.ruler.push('source_lines', (state: any) => {
  const offset = state.env?.offset ?? 0;
  for (const token of state.tokens) {
    if (token.level === 0 && token.block && token.map && token.nesting >= 0 && token.type !== 'inline') {
      token.attrSet('data-lines', `${token.map[0] + 1 + offset}-${token.map[1] + offset}`);
    }
  }
});

const defaultFence = md.renderer.rules.fence!;
md.renderer.rules.fence = (tokens: any, idx: number, options: any, env: any, self: any) => {
  const token = tokens[idx];
  const { lang, words } = splitFence(token.info);
  if (lang === 'mermaid' || lang === 'd2') {
    return `<div class="diagram" data-lines="${token.attrGet('data-lines') ?? ''}" data-lang="${lang}" data-style="${escapeHtml(words)}" data-src="${encodeURIComponent(token.content)}"></div>`;
  }
  return defaultFence(tokens, idx, options, env, self);
};

// [[note]], [[note#heading|alias]] and ![[image.png]]
md.inline.ruler.before('link', 'wikilink', (state: any, silent: boolean) => {
  const { src, pos } = state;
  const embed = src.startsWith('![[', pos);
  if (!embed && !src.startsWith('[[', pos)) return false;
  const start = pos + (embed ? 3 : 2);
  const end = src.indexOf(']]', start);
  if (end < 0 || src.slice(start, end).includes('\n')) return false;
  if (!silent) {
    const [target, alias] = src.slice(start, end).split('|');
    const [, name, anchor] = /^([^#^]*)([#^].*)?$/.exec(target) ?? [];
    const token = state.push('wikilink', '', 0);
    token.meta = { target: (name ?? target).trim(), anchor: anchor?.trim() ?? '', label: (alias ?? target).trim(), embed };
  }
  state.pos = end + 2;
  return true;
});

md.renderer.rules.wikilink = (tokens: any, idx: number) => {
  const { target, anchor, label, embed } = tokens[idx].meta;
  const t = escapeHtml(target);
  const link = `<a data-wikilink="${t}" data-anchor="${escapeHtml(anchor)}" href="#">${escapeHtml(label)}</a>`;
  if (embed && kindOf(target) === 'image') return `<img data-embed="${t}" alt="${escapeHtml(label)}">`;
  // Another note shown here, filled in by the page; until then, or if it is missing, a link.
  if (embed && (kindOf(target) === 'md' || !target.includes('.'))) {
    return `<span class="note-embed" data-embed-note="${t}" data-anchor="${escapeHtml(anchor)}">${link}</span>`;
  }
  return link;
};

// #etiqueta, as crates/core/src/tags.rs reads it. Code never gets here.
const TAG_CHAR = /[\p{L}\p{N}_/-]/u;
md.inline.ruler.before('link', 'tag', (state: any, silent: boolean) => {
  const { src, pos } = state;
  if (src[pos] !== '#') return false;
  const before = pos > 0 ? src[pos - 1] : '';
  if (before && (TAG_CHAR.test(before) || before === '&' || before === '#')) return false;
  let end = pos + 1;
  while (end < src.length && TAG_CHAR.test(src[end])) end++;
  const name = src.slice(pos + 1, end).replace(/[/-]+$/, '');
  if (!name || /^\d+$/.test(name)) return false;
  if (!silent) state.push('tag', '', 0).meta = { name };
  state.pos = pos + 1 + name.length;
  return true;
});

md.renderer.rules.tag = (tokens: any, idx: number) => {
  const name = escapeHtml(tokens[idx].meta.name);
  return `<a class="tag" data-tag="${name}" href="#">#${name}</a>`;
};

// Two things Obsidian notes carry: ==highlighted text== and %%comments%%,
// which are for whoever writes and never show.
md.inline.ruler.before('emphasis', 'obsidian_marks', (state: any, silent: boolean) => {
  const { src, pos } = state;
  const mark = src.startsWith('==', pos) ? '==' : src.startsWith('%%', pos) ? '%%' : null;
  if (!mark) return false;
  const end = src.indexOf(mark, pos + 2);
  const inner = end < 0 ? '' : src.slice(pos + 2, end);
  if (!inner.trim() || inner.includes('\n') || (mark === '==' && /^\s|\s$/.test(inner))) return false;
  if (!silent && mark === '==') {
    state.push('mark_open', 'mark', 1);
    state.md.inline.parse(inner, state.md, state.env, state.tokens);
    state.push('mark_close', 'mark', -1);
  }
  state.pos = end + 2;
  return true;
});

// A comment alone on its lines, or spanning several.
md.block.ruler.before('paragraph', 'obsidian_comment', (state: any, start: number, end: number, silent: boolean) => {
  const line = (n: number) => state.src.slice(state.bMarks[n] + state.tShift[n], state.eMarks[n]);
  const first = line(start);
  if (!first.startsWith('%%')) return false;
  let last = start;
  if (!(first.length > 4 && first.trimEnd().endsWith('%%'))) {
    last = start + 1;
    while (last < end && !line(last).trimEnd().endsWith('%%')) last++;
    if (last >= end) return false;
  }
  if (!silent) state.line = last + 1;
  return true;
});

function splitFrontmatter(text: string): { meta: string | null; body: string } {
  const m = /^---\n([\s\S]*?)\n---(?:\n|$)/.exec(text);
  return m ? { meta: m[1], body: text.slice(m[0].length) } : { meta: null, body: text };
}

function isExternal(url: string) {
  return /^[a-z][a-z0-9+.-]*:/i.test(url);
}

/** Points images at the app's protocol and marks links as internal or broken. */
function linkContent(root: DocumentFragment, ctx: RenderContext) {
  const dir = dirName(ctx.path);
  const decode = (s: string) => {
    try {
      return decodeURI(s);
    } catch {
      return s;
    }
  };
  for (const el of root.querySelectorAll<HTMLElement>('img, video, audio, source')) {
    const embed = el.dataset.embed;
    const src = el.getAttribute('src');
    const path = embed
      ? resolveLink(embed, ctx.path, ctx.files)
      : src && !isExternal(src) && !src.startsWith('#')
        ? resolveRelative(dir, decode(src.split(/[?#]/)[0]))
        : null;
    if (path) {
      el.setAttribute('src', fileUrl(ctx.vaultId, path));
      el.dataset.path = path;
    }
  }
  for (const box of root.querySelectorAll<HTMLElement>('[data-embed-note]')) {
    const path = resolveLink(box.dataset.embedNote!, ctx.path, ctx.files, ctx.aliases);
    if (path) box.dataset.path = path;
  }
  for (const a of root.querySelectorAll<HTMLAnchorElement>('a[data-wikilink]')) {
    // `[[#heading]]` points into the same note.
    const path = a.dataset.wikilink ? resolveLink(a.dataset.wikilink, ctx.path, ctx.files, ctx.aliases) : ctx.path;
    if (path) a.dataset.note = path;
    else a.classList.add('broken');
  }
  for (const a of root.querySelectorAll<HTMLAnchorElement>('a[href]:not([data-wikilink]):not([data-tag])')) {
    const href = a.getAttribute('href')!;
    if (isExternal(href)) {
      a.dataset.external = href;
      continue;
    }
    // Footnote references and back links stay within the preview.
    if (/^#fn/.test(href)) continue;
    const [file, fragment] = href.split('#');
    if (fragment) a.dataset.anchor = `#${decode(fragment)}`;
    if (!file) {
      a.dataset.note = ctx.path;
      continue;
    }
    const path = resolveRelative(dir, decode(file));
    if (path && ctx.files.includes(path)) a.dataset.note = path;
    else a.classList.add('broken');
  }
}

export interface Heading {
  level: number;
  text: string;
  /** Its line in the file, counting from 1. */
  line: number;
}

/**
 * The note's headings, parsed as the preview draws them, so that the nth one
 * here is the nth heading element there.
 */
export function outline(text: string): Heading[] {
  const { meta, body } = splitFrontmatter(text);
  const offset = meta === null ? 0 : text.slice(0, text.length - body.length).split('\n').length - 1;
  const tokens = md.parse(body, {});
  const out: Heading[] = [];
  tokens.forEach((t: any, i: number) => {
    if (t.type !== 'heading_open' || !t.map) return;
    const inline = tokens[i + 1];
    const words = (inline.children ?? []).filter((c: any) => c.type !== 'html_inline').map((c: any) => (c.type === 'wikilink' ? c.meta.label : c.content)).join('');
    out.push({ level: Number(t.tag.slice(1)), text: (words || inline.content).trim(), line: t.map[0] + 1 + offset });
  });
  return out;
}

export interface DiagramFence {
  lang: string;
  src: string;
  /** The words after the language, which style the diagram. */
  style: string;
  /** The line of the opening fence, counting from 1. */
  line: number;
}

/** The note's diagrams, in the order the preview draws them. */
export function diagramFences(text: string): DiagramFence[] {
  const { meta, body } = splitFrontmatter(text);
  const offset = meta === null ? 0 : text.slice(0, text.length - body.length).split('\n').length - 1;
  return md
    .parse(body, {})
    .filter((t: any) => t.type === 'fence' && t.map)
    .map((t: any) => ({ ...splitFence(t.info), src: t.content, line: t.map[0] + 1 + offset }))
    .filter((f: any) => f.lang === 'mermaid' || f.lang === 'd2')
    .map(({ lang, words, src, line }: any) => ({ lang, src, style: words, line }));
}

/** The heading whose section holds `line`: the last one at or above it. */
export function headingAt(headings: Heading[], line: number) {
  let found = -1;
  headings.forEach((h, i) => {
    if (h.line <= line) found = i;
  });
  return found;
}

/**
 * Renders a note to a sanitised fragment. HTML written in a note keeps its
 * formatting and styles, which the preview's shadow root confines; scripts,
 * frames and event handlers are removed.
 */
export function renderMarkdown(text: string, ctx: RenderContext): DocumentFragment {
  const { meta, body } = splitFrontmatter(text);
  const head = meta === null ? '' : `<pre class="frontmatter">${escapeHtml(meta)}</pre>`;
  const offset = meta === null ? 0 : text.slice(0, text.length - body.length).split('\n').length - 1;
  const fragment = DOMPurify.sanitize(head + md.render(body, { offset }), {
    RETURN_DOM_FRAGMENT: true,
    FORCE_BODY: true,
    ADD_TAGS: ['style'],
    ADD_ATTR: ['data-lang', 'data-src', 'data-style', 'data-embed', 'data-embed-note', 'data-wikilink'],
    FORBID_TAGS: ['form', 'iframe', 'object', 'embed', 'base', 'link', 'meta'],
  });
  shapeCallouts(fragment);
  linkContent(fragment, ctx);
  return fragment;
}
