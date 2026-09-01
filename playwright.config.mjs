import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/e2e',
  // Tokyo Realtime 스위트는 **실제 프로덕션**에 쓴다 — 기본 게이트에서 제외한다.
  // 실행: JP_TOKYO_REALTIME=1 npx playwright test --config=playwright.tokyo.config.mjs
  testIgnore: /tokyo-realtime\.spec\.mjs/,
  testMatch: '**/*.spec.mjs',
  // 스위트가 커지면서(초대 15 + 인가 24 + Kakao 격리 7) 부하 상태의 개별 테스트가
  // 90초 예산에 걸리는 일이 생겼다. 어설션은 그대로 두고 예산만 늘린다 — 완화가 아니다.
  timeout: 180000,
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: { headless: true, actionTimeout: 15000 },
});
