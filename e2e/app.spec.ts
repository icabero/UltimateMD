import { expect, test, type Page } from '@playwright/test';
import { parseSource, toSource, type Diagram, type Engine } from '../src/lib/diagramBuilder';
import { fenceLine, parseStyle } from '../src/lib/diagramStyle';
import { TEMPLATES } from '../src/lib/diagramTemplates';
import { THEMES, contrast, frontmatterChange, mix } from '../src/lib/themes';
import { isNewer } from '../src/lib/updates';
import { properties, quote, setProperty } from '../src/lib/frontmatter';

test.beforeEach(async ({ page }) => {
  // The app asks GitHub about new versions at startup; tests never reach it.
  await page.route('https://api.github.com/**', (route) => route.fulfill({ status: 404 }));
  await page.addInitScript({ path: 'e2e/mock.js' });
  await page.goto('/');
});

const open = (page: Page, name: string) => page.locator('aside').getByRole('button', { name, exact: true }).click();
const prose = (page: Page) => page.locator('.scroll article');
const disk = (page: Page, vault: string, path: string) =>
  page.evaluate(([v, p]) => (window as any).__test.files[v][p], [vault, path]);

async function typeInEditor(page: Page, text: string) {
  await page.locator('.cm-content').click();
  await page.keyboard.press('ControlOrMeta+End');
  await page.keyboard.type(text);
}

test('several vaults are open at once, with tabs from each', async ({ page }) => {
  await expect(page.locator('aside')).toContainText('Trabajo');
  await expect(page.locator('aside')).toContainText('Personal');
  await open(page, 'Inicio');
  await open(page, 'Otra');
  await expect(page.locator('[role=tab]')).toHaveCount(2);
  await expect(page.locator('main footer')).toContainText('Personal / Otra.md');
});

test('edits are saved automatically', async ({ page }) => {
  await open(page, 'Otra');
  await typeInEditor(page, 'texto nuevo');
  await expect(page.locator('main footer')).toContainText('Guardado', { timeout: 3000 });
  expect(await disk(page, 'b', 'Otra.md')).toContain('texto nuevo');
  await expect(prose(page)).toContainText('texto nuevo');
});

test('an external change refreshes a note without unsaved edits', async ({ page }) => {
  await open(page, 'Otra');
  await page.evaluate(() => (window as any).__test.externalWrite('b', 'Otra.md', '# Escrito por la IA\n'));
  await expect(prose(page).locator('h1')).toHaveText('Escrito por la IA');
  await expect(page.locator('.cm-content')).toContainText('Escrito por la IA');
});

test('an external change never overwrites unsaved edits', async ({ page }) => {
  await open(page, 'Otra');
  await typeInEditor(page, 'mío');
  await page.evaluate(() => (window as any).__test.externalWrite('b', 'Otra.md', 'de la IA'));
  await expect(page.getByRole('alert')).toBeVisible();
  await page.waitForTimeout(1000);
  expect(await disk(page, 'b', 'Otra.md'), 'autosave must wait for the user').toBe('de la IA');

  await page.getByRole('button', { name: 'Mantener la mía' }).click();
  await expect(page.getByRole('alert')).toBeHidden();
  await expect.poll(() => disk(page, 'b', 'Otra.md')).toContain('mío');
});

test('a conflict can be resolved in favour of the disk', async ({ page }) => {
  await open(page, 'Otra');
  await typeInEditor(page, 'mío');
  await page.evaluate(() => (window as any).__test.externalWrite('b', 'Otra.md', 'de la IA'));
  await page.getByRole('button', { name: 'Usar la del disco' }).click();
  await expect(page.locator('.cm-content')).toHaveText('de la IA');
  await expect(page.locator('main footer')).toContainText('Guardado');
});

test('a vault that cannot be watched says so, and can be read again by hand', async ({ page }) => {
  await open(page, 'Otra');
  await page.evaluate(() => (window as any).__test.watchFailed('b', 'too many open files'));
  await expect(page.getByRole('status')).toContainText('Los cambios hechos fuera de la app en «Personal» no se verán solos');
  // Changed on disk without any notice, as happens then.
  await page.evaluate(() => {
    const t = (window as any).__test;
    t.silentWrite('b', 'Otra.md', '# Cambiada fuera');
    t.silentWrite('b', 'Nueva.md', '# Nueva');
  });
  const badge = page.locator('aside').getByTitle('Los cambios externos no se ven solos. Pulsa para volver a leer el vault.');
  await badge.click();
  await expect(prose(page).locator('h1')).toHaveText('Cambiada fuera');
  await expect(page.locator('aside').getByRole('button', { name: 'Nueva', exact: true })).toBeVisible();
});

test('a vault that could not be watched before the window opened is reported too', async ({ page }) => {
  await page.addInitScript(() => {
    (window as any).__watchProblems = [{ vaultId: 'a', error: 'inotify watch limit reached' }];
  });
  await page.reload();
  await expect(page.getByRole('status')).toContainText('«Trabajo»');
});

test('note HTML keeps its formatting but cannot run code', async ({ page }) => {
  await open(page, 'Inicio');
  await expect(prose(page).locator('b')).toHaveCSS('color', 'rgb(255, 0, 0)');
  await page.waitForTimeout(400);
  expect(await page.evaluate(() => (window as any).pwned)).toBeUndefined();
  await expect(prose(page).locator('script')).toHaveCount(0);
});

test('wikilinks open notes and mark missing ones', async ({ page }) => {
  await open(page, 'Inicio');
  await expect(prose(page).locator('a.broken')).toHaveText('Falta');
  await prose(page).getByText('Destino').click();
  await expect(page.locator('main footer')).toContainText('Trabajo / dir/Destino.md');
  await expect(page.locator('aside').getByRole('button', { name: 'Destino', exact: true })).toBeVisible();
});

test('mermaid diagrams render to SVG', async ({ page }) => {
  await open(page, 'Inicio');
  await expect(prose(page).locator('.diagram > svg')).toBeVisible();
});

test('several D2 diagrams in a note all finish, even with a bad one', async ({ page }) => {
  await open(page, 'D2');
  // Direct children only: a D2 diagram nests one svg inside another.
  await expect(prose(page).locator('.diagram > svg')).toHaveCount(2, { timeout: 15_000 });
  await expect(prose(page).locator('.diagram-error')).toHaveCount(1);
});

test('a broken diagram says what fails and where, and opens in the builder', async ({ page }) => {
  await open(page, 'D2');
  await page.getByTitle('Vista previa', { exact: true }).click();
  const box = prose(page).locator('.diagram-error');
  await expect(box).toContainText('Este diagrama tiene un error', { timeout: 15_000 });
  await expect(box).toContainText('Línea 1: A la conexión le falta el destino. (y 1 más)');
  await expect(box).not.toContainText('errmsg');
  await box.getByRole('button', { name: 'Abrir en el creador' }).click();
  const dialog = builder(page, 'Editar diagrama');
  await expect(dialog.getByLabel('Código del diagrama')).toHaveValue('esto no vale -> {');
  await expect(dialog.getByRole('alert')).toContainText('Línea 1: A la conexión le falta el destino. (y 1 más)');
});

test('in visual mode a broken diagram explains itself too', async ({ page }) => {
  await open(page, 'D2');
  await page.getByTitle('Visual', { exact: true }).click();
  const box = page.locator('.cm-v-diagram .diagram-error');
  await expect(box).toContainText('Línea 1: A la conexión le falta el destino.', { timeout: 15_000 });
  await box.getByRole('button', { name: 'Abrir en el creador' }).click();
  await expect(builder(page, 'Editar diagrama').getByLabel('Código del diagrama')).toHaveValue('esto no vale -> {');
});

test('the broken links of a vault are listed, mended and created', async ({ page }) => {
  await page.evaluate(() => {
    (window as any).__test.files.a['Notas.md'] = '# Notas\n\nVer [[Destno]].\n\nY [[Otra cosa]].\n';
  });
  await page.locator('aside').getByRole('button', { name: 'Trabajo', exact: true }).click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Enlaces rotos' }).click();
  const screen = page.getByRole('dialog', { name: 'Enlaces rotos · Trabajo' });
  await expect(screen).toContainText('3 enlaces rotos en 2 notas');
  const destno = screen.locator('.link', { hasText: 'Destno' });
  await expect(destno).toContainText('línea 3');
  await destno.getByRole('button', { name: 'Usar «Destino»' }).click();
  await expect(screen).toContainText('2 enlaces rotos en 2 notas');
  expect(await disk(page, 'a', 'Notas.md')).toContain('Ver [[Destino]].');

  await screen.locator('.link', { hasText: 'Otra cosa' }).getByRole('button', { name: 'Crear la nota' }).click();
  await expect(screen).toContainText('Un enlace roto.');
  expect(await disk(page, 'a', 'Otra cosa.md')).toBe('');

  await screen.locator('.link', { hasText: 'Falta' }).getByRole('button', { name: /Falta/ }).click();
  await expect(screen).toBeHidden();
  await expect(page.locator('main footer')).toContainText('Trabajo / Inicio.md');
});

test('the links panel of a note leads to every broken link of the vault', async ({ page }) => {
  await open(page, 'Inicio');
  await page.getByTitle(/^Panel de la nota/).click();
  await notePanel(page).getByRole('tab', { name: 'Enlaces' }).click();
  await notePanel(page).getByRole('button', { name: 'Ver todos los del vault' }).click();
  await expect(page.getByRole('dialog', { name: 'Enlaces rotos · Trabajo' })).toContainText('Un enlace roto.');
});

test('engine errors become a line and a reason in the language of the app', async ({ page }) => {
  const problems = await page.evaluate(async () => {
    const { explainDiagramError, describeProblem } = await import('/src/lib/diagramErrors.ts');
    const { renderDiagram } = await import('/src/lib/diagrams.ts');
    const { themeById } = await import('/src/lib/themes.ts');
    const cases: [string, string][] = [
      ['mermaid', '---\ntitle: T\n---\nflowchart LR\n  A --> \n'],
      ['mermaid', 'mindmap\n  root\n    a\n   b(\n'],
      ['mermaid', 'flowchar LR\n A-->B\n'],
      ['mermaid', 'pie title Mascotas\n  "Perros" : x\n'],
      ['mermaid', '  \n'],
      ['d2', 'a -> b\nc: {style.colr: red}\nq: {shape: zz}\n'],
      ['d2', 'a -> \n'],
    ];
    const out: string[] = [];
    for (const [lang, src] of cases) {
      try {
        await renderDiagram(lang, src, themeById('claro')!);
        out.push('dibujado');
      } catch (e) {
        out.push(describeProblem(explainDiagramError(lang, src, e)));
      }
    }
    return out;
  });
  expect(problems).toEqual([
    'Línea 5: El código se corta antes de tiempo: falta algo al final.',
    'Línea 4: Aquí hay algo que no se esperaba.',
    'Línea 1: No se reconoce el tipo de diagrama. La primera línea dice cuál es, por ejemplo flowchart o sequenceDiagram.',
    'Línea 2: No se esperaba «x» aquí.',
    'El diagrama está vacío.',
    'Línea 2: No existe el estilo «colr». (y 1 más)',
    'Línea 1: A la conexión le falta el destino.',
  ]);
});

test('a new note can be created and opened', async ({ page }) => {
  await page.keyboard.press('Control+n');
  await page.getByRole('textbox').fill('Nueva');
  await page.keyboard.press('Enter');
  await expect(page.locator('main footer')).toContainText('Nueva.md');
  expect(await disk(page, 'a', 'Nueva.md')).toBe('');
});

test('the quick switcher finds notes in every vault', async ({ page }) => {
  await page.keyboard.press('Control+p');
  await page.getByPlaceholder('Abrir nota…').fill('otra');
  await page.keyboard.press('Enter');
  await expect(page.locator('main footer')).toContainText('Personal / Otra.md');
});

const palette = (page: Page) => page.getByRole('dialog', { name: 'Abrir nota' });

test('the command palette runs actions and shows their shortcuts', async ({ page }) => {
  await open(page, 'Inicio');
  await page.keyboard.press('Control+Shift+p');
  await expect(palette(page).getByRole('combobox')).toHaveValue('>');
  await page.keyboard.type('exportar');
  const first = palette(page).getByRole('option').first();
  await expect(first).toContainText('Exportar la nota');
  await expect(first.locator('kbd')).toHaveText(['Ctrl', 'E']);
  await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog', { name: 'Exportar' })).toBeVisible();
});

test('actions are found without accents and the last used come first', async ({ page }) => {
  await page.keyboard.press('Control+Shift+p');
  await page.keyboard.type('tema medianoche');
  await page.keyboard.press('Enter');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'medianoche');
  await page.keyboard.press('Control+Shift+p');
  await expect(palette(page).getByRole('option').first()).toHaveText('Tema: Medianoche');
  // Shortcuts name the Shift key in the interface language.
  await page.keyboard.type('barra lateral');
  await expect(palette(page).getByRole('option').first().locator('kbd')).toHaveText(['Ctrl', 'Mayús', 'E']);
});

test('the quick switcher turns into actions with > and headings with #', async ({ page }) => {
  await open(page, 'Inicio');
  await page.keyboard.press('Control+p');
  await expect(palette(page)).toContainText('Escribe > para ver acciones');
  await page.keyboard.type('>');
  await expect(palette(page).getByRole('combobox')).toHaveAttribute('placeholder', 'Buscar una acción…');
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.type('#');
  await expect(palette(page).getByRole('option')).toHaveText(['Inicio H1']);
  await page.keyboard.press('Enter');
  await expect(page.locator('.cm-activeLine')).toHaveText('# Inicio');
});

test('the quick switcher starts with the notes opened last', async ({ page }) => {
  await open(page, 'Otra');
  await open(page, 'Inicio');
  await page.keyboard.press('Control+p');
  // The note on screen is not offered: the one before it is.
  const first = palette(page).getByRole('option').first();
  await expect(first).toContainText('Otra.md');
  await expect(first).toContainText('Reciente');
  await page.keyboard.press('Escape');
  await page.reload();
  await page.keyboard.press('Control+p');
  await expect(palette(page).getByRole('option').first()).toContainText('Otra.md');
});

test('favourite notes are pinned to the side bar and follow a rename', async ({ page }) => {
  const aside = page.locator('aside');
  await aside.getByRole('button', { name: 'Otra', exact: true }).click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Añadir a favoritos' }).click();
  const favorites = aside.getByRole('region', { name: 'Favoritos' });
  await expect(favorites.getByRole('button')).toHaveText(['Otra']);
  await favorites.getByRole('button', { name: 'Otra' }).click();
  await expect(page.locator('main footer')).toContainText('Personal / Otra.md');

  await aside.locator('section.vault').getByRole('button', { name: 'Otra', exact: true }).click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Renombrar' }).click();
  await page.getByRole('form', { name: 'Nuevo nombre' }).getByRole('textbox').fill('Segunda.md');
  await page.getByRole('form', { name: 'Nuevo nombre' }).getByRole('button', { name: 'Renombrar' }).click();
  await expect(favorites.getByRole('button')).toHaveText(['Segunda']);

  await favorites.getByRole('button', { name: 'Segunda' }).click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Quitar de favoritos' }).click();
  await expect(favorites).toBeHidden();
});

