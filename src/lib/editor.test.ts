// What the toolbar and the editor's helpers write into a document.
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { EditorSelection, EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { describe, expect, it } from 'vitest';
import { parseSource, toSource, type Diagram } from './diagramBuilder';
import { fenceAt, insertBlock, insertLink, prefixLines, wrap } from './formatting';
import { htmlToMarkdown } from './paste';
import { TAG } from './tags';
import { WIKILINK, linkAt } from './wikilinks';

/** An editor over `doc`, with `¦` marking the cursor or the two ends of the selection. */
function editor(doc: string) {
  const marks = [...doc.matchAll(/¦/g)].map((m, i) => m.index - i);
  const [anchor, head = anchor] = marks;
  return new EditorView({
    state: EditorState.create({
      doc: doc.replaceAll('¦', ''),
      selection: EditorSelection.single(anchor ?? 0, head ?? 0),
      extensions: [markdown({ base: markdownLanguage })],
    }),
  });
}

const text = (view: EditorView) => view.state.doc.toString();
const selected = (view: EditorView) => view.state.sliceDoc(view.state.selection.main.from, view.state.selection.main.to);

describe('formatting', () => {
  it('wraps the selection in a mark and takes it away again', () => {
    const view = editor('una ¦palabra¦ aquí');
    wrap(view, '**', 'texto');
    expect([text(view), selected(view)]).toEqual(['una **palabra** aquí', 'palabra']);
    wrap(view, '**', 'texto');
    expect(text(view)).toBe('una palabra aquí');
  });

  it('writes a placeholder, selected, when nothing is', () => {
    const view = editor('hola ¦');
    wrap(view, '*', 'texto');
    expect([text(view), selected(view)]).toEqual(['hola *texto*', 'texto']);
  });

  it('gives lines a prefix, replaces another and toggles the same one off', () => {
    const view = editor('¦uno\n- dos¦');
    prefixLines(view, '> ');
    expect(text(view)).toBe('> uno\n> dos');
    prefixLines(view, (i) => `${i + 1}. `);
    expect(text(view)).toBe('1. uno\n2. dos');
    prefixLines(view, (i) => `${i + 1}. `);
    expect(text(view)).toBe('uno\ndos');
  });

  it('puts a block on its own lines after the one with the cursor', () => {
    const view = editor('antes¦\ndespués');
    insertBlock(view, '---');
    expect(text(view)).toBe('antes\n\n---\n\ndespués');
  });

  it('makes a link of the selection', () => {
    const view = editor('ver ¦esto¦');
    insertLink(view, 'texto');
    expect(text(view)).toBe('ver [esto](https://)');
    expect(selected(view)).toBe('https://');
  });

  it('finds the code block under the cursor', () => {
    const view = editor('texto\n\n```mermaid boceto\nflowchart LR\n  A ¦--> B\n```\n');
    const fence = fenceAt(view.state)!;
    expect([fence.info, fence.source]).toEqual(['mermaid boceto', 'flowchart LR\n  A --> B\n']);
    expect(fenceAt(editor('sin ¦bloque').state)).toBeNull();
  });
});

describe('links and tags in the editor', () => {
  it('reads every form of wikilink but not embeds or empty ones', () => {
    const found = [...'[[A]] [[B#C]] [[D^e]] [[F|g]] [[#H]] ![[img.png]] [[]] [[ ]]'.matchAll(WIKILINK)].map((m) => [m[1], m[2] ?? null, m[3] ?? null]);
    expect(found).toEqual([
      ['A', null, null],
      ['B', '#C', null],
      ['D', '^e', null],
      ['F', null, 'g'],
      ['', '#H', null],
    ]);
  });

  it('finds the link at a position', () => {
    const view = editor('ir a [[Nota#Parte|aquí]] y más');
    expect(linkAt(view.state, 10)).toMatchObject({ target: 'Nota', anchor: '#Parte' });
    expect(linkAt(view.state, 2)).toBeNull();
  });

  it('reads tags as the backend does', () => {
    const found = [...'#uno #dos/tres C# a#b &#39; #123 #año2024 (#x)'.matchAll(TAG)].map((m) => m[1]);
    expect(found).toEqual(['uno', 'dos/tres', 'año2024', 'x']);
  });
});

describe('diagram builder', () => {
  it('writes a diagram and reads it back the same', () => {
    const flow: Diagram = {
      kind: 'flow',
      direction: 'LR',
      nodes: [
        { id: 'a', label: 'Inicio', shape: 'round' },
        { id: 'b', label: 'Fin', shape: 'rect' },
      ],
      edges: [{ from: 'a', to: 'b', label: 'sigue' }],
    };
    expect(parseSource('mermaid', toSource(flow, 'mermaid'))).toEqual(flow);
    expect(parseSource('d2', toSource(flow, 'd2'))).toEqual(flow);
  });

  it('leaves alone what it did not write', () => {
    expect(parseSource('mermaid', 'flowchart LR\n  A --> B --> C')).toBeNull();
    expect(parseSource('d2', 'a -> b')).toBeNull();
  });
});

describe('pasting', () => {
  it('turns pasted HTML into Markdown', () => {
    expect(htmlToMarkdown('<h2>Título</h2><p>Un <strong>texto</strong> con <a href="https://ejemplo.org">enlace</a>.</p>')).toBe('## Título\n\nUn **texto** con [enlace](https://ejemplo.org).');
    expect(htmlToMarkdown('<ul><li>uno</li><li>dos</li></ul>')).toMatch(/^[-*]\s+uno\n[-*]\s+dos$/);
  });
});
