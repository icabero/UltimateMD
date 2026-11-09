// Screenshots for the website and the README, taken from the real interface
// with invented vaults (demo.js). Run with `npm run screenshots`; they are not
// part of the normal test run.
import { expect, test, type Page } from '@playwright/test';

const OUT = 'site/img';
const SIZE = { width: 1280, height: 820 };

type View = 'visual' | 'edit' | 'split' | 'preview';
interface Setup {
  theme?: string;
  /** Tabs to restore, in order. */
  tabs: [path: string, view: View][];
  /** The tab shown; the last one when not given. */
  active?: string;
}

test.use({ viewport: SIZE, deviceScaleFactor: 1 });

async function start(page: Page, { theme = 'claro', tabs, active = tabs.at(-1)![0] }: Setup) {
  await page.route('https://api.github.com/**', (route) => route.fulfill({ status: 404 }));
  await page.addInitScript({ path: 'e2e/mock.js' });
  await page.addInitScript({ path: 'e2e/demo.js' });
  await page.addInitScript(
    ({ theme, tabs, active }) => {
      localStorage.setItem('ultimatemd.theme', JSON.stringify({ fixed: theme, light: 'claro', dark: 'oscuro' }));
      const open = tabs.map(([path, view]) => ({ vaultId: 'a', path, view }));
      localStorage.setItem('ultimatemd.session', JSON.stringify({ open, active: `a:${active}` }));
    },
    { theme, tabs, active },
  );
  await page.goto('/');
  // Every folder of the expedition open, as someone working in it would have it.
  const aside = page.locator('aside');
  await expect(aside.getByRole('button', { name: 'Inicio', exact: true })).toBeVisible();
  for (const [folder, child] of [['Bitácora', 'Día 01 - El Chaltén'], ['Logística', 'Calendario']]) {
    if (!(await aside.getByRole('button', { name: child, exact: true }).isVisible())) {
      await aside.getByRole('button', { name: folder, exact: true }).click();
    }
    await expect(aside.getByRole('button', { name: child, exact: true })).toBeVisible();
  }
  await settle(page);
}

/** Waits for diagrams to be drawn and the interface to stop moving. */
async function settle(page: Page) {
  // Previews live in shadow roots, which CSS :has() does not reach into.
  await page.waitForFunction(
    () => {
      const roots: (Document | ShadowRoot)[] = [document];
      for (const el of document.querySelectorAll('*')) if (el.shadowRoot) roots.push(el.shadowRoot);
      const blocks = roots.flatMap((r) => [...r.querySelectorAll('.diagram, .cm-v-diagram')]);
      return blocks.every((b) => b.querySelector('svg, .diagram-error'));
    },
    null,
    { timeout: 30_000 },
  );
  // Diagrams may be drawn again once the theme settles: wait until nothing changes.
  const snapshot = () =>
    page.evaluate(() =>
      [...document.querySelectorAll('*')].map((e) => e.shadowRoot?.innerHTML.length ?? 0).join() + document.body.innerHTML.length,
    );
  let before = '';
  for (let now = await snapshot(); now !== before; now = await snapshot()) {
    before = now;
    await page.waitForTimeout(1000);
  }
  await page.evaluate(() => document.fonts.ready);
  await page.mouse.move(SIZE.width - 1, SIZE.height - 1);
  await page.waitForTimeout(400);
}

const shot = (page: Page, name: string) => page.screenshot({ path: `${OUT}/${name}.png` });

/** In visual mode the line with the cursor shows its marks; this leaves it on an empty line. */
async function restCursor(page: Page) {
  await page.locator('.cm-content').focus();
  await page.keyboard.press('Control+Home');
  await page.keyboard.press('ArrowDown');
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await settle(page);
}

test('visual mode', async ({ page }) => {
  await start(page, { tabs: [['Inicio.md', 'visual']] });
  await restCursor(page);
  await shot(page, 'visual');
});

test('editor and preview side by side', async ({ page }) => {
  await start(page, { tabs: [['Inicio.md', 'visual'], ['Logística/Material.md', 'split'], ['Ruta.md', 'split']] });
  await shot(page, 'claro');
});

test('dark theme', async ({ page }) => {
  await start(page, {
    theme: 'oscuro',
    tabs: [['Inicio.md', 'visual'], ['Logística/Material.md', 'split'], ['Ruta.md', 'split'], ['Logística/Presupuesto.md', 'preview'], ['Logística/Calendario.md', 'preview']],
  });
  await shot(page, 'oscuro');
});

test('export dialog', async ({ page }) => {
  await start(page, { tabs: [['Inicio.md', 'visual'], ['Ruta.md', 'split'], ['Logística/Presupuesto.md', 'split']] });
  await page.keyboard.press('Control+e');
  // The PDF and Word previews come from the backend; HTML is drawn here, in the browser.
  await page.getByRole('group', { name: 'Formato' }).getByRole('button', { name: 'HTML' }).click();
  await page.getByRole('group', { name: 'Alcance' }).getByRole('button', { name: 'Vault' }).click();
  const preview = page.getByRole('dialog', { name: 'Exportar' });
  await expect(preview.locator('.html svg').first()).toBeVisible({ timeout: 30_000 });
  await settle(page);
  await shot(page, 'export');
});

test('diagram builder', async ({ page }) => {
  await start(page, { tabs: [['Logística/Material.md', 'split'], ['Inicio.md', 'edit']] });
  await page.locator('.cm-line', { hasText: 'Cruzar el paso' }).click();
  await page.getByRole('button', { name: 'Diagrama', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Editar diagrama' }).locator('svg').first()).toBeVisible({ timeout: 30_000 });
  await settle(page);
  await shot(page, 'diagramas');
});

test('theme picker', async ({ page }) => {
  await start(page, { tabs: [['Inicio.md', 'visual']] });
  await page.getByTitle('Ajustes y MCP').click();
  const settings = page.getByRole('dialog', { name: 'Ajustes' });
  await settings.getByRole('navigation').getByRole('button', { name: 'Apariencia' }).click();
  await settle(page);
  await settings.locator('.themes').screenshot({ path: `${OUT}/temas.png` });
});

const TABS = [['Inicio.md', 'visual'], ['Logística/Material.md', 'split'], ['Ruta.md', 'split'], ['Logística/Presupuesto.md', 'preview'], ['Logística/Calendario.md', 'preview'], ['Bitácora/Día 01 - El Chaltén.md', 'preview'], ['Bitácora/Día 09 - Paso del Viento.md', 'preview']] as [string, View][];

for (const [theme, path, view] of [
  ['rosa', 'Inicio.md', 'visual'],
  ['medianoche', 'Ruta.md', 'preview'],
  ['bosque', 'Logística/Material.md', 'split'],
  ['sepia', 'Bitácora/Día 01 - El Chaltén.md', 'preview'],
] as [string, string, View][]) {
  test(`theme ${theme}`, async ({ page }) => {
    const tabs = TABS.map(([p, v]) => [p, p === path ? view : v] as [string, View]);
    await start(page, { theme, tabs, active: path });
    if (view === 'visual') await restCursor(page);
    await shot(page, theme);
  });
}
