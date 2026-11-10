import { describe, expect, it } from 'vitest';
import { diagramFences, headingAt, outline, renderMarkdown } from './markdown';

const ctx = { vaultId: 'v', path: 'dir/Nota.md', files: ['dir/Nota.md', 'dir/Otra.md', 'img/foto.png'] };

function render(text: string) {
  const host = document.createElement('div');
  host.append(renderMarkdown(text, ctx));
  return host;
}

describe('renderMarkdown', () => {
  it('keeps formatting written as HTML but nothing that runs', () => {
    const html = render('<b style="color:red">fuerte</b><script>alert(1)</script><img src=x onerror="alert(1)"><iframe src="x"></iframe>');
    expect(html.querySelector('b')?.getAttribute('style')).toBe('color:red');
    expect(html.querySelector('script, iframe')).toBeNull();
    expect(html.querySelector('img')?.hasAttribute('onerror')).toBe(false);
  });

  it('turns wikilinks into links, marking the ones that lead nowhere', () => {
    const html = render('[[Otra]] [[Otra#Parte|ver]] [[Falta]] ![[foto.png]]');
    const links = [...html.querySelectorAll<HTMLAnchorElement>('a[data-wikilink]')];
    expect(links.map((a) => [a.textContent, a.dataset.note ?? null, a.dataset.anchor, a.classList.contains('broken')])).toEqual([
      ['Otra', 'dir/Otra.md', '', false],
      ['ver', 'dir/Otra.md', '#Parte', false],
      ['Falta', null, '', true],
    ]);
    expect(html.querySelector('img')?.dataset.path).toBe('img/foto.png');
  });

  it('reads tags where the backend does: not in code, headings, words or links', () => {
    const html = render('# Título\n\n#uno y #dos/tres, pero no C# ni `#codigo` ni #123 ni [[Otra#Parte]].\n\n```\n#dentro\n```\n');
    expect([...html.querySelectorAll('a.tag')].map((a) => a.textContent)).toEqual(['#uno', '#dos/tres']);
  });

  it('says which lines of the note each block comes from, past the properties', () => {
    const html = render('---\ntema: mar\n---\n# Uno\n\nDos\ntres\n\n- a\n- b\n');
    expect([...html.querySelectorAll('[data-lines]')].map((el) => [el.tagName, el.getAttribute('data-lines')])).toEqual([
      ['H1', '4-4'],
      ['P', '6-7'],
      ['UL', '9-10'],
    ]);
    expect(html.querySelector('.frontmatter')?.textContent).toBe('tema: mar');
  });

  it('leaves diagrams as placeholders with their source and style', () => {
    const html = render('```mermaid boceto\nflowchart LR\n  A --> B\n```\n');
    const diagram = html.querySelector<HTMLElement>('.diagram')!;
    expect([diagram.dataset.lang, diagram.dataset.style, decodeURIComponent(diagram.dataset.src!)]).toEqual(['mermaid', 'boceto', 'flowchart LR\n  A --> B\n']);
  });

  it('names the language of a code block and highlights it', () => {
    const pre = render('```js\nconst a = 1;\n```\n').querySelector('pre')!;
    expect(pre.dataset.lang).toBe('js');
    expect(pre.querySelector('.hljs-keyword')?.textContent).toBe('const');
  });
});

describe('outline', () => {
  const note = '---\na: 1\n---\n# Uno\n\n```\n# no\n```\n\n## Dos con [[Otra|enlace]]\n';

  it('lists headings with their lines in the note, not in code', () => {
    expect(outline(note)).toEqual([
      { level: 1, text: 'Uno', line: 4 },
      { level: 2, text: 'Dos con enlace', line: 10 },
    ]);
  });

  it('finds the section a line is in', () => {
    const headings = outline(note);
    expect([headingAt(headings, 1), headingAt(headings, 5), headingAt(headings, 99)]).toEqual([-1, 0, 1]);
  });

  it('lists the diagrams with where they start', () => {
    expect(diagramFences('texto\n\n```d2 animado\na -> b\n```\n\n```js\nx\n```\n')).toEqual([{ lang: 'd2', src: 'a -> b\n', style: 'animado', line: 3 }]);
  });
});
