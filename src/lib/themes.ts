import type { ThemeFile } from './api';

// A theme is plain data: adding one here is all it takes. Everything visual
// derives from these values, including the preview, the editor and diagrams.

export interface Theme {
  id: string;
  name: string;
  mode: 'light' | 'dark';
  /** Reading font in the preview. */
  prose: 'serif' | 'sans';
  colors: {
    bg: string;
    panel: string;
    raised: string;
    line: string;
    text: string;
    text2: string;
    text3: string;
    accent: string;
    accentText: string;
    onAccent: string;
    danger: string;
    warn: string;
    synString: string;
    synKeyword: string;
    synNumber: string;
    synAttr: string;
  };
  /** Diagram node fill and outline. The other diagram colours come from `colors`. */
  diagram: { surface: string; border: string };
}

export const THEMES: Theme[] = [
  {
    id: 'claro', name: 'Claro', mode: 'light', prose: 'serif',
    colors: {
      bg: '#fbfaf7', panel: '#f3f1ea', raised: '#ffffff', line: '#e3dfd4',
      text: '#22211e', text2: '#57544b', text3: '#6b675c',
      accent: '#b3431f', accentText: '#a13a19', onAccent: '#ffffff',
      danger: '#b91c1c', warn: '#f8ecc9',
      synString: '#2f6b4f', synKeyword: '#8a3a12', synNumber: '#7f5300', synAttr: '#1f5f8b',
    },
    diagram: { surface: '#f6e9e2', border: '#d9a78f' },
  },
  {
    id: 'oscuro', name: 'Oscuro', mode: 'dark', prose: 'sans',
    colors: {
      bg: '#171614', panel: '#1e1d1a', raised: '#262521', line: '#34322d',
      text: '#ece9e2', text2: '#b3afa5', text3: '#a09c92',
      accent: '#e08a5b', accentText: '#eb9c72', onAccent: '#22130b',
      danger: '#f08a7a', warn: '#453414',
      synString: '#9ccf9f', synKeyword: '#eb9c72', synNumber: '#e3c07a', synAttr: '#8fbfe0',
    },
    diagram: { surface: '#2d241e', border: '#7a5540' },
  },
  {
    id: 'sepia', name: 'Sepia', mode: 'light', prose: 'serif',
    colors: {
      bg: '#f4ecd8', panel: '#ebe1c8', raised: '#fbf5e6', line: '#d9cdae',
      text: '#3b2f20', text2: '#5c4d39', text3: '#65563f',
      accent: '#8c4a1f', accentText: '#7d4019', onAccent: '#fff6e8',
      danger: '#a32a1c', warn: '#eddcae',
      synString: '#3f6133', synKeyword: '#7d4019', synNumber: '#74500a', synAttr: '#2f5a70',
    },
    diagram: { surface: '#ead9b8', border: '#b99a6b' },
  },
  {
    id: 'medianoche', name: 'Medianoche', mode: 'dark', prose: 'sans',
    colors: {
      bg: '#0f1626', panel: '#141d30', raised: '#1b263d', line: '#2a3750',
      text: '#e4e9f2', text2: '#aeb9cc', text3: '#98a5bb',
      accent: '#6fb3ff', accentText: '#8cc3ff', onAccent: '#0a1726',
      danger: '#ff9a8f', warn: '#3d3415',
      synString: '#9fdcc0', synKeyword: '#8cc3ff', synNumber: '#ecc98a', synAttr: '#c8b6ff',
    },
    diagram: { surface: '#1b2a45', border: '#44618f' },
  },
  {
    id: 'bosque', name: 'Bosque', mode: 'dark', prose: 'serif',
    colors: {
      bg: '#121a16', panel: '#17211c', raised: '#1f2c25', line: '#2e3f35',
      text: '#e3ebe4', text2: '#aebfb2', text3: '#99ad9e',
      accent: '#7cc49a', accentText: '#8fd1aa', onAccent: '#0d1a13',
      danger: '#f39b8c', warn: '#3a3517',
      synString: '#b5d99a', synKeyword: '#8fd1aa', synNumber: '#e3cb86', synAttr: '#9fd0d6',
    },
    diagram: { surface: '#1f3329', border: '#4b7560' },
  },
  {
    id: 'grafito', name: 'Grafito', mode: 'dark', prose: 'sans',
    colors: {
      bg: '#1a1a1b', panel: '#202021', raised: '#2a2a2b', line: '#3a3a3c',
      text: '#e8e8e8', text2: '#b5b5b5', text3: '#a6a6a6',
      accent: '#d6d6d6', accentText: '#e8e8e8', onAccent: '#1a1a1b',
      danger: '#f29a90', warn: '#3a3524',
      synString: '#c4c4c4', synKeyword: '#ffffff', synNumber: '#d6d6d6', synAttr: '#b5b5b5',
    },
    diagram: { surface: '#2c2c2e', border: '#68686c' },
  },
  {
    id: 'contraste', name: 'Alto contraste', mode: 'dark', prose: 'sans',
    colors: {
      bg: '#000000', panel: '#000000', raised: '#0d0d0d', line: '#9a9a9a',
      text: '#ffffff', text2: '#f2f2f2', text3: '#e0e0e0',
      accent: '#ffd400', accentText: '#ffd400', onAccent: '#000000',
      danger: '#ffa49a', warn: '#4d4000',
      synString: '#a8ffb0', synKeyword: '#ffd400', synNumber: '#ffc48a', synAttr: '#9ad8ff',
    },
    diagram: { surface: '#0d0d0d', border: '#ffffff' },
  },
];

