// Markdown tables as data: the cells, how each column is aligned, and the
// changes the table's actions make. The widget and the plain editor share them.
import { syntaxTree } from '@codemirror/language';
import { EditorSelection, type EditorState } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';

export type Align = 'left' | 'center' | 'right' | null;

export interface Table {
  /** The header first, then the body. Every row has a cell per column. */
  rows: string[][];
  aligns: Align[];
}

const CELL_SEPARATOR = /(?<!\\)\|/;

export function splitRow(line: string) {
  const inner = line.trim().replace(/^\|/, '').replace(/(?<!\\)\|$/, '');
  return inner.split(CELL_SEPARATOR).map((cell) => cell.trim().replace(/\\([\\|])/g, '$1'));
}

export const joinRow = (cells: string[]) => `| ${cells.map((cell) => cell.replace(/\s+/g, ' ').trim().replace(/[\\|]/g, '\\$&')).join(' | ')} |`;

export function alignOf(cell: string): Align {
  const c = cell.trim();
  const left = c.startsWith(':');
  const right = c.endsWith(':');
  return left && right ? 'center' : left ? 'left' : right ? 'right' : null;
}

const DASHES: Record<string, string> = { left: ':---', center: ':---:', right: '---:', none: '---' };

export const delimiterRow = (aligns: Align[]) => joinRow(aligns.map((a) => DASHES[a ?? 'none']));

export function parseTable(text: string): Table {
  const lines = text.split('\n');
  const head = splitRow(lines[0]);
  const rows = [head, ...lines.slice(2).map(splitRow)].map((row) => head.map((_, i) => row[i] ?? ''));
  const delimiter = splitRow(lines[1] ?? '');
  return { rows, aligns: head.map((_, i) => alignOf(delimiter[i] ?? '')) };
}

export function writeTableText(table: Table) {
  const [head, ...body] = table.rows.map(joinRow);
  return [head, delimiterRow(table.aligns), ...body].join('\n');
}

/** Moves a body row one place. The header stays on top, and nothing goes above the delimiter. */
export function moveRow(table: Table, row: number, by: -1 | 1): Table | null {
  const to = row + by;
  if (row < 1 || to < 1 || to >= table.rows.length) return null;
  const rows = [...table.rows];
  [rows[row], rows[to]] = [rows[to], rows[row]];
  return { rows, aligns: table.aligns };
}

export function moveColumn(table: Table, column: number, by: -1 | 1): Table | null {
  const to = column + by;
  if (column < 0 || to < 0 || to >= table.aligns.length) return null;
  const swap = <T>(list: T[]) => {
    const next = [...list];
    [next[column], next[to]] = [next[to], next[column]];
    return next;
  };
  return { rows: table.rows.map(swap), aligns: swap(table.aligns) };
}

/** Aligns a column. Asking for the alignment it already has takes it back to the default. */
export function alignColumn(table: Table, column: number, align: Exclude<Align, null>): Table | null {
  if (column < 0 || column >= table.aligns.length) return null;
  const aligns = [...table.aligns];
  aligns[column] = aligns[column] === align ? null : align;
  return { rows: table.rows, aligns };
}

// ---- The plain editor: the same actions on the table under the cursor.

/** The lines of the table around `pos`, if it is a plain top-level Markdown table. */
function tableAround(state: EditorState, pos: number) {
  for (let node: ReturnType<typeof syntaxTree>['topNode'] | null = syntaxTree(state).resolveInner(pos, 1); node; node = node.parent) {
    if (node.name !== 'Table') continue;
    if (node.parent?.name !== 'Document') return null;
    const first = state.doc.lineAt(node.from);
    const last = state.doc.lineAt(node.to);
    return { from: first.from, to: last.to, firstLine: first.number, text: state.sliceDoc(first.from, last.to) };
  }
  return null;
}

/** The column under the cursor: the unescaped pipes before it, as the cells are counted. */
function columnAt(line: string, offset: number) {
  const before = line.slice(0, offset).replace(/^\s*\|/, '');
  return before.split(CELL_SEPARATOR).length - 1;
}

/** Moves the row or column under the cursor. Returns false when the cursor is not in a table, so the key keeps its other meaning. */
export function moveInTable(view: EditorView, axis: 'row' | 'column', by: -1 | 1): boolean {
  const { state } = view;
  const head = state.selection.main.head;
  const found = tableAround(state, head);
  if (!found) return false;
  const line = state.doc.lineAt(head);
  const index = line.number - found.firstLine;
  const table = parseTable(found.text);
  // Row 1 of the text is the delimiter: no row to move there.
  const column = Math.min(Math.max(columnAt(line.text, head - line.from), 0), table.aligns.length - 1);
  const moved = axis === 'row' ? (index < 2 ? null : moveRow(table, index - 1, by)) : moveColumn(table, column, by);
  if (!moved) return true;
  const text = writeTableText(moved);
  const target = axis === 'row' ? index + by : index;
  const lines = text.split('\n');
  const rowText = lines[target];
  let anchor = found.from + lines.slice(0, target).reduce((n, l) => n + l.length + 1, 0);
  if (axis === 'row') anchor += Math.min(head - line.from, rowText.length);
  else {
    // The start of the text of the moved column.
    const pipes = [...rowText.matchAll(/(?<!\\)\|/g)];
    const at = pipes[column + by]?.index;
    anchor += at === undefined ? rowText.length : Math.min(at + 2, rowText.length);
  }
  view.dispatch({ changes: { from: found.from, to: found.to, insert: text }, selection: EditorSelection.cursor(anchor), scrollIntoView: true, userEvent: 'input.move' });
  return true;
}
