import { defineConfig } from '@playwright/test';

// E2E_PORT lets several copies of the repo run their tests at once, each
// against its own server.
const port = Number(process.env.E2E_PORT ?? 1420);

export default defineConfig({
  testDir: 'e2e',
  // Screenshots for the website run on their own: npm run screenshots.
  testIgnore: 'screenshots.spec.ts',
  timeout: 30_000,
  // Rendering diagrams for an export can take this long on a CI machine.
  expect: { timeout: 15_000 },
  use: { baseURL: `http://localhost:${port}`, locale: 'es-ES' },
  webServer: { command: `npx vite --port ${port} --strictPort`, port, reuseExistingServer: true },
});
