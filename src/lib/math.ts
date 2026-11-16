/* eslint-disable @typescript-eslint/no-explicit-any -- markdown-it plugins reach internals it does not type */
// Formulas in notes: `$x^2$` inline and `$$ ... $$` as a block, drawn by KaTeX.
// The rules for where a formula starts and ends are the usual ones, so that
// "cuesta 5$ y 10$" stays a price: the opening `$` is followed by a word, the
// closing one is not preceded by a space nor followed by a digit, and `\$` is
// always a dollar. crates/core/src/math.rs applies the same rules to exports.
import katex from 'katex';
import katexCss from 'katex/dist/katex.min.css?raw';

const escapeHtml = (s: string) => new Option(s).innerHTML.replaceAll('"', '&quot;');
const isSpace = (c: string | undefined) => c === undefined || /\s/.test(c);
const isDigit = (c: string | undefined) => c !== undefined && c >= '0' && c <= '9';

/** KaTeX's own rules for the formulas, without its fonts: see `ensureMathFonts`. */
export const katexRules = katexCss.replace(/@font-face\{[^}]*\}/g, '');

const cache = new Map<string, string>();
const CACHE_MAX = 400;

/**
 * One formula as HTML. A formula KaTeX cannot read is shown as it was
 * written, marked, with the reason as a tooltip: the note stays whole.
 */
export function renderMath(tex: string, display: boolean): string {
  const key = `${display ? 'd' : 'i'}${tex}`;
  const known = cache.get(key);
  if (known !== undefined) return known;
  let html: string;
  try {
    html = katex.renderToString(tex, {
      displayMode: display,
      throwOnError: true,
      output: 'htmlAndMathml',
      strict: 'ignore',
      trust: false,
      maxExpand: 1000,
    });
    ensureMathFonts();
  } catch (error) {
    const reason = String((error as Error)?.message ?? error).replace(/^KaTeX parse error:\s*/, '');
    html = display
      ? `<div class="math-error math-display" title="${escapeHtml(reason)}"><code>${escapeHtml(tex)}</code></div>`
      : `<code class="math-error" title="${escapeHtml(reason)}">${escapeHtml(tex)}</code>`;
  }
  if (cache.size >= CACHE_MAX) cache.clear();
  cache.set(key, html);
  return html;
}

export interface Formula {
  /** The formula, without its dollars. */
  content: string;
  /** Where the text after it starts. */
  end: number;
  display: boolean;
}

/** The inline formula that starts at `pos`, a dollar, if the text there is one. */
export function inlineFormula(src: string, pos: number, posMax: number): Formula | null {
  if (src[pos] !== '$') return null;
  if (src[pos + 1] === '$') {
    // $$ ... $$ in the middle of a line.
    let i = pos + 2;
    for (; i < posMax - 1; i++) {
      if (src[i] === '\\') i++;
      else if (src[i] === '$' && src[i + 1] === '$') break;
    }
    const content = i < posMax - 1 ? src.slice(pos + 2, i).trim() : '';
    return content ? { content, end: i + 2, display: true } : null;
  }
  if (isSpace(src[pos + 1])) return null;
  for (let i = pos + 1; i < posMax; i++) {
    if (src[i] === '\\') {
      i++;
    } else if (src[i] === '$') {
      // A price ("5$ y 10$") has a space before its dollar or a digit after it.
      return isSpace(src[i - 1]) || isDigit(src[i + 1]) ? null : { content: src.slice(pos + 1, i), end: i + 1, display: false };
    }
  }
  return null;
}

/**
 * The block formula that starts at line `start`: `$$` alone on its line, the
 * formula, and `$$` ending a line; or all of it on one line. `last` is its last line.
 */
