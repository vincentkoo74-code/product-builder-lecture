// known-red 전용 vitest 설정 — 릴리즈 회귀(npm test, 기본 include)와 분리 실행한다.
// *.red.mjs 는 기본 include 글롭(*.test.mjs) 에 걸리지 않으므로 여기서만 잡힌다.
export default { test: { include: ['tests/known-red/**/*.red.mjs'] } };
