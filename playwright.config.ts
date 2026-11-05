import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'e2e',
  timeout: 20_000,
  use: { baseURL: 'http://localhost:1420' },
  webServer: { command: 'npx vite --port 1420 --strictPort', port: 1420, reuseExistingServer: true },
});
