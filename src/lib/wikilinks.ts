// Linking notes from the editor: suggestions after `[[`, links that look like
// links, and following them with a click.
import type { Completion, CompletionContext, CompletionResult } from '@codemirror/autocomplete';
import { startCompletion } from '@codemirror/autocomplete';
import type { EditorState } from '@codemirror/state';
import { Decoration, EditorView, MatchDecorator, ViewPlugin, type DecorationSet, type ViewUpdate } from '@codemirror/view';
import { api } from './api';
import { tr } from './i18n.svelte';
import { outline } from './markdown';
import { dirName, kindOf, resolveLink, stem } from './paths';
import { store } from './store.svelte';

const TYPING = /\[\[[^\]\n|#]*/;
const VALID = /^[^\]\n|#]*$/;

/**
 * `[[target]]`, `[[target#heading]]`, `[[target^block]]`, `[[#heading]]` in the
 * same note and `[[target|text]]`, but not `![[image]]` nor an empty `[[]]`.
 * Groups: target, anchor (with its `#` or `^`), text.
 */
export const WIKILINK = /(?<!!)\[\[(?=[^\]\n|]*[^\s\]|])([^\]\n|#^]*)([#^][^\]\n|]*)?(?:\|([^\]\n]+))?\]\]/g;

const targetOf = (path: string, tab: { path: string }, files: string[]) => {
  const short = stem(path);
  // Two notes with one name need the folder to tell them apart.
  return resolveLink(short, tab.path, files) === path ? short : path.replace(/\.[^./]+$/, '');
};

function complete(view: EditorView, target: string, from: number, to: number) {
  const after = view.state.sliceDoc(to, to + 2);
  const closed = after === ']]' || after.startsWith('|');
  const insert = closed ? target : `${target}]]`;
  const end = from + target.length + (after === ']]' ? 2 : closed ? 0 : 2);
  view.dispatch({ changes: { from, to, insert }, selection: { anchor: end } });
}

export function noteCompletions(context: CompletionContext): CompletionResult | null {
  const typed = context.matchBefore(TYPING);
  const tab = store.active;
  if (!typed || !tab) return null;
  const files = store.files(tab.vaultId);
  const options: Completion[] = files
    .filter((path) => kindOf(path) === 'md' && path !== tab.path)
    .map((path) => ({
      label: stem(path),
      detail: dirName(path) || undefined,
      apply: (view, _completion, from, to) => complete(view, targetOf(path, tab, files), from, to),
    }));
  // A note's other names lead to it too, as in Obsidian.
  for (const [path, names] of Object.entries(store.aliases[tab.vaultId] ?? {})) {
    if (path === tab.path) continue;
    for (const name of names) {
      options.push({ label: name, detail: tr('editor.aliasOf', { name: stem(path) }), apply: (view, _completion, from, to) => complete(view, name, from, to) });
    }
  }
  return { from: typed.from + 2, options, validFor: VALID };
}

const TYPING_HEADING = /\[\[([^\]\n|#^]*)#[^\]\n|#^]*/;

/** After `[[note#` or `[[#`, the headings of that note, to link straight to one. */
export async function headingCompletions(context: CompletionContext): Promise<CompletionResult | null> {
  const typed = context.matchBefore(TYPING_HEADING);
  const tab = store.active;
  if (!typed || !tab) return null;
  const name = TYPING_HEADING.exec(typed.text)?.[1].trim() ?? '';
  const path = name ? store.resolve(tab.vaultId, name, tab.path) : tab.path;
  if (!path) return null;
  const open = store.tabs.find((t) => t.vaultId === tab.vaultId && t.path === path);
  const content = open?.content ?? (await api.read(tab.vaultId, path).catch(() => null))?.content;
  if (!content) return null;
  return {
    from: typed.from + typed.text.indexOf('#') + 1,
    options: outline(content).map((h) => ({
      label: h.text,
      detail: `H${h.level}`,
      apply: (view: EditorView, _completion: Completion, from: number, to: number) => complete(view, h.text, from, to),
    })),
    validFor: /^[^\]\n|#^]*$/,
  };
}

/** Starts a link around the selection, and offers the notes to point it at. */
export function startNoteLink(view: EditorView) {
  const { from, to } = view.state.selection.main;
  const text = view.state.sliceDoc(from, to);
  view.dispatch({
    changes: { from, to, insert: text ? `[[|${text}]]` : '[[]]' },
    selection: { anchor: from + 2 },
  });
  view.focus();
  startCompletion(view);
}

/** The link at a position in the document, if any. */
export function linkAt(state: EditorState, pos: number) {
  const line = state.doc.lineAt(pos);
  for (const match of line.text.matchAll(WIKILINK)) {
    const from = line.from + match.index;
    if (pos >= from && pos <= from + match[0].length) return { from, to: from + match[0].length, target: match[1].trim(), anchor: match[2] ?? null };
  }
  return null;
}

function exists(target: string) {
  const tab = store.active;
  return !tab || !target || store.resolve(tab.vaultId, target, tab.path) !== null;
}

const matcher = new MatchDecorator({
  regexp: WIKILINK,
  decoration: (match) =>
    Decoration.mark({
      class: exists(match[1].trim()) ? 'cm-wikilink' : 'cm-wikilink cm-wikilink-missing',
      attributes: { title: tr('editor.followLink') },
    }),
});

const marks = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = matcher.createDeco(view);
    }
    update(update: ViewUpdate) {
      this.decorations = matcher.updateDeco(update, this.decorations);
    }
  },
  { decorations: (plugin) => plugin.decorations },
);

const look = EditorView.theme({
  '.cm-wikilink': { color: 'var(--accent-text)', textDecoration: 'underline' },
  '.cm-wikilink-missing': { color: 'var(--danger)', textDecorationStyle: 'dashed' },
  '.cm-tooltip-autocomplete': { border: '1px solid var(--line)', borderRadius: '8px', background: 'var(--raised)', color: 'var(--text)', fontFamily: 'var(--sans)' },
  '.cm-tooltip-autocomplete ul li[aria-selected]': { background: 'var(--accent-soft)', color: 'var(--text)' },
  '.cm-completionDetail': { marginLeft: '10px', color: 'var(--text-3)', fontStyle: 'normal' },
});

export const wikilinks = [marks, look];
