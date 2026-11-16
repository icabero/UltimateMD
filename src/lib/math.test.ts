import { describe, expect, it } from 'vitest';
import { renderMarkdown } from './markdown';

const ctx = { vaultId: 'v', path: 'Nota.md', files: ['Nota.md'] };

function render(text: string) {
  const host = document.createElement('div');
  host.append(renderMarkdown(text, ctx));
  return host;
}

describe('formulas', () => {
  it('draws inline and block formulas', () => {
    const html = render('Sea $x^2$ y\n\n$$\n\\frac{a}{b}\n$$\n\ny $$\\sum_{i=1}^n i$$ al medio.');
    expect(html.querySelectorAll('p > .katex').length).toBe(1);
    expect(html.querySelector('.math-block .katex-display')).not.toBeNull();
    expect(html.querySelector('.math-display .katex-display')).not.toBeNull();
    expect(html.querySelector('.math-block')?.getAttribute('data-lines')).toBe('3-5');
  });

  it('keeps a screen reader version of the formula', () => {
    expect(render('$x^2$').querySelector('math annotation')?.textContent).toBe('x^2');
  });

  it('leaves prices and escaped dollars alone', () => {
    for (const text of ['cuesta 5$ y 10$', 'cuesta $5 y $10 en total', 'pago \\$x\\$ hoy', 'solo $ uno', '$ no $', 'a $b$5']) {
      const html = render(text);
      expect(html.querySelector('.katex'), text).toBeNull();
    }
    expect(render('pago \\$x\\$ hoy').textContent).toContain('$x$');
  });

  it('does not touch code', () => {
    const html = render('`$x$` y\n\n```\n$$\nx\n$$\n```\n');
    expect(html.querySelector('.katex')).toBeNull();
    expect(html.querySelector('code')?.textContent).toBe('$x$');
  });

  it('shows a broken formula as written, without breaking the note', () => {
    const html = render('antes $\\noexiste{x}$ despues\n\n$$\n\\frac{1\n$$\n\n# Sigue');
    const errors = html.querySelectorAll('.math-error');
    expect(errors.length).toBe(2);
    expect(errors[0].textContent).toBe('\\noexiste{x}');
    expect(errors[0].getAttribute('title')).toBeTruthy();
    expect(html.querySelector('h1')?.textContent).toBe('Sigue');
  });

  it('keeps formulas in lists, tables and quotes', () => {
    const html = render('- uno $a_1$\n\n> cita $b$\n\n| x | y |\n|---|---|\n| $c$ | 2 |\n');
    expect(html.querySelectorAll('.katex').length).toBe(3);
  });

  it('does not let a formula run scripts', () => {
    const html = render('$\\href{javascript:alert(1)}{x}$');
    expect(html.querySelector('a[href^="javascript"]')).toBeNull();
  });
});
