// Diagram engines are large, so each one loads the first time it is needed.
import DOMPurify from 'dompurify';

const PALETTE = {
  light: { bg: '#fffdfa', fg: '#23262f', line: '#8a8fa3', accent: '#7c3aed', muted: '#6b7080', surface: '#f3effb', border: '#c9bdea' },
  dark: { bg: '#1b1d24', fg: '#e6e6ea', line: '#747a90', accent: '#a78bfa', muted: '#9a9fb0', surface: '#262438', border: '#4f4579' },
};

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

async function renderOfficial(src: string, dark: boolean) {
  const mermaid = await official();
  const p = dark ? PALETTE.dark : PALETTE.light;
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: 'strict',
    theme: 'base',
    layout: 'elk',
    look: 'classic',
    // SVG text, not HTML labels, so diagrams can be exported to PNG.
    htmlLabels: false,
    flowchart: { htmlLabels: false, curve: 'basis' },
    gantt: { barHeight: 26, barGap: 6, fontSize: 13, sectionFontSize: 13, topPadding: 44, useWidth: 700, axisFormat: '%d %b' },
    fontFamily: 'Inter Variable, system-ui, sans-serif',
    themeVariables: {
      darkMode: dark,
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
    themeCSS: `.node rect,.node polygon,.node circle,.task{filter:drop-shadow(0 1px 2px #0002)}.node rect{rx:8px;ry:8px}`,
  });
  return (await mermaid.render(`umd-mermaid-${++counter}`, src)).svg;
}

async function renderMermaid(src: string, dark: boolean) {
  if (BEAUTIFUL.test(src)) {
    try {
      const { renderMermaidSVG } = await import('beautiful-mermaid');
      return renderMermaidSVG(src, { ...(dark ? PALETTE.dark : PALETTE.light), transparent: true });
    } catch {
      // Syntax it does not cover: the official renderer may still take it.
    }
  }
  return renderOfficial(src, dark);
}

let d2Worker: Worker | null = null;
const d2Pending = new Map<number, { ok: (svg: string) => void; fail: (e: Error) => void }>();

function renderD2(src: string, dark: boolean) {
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
  // Terrastruct's "Mixed Berry Blue" and "Dark Mauve" themes.
  const themeID = dark ? 200 : 5;
  return new Promise<string>((ok, fail) => {
    d2Pending.set(id, { ok, fail });
    d2Worker!.postMessage({ id, src, themeID });
  });
}

const cache = new Map<string, string>();
const MAX_CACHE = 100;

/** Renders to sanitised SVG. Throws with the engine's message on bad syntax. */
export async function renderDiagram(lang: string, src: string, dark: boolean): Promise<string> {
  const key = `${lang}:${dark}:${src}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const raw = await (lang === 'd2' ? renderD2(src, dark) : renderMermaid(src, dark));
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
