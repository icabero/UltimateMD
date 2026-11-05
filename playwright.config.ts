import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'e2e',
  fullyParallel: true,
  workers: 2,
  timeout: 20_000,
  use: { baseURL: 'http://localhost:1420', locale: 'es-ES' },
  webServer: { command: 'npx vite --port 1420 --strictPort', port: 1420, reuseExistingServer: true },
});