export const themeById = (id: string) => THEMES.find((t) => t.id === id);

/** A vault theme applied over its built-in base. */
export function resolveTheme(file: ThemeFile): Theme {
  const base = themeById(file.base) ?? THEMES[0];
  return {
    ...base,
    id: file.id,
    name: file.name,
    prose: file.prose ?? base.prose,
    colors: { ...base.colors, ...file.colors },
    diagram: { ...base.diagram, ...file.diagram },
  };
}

/** Identifies a theme's look, for caching what was drawn with it. */
export const themeKey = (theme: Theme) => JSON.stringify([theme.colors, theme.diagram]);

const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---/;

/** Reads a simple `key: value` from a note's frontmatter. */
export function frontmatterValue(note: string, key: string) {
  const block = FRONTMATTER.exec(note)?.[1];
  if (!block) return null;
  const line = block.split(/\r?\n/).find((l) => l.startsWith(`${key}:`));
  return line?.slice(key.length + 1).trim().replace(/^['"]|['"]$/g, '') || null;
}

const kebab = (name: string) => name.replace(/[A-Z0-9]/g, (c) => `-${c.toLowerCase()}`);

/** A theme's CSS variables. */
export function themeVariables(theme: Theme): Record<string, string> {
  const colors = Object.entries(theme.colors).map(([name, value]) => [`--${kebab(name)}`, value]);
  return { ...Object.fromEntries(colors), '--prose-font': theme.prose === 'serif' ? 'var(--serif)' : 'var(--sans)' };
}

/** Publishes a theme as CSS variables, which also reach the preview's shadow root. */
export function applyTheme(theme: Theme) {
  const root = document.documentElement;
  for (const [name, value] of Object.entries(themeVariables(theme))) root.style.setProperty(name, value);
  root.style.colorScheme = theme.mode;
  root.dataset.theme = theme.id;
}

const srgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));

/** Mixes `amount` (0 to 1) of `over` onto `base`, as the UI does for tints. */
export function mix(base: string, over: string, amount: number) {
  const [a, b] = [srgb(base), srgb(over)];
  const parts = a.map((v, i) => Math.round(v + (b[i] - v) * amount));
  return `#${parts.map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

function luminance(hex: string) {
  const [r, g, b] = srgb(hex).map((v) => {
    const c = v / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio. */
export function contrast(a: string, b: string) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}