test('Ctrl+/ lists every shortcut, and the list can be filtered', async ({ page }) => {
  await page.keyboard.press('Control+/');
  const list = page.getByRole('dialog', { name: 'Atajos de teclado' });
  await expect(list.getByRole('region', { name: 'Escribir' })).toContainText('Negrita');
  await expect(list.getByRole('region', { name: 'Pestañas y paneles' })).toContainText('Cerrar la pestaña');
  await list.getByRole('textbox').fill('ctrl k');
  await expect(list.locator('dt')).toHaveText(['Insertar un enlace']);
  await list.getByRole('textbox').fill('nada de esto');
  await expect(list).toContainText('Ningún atajo coincide.');
  await page.keyboard.press('Escape');
  await expect(list).toBeHidden();

  // Also from the actions, and from inside the editor.
  await open(page, 'Otra');
  await page.locator('.cm-content').click();
  await page.keyboard.press('Control+/');
  await expect(list).toBeVisible();
  expect(await disk(page, 'b', 'Otra.md')).toBe('# Otra\n');
});

test('spelling is checked in the language of the app, of the note or none', async ({ page }) => {
  await open(page, 'Otra');
  const content = page.locator('.cm-content');
  await expect(content).toHaveAttribute('spellcheck', 'true');
  await expect(content).toHaveAttribute('lang', 'es');
  await expect.poll(() => page.evaluate(() => (window as any).__spellcheck)).toEqual(['es_ES']);

  await page.evaluate(() => (window as any).__test.externalWrite('b', 'Otra.md', '---\nidioma: en\n---\n# Other\n'));
  await expect(content).toHaveAttribute('lang', 'en');
  await expect.poll(() => page.evaluate(() => (window as any).__spellcheck)).toEqual(['en_US']);

  await page.locator('aside').getByTitle('Ajustes y MCP').click();
  await page.getByRole('combobox', { name: 'Corrector ortográfico' }).selectOption('Desactivado');
  await page.keyboard.press('Escape');
  await expect(content).toHaveAttribute('spellcheck', 'false');
  await expect.poll(() => page.evaluate(() => (window as any).__spellcheck)).toEqual([]);
});

test('the AI connection can be tested from the settings', async ({ page }) => {
  await page.locator('aside').getByTitle('Ajustes y MCP').click();
  await page.getByRole('button', { name: 'Inteligencia artificial' }).click();
  const check = page.getByRole('region', { name: 'Probar la conexión' });
  await check.getByRole('button', { name: 'Probar' }).click();
  await expect(check.getByRole('status')).toContainText('Funciona. Servidor 9.9.9.');
  await expect(check.getByRole('listitem')).toHaveText(['Trabajo Lectura']);
  await expect(check.getByRole('status')).toContainText('tienen el acceso desactivado: Personal.');
  await check.getByRole('button', { name: 'Cambiar el acceso' }).click();
  await expect(page.getByRole('group', { name: 'Acceso MCP de Personal' })).toBeVisible();

  await page.evaluate(() => {
    (window as any).__mcpCheck = { ok: false, version: null, vaults: [], failed: 'silent', error: 'config file is not valid JSON' };
  });
  await page.getByRole('button', { name: 'Inteligencia artificial' }).click();
  await check.getByRole('button', { name: 'Probar' }).click();
  await expect(check.getByRole('status')).toContainText('El servidor arrancó pero no respondió a tiempo.');
  await expect(check.getByRole('status')).toContainText('config file is not valid JSON');
});

test('global search covers every vault', async ({ page }) => {
  await page.keyboard.press('Control+Shift+f');
  await page.getByPlaceholder('Buscar en los vaults abiertos').fill('#');
  await expect(page.locator('.results .note')).toHaveCount(6);
});

/** A long note whose match is far down, for the search tests. */
async function longNote(page: Page) {
  await page.evaluate(() => {
    const filler = Array.from({ length: 80 }, (_, i) => `Línea de relleno ${i + 1}`);
    filler[59] = 'Acta de la Reunión de marzo';
    (window as any).__test.files.a['Larga.md'] = ['# Larga', '', ...filler, ''].join('\n');
  });
}

async function searchFor(page: Page, query: string) {
  await page.keyboard.press('Control+Shift+f');
  await page.getByPlaceholder('Buscar en los vaults abiertos').fill(query);
}

test('search ignores accents and marks the words found', async ({ page }) => {
  await longNote(page);
  await searchFor(page, 'reunion MARZO');
  const note = page.locator('.results .note');
  await expect(note).toHaveCount(1);
  await expect(note.locator('.title')).toHaveText('Larga');
  await expect(note.locator('.line mark')).toHaveText(['Reunión', 'marzo']);
});

test('a search result opens the note at the line found', async ({ page }) => {
  await longNote(page);
  await searchFor(page, 'reunion');
  await page.locator('.results .line').click();
  await expect(page.locator('.cm-activeLine')).toContainText('Acta de la Reunión de marzo');
  await expect(page.locator('.cm-activeLine')).toBeInViewport();
  await expect(page.locator('.cm-found')).toHaveText('Reunión');
  // Marks last until the note is edited.
  await page.keyboard.type('x');
  await expect(page.locator('.cm-found')).toHaveCount(0);
});

test('in reading view a search result scrolls the preview to the match', async ({ page }) => {
  await longNote(page);
  await open(page, 'Inicio');
  await page.getByTitle('Vista previa', { exact: true }).click();
  await searchFor(page, 'reunion');
  await page.locator('.results .line').click();
  await expect.poll(() => page.evaluate(() => (CSS as any).highlights.get('umd-found')?.size ?? 0)).toBe(1);
  await expect(prose(page).getByText('Acta de la Reunión de marzo')).toBeInViewport();
});

test('the quick switcher ignores accents', async ({ page }) => {
  await page.keyboard.press('Control+p');
  await page.getByPlaceholder('Abrir nota…').fill('hóndo');
  await page.keyboard.press('Enter');
  await expect(page.locator('main footer')).toContainText('Trabajo / dir/sub/Hondo.md');
});

test('renaming a note updates the links to it, also in open tabs', async ({ page }) => {
  await open(page, 'Inicio');
  await page.locator('aside').getByRole('button', { name: 'dir', exact: true }).click();
  await page.locator('aside').getByRole('button', { name: 'Destino', exact: true }).click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Renombrar' }).click();
  await page.getByRole('form', { name: 'Nuevo nombre' }).getByRole('textbox').fill('Meta.md');
  await page.getByRole('form', { name: 'Nuevo nombre' }).getByRole('button', { name: 'Renombrar' }).click();
  await expect(page.getByRole('status')).toHaveText('Se actualizó un enlace en «Inicio»');
  expect(await disk(page, 'a', 'Inicio.md')).toContain('Ver [[Meta]] y [[Falta]].');
  await page.getByRole('tab', { name: /Inicio/ }).click();
  await expect(page.locator('.cm-content')).toContainText('Ver [[Meta]] y [[Falta]].');
  await expect(page.locator('main footer')).toContainText('Trabajo / Inicio.md');
});

const notePanel = (page: Page) => page.getByRole('complementary', { name: 'Panel de la nota' });

/** A long note with sections, as if another program had written it. */
async function sections(page: Page) {
  await page.evaluate(() => {
    const filler = (n: number) => Array.from({ length: n }, (_, i) => `Párrafo ${i + 1}.`).join('\n\n');
    const text = `---\ntema: claro\n---\n# Larga\n\n${filler(30)}\n\n## Segunda parte\n\n${filler(30)}\n\n### Detalle [[Destino|el destino]]\n\nFin.\n`;
    (window as any).__test.externalWrite('a', 'Larga.md', text);
  });
  await expect(page.locator('aside').getByRole('button', { name: 'Larga', exact: true })).toBeVisible();
  await page.keyboard.press('Control+p');
  await page.getByPlaceholder('Abrir nota…').fill('larga');
  await page.keyboard.press('Enter');
}

test('the outline lists the headings and goes to one', async ({ page }) => {
  await sections(page);
  await page.keyboard.press('Control+Shift+o');
  const outline = notePanel(page).getByRole('navigation', { name: 'Esquema' });
  await expect(outline.getByRole('button')).toHaveText(['Larga', 'Segunda parte', 'Detalle el destino']);
  await outline.getByRole('button', { name: 'Segunda parte' }).click();
  await expect(page.locator('.cm-activeLine')).toHaveText('## Segunda parte');
  await expect(page.locator('.cm-activeLine')).toBeInViewport();
  // The section with the cursor is marked.
  await expect(outline.locator('[aria-current="location"]')).toHaveText('Segunda parte');
  // In the frontmatter, before the first heading, no section is marked.
  await page.keyboard.press('ControlOrMeta+Home');
  await expect(outline.locator('[aria-current="location"]')).toHaveCount(0);
  await outline.getByRole('button', { name: 'Larga' }).click();
  await expect(outline.locator('[aria-current="location"]')).toHaveText('Larga');
});

test('in reading view the outline scrolls the preview to the heading', async ({ page }) => {
  await sections(page);
  await page.getByTitle('Vista previa', { exact: true }).click();
  await page.keyboard.press('Control+Shift+o');
  await notePanel(page).getByRole('button', { name: 'Detalle el destino' }).click();
  await expect(prose(page).getByRole('heading', { name: 'Detalle el destino' })).toBeInViewport();
  await expect(notePanel(page).locator('[aria-current="location"]')).toHaveText('Detalle el destino');
});

test('the links tab shows who links here and opens them', async ({ page }) => {
  await open(page, 'Inicio');
  await page.getByTitle(/^Panel de la nota/).click();
  await notePanel(page).getByRole('tab', { name: 'Enlaces' }).click();
  await expect(notePanel(page)).toContainText('Ninguna nota enlaza a esta.');
  await expect(notePanel(page).getByRole('button', { name: /Destino/ })).toBeVisible();
  await expect(notePanel(page).getByRole('button', { name: 'Falta' })).toHaveAttribute('title', 'Crear la nota');
  await notePanel(page).getByRole('button', { name: /Destino/ }).click();
  await expect(page.locator('main footer')).toContainText('Trabajo / dir/Destino.md');
  await expect(notePanel(page).getByRole('button', { name: 'Inicio' })).toBeVisible();
});

test('app shortcuts never reach the editor, where macOS gives Ctrl keys their own meaning', async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(navigator, 'platform', { get: () => 'MacIntel' }));
  await page.reload();
  await open(page, 'Otra');
  await page.locator('.cm-content').click();
  await page.keyboard.press('ControlOrMeta+End');
  await page.keyboard.press('Control+Shift+o');
  await page.keyboard.press('Control+Shift+o');
  await page.keyboard.press('Control+Shift+e');
  await page.keyboard.press('Control+Shift+e');
  await page.waitForTimeout(800);
  expect(await disk(page, 'b', 'Otra.md')).toBe('# Otra\n');
  await expect(page.locator('.cm-content')).toHaveText('# Otra');
});

test('both side bars hide with shortcuts and the choice is kept', async ({ page }) => {
  await open(page, 'Inicio');
  await page.keyboard.press('Control+Shift+o');
  await expect(notePanel(page)).toBeVisible();
  await page.keyboard.press('Control+Shift+e');
  await expect(page.locator('aside').getByText('Trabajo')).toHaveCount(0);
  await page.reload();
  await expect(notePanel(page)).toBeVisible();
  await page.getByTitle('Mostrar la barra lateral (Ctrl+Mayús+E)').click();
  await expect(page.locator('aside').getByText('Trabajo')).toBeVisible();
  await notePanel(page).getByTitle('Ocultar el panel (Ctrl+Mayús+O)').click();
  await expect(notePanel(page)).toHaveCount(0);
});

test('a narrow window folds the side bars without forgetting them', async ({ page }) => {
  await open(page, 'Inicio');
  await page.keyboard.press('Control+Shift+o');
  await page.setViewportSize({ width: 900, height: 700 });
  await expect(notePanel(page)).toHaveCount(0);
  await expect(page.locator('aside').getByText('Trabajo')).toBeVisible();
  await page.setViewportSize({ width: 700, height: 700 });
  await expect(page.locator('aside').getByText('Trabajo')).toHaveCount(0);
  // Shown by hand while narrow, it stays until the window changes again.
  await page.getByTitle('Mostrar la barra lateral (Ctrl+Mayús+E)').click();
  await expect(page.locator('aside').getByText('Trabajo')).toBeVisible();
  await page.setViewportSize({ width: 1280, height: 720 });
  await expect(notePanel(page)).toBeVisible();
  await expect(page.locator('aside').getByText('Trabajo')).toBeVisible();
});

test('the start screen shows recent notes and vaults, and opens them', async ({ page }) => {
  const home = page.locator('.home');
  await expect(home.getByRole('heading', { name: 'Recientes' })).toBeVisible();
  await expect(home.locator('.card')).toHaveCount(2);
  await expect(home.locator('.card').first()).toContainText(/\d+ notas/);
  await expect(home.locator('.card').first()).toContainText('Editado hace');
  // A note just edited comes first.
  await page.evaluate(() => (window as any).__test.externalWrite('b', 'Rara.md', '# Rara\n\notra vez\n'));
  await expect(home.locator('.recent li').first()).toContainText('Rara');
  await expect(home.locator('.recent li').first()).toContainText('ahora mismo');
  await home.locator('.recent li').first().getByRole('button').click();
  await expect(page.locator('main footer')).toContainText('Personal / Rara.md');
});

test('a vault card picks up the note edited last', async ({ page }) => {
  await page.evaluate(() => (window as any).__test.externalWrite('a', 'dir/Destino.md', '# Destino\n\nnuevo\n'));
  const card = page.locator('.home .card', { hasText: 'Trabajo' });
  await expect(card).toHaveAttribute('title', 'Seguir con Destino');
  await card.click();
  await expect(page.locator('main footer')).toContainText('Trabajo / dir/Destino.md');
});

test('the start screen offers its actions and another tip', async ({ page }) => {
  const home = page.locator('.home');
  await expect(home.getByRole('button', { name: /Abrir nota/ }).locator('kbd')).toHaveText(['Ctrl', 'P']);
  await home.getByRole('button', { name: /Acciones/ }).click();
  await expect(page.getByRole('dialog', { name: 'Abrir nota' }).getByRole('combobox')).toHaveValue('>');
  await page.keyboard.press('Escape');
  const tip = home.getByRole('note', { name: 'Consejo:' });
  const before = await tip.textContent();
  await tip.getByRole('button', { name: 'Otro consejo' }).click();
  await expect(tip).not.toHaveText(before!);
});

test('with no vault open, the start screen says how to begin', async ({ page }) => {
  await page.addInitScript(() => (window as any).__test.vaults.forEach((v: any) => (v.open = false)));
  await page.reload();
  const home = page.locator('.home');
  await expect(home).toContainText('Crea un vault o abre una carpeta para empezar');
  await expect(home.getByRole('button', { name: 'Crear vault' })).toBeVisible();
  await expect(home.getByRole('button', { name: 'Abrir carpeta' })).toBeVisible();
});

