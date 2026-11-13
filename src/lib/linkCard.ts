// A small card with the start of the note a link points to, shown when the
// pointer rests on the link (or the link has the keyboard focus), so a note
// can be looked up without leaving the place being read.
import { embedSlice, fillEmbeds } from './embeds';
import { tr } from './i18n.svelte';
import { renderMarkdown } from './markdown';
import { dirName, kindOf, stem } from './paths';
import previewCss from './previewCss';
import { store } from './store.svelte';

/** What a link says: where it is written and where it points. */
export interface LinkTarget {
  vaultId: string;
  /** The note the link is written in. */
  from: string;
  /** The note it leads to, or null when it does not exist. */
  path: string | null;
  /** The name written in the link, to create the note when it is missing. */
  name: string;
  /** `#Heading` or `^block`, if the link points into the note. */
  anchor?: string | null;
}

const SHOW_AFTER = 400;
const HIDE_AFTER = 250;
/** How much of a note is drawn: the card only shows its start. */
const MAX_CHARS = 2500;

let host: HTMLElement | null = null;
let shown: string | null = null;
let showTimer: ReturnType<typeof setTimeout> | undefined;
let hideTimer: ReturnType<typeof setTimeout> | undefined;
let run = 0;
let pendingRect: DOMRect | null = null;

const keyOf = (t: LinkTarget) => `${t.vaultId}|${t.path ?? `?${t.name}`}|${t.anchor ?? ''}`;

const CARD_CSS = `
:host { all: initial; }
.card { position: relative; display: flex; flex-direction: column; box-sizing: border-box; width: 420px; max-width: calc(100vw - 16px); max-height: 280px; overflow: hidden; border: 1px solid var(--line); border-radius: var(--radius-md); background: var(--raised); color: var(--text); box-shadow: var(--shadow-lg); font-family: var(--sans); cursor: pointer; }
.head { display: flex; flex-direction: column; gap: 2px; padding: var(--space-2) var(--space-3) var(--space-1-5); border-bottom: 1px solid var(--line); }
.title { overflow: hidden; font-size: var(--font-md); font-weight: 600; text-overflow: ellipsis; white-space: nowrap; }
.where { overflow: hidden; color: var(--text-3); font-size: var(--font-xs); text-overflow: ellipsis; white-space: nowrap; }
.body { flex: 1; min-height: 0; overflow-y: auto; padding: 0 var(--space-3) var(--space-3); font-size: var(--font-sm); }
.plain { padding-top: var(--space-2); color: var(--text-2); }
.body .prose { font-size: .85em; }
.body .prose > :first-child { margin-top: .6em; }
.body .prose a { pointer-events: none; }
.body .diagram { padding: .4em .8em; border: 1px dashed var(--line); border-radius: 6px; color: var(--text-3); font: .85em var(--sans); }
.fade { position: absolute; right: 0; bottom: 0; left: 0; height: 36px; background: linear-gradient(to bottom, transparent, var(--raised)); pointer-events: none; }
.missing { display: flex; align-items: center; gap: var(--space-2); padding: var(--space-3); color: var(--text-2); font-size: var(--font-sm); cursor: default; }
.missing button { padding: var(--space-1) var(--space-2-5); border: 1px solid var(--line); border-radius: var(--radius-sm); background: var(--accent-soft); color: var(--accent-text); font: inherit; cursor: pointer; }
.missing button:hover { background: var(--hover); }
`;

function ensureHost() {
  if (host) return host;
  host = document.createElement('div');
  host.style.cssText = 'position:fixed;left:0;top:0;z-index:var(--z-menu);';
  host.attachShadow({ mode: 'open' });
  host.addEventListener('pointerenter', () => clearTimeout(hideTimer));
  host.addEventListener('pointerleave', () => leave());
  document.body.append(host);
  return host;
}

/** Closes the card at once. */
export function hideLinkCard() {
  clearTimeout(showTimer);
  clearTimeout(hideTimer);
  run++;
  shown = null;
  host?.remove();
  host = null;
  document.removeEventListener('keydown', onKey, true);
  document.removeEventListener('scroll', onScroll, true);
}

function onKey(e: KeyboardEvent) {
  if (e.key !== 'Escape') return;
  // The card goes first; a second Escape reaches whatever was underneath.
  e.stopPropagation();
  hideLinkCard();
}

function onScroll(e: Event) {
  // Scrolling the card itself is the point of keeping it open.
  if (e.target instanceof Node && host?.shadowRoot?.contains(e.target)) return;
  hideLinkCard();
}

function place(card: HTMLElement, rect: DOMRect) {
  const gap = 6;
  const { width, height } = card.getBoundingClientRect();
  const left = Math.max(8, Math.min(rect.left, window.innerWidth - width - 8));
  let top = rect.bottom + gap;
  if (top + height > window.innerHeight - 8 && rect.top - gap - height >= 8) top = rect.top - gap - height;
  ensureHost().style.transform = `translate(${Math.round(left)}px, ${Math.round(Math.max(8, top))}px)`;
}

