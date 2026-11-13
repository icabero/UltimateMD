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

const TASK = /^(\s*)([-*+]|\d+[.)])\s+\[([ xX])\](?=\s|$)/;
const ITEM = /^(\s*)([-*+]|\d+[.)])\s+/;

/**
 * What the lines become as tasks. If all of them already are, they are checked,
 * or unchecked when they all were checked; otherwise the ones that are not
 * tasks become unchecked ones and the tasks stay as they are. Blank lines are
 * left alone, unless that is the only line.
 */
export function taskLines(lines: string[]): string[] {
  const filled = lines.filter((l) => l.trim() !== '');
  const tasks = filled.map((l) => TASK.exec(l));
  const everyTask = filled.length > 0 && tasks.every(Boolean);
  const allChecked = everyTask && tasks.every((m) => m![3] !== ' ');
  return lines.map((line) => {
    if (line.trim() === '' && lines.length > 1) return line;
    const task = TASK.exec(line);
    if (task) {
      if (!everyTask) return line;
      const at = task[0].length - 2;
      return line.slice(0, at) + (allChecked ? ' ' : 'x') + line.slice(at + 1);
    }
    const item = ITEM.exec(line);
    if (item) return `${item[0]}[ ] ${line.slice(item[0].length)}`;
    const indent = /^\s*/.exec(line)![0];
    return `${indent}- [ ] ${line.slice(indent.length)}`;
  });
}

/** The first and last line a range touches; a range ending at the start of a line leaves that line out. */
function linesOf(state: EditorState, from: number, to: number): [number, number] {
  const first = state.doc.lineAt(from).number;
  const last = state.doc.lineAt(to);
  return [first, to > from && to === last.from && last.number > first ? last.number - 1 : last.number];
}

/** Turns the lines with the cursor or the selection into tasks, or ticks and unticks them. */
export function toggleTask(view: EditorView) {
  const { state } = view;
  const numbers = new Set<number>();
  for (const range of state.selection.ranges) {
    const [first, last] = linesOf(state, range.from, range.to);
    for (let n = first; n <= last; n++) numbers.add(n);
  }
  const ordered = [...numbers].sort((a, b) => a - b).map((n) => state.doc.line(n));
  const next = taskLines(ordered.map((l) => l.text));
  // Only the part that differs is replaced, so the cursor stays where it was in the text.
  const changes = ordered.flatMap((line, i) => {
    const before = line.text;
    const after = next[i];
    if (after === before) return [];
    let start = 0;
    while (start < before.length && before[start] === after[start]) start++;
    let end = 0;
    while (end < before.length - start && end < after.length - start && before[before.length - 1 - end] === after[after.length - 1 - end]) end++;
    return [{ from: line.from + start, to: line.to - end, insert: after.slice(start, after.length - end) }];
  });
  if (changes.length) view.dispatch({ changes, userEvent: 'input' });
  view.focus();
}

/** A to Z, numbers by value and ignoring accents and case: «Árbol» goes among the A and «nota 2» before «nota 10». */
export function sortedLines(lines: string[]): string[] {
  const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
  return [...lines].sort((a, b) => collator.compare(a, b) || (a < b ? -1 : a > b ? 1 : 0));
}

/** Sorts the lines of each selection, in one change that undoes at once. False when no selection covers two lines. */
export function sortSelectedLines(view: EditorView) {
  const { state } = view;
  const changes: { from: number; to: number; insert: string }[] = [];
  let found = false;
  let done = 0;
  for (const range of state.selection.ranges) {
    const [first, last] = linesOf(state, range.from, range.to);
    // Two selections can share a line; the first one keeps it.
    if (last <= first || first <= done) continue;
    found = true;
    done = last;
    const from = state.doc.line(first).from;
    const to = state.doc.line(last).to;
    const lines: string[] = [];
    for (let n = first; n <= last; n++) lines.push(state.doc.line(n).text);
    const insert = sortedLines(lines).join(state.lineBreak);
    if (insert !== state.sliceDoc(from, to)) changes.push({ from, to, insert });
  }
  if (changes.length) view.dispatch({ changes, userEvent: 'input' });
  view.focus();
  return found;
}
