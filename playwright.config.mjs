import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/e2e',
  // Tokyo Realtime 스위트는 **실제 프로덕션**에 쓴다 — 기본 게이트에서 제외한다.
  // 실행: JP_TOKYO_REALTIME=1 npx playwright test --config=playwright.tokyo.config.mjs
  testIgnore: /tokyo-realtime\.spec\.mjs/,
  testMatch: '**/*.spec.mjs',
  timeout: 90000,
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: { headless: true, actionTimeout: 15000 },
});
