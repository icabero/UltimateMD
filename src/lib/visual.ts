// The visual editing mode: formatted text as you type, like a word processor.
// It only changes how the document is drawn. The marks come back on the line
// with the cursor, and the file on disk remains plain Markdown.
import { ensureSyntaxTree, syntaxTree } from '@codemirror/language';
import { Prec, StateField, Transaction, type EditorState, type Range } from '@codemirror/state';
import { Decoration, EditorView, ViewPlugin, WidgetType, type DecorationSet } from '@codemirror/view';
import { CALLOUT_START, describeCallout } from './callouts';
import { parseStyle, type DiagramStyle } from './diagramStyle';
import { findFormulas } from './mathSource';
import { renderMath } from './math';
import { diagramErrorBox, explainDiagramError } from './diagramErrors';
import { renderDiagram } from './diagrams';
import { tr } from './i18n.svelte';
import { store } from './store.svelte';
import { themeKey, type Theme } from './themes';
import { WIKILINK, linkAt } from './wikilinks';

const PARSE_BUDGET_MS = 100;
const DIAGRAM_HEIGHT = 220;
const MATH_HEIGHT = 60;
const FRONTMATTER_LIMIT = 20_000;
const DIAGRAM_FENCE = /^(`{3,}|~{3,})\s*(mermaid|d2)(?:\s+(.*))?$/i;

/** Asks the editor to open the diagram under the cursor. */
export const EDIT_DIAGRAM = 'umd-edit-diagram';
/** What the palette asks of the editor: tick the lines as tasks, or sort them. */
export const TOGGLE_TASK = 'umd-toggle-task';
export const SORT_LINES = 'umd-sort-lines';
const FRONTMATTER = /^---\r?\n[\s\S]*?\n---[ \t]*(\r?\n|$)/;
const HIDDEN_MARKS = new Set(['EmphasisMark', 'StrikethroughMark']);

const hidden = Decoration.replace({});
const lineClass = (name: string) => Decoration.line({ class: name });

class BulletWidget extends WidgetType {
  eq() {
    return true;
  }
  toDOM() {
    const el = document.createElement('span');
    el.className = 'cm-v-bullet';
    el.textContent = '•';
    return el;
  }
}

class CheckboxWidget extends WidgetType {
  constructor(readonly checked: boolean) {
    super();
  }
  eq(other: CheckboxWidget) {
    return other.checked === this.checked;
  }
  toDOM(view: EditorView) {
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.className = 'cm-v-check';
    box.checked = this.checked;
    box.onmousedown = (e) => {
      e.preventDefault();
      const from = view.posAtDOM(box);
      view.dispatch({ changes: { from, to: from + 3, insert: this.checked ? '[ ]' : '[x]' } });
    };
    return box;
  }
  ignoreEvent() {
    return false;
  }
}

/** A formula drawn, in the line or as a block of its own. A click puts the cursor in it and brings its source back. */
class MathWidget extends WidgetType {
  constructor(readonly tex: string, readonly block: boolean, readonly display: boolean) {
    super();
  }
  eq(other: MathWidget) {
    return other.tex === this.tex && other.block === this.block && other.display === this.display;
  }
  get estimatedHeight() {
    return this.block ? MATH_HEIGHT : -1;
  }
  toDOM() {
    const el = document.createElement(this.block ? 'div' : 'span');
    el.className = this.block ? 'cm-v-math-block' : 'cm-v-math';
    el.innerHTML = renderMath(this.tex, this.display);
    return el;
  }
  ignoreEvent() {
    return false;
  }
}

class DiagramWidget extends WidgetType {
  constructor(readonly lang: string, readonly src: string, readonly theme: Theme, readonly sketch: boolean, readonly animated = false) {
    super();
  }
  eq(other: DiagramWidget) {
    return other.lang === this.lang && other.src === this.src && other.sketch === this.sketch && other.animated === this.animated && themeKey(other.theme) === themeKey(this.theme);
  }
  get estimatedHeight() {
    return DIAGRAM_HEIGHT;
  }
  toDOM(view: EditorView) {
    const el = document.createElement('div');
    el.className = this.animated ? 'cm-v-diagram animated' : 'cm-v-diagram';
    const edit = () => {
      const start = view.state.doc.lineAt(view.posAtDOM(el));
      view.dispatch({ selection: { anchor: Math.min(start.to + 1, view.state.doc.length) } });
      view.dom.dispatchEvent(new CustomEvent(EDIT_DIAGRAM));
    };
    renderDiagram(this.lang, this.src, this.theme, this.sketch).then(
      (svg) => (el.innerHTML = svg),
      (e) => el.replaceChildren(diagramErrorBox(explainDiagramError(this.lang, this.src, e), edit)),
    );
    el.onmousedown = (e) => {
      e.preventDefault();
      edit();
    };
    return el;
  }
  ignoreEvent() {
    return false;
  }
}

const MIN_CELL_WIDTH = 8;
const CELL_SEPARATOR = /(?<!\\)\|/;

function splitRow(line: string) {
  const inner = line.trim().replace(/^\|/, '').replace(/(?<!\\)\|$/, '');
  return inner.split(CELL_SEPARATOR).map((cell) => cell.trim().replace(/\\([\\|])/g, '$1'));
}

const joinRow = (cells: string[]) => `| ${cells.map((cell) => cell.replace(/\s+/g, ' ').trim().replace(/[\\|]/g, '\\$&')).join(' | ')} |`;

function tableRows(text: string) {
  const lines = text.split('\n');
  const head = splitRow(lines[0]);
  return [head, ...lines.slice(2).map(splitRow)].map((row) => head.map((_, i) => row[i] ?? ''));
}

const cleanCell = (value: string) => value.replace(/\s+/g, ' ').trim();

/** The Markdown each drawn table stands for, which outlives any one widget. */
const tableText = new WeakMap<HTMLElement, string>();

/** Writes a table back. Its cells stay as they are, so typing never loses its place. */
function writeTable(view: EditorView, wrap: HTMLElement, rows: string[][]) {
  const text = tableText.get(wrap)!;
  const lines = text.split('\n');
  const divider = splitRow(lines[1]).length === rows[0].length ? lines[1] : joinRow(Array(rows[0].length).fill('---'));
  const [head, ...body] = rows.map(joinRow);
  const next = [head, divider, ...body].join('\n');
  if (next === text) return;
  const from = view.posAtDOM(wrap);
  tableText.set(wrap, next);
  view.dispatch({ changes: { from, to: from + text.length, insert: next } });
}

/**
 * A Markdown table drawn as a table, with its cells editable in place. They are
 * form fields, cut off from the editor around them: an editable element inside
 * CodeMirror would hand it keys like Ctrl+A, and typing would replace the note.
 */
class TableWidget extends WidgetType {
  constructor(readonly text: string) {
    super();
  }
  eq(other: TableWidget) {
    return other.text === this.text;
  }
  ignoreEvent() {
    return true;
  }
  ignoreMutation() {
    return true;
  }

  /** Keeps the table on screen through an edit, unless its shape changed. */
  updateDOM(dom: HTMLElement) {
    const rows = tableRows(this.text);
    const table = dom.querySelector('table')!;
    if (table.rows.length !== rows.length || table.rows[0].cells.length !== rows[0].length) return false;
    tableText.set(dom, this.text);
    rows.forEach((row, r) => row.forEach((value, c) => {
      const input = table.rows[r].cells[c].querySelector('input')!;
      if (cleanCell(input.value) !== value) input.value = value;
    }));
    return true;
  }

  toDOM(view: EditorView) {
    const wrap = document.createElement('div');
    wrap.className = 'cm-v-table';
    tableText.set(wrap, this.text);
    const table = wrap.appendChild(document.createElement('table'));
    const read = () => [...table.rows].map((row) => [...row.querySelectorAll('input')].map((input) => input.value));
    tableRows(this.text).forEach((row, r) => {
      const line = table.appendChild(document.createElement('tr'));
      for (const value of row) {
        const cell = line.appendChild(document.createElement(r === 0 ? 'th' : 'td'));
        const input = cell.appendChild(document.createElement('input'));
        const fit = () => (input.size = Math.max(MIN_CELL_WIDTH, input.value.length + 1));
        input.value = value;
        input.oninput = () => {
          fit();
          writeTable(view, wrap, read());
        };
        fit();
      }
    });
    wrap.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key !== 'Enter' || !(e.target instanceof HTMLInputElement)) return;
      e.preventDefault();
      const cell = e.target.parentElement as HTMLTableCellElement;
      const below = table.rows[(cell.parentElement as HTMLTableRowElement).rowIndex + 1];
      below?.cells[cell.cellIndex].querySelector('input')?.focus();
    });
    for (const type of ['beforeinput', 'input', 'paste', 'cut', 'copy']) wrap.addEventListener(type, (e) => e.stopPropagation());

    const tools = wrap.appendChild(document.createElement('div'));
    tools.className = 'cm-v-table-tools';
    const tool = (label: string, change: (rows: string[][]) => string[][] | null) => {
      const button = tools.appendChild(document.createElement('button'));
      button.textContent = label;
      button.onmousedown = (e) => e.preventDefault();
      button.onclick = () => {
        const changed = change(read());
        if (changed) writeTable(view, wrap, changed);
      };
    };
    tool(tr('table.addRow'), (now) => [...now, now[0].map(() => '')]);
    tool(tr('table.addColumn'), (now) => now.map((row, i) => [...row, i === 0 ? `${tr('toolbar.column')} ${row.length + 1}` : '']));
    tool(tr('table.removeRow'), (now) => (now.length > 2 ? now.slice(0, -1) : null));
    tool(tr('table.removeColumn'), (now) => (now[0].length > 1 ? now.map((row) => row.slice(0, -1)) : null));
    return wrap;
  }
}

function touchesCursor(state: EditorState, from: number, to: number) {
  const first = state.doc.lineAt(from).from;
  const last = state.doc.lineAt(to).to;
  return state.selection.ranges.some((r) => r.from <= last && r.to >= first);
}

/** The end of a mark and the space after it, as in `## `. */
const afterSpace = (state: EditorState, to: number) => (state.sliceDoc(to, to + 1) === ' ' ? to + 1 : to);

function diagramLook(style: DiagramStyle) {
  const tab = store.active;
  return tab ? store.diagramLook(tab, style, tab.content) : { theme: store.theme, sketch: false };
}

/**
 * What the mode draws. Tables and diagrams are solid blocks: a click never turns
 * them back into text. They only stay as text while being typed by hand.
 */
function decorate(state: EditorState, typing: boolean) {
  const out: Range<Decoration>[] = [];
  const blocks: Range<Decoration>[] = [];
  const block = (widget: WidgetType, from: number, to: number) => {
    const range = Decoration.replace({ widget, block: true }).range(from, to);
    out.push(range);
    blocks.push(range);
  };
  const size = state.doc.length;
  const tree = ensureSyntaxTree(state, size, PARSE_BUDGET_MS) ?? syntaxTree(state);
  const head = FRONTMATTER.exec(state.sliceDoc(0, Math.min(size, FRONTMATTER_LIMIT)));
  const bodyStart = head?.[0].length ?? 0;
  for (let pos = 0; pos < bodyStart; ) {
    const line = state.doc.lineAt(pos);
    out.push(lineClass('cm-v-meta').range(line.from));
    pos = line.to + 1;
  }

  const links: { from: number; to: number }[] = [];
  for (const match of state.sliceDoc(bodyStart).matchAll(WIKILINK)) {
    const from = bodyStart + match.index;
    const to = from + match[0].length;
    if (/Code/.test(tree.resolveInner(from + 1).name)) continue;
    links.push({ from, to });
    if (touchesCursor(state, from, to)) continue;
    const textStart = match[3] === undefined ? from + 2 : to - 2 - match[3].length;
    out.push(hidden.range(from, textStart), hidden.range(to - 2, to));
  }

  // The marks inside a formula stay as they are: `a_1 * b_2` is not emphasis.
  const formulas = findFormulas(state, bodyStart);
  for (const f of formulas) links.push({ from: f.from, to: f.to });

  tree.iterate({
    enter(node) {
      const { name, from, to } = node;
      if (links.some((l) => from >= l.from && to <= l.to)) return false;
      if (name === 'Document') return true;
      if (from < bodyStart) return false;
      const active = touchesCursor(state, from, to);

      if (name === 'FencedCode') {
        const first = state.doc.lineAt(from);
        const last = state.doc.lineAt(to);
        const fence = DIAGRAM_FENCE.exec(first.text.trim());
        const closed = last.number > first.number && /^\s*(`{3,}|~{3,})\s*$/.test(last.text);
        if (fence && closed && !(typing && active)) {
          const src = state.sliceDoc(first.to + 1, last.from);
          const style = parseStyle(fence[3] ?? '');
          const { theme, sketch } = diagramLook(style);
          block(new DiagramWidget(fence[2].toLowerCase(), src, theme, sketch, !!style.animated), first.from, last.to);
        } else {
          for (let n = first.number; n <= last.number; n++) out.push(lineClass('cm-v-code').range(state.doc.line(n).from));
        }
        return false;
      }
      if (name === 'Image') return false;
      if (name === 'Table' && !(typing && active)) {
        const first = state.doc.lineAt(from);
        const last = state.doc.lineAt(to);
        block(new TableWidget(state.sliceDoc(first.from, last.to)), first.from, last.to);
        return false;
      }

      const heading = /^(?:ATX|Setext)Heading(\d)$/.exec(name);
      if (heading) out.push(lineClass(`cm-v-h${heading[1]}`).range(state.doc.lineAt(from).from));
      if (name === 'Blockquote') {
        const start = state.doc.lineAt(from);
        const end = state.doc.lineAt(to).number;
        // A callout gets the colour of its kind; its first line is the title.
        const callout = CALLOUT_START.exec(start.text.replace(/^\s*>\s?/, ''));
        const look = callout ? `cm-v-callout cm-v-callout-${describeCallout(callout[1]).kind}` : 'cm-v-quote';
        for (let n = start.number; n <= end; n++) out.push(lineClass(look).range(state.doc.line(n).from));
        if (callout) out.push(lineClass('cm-v-callout-title').range(start.from));
      }
      if (name === 'HorizontalRule') out.push(lineClass('cm-v-rule').range(state.doc.lineAt(from).from));
      if (name === 'InlineCode') out.push(Decoration.mark({ class: 'cm-v-inline-code' }).range(from, to));
      if (name === 'Link') out.push(Decoration.mark({ class: 'cm-v-link' }).range(from, to));

      if (active) return;
      const parent = node.node.parent;
      if (name === 'HorizontalRule') out.push(hidden.range(from, to));
      else if (name === 'HeaderMark' && parent?.name.startsWith('ATX')) out.push(hidden.range(from, afterSpace(state, to)));
      else if (name === 'QuoteMark') out.push(hidden.range(from, afterSpace(state, to)));
      else if (HIDDEN_MARKS.has(name)) out.push(hidden.range(from, to));
      else if (name === 'CodeMark' && parent?.name === 'InlineCode') out.push(hidden.range(from, to));
      else if (parent?.name === 'Link' && (name === 'LinkMark' || name === 'URL' || name === 'LinkTitle')) out.push(hidden.range(from, to));
      else if (name === 'TaskMarker') out.push(Decoration.replace({ widget: new CheckboxWidget(state.sliceDoc(from + 1, from + 2).toLowerCase() === 'x') }).range(from, to));
      else if (name === 'ListMark' && parent?.parent?.name === 'BulletList') {
        if (parent.getChild('Task')) out.push(hidden.range(from, afterSpace(state, to)));
        else out.push(Decoration.replace({ widget: new BulletWidget() }).range(from, to));
      }
    },
  });
  // Drawn when the cursor is elsewhere. Not inside a table or diagram, which draw themselves.
  for (const f of formulas) {
    if (touchesCursor(state, f.from, f.to) || blocks.some((b) => b.from < f.to && b.to > f.from)) continue;
    const widget = new MathWidget(f.content, f.block, f.display);
    out.push(f.block ? Decoration.replace({ widget, block: true }).range(f.from, f.to) : Decoration.replace({ widget }).range(f.from, f.to));
  }
  return { all: Decoration.set(out, true), blocks: Decoration.set(blocks, true) };
}

const decorations = StateField.define<{ all: DecorationSet; blocks: DecorationSet }>({
  create: (state) => decorate(state, false),
  update: (value, change) => (change.docChanged || change.selection ? decorate(change.state, change.docChanged && change.isUserEvent('input')) : value),
  provide: (field) => EditorView.decorations.from(field, (value) => value.all),
});

/** The cursor goes around a block, never into it. */
const solidBlocks = EditorView.atomicRanges.of((view) => view.state.field(decorations).blocks);

/** Text typed against a block starts its own line, instead of breaking the block. */
const keepBlocksWhole = EditorView.inputHandler.of((view, from, to, text) => {
  if (from !== to) return false;
  const { blocks } = view.state.field(decorations);
  const line = view.state.doc.lineAt(from);
  let insert: string | null = null;
  blocks.between(from, from, (start, end) => {
    if (end === from) insert = `\n${text}`;
    else if (start === from) insert = `${text}\n`;
  });
  // In Markdown, a line right below a table is another row of it. Only a `|`
  // says that is what the user wants.
  if (insert === null && line.length === 0 && line.number > 1 && !text.startsWith('|')) {
    blocks.between(line.from - 1, line.from - 1, (_, end) => {
      if (end === line.from - 1) insert = `\n${text}`;
    });
  }
  if (insert === null) return false;
  const typed: string = insert;
  view.dispatch({ changes: { from, insert: typed }, selection: { anchor: from + (typed.startsWith('\n') ? typed.length : text.length) }, userEvent: 'input.type' });
  return true;
});

const look = EditorView.theme({
  '.cm-gutters': { display: 'none' },
  '.cm-scroller': { fontFamily: 'var(--sans)', fontSize: 'calc(15px * var(--text-scale, 1))', lineHeight: 'calc(1.65 + var(--leading, 0))' },
  '.cm-content': { maxWidth: 'var(--prose-width, 760px)', margin: '0 auto', width: '100%' },
  '.cm-activeLine': { background: 'transparent' },
  '.cm-v-h1': { fontSize: '1.9em', fontWeight: '700', lineHeight: '1.3' },
  '.cm-v-h2': { fontSize: '1.5em', fontWeight: '700', lineHeight: '1.3' },
  '.cm-v-h3': { fontSize: '1.25em', fontWeight: '650' },
  '.cm-v-h4, .cm-v-h5, .cm-v-h6': { fontSize: '1.05em', fontWeight: '650' },
  '.cm-v-quote': { borderLeft: '3px solid var(--line)', color: 'var(--text-2)', fontStyle: 'italic' },
  '.cm-v-callout': { '--callout': '#2563eb', borderLeft: '3px solid var(--callout)', background: 'color-mix(in srgb, var(--callout) 9%, transparent)' },
  '.cm-v-callout-tip': { '--callout': '#16a34a' },
  '.cm-v-callout-important': { '--callout': '#7c3aed' },
  '.cm-v-callout-warning': { '--callout': '#d97706' },
  '.cm-v-callout-caution': { '--callout': '#dc2626' },
  '.cm-v-callout-title': { color: 'color-mix(in srgb, var(--callout) 70%, var(--text))', fontWeight: '650' },
  '.cm-v-code': { background: 'var(--panel)', fontFamily: 'var(--mono)', fontSize: 'calc(13px * var(--text-scale, 1))' },
  '.cm-v-meta': { color: 'var(--text-3)', fontFamily: 'var(--mono)', fontSize: 'calc(12.5px * var(--text-scale, 1))' },
  '.cm-v-inline-code': { padding: '1px 4px', borderRadius: '4px', background: 'var(--panel)', fontFamily: 'var(--mono)', fontSize: '.9em' },
  '.cm-v-link': { color: 'var(--accent-text)', textDecoration: 'underline' },
  '.cm-v-rule': { lineHeight: '.6', borderBottom: '1px solid var(--line)' },
  '.cm-v-bullet': { color: 'var(--text-2)' },
  '.cm-v-check': { margin: '0 6px 0 0', verticalAlign: 'middle', accentColor: 'var(--accent)' },
  '.cm-v-table': { margin: '8px 0' },
  '.cm-v-table table': { borderCollapse: 'collapse', maxWidth: '100%' },
  '.cm-v-table th, .cm-v-table td': { padding: '0', border: '1px solid var(--line)' },
  '.cm-v-table th': { background: 'var(--panel)' },
  '.cm-v-table input': { display: 'block', height: 'auto', padding: '6px 10px', border: '0', borderRadius: '0', background: 'transparent', color: 'inherit', font: 'inherit', outline: 'none' },
  '.cm-v-table th input': { fontWeight: '600' },
  '.cm-v-table input:focus': { boxShadow: 'inset 0 0 0 2px var(--accent)' },
  '.cm-v-table ::selection': { background: 'transparent' },
  '.cm-v-table input:focus::selection': { background: 'var(--selection)' },
  '.cm-v-table-tools': { display: 'flex', gap: '4px', marginTop: '4px', opacity: '0', transition: 'opacity 120ms' },
  '.cm-v-table:hover .cm-v-table-tools, .cm-v-table:focus-within .cm-v-table-tools': { opacity: '1' },
  '.cm-v-table-tools button': { padding: '2px 8px', border: '1px solid var(--line)', borderRadius: '5px', background: 'var(--raised)', color: 'var(--text-2)', fontFamily: 'var(--sans)', fontSize: '11.5px' },
  '.cm-v-math-block': { margin: '6px 0', overflowX: 'auto', overflowY: 'hidden', cursor: 'text' },
  '.cm-v-math': { cursor: 'text' },
  '.cm-v-diagram': { display: 'flex', justifyContent: 'center', minHeight: '40px', padding: '8px 0', cursor: 'pointer' },
  '.cm-v-diagram svg': { maxWidth: '100%', height: 'auto' },
  '.cm-v-diagram .diagram-error': { width: '100%', padding: '10px 14px', border: '1px solid var(--line)', borderRadius: '8px', fontFamily: 'var(--sans)', fontSize: '13px', lineHeight: '1.5', cursor: 'default' },
  '.cm-v-diagram .diagram-error strong': { display: 'block', color: 'var(--danger)' },
  '.cm-v-diagram .diagram-error p': { margin: '4px 0 0' },
  '.cm-v-diagram .diagram-error button': { marginTop: '8px', padding: '3px 10px', border: '1px solid var(--line)', borderRadius: '5px', background: 'var(--raised)', color: 'var(--text)', fontFamily: 'var(--sans)', fontSize: '12px', cursor: 'pointer' },
  '.cm-v-diagram .diagram-error details': { marginTop: '8px', color: 'var(--text-2)', fontSize: '12px' },
  '.cm-v-diagram .diagram-error summary': { cursor: 'pointer' },
  '.cm-v-diagram .diagram-error pre': { margin: '4px 0 0', padding: '8px', background: 'var(--hover)', whiteSpace: 'pre-wrap', fontSize: '11.5px' },
});

// Above the base editor theme, which sets the same properties.
/** A link reads as a link here, so a click on it follows it. */
const followLinks = EditorView.domEventHandlers({
  mousedown(event, view) {
    const pos = view.posAtCoords(event);
    const link = pos === null ? null : linkAt(view.state, pos);
    const tab = store.active;
    if (!link || !tab || touchesCursor(view.state, link.from, link.to)) return false;
    event.preventDefault();
    void store.followLink(tab, link.target, link.anchor);
    return true;
  },
});

/** A note ending in a block needs a line after it, or the cursor has nowhere to go. */
const roomAfterBlocks = ViewPlugin.define((view) => {
  const check = () => {
    const field = view.state.field(decorations, false);
    if (!field) return;
    const end = view.state.doc.length;
    let last = -1;
    field.blocks.between(end, end, (_, to) => {
      last = to;
    });
    if (last === end) view.dispatch({ changes: { from: end, insert: '\n' }, annotations: Transaction.addToHistory.of(false) });
  };
  queueMicrotask(check);
  return {
    update(update) {
      if (update.docChanged || update.selectionSet) queueMicrotask(check);
    },
  };
});

export const visualMode = [decorations, solidBlocks, keepBlocksWhole, roomAfterBlocks, Prec.high(look), followLinks];
