// Exports use a fixed print look, whatever theme is on screen.
import { api, type ExportPlan, type PlanSection, type TreeNode } from './api';
import { renderDiagram, toPng } from './diagrams';
import { renderMarkdown } from './markdown';
import { baseName, extOf, kindOf, stem } from './paths';
import previewCss from './preview.css?inline';
import { store, type Tab } from './store.svelte';
import { themeById, themeVariables } from './themes';

const PRINT_THEME = themeById('claro')!;
const CHUNK = 0x8000;
const MAX_LEVEL = 6;

const MIME: Record<string, string> = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', svg: 'image/svg+xml', png: 'image/png', gif: 'image/gif', webp: 'image/webp',
  avif: 'image/avif', bmp: 'image/bmp',
};

export type Scope = 'note' | 'folder' | 'vault';

/** How one depth of folders appears: `''` none, `heading:N`, or `style:ID`. */
export interface LevelChoice {
  value: string;
  pageBreak: boolean;
}

export interface ExportOptions {
  scope: Scope;
  folder: string;
  /** Index 0 is the exported folder itself, 1 its subfolders, and so on. */
  levels: LevelChoice[];
  noteTitles: boolean;
  noteBreak: boolean;
  cover: boolean;
  template: string | null;
}

const byName = (a: TreeNode, b: TreeNode) => a.name.localeCompare(b.name, 'es', { numeric: true });
const isNote = (n: TreeNode) => !n.isDir && kindOf(n.path) === 'md';
const hasNotes = (n: TreeNode): boolean => (n.isDir ? n.children.some(hasNotes) : isNote(n));

function findFolder(nodes: TreeNode[], path: string): TreeNode | null {
  for (const node of nodes.filter((n) => n.isDir)) {
    if (node.path === path) return node;
    const found = findFolder(node.children, path);
    if (found) return found;
  }
  return null;
}

/** Every folder of a vault that has notes in it, for the folder selector. */
export function foldersOf(nodes: TreeNode[]): string[] {
  return nodes.filter((n) => n.isDir && hasNotes(n)).flatMap((n) => [n.path, ...foldersOf(n.children)]);
}

function rootOf(tab: Tab, options: ExportOptions) {
  const tree = store.trees[tab.vaultId] ?? [];
  if (options.scope === 'vault') return { name: store.vault(tab.vaultId)?.name ?? '', children: tree };
  const folder = findFolder(tree, options.folder);
  return { name: folder?.name ?? baseName(options.folder), children: folder?.children ?? [] };
}

/** How deep the folders go under the exported root, which needs its own level. */
export function levelCount(tab: Tab, options: ExportOptions) {
  if (options.scope === 'note') return 0;
  const depth = (nodes: TreeNode[]): number =>
    Math.max(0, ...nodes.filter((n) => n.isDir && hasNotes(n)).map((n) => 1 + depth(n.children)));
  return 1 + depth(rootOf(tab, options).children);
}

/** A sample folder name per level, so each option says what it affects. */
export function levelExamples(tab: Tab, options: ExportOptions) {
  const root = rootOf(tab, options);
  const examples = [root.name];
  let nodes = root.children;
  for (;;) {
    const next = [...nodes].sort(byName).find((n) => n.isDir && hasNotes(n));
    if (!next) return examples;
    examples.push(next.name);
    nodes = next.children;
  }
}

/** Turns the choices into a list of titles and notes, in reading order. */
export function planSections(tab: Tab, options: ExportOptions): PlanSection[] {
  if (options.scope === 'note') return [{ kind: 'note', path: tab.path, shift: 0, pageBreak: false }];
  const sections: PlanSection[] = [];

  const title = (text: string, depth: number, parent: number) => {
    const choice = options.levels[depth];
    if (!choice?.value) return parent;
    const [kind, value] = [choice.value.slice(0, choice.value.indexOf(':')), choice.value.slice(choice.value.indexOf(':') + 1)];
    const level = kind === 'heading' ? Number(value) : Math.min(parent + 1, MAX_LEVEL);
    sections.push({ kind: 'heading', text, style: kind === 'style' ? value : null, level, pageBreak: choice.pageBreak });
    return level;
  };

  const walk = (nodes: TreeNode[], depth: number, parent: number) => {
    for (const note of nodes.filter(isNote).sort(byName)) {
      if (options.noteTitles) {
        sections.push({ kind: 'heading', text: stem(note.path), style: null, level: Math.min(parent + 1, MAX_LEVEL), pageBreak: options.noteBreak && sections.length > 0 });
      }
      const pageBreak = !options.noteTitles && options.noteBreak && sections.length > 0;
      sections.push({ kind: 'note', path: note.path, shift: parent + (options.noteTitles ? 1 : 0), pageBreak });
    }
    for (const folder of nodes.filter((n) => n.isDir && hasNotes(n)).sort(byName)) {
      walk(folder.children, depth + 1, title(folder.name, depth, parent));
    }
  };

  const root = rootOf(tab, options);
  walk(root.children, 1, title(root.name, 0, 0));
  return sections;
}

