// JP-E2E-JWT-FIDELITY 전용 설정. 로컬 스택(보안 5종 적용) 대상 — 프로덕션 무접촉.
export default {
  testDir: './tests/e2e',
  testMatch: /jp-jwt-rls-fidelity\.spec\.mjs/,
  timeout: 60000,
  workers: 1,
  fullyParallel: false,
  reporter: [['list']],
};
