// The quick menu: typing `/` at the start of a line offers the blocks of a
// note. It reuses the formatting commands of the toolbar, so what it writes is
// the same Markdown.
import { acceptCompletion, completionStatus, type Completion, type CompletionContext, type CompletionResult } from '@codemirror/autocomplete';
import { Prec } from '@codemirror/state';
import { keymap, type EditorView } from '@codemirror/view';
import { PATHS } from './components/Icon.svelte';
import { fenceAt, insertBlock, tableMarkdown } from './formatting';
import { tr, type Key } from './i18n.svelte';
import { store } from './store.svelte';
import { startNoteLink } from './wikilinks';

interface Entry {
  name: Key;
  params?: Record<string, number>;
  hint: Key;
  icon: string;
  /** Other words that find it, in every language. */
  keywords: string;
  /** A line mark: it takes the place of the `/` and keeps the indent. */
  prefix?: string;
  /** Anything else; it runs once the `/` has gone. */
  run?: (view: EditorView) => void;
}

/** A block with the cursor on its empty middle line. */
function inside(view: EditorView, fence: string) {
  insertBlock(view, `${fence}\n\n${fence}`);
  const end = view.state.selection.main.head;
  view.dispatch({ selection: { anchor: end - fence.length - 2 } });
}

const isoDate = () => {
  const now = new Date();
  const two = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${two(now.getMonth() + 1)}-${two(now.getDate())}`;
};

function entries(onDiagram: () => void): Entry[] {
  return [
    { name: 'toolbar.heading', params: { n: 1 }, hint: 'slash.h1', icon: 'heading', keywords: 'h1 titulo heading izenburua', prefix: '# ' },
    { name: 'toolbar.heading', params: { n: 2 }, hint: 'slash.h2', icon: 'heading', keywords: 'h2 titulo heading izenburua', prefix: '## ' },
    { name: 'toolbar.heading', params: { n: 3 }, hint: 'slash.h3', icon: 'heading', keywords: 'h3 titulo heading izenburua', prefix: '### ' },
    { name: 'toolbar.bullets', hint: 'slash.bullets', icon: 'list', keywords: 'lista vinetas bullets list zerrenda', prefix: '- ' },
    { name: 'toolbar.numbers', hint: 'slash.numbers', icon: 'numbers', keywords: 'lista numeros numbered list zenbakiak', prefix: '1. ' },
    { name: 'toolbar.tasks', hint: 'slash.tasks', icon: 'tasks', keywords: 'tarea casilla task todo checkbox zeregina', prefix: '- [ ] ' },
    { name: 'toolbar.quote', hint: 'slash.quote', icon: 'quote', keywords: 'cita quote blockquote aipua', prefix: '> ' },
    { name: 'slash.code', hint: 'slash.codeHint', icon: 'code', keywords: 'codigo code bloque block kodea', run: (v) => inside(v, '```') },
    { name: 'toolbar.table', hint: 'slash.table', icon: 'table', keywords: 'tabla table taula', run: (v) => insertBlock(v, tableMarkdown(tr('toolbar.column'))) },
    { name: 'toolbar.diagram', hint: 'slash.diagram', icon: 'diagram', keywords: 'diagrama esquema mermaid d2 diagram eskema', run: () => onDiagram() },
    { name: 'slash.formula', hint: 'slash.formulaHint', icon: 'sigma', keywords: 'formula ecuacion math latex equation ekuazioa', run: (v) => inside(v, '$$') },
    { name: 'toolbar.rule', hint: 'slash.rule', icon: 'rule', keywords: 'separador linea raya rule divider hr marra', run: (v) => insertBlock(v, '---') },
    { name: 'toolbar.noteLink', hint: 'slash.note', icon: 'file', keywords: 'enlace nota link note wikilink esteka oharra', run: (v) => startNoteLink(v) },
    { name: 'slash.date', hint: 'slash.dateHint', icon: 'calendar', keywords: 'fecha hoy date today gaur data', run: (v) => v.dispatch(v.state.replaceSelection(isoDate())) },
  ];
}

/** Lower case and without accents, so `titulo` finds `Título`. */
const plain = (text: string) => text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

// A space may follow the first letter (`/titulo 2`), but never right after the slash.
const TYPING = /^\s*\/(\S[^/]*)?$/;

function apply(entry: Entry) {
  return (view: EditorView, _completion: Completion, from: number, to: number) => {
    if (entry.prefix !== undefined) {
      // Only the `/` and what was typed after it go; the indent stays.
      view.dispatch({ changes: { from, to, insert: entry.prefix }, selection: { anchor: from + entry.prefix.length }, userEvent: 'input.complete' });
      view.focus();
      return;
    }
    // A block goes on its own line, so the line is emptied first.
    view.dispatch({ changes: { from: view.state.doc.lineAt(from).from, to, insert: '' }, userEvent: 'input.complete' });
    entry.run?.(view);
  };
}

/** The suggestions after a `/` that opens a line; elsewhere in a line it stays quiet. */
export function slashCompletions(onDiagram: () => void) {
  return (context: CompletionContext): CompletionResult | null => {
    if (!store.slashMenu) return null;
    const typed = context.matchBefore(TYPING);
    if (!typed || fenceAt(context.state)) return null;
    const query = plain(typed.text.trim().slice(1));
    const options: Completion[] = entries(onDiagram)
      .filter((e) => !query || plain(`${tr(e.name, e.params)} ${e.keywords}`).includes(query))
      .map((e) => ({ label: tr(e.name, e.params), detail: tr(e.hint), type: `slash:${e.icon}`, apply: apply(e) }));
    if (!options.length) return null;
    return { from: typed.from + typed.text.indexOf('/'), options, filter: false };
  };
}

/** The icon of each suggestion, drawn before its name. */
export const slashIcons = {
  render(completion: Completion) {
    const icon = completion.type?.startsWith('slash:') ? completion.type.slice(6) : null;
    if (!icon) return null;
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    const attributes = { width: '15', height: '15', viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': '1.8', 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true' };
    for (const [name, value] of Object.entries(attributes)) svg.setAttribute(name, value);
    const path = document.createElementNS(ns, 'path');
    path.setAttribute('d', PATHS[icon] ?? '');
    svg.append(path);
    svg.style.cssText = 'margin-right: 8px; color: var(--text-3); vertical-align: -3px';
    return svg;
  },
  position: 20,
};

/** Tab accepts the highlighted block, as Enter does. */
export const slashKeys = Prec.highest(
  keymap.of([{ key: 'Tab', run: (view) => (completionStatus(view.state) === 'active' ? acceptCompletion(view) : false) }]),
);
