// A folder or a vault exported as a static website: a page per note with the
// same folders, a menu of every page, links between notes that work, and the
// images copied beside it. It opens from disk or on GitHub Pages.
import { api } from './api';
import { parseStyle } from './diagramStyle';
import { renderDiagram } from './diagrams';
import { documentCss, planSections, printLook, readNotes, rootOf, type ExportOptions } from './export';
import { fold } from './fold';
import { language, tr } from './i18n.svelte';
import { renderMarkdown } from './markdown';
import { mathFontCss } from './math';
import { dirName, linkFrom, stem } from './paths';
import { store, type Tab } from './store.svelte';

type Progress = (done: number, total: number) => void;

/** The folder the site starts from: '' for the vault. */
function siteRoot(tab: Tab, options: ExportOptions) {
  if (options.scope === 'vault') return '';
  return options.scope === 'folder' ? options.folder : dirName(tab.path);
}

/** A note's page inside the site. */
export function pagePath(note: string, root: string) {
  const inside = root && note.startsWith(`${root}/`) ? note.slice(root.length + 1) : note;
  return inside.replace(/\.(md|markdown)$/i, '.html');
}

/** An id for a heading, the same one a link to it is given. */
export function headingId(text: string) {
  return fold(text).replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '') || 'titulo';
}

const escapeHtml = (s: string) => new Option(s).innerHTML;

/** The menu: every page, in reading order, grouped by folder. */
function menu(pages: { note: string; page: string }[], current: string) {
  let html = '';
  let folder: string | null = null;
  for (const { note, page } of pages) {
    const here = dirName(page);
    if (here !== folder) {
      if (folder !== null) html += '</ul>';
      html += here ? `<p class="folder">${escapeHtml(here.replaceAll('/', ' › '))}</p><ul>` : '<ul>';
      folder = here;
    }
    const href = linkFrom(current, page);
    const on = page === current ? ' aria-current="page"' : '';
    html += `<li><a href="${href}"${on}>${escapeHtml(stem(note))}</a></li>`;
  }
  return `${html}</ul>`;
}

const LAYOUT = `
.site{display:grid;grid-template-columns:260px 1fr;min-height:100vh}
.site>nav{position:sticky;top:0;height:100vh;overflow:auto;padding:20px 16px;border-right:1px solid var(--line);background:var(--panel);font:14px/1.4 var(--sans)}
.site>nav .home{display:block;margin-bottom:12px;color:var(--text);font-weight:650;text-decoration:none}
.site>nav .folder{margin:14px 0 4px;color:var(--text-2);font-size:12px;font-weight:650;text-transform:uppercase;letter-spacing:.03em}
.site>nav ul{margin:0;padding:0;list-style:none}
.site>nav a{display:block;padding:3px 6px;border-radius:4px;color:var(--text-2);text-decoration:none}
.site>nav a:hover{background:var(--hover);color:var(--text)}
.site>nav a[aria-current]{background:color-mix(in srgb,var(--accent) 14%,transparent);color:var(--text)}
.site>main{min-width:0}
.site>main .prose{max-width:780px;margin:0 auto}
@media (max-width:720px){.site{grid-template-columns:1fr}.site>nav{position:static;height:auto;border-right:0;border-bottom:1px solid var(--line)}}`;

function page(title: string, siteName: string, nav: string, body: string, home: string, fonts = '') {
  return `<!doctype html>
<html lang="${language()}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)} · ${escapeHtml(siteName)}</title>
<style>${documentCss()}${LAYOUT}${fonts}</style></head>
<body><div class="site"><nav aria-label="${escapeHtml(tr('site.menu'))}"><a class="home" href="${home}">${escapeHtml(siteName)}</a>${nav}</nav>
<main><article class="prose">${body}</article></main></div></body></html>
`;
}

/** Builds every page and writes the site where the user picks. Its index page, or null if cancelled. */
export async function exportSite(tab: Tab, options: ExportOptions, onProgress?: Progress) {
  await store.saveAll();
  const root = siteRoot(tab, options);
  const plain = { ...options, levels: [], noteTitles: false, noteBreak: false };
  const sections = planSections(tab, plain).filter((s) => s.kind === 'note');
  const notes = await readNotes(tab, sections);
  const siteName = options.scope === 'note' ? stem(tab.path) : rootOf(tab, options).name;
  const pages = sections.map((s) => ({ note: s.path, page: pagePath(s.path, root) }));
  const pageOf = new Map(pages.map((p) => [p.note, p.page]));
  const assets = new Set<string>();
  const out: { path: string; html: string }[] = [];
  let done = 0;
  for (const { note, page: path } of pages) {
    onProgress?.(++done, pages.length);
    const content = notes.get(note) ?? '';
    const article = document.createElement('div');
    article.append(renderMarkdown(content, { vaultId: tab.vaultId, path: note, files: store.files(tab.vaultId), aliases: store.aliasMap(tab.vaultId) }));
    article.querySelector('pre.frontmatter')?.remove();
    for (const box of article.querySelectorAll('details')) box.open = true;
    for (const h of article.querySelectorAll<HTMLElement>('h1, h2, h3, h4, h5, h6')) h.id = headingId(h.textContent ?? '');
    for (const a of article.querySelectorAll<HTMLAnchorElement>('a')) {
      const target = a.dataset.note ? pageOf.get(a.dataset.note) : undefined;
      const anchor = a.dataset.anchor?.replace(/^#/, '');
      if (a.dataset.external) a.href = a.dataset.external;
      else if (target) a.href = `${target === path ? '' : linkFrom(path, target)}${anchor && !anchor.startsWith('^') ? `#${headingId(anchor)}` : ''}`;
      else if (!(a.getAttribute('href') ?? '').startsWith('#fn')) {
        // A note outside the site, or a tag: its words stay.
        a.replaceWith(...a.childNodes);
      }
    }
    for (const el of article.querySelectorAll<HTMLElement>('.diagram')) {
      try {
        const { theme, sketch } = printLook(tab, content, el.dataset.style ?? '');
        if (parseStyle(el.dataset.style ?? '').animated) el.classList.add('animated');
        el.innerHTML = await renderDiagram(el.dataset.lang!, decodeURIComponent(el.dataset.src ?? ''), theme, sketch);
      } catch {
        el.textContent = tr('preview.diagramUnavailable');
      }
    }
    for (const img of article.querySelectorAll<HTMLImageElement>('img[data-path]')) {
      assets.add(img.dataset.path!);
      img.src = linkFrom(path, `assets/${img.dataset.path}`);
    }
    for (const el of article.querySelectorAll<HTMLElement>('[data-lines]')) el.removeAttribute('data-lines');
    const body = article.innerHTML;
    // Fonts for the formulas go in the pages that have them: the site is only pages and images.
    out.push({ path, html: page(stem(note), siteName, menu(pages, path), body, linkFrom(path, 'index.html'), await mathFontCss(body)) });
  }
  // The home page: the site's notes, in order.
  const list = pages.map(({ note, page: p }) => `<li><a href="${linkFrom('index.html', p)}">${escapeHtml(stem(note))}</a></li>`).join('');
  if (!pageOf.has(root ? `${root}/index.md` : 'index.md')) {
    out.push({ path: 'index.html', html: page(siteName, siteName, menu(pages, 'index.html'), `<h1>${escapeHtml(siteName)}</h1><ul>${list}</ul>`, 'index.html') });
  }
  return api.exportSite(tab.vaultId, siteName, out, [...assets]);
}
