// Small pure helpers: matching without accents, paths, properties and versions.
import { describe, expect, it } from 'vitest';
import { parseAnchor, findAnchor } from './anchors';
import { parseStyle, fenceLine, splitFence } from './diagramStyle';
import { findTerms, fold, pieces, queryMarks, terms } from './fold';
import { properties, quote, setProperty, validKey } from './frontmatter';
import { newsFor, series } from './news';
import { baseName, dirName, kindOf, linkFrom, resolveLink, resolveRelative, stem } from './paths';
import { frontmatterChange, frontmatterValue } from './themes';
import { isNewer } from './updates';

describe('fold', () => {
  it('drops case and accents, composed or not', () => {
    expect(fold('Reunión ÑANDÚ')).toBe('reunion nandu');
    expect(fold('canción')).toBe('cancion');
    expect(terms('  Acta   de MARZO ')).toEqual(['acta', 'de', 'marzo']);
  });

  it('finds words in the original text, accents included', () => {
    expect(findTerms('La Reunión de marzo', ['reunion', 'marzo'])).toEqual([[3, 10], [14, 19]]);
    expect(pieces('Acción', ['accion'])).toEqual([{ text: 'Acción', match: true }]);
    expect(pieces('sin nada', ['x'])).toEqual([{ text: 'sin nada', match: false }]);
  });

  it('merges matches that overlap', () => {
    expect(findTerms('abcdef', ['abcd', 'cdef'])).toEqual([[0, 6]]);
  });

  it('marks what a search query looks for, not its filters', () => {
    expect(queryMarks('"Plan de marzo" acta -borrador ruta:notas tag:x /a\\d+/')).toEqual(['plan de marzo', 'acta']);
    expect(queryMarks('hora:10')).toEqual(['hora:10']);
    expect(queryMarks('')).toEqual([]);
  });
});

describe('paths', () => {
  it('splits paths', () => {
    expect([baseName('a/b/c.md'), dirName('a/b/c.md'), dirName('c.md'), stem('a/b.c.md')]).toEqual(['c.md', 'a/b', '', 'b.c']);
    expect(['x.MD', 'x.htm', 'x.PNG', 'x.pdf', 'x'].map(kindOf)).toEqual(['md', 'html', 'image', 'other', 'other']);
  });

  it('resolves relative references and never leaves the vault', () => {
    expect(resolveRelative('a/b', '../c/d.png')).toBe('a/c/d.png');
    expect(resolveRelative('a', './x.png')).toBe('a/x.png');
    expect(resolveRelative('', '../fuera.png')).toBeNull();
  });

  it('resolves a link as the core does: sibling, then root, then by name', () => {
    const files = ['Nota.md', 'dir/Nota.md', 'dir/Otra.md', 'lejos/Única.md', 'img/foto.png'];
    expect(resolveLink('Nota', 'dir/Otra.md', files)).toBe('dir/Nota.md');
    expect(resolveLink('Nota', 'x/Otra.md', files)).toBe('Nota.md');
    expect(resolveLink('única', 'Nota.md', files)).toBe('lejos/Única.md');
    expect(resolveLink('foto.png', 'Nota.md', files)).toBe('img/foto.png');
    expect(resolveLink('Falta', 'Nota.md', files)).toBeNull();
  });

  it('writes the shortest Markdown link between two files', () => {
    expect(linkFrom('a/b/nota.md', 'a/img/foto 1.png')).toBe('../img/foto%201.png');
    expect(linkFrom('nota.md', 'adjuntos/x (1).png')).toBe('adjuntos/x%20%281%29.png');
  });
});

describe('properties', () => {
  const note = '---\ntitulo: "Con: dos puntos"\ntema: sepia\ntags:\n  - a\n---\n# Nota\n';

  it('reads the simple ones and flags the rest', () => {
    expect(properties(note).map((p) => [p.key, p.value, p.complex])).toEqual([
      ['titulo', 'Con: dos puntos', false],
      ['tema', 'sepia', false],
      ['tags', '', true],
    ]);
    expect(properties('# Sin propiedades')).toEqual([]);
  });

  it('quotes only what YAML would misread', () => {
    expect(quote('texto normal')).toBe('texto normal');
    expect(['true', '12', 'a: b', '#x', '- x'].map(quote)).toEqual(['"true"', '"12"', '"a: b"', '"#x"', '"- x"']);
    expect(validKey('mi clave')).toBe(true);
    expect(validKey('mal:a')).toBe(false);
  });

  it('sets, replaces and creates a property', () => {
    expect(frontmatterValue(setProperty(note, 'tema', 'mar'), 'tema')).toBe('mar');
    expect(setProperty('# Nota\n', 'autor', 'Ana')).toBe('---\nautor: Ana\n---\n# Nota\n');
    expect(frontmatterValue(note, 'falta')).toBeNull();
  });

  it('describes the edit that changes a key, or none', () => {
    expect(frontmatterChange('texto', 'tema', null)).toBeNull();
    expect(frontmatterChange('texto', 'tema', 'mar')).toEqual({ from: 0, to: 0, insert: '---\ntema: mar\n---\n' });
  });
});

describe('anchors', () => {
  const note = '# Título\n\n## Segunda parte\n\nLa frase clave. ^clave\n';

  it('reads the part of a link after the note', () => {
    expect(parseAnchor('#a#b')).toEqual({ kind: 'heading', text: 'b' });
    expect(parseAnchor('^clave')).toEqual({ kind: 'block', id: 'clave' });
    expect(parseAnchor('')).toBeNull();
  });

  it('finds headings without case, accents or punctuation, and blocks by their mark', () => {
    expect(findAnchor(note, { kind: 'heading', text: 'segunda-parte' })).toEqual({ line: 3, heading: 1 });
    expect(findAnchor(note, { kind: 'block', id: 'clave' })).toEqual({ line: 5 });
    expect(findAnchor(note, { kind: 'heading', text: 'no está' })).toBeNull();
  });
});

describe('diagram fences', () => {
  it('reads and writes the style words after the language', () => {
    expect(splitFence('Mermaid boceto tema=mar')).toEqual({ lang: 'mermaid', words: 'boceto tema=mar' });
    const style = parseStyle('boceto animado');
    expect(parseStyle(fenceLine('d2', style).replace(/^`+d2\s*/, ''))).toEqual(style);
    expect(fenceLine('mermaid', {})).toBe('```mermaid');
  });
});

describe('versions', () => {
  it('compares versions by their numbers', () => {
    expect(isNewer('v0.10.0', '0.9.9')).toBe(true);
    expect(isNewer('0.7.0', '0.7.0')).toBe(false);
    expect(isNewer('0.7', '0.7.1')).toBe(false);
    expect(isNewer('1.0.0-beta', '0.9.0')).toBe(true);
  });

  it('finds the news a version should show', () => {
    expect(series('v0.7.3')).toBe('0.7');
    expect(newsFor('0.7.2')).toBe('0.7');
    expect(newsFor('0.6.0')).toBeNull();
    expect(newsFor('1.2.0')).toBe('0.7');
  });
});