test('frontmatter properties are read and written as plain YAML', () => {
  const note = '---\ntema: sepia\ntitulo: "Plan: fase 2"\netiquetas:\n  - a\n  - b\n# comentario\n---\n# Nota\n';
  expect(properties(note)).toEqual([
    { key: 'tema', value: 'sepia', complex: false },
    { key: 'titulo', value: 'Plan: fase 2', complex: false },
    { key: 'etiquetas', value: '', complex: true },
  ]);
  expect(quote('Informe anual')).toBe('Informe anual');
  for (const v of ['Plan: fase 2', '#1', 'yes', '2027', '- guion', 'dice "hola"']) {
    expect(properties(`---\nk: ${quote(v)}\n---\n`)[0].value).toBe(v);
  }
  expect(setProperty('# Nota\n', 'autor', 'Nerea')).toBe('---\nautor: Nerea\n---\n# Nota\n');
  expect(setProperty(note, 'tema', '')).not.toContain('tema:');
  expect(setProperty('---\nautor: A\n---\nx', 'autor', '')).toBe('x');
});

test('the properties form edits the frontmatter and keeps the cursor', async ({ page }) => {
  await open(page, 'Propia');
  await page.locator('.cm-content').click();
  await page.keyboard.press('ControlOrMeta+End');
  await page.keyboard.press('Control+Shift+o');
  await notePanel(page).getByRole('tab', { name: 'Propiedades' }).click();
  const form = notePanel(page);
  await expect(form.getByLabel('Tema de la nota')).toHaveValue('sepia');
  await form.getByLabel('Título').fill('Informe: fase 2');
  await form.getByLabel('Título').press('Enter');
  await form.getByLabel('Tema de la nota').selectOption('oscuro');
  await form.getByLabel('Nombre', { exact: true }).fill('cliente');
  await form.getByLabel('Valor', { exact: true }).fill('ACME');
  await form.getByRole('button', { name: 'Añadir' }).click();
  await expect(page.locator('main footer')).toContainText('Guardado', { timeout: 3000 });
  expect(await disk(page, 'b', 'Propia.md')).toBe('---\ntema: oscuro\ntitulo: "Informe: fase 2"\ncliente: ACME\n---\n# Propia\n');
  await expect(page.locator('[data-note-theme]')).toHaveAttribute('data-note-theme', 'oscuro');
  // The cursor stayed at the end of the note.
  await page.locator('.cm-content').focus();
  await page.keyboard.type(' fin');
  await expect(page.locator('.cm-content')).toContainText('# Propia fin');
  await form.getByTitle('Quitar cliente').click();
  await expect(form.getByLabel('Nombre', { exact: true })).toHaveValue('');
  await expect.poll(() => disk(page, 'b', 'Propia.md'), { timeout: 3000 }).not.toContain('cliente');
});

test('a property name is checked before it is added', async ({ page }) => {
  await open(page, 'Otra');
  await page.keyboard.press('Control+Shift+p');
  await page.keyboard.type('propiedades');
  await page.keyboard.press('Enter');
  const form = notePanel(page);
  await form.getByLabel('Nombre', { exact: true }).fill('mal:nombre');
  await expect(form.getByRole('alert')).toHaveText('El nombre no puede tener dos puntos ni empezar por un símbolo.');
  await form.getByLabel('Nombre', { exact: true }).fill('autor');
  await form.getByLabel('Valor', { exact: true }).fill('Ana');
  await form.getByRole('button', { name: 'Añadir' }).click();
  await expect(form.getByLabel('Autor')).toHaveValue('Ana');
  expect(await page.locator('.cm-content').textContent()).toContain('autor: Ana');
});

test('with reduced motion nothing animates', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.keyboard.press('Control+Shift+p');
  const box = page.getByRole('dialog', { name: 'Abrir nota' });
  await expect(box).toBeVisible();
  const running = await box.evaluate((el) => el.getAnimations().filter((a) => Number(a.effect?.getComputedTiming().duration) > 0).length);
  expect(running).toBe(0);
});

test('dialogs grow into place when motion is allowed', async ({ page }) => {
  await page.keyboard.press('Control+Shift+p');
  const box = page.getByRole('dialog', { name: 'Abrir nota' });
  const timing = await box.evaluate((el) => el.getAnimations().map((a) => Number(a.effect?.getComputedTiming().duration)));
  expect(timing.some((d) => d >= 120 && d <= 200)).toBe(true);
});

const windowCalls = (page: Page) => page.evaluate(() => (window as any).__windowCalls.map((c: any) => c.name));

/** Pretends to run on Windows or macOS, which the app reads before it starts. */
async function onPlatform(page: Page, platform: 'Win32' | 'MacIntel') {
  await page.addInitScript((p) => Object.defineProperty(navigator, 'platform', { get: () => p }), platform);
  await page.reload();
}

test('on Windows and Linux the app draws the window buttons and saves before closing', async ({ page }) => {
  await onPlatform(page, 'Win32');
  const controls = page.getByRole('group', { name: 'Ventana' });
  await expect(controls.getByRole('button')).toHaveCount(3);
  await controls.getByTitle('Minimizar la ventana').click();
  await controls.getByTitle('Maximizar la ventana').click();
  await open(page, 'Otra');
  await typeInEditor(page, ' sin guardar');
  await controls.getByTitle('Cerrar la ventana').click();
  await expect.poll(() => windowCalls(page)).toEqual(expect.arrayContaining(['minimize', 'toggle_maximize', 'close']));
  expect(await disk(page, 'b', 'Otra.md')).toContain('sin guardar');
  // The bars leave room for the buttons and can drag the window.
  await expect(page.locator('main > .bar')).toHaveAttribute('data-tauri-drag-region');
  await expect(page.locator('main > .bar')).toHaveCSS('padding-right', '138px');
});

test('the system title bar can come back from settings', async ({ page }) => {
  await onPlatform(page, 'Win32');
  await page.getByTitle('Ajustes y MCP').click();
  const settings = page.getByRole('dialog', { name: 'Ajustes' });
  await settings.getByRole('navigation').getByRole('button', { name: 'Apariencia' }).click();
  await settings.getByLabel('Usar la barra de título del sistema').check();
  await expect(page.getByRole('group', { name: 'Ventana' })).toHaveCount(0);
  const calls = await page.evaluate(() => (window as any).__windowCalls);
  expect(calls.at(-1)).toEqual({ name: 'set_decorations', value: true });
  await page.reload();
  await expect(page.getByRole('group', { name: 'Ventana' })).toHaveCount(0);
});

test('on macOS the system buttons sit over the app, which leaves them room', async ({ page }) => {
  await onPlatform(page, 'MacIntel');
  await expect(page.getByRole('group', { name: 'Ventana' })).toHaveCount(0);
  const calls = await page.evaluate(() => (window as any).__windowCalls);
  expect(calls).toContainEqual({ name: 'set_title_bar_style', value: 'overlay' });
  await expect(page.locator('aside header')).toHaveCSS('padding-left', '90px');
  await page.keyboard.press('Control+Shift+e');
  await expect(page.locator('main > .bar')).toHaveCSS('padding-left', '76px');
});

test('a long error shows its first line and folds the rest', async ({ page }) => {
  await page.evaluate(() => {
    const long = 'No se pudo leer la plantilla\n' + 'detalle técnico '.repeat(20);
    const internals = (window as any).__TAURI_INTERNALS__;
    const invoke = internals.invoke;
    internals.invoke = (cmd: string, args: unknown) => (cmd === 'create_note' ? Promise.reject(long) : invoke(cmd, args));
  });
  await page.keyboard.press('Control+n');
  await page.getByRole('form').getByRole('textbox').fill('Nueva');
  await page.keyboard.press('Enter');
  const notice = page.getByRole('group', { name: 'Aviso' });
  await expect(notice.getByRole('status')).toHaveText('No se pudo leer la plantilla');
  await notice.getByRole('button', { name: 'Ver detalles' }).click();
  await expect(notice.locator('pre')).toContainText('detalle técnico detalle técnico');
  await notice.getByTitle('Cerrar el aviso').click();
  await expect(notice).toHaveCount(0);
});

test('a long export shows how far it has gone', async ({ page }) => {
  await page.evaluate(() => ((window as any).__slowExport = 1500));
  await open(page, 'Inicio');
  await exportAs(page, 'PDF');
  await scope(page, 'Vault');
  await page.getByRole('button', { name: 'Exportar', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Exportar' });
  await expect(dialog.getByRole('progressbar')).toBeVisible();
  await expect(dialog).toContainText('Generando el documento…');
  await expect(page.getByRole('dialog', { name: 'Documento exportado' })).toBeVisible();
});

async function trashFromTree(page: Page, name: string) {
  await page.locator('aside').getByRole('button', { name, exact: true }).click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Enviar a la papelera' }).click();
}

test('a deleted note can be brought back from the notice', async ({ page }) => {
  await open(page, 'Otra');
  await typeInEditor(page, ' última frase');
  await trashFromTree(page, 'Otra');
  await expect(page.locator('aside').getByRole('button', { name: 'Otra', exact: true })).toHaveCount(0);
  await expect(page.locator('[role=tab]')).toHaveCount(0);
  const notice = page.getByRole('group', { name: 'Aviso' });
  await expect(notice.getByRole('status')).toHaveText('«Otra» enviado a la papelera');
  await notice.getByRole('button', { name: 'Deshacer' }).click();
  await expect(page.locator('aside').getByRole('button', { name: 'Otra', exact: true })).toBeVisible();
  // The tab comes back with the text saved before deleting.
  await expect(page.locator('.cm-content')).toContainText('# Otra última frase');
  expect(await page.evaluate(() => (window as any).__trashed)).toBeUndefined();
});

test('a deletion goes to the trash once its notice goes', async ({ page }) => {
  await trashFromTree(page, 'Otra');
  await page.getByRole('group', { name: 'Aviso' }).getByTitle('Cerrar el aviso').click();
  await expect.poll(() => page.evaluate(() => (window as any).__trashed)).toEqual(['Otra.md']);
  // A second deletion finishes the first one waiting.
  await trashFromTree(page, 'Rara');
  await trashFromTree(page, 'Propia');
  await expect.poll(() => page.evaluate(() => (window as any).__trashed)).toEqual(['Otra.md', 'Rara.md']);
});

test('the interface zooms with Ctrl + and Ctrl −, and remembers it', async ({ page }) => {
  await page.keyboard.press('Control+=');
  await page.keyboard.press('Control+=');
  await expect(page.getByRole('status')).toHaveText('Zoom 120 %');
  expect(await page.evaluate(() => (window as any).__zoom)).toBe(1.2);
  await page.keyboard.press('Control+-');
  await expect.poll(() => page.evaluate(() => (window as any).__zoom)).toBe(1.1);
  await page.reload();
  await expect.poll(() => page.evaluate(() => (window as any).__zoom)).toBe(1.1);
  await page.keyboard.press('Control+0');
  await expect(page.getByRole('status')).toHaveText('Zoom 100 %');
});

test('text size and line width change notes on screen but not exports', async ({ page }) => {
  await open(page, 'Inicio');
  await page.getByTitle('Ajustes y MCP').click();
  const settings = page.getByRole('dialog', { name: 'Ajustes' });
  await settings.getByRole('navigation').getByRole('button', { name: 'Apariencia' }).click();
  await settings.getByLabel('Tamaño del texto de las notas').selectOption({ label: 'Grande' });
  await settings.getByLabel('Ancho de línea').selectOption({ label: 'Ancho' });
  await page.keyboard.press('Escape');
  await expect(prose(page)).toHaveCSS('font-size', '18.4px');
  await expect(prose(page)).toHaveCSS('max-width', '960px');
  await expect(page.locator('.cm-scroller').first()).toHaveCSS('font-size', '15.525px');
  await exportAs(page, 'HTML');
  await expect(page.getByRole('dialog', { name: 'Exportar' }).locator('.html article')).toHaveCSS('font-size', '16px');
});

/** A note full of links into the long note of `sections`. */
async function linking(page: Page) {
  await sections(page);
  await page.evaluate(() => {
    const filler = (n: number) => Array.from({ length: n }, (_, i) => `Párrafo ${i + 1}.`).join('\n\n');
    const long = `---\ntema: claro\n---\n# Larga\n\n${filler(30)}\n\nLa frase clave. ^clave\n\n## Segunda parte\n\n${filler(30)}\n\n### Detalle [[Destino|el destino]]\n\nFin.\n`;
    (window as any).__test.externalWrite('a', 'Larga.md', long);
    const links = '# Fuente\n\n[[Larga#Segunda parte]] y [[Larga^clave]] y [[Larga#No existe]] y [md](Larga.md#segunda-parte)\n\n[[#Abajo]]\n\n' + 'relleno\n\n'.repeat(40) + '## Abajo\n';
    (window as any).__test.externalWrite('a', 'Fuente.md', links);
  });
  await expect(page.locator('aside').getByRole('button', { name: 'Fuente', exact: true })).toBeVisible();
  await page.locator('aside').getByRole('button', { name: 'Fuente', exact: true }).click();
}

test('a link to a heading opens the note at that heading', async ({ page }) => {
  await linking(page);
  await prose(page).getByText('Larga#Segunda parte').click();
  await expect(page.locator('main footer')).toContainText('Trabajo / Larga.md');
  await expect(page.locator('.cm-activeLine')).toHaveText('## Segunda parte');
  await expect(page.locator('.cm-activeLine')).toBeInViewport();
});

test('links reach blocks, slugs and headings of the same note', async ({ page }) => {
  await linking(page);
  await prose(page).getByText('Larga^clave').click();
  await expect(page.locator('.cm-activeLine')).toHaveText('La frase clave. ^clave');
  await page.getByRole('tab', { name: /Fuente/ }).click();
  await prose(page).getByText('md', { exact: true }).click();
  await expect(page.locator('.cm-activeLine')).toHaveText('## Segunda parte');
  await page.getByRole('tab', { name: /Fuente/ }).click();
  await prose(page).getByText('#Abajo', { exact: true }).click();
  await expect(page.locator('.cm-activeLine')).toHaveText('## Abajo');
});

test('a missing heading says so and the editor follows links with Ctrl+click', async ({ page }) => {
  await linking(page);
  await prose(page).getByText('Larga#No existe').click();
  await expect(page.getByRole('status')).toHaveText('No se encuentra «No existe» en «Larga»');
  await page.getByRole('tab', { name: /Fuente/ }).click();
  await page.locator('.cm-wikilink', { hasText: 'Larga#Segunda parte' }).click({ modifiers: ['ControlOrMeta'] });
  await expect(page.locator('.cm-activeLine')).toHaveText('## Segunda parte');
});

test('typing [[note# suggests its headings', async ({ page }) => {
  await linking(page);
  await typeInEditor(page, '\n[[Larga#Seg');
  await expect(page.locator('.cm-tooltip-autocomplete')).toContainText('Segunda parte');
  // The editor ignores Enter for a moment after a suggestion appears, so it is never taken by accident.
  await page.waitForTimeout(150);
  await page.keyboard.press('Enter');
  await expect(page.locator('.cm-activeLine')).toHaveText('[[Larga#Segunda parte]]');
});

const CALLOUTS = '# Avisos\n\n> [!warning] Hielo fino\n> No cruzar de noche.\n\n> [!tip]\n> Llevar crampones.\n\n> [!faq]- Plegado\n> Oculto al abrir.\n\n> [!note] **Negrita** y más\n> Cuerpo.\n\n> Una cita normal.\n';

async function calloutNote(page: Page) {
  await page.evaluate((text) => (window as any).__test.externalWrite('a', 'Avisos.md', text), CALLOUTS);
  await page.locator('aside').getByRole('button', { name: 'Avisos', exact: true }).click();
}

test('callouts show as coloured boxes with their title', async ({ page }) => {
  await calloutNote(page);
  const boxes = prose(page).locator('.callout');
  await expect(boxes).toHaveCount(4);
  await expect(boxes.locator('.callout-title')).toHaveText(['Hielo fino', 'Consejo', 'Plegado', 'Negrita y más']);
  await expect(boxes.nth(0)).toHaveAttribute('data-callout', 'warning');
  await expect(boxes.nth(2)).toHaveAttribute('data-callout', 'important');
  await expect(boxes.nth(0).locator('.callout-body')).toHaveText('No cruzar de noche.');
  await expect(boxes.nth(1).locator('.callout-body')).toHaveText('Llevar crampones.');
  // A folded one opens on a click.
  await expect(boxes.nth(2).getByText('Oculto al abrir.')).toBeHidden();
  await boxes.nth(2).locator('summary').click();
  await expect(boxes.nth(2).getByText('Oculto al abrir.')).toBeVisible();
  await expect(prose(page).locator('blockquote')).toHaveText('Una cita normal.');
  await expect(page.locator('.cm-line.cm-v-callout')).toHaveCount(0);
  await page.getByTitle('Visual', { exact: true }).click();
  await expect(page.locator('.cm-line.cm-v-callout-warning').first()).toBeVisible();
});

test('an HTML export keeps callouts and opens folded ones', async ({ page }) => {
  await calloutNote(page);
  await exportAs(page, 'HTML');
  await page.getByRole('button', { name: 'Exportar', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Documento exportado' })).toBeVisible();
  const html = await page.evaluate(() => (window as any).__exported.text);
  expect(html).toContain('data-callout="warning"');
  expect(html).toMatch(/<details[^>]*open/);
  expect(html).toContain('.callout[data-callout');
});

/** Pastes into the editor as the system would, with HTML and plain text. `plain` first presses Ctrl+Shift+V. */
async function paste(page: Page, html: string, text: string, plain = false) {
  await page.locator('.cm-content').click();
  await page.keyboard.press('ControlOrMeta+End');
  await page.evaluate(([html, text, plain]) => {
    const content = document.querySelector('.cm-content')!;
    if (plain) content.dispatchEvent(new KeyboardEvent('keydown', { key: 'V', ctrlKey: true, shiftKey: true, bubbles: true }));
    const data = new DataTransfer();
    data.setData('text/html', html as string);
    data.setData('text/plain', text as string);
    content.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
  }, [html, text, plain] as const);
}

/** What the pasted note holds once it has been saved. */
async function editorDoc(page: Page) {
  await expect(page.locator('main footer')).toContainText('Guardado', { timeout: 3000 });
  return disk(page, 'b', 'Otra.md');
}

test('pasting from a web page gives clean Markdown', async ({ page }) => {
  await open(page, 'Otra');
  const html = '<h2>Ruta</h2><p>Texto <strong>fuerte</strong> y <a href="https://e.com">enlace</a>.</p><ul><li>uno</li><li>dos</li></ul><table><tr><th>A</th><th>B</th></tr><tr><td>1</td><td>2</td></tr></table><script>window.pwned=1</script>';
  await paste(page, html, 'Ruta Texto fuerte y enlace. uno dos A B 1 2');
  const text = await editorDoc(page);
  expect(text).toContain('## Ruta\n\nTexto **fuerte** y [enlace](https://e.com).');
  expect(text).toContain('- uno\n- dos');
  expect(text).toMatch(/\| A +\| B +\|/);
  expect(text).not.toContain('pwned');
  expect(await page.evaluate(() => (window as any).pwned)).toBeUndefined();
});

test('Google Docs bold and italics survive, and code pastes as it is', async ({ page }) => {
  await open(page, 'Otra');
  const docs = '<meta charset="utf-8"><b style="font-weight:normal;" id="docs-internal-guid-1"><span style="font-weight:700">negrita</span><span> y </span><span style="font-style:italic">cursiva</span></b>';
  await paste(page, docs, 'negrita y cursiva');
  expect(await editorDoc(page)).toContain('**negrita** y *cursiva*');
  const code = '<div style="color:#ccc"><span style="color:#569cd6">const</span> a = 1 * 2_000;</div>';
  await paste(page, code, '\nconst a = 1 * 2_000;');
  expect(await editorDoc(page)).toContain('const a = 1 * 2_000;');
});

test('Ctrl+Shift+V pastes plain text', async ({ page }) => {
  await open(page, 'Otra');
  await paste(page, '<p><strong>fuerte</strong></p>', 'fuerte', true);
  const text = await editorDoc(page);
  expect(text).toContain('fuerte');
  expect(text).not.toContain('**');
});

/** Pastes or drops an image file into the editor, as the system would. */
async function giveImage(page: Page, how: 'paste' | 'drop', name: string) {
  await page.locator('.cm-content').click();
  await page.keyboard.press('ControlOrMeta+End');
  await page.evaluate(([how, name]) => {
    const content = document.querySelector('.cm-content')!;
    const data = new DataTransfer();
    data.items.add(new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], name, { type: 'image/png' }));
    const box = content.getBoundingClientRect();
    const event =
      how === 'paste'
        ? new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true })
        : new DragEvent('drop', { dataTransfer: data, bubbles: true, cancelable: true, clientX: box.left + 10, clientY: box.bottom - 5 });
    content.dispatchEvent(event);
  }, [how, name] as const);
}

