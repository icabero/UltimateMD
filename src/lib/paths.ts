export const baseName = (p: string) => p.split('/').pop() ?? p;
export const dirName = (p: string) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '');
export const join = (dir: string, name: string) => (dir ? `${dir}/${name}` : name);
export const extOf = (p: string) => (baseName(p).includes('.') ? baseName(p).split('.').pop()!.toLowerCase() : '');
export const stem = (p: string) => baseName(p).replace(/\.[^.]+$/, '');

const IMAGE = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'avif', 'bmp', 'ico'];

export type FileKind = 'md' | 'html' | 'image' | 'other';

export function kindOf(path: string): FileKind {
  const ext = extOf(path);
  if (ext === 'md' || ext === 'markdown') return 'md';
  if (ext === 'html' || ext === 'htm') return 'html';
  return IMAGE.includes(ext) ? 'image' : 'other';
}

/** Resolves a relative reference against a folder. Null if it leaves the vault. */
export function resolveRelative(dir: string, ref: string): string | null {
  const parts = dir ? dir.split('/') : [];
  for (const part of ref.split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') {
      if (!parts.length) return null;
      parts.pop();
    } else parts.push(part);
  }
  return parts.join('/');
}

/** Same resolution order as the core crate: sibling, vault root, then by name. */
export function resolveLink(target: string, from: string, files: string[]): string | null {
  const clean = target.replace(/^\.?\//, '').toLowerCase();
  const bare = (s: string) => s.replace(/\.md$/i, '').toLowerCase();
  const wanted = bare(clean);
  const noExt = (s: string) => s.replace(/\.[^./]+$/, '').toLowerCase();
  const matches = (f: string, w: string) => f.toLowerCase() === clean || noExt(f) === w;
  const sibling = bare(join(dirName(from), clean));
  return (
    files.find((f) => matches(f, sibling)) ??
    files.find((f) => matches(f, wanted)) ??
    files.find((f) => baseName(f).toLowerCase() === clean || stem(f).toLowerCase() === wanted) ??
    null
  );
}
