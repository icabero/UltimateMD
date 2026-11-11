import { beforeAll, describe, expect, it } from 'vitest';
import { aiImages, guideDraft, redrawPrompt } from './diagramGuide';
import { setLanguage } from './i18n.svelte';
import { THEMES } from './themes';

describe('diagram guide', () => {
  beforeAll(() => setLanguage('es'));

  it('drafts a guide with the colours the app draws with', () => {
    const theme = THEMES.find((t) => t.id === 'sepia')!;
    const draft = guideDraft('Trabajo', { theme, sketch: false });
    expect(draft).toContain('# Estilo de los diagramas de Trabajo');
    for (const colour of [theme.diagram.surface, theme.diagram.border, theme.colors.bg, theme.colors.accent]) expect(draft).toContain(colour);
    expect(draft).toContain('sin sombras');
    expect(guideDraft('T', { theme, sketch: true })).toContain('boceto');
  });

  it('finds the images an AI added, wherever the note is', () => {
    const note = [
      '![Flujo](../adjuntos/Flujo%20de%20pago.svg)',
      '%%diagrama de IA: El flujo de pago%%',
      '',
      '![Mío](../adjuntos/foto.png)',
      '',
      '![Otro](../adjuntos/otro.svg) %%diagrama de IA: %%',
    ].join('\n');
    expect([...aiImages('Proyectos/Plan.md', note)]).toEqual([
      ['adjuntos/Flujo de pago.svg', 'El flujo de pago'],
      ['adjuntos/otro.svg', 'Otro'],
    ]);
    expect(aiImages('a.md', '![x](../../fuera.svg)\n%%diagrama de IA: x%%').size).toBe(0);
  });

  it('asks to follow the guide when drawing again', () => {
    const prompt = redrawPrompt('Proyectos/Plan.md', 'adjuntos/flujo.svg', 'El flujo');
    expect(prompt).toContain('«El flujo»');
    expect(prompt).toContain('«Plan.md»');
    expect(prompt).toContain('get_diagram_guide');
    expect(prompt).toContain('add_diagram_image');
  });
});