test('a pasted screenshot is saved in the vault and linked', async ({ page }) => {
  await open(page, 'dir');
  await open(page, 'Destino');
  await giveImage(page, 'paste', 'image.png');
  // Saving the image takes a moment, and the note is saved after it.
  await expect.poll(() => disk(page, 'a', 'dir/Destino.md'), { timeout: 5000 }).toMatch(/!\[\]\(\.\.\/adjuntos\/pegado-\d{4}-\d{2}-\d{2}-\d{6}\.png\)/);
  await expect(page.locator('aside').getByRole('button', { name: 'adjuntos', exact: true })).toBeVisible();
});

test('dropped images keep their name, never replace a file and can go beside the note', async ({ page }) => {
  await page.getByTitle('Ajustes y MCP').click();
  await page.getByRole('dialog', { name: 'Ajustes' }).getByLabel('Imágenes pegadas o arrastradas').selectOption('note');
  await page.keyboard.press('Escape');
  await open(page, 'dir');
  await open(page, 'Destino');
  await giveImage(page, 'drop', 'mapa (ruta).png');
  await giveImage(page, 'drop', 'mapa (ruta).png');
  await expect.poll(() => disk(page, 'a', 'dir/Destino.md'), { timeout: 5000 }).toContain('-2.png');
  const text = await disk(page, 'a', 'dir/Destino.md');
  expect(text).toContain('![](mapa%20%28ruta%29.png)');
  expect(text).toContain('![](mapa%20%28ruta%29-2.png)');
  await expect(prose(page).locator('img')).toHaveCount(2);
});

async function runAction(page: Page, words: string) {
  await page.keyboard.press('Control+Shift+p');
  await page.keyboard.type(words);
  await page.keyboard.press('Enter');
}

test('a note saved as a template fills in a new note', async ({ page }) => {
  await page.evaluate(() => (window as any).__test.externalWrite('a', 'Modelo.md', '# {{titulo}}\n\nVault: {{vault}}\nFecha: {{fecha}}\nQueda: {{desconocido}}\n'));
  await open(page, 'Modelo');
  await runAction(page, 'guardar como plantilla');
  const form = page.getByRole('form', { name: 'Nombre de la plantilla' });
  await form.getByRole('textbox').fill('Acta');
  await form.getByRole('button', { name: 'Guardar' }).click();
  await expect(page.getByRole('status')).toHaveText('Plantilla «Acta» guardada');

  await runAction(page, 'desde plantilla');
  const picker = page.getByRole('dialog', { name: 'Nueva nota desde plantilla' });
  await expect(picker.getByRole('option')).toHaveText(['Nota en blanco', 'Acta']);
  await picker.getByRole('button', { name: 'Acta', exact: true }).click();
  await page.getByRole('form', { name: 'Nombre de la nota' }).getByRole('textbox').fill('Reunión lunes');
  await page.keyboard.press('Enter');
  await expect(page.locator('main footer')).toContainText('Trabajo / Reunión lunes.md');
  const text = await disk(page, 'a', 'Reunión lunes.md');
  const today = await page.evaluate(() => new Date().toLocaleDateString('es'));
  expect(text).toBe(`# Reunión lunes\n\nVault: Trabajo\nFecha: ${today}\nQueda: {{desconocido}}\n`);
});

test('the template list offers a blank note and deletes templates', async ({ page }) => {
  await page.locator('aside').getByRole('button', { name: 'Trabajo', exact: true }).click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Nueva nota desde plantilla' }).click();
  const picker = page.getByRole('dialog', { name: 'Nueva nota desde plantilla' });
  await expect(picker).toContainText('Este vault aún no tiene plantillas');
  // Enter takes the first option, a blank note.
  await page.keyboard.press('Enter');
  await page.getByRole('form', { name: 'Nombre de la nota' }).getByRole('textbox').fill('Vacía');
  await page.keyboard.press('Enter');
  await expect(page.locator('main footer')).toContainText('Trabajo / Vacía.md');
  expect(await disk(page, 'a', 'Vacía.md')).toBe('');
  await page.evaluate(() => (window as any).__TAURI_INTERNALS__.invoke('save_note_template', { id: 'a', name: 'Ficha', content: 'x' }));
  await runAction(page, 'desde plantilla');
  await picker.getByTitle('Borrar la plantilla «Ficha»').click();
  await page.getByRole('form', { name: '¿Borrar la plantilla «Ficha»?' }).getByRole('button', { name: 'Eliminar' }).click();
  await expect(picker.getByRole('option')).toHaveText(['Nota en blanco']);
});

const ANIMATED = '# Flujo\n\n```mermaid animado\nflowchart LR\n  a --> b\n```\n\n```mermaid\nflowchart LR\n  c e1@--> d\n  e1@{ animate: true }\n```\n';

async function animatedNote(page: Page) {
  await page.evaluate((text) => (window as any).__test.externalWrite('a', 'Flujo.md', text), ANIMATED);
  await page.locator('aside').getByRole('button', { name: 'Flujo', exact: true }).click();
  await expect(prose(page).locator('.diagram svg')).toHaveCount(2);
}

const lineAnimation = (page: Page) =>
  prose(page).locator('.diagram.animated polyline.edge').first().evaluate((el) => getComputedStyle(el).animationName);

test('diagrams marked animado flow on screen, and Mermaid’s own animation draws', async ({ page }) => {
  await animatedNote(page);
  expect(await lineAnimation(page)).toBe('umd-flow');
  // `e1@{ animate: true }` goes to the official renderer, which draws it.
  await expect(prose(page).locator('.diagram').nth(1).locator('path').first()).toBeAttached();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  expect(await lineAnimation(page)).toBe('none');
});

test('an HTML export keeps the animation; the builder can turn it on', async ({ page }) => {
  await animatedNote(page);
  await exportAs(page, 'HTML');
  await page.getByRole('button', { name: 'Exportar', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Documento exportado' })).toBeVisible();
  const html = await page.evaluate(() => (window as any).__exported.text);
  expect(html).toContain('class="diagram animated"');
  expect(html).toContain('@keyframes umd-flow');
  await page.getByRole('dialog', { name: 'Documento exportado' }).getByTitle('Cerrar').click();

  await page.getByTitle('Editar', { exact: true }).click();
  await page.locator('.cm-line', { hasText: 'c e1@--> d' }).click();
  await page.getByRole('button', { name: 'Diagrama', exact: true }).click();
  const builder = page.getByRole('dialog', { name: 'Editar diagrama' });
  await builder.getByText('Apariencia de este diagrama').click();
  await builder.getByLabel('Animar conexiones').check();
  await expect(builder).toContainText('En Word, PDF e imágenes el diagrama sale quieto.');
  await builder.getByRole('button', { name: 'Actualizar' }).click();
  await expect(page.locator('.cm-content')).toContainText('```mermaid animado');
});

test('settings change MCP access and give a valid Windows config', async ({ page }) => {
  await page.getByTitle('Ajustes y MCP').click();
  await page.getByRole('dialog', { name: 'Ajustes' }).getByRole('navigation').getByRole('button', { name: 'Vaults' }).click();
  const group = page.getByRole('group', { name: 'Acceso MCP de Trabajo' });
  await group.getByRole('button', { name: 'Lectura y escritura' }).click();
  await expect(group.getByRole('button', { name: 'Lectura y escritura' })).toHaveClass(/on/);

  await page.getByRole('dialog', { name: 'Ajustes' }).getByRole('navigation').getByRole('button', { name: 'Inteligencia artificial' }).click();
  await page.getByRole('button', { name: 'Claude Desktop' }).click();
  const config = JSON.parse((await page.locator('.code pre').textContent())!);
  expect(config.mcpServers.ultimatemd.command).toBe('C:\\Program Files\\UltimateMD\\ultimatemd-mcp.exe');
});

test('every theme meets contrast targets', async () => {
  for (const t of THEMES) {
    const c = t.colors;
    const min = t.id === 'contraste' ? 7 : 4.5;
    const surfaces = { bg: c.bg, panel: c.panel, raised: c.raised };
    for (const [surface, color] of Object.entries(surfaces)) {
      for (const name of ['text', 'text2', 'text3', 'accentText', 'danger'] as const) {
        expect(contrast(c[name], color), `${t.id}: ${name} on ${surface}`).toBeGreaterThanOrEqual(min);
      }
    }
    expect(contrast(c.onAccent, c.accent), `${t.id}: on accent`).toBeGreaterThanOrEqual(min);
    expect(contrast(c.text, c.warn), `${t.id}: warning`).toBeGreaterThanOrEqual(min);
    const selected = mix(c.panel, c.accent, 0.15);
    expect(contrast(c.accentText, selected), `${t.id}: selected row`).toBeGreaterThanOrEqual(min);
    for (const name of ['synString', 'synKeyword', 'synNumber', 'synAttr'] as const) {
      expect(contrast(c[name], c.bg), `${t.id}: ${name}`).toBeGreaterThanOrEqual(min);
      expect(contrast(c[name], c.panel), `${t.id}: ${name} on code`).toBeGreaterThanOrEqual(min);
    }
  }
});

test('changing theme restyles the app and keeps the edit in progress', async ({ page }) => {
  await open(page, 'Inicio');
  await typeInEditor(page, 'en curso');
  await expect(prose(page).locator('.diagram > svg')).toBeVisible();
  await page.getByTitle('Ajustes y MCP').click();
  await page.getByRole('dialog', { name: 'Ajustes' }).getByRole('navigation').getByRole('button', { name: 'Apariencia' }).click();
  await page.getByRole('button', { name: /Medianoche/ }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'medianoche');
  await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(15, 22, 38)');
  await expect(prose(page).locator('h1')).toHaveCSS('color', 'rgb(228, 233, 242)');
  await page.getByTitle('Cerrar', { exact: true }).click();
  await expect(page.locator('.cm-content')).toContainText('en curso');

  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'medianoche');
});

test('following the system uses the theme chosen for each mode', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'claro');
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'oscuro');
  await page.getByTitle('Ajustes y MCP').click();
  await page.getByRole('dialog', { name: 'Ajustes' }).getByRole('navigation').getByRole('button', { name: 'Apariencia' }).click();
  await page.getByLabel('Modo oscuro').selectOption('bosque');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'bosque');
});

