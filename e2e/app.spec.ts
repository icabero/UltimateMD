import { expect, test, type Page } from '@playwright/test';
import { THEMES, contrast, mix } from '../src/lib/themes';

test.beforeEach(async ({ page }) => {
  await page.addInitScript({ path: 'e2e/mock.js' });
  await page.goto('/');
});

const open = (page: Page, name: string) => page.locator('aside').getByRole('button', { name, exact: true }).click();
const prose = (page: Page) => page.locator('.scroll article');
const disk = (page: Page, vault: string, path: string) =>
  page.evaluate(([v, p]) => (window as any).__test.files[v][p], [vault, path]);

async function typeInEditor(page: Page, text: string) {
  await page.locator('.cm-content').click();
  await page.keyboard.press('Control+End');
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

test('global search covers every vault', async ({ page }) => {
  await page.keyboard.press('Control+Shift+f');
  await page.getByPlaceholder('Buscar en los vaults abiertos').fill('#');
  await expect(page.locator('.results button')).toHaveCount(3);
});

test('settings change MCP access and give a valid Windows config', async ({ page }) => {
  await page.getByTitle('Ajustes y MCP').click();
  const group = page.getByRole('group', { name: 'Acceso MCP de Trabajo' });
  await group.getByRole('button', { name: 'Lectura y escritura' }).click();
  await expect(group.getByRole('button', { name: 'Lectura y escritura' })).toHaveClass(/on/);

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

test('export to HTML gives a self-contained page in the print look', async ({ page }) => {
  await page.getByTitle('Ajustes y MCP').click();
  await page.getByRole('button', { name: /Medianoche/ }).click();
  await page.getByTitle('Cerrar', { exact: true }).click();
  await open(page, 'Inicio');
  await exportAs(page, 'HTML');
  await page.getByRole('button', { name: 'Exportar', exact: true }).click();
  await expect(page.getByRole('status')).toHaveText('Exportado');
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
  await page.getByLabel('Plantilla').selectOption('Corporativa');
  await page.getByRole('button', { name: 'Exportar', exact: true }).click();
  await expect(page.getByRole('status')).toHaveText('Exportado');
  const args = await page.evaluate(() => (window as any).__docx);
  expect(args.template).toBe('Corporativa');
  expect(args.diagrams).toHaveLength(1);
  expect(args.diagrams[0].slice(1, 4)).toEqual([0x50, 0x4e, 0x47]);
});

test('export to PDF prints only the note', async ({ page }) => {
  await page.evaluate(() => {
    window.print = () => {
      (window as any).__printed = document.getElementById('print-root')?.shadowRoot?.textContent;
    };
  });
  await open(page, 'Inicio');
  await exportAs(page, 'PDF');
  await page.getByRole('button', { name: 'Exportar', exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as any).__printed)).toContain('Inicio');
  await page.emulateMedia({ media: 'print' });
  await expect(page.locator('#app')).toBeHidden();
  await expect(page.locator('#print-root')).toBeVisible();
});
