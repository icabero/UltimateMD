// Exports always use the same clean light look, whatever theme is on screen.
import { api } from './api';
import { renderDiagram, toPng } from './diagrams';
import { renderMarkdown } from './markdown';
import { baseName, extOf } from './paths';
import previewCss from './preview.css?inline';
import { store, type Tab } from './store.svelte';
import { themeById, themeVariables } from './themes';

const PRINT_THEME = themeById('claro')!;
const CHUNK = 0x8000;

const MIME: Record<string, string> = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', svg: 'image/svg+xml', png: 'image/png', gif: 'image/gif', webp: 'image/webp',
  avif: 'image/avif', bmp: 'image/bmp',
};

function toBase64(bytes: number[]) {
  let text = '';
  for (let i = 0; i < bytes.length; i += CHUNK) text += String.fromCharCode(...bytes.slice(i, i + CHUNK));
  return btoa(text);
}

function documentCss() {
  const variables = Object.entries(themeVariables(PRINT_THEME)).map(([k, v]) => `${k}:${v}`).join(';');
  return `:root,:host{${variables};--sans:system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;--serif:Georgia,'Times New Roman',serif;--mono:ui-monospace,Consolas,Menlo,monospace}
body{margin:0;background:var(--bg)}
${previewCss}
.prose{padding:32px 36px}
.diagram{border:0;padding:0;break-inside:avoid}
table,pre,blockquote,img{break-inside:avoid}
h1,h2,h3,h4{break-after:avoid}
@media print{body{background:none}.prose{max-width:none;padding:0}}`;
}

/** Renders a note with its diagrams inline and its images embedded. */
async function buildContent(tab: Tab) {
  const fragment = renderMarkdown(tab.content, { vaultId: tab.vaultId, path: tab.path, files: store.files(tab.vaultId) });
  const root = document.createElement('article');
  root.className = 'prose';
  root.append(fragment);
  for (const el of root.querySelectorAll<HTMLElement>('.diagram')) {
    try {
      el.innerHTML = await renderDiagram(el.dataset.lang!, decodeURIComponent(el.dataset.src ?? ''), PRINT_THEME);
    } catch {
      el.textContent = 'Diagrama no disponible';
    }
  }
  for (const img of root.querySelectorAll<HTMLImageElement>('[data-path]')) {
    const path = img.dataset.path!;
    const bytes = await api.readImage(tab.vaultId, path).catch(() => null);
    if (bytes) img.src = `data:${MIME[extOf(path)] ?? 'application/octet-stream'};base64,${toBase64(bytes)}`;
  }
  return root;
}

const titleOf = (tab: Tab) => baseName(tab.path).replace(/\.[^.]+$/, '');

export async function exportHtml(tab: Tab) {
  const root = await buildContent(tab);
  const title = titleOf(tab);
  const page = document.implementation.createHTMLDocument(title);
  page.documentElement.lang = 'es';
  const style = page.createElement('style');
  style.textContent = documentCss();
  page.head.append(style);
  page.body.append(page.importNode(root, true));
  const html = `<!doctype html>\n${page.documentElement.outerHTML}\n`;
  return api.exportFile(`${title}.html`, new TextEncoder().encode(html));
}

/** Opens the system's print dialog, which offers saving as PDF. */
export async function exportPdf(tab: Tab) {
  const root = await buildContent(tab);
  const host = document.createElement('div');
  host.id = 'print-root';
  const shadow = host.attachShadow({ mode: 'open' });
  const style = document.createElement('style');
  style.textContent = documentCss();
  shadow.append(style, root);
  document.body.append(host);
  await document.fonts.ready;
  const cleanup = () => host.remove();
  window.addEventListener('afterprint', cleanup, { once: true });
  window.print();
}

/** Rasterises the note's diagrams, in order, for embedding in Word. */
async function diagramImages(tab: Tab) {
  const fragment = renderMarkdown(tab.content, { vaultId: tab.vaultId, path: tab.path, files: [] });
  const stage = document.createElement('div');
  stage.style.cssText = 'position:fixed;left:-99999px;top:0';
  document.body.append(stage);
  const images: number[][] = [];
  try {
    for (const el of fragment.querySelectorAll<HTMLElement>('.diagram')) {
      try {
        stage.innerHTML = await renderDiagram(el.dataset.lang!, decodeURIComponent(el.dataset.src ?? ''), PRINT_THEME);
        images.push(Array.from(await toPng(stage.querySelector('svg')!)));
      } catch {
        // The document notes the gap; one diagram must not sink the export.
        images.push([]);
      }
    }
  } finally {
    stage.remove();
  }
  return images;
}

export async function exportDocx(tab: Tab, template: string | null) {
  await store.save(tab);
  const date = new Date().toLocaleDateString('es');
  return api.exportDocx(tab.vaultId, tab.path, template, date, await diagramImages(tab));
}