const openFiles = (page: Page, ...paths: string[]) => page.evaluate((p) => (window as any).__test.openFiles(p), paths);

test('a file outside any vault opens as a loose file and can be edited', async ({ page }) => {
  await openFiles(page, '/fuera/nota.md');
  await expect(page.locator('main footer')).toContainText('/fuera / nota.md');
  await expect(prose(page).locator('h1')).toHaveText('Suelto');
  await typeInEditor(page, 'más');
  await expect.poll(() => disk(page, 'loose-nota.md', 'nota.md')).toContain('más');
});

test('opening the same file twice keeps one tab', async ({ page }) => {
  await openFiles(page, '/fuera/nota.md');
  await expect(page.locator('[role=tab]')).toHaveCount(1);
  await openFiles(page, '/fuera/nota.md');
  await page.waitForTimeout(100);
  await expect(page.locator('[role=tab]')).toHaveCount(1);
});

test('a file inside a vault opens as part of that vault', async ({ page }) => {
  await openFiles(page, '/v/Trabajo/Inicio.md');
  await expect(page.locator('main footer')).toContainText('Trabajo / Inicio.md');
});

test('a missing file reports an error without leaving a broken tab', async ({ page }) => {
  await openFiles(page, '/fuera/borrado.md');
  await expect(page.getByRole('status')).toContainText('No se pudo abrir');
  await expect(page.locator('[role=tab]')).toHaveCount(0);
});

test('files passed at startup are opened', async ({ page }) => {
  await page.addInitScript(() => ((window as any).__pending = ['/fuera/inicio.md']));
  await page.reload();
  await expect(page.locator('main footer')).toContainText('/fuera / inicio.md');
});

test('a loose file can become part of a vault', async ({ page }) => {
  await openFiles(page, '/fuera/nota.md');
  await page.getByRole('button', { name: 'Abrir la carpeta como vault' }).click();
  await expect(page.locator('aside')).toContainText('fuera');
});

test('settings explain how to set the default app on Windows', async ({ page }) => {
  await page.getByTitle('Ajustes y MCP').click();
  await expect(page.getByRole('button', { name: 'Abrir aplicaciones predeterminadas' })).toBeVisible();
});

async function exportAs(page: Page, format: string) {
  await page.keyboard.press('Control+e');
  await page.getByRole('group', { name: 'Formato' }).getByRole('button', { name: format }).click();
}

/** Goes to a step of the export dialog. */
const step = (page: Page, name: string) => page.getByRole('navigation', { name: 'Pasos' }).getByRole('button', { name }).click();

/** Exports and waits for the card that says it is done. */
async function exportNow(page: Page) {
  await page.getByRole('button', { name: 'Exportar', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Documento exportado' })).toBeVisible();
}

test('before exporting, the dialog lists what would come out wrong and leads to it', async ({ page }) => {
  await page.evaluate(() => {
    (window as any).__test.externalWrite('a', 'Revisar.md', '# Uno\n\n### Tres\n\n![[nada.png]] ![[imagen.png]]\n\n[[Ninguna]] [[Destino]]\n\n```mermaid\nflowchar LR\n A-->B\n```\n');
  });
  await open(page, 'Revisar');
  await page.keyboard.press('Control+e');
  await step(page, 'Contenido');
  const review = page.getByRole('region', { name: 'Antes de exportar' });
  await expect(review).toContainText('4 cosas que conviene revisar', { timeout: 15_000 });
  await expect(review.getByRole('listitem')).toHaveText([
    '«Tres» salta del nivel 1 al 3. Revisar · línea 3',
    'Falta la imagen «nada.png». Revisar · línea 5',
    'El enlace a «Ninguna» no lleva a ninguna parte. Revisar · línea 7',
    /^Un diagrama no se puede dibujar: No se reconoce el tipo de diagrama.*Revisar · línea 10$/,
  ]);
  await review.getByRole('button', { name: /Ninguna/ }).click();
  await expect(page.getByRole('dialog', { name: 'Exportar' })).toBeHidden();
  await expect(page.locator('main footer')).toContainText('Trabajo / Revisar.md');
});

test('a note with nothing to fix says so before exporting', async ({ page }) => {
  await open(page, 'Otra');
  await page.keyboard.press('Control+e');
  await step(page, 'Contenido');
  await expect(page.getByRole('region', { name: 'Antes de exportar' })).toContainText('Todo en orden');
});

test('export to HTML gives a self-contained page in the print look', async ({ page }) => {
  await page.getByTitle('Ajustes y MCP').click();
  await page.getByRole('dialog', { name: 'Ajustes' }).getByRole('navigation').getByRole('button', { name: 'Apariencia' }).click();
  await page.getByRole('button', { name: /Medianoche/ }).click();
  await page.getByTitle('Cerrar', { exact: true }).click();
  await open(page, 'Inicio');
  await exportAs(page, 'HTML');
  await exportNow(page);
  const { name, text } = await page.evaluate(() => (window as any).__exported);
  expect(name).toBe('Inicio.html');
  expect(text).toContain('<svg');
  expect(text).toContain('--bg:#fbfaf7');
  expect(text).not.toContain('<script');
  expect(text).not.toContain('onerror');
});

test('export to Word sends the template and rendered diagrams', async ({ page }) => {
  await open(page, 'Inicio');
  await exportAs(page, 'Word');
  await step(page, 'Aspecto');
  await page.getByLabel('Plantilla').selectOption('Corporativa');
  await exportNow(page);
  const args = await page.evaluate(() => (window as any).__docx);
  expect(args.template).toBe('Corporativa');
  expect(args.diagrams).toHaveLength(1);
  expect(args.diagrams[0].slice(1, 4)).toEqual([0x50, 0x4e, 0x47]);
});

test('export to PDF writes the file directly, with no print dialog', async ({ page }) => {
  await page.evaluate(() => {
    window.print = () => {
      (window as any).__printed = true;
    };
  });
  await open(page, 'Inicio');
  await exportAs(page, 'PDF');
  await expect(page.getByAltText('Página 1')).toBeVisible();
  await exportNow(page);
  const plan = await page.evaluate(() => (window as any).__pdf);
  expect(plan.sections).toEqual([{ kind: 'note', path: 'Inicio.md', shift: 0, pageBreak: false }]);
  expect(await page.evaluate(() => (window as any).__printed)).toBeUndefined();
  expect(plan.archive).toBe(false);
});

test('once exported, a card shows the first page and opens the file or its folder', async ({ page }) => {
  await open(page, 'Inicio');
  await exportAs(page, 'PDF');
  await expect(page.getByAltText('Página 1')).toBeVisible();
  await exportNow(page);
  const done = page.getByRole('dialog', { name: 'Documento exportado' });
  await expect(done).toContainText('Inicio.pdf');
  await expect(done.locator('.thumb img')).toHaveCount(1);
  await done.getByRole('button', { name: 'Abrir', exact: true }).click();
  expect(await page.evaluate(() => (window as any).__openedExport)).toBe('/exportados/Inicio.pdf');
  await done.getByRole('button', { name: 'Mostrar en la carpeta' }).click();
  expect(await page.evaluate(() => (window as any).__revealedExport)).toBe('/exportados/Inicio.pdf');
  await done.getByRole('button', { name: 'Exportar otra vez' }).click();
  await expect(page.getByRole('dialog', { name: 'Exportar' })).toBeVisible();
});

test('the steps of the export dialog show the warnings from any step', async ({ page }) => {
  await open(page, 'Inicio');
  await page.keyboard.press('Control+e');
  await expect(page.getByRole('navigation', { name: 'Pasos' }).getByRole('button', { name: 'Formato' })).toHaveAttribute('aria-current', 'step');
  await page.getByRole('button', { name: '1 aviso' }).click();
  await expect(page.getByRole('region', { name: 'Antes de exportar' })).toContainText('El enlace a «Falta» no lleva a ninguna parte.');
  await page.getByRole('button', { name: 'Siguiente' }).click();
  await expect(page.getByLabel('Portada e índice')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Siguiente' })).toHaveCount(0);
});

test('a PDF can be written for archiving, and the choice is remembered', async ({ page }) => {
  await open(page, 'Inicio');
  await exportAs(page, 'PDF');
  await page.getByLabel('Para archivar (PDF/A)').check();
  await exportNow(page);
  expect((await page.evaluate(() => (window as any).__pdf)).archive).toBe(true);
  await page.getByRole('dialog', { name: 'Documento exportado' }).getByTitle('Cerrar').click();
  await page.keyboard.press('Control+e');
  await expect(page.getByLabel('Para archivar (PDF/A)')).toBeChecked();
});

async function scope(page: Page, name: string) {
  await step(page, 'Contenido');
  await page.getByRole('group', { name: 'Alcance' }).getByRole('button', { name }).click();
}

async function pdfPlan(page: Page) {
  await exportNow(page);
  return page.evaluate(() => (window as any).__pdf);
}

test('exporting a vault orders notes and titles folders by level', async ({ page }) => {
  await open(page, 'Inicio');
  await exportAs(page, 'PDF');
  await scope(page, 'Vault');
  const plan = await pdfPlan(page);
  expect(plan.title).toBe('Trabajo');
  expect(plan.fixedTitle).toBe(true);
  expect(plan.cover).toBe(true);
  expect(plan.sections.map((s: any) => [s.kind, s.text ?? s.path, s.kind === 'note' ? s.shift : s.level])).toEqual([
    ['note', 'D2.md', 0],
    ['note', 'Inicio.md', 0],
    ['heading', 'dir', 1],
    ['note', 'dir/Destino.md', 1],
    ['heading', 'sub', 2],
    ['note', 'dir/sub/Hondo.md', 2],
  ]);
  expect(plan.sections.map((s: any) => s.text)).not.toContain('vacia');
});

test('each folder level can be configured on its own', async ({ page }) => {
  await open(page, 'Inicio');
  await exportAs(page, 'PDF');
  await scope(page, 'Vault');
  await page.getByLabel('Nivel 1', { exact: true }).selectOption('');
  await page.getByLabel('Nivel 2', { exact: true }).selectOption('heading:3');
  await page.getByRole('checkbox', { name: 'Empezar en página nueva' }).check();
  await page.getByRole('checkbox', { name: 'Usar el nombre de cada nota como título' }).check();
  const { sections } = await pdfPlan(page);
  expect(sections.some((s: any) => s.text === 'dir')).toBe(false);
  expect(sections.find((s: any) => s.text === 'sub')).toMatchObject({ level: 3, pageBreak: true });
  expect(sections.find((s: any) => s.text === 'Hondo')).toMatchObject({ kind: 'heading', level: 4 });
  expect(sections.find((s: any) => s.path === 'dir/sub/Hondo.md').shift).toBe(4);
});

test('a folder can be exported on its own', async ({ page }) => {
  await open(page, 'Inicio');
  await exportAs(page, 'PDF');
  await scope(page, 'Carpeta');
  await page.getByLabel('Nivel 0', { exact: true }).selectOption('heading:1');
  const plan = await pdfPlan(page);
  expect(plan.title).toBe('dir');
  expect(plan.sections[0]).toMatchObject({ kind: 'heading', text: 'dir', level: 1 });
  expect(plan.sections[1]).toMatchObject({ path: 'dir/Destino.md', shift: 1 });
});

test('the export dialog remembers the last options of each vault', async ({ page }) => {
  await open(page, 'Inicio');
  await exportAs(page, 'Word');
  await step(page, 'Aspecto');
  await page.getByLabel('Plantilla').selectOption('Corporativa');
  await scope(page, 'Vault');
  await page.getByLabel('Nivel 2', { exact: true }).selectOption('heading:3');
  await page.getByRole('checkbox', { name: 'Usar el nombre de cada nota como título' }).check();
  await exportNow(page);
  await page.getByRole('dialog', { name: 'Documento exportado' }).getByTitle('Cerrar').click();

  await page.keyboard.press('Control+e');
  const pressed = (group: string) => page.getByRole('group', { name: group }).locator('button.on');
  await expect(pressed('Formato')).toHaveText(/^Word/);
  await step(page, 'Aspecto');
  await expect(page.getByLabel('Plantilla')).toHaveValue('Corporativa');
  await step(page, 'Contenido');
  await expect(pressed('Alcance')).toHaveText('Vault');
  await expect(page.getByLabel('Nivel 2', { exact: true })).toHaveValue('heading:3');
  await expect(page.getByRole('checkbox', { name: 'Usar el nombre de cada nota como título' })).toBeChecked();
  await page.getByRole('dialog', { name: 'Exportar' }).getByTitle('Cerrar').click();

  // Another vault starts from the defaults.
  await open(page, 'Otra');
  await page.keyboard.press('Control+e');
  await expect(pressed('Formato')).toHaveText(/^PDF/);
  await step(page, 'Contenido');
  await expect(pressed('Alcance')).toHaveText('Esta nota');
});

test('word offers the example template, its styles and a preview of the file', async ({ page }) => {
  await open(page, 'Inicio');
  await exportAs(page, 'Word');
  await step(page, 'Aspecto');
  await expect(page.getByLabel('Plantilla')).toHaveValue('Ejemplo');
  await expect(page.getByRole('button', { name: 'Eliminar' })).toHaveCount(0);
  await scope(page, 'Vault');
  await expect(page.getByLabel('Nivel 1', { exact: true }).locator('option', { hasText: 'Destacado' })).toHaveCount(1);
  await page.getByLabel('Nivel 1', { exact: true }).selectOption('style:Destacado');
  await expect(page.locator('.sheet section')).toContainText('Documento de prueba');
  await exportNow(page);
  const plan = await page.evaluate(() => (window as any).__docx);
  expect(plan.sections.find((s: any) => s.text === 'dir')).toMatchObject({ style: 'Destacado' });
});

test('a loose file can only be exported on its own', async ({ page }) => {
  await openFiles(page, '/fuera/nota.md');
  await expect(page.locator('main footer')).toContainText('nota.md');
  await page.keyboard.press('Control+e');
  await step(page, 'Contenido');
  await expect(page.getByRole('group', { name: 'Alcance' }).getByRole('button', { name: 'Vault' })).toBeDisabled();
});

const noteBackground = (page: Page) => page.locator('.scroll').evaluate((el) => getComputedStyle(el).backgroundColor);

test('the vault theme applies to its notes but not to the interface', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await open(page, 'Otra');
  await expect(page.locator('.scroll')).toHaveAttribute('data-note-theme', 'mar');
  expect(await noteBackground(page)).toBe('rgb(224, 240, 255)');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'oscuro');
  await expect(page.locator('aside')).toHaveCSS('background-color', 'rgb(30, 29, 26)');
});

test('a note theme beats the vault theme', async ({ page }) => {
  await open(page, 'Propia');
  await expect(page.locator('.scroll')).toHaveAttribute('data-note-theme', 'sepia');
});

test('an unknown note theme falls back to the vault theme', async ({ page }) => {
  await open(page, 'Rara');
  await expect(page.locator('.scroll')).toHaveAttribute('data-note-theme', 'mar');
});

test('notes without any theme follow the application', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await open(page, 'Inicio');
  await expect(page.locator('.scroll')).toHaveAttribute('data-note-theme', 'claro');
});