const noteSections = (sections: PlanSection[]) => sections.filter((s) => s.kind === 'note');

async function readNotes(tab: Tab, sections: PlanSection[]) {
  const notes = new Map<string, string>();
  for (const { path } of noteSections(sections)) {
    notes.set(path, (await api.read(tab.vaultId, path)).content);
  }
  return notes;
}

function diagramBlocks(tab: Tab, path: string, content: string) {
  const fragment = renderMarkdown(content, { vaultId: tab.vaultId, path, files: [] });
  return [...fragment.querySelectorAll<HTMLElement>('.diagram')].map((el) => ({
    lang: el.dataset.lang!,
    src: decodeURIComponent(el.dataset.src ?? ''),
  }));
}

const pngCache = new Map<string, number[]>();

async function diagramPng(lang: string, src: string) {
  const key = `${lang}:${src}`;
  const known = pngCache.get(key);
  if (known) return known;
  const stage = document.createElement('div');
  stage.style.cssText = 'position:fixed;left:-99999px;top:0';
  document.body.append(stage);
  try {
    stage.innerHTML = await renderDiagram(lang, src, PRINT_THEME);
    const png = Array.from(await toPng(stage.querySelector('svg')!));
    pngCache.set(key, png);
    return png;
  } catch {
    // The document notes the gap; one diagram must not sink the export.
    return [];
  } finally {
    stage.remove();
  }
}

/** Gathers everything the backend needs to write the document. */
export async function buildPlan(tab: Tab, options: ExportOptions): Promise<ExportPlan> {
  await store.saveAll();
  const sections = planSections(tab, options);
  const notes = await readNotes(tab, sections);
  const diagrams: number[][] = [];
  for (const { path } of noteSections(sections)) {
    for (const { lang, src } of diagramBlocks(tab, path, notes.get(path) ?? '')) {
      diagrams.push(await diagramPng(lang, src));
    }
  }
  const fixedTitle = options.scope !== 'note';
  return {
    vaultId: tab.vaultId,
    title: fixedTitle ? rootOf(tab, options).name : stem(tab.path),
    fixedTitle,
    date: new Date().toLocaleDateString('es'),
    cover: options.cover,
    template: options.template,
    sections,
    diagrams,
  };
}

function toBase64(bytes: number[]) {
  let text = '';
  for (let i = 0; i < bytes.length; i += CHUNK) text += String.fromCharCode(...bytes.slice(i, i + CHUNK));
  return btoa(text);
}

export function documentCss() {
  const variables = Object.entries(themeVariables(PRINT_THEME)).map(([k, v]) => `${k}:${v}`).join(';');
  return `:root,:host{${variables};--sans:system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;--serif:Georgia,'Times New Roman',serif;--mono:ui-monospace,Consolas,Menlo,monospace}
body{margin:0;background:var(--bg)}
${previewCss}
.prose{padding:32px 36px}
.diagram{border:0;padding:0}`;
}

function shiftHeadings(root: ParentNode, shift: number) {
  if (!shift) return;
  for (const heading of root.querySelectorAll('h1, h2, h3, h4, h5, h6')) {
    const level = Math.min(Number(heading.tagName[1]) + shift, MAX_LEVEL);
    const moved = document.createElement(`h${level}`);
    moved.append(...heading.childNodes);
    heading.replaceWith(moved);
  }
}

/** The whole export as one HTML article, with diagrams and images embedded. */
export async function buildContent(tab: Tab, options: ExportOptions) {
  await store.saveAll();
  const sections = planSections(tab, options);
  const notes = await readNotes(tab, sections);
  const root = document.createElement('article');
  root.className = 'prose';
  for (const section of sections) {
    if (section.kind === 'heading') {
      const heading = document.createElement(`h${section.level}`);
      heading.textContent = section.text;
      root.append(heading);
      continue;
    }
    const part = document.createElement('section');
    part.append(renderMarkdown(notes.get(section.path) ?? '', { vaultId: tab.vaultId, path: section.path, files: store.files(tab.vaultId) }));
    shiftHeadings(part, section.shift);
    root.append(part);
  }
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

export async function exportHtml(tab: Tab, options: ExportOptions) {
  const root = await buildContent(tab, options);
  const title = options.scope === 'note' ? stem(tab.path) : rootOf(tab, options).name;
  const page = document.implementation.createHTMLDocument(title);
  page.documentElement.lang = 'es';
  const style = page.createElement('style');
  style.textContent = documentCss();
  page.head.append(style);
  page.body.append(page.importNode(root, true));
  const html = `<!doctype html>\n${page.documentElement.outerHTML}\n`;
  return api.exportFile(`${title}.html`, new TextEncoder().encode(html));
}
