// Formatting commands for the toolbar and shortcuts. They only ever write
// Markdown into the document, so the file stays exactly what the user sees in
// the plain editor.
import { syntaxTree } from '@codemirror/language';
import { EditorSelection, type EditorState } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';

const LINE_MARK = /^(#{1,6} |> |[-*+] \[[ xX]\] |[-*+] |\d+\. )/;

/** Puts a mark around the selection, or takes it away if it is already there. */
export function wrap(view: EditorView, mark: string, placeholder: string) {
  const { state } = view;
  const size = mark.length;
  view.dispatch(
    state.changeByRange((range) => {
      const outside = state.sliceDoc(range.from - size, range.from) === mark && state.sliceDoc(range.to, range.to + size) === mark;
      if (outside) {
        return {
          changes: [{ from: range.from - size, to: range.from }, { from: range.to, to: range.to + size }],
          range: EditorSelection.range(range.from - size, range.to - size),
        };
      }
      const inner = state.sliceDoc(range.from, range.to) || placeholder;
      return {
        changes: { from: range.from, to: range.to, insert: `${mark}${inner}${mark}` },
        range: EditorSelection.range(range.from + size, range.from + size + inner.length),
      };
    }),
  );
  view.focus();
}

/** Gives the selected lines a prefix, replacing any other one; the same prefix toggles off. */
export function prefixLines(view: EditorView, prefix: string | ((index: number) => string)) {
  const { state } = view;
  const changes: { from: number; to: number; insert: string }[] = [];
  const seen = new Set<number>();
  for (const range of state.selection.ranges) {
    let index = 0;
    for (let pos = range.from; pos <= range.to; ) {
      const line = state.doc.lineAt(pos);
      pos = line.to + 1;
      if (seen.has(line.number)) continue;
      seen.add(line.number);
      const current = LINE_MARK.exec(line.text)?.[0] ?? '';
      const wanted = typeof prefix === 'string' ? prefix : prefix(index);
      index++;
      changes.push({ from: line.from, to: line.from + current.length, insert: current === wanted ? '' : wanted });
    }
  }
  view.dispatch({ changes });
  view.focus();
}

/** Adds a block of text on its own, after the line with the cursor. */
export function insertBlock(view: EditorView, text: string) {
  const { state } = view;
  const line = state.doc.lineAt(state.selection.main.head);
  const filled = line.text.trim() !== '';
  const start = filled ? line.to : line.from;
  const previous = line.number > 1 ? state.doc.line(line.number - 1).text.trim() : '';
  const gap = filled ? '\n\n' : previous ? '\n' : '';
  const insert = `${gap}${text}\n`;
  view.dispatch({
    changes: { from: start, to: line.to, insert },
    selection: { anchor: start + insert.length },
    scrollIntoView: true,
  });
  view.focus();
}

export function insertLink(view: EditorView, placeholder: string) {
  const { state } = view;
  const { from, to } = state.selection.main;
  const text = state.sliceDoc(from, to) || placeholder;
  const url = 'https://';
  const start = from + text.length + 3;
  view.dispatch({
    changes: { from, to, insert: `[${text}](${url})` },
    selection: { anchor: start, head: start + url.length },
  });
  view.focus();
}

export function tableMarkdown(column: string) {
  return `| ${column} 1 | ${column} 2 |\n| --- | --- |\n|  |  |\n|  |  |`;
}

/** The fenced code block around the cursor, if there is one. */
export function fenceAt(state: EditorState) {
  let node: ReturnType<ReturnType<typeof syntaxTree>['resolveInner']> | null = syntaxTree(state).resolveInner(state.selection.main.head);
  while (node && node.name !== 'FencedCode') node = node.parent;
  if (!node) return null;
  const first = state.doc.lineAt(node.from);
  const last = state.doc.lineAt(node.to);
  return {
    from: first.from,
    to: last.to,
    info: first.text.replace(/^\s*[`~]+/, ''),
    source: last.number > first.number ? state.sliceDoc(first.to + 1, last.from) : '',
  };
}

/** Words and characters as the status bar counts them: words are what whitespace separates. */
export function countText(text: string) {
  const trimmed = text.trim();
  return { words: trimmed ? trimmed.split(/\s+/).length : 0, chars: [...text].length };
}

/** What the selection holds, the ranges added up; null when nothing is selected. */
export function countSelection(state: EditorState) {
  let words = 0;
  let chars = 0;
  for (const range of state.selection.ranges) {
    if (range.empty) continue;
    const count = countText(state.sliceDoc(range.from, range.to));
    words += count.words;
    chars += count.chars;
  }
  return chars ? { words, chars } : null;
}
