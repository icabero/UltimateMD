// Tags in the editor: `#etiqueta` marked as such, and the vault's tags
// suggested after typing `#`. The backend reads them the same way
// (crates/core/src/tags.rs): not in code, and a heading needs a space.
import type { Completion, CompletionContext, CompletionResult } from '@codemirror/autocomplete';
import { syntaxTree } from '@codemirror/language';
import { Decoration, EditorView, MatchDecorator, ViewPlugin, type DecorationSet, type ViewUpdate } from '@codemirror/view';
import { tr } from './i18n.svelte';
import { store } from './store.svelte';

/** A tag where it can start: after a space or bracket, not inside a word, `C#` or `&#39;`. */
export const TAG = /(?<![\p{L}\p{N}_&/#-])#([\p{L}\p{N}_/-]*[\p{L}_][\p{L}\p{N}_/-]*)/gu;

const TYPING = /(?<![\p{L}\p{N}_&/#-])#[\p{L}\p{N}_/-]*$/u;

/** Not in code, where `#` means something else. */
function inCode(view: EditorView, pos: number) {
  for (let node: ReturnType<typeof syntaxTree>['topNode'] | null = syntaxTree(view.state).resolveInner(pos, 1); node; node = node.parent) {
    if (/Code|CodeText|CodeMark|HTMLBlock|URL/.test(node.name)) return true;
  }
  return false;
}

export async function tagCompletions(context: CompletionContext): Promise<CompletionResult | null> {
  const typed = context.matchBefore(TYPING);
  const tab = store.active;
  if (!typed || !tab || tab.loose) return null;
  // A lone `#` at the start of a line is likely a heading being written.
  if (typed.text === '#' && !context.explicit && context.state.doc.lineAt(typed.from).from === typed.from) return null;
  if (inCode(context.view!, typed.from)) return null;
  const tags = await store.loadTags(tab.vaultId);
  const options: Completion[] = tags.map((t) => ({ label: t.tag, detail: tr('tags.notes', { n: t.notes }), type: 'keyword' }));
  return { from: typed.from + 1, options, validFor: /^[\p{L}\p{N}_/-]*$/u };
}

const matcher = new MatchDecorator({
  regexp: TAG,
  decorate: (add, from, to, match, view) => {
    if (/^\d+$/.test(match[1]) || inCode(view, from)) return;
    add(from, to, Decoration.mark({ class: 'cm-tag' }));
  },
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
  '.cm-tag': { color: 'var(--accent-text)', background: 'var(--accent-soft)', borderRadius: '4px', padding: '0 2px' },
});

export const tagMarks = [marks, look];
