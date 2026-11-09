/* eslint-disable @typescript-eslint/no-explicit-any -- markdown-it plugins reach internals it does not type */
import MarkdownIt from 'markdown-it';
import footnote from 'markdown-it-footnote';
import taskLists from 'markdown-it-task-lists';
import hljs from 'highlight.js/lib/common';
import DOMPurify from 'dompurify';
import { fileUrl } from './api';
import { splitFence } from './diagramStyle';
import { dirName, kindOf, resolveLink, resolveRelative } from './paths';

export interface RenderContext {
  vaultId: string;
  path: string;
  files: string[];
}

const escapeHtml = (s: string) => new Option(s).innerHTML.replaceAll('"', '&quot;');

// The published types lag behind markdown-it 15's ESM entry point.
const md: any = new MarkdownIt({
  html: true,
  linkify: true,
  highlight(code: string, lang: string) {
    if (lang && hljs.getLanguage(lang)) {
      return `<pre class="hljs"><code>${hljs.highlight(code, { language: lang }).value}</code></pre>`;
    }
    return '';
  },
})
  .use(footnote)
  .use(taskLists, { enabled: false, label: true });

const defaultFence = md.renderer.rules.fence!;
md.renderer.rules.fence = (tokens: any, idx: number, options: any, env: any, self: any) => {
  const token = tokens[idx];
  const { lang, words } = splitFence(token.info);
  if (lang === 'mermaid' || lang === 'd2') {
    return `<div class="diagram" data-lang="${lang}" data-style="${escapeHtml(words)}" data-src="${encodeURIComponent(token.content)}"></div>`;
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
    const token = state.push('wikilink', '', 0);
    token.meta = { target: target.split('#')[0].trim(), label: (alias ?? target).trim(), embed };
  }
  state.pos = end + 2;
  return true;
});

md.renderer.rules.wikilink = (tokens: any, idx: number) => {
  const { target, label, embed } = tokens[idx].meta;
  const t = escapeHtml(target);
  return embed && kindOf(target) === 'image'
    ? `<img data-embed="${t}" alt="${escapeHtml(label)}">`
    : `<a data-wikilink="${t}" href="#">${escapeHtml(label)}</a>`;
};

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
  for (const a of root.querySelectorAll<HTMLAnchorElement>('a[data-wikilink]')) {
    const path = resolveLink(a.dataset.wikilink!, ctx.path, ctx.files);
    if (path) a.dataset.note = path;
    else a.classList.add('broken');
  }
  for (const a of root.querySelectorAll<HTMLAnchorElement>('a[href]:not([data-wikilink])')) {
    const href = a.getAttribute('href')!;
    if (isExternal(href)) a.dataset.external = href;
    else if (!href.startsWith('#')) {
      const path = resolveRelative(dir, decode(href.split('#')[0]));
      if (path && ctx.files.includes(path)) a.dataset.note = path;
      else a.classList.add('broken');
    }
  }
}

/**
 * Renders a note to a sanitised fragment. HTML written in a note keeps its
 * formatting and styles, which the preview's shadow root confines; scripts,
 * frames and event handlers are removed.
 */
export function renderMarkdown(text: string, ctx: RenderContext): DocumentFragment {
  const { meta, body } = splitFrontmatter(text);
  const head = meta === null ? '' : `<pre class="frontmatter">${escapeHtml(meta)}</pre>`;
  const fragment = DOMPurify.sanitize(head + md.render(body), {
    RETURN_DOM_FRAGMENT: true,
    FORCE_BODY: true,
    ADD_TAGS: ['style'],
    ADD_ATTR: ['data-lang', 'data-src', 'data-style', 'data-embed', 'data-wikilink'],
    FORBID_TAGS: ['form', 'iframe', 'object', 'embed', 'base', 'link', 'meta'],
  });
  linkContent(fragment, ctx);
  return fragment;
}
