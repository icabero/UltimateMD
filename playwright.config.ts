import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'e2e',
  timeout: 30_000,
  // Rendering diagrams for an export can take this long on a CI machine.
  expect: { timeout: 15_000 },
  use: { baseURL: 'http://localhost:1420', locale: 'es-ES' },
  webServer: { command: 'npx vite --port 1420 --strictPort', port: 1420, reuseExistingServer: true },
});
