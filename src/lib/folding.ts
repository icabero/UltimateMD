// Folding: a heading hides the section under it, and long blocks and the
// frontmatter can be folded too. The arrows are quiet: they show when the
// pointer is over the gutter or the cursor is on the line, and stay on a line
// whose text is hidden, so that the hidden text is never forgotten.
import { codeFolding, ensureSyntaxTree, foldable, foldEffect, foldGutter, foldKeymap, foldService, foldedRanges } from '@codemirror/language';
import { EditorState, type Extension } from '@codemirror/state';
import { EditorView, keymap } from '@codemirror/view';
import { tr } from './i18n.svelte';

/** What the palette asks of the editor. */
export const FOLD_ALL = 'umd-fold-all';
export const UNFOLD_ALL = 'umd-unfold-all';

const FRONTMATTER_LIMIT = 200;

/** The YAML block at the top of a note folds from the end of its first line to the closing one. */
const frontmatter = foldService.of((state, lineStart, lineEnd) => {
  if (lineStart !== 0 || state.doc.line(1).text.trim() !== '---') return null;
  const last = Math.min(state.doc.lines, FRONTMATTER_LIMIT);
  for (let n = 2; n <= last; n++) {
    const line = state.doc.line(n);
    if (/^(---|\.\.\.)\s*$/.test(line.text)) return { from: lineEnd, to: line.to };
  }
  return null;
});

function marker(open: boolean) {
  const el = document.createElement('span');
  el.className = open ? 'cm-fold-mark' : 'cm-fold-mark folded';
  el.textContent = open ? '⌄' : '›';
  el.title = tr(open ? 'fold.fold' : 'fold.unfold');
  return el;
}

const look = EditorView.theme({
  '.cm-foldGutter': { width: '1.2em' },
  '.cm-foldGutter .cm-gutterElement': { cursor: 'pointer', textAlign: 'center' },
  '.cm-fold-mark': { opacity: '0', color: 'var(--text-3)', transition: 'opacity 120ms' },
  '.cm-fold-mark.folded': { opacity: '1', color: 'var(--accent-text)' },
  '.cm-gutters:hover .cm-fold-mark, .cm-activeLineGutter .cm-fold-mark': { opacity: '1' },
  '.cm-foldPlaceholder': {
    margin: '0 4px',
    padding: '0 6px',
    border: '1px solid var(--line)',
    borderRadius: 'var(--radius-2xs)',
    background: 'var(--hover)',
    color: 'var(--text-2)',
    cursor: 'pointer',
  },
});

/** Where each note has its folds, kept while the app runs so that a note closed and reopened comes back as it was. */
const remembered = new Map<string, [number, number][]>();

/** Remembers the folds of a note as they stand. */
export function rememberFolds(key: string, state: EditorState) {
  const ranges: [number, number][] = [];
  foldedRanges(state).between(0, state.doc.length, (from, to) => void ranges.push([from, to]));
  if (ranges.length) remembered.set(key, ranges);
  else remembered.delete(key);
}

/** Folds again what was folded when the note was last shown, wherever the text still has such a section. */
export function restoreFolds(key: string, state: EditorState) {
  const ranges = remembered.get(key);
  if (!ranges) return state;
  ensureSyntaxTree(state, state.doc.length, 200);
  const effects = ranges.flatMap(([from, to]) => {
    if (to > state.doc.length) return [];
    const line = state.doc.lineAt(from);
    const found = foldable(state, line.from, line.to);
    return found && found.from === from && found.to === to ? [foldEffect.of({ from, to })] : [];
  });
  return effects.length ? state.update({ effects }).state : state;
}

/** The folding of the editor: arrows in the gutter and the usual keys. */
export function folding(kind: string): Extension {
  return [
    kind === 'md' ? frontmatter : [],
    codeFolding({
      placeholderDOM(_view, onclick) {
        const el = document.createElement('span');
        el.className = 'cm-foldPlaceholder';
        el.textContent = '…';
        el.title = tr('fold.unfold');
        el.setAttribute('aria-label', tr('fold.folded'));
        el.onclick = onclick;
        return el;
      },
    }),
    foldGutter({ markerDOM: marker }),
    // Without CodeMirror's Ctrl+Alt+[ and ]: on Windows AltGr arrives as Ctrl+Alt, and
    // Spanish and other keyboards type [ and ] with it, so typing a [[link]] folded the note.
    keymap.of(foldKeymap.filter((binding) => !binding.key?.startsWith('Ctrl-Alt-'))),
    look,
  ];
}
