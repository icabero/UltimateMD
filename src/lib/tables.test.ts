import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { EditorSelection, EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { describe, expect, it } from 'vitest';
import { alignColumn, moveColumn, moveInTable, moveRow, parseTable, writeTableText } from './tables';

const SOURCE = '| A | B | C |\n| :--- | :---: | ---: |\n| 1 | 2 | 3 |\n| 4 | 5 | 6 |';

describe('tables', () => {
  it('reads the cells and how each column is aligned', () => {
    const table = parseTable(SOURCE);
    expect(table.rows).toEqual([['A', 'B', 'C'], ['1', '2', '3'], ['4', '5', '6']]);
    expect(table.aligns).toEqual(['left', 'center', 'right']);
    expect(parseTable('| A |\n| --- |\n| 1 |').aligns).toEqual([null]);
  });

  it('writes the alignment into the delimiter row', () => {
    expect(writeTableText(parseTable(SOURCE))).toBe(SOURCE);
  });

  it('aligns a column, and a second ask takes it back to the default', () => {
    const t = parseTable('| A | B |\n| --- | --- |\n| 1 | 2 |');
    const right = alignColumn(t, 1, 'right')!;
    expect(writeTableText(right)).toBe('| A | B |\n| --- | ---: |\n| 1 | 2 |');
    expect(writeTableText(alignColumn(right, 1, 'right')!)).toBe('| A | B |\n| --- | --- |\n| 1 | 2 |');
    expect(writeTableText(alignColumn(right, 1, 'center')!)).toBe('| A | B |\n| --- | :---: |\n| 1 | 2 |');
    expect(alignColumn(t, 5, 'left')).toBeNull();
  });

  it('moves a body row, never the header and never above the delimiter', () => {
    const t = parseTable(SOURCE);
    expect(moveRow(t, 1, 1)!.rows.map((r) => r[0])).toEqual(['A', '4', '1']);
    expect(moveRow(t, 2, -1)!.rows.map((r) => r[0])).toEqual(['A', '4', '1']);
    expect(moveRow(t, 1, -1)).toBeNull();
    expect(moveRow(t, 2, 1)).toBeNull();
    expect(moveRow(t, 0, 1)).toBeNull();
  });

  it('moves a column with its alignment', () => {
    const moved = moveColumn(parseTable(SOURCE), 0, 1)!;
    expect(writeTableText(moved)).toBe('| B | A | C |\n| :---: | :--- | ---: |\n| 2 | 1 | 3 |\n| 5 | 4 | 6 |');
    expect(moveColumn(parseTable(SOURCE), 0, -1)).toBeNull();
    expect(moveColumn(parseTable(SOURCE), 2, 1)).toBeNull();
  });

  it('keeps escaped pipes through a move', () => {
    const t = parseTable('| a \\| b | `x \\| y` |\n| --- | --- |\n| 1 | 2 |');
    expect(t.rows[0]).toEqual(['a | b', '`x | y`']);
    expect(writeTableText(moveColumn(t, 0, 1)!)).toBe('| `x \\| y` | a \\| b |\n| --- | --- |\n| 2 | 1 |');
  });
});

function editor(doc: string) {
  const at = doc.indexOf('¦');
  return new EditorView({
    state: EditorState.create({ doc: doc.replace('¦', ''), selection: EditorSelection.cursor(at), extensions: [markdown({ base: markdownLanguage })] }),
  });
}

describe('tables in the plain editor', () => {
  it('moves the row under the cursor and the cursor goes with it', () => {
    const view = editor('antes\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n| ¦3 | 4 |\n\nfin');
    expect(moveInTable(view, 'row', -1)).toBe(true);
    expect(view.state.doc.toString()).toBe('antes\n\n| A | B |\n| --- | --- |\n| 3 | 4 |\n| 1 | 2 |\n\nfin');
    expect(view.state.doc.lineAt(view.state.selection.main.head).number).toBe(5);
  });

  it('moves the column under the cursor', () => {
    const view = editor('| A | B |\n| :-- | --- |\n| ¦1 | 2 |');
    moveInTable(view, 'column', 1);
    expect(view.state.doc.toString()).toBe('| B | A |\n| --- | :--- |\n| 2 | 1 |');
  });

  it('leaves the header and the delimiter where they are', () => {
    const view = editor('| A¦ | B |\n| --- | --- |\n| 1 | 2 |');
    expect(moveInTable(view, 'row', 1)).toBe(true);
    expect(view.state.doc.toString()).toBe('| A | B |\n| --- | --- |\n| 1 | 2 |');
  });

  it('does nothing outside a table, so the key keeps its other meaning', () => {
    const view = editor('un párrafo¦\n\notro');
    expect(moveInTable(view, 'row', 1)).toBe(false);
  });
});
