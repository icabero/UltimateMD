// Diagram engines are large, so each one loads the first time it is needed.
import DOMPurify from 'dompurify';
import { themeKey, type Theme } from './themes';

function palette({ colors, diagram }: Theme) {
  return {
    bg: colors.bg,
    fg: colors.text,
    line: colors.text3,
    accent: colors.accentText,
    muted: colors.text2,
    surface: diagram.surface,
    border: diagram.border,
  };
}

// Types beautiful-mermaid draws. Anything else goes to the official renderer.
const BEAUTIFUL = /^\s*(?:%%.*\n\s*)*(?:---[\s\S]*?---\s*)?(graph|flowchart|stateDiagram|sequenceDiagram|classDiagram|erDiagram|xychart)/;

let officialReady: Promise<typeof import('mermaid').default> | null = null;
let counter = 0;

function official() {
  officialReady ??= Promise.all([import('mermaid'), import('@mermaid-js/layout-elk')]).then(([m, elk]) => {
    m.default.registerLayoutLoaders(elk.default);
    return m.default;
  });
  return officialReady;
}

async function renderOfficial(src: string, theme: Theme, sketch: boolean) {
  const mermaid = await official();
  const p = palette(theme);
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: 'strict',
    theme: 'base',
    layout: 'elk',
    look: sketch ? 'handDrawn' : 'classic',
    // SVG text, not HTML labels, so diagrams can be exported to PNG.
    htmlLabels: false,
    flowchart: { htmlLabels: false, curve: 'basis' },
    gantt: { barHeight: 26, barGap: 6, fontSize: 13, sectionFontSize: 13, topPadding: 44, useWidth: 700, axisFormat: '%d %b' },
    fontFamily: 'Inter Variable, system-ui, sans-serif',
    themeVariables: {
      darkMode: theme.mode === 'dark',
      background: p.bg,
      primaryColor: p.surface,
      primaryBorderColor: p.border,
      primaryTextColor: p.fg,
      secondaryColor: p.bg,
      tertiaryColor: p.surface,
      lineColor: p.line,
      textColor: p.fg,
      fontFamily: 'Inter Variable, system-ui, sans-serif',
    },
    themeCSS: `.node rect{rx:6px;ry:6px}`,
  });
  return (await mermaid.render(`umd-mermaid-${++counter}`, src)).svg;
}

async function renderMermaid(src: string, theme: Theme, sketch: boolean) {
  // The lighter renderer has no hand-drawn look.
  if (!sketch && BEAUTIFUL.test(src)) {
    try {
      const { renderMermaidSVG } = await import('beautiful-mermaid');
      return renderMermaidSVG(src, { ...palette(theme), transparent: true });
    } catch {
      // Syntax it does not cover: the official renderer may still take it.
    }
  }
  return renderOfficial(src, theme, sketch);
}

let d2Worker: Worker | null = null;
const d2Pending = new Map<number, { ok: (svg: string) => void; fail: (e: Error) => void }>();

/** D2's theme overrides, appended so that error line numbers stay accurate. */
function d2Config(theme: Theme) {
  const p = palette(theme);
  const overrides = {
    N1: p.fg, N2: p.muted, N3: p.line, N4: p.line, N5: p.border, N6: p.surface, N7: p.bg,
    B1: p.accent, B2: p.accent, B3: p.border, B4: p.surface, B5: p.surface, B6: p.surface,
    AA2: p.accent, AA4: p.border, AA5: p.surface, AB4: p.border, AB5: p.surface,
  };
  const body = Object.entries(overrides).map(([k, v]) => `${k}: "${v}"`).join('; ');
  return `\nvars: { d2-config: { theme-overrides: { ${body} } } }\n`;
}

function renderD2(source: string, theme: Theme, sketch: boolean) {
  // A diagram that sets its own configuration keeps it.
  const src = source.includes('d2-config') ? source : source + d2Config(theme);

  if (!d2Worker) {
    d2Worker = new Worker(new URL('./d2.worker.ts', import.meta.url), { type: 'module' });
    d2Worker.onmessage = ({ data: { id, svg, error } }) => {
      const pending = d2Pending.get(id);
      d2Pending.delete(id);
      if (error) pending?.fail(new Error(error));
      else pending?.ok(svg);
    };
  }
  const id = ++counter;
  return new Promise<string>((ok, fail) => {
    d2Pending.set(id, { ok, fail });
    d2Worker!.postMessage({ id, src, sketch });
  });
}

const cache = new Map<string, string>();
const MAX_CACHE = 100;

/** Renders to sanitised SVG. Throws with the engine's message on bad syntax. */
export async function renderDiagram(lang: string, src: string, theme: Theme, sketch = false): Promise<string> {
  const key = `${lang}:${sketch}:${themeKey(theme)}:${src}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const raw = await (lang === 'd2' ? renderD2(src, theme, sketch) : renderMermaid(src, theme, sketch));
  const svg = DOMPurify.sanitize(raw, {
    USE_PROFILES: { svg: true, svgFilters: true, html: true },
    ADD_TAGS: ['style', 'foreignObject', 'use'],
    ADD_ATTR: ['xmlns:xlink', 'xlink:href', 'dominant-baseline', 'marker-end', 'marker-start'],
    HTML_INTEGRATION_POINTS: { foreignobject: true },
  });
  if (cache.size >= MAX_CACHE) cache.delete(cache.keys().next().value!);
  cache.set(key, svg);
  return svg;
}

function svgBytes(svg: string) {
  return new TextEncoder().encode(svg);
}

export async function toPng(svg: SVGSVGElement): Promise<Uint8Array> {
  const box = svg.viewBox.baseVal;
  const scale = 2;
  const width = (box?.width || svg.clientWidth) * scale;
  const height = (box?.height || svg.clientHeight) * scale;
  const clone = svg.cloneNode(true) as SVGSVGElement;
  clone.setAttribute('width', String(width));
  clone.setAttribute('height', String(height));
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  const url = URL.createObjectURL(new Blob([svgBytes(clone.outerHTML)], { type: 'image/svg+xml' }));
  try {
    const img = new Image();
    await new Promise((ok, fail) => {
      img.onload = ok;
      img.onerror = fail;
      img.src = url;
    });
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    canvas.getContext('2d')!.drawImage(img, 0, 0, width, height);
    const blob = await new Promise<Blob | null>((ok) => canvas.toBlob(ok, 'image/png'));
    if (!blob) throw new Error('png');
    return new Uint8Array(await blob.arrayBuffer());
  } finally {
    URL.revokeObjectURL(url);
  }
}

export const toSvgBytes = (svg: SVGSVGElement) => svgBytes(svg.outerHTML);
