// Where the formulas are in the editor's text, by the same rules the preview
// uses, and how they look as source: a colour of their own and no emphasis
// from the `_` and `*` inside them.
import { syntaxTree } from '@codemirror/language';
import type { EditorState, Range } from '@codemirror/state';
import { Decoration, EditorView, ViewPlugin, type DecorationSet, type ViewUpdate } from '@codemirror/view';
import { blockFormula, inlineFormula } from './math';

/** How far below `$$` the editor looks for the `$$` that closes it. */
const MAX_BLOCK_LINES = 200;

export interface FormulaSpan {
  from: number;
  to: number;
  content: string;
  block: boolean;
  /** Inline only: `$$ ... $$` inside a line. */
  display: boolean;
}

/** The formulas of the document from `start` on, left out where there is code. */
export function findFormulas(state: EditorState, start = 0): FormulaSpan[] {
  const { doc } = state;
  const tree = syntaxTree(state);
  const inCode = (pos: number) => /Code/.test(tree.resolveInner(pos, 1).name);
  const out: FormulaSpan[] = [];
  for (let n = doc.lineAt(start).number; n <= doc.lines; n++) {
    const line = doc.line(n);
    if (!line.text.includes('$')) continue;
    const indent = line.text.length - line.text.trimStart().length;
    if (indent < 4 && line.text.startsWith('$$', indent) && !inCode(line.from + indent)) {
      const found = blockFormula((i) => doc.line(i).text.trimStart(), n, Math.min(doc.lines + 1, n + MAX_BLOCK_LINES));
      if (found) {
        out.push({ from: line.from, to: doc.line(found.last).to, content: found.content, block: true, display: true });
        n = found.last;
        continue;
      }
    }
    for (let i = 0; i < line.text.length; i++) {
      if (line.text[i] === '\\') {
        i++;
      } else if (line.text[i] === '$' && !inCode(line.from + i)) {
        const found = inlineFormula(line.text, i, line.text.length);
        if (!found) continue;
        out.push({ from: line.from + i, to: line.from + found.end, content: found.content, block: false, display: found.display });
        i = found.end - 1;
      }
    }
  }
  return out;
}

const formula = Decoration.mark({ class: 'cm-math' });

function marks(state: EditorState): DecorationSet {
  const ranges: Range<Decoration>[] = findFormulas(state).map((f) => formula.range(f.from, f.to));
  return Decoration.set(ranges, true);
}

/** Formulas in the plain editor: marked, so that `$x_1$` does not read as emphasis. */
const plainMarks = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = marks(view.state);
    }
    update(update: ViewUpdate) {
      if (update.docChanged || update.viewportChanged || syntaxTree(update.startState) !== syntaxTree(update.state)) {
        this.decorations = marks(update.state);
      }
    }
  },
  { decorations: (plugin) => plugin.decorations },
);

export const mathLook = EditorView.theme({
  '.cm-math': { color: 'var(--syn-number)', fontFamily: 'var(--mono)' },
  '.cm-math *': { color: 'inherit', fontStyle: 'normal', fontWeight: 'normal', textDecoration: 'none' },
});

export const mathMarks = [plainMarks, mathLook];
