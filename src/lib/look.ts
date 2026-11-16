// How files, folders and notes are told apart in the tree, the tabs and the path bar.
import { dirName, extOf, kindOf, resolveLink, resolveRelative } from './paths';
import { frontmatterValue } from './themes';

/** The icon of a file by what it is: a note, a web page, an image, a PDF or anything else. */
export function iconOf(path: string) {
  const kind = kindOf(path);
  if (kind === 'md') return 'note';
  if (kind === 'html') return 'code';
  if (kind === 'image') return 'image';
  return extOf(path) === 'pdf' ? 'pdf' : 'file';
}

/**
 * The colours a folder can have, by the name stored in the vault. Each is a colour of
 * the theme, so it reads well in light and dark and follows a theme of the vault.
 */
export const FOLDER_COLORS: Record<string, string> = {
  accent: 'var(--accent)',
  danger: 'var(--danger)',
  string: 'var(--syn-string)',
  attr: 'var(--syn-attr)',
  keyword: 'var(--syn-keyword)',
  number: 'var(--syn-number)',
  muted: 'var(--text-3)',
};

/** A short list to choose from; anything else can be typed. */
export const EMOJIS = [
  '📁', '📂', '📚', '📝', '📌', '⭐', '💡', '🧭', '🎯', '🔬', '💼', '🏠',
  '✅', '🔥', '🌱', '🎨', '🎵', '💬', '🔒', '📅', '✈️', '🧪', '⚙️', '❤️',
];

/** What can be one icon: a few characters, not a sentence. */
export const validEmoji = (value: string) => value.trim().length > 0 && [...value.trim()].length <= 16 && !/[\p{Cc}\s]/u.test(value.trim());

/** The icon and cover a note's frontmatter declares: `icono:` and `portada:` (or `icon:` and `cover:`). */
export function noteLook(content: string) {
  const icon = (frontmatterValue(content, 'icono') ?? frontmatterValue(content, 'icon'))?.trim() ?? '';
  const cover = (frontmatterValue(content, 'portada') ?? frontmatterValue(content, 'cover'))?.trim() ?? '';
  return { icon: validEmoji(icon) ? icon : null, cover: cover || null };
}

/** The key a note already uses for its icon or cover, or the one written when it has none. */
export function lookKey(content: string, which: 'icon' | 'cover') {
  const [own, other] = which === 'icon' ? ['icono', 'icon'] : ['portada', 'cover'];
  return frontmatterValue(content, own) === null && frontmatterValue(content, other) !== null ? other : own;
}

/**
 * The image a cover names, as images are found in notes: next to the note, from the
 * vault's root, or by its name. Null when it is not an image of the vault.
 */
export function coverPath(ref: string, note: string, files: string[]): string | null {
  if (/^[a-z][a-z0-9+.-]*:/i.test(ref)) return null;
  let clean = ref.replace(/^!?\[\[(.*?)(\|.*)?\]\]$/, '$1').split(/[?#]/)[0];
  try {
    clean = decodeURI(clean);
  } catch {
    // Left as written.
  }
  const known = new Set(files);
  const tries = [resolveRelative(dirName(note), clean), resolveRelative('', clean)];
  const found = tries.find((p) => p && known.has(p)) ?? resolveLink(clean, note, files);
  return found && kindOf(found) === 'image' ? found : null;
}