test('diagrams can use their own theme and are redrawn when it changes', async ({ page }) => {
  await open(page, 'Inicio');
  const svg = prose(page).locator('.diagram > svg');
  await expect(svg).toBeVisible();
  // Outer HTML: the renderer keeps its colours on the svg element itself.
  const drawn = () => svg.evaluate((el) => el.outerHTML);
  const before = await drawn();
  await page.evaluate(() => {
    const test = (window as any).__test;
    test.externalWrite('a', 'Inicio.md', `---\ntema-diagramas: medianoche\n---\n${test.files.a['Inicio.md']}`);
  });
  await expect.poll(drawn).not.toBe(before);
  expect(await drawn()).toContain('#1b2a45');
});

test('a theme can be created, edited and made the vault default', async ({ page }) => {
  await open(page, 'Inicio');
  await page.getByTitle('Ajustes y MCP').click();
  await page.getByRole('dialog', { name: 'Ajustes' }).getByRole('navigation').getByRole('button', { name: 'Vaults' }).click();
  await page.getByRole('button', { name: 'Temas' }).first().click();
  const editor = page.getByRole('dialog', { name: /Temas de Trabajo/ });
  await editor.getByRole('button', { name: 'Nuevo tema' }).click();
  await page.getByRole('textbox').last().fill('Mi Marca');
  await page.keyboard.press('Enter');
  await editor.getByLabel('Fondo', { exact: true }).fill('#102030');
  await expect(editor.getByRole('alert')).toContainText('contraste');
  await editor.getByLabel('Texto', { exact: true }).fill('#ffffff');
  await editor.getByLabel('Secundario', { exact: true }).fill('#e0e0e0');
  await editor.getByRole('button', { name: 'Guardar' }).click();
  await editor.getByLabel('Tema por defecto del vault').selectOption('mi-marca');
  await expect(page.locator('.scroll')).toHaveAttribute('data-note-theme', 'mi-marca');
  const saved = await page.evaluate(() => (window as any).__test.vaultThemes.a);
  expect(saved.defaultTheme).toBe('mi-marca');
  expect(saved.themes[0].colors.bg).toBe('#102030');
});

test('a theme can be edited as JSON and bad JSON is refused', async ({ page }) => {
  await page.getByTitle('Ajustes y MCP').click();
  await page.getByRole('dialog', { name: 'Ajustes' }).getByRole('navigation').getByRole('button', { name: 'Vaults' }).click();
  await page.getByRole('button', { name: 'Temas' }).nth(1).click();
  const editor = page.getByRole('dialog', { name: /Temas de Personal/ });
  await editor.getByRole('button', { name: 'Mar' }).click();
  await editor.getByRole('button', { name: 'Editar JSON' }).click();
  await editor.getByRole('textbox', { name: 'JSON del tema' }).fill('{ roto');
  await editor.getByRole('button', { name: 'Guardar' }).click();
  await expect(page.getByRole('status')).toContainText('JSON');
});

async function firstRun(page: Page) {
  await page.evaluate(() => {
    sessionStorage.setItem('fresh', '1');
    localStorage.removeItem('ultimatemd.tutorial');
  });
  await page.reload();
}

const tutorial = (page: Page) => page.getByRole('dialog', { name: 'Tutorial' });
const openSettings = (page: Page) => page.getByTitle('Ajustes y MCP').click();

test('the tutorial appears on the first run and only then', async ({ page }) => {
  await expect(tutorial(page)).toHaveCount(0);
  await firstRun(page);
  await expect(tutorial(page)).toContainText('Paso 1 de 8');
  for (let i = 0; i < 7; i++) await page.getByRole('button', { name: 'Siguiente' }).click();
  await expect(tutorial(page)).toContainText('Paso 8 de 8');
  await page.getByRole('button', { name: 'Empezar' }).click();
  await expect(tutorial(page)).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole('button', { name: 'Crear vault' })).toBeVisible();
  await expect(tutorial(page)).toHaveCount(0);
});

test('the tutorial can be skipped, walked back and reopened', async ({ page }) => {
  await firstRun(page);
  await page.getByRole('button', { name: 'Siguiente' }).click();
  await page.getByRole('button', { name: 'Atrás' }).click();
  await expect(tutorial(page)).toContainText('Paso 1 de 8');
  await page.keyboard.press('Escape');
  await expect(tutorial(page)).toHaveCount(0);
  await openSettings(page);
  await page.getByRole('button', { name: 'Ver el tutorial' }).click();
  await expect(tutorial(page)).toContainText('Paso 1 de 8');
});

test('the language changes at once and is remembered', async ({ page }) => {
  await openSettings(page);
  await page.getByLabel('Idioma').selectOption({ label: 'Euskara' });
  await expect(page.getByRole('heading', { name: 'Ezarpenak' })).toBeVisible();
  await page.getByLabel('Hizkuntza').selectOption({ label: 'English' });
  await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('button', { name: 'Create vault' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.lang)).toBe('en');
});

test('the tutorial lets you pick the language on its first step', async ({ page }) => {
  await firstRun(page);
  await page.getByLabel('Idioma').selectOption({ label: 'Euskara' });
  await expect(page.getByRole('dialog', { name: 'Tutoriala' })).toContainText('1. urratsa / 8');
});

test('the installer language applies until the user chooses another', async ({ page }) => {
  await page.addInitScript(() => ((window as any).__installerLanguage = 'eu'));
  await page.reload();
  await expect(page.getByRole('button', { name: 'Sortu vaulta' })).toBeVisible();
  await page.evaluate(() => localStorage.setItem('ultimatemd.language', 'en'));
  await page.reload();
  await expect(page.getByRole('button', { name: 'Create vault' })).toBeVisible();
});

test.describe('in a Basque system', () => {
  test.use({ locale: 'eu-ES' });
  test('the interface starts in Basque', async ({ page }) => {
    await expect(page.getByRole('button', { name: 'Sortu vaulta' })).toBeVisible();
  });
});

test.describe('in a system with an unsupported language', () => {
  test.use({ locale: 'fr-FR' });
  test('the interface starts in English', async ({ page }) => {
    await expect(page.getByRole('button', { name: 'Create vault' })).toBeVisible();
  });
});

