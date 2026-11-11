import { describe, expect, it } from 'vitest';
import { blocks, changedLines, diffLines, merge } from './diff';

describe('diffLines', () => {
  it('tells what stayed, went and came, in order', () => {
    const ops = diffLines('uno\ndos\ntres\n', 'uno\nDOS\ntres\ncuatro\n');
    expect(ops.map((o) => `${o.kind[0]}:${o.text}`)).toEqual(['s:uno', 'd:dos', 'a:DOS', 's:tres', 'a:cuatro']);
  });

  it('handles empty texts and texts without a final line break', () => {
    expect(diffLines('', '')).toEqual([]);
    expect(diffLines('', 'a\nb')).toEqual([{ kind: 'add', text: 'a' }, { kind: 'add', text: 'b' }]);
    expect(diffLines('a', 'a\n')).toEqual([{ kind: 'same', text: 'a' }]);
  });

  it('reads Windows line ends as line ends', () => {
    expect(diffLines('a\r\nb\r\n', 'a\nb\n').every((o) => o.kind === 'same')).toBe(true);
  });

  it('rebuilds both texts from its operations', () => {
    const before = 'a\nb\nc\nd\ne\nf\n';
    const after = 'a\nx\nc\ne\ny\nz\nf\n';
    const ops = diffLines(before, after);
    expect(ops.filter((o) => o.kind !== 'add').map((o) => o.text).join('\n')).toBe(before.trimEnd());
    expect(ops.filter((o) => o.kind !== 'del').map((o) => o.text).join('\n')).toBe(after.trimEnd());
  });
});

describe('changedLines', () => {
  it('gives the new and replaced lines of the text after', () => {
    expect(changedLines('uno\ndos\ntres\n', 'uno\nDOS\ntres\ncuatro\n')).toEqual([2, 4]);
  });

  it('points at the line after a removal, so the place still shows', () => {
    expect(changedLines('a\nb\nc\n', 'a\nc\n')).toEqual([2]);
    expect(changedLines('a\nb\n', 'a\n')).toEqual([1]);
  });

  it('leaves blank lines out and finds nothing in equal texts', () => {
    expect(changedLines('a\n', 'a\n\nb\n')).toEqual([3]);
    expect(changedLines('a\nb\n', 'a\nb\n')).toEqual([]);
  });
});

describe('blocks and merge', () => {
  const mine = 'título\nmi línea\nigual\n';
  const theirs = 'título\nsu línea\nigual\nañadida\n';
  const parts = blocks(mine, theirs);

  it('groups the differences into places', () => {
    expect(parts.map((p) => p.kind)).toEqual(['same', 'change', 'same', 'change']);
    expect(parts[3]).toEqual({ kind: 'change', before: [], after: ['añadida'] });
  });

  it('puts either text back, or a mix chosen place by place', () => {
    expect(merge(parts, () => 'before')).toBe(mine);
    expect(merge(parts, () => 'after')).toBe(theirs);
    expect(merge(parts, (i) => (i === 1 ? 'both' : 'after'))).toBe('título\nmi línea\nsu línea\nigual\nañadida\n');
    expect(merge(parts, () => 'before', '\r\n')).toBe(mine.replaceAll('\n', '\r\n'));
  });
});
