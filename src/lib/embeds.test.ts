import { describe, expect, it } from 'vitest';
import { embedSlice, expandEmbeds, fillEmbeds } from './embeds';
import { renderMarkdown } from './markdown';
import { resolveLink } from './paths';

const NOTE = '---\naliases: [Salida]\n---\n# Plan\n\nIntro.\n\n## Riesgos\n\nUno.\n\n### Detalle\n\nDos.\n\n## Fecha\n\nEl 2 de marzo. ^fecha\n';

describe('embedded notes', () => {
  it('takes the whole note, a section with its subsections, or a block', () => {
    expect(embedSlice(NOTE, '')).toBe('# Plan\n\nIntro.\n\n## Riesgos\n\nUno.\n\n### Detalle\n\nDos.\n\n## Fecha\n\nEl 2 de marzo. ^fecha\n');
    expect(embedSlice(NOTE, '#riesgos')).toBe('## Riesgos\n\nUno.\n\n### Detalle\n\nDos.');
    expect(embedSlice(NOTE, '#^fecha')).toBe('El 2 de marzo.');
    expect(embedSlice(NOTE, '#No existe')).toBeNull();
  });

  it('writes embedded notes into the text for exports, without loops', async () => {
    const files = { 'a.md': 'Antes ![[b#Riesgos]] y ![[a]] ![[foto.png]]', 'b.md': NOTE.replace('Uno.', 'Uno ![[a]].') };
    const read = async (p: string) => files[p as keyof typeof files] ?? null;
    const resolve = (t: string, from: string) => resolveLink(t, from, Object.keys(files));
    const out = await expandEmbeds(files['a.md'], 'a.md', resolve, read);
    expect(out).toContain('## Riesgos\n\nUno [[a]].');
    expect(out).toContain('y [[a]] ![[foto.png]]');
  });

  it('fills the page, shows missing ones as links and resolves aliases', async () => {
    const files = ['a.md', 'b.md'];
    const aliases = new Map([['salida', 'b.md']]);
    const ctx = { vaultId: 'v', path: 'a.md', files, aliases };
    const host = document.createElement('div');
    host.append(renderMarkdown('![[Salida#Fecha]]\n\n![[Nada]]\n\n[[Salida]]', ctx));
    await fillEmbeds(host, ctx, async (p) => (p === 'b.md' ? NOTE : null));
    const [found, missing] = host.querySelectorAll<HTMLElement>('.note-embed');
    expect(found.classList.contains('filled')).toBe(true);
    expect(found.querySelector('.embed-body')?.textContent).toContain('El 2 de marzo.');
    expect(found.querySelector<HTMLAnchorElement>('.embed-source')?.dataset.note).toBe('b.md');
    expect(missing.classList.contains('filled')).toBe(false);
    expect(host.querySelector<HTMLAnchorElement>('p > a[data-wikilink="Salida"]')?.dataset.note).toBe('b.md');
  });
});