test('exports follow the language of the interface', async ({ page }) => {
  await page.evaluate(() => localStorage.setItem('ultimatemd.language', 'en'));
  await page.reload();
  await open(page, 'Inicio');
  await page.keyboard.press('Control+e');
  await page.getByRole('dialog', { name: 'Export' }).getByRole('button', { name: 'Export', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Document exported' })).toBeVisible();
  const plan = await page.evaluate(() => (window as any).__pdf);
  expect(plan).toMatchObject({ language: 'en', contents: 'Contents' });
});

const editorText = (page: Page) => page.locator('.cm-content');

test('the toolbar formats the selection and undoes it', async ({ page }) => {
  await open(page, 'Inicio');
  await typeInEditor(page, '\nhola');
  await page.keyboard.press('Shift+Home');
  await page.getByRole('button', { name: 'Negrita' }).click();
  await expect(editorText(page)).toContainText('**hola**');
  await page.getByRole('button', { name: 'Negrita' }).click();
  await expect(editorText(page)).not.toContainText('**hola**');
  await page.getByRole('toolbar').getByLabel('Título').selectOption('2');
  await expect(editorText(page)).toContainText('## hola');
  await page.getByRole('button', { name: 'Lista', exact: true }).click();
  await expect(editorText(page)).toContainText('- hola');
  await expect(editorText(page)).not.toContainText('## hola');
});

test('the heading menu offers six levels and can remove a heading', async ({ page }) => {
  await open(page, 'Inicio');
  await typeInEditor(page, '\nhola');
  const menu = page.getByRole('toolbar').getByLabel('Título');
  await expect(menu.locator('option')).toHaveCount(8);
  await menu.selectOption('6');
  await expect(editorText(page)).toContainText('###### hola');
  await expect(menu).toHaveValue('');
  await menu.selectOption('1');
  await expect(editorText(page)).toContainText('# hola');
  await expect(editorText(page)).not.toContainText('## hola');
  await menu.selectOption('0');
  await expect(page.locator('.cm-line').last()).toHaveText('hola');
  await page.keyboard.type('!');
  await expect(editorText(page)).toContainText('hola!');
});

test('keyboard shortcuts format too', async ({ page }) => {
  await open(page, 'Inicio');
  await typeInEditor(page, '\nhola');
  await page.keyboard.press('Shift+Home');
  await page.keyboard.press('ControlOrMeta+b');
  await expect(editorText(page)).toContainText('**hola**');
});

test('a table is inserted as Markdown', async ({ page }) => {
  await open(page, 'Inicio');
  await page.locator('.cm-content').click();
  await page.getByRole('button', { name: 'Tabla' }).click();
  await expect(editorText(page)).toContainText('| Columna 1 | Columna 2 |');
});

test('visual mode hides the marks without touching the file', async ({ page }) => {
  await open(page, 'Inicio');
  const before = await disk(page, 'a', 'Inicio.md');
  await page.getByTitle('Visual', { exact: true }).click();
  await page.locator('.cm-line', { hasText: 'Ver' }).click();
  await expect(page.locator('.cm-v-h1')).toHaveText('Inicio');
  await expect(page.locator('.cm-v-diagram svg')).toBeVisible();
  await expect(editorText(page)).not.toContainText('```mermaid');
  await page.locator('.cm-v-h1').click();
  await expect(page.locator('.cm-v-h1')).toHaveText('# Inicio');
  await page.waitForTimeout(900);
  expect(await disk(page, 'a', 'Inicio.md')).toBe(before);
});

test('visual mode reads like a document, not like code', async ({ page }) => {
  await open(page, 'Inicio');
  await page.getByTitle('Visual', { exact: true }).click();
  const line = page.locator('.cm-line', { hasText: 'Ver' });
  await line.click();
  await expect(page.locator('.cm-scroller')).toHaveCSS('font-family', /Inter/);
  await expect(page.locator('.cm-gutters')).toBeHidden();
  await expect(line).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
});

test('clicking a diagram in visual mode opens it, and it stays drawn afterwards', async ({ page }) => {
  await open(page, 'Inicio');
  await page.getByTitle('Visual', { exact: true }).click();
  await page.locator('.cm-line', { hasText: 'Ver' }).click();
  await page.locator('.cm-v-diagram').click();
  const dialog = page.getByRole('dialog', { name: 'Editar diagrama' });
  await expect(dialog.locator('.drawing svg')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(page.locator('.cm-v-diagram svg')).toBeVisible();
});

test('a task can be ticked in visual mode', async ({ page }) => {
  await open(page, 'Inicio');
  await typeInEditor(page, '\n- [ ] tarea\n\nfin');
  await page.getByTitle('Visual', { exact: true }).click();
  await page.locator('.cm-v-check').click();
  await expect.poll(() => disk(page, 'a', 'Inicio.md')).toContain('- [x] tarea');
});

test('new tabs open in the last view chosen', async ({ page }) => {
  await open(page, 'Inicio');
  await page.getByTitle('Visual', { exact: true }).click();
  await open(page, 'D2');
  await expect(page.locator('.cm-v-diagram').first()).toBeVisible();
});

const builder = (page: Page, name: string) => page.getByRole('dialog', { name });

test('a diagram is built with a form and reopened to change it', async ({ page }) => {
  await open(page, 'D2');
  await page.locator('.cm-content').click();
  await page.keyboard.press('ControlOrMeta+End');
  await page.getByRole('button', { name: 'Diagrama', exact: true }).click();
  const dialog = builder(page, 'Crear diagrama');
  await dialog.getByRole('button', { name: 'Añadir paso' }).click();
  await dialog.getByLabel('Nombre del paso').nth(2).fill('Revisar; "ya"');
  await dialog.getByLabel('Forma', { exact: true }).nth(2).selectOption('diamond');
  await dialog.getByRole('button', { name: 'Vertical' }).click();
  await expect(dialog.locator('.drawing svg')).toContainText('Revisar');
  await dialog.getByRole('button', { name: 'Insertar' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(editorText(page)).toContainText('flowchart TD');
  await page.locator('.cm-line', { hasText: 'flowchart TD' }).click();
  await page.getByRole('button', { name: 'Diagrama', exact: true }).click();
  const again = builder(page, 'Editar diagrama');
  await expect(again.getByLabel('Nombre del paso').nth(2)).toHaveValue('Revisar; "ya"');
  await again.getByRole('button', { name: 'Añadir paso' }).click();
  await again.getByRole('button', { name: 'Actualizar' }).click();
  await expect(editorText(page)).toContainText('Paso 4');
  await expect.poll(async () => ((await disk(page, 'a', 'D2.md')) as string).split('flowchart').length - 1).toBe(1);
});

test('a sequence diagram can be built', async ({ page }) => {
  await open(page, 'D2');
  await page.locator('.cm-content').click();
  await page.keyboard.press('ControlOrMeta+End');
  await page.getByRole('button', { name: 'Diagrama', exact: true }).click();
  const dialog = builder(page, 'Crear diagrama');
  await dialog.getByRole('button', { name: 'Secuencia' }).click();
  await dialog.getByRole('button', { name: 'Añadir mensaje' }).click();
  await dialog.getByLabel('Respuesta').nth(1).check();
  await expect(dialog.locator('.drawing svg')).toContainText('Participante 1');
  await dialog.getByRole('button', { name: 'Insertar' }).click();
  await expect(editorText(page)).toContainText('sequenceDiagram');
  await expect(editorText(page)).toContainText('p1 -->> p2: Mensaje');
  await expect.poll(() => disk(page, 'a', 'D2.md')).toContain('```\n\n```mermaid\nsequenceDiagram');
});

test('the builder reads back what it writes, and refuses what it cannot show', () => {
  const flow: Diagram = { kind: 'flow', direction: 'TD', nodes: [{ id: 'n1', label: 'a; "b" #c', shape: 'circle', fill: '#ff0000' }, { id: 'n2', label: '¿Sí?', shape: 'diamond' }, { id: 'n3', label: 'r', shape: 'round' }], edges: [{ from: 'n1', to: 'n2', label: 'va; ya' }, { from: 'n2', to: 'n3', label: '' }] };
  const sequence: Diagram = { kind: 'sequence', actors: [{ id: 'p1', name: 'Ana' }, { id: 'p2', name: 'Web; "app"' }], messages: [{ from: 'p1', to: 'p2', text: 'hola: qué tal', reply: false }, { from: 'p2', to: 'p1', text: 'bien', reply: true }] };
  const samples: [Diagram, Engine][] = [
    [flow, 'mermaid'],
    [flow, 'd2'],
    [sequence, 'mermaid'],
    [sequence, 'd2'],
    [{ kind: 'state', direction: 'LR', initial: 's1', final: 's2', nodes: [{ id: 's1', label: 'Uno', shape: 'rect' }, { id: 's2', label: 'Dos', shape: 'rect' }], edges: [{ from: 's1', to: 's2', label: 'pasa' }] }, 'mermaid'],
    [{ kind: 'pie', title: 'Gastos', slices: [{ label: 'Casa', value: 60.5 }, { label: 'Otros', value: 39.5 }] }, 'mermaid'],
    [{ kind: 'gantt', tasks: [{ name: 'Diseño', start: '2026-11-05', days: 5 }] }, 'mermaid'],
    [{ kind: 'mindmap', items: [{ text: 'Raíz', level: 0 }, { text: 'Rama', level: 1 }, { text: 'Hoja', level: 2 }, { text: 'Otra', level: 1 }] }, 'mermaid'],
  ];
  for (const [sample, engine] of samples) expect(parseSource(engine, toSource(sample, engine))).toEqual(sample);
  expect(parseSource('mermaid', 'flowchart LR\n  A --> B --> C')).toBeNull();
  expect(parseSource('mermaid', 'pie\n  "a": 1')).toBeNull();
  expect(parseSource('d2', 'a -> b')).toBeNull();
});

test('a diagram style survives its fence line, and bad values are dropped', () => {
  const style = { theme: 'sepia', sketch: true, surface: '#00ff00', text: '#112233' };
  const line = fenceLine('d2', style);
  expect(line).toBe('```d2 tema=sepia boceto relleno=#00ff00 texto=#112233');
  expect(parseStyle(line.replace('```d2 ', ''))).toEqual(style);
  expect(parseStyle('relleno=red tema=../x otra=1')).toEqual({});
});

test('frontmatter edits touch only their own line', () => {
  const apply = (note: string, key: string, value: string | null) => {
    const change = frontmatterChange(note, key, value);
    return change ? note.slice(0, change.from) + change.insert + note.slice(change.to) : note;
  };
  expect(apply('# Hola\n', 'a', '1')).toBe('---\na: 1\n---\n# Hola\n');
  expect(apply('---\nb: 2\n---\n# Hola\n', 'a', '1')).toBe('---\nb: 2\na: 1\n---\n# Hola\n');
  expect(apply('---\na: 0\nb: 2\n---\n# Hola\n', 'a', '1')).toBe('---\na: 1\nb: 2\n---\n# Hola\n');
  expect(apply('---\na: 0\nb: 2\n---\n# Hola\n', 'a', null)).toBe('---\nb: 2\n---\n# Hola\n');
  expect(apply('---\na: 0\n---\n# Hola\n', 'a', null)).toBe('# Hola\n');
  expect(apply('# Hola\n', 'a', null)).toBe('# Hola\n');
});

test('versions compare as numbers', () => {
  expect(isNewer('0.10.0', '0.9.0')).toBe(true);
  expect(isNewer('v1.0.0', '0.9.9')).toBe(true);
  expect(isNewer('0.1.0', '0.1.0')).toBe(false);
  expect(isNewer('0.1.0', '0.2.0')).toBe(false);
  expect(isNewer('0.1', '0.1.1')).toBe(false);
});

const about = (page: Page) => page.getByTitle('Acerca de').click();
const release = (page: Page, tag: string) =>
  page.route('https://api.github.com/**', (route) =>
    route.fulfill({ json: { tag_name: tag }, headers: { 'access-control-allow-origin': '*' } }));

test('about shows the version and says when nothing is published', async ({ page }) => {
  await about(page);
  const dialog = page.getByRole('dialog', { name: 'Acerca de' });
  await expect(dialog).toContainText('Versión 0.1.0');
  await dialog.getByRole('button', { name: 'Buscar actualizaciones' }).click();
  await expect(dialog.getByRole('status')).toHaveText('Aún no hay versiones publicadas.');
});

test('about reports being up to date, a new version and a failure', async ({ page }) => {
  await about(page);
  const dialog = page.getByRole('dialog', { name: 'Acerca de' });
  const check = dialog.getByRole('button', { name: 'Buscar actualizaciones' });
  await release(page, 'v0.1.0');
  await check.click();
  await expect(dialog.getByRole('status')).toHaveText('Tienes la última versión.');
  await release(page, 'v0.2.0');
  await check.click();
  await expect(dialog.getByRole('status')).toHaveText('Disponible la versión 0.2.0.');
  await dialog.getByRole('button', { name: 'Ir a descargas' }).click();
  await expect.poll(() => page.evaluate(() => (window as any).__opened)).toBe('https://github.com/icabero/UltimateMD/releases');
  await page.route('https://api.github.com/**', (route) => route.abort());
  await check.click();
  await expect(dialog.getByRole('status')).toContainText('No se pudo comprobar');
});

test('a new version is announced at startup unless turned off', async ({ page }) => {
  await release(page, 'v0.2.0');
  await page.reload();
  const notice = page.getByRole('button', { name: 'Nueva versión 0.2.0' });
  await notice.click();
  const dialog = page.getByRole('dialog', { name: 'Acerca de' });
  await expect(dialog.getByRole('status')).toHaveText('Disponible la versión 0.2.0.');
  await dialog.getByLabel('Comprobar al iniciar').uncheck();
  await page.reload();
  await expect(page.getByRole('button', { name: 'Crear vault' })).toBeVisible();
  await expect(notice).toHaveCount(0);
});

const settingsSection = (page: Page, name: string) => page.getByRole('dialog', { name: 'Ajustes' }).getByRole('navigation').getByRole('button', { name }).click();
const newDiagram = async (page: Page) => {
  await open(page, 'D2');
  await page.locator('.cm-content').click();
  await page.keyboard.press('ControlOrMeta+End');
  await page.getByRole('button', { name: 'Diagrama', exact: true }).click();
  return builder(page, 'Crear diagrama');
};
const typeButton = (dialog: ReturnType<Page['getByRole']>, name: string) => dialog.getByRole('group', { name: 'Tipo de diagrama' }).getByRole('button', { name, exact: true });

test('a table in visual mode is a table, and its cells can be edited', async ({ page }) => {
  await open(page, 'Inicio');
  await typeInEditor(page, '\n\n| Nombre | Edad |\n| --- | --- |\n| Ana | 30 |\n\nfin');
  await expect.poll(() => disk(page, 'a', 'Inicio.md')).toContain('fin');
  await page.getByTitle('Visual', { exact: true }).click();
  const table = page.locator('.cm-v-table table');
  await expect(table.locator('th input').first()).toHaveValue('Nombre');
  await expect(table.locator('th input')).toHaveCount(2);
  await expect(editorText(page)).not.toContainText('| --- |');

  // Ctrl+A belongs to the cell. Reaching the editor, it would replace the whole note.
  await table.locator('td input').first().click();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.type('Bea');
  await expect(table.locator('td input').first()).toHaveValue('Bea');
  await page.locator('.cm-line', { hasText: 'fin' }).click();
  await expect.poll(() => disk(page, 'a', 'Inicio.md')).toContain('| Bea | 30 |');
  expect(await disk(page, 'a', 'Inicio.md')).toContain('# Inicio');

  await table.hover();
  await page.getByRole('button', { name: 'Añadir fila' }).click();
  await expect(page.locator('.cm-v-table tr')).toHaveCount(3);
  await page.getByRole('button', { name: 'Añadir columna' }).click();
  await expect(page.locator('.cm-v-table th')).toHaveCount(3);
  await expect.poll(() => disk(page, 'a', 'Inicio.md')).toContain('| Nombre | Edad | Columna 3 |\n| --- | --- | --- |\n| Bea | 30 |  |');
});

test('tables and diagrams stay drawn wherever you click in visual mode', async ({ page }) => {
  await open(page, 'Inicio');
  await typeInEditor(page, '\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n\nen medio\n\n| C | D |\n| --- | --- |\n| 3 | 4 |\n\nfin');
  await expect.poll(() => disk(page, 'a', 'Inicio.md')).toContain('fin');
  await page.getByTitle('Visual', { exact: true }).click();
  const tables = page.locator('.cm-v-table table');
  await expect(tables).toHaveCount(2);

  await tables.first().locator('td input').first().click();
  await page.keyboard.type('9');
  for (const target of ['en medio', 'fin']) {
    await page.locator('.cm-line', { hasText: target }).click();
    await expect(tables).toHaveCount(2);
    await expect(editorText(page)).not.toContainText('| --- |');
  }
  // Beside a table, in the margin of the page.
  const box = (await tables.first().boundingBox())!;
  await page.mouse.click(box.x + box.width + 150, box.y + box.height / 2);
  await expect(tables).toHaveCount(2);
  await tables.first().locator('td input').first().click();
  await tables.nth(1).locator('td input').first().click();
  await page.keyboard.type('8');
  await expect(tables).toHaveCount(2);
  await expect(page.locator('.cm-v-diagram svg')).toBeVisible();
  await expect.poll(() => disk(page, 'a', 'Inicio.md')).toContain('| 19 | 2 |');
  await expect.poll(() => disk(page, 'a', 'Inicio.md')).toContain('| 38 | 4 |');
});

test('a cell saves as you type and keeps your place', async ({ page }) => {
  await open(page, 'Inicio');
  await typeInEditor(page, '\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n\nfin');
  await expect.poll(() => disk(page, 'a', 'Inicio.md')).toContain('fin');
  await page.getByTitle('Visual', { exact: true }).click();
  const cell = page.locator('.cm-v-table td input').first();
  await cell.click();
  await page.keyboard.type(' dos tres');
  await expect(cell).toHaveValue('1 dos tres');
  await expect(cell).toBeFocused();
  await expect.poll(() => disk(page, 'a', 'Inicio.md')).toContain('| 1 dos tres | 2 |');
});

test('a cell keeps pipes and backslashes intact', async ({ page }) => {
  await open(page, 'Inicio');
  await typeInEditor(page, '\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n\nfin');
  await expect.poll(() => disk(page, 'a', 'Inicio.md')).toContain('fin');
  await page.getByTitle('Visual', { exact: true }).click();
  const cell = page.locator('.cm-v-table td input').first();
  await cell.fill(String.raw`a|b\c`);
  await expect.poll(() => disk(page, 'a', 'Inicio.md')).toContain(String.raw`| a\|b\\c | 2 |`);
  await page.getByTitle('Dividido', { exact: true }).click();
  await page.getByTitle('Visual', { exact: true }).click();
  await expect(page.locator('.cm-v-table td input').first()).toHaveValue(String.raw`a|b\c`);
  await expect(page.locator('.cm-v-table td input').nth(1)).toHaveValue('2');
});

test('text typed below a block at the end of a note stays out of it', async ({ page }) => {
  await open(page, 'Inicio');
  await typeInEditor(page, '\n\n| A | B |\n| --- | --- |\n| 1 | 2 |');
  await expect.poll(() => disk(page, 'a', 'Inicio.md')).toContain('| 1 | 2 |');
  await page.getByTitle('Visual', { exact: true }).click();
  await page.locator('.cm-line', { hasText: 'Ver' }).click();
  await page.keyboard.press('ControlOrMeta+End');
  await page.keyboard.type('hola');
  await expect(page.locator('.cm-v-table table')).toBeVisible();
  await expect.poll(() => disk(page, 'a', 'Inicio.md')).toContain('| 1 | 2 |\n\nhola');
});

test('a table can still be typed by hand in visual mode', async ({ page }) => {
  await open(page, 'Inicio');
  await page.getByTitle('Visual', { exact: true }).click();
  await page.locator('.cm-line', { hasText: 'Ver' }).click();
  await page.keyboard.press('ControlOrMeta+End');
  await page.keyboard.type('\n| Uno | Dos |\n| --- | --- |\n| a | b |');
  await expect.poll(() => disk(page, 'a', 'Inicio.md')).toContain('| Uno | Dos |\n| --- | --- |\n| a | b |');
});

test('settings show one section at a time', async ({ page }) => {
  await openSettings(page);
  const dialog = page.getByRole('dialog', { name: 'Ajustes' });
  await expect(dialog.getByLabel('Idioma')).toBeVisible();
  await expect(dialog.getByText('Conectar una IA por MCP')).toHaveCount(0);
  await settingsSection(page, 'Inteligencia artificial');
  await expect(dialog.getByText('Conectar una IA por MCP')).toBeVisible();
  await expect(dialog.getByLabel('Idioma')).toHaveCount(0);
});

for (const [name, code, drawn] of [
  ['Estados', 'stateDiagram-v2', 'Inicio'],
  ['Mapa mental', 'mindmap', 'Tema'],
  ['Tarta', 'pie showData', 'Parte 1'],
  ['Gantt', 'gantt', 'Tarea 1'],
]) {
  test(`a ${code} diagram can be built, drawn and reopened`, async ({ page }) => {
    const dialog = await newDiagram(page);
    await typeButton(dialog, name).click();
    await expect(dialog.locator('.drawing svg')).toContainText(drawn, { timeout: 15_000 });
    await dialog.getByRole('button', { name: 'Insertar' }).click();
    await expect(editorText(page)).toContainText(code);
    await page.locator('.cm-line', { hasText: code }).click();
    await page.getByRole('button', { name: 'Diagrama', exact: true }).click();
    const again = builder(page, 'Editar diagrama');
    await expect(typeButton(again, name)).toHaveAttribute('aria-pressed', 'true');
  });
}

test('trying another type of diagram does not lose the work', async ({ page }) => {
  const dialog = await newDiagram(page);
  await dialog.getByLabel('Nombre del paso').first().fill('Mi paso');
  await typeButton(dialog, 'Tarta').click();
  await typeButton(dialog, 'Flujo').click();
  await expect(dialog.getByLabel('Nombre del paso').first()).toHaveValue('Mi paso');
});

test('a flow can be made in D2 and reopened as D2', async ({ page }) => {
  const dialog = await newDiagram(page);
  await dialog.getByRole('group', { name: 'Formato' }).getByRole('button', { name: 'D2' }).click();
  await dialog.getByLabel('Forma', { exact: true }).first().selectOption('circle');
  await expect(dialog.locator('.drawing svg').first()).toContainText('Inicio', { timeout: 15_000 });
  await dialog.getByRole('button', { name: 'Insertar' }).click();
  await expect.poll(() => disk(page, 'a', 'D2.md')).toContain('```d2\ndirection: right\nn1: "Inicio" {shape: circle}');
  await page.locator('.cm-line', { hasText: 'direction: right' }).click();
  await page.getByRole('button', { name: 'Diagrama', exact: true }).click();
  const again = builder(page, 'Editar diagrama');
  await expect(again.getByRole('group', { name: 'Formato' }).getByRole('button', { name: 'D2' })).toHaveAttribute('aria-pressed', 'true');
  await expect(again.getByLabel('Forma', { exact: true }).first()).toHaveValue('circle');
});

for (const engine of ['Mermaid', 'D2']) {
  test(`a connection with a label is drawn in ${engine}`, async ({ page }) => {
    const dialog = await newDiagram(page);
    await dialog.getByRole('group', { name: 'Formato' }).getByRole('button', { name: engine }).click();
    await dialog.getByLabel('Etiqueta').first().fill('Sí, seguir');
    await expect(dialog.locator('.drawing svg').first()).toContainText('Sí, seguir', { timeout: 15_000 });
    await dialog.getByRole('button', { name: 'Insertar' }).click();
    await page.locator('.cm-line', { hasText: 'Sí, seguir' }).click();
    await page.getByRole('button', { name: 'Diagrama', exact: true }).click();
    await expect(builder(page, 'Editar diagrama').getByLabel('Etiqueta').first()).toHaveValue('Sí, seguir');
  });
}

test('D2 sequences are drawn', async ({ page }) => {
  const dialog = await newDiagram(page);
  await typeButton(dialog, 'Secuencia').click();
  await dialog.getByRole('group', { name: 'Formato' }).getByRole('button', { name: 'D2' }).click();
  await expect(dialog.locator('.drawing svg').first()).toContainText('Participante 1', { timeout: 15_000 });
});

for (const engine of ['Mermaid', 'D2']) {
  test(`a step can have its own colour in ${engine}`, async ({ page }) => {
    const dialog = await newDiagram(page);
    await dialog.getByRole('group', { name: 'Formato' }).getByRole('button', { name: engine }).click();
    await dialog.getByLabel('Color de este paso').first().fill('#ff0000');
    await expect.poll(() => dialog.locator('.drawing').innerHTML(), { timeout: 15_000 }).toMatch(/#ff0000/i);
  });
}

test('a single diagram keeps its own look on its fence line', async ({ page }) => {
  const dialog = await newDiagram(page);
  await dialog.getByText('Apariencia de este diagrama').click();
  await dialog.getByLabel(/^Tema/).selectOption('sepia');
  await dialog.getByLabel('Aspecto de boceto a mano').check();
  await dialog.getByLabel('Relleno').fill('#00ff00');
  await expect.poll(() => dialog.locator('.drawing').innerHTML(), { timeout: 15_000 }).toMatch(/#00ff00/i);
  await dialog.getByRole('button', { name: 'Insertar' }).click();
  await expect.poll(() => disk(page, 'a', 'D2.md')).toContain('```mermaid tema=sepia boceto relleno=#00ff00\nflowchart LR');
  await expect.poll(() => prose(page).locator('.diagram').last().innerHTML(), { timeout: 15_000 }).toMatch(/#00ff00/i);
});

test('a hand-written diagram can be edited and restyled in the same place', async ({ page }) => {
  await open(page, 'D2');
  await page.locator('.cm-line', { hasText: 'uno -> dos' }).click();
  await page.getByRole('button', { name: 'Diagrama', exact: true }).click();
  const dialog = builder(page, 'Editar diagrama');
  await expect(dialog.getByRole('group', { name: 'Tipo de diagrama' })).toHaveCount(0);
  await dialog.getByLabel('Código del diagrama').fill('uno -> tres');
  await dialog.getByText('Apariencia de este diagrama').click();
  await dialog.getByLabel(/^Tema/).selectOption('sepia');
  await dialog.getByRole('button', { name: 'Actualizar' }).click();
  await expect.poll(() => disk(page, 'a', 'D2.md')).toContain('```d2 tema=sepia\nuno -> tres\n```');
});

const svgOf = (page: Page) => prose(page).locator('.diagram').first();
const fillOf = (id: string) => THEMES.find((t) => t.id === id)!.diagram.surface;

test('a diagram goes by its own style, then its note, then its vault', async ({ page }) => {
  await open(page, 'Inicio');
  await expect(svgOf(page).locator('svg').first()).toBeVisible();
  await page.getByRole('button', { name: 'Estilo', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Estilo de los diagramas' });

  await dialog.getByLabel('En todo «Trabajo»').selectOption('bosque');
  await expect.poll(() => svgOf(page).innerHTML()).toContain(fillOf('bosque'));

  await dialog.getByLabel('En esta nota').selectOption('sepia');
  await expect.poll(() => disk(page, 'a', 'Inicio.md')).toContain('---\ntema-diagramas: sepia\n---\n');
  await expect.poll(() => svgOf(page).innerHTML()).toContain(fillOf('sepia'));

  await dialog.getByLabel('En esta nota').selectOption('');
  await expect.poll(() => disk(page, 'a', 'Inicio.md')).not.toContain('tema-diagramas');
  await expect.poll(() => svgOf(page).innerHTML()).toContain(fillOf('bosque'));
  await page.keyboard.press('Escape');

  await page.locator('.cm-line', { hasText: 'flowchart' }).click();
  await page.getByRole('button', { name: 'Diagrama', exact: true }).click();
  const own = builder(page, 'Editar diagrama');
  await own.getByText('Apariencia de este diagrama').click();
  await own.getByLabel(/^Tema/).selectOption('medianoche');
  await own.getByRole('button', { name: 'Actualizar' }).click();
  await expect.poll(() => svgOf(page).innerHTML()).toContain(fillOf('medianoche'));
});

test('the style dialog sends you to make your own theme', async ({ page }) => {
  await open(page, 'Inicio');
  await page.getByRole('button', { name: 'Estilo', exact: true }).click();
  await page.getByRole('button', { name: 'Crear un tema con mis colores' }).click();
  await expect(page.getByRole('dialog', { name: /Temas de Trabajo/ })).toBeVisible();
});

test('a chosen diagram style reaches the export, a plain one stays in the print look', async ({ page }) => {
  await page.evaluate(() => {
    const test = (window as any).__test;
    test.externalWrite('a', 'Inicio.md', '```mermaid relleno=#00ff00\nflowchart LR\n  A --> B\n```\n\n```mermaid\nflowchart LR\n  C --> D\n```\n');
  });
  await open(page, 'Inicio');
  await exportAs(page, 'HTML');
  await page.getByRole('button', { name: 'Exportar', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Documento exportado' })).toBeVisible();
  const { text } = await page.evaluate(() => (window as any).__exported);
  expect(text).toMatch(/#00ff00/i);
  expect(text).toContain(fillOf('claro'));
});

const completion = (page: Page) => page.locator('.cm-tooltip-autocomplete');

test('typing [[ suggests notes and completes the link', async ({ page }) => {
  await open(page, 'Inicio');
  await typeInEditor(page, '\n[[Dest');
  await expect(completion(page)).toContainText('Destino');
  await page.keyboard.press('Enter');
  await expect(editorText(page)).toContainText('[[Destino]]');
  await expect.poll(() => disk(page, 'a', 'Inicio.md')).toContain('[[Destino]]');
});

test('the toolbar links the selected text to a note', async ({ page }) => {
  await open(page, 'Inicio');
  await typeInEditor(page, '\nmira esto');
  await page.keyboard.press('Shift+Home');
  await page.getByRole('button', { name: 'Enlazar nota' }).click();
  await expect(completion(page)).toContainText('Destino');
  await completion(page).getByText('Destino').click();
  await expect(editorText(page)).toContainText('[[Destino|mira esto]]');
});

test('ctrl+click on a link in the editor opens the note', async ({ page }) => {
  await open(page, 'Inicio');
  await page.getByTitle('Editar', { exact: true }).click();
  await page.locator('.cm-wikilink', { hasText: 'Destino' }).click({ modifiers: ['ControlOrMeta'] });
  await expect(page.locator('.tab.active')).toContainText('Destino');
});

test('in visual mode a link reads as text and a click opens it', async ({ page }) => {
  await open(page, 'Inicio');
  await page.getByTitle('Visual', { exact: true }).click();
  const link = page.locator('.cm-wikilink', { hasText: 'Destino' });
  await page.locator('.cm-v-h1').click();
  await expect(link).toHaveText('Destino');
  await link.click();
  await expect(page.locator('.tab.active')).toContainText('Destino');
});

test('a link to a missing note looks different and offers to create it', async ({ page }) => {
  await open(page, 'Inicio');
  await page.getByTitle('Editar', { exact: true }).click();
  const link = page.locator('.cm-wikilink-missing');
  await expect(link).toContainText('Falta');
  await link.click({ modifiers: ['ControlOrMeta'] });
  await expect(page.locator('form.dialog')).toContainText('«Falta» no existe');
});

test('every diagram type without a form draws from its template', async ({ page }) => {
  test.setTimeout(120_000);
  const dialog = await newDiagram(page);
  await dialog.getByRole('group', { name: 'Tipo de diagrama' }).getByRole('button', { name: 'Más tipos' }).click();
  for (const template of TEMPLATES) {
    await dialog.getByLabel('Elige el tipo').selectOption(template.id);
    await page.waitForTimeout(template.lang === 'd2' ? 2500 : 1500);
    await expect(dialog.locator('.error'), template.id).toHaveCount(0);
    await expect(dialog.locator('.drawing svg').first(), template.id).toBeVisible();
  }
});

test('a template is edited as code and inserted in its own language', async ({ page }) => {
  const dialog = await newDiagram(page);
  await dialog.getByRole('group', { name: 'Tipo de diagrama' }).getByRole('button', { name: 'Más tipos' }).click();
  await dialog.getByLabel('Elige el tipo').selectOption('d2-grid');
  await dialog.getByLabel('Código del diagrama').fill('grid-columns: 1\nuno\ndos');
  await dialog.getByLabel('Elige el tipo').selectOption('er');
  await dialog.getByLabel('Elige el tipo').selectOption('d2-grid');
  await expect(dialog.getByLabel('Código del diagrama'), 'trying another type keeps the code').toHaveValue('grid-columns: 1\nuno\ndos');
  await dialog.getByRole('button', { name: 'Insertar' }).click();
  await expect.poll(() => disk(page, 'a', 'D2.md')).toContain('```d2\ngrid-columns: 1\nuno\ndos\n```');
});

test('broken code keeps the last drawing and shows why', async ({ page }) => {
  const dialog = await newDiagram(page);
  await dialog.getByRole('group', { name: 'Tipo de diagrama' }).getByRole('button', { name: 'Más tipos' }).click();
  await expect(dialog.locator('.drawing svg').first()).toBeVisible();
  await dialog.getByLabel('Elige el tipo').selectOption('d2-grid');
  await expect(dialog.locator('.drawing svg').first()).toBeVisible({ timeout: 15_000 });
  await dialog.getByLabel('Código del diagrama').fill('esto no vale -> {');
  await expect(dialog.locator('.error')).toBeVisible({ timeout: 15_000 });
  await expect(dialog.locator('.drawing svg').first()).toBeVisible();
});

test('the pastel pink theme can be chosen for the whole app', async ({ page }) => {
  await openSettings(page);
  await settingsSection(page, 'Apariencia');
  await page.getByRole('button', { name: /Rosa pastel/ }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'rosa');
  await page.getByLabel('Seguir al sistema').check();
  await page.getByLabel('Modo claro').selectOption('rosa');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'rosa');
});

const wordScreen = async (page: Page) => {
  await openSettings(page);
  await settingsSection(page, 'Vaults');
  await page.getByRole('button', { name: 'Word', exact: true }).first().click();
  return page.getByRole('dialog', { name: 'Word en Trabajo' });
};

test('the Word screen shows what the template suggests and saves changes', async ({ page }) => {
  const screen = await wordScreen(page);
  await expect(screen.getByLabel('Título 1')).toHaveValue('');
  await expect(screen.getByLabel('Título 1').locator('option').first()).toHaveText('Automático: Propio 1');
  await expect(screen.getByLabel('Título 3').locator('option').first()).toHaveText('Estándar');
  await screen.getByLabel('Título 3').selectOption('Propio2');
  await screen.getByLabel('Ancho máximo (pt)').fill('420');
  await screen.getByLabel('Sin fondo').check();
  await expect.poll(() => page.evaluate(() => (window as any).__word)).toMatchObject({ imageMaxWidth: 420, plainCode: true, headings: [null, null, 'Propio2', null, null, null] });
  await expect.poll(() => page.evaluate(() => (window as any).__wordSample)).toBeGreaterThan(0);
  expect(await page.evaluate(() => (window as any).__wordMarkdown)).toContain('###### Nivel 6');
});

test('the Word screen opens from the vault in the sidebar', async ({ page }) => {
  const vault = page.getByRole('region', { name: 'Trabajo' });
  await vault.hover();
  await vault.getByTitle('Ajustes de Word de este vault').click();
  await expect(page.getByRole('dialog', { name: 'Word en Trabajo' })).toBeVisible();
  await page.keyboard.press('Escape');
  await page.locator('aside').getByRole('button', { name: 'Trabajo' }).click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Ajustes de Word de este vault' }).click();
  await expect(page.getByRole('dialog', { name: 'Word en Trabajo' })).toBeVisible();
});

test('the Word screen warns about levels the template does not number', async ({ page }) => {
  const screen = await wordScreen(page);
  await expect(screen.getByRole('status')).toHaveCount(0);
  await screen.getByRole('button', { name: 'Elegir plantilla' }).click();
  await expect(screen.getByRole('status')).toContainText('3, 4, 5, 6');
  await expect(screen.getByRole('button', { name: 'Cambiar plantilla' })).toBeVisible();
});

test('the header colour can be set and given back to the template', async ({ page }) => {
  const screen = await wordScreen(page);
  await screen.getByLabel('Color de cabecera').fill('#112233');
  await expect.poll(() => page.evaluate(() => (window as any).__word.headerFill)).toBe('112233');
  await screen.getByRole('button', { name: 'El de la plantilla' }).click();
  await expect.poll(() => page.evaluate(() => (window as any).__word.headerFill)).toBeNull();
});

test('a vault with its own template offers it first when exporting', async ({ page }) => {
  await page.evaluate(() => ((window as any).__wordTemplate = true));
  await open(page, 'Inicio');
  await exportAs(page, 'Word');
  await step(page, 'Aspecto');
  await expect(page.getByLabel('Plantilla')).toHaveValue(':vault');
});
