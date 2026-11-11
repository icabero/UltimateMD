// A vault's guide for the diagrams an AI draws, kept in .ultimatemd/diagramas.md
// and read over MCP with get_diagram_guide. This is the app's side: a first
// draft from the vault's current look, and the images an AI already added.
import { tr } from './i18n.svelte';
import { baseName, dirName, resolveRelative } from './paths';
import type { Theme } from './themes';

/** Must match MARK in crates/core/src/diagram_guide.rs. */
export const AI_MARK = 'diagrama de IA';

/** A starting guide that describes how the app draws this vault's diagrams. */
export function guideDraft(vault: string, look: { theme: Theme; sketch: boolean }): string {
  const { colors, diagram } = look.theme;
  return tr('guide.draft', {
    vault,
    surface: diagram.surface,
    border: diagram.border,
    line: diagram.line ?? colors.text2,
    text: diagram.text ?? colors.text,
    bg: colors.bg,
    accent: colors.accent,
    strokes: tr(look.sketch ? 'guide.draftSketch' : 'guide.draftClean'),
  });
}

const AI_IMAGE = new RegExp(`!\\[([^\\]]*)\\]\\(([^)\\s]+)\\)[ \\t]*\\n?[ \\t]*%%${AI_MARK}:([^%]*)%%`, 'g');

/** The images an AI drew in a note, by their path in the vault, with what each shows. */
export function aiImages(note: string, content: string): Map<string, string> {
  const found = new Map<string, string>();
  for (const [, alt, src, said] of content.matchAll(AI_IMAGE)) {
    let decoded = src;
    try {
      decoded = decodeURI(src);
    } catch {
      // Left as written.
    }
    const path = resolveRelative(dirName(note), decoded);
    if (path) found.set(path, (said.trim() || alt).trim());
  }
  return found;
}

/** What to paste in the assistant to have a diagram drawn again. */
export function redrawPrompt(note: string, image: string, shows: string): string {
  return tr('guide.redraw', { alt: shows, note: baseName(note), image });
}
