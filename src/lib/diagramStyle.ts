// A single diagram's look, kept on its own fence line so it travels with the note
// and works for hand-written diagrams too:
//
//   ```mermaid tema=sepia boceto animado relleno=#ffeecc borde=#aa5500
import type { Theme } from './themes';

export type DiagramColor = 'surface' | 'border' | 'line' | 'text';

export interface DiagramStyle {
  theme?: string;
  sketch?: boolean;
  /** Connections move on screen; documents and images show them still. */
  animated?: boolean;
  surface?: string;
  border?: string;
  line?: string;
  text?: string;
}

const COLOR_WORDS: Record<string, DiagramColor> = { relleno: 'surface', borde: 'border', linea: 'line', texto: 'text' };
const HEX = /^#[0-9a-f]{6}$/i;
const THEME_ID = /^[a-z0-9-]+$/;

/** Reads what follows the language. Unknown words are ignored and left unused. */
export function parseStyle(words: string): DiagramStyle {
  const style: DiagramStyle = {};
  for (const word of words.trim().split(/\s+/)) {
    const [key, value] = word.split('=');
    if (key === 'boceto' && value === undefined) style.sketch = true;
    else if (key === 'animado' && value === undefined) style.animated = true;
    else if (key === 'tema' && value && THEME_ID.test(value)) style.theme = value;
    else if (COLOR_WORDS[key] && value && HEX.test(value)) style[COLOR_WORDS[key]] = value.toLowerCase();
  }
  return style;
}

export function splitFence(info: string) {
  const [lang = '', ...rest] = info.trim().split(/\s+/);
  return { lang: lang.toLowerCase(), words: rest.join(' ') };
}

export function fenceLine(lang: string, style: DiagramStyle) {
  const words = [lang];
  if (style.theme) words.push(`tema=${style.theme}`);
  if (style.sketch) words.push('boceto');
  if (style.animated) words.push('animado');
  for (const [word, key] of Object.entries(COLOR_WORDS)) {
    if (style[key]) words.push(`${word}=${style[key]}`);
  }
  return `\`\`\`${words.join(' ')}`;
}

export const hasStyle = (style: DiagramStyle) => Object.keys(style).length > 0;

/** Lays a diagram's own colours over a theme. */
export function withColors(theme: Theme, { surface, border, line, text }: DiagramStyle): Theme {
  const own = Object.fromEntries(Object.entries({ surface, border, line, text }).filter(([, value]) => value));
  return Object.keys(own).length ? { ...theme, diagram: { ...theme.diagram, ...own } } : theme;
}
