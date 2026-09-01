// JP-TOKYO-REALTIME-001 전용 설정.
// ⚠️ 이 스위트는 **실제 Tokyo 프로덕션**에 일회용 행을 만든다. 기본 E2E 게이트와 분리한다.
//    실행: JP_TOKYO_REALTIME=1 npx playwright test --config=playwright.tokyo.config.mjs
export default {
  testDir: './tests/e2e',
  testMatch: /tokyo-realtime\.spec\.mjs/,
  timeout: 600000,
  actionTimeout: 20000,   // 무한 actionability 대기 방지
  workers: 1,
  fullyParallel: false,
  reporter: [['list']],
  retries: 0,
};