export function blockFormula(line: (n: number) => string, start: number, end: number): { content: string; last: number } | null {
  const first = line(start).trimEnd();
  if (!first.startsWith('$$')) return null;
  const closes = (text: string) => text.endsWith('$$') && !text.endsWith('\\$$');
  let content = first.slice(2);
  let last = start;
  if (content.length > 2 && closes(content)) {
    content = content.slice(0, -2);
  } else {
    let closed = false;
    for (last = start + 1; last < end; last++) {
      const text = line(last).trimEnd();
      if (closes(text)) {
        content += `\n${text.slice(0, -2)}`;
        closed = true;
        break;
      }
      content += `\n${text}`;
    }
    if (!closed) return null;
  }
  return content.trim() ? { content: content.trim(), last } : null;
}

function inlineMath(state: any, silent: boolean): boolean {
  const found = inlineFormula(state.src, state.pos, state.posMax);
  if (!found) return false;
  if (!silent) {
    const token = state.push('math_inline', '', 0);
    token.content = found.content;
    token.meta = { display: found.display };
  }
  state.pos = found.end;
  return true;
}

function blockMath(state: any, start: number, end: number, silent: boolean): boolean {
  if (state.sCount[start] - state.blkIndent >= 4) return false;
  const line = (n: number) => state.src.slice(state.bMarks[n] + state.tShift[n], state.eMarks[n]);
  const found = blockFormula(line, start, end);
  if (!found) return false;
  if (silent) return true;
  const token = state.push('math_block', '', 0);
  token.block = true;
  token.content = found.content;
  token.map = [start, found.last + 1];
  state.line = found.last + 1;
  return true;
}

export function mathPlugin(md: any) {
  md.inline.ruler.before('escape', 'math_inline', inlineMath);
  md.block.ruler.before('fence', 'math_block', blockMath, ['paragraph', 'reference', 'blockquote', 'list']);
  md.renderer.rules.math_inline = (tokens: any, idx: number) => {
    const { content, meta } = tokens[idx];
    return meta.display ? `<span class="math-display">${renderMath(content, true)}</span>` : renderMath(content, false);
  };
  md.renderer.rules.math_block = (tokens: any, idx: number) => {
    const token = tokens[idx];
    return `<div class="math-block" data-lines="${token.attrGet('data-lines') ?? ''}">${renderMath(token.content, true)}</div>\n`;
  };
}

let faces: Promise<string> | null = null;

/** KaTeX's @font-face rules with the fonts inside, as data: no files, and it works offline. */
function fontFaces(): Promise<string> {
  faces ??= (async () => {
    const files = import.meta.glob('/node_modules/katex/dist/fonts/*.woff2', { query: '?inline', import: 'default' });
    const rules = await Promise.all(
      Object.entries(files).map(async ([path, load]) => {
        const name = /KaTeX_([A-Za-z]+)-([A-Za-z]+)\.woff2$/.exec(path);
        if (!name) return '';
        const [, family, variant] = name;
        const weight = variant.startsWith('Bold') ? 'bold' : 'normal';
        const style = variant.endsWith('Italic') ? 'italic' : 'normal';
        return `@font-face{font-family:KaTeX_${family};font-style:${style};font-weight:${weight};src:url(${(await load()) as string}) format('woff2')}`;
      }),
    );
    return rules.join('');
  })();
  return faces;
}

/**
 * Gives the page KaTeX's rules and fonts, once, the first time a formula is
 * drawn. The fonts go in the document and not in the preview's shadow root,
 * which browsers do not let load fonts; the editor's formulas need the rules there too.
 */
function ensureMathFonts() {
  if (typeof document === 'undefined' || document.getElementById('katex-fonts')) return;
  const style = document.createElement('style');
  style.id = 'katex-fonts';
  style.textContent = katexRules;
  document.head.append(style);
  void fontFaces().then((css) => (style.textContent = css + katexRules));
}

/** The fonts for a page that must stand alone (an exported file): empty when `html` has no formula. */
export async function mathFontCss(html: string): Promise<string> {
  return html.includes('class="katex') ? fontFaces() : '';
}
