// Linking notes from the editor: suggestions after `[[`, links that look like
// links, and following them with a click.
import type { Completion, CompletionContext, CompletionResult } from '@codemirror/autocomplete';
import { startCompletion } from '@codemirror/autocomplete';
import type { EditorState } from '@codemirror/state';
import { Decoration, EditorView, MatchDecorator, ViewPlugin, type DecorationSet, type ViewUpdate } from '@codemirror/view';
import { tr } from './i18n.svelte';
import { dirName, kindOf, resolveLink, stem } from './paths';
import { store } from './store.svelte';

const TYPING = /\[\[[^\]\n|#]*/;
const VALID = /^[^\]\n|#]*$/;

/** `[[target]]`, `[[target#heading]]` and `[[target|text]]`, but not `![[image]]`. */
export const WIKILINK = /(?<!!)\[\[([^\]\n|#]+)(#[^\]\n|]*)?(?:\|([^\]\n]+))?\]\]/g;

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
  return { from: typed.from + 2, options, validFor: VALID };
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
    if (pos >= from && pos <= from + match[0].length) return { from, to: from + match[0].length, target: match[1].trim() };
  }
  return null;
}

function exists(target: string) {
  const tab = store.active;
  return !tab || resolveLink(target, tab.path, store.files(tab.vaultId)) !== null;
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