function open(t: LinkTarget, beside: boolean) {
  hideLinkCard();
  if (!t.path) return;
  const path = t.path;
  if (beside) void store.openBeside(t.vaultId, path).then(() => store.goToAnchor(t.vaultId, path, t.anchor));
  else void store.openNoteAt(t.vaultId, path, t.anchor);
}

function line(className: string, text: string) {
  const el = document.createElement('div');
  el.className = className;
  el.textContent = text;
  return el;
}

async function build(t: LinkTarget, id: number): Promise<HTMLElement | null> {
  const card = document.createElement('div');
  card.className = 'card';
  card.setAttribute('role', 'tooltip');
  if (!t.path) {
    const row = document.createElement('div');
    row.className = 'missing';
    const create = document.createElement('button');
    create.textContent = tr('linkcard.create');
    create.onclick = (e) => {
      e.stopPropagation();
      hideLinkCard();
      void store.createNote(t.vaultId, dirName(t.from), t.name);
    };
    row.append(`${tr('linkcard.missing')} · `, create);
    card.style.cursor = 'default';
    card.append(row);
    return card;
  }
  const read = store.noteReader(t.vaultId);
  const text = await read(t.path);
  if (id !== run) return null;
  const slice = text === null ? null : embedSlice(text, t.anchor);
  const head = document.createElement('div');
  head.className = 'head';
  head.append(line('title', `${stem(t.path)}${t.anchor ?? ''}`), line('where', t.path));
  card.setAttribute('aria-label', tr('linkcard.label', { name: stem(t.path) }));
  card.append(head);
  const body = document.createElement('div');
  body.className = 'body';
  card.append(body);
  let part = slice === null ? null : slice.trim();
  if (part !== null && part.length > MAX_CHARS) {
    const cut = part.lastIndexOf('\n', MAX_CHARS);
    part = part.slice(0, cut > 0 ? cut : MAX_CHARS);
  }
  if (!part) {
    body.className = 'body plain';
    body.textContent = part === null ? tr('embed.missing') : tr('linkcard.empty');
    return card;
  }
  const ctx = { vaultId: t.vaultId, path: t.path, files: store.files(t.vaultId), aliases: store.aliasMap(t.vaultId) };
  const prose = document.createElement('article');
  prose.className = 'prose';
  prose.append(renderMarkdown(part, ctx));
  body.append(prose);
  card.append(Object.assign(document.createElement('div'), { className: 'fade' }));
  await fillEmbeds(prose, ctx, read);
  // Diagrams are not drawn here: the card has to be quick.
  for (const d of prose.querySelectorAll<HTMLElement>('.diagram')) d.textContent = tr('linkcard.diagram');
  return id === run ? card : null;
}

async function show(t: LinkTarget) {
  const id = ++run;
  const rect = pendingRect;
  const card = await build(t, id);
  if (!card || id !== run || !rect) return;
  const root = ensureHost().shadowRoot!;
  const style = document.createElement('style');
  style.textContent = `${previewCss}\n${CARD_CSS}`;
  root.replaceChildren(style, card);
  shown = keyOf(t);
  card.onclick = (e) => {
    if ((e.target as HTMLElement).closest('button')) return;
    open(t, e.ctrlKey || e.metaKey);
  };
  place(card, rect);
  document.addEventListener('keydown', onKey, true);
  document.addEventListener('scroll', onScroll, true);
}

/** The pointer rests on a link: the card appears after a short while. */
export function hoverLink(t: LinkTarget, rect: DOMRect, delay = SHOW_AFTER) {
  clearTimeout(hideTimer);
  if (shown === keyOf(t)) return;
  clearTimeout(showTimer);
  pendingRect = rect;
  showTimer = setTimeout(() => void show(t), delay);
}

/** The pointer or the focus left the link: the card stays a moment, in case the pointer is going to it. */
export function leave() {
  clearTimeout(showTimer);
  clearTimeout(hideTimer);
  hideTimer = setTimeout(hideLinkCard, HIDE_AFTER);
}

/**
 * Hover and focus of the links of a rendered note (preview or reader).
 * `from` tells which note a link is written in.
 */
export function watchLinks(root: HTMLElement, vaultId: () => string, from: (a: HTMLElement) => string) {
  const link = (e: Event) => {
    const a = (e.target as Element | null)?.closest<HTMLAnchorElement>('a');
    if (!a || a.closest('.note-embed')) return null;
    const path = a.dataset.note ?? null;
    if (path !== null && kindOf(path) !== 'md') return null;
    // A broken link to a note can be created; other broken links say nothing.
    if (path === null && !(a.dataset.wikilink && a.classList.contains('broken'))) return null;
    const target: LinkTarget = { vaultId: vaultId(), from: from(a), path, name: a.dataset.wikilink ?? '', anchor: a.dataset.anchor };
    return { a, target };
  };
  const enter = (e: Event) => {
    const l = link(e);
    if (l) hoverLink(l.target, l.a.getBoundingClientRect());
  };
  const exit = (e: Event) => {
    if (link(e)) leave();
  };
  root.addEventListener('pointerover', enter);
  root.addEventListener('pointerout', exit);
  root.addEventListener('focusin', enter);
  root.addEventListener('focusout', exit);
}
