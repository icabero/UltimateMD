// Line differences between two texts, for showing what changed and for
// merging two versions block by block. Myers' algorithm, after setting
// aside the lines both texts start and end with.

export type Op = { kind: 'same' | 'del' | 'add'; text: string };

const splitLines = (text: string) => (text === '' ? [] : text.replace(/\r\n/g, '\n').replace(/\n$/, '').split('\n'));

/** The shortest edit from `a` to `b`, line by line. */
function myers(a: string[], b: string[]): Op[] {
  const n = a.length;
  const m = b.length;
  const max = n + m;
  const v = new Int32Array(2 * max + 2);
  const trace: Int32Array[] = [];
  for (let d = 0; d <= max; d++) {
    trace.push(v.slice());
    for (let k = -d; k <= d; k += 2) {
      let x = k === -d || (k !== d && v[max + k - 1] < v[max + k + 1]) ? v[max + k + 1] : v[max + k - 1] + 1;
      let y = x - k;
      while (x < n && y < m && a[x] === b[y]) {
        x++;
        y++;
      }
      v[max + k] = x;
      if (x >= n && y >= m) return backtrack(trace, a, b, max, d);
    }
  }
  return [];
}

function backtrack(trace: Int32Array[], a: string[], b: string[], max: number, last: number): Op[] {
  const ops: Op[] = [];
  let x = a.length;
  let y = b.length;
  for (let d = last; d > 0; d--) {
    const v = trace[d];
    const k = x - y;
    const prevK = k === -d || (k !== d && v[max + k - 1] < v[max + k + 1]) ? k + 1 : k - 1;
    const prevX = v[max + prevK];
    const prevY = prevX - prevK;
    while (x > prevX && y > prevY) {
      ops.push({ kind: 'same', text: a[--x] });
      y--;
    }
    if (x === prevX) ops.push({ kind: 'add', text: b[--y] });
    else ops.push({ kind: 'del', text: a[--x] });
  }
  while (x > 0 && y > 0) {
    ops.push({ kind: 'same', text: a[--x] });
    y--;
  }
  return ops.reverse();
}

/** How `before` became `after`, line by line. */
export function diffLines(before: string, after: string): Op[] {
  const a = splitLines(before);
  const b = splitLines(after);
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let end = 0;
  while (end < a.length - start && end < b.length - start && a[a.length - 1 - end] === b[b.length - 1 - end]) end++;
  const same = (lines: string[]) => lines.map((text): Op => ({ kind: 'same', text }));
  return [...same(a.slice(0, start)), ...myers(a.slice(start, a.length - end), b.slice(start, b.length - end)), ...same(a.slice(a.length - end))];
}

/**
 * Lines of `after`, from 1, that are new or replace others. Where lines were
 * only taken away, the line that follows is given, so the place still shows.
 */
export function changedLines(before: string, after: string): number[] {
  const out = new Set<number>();
  let line = 0;
  let removed = false;
  for (const op of diffLines(before, after)) {
    if (op.kind === 'del') {
      removed = true;
      continue;
    }
    line++;
    if (op.kind === 'add' || removed) out.add(line);
    removed = false;
  }
  if (removed && line > 0) out.add(line);
  // Blank lines say nothing about what changed.
  const lines = splitLines(after);
  return [...out].filter((l) => lines[l - 1]?.trim());
}

/** A stretch that differs, with the lines each side has there. */
export interface Block {
  kind: 'same' | 'change';
  before: string[];
  after: string[];
}

/** The differences grouped into blocks: what stays, and each place that changed. */
export function blocks(before: string, after: string): Block[] {
  const out: Block[] = [];
  for (const op of diffLines(before, after)) {
    const kind = op.kind === 'same' ? 'same' : 'change';
    let last = out.at(-1);
    if (!last || last.kind !== kind) out.push((last = { kind, before: [], after: [] }));
    if (op.kind !== 'add') last.before.push(op.text);
    if (op.kind !== 'del') last.after.push(op.text);
  }
  return out;
}

/** Puts blocks back together, taking `before` or `after` for each change as chosen. */
export function merge(parts: Block[], choose: (index: number) => 'before' | 'after' | 'both', newline = '\n'): string {
  const lines = parts.flatMap((p, i) => {
    if (p.kind === 'same') return p.before;
    const pick = choose(i);
    return pick === 'both' ? [...p.before, ...p.after] : p[pick];
  });
  return lines.length ? `${lines.join(newline)}${newline}` : '';
}
