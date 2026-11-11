import { describe, expect, it } from 'vitest';
import { headingId, pagePath } from './site';

describe('website export', () => {
  it('gives each note its page inside the site', () => {
    expect(pagePath('Docs/Guía/Inicio.md', 'Docs')).toBe('Guía/Inicio.html');
    expect(pagePath('Nota.markdown', '')).toBe('Nota.html');
    expect(pagePath('Docsx/a.md', 'Docs')).toBe('Docsx/a.html');
  });

  it('names headings the way links to them are written', () => {
    expect(headingId('Riesgos del plan')).toBe('riesgos-del-plan');
    expect(headingId('¿Qué es? Índice')).toBe('que-es-indice');
    expect(headingId('!!!')).toBe('titulo');
  });
});
