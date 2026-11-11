import { describe, expect, it } from 'vitest';
import type { TreeNode } from './api';
import { readingOrder, readingText } from './reading';

const file = (path: string): TreeNode => ({ name: path.split('/').pop()!, path, isDir: false, children: [] });
const dir = (path: string, children: TreeNode[]): TreeNode => ({ name: path.split('/').pop()!, path, isDir: true, children });

const tree = [
  dir('B', [file('B/2.md'), file('B/10.md'), dir('B/Vacía', [file('B/Vacía/foto.png')])]),
  dir('A', [dir('A/Sub', [file('A/Sub/Hondo.md')]), file('A/Uno.md')]),
  file('Zeta.md'),
  file('Inicio.md'),
  file('imagen.png'),
];

describe('reading order', () => {
  it('reads a folder’s own notes first, then its subfolders, in natural order', () => {
    expect(readingOrder(tree, '').map((n) => [n.path, n.folder, n.depth])).toEqual([
      ['Inicio.md', '', 0],
      ['Zeta.md', '', 0],
      ['A/Uno.md', 'A', 1],
      ['A/Sub/Hondo.md', 'A/Sub', 2],
      ['B/2.md', 'B', 1],
      ['B/10.md', 'B', 1],
    ]);
  });

  it('reads one folder, named from itself', () => {
    expect(readingOrder(tree, 'A').map((n) => [n.title, n.folder])).toEqual([['Uno', ''], ['Hondo', 'Sub']]);
    expect(readingOrder(tree, 'No existe')).toEqual([]);
  });

  it('leaves the properties out', () => {
    expect(readingText('---\ntags: [a]\n---\n# Título\n')).toBe('# Título\n');
    expect(readingText('# Sin propiedades\n')).toBe('# Sin propiedades\n');
  });
});
