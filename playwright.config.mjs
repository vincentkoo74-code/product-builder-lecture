import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/e2e',
  testMatch: '**/*.spec.mjs',
  timeout: 90000,
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: { headless: true, actionTimeout: 15000 },
});
