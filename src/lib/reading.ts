// Reading a vault or a folder top to bottom, as one document, in the same
// order the export uses: a folder's own notes, then its subfolders.
import type { TreeNode } from './api';
import { byName, findFolder, hasNotes, isNote } from './export';
import { stem } from './paths';

export interface ReadingNote {
  path: string;
  title: string;
  /** The folder it is in, from the one being read; '' for that one itself. */
  folder: string;
  /** Folders below the one being read. */
  depth: number;
}

/** The notes of `folder` ('' for the whole vault), in reading order. */
export function readingOrder(tree: TreeNode[], folder: string): ReadingNote[] {
  const start = folder ? findFolder(tree, folder)?.children : tree;
  if (!start) return [];
  const out: ReadingNote[] = [];
  const walk = (nodes: TreeNode[], here: string, depth: number) => {
    for (const note of nodes.filter(isNote).sort(byName)) out.push({ path: note.path, title: stem(note.path), folder: here, depth });
    for (const dir of nodes.filter((n) => n.isDir && hasNotes(n)).sort(byName)) {
      walk(dir.children, here ? `${here}/${dir.name}` : dir.name, depth + 1);
    }
  };
  walk(start, '', 0);
  return out;
}

/** The note's text without its properties, which a reader does not need. */
export function readingText(content: string): string {
  const m = /^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/.exec(content);
  return m ? content.slice(m[0].length) : content;
}

const PLACE = 'ultimatemd.reader.';

/** Where the reading of a folder was left: the note at the top. */
export function savedPlace(vaultId: string, folder: string): string | null {
  try {
    return localStorage.getItem(`${PLACE}${vaultId}:${folder}`);
  } catch {
    return null;
  }
}

export function savePlace(vaultId: string, folder: string, path: string) {
  try {
    localStorage.setItem(`${PLACE}${vaultId}:${folder}`, path);
  } catch {
    // Only a convenience.
  }
}
