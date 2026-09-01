# MARU RPS V1.0_JP — 출시 준비 측정 절차 (JP RELEASE GATE)

최종 갱신: 2026-09-01 (JP-ENTRY-INVITE-002)

JP 출시 준비 판정은 **아래 네 층을 모두 통과**해야 한다. 하나라도 실패하면 출시 준비 아님이다.
실패를 숨기거나 빠른 명령에서 제외해 "초록"을 만들지 않는다 — 층을 나눈 이유는
**실행 시간이 다르기 때문**이지 실패를 감추기 위해서가 아니다.

## 층 1 — 단위/통합 스위트

```
npm test        # vitest run --exclude 'tests/e2e/**'
```

가장 빠른 층. 로컬 반복 개발의 기본. 브라우저 E2E 는 Playwright 러너가 필요하므로 제외된다.

> 주의: 이 명령에는 rc3 시뮬레이션(층 3)이 포함된다 — 전체 실행에 약 40분이 걸린다.
> 빠른 반복에는 `npx vitest run --exclude 'tests/e2e/**' --exclude 'tests/rc3-multiparticipant-sim.test.mjs'` 를 쓰고,
> 게이트 판정에는 층 3 을 **단독으로** 따로 측정한다(아래 참조).

## 층 2 — CORE 회귀

층 1 에 포함된다. `nextRound` 카디널리티, 라운드 상태 기계, 판정 로직 등 KR/JP 공용 동작.
JP 작업이 CORE 를 건드렸다면 이 층의 결과를 보고서에 **명시적으로** 분리해 기재한다.

## 층 3 — rc3 권위(strict) 스위트

```
npx vitest run tests/rc3-multiparticipant-sim.test.mjs
```

`strictFilters` 가 **권위·릴리스 게이팅 모드**다(JP-BL-027-D). legacy 는 과거 참조 전용이며
게이트에 쓰지 않는다.

**측정 규율:** rc3 는 타이밍 측정 스위트다. 다른 작업(다른 테스트 실행, 파일 편집, 빌드)과
**동시에 돌리지 않는다.** 과거에 동시 실행으로 측정이 오염된 전례가 있다.

판정 기준: 0행 오류 0건, 타임아웃 0건, 그리고 실패 건수가 확립된 기준선을 넘지 않을 것.
현재 기준선의 잔여 실패는 `JP-H1A-STRICT-CALIBRATION` 으로 추적 중이다.

## 층 4 — JP 브라우저 E2E  ← **JP-ENTRY-INVITE-002 이후 공식 게이트**

```
npm run test:e2e     # playwright test --config=playwright.config.mjs
```

실제 브라우저에서 **실제 앱 DOM/네비게이션**을 구동한다. 단위 테스트가 각 계층을 개별
검증하며 전부 통과하는 동안에도 **계층 사이의 순서 결함**은 잡히지 않는다 —
JP-ENTRY-INVITE-002 가 정확히 그 사례였고, 이 층이 그것을 발견했다.

필요 환경(사전 준비):
- 로컬 PostgreSQL + PostgREST (저장소 마이그레이션 적용) — 포트는 `tests/e2e/harness.mjs` 참조
- Playwright 브라우저. 로컬에 headless shell 이 없어 현재는 시스템 Chrome 채널을 쓴다(I1 환경 제약)

**커버리지:** 보안 토큰 발급·영속, 짧은 방 코드 비노출, 신원 없는 초대자의 보류→합류,
새로고침 복구(소비 전/후), 멱등성(중복 참가자·중복 방 없음), 오류 4종, 그리고
준비 → 카운트다운 → **실제 1라운드**.

### 층 4 의 현재 한계 — JP-E2E-JWT-FIDELITY

하니스는 프로덕션 anon JWT 서명을 로컬에서 검증할 수 없어 인증 헤더를 벗겨 `db-anon-role`
로 처리한다. 따라서 이 층은 **앱 통합·DOM/네비게이션·초대 흐름·게임 경로**를 검증하지만
**실제 JWT 검증과 최소권한 GRANT/RLS 강제력은 검증하지 않는다.**

현재 Tokyo RLS 가 allow-all 이라 anon 권한이 게스트 플레이와 동등해 게임 검증에는 영향이
없다. 그러나 **Tokyo 보안 5종이 배포되면 이 등가성이 깨진다** — 배포 전에
`JP-E2E-JWT-FIDELITY` 를 해소하거나 별도 검증 경로를 확보해야 한다.

## 층 4-보조 — Tokyo Realtime 검증 (게이트 아님, 명시 승인 실행)

```
JP_TOKYO_REALTIME=1 npx playwright test --config=playwright.tokyo.config.mjs
```

⚠️ **실제 Tokyo 프로덕션에 일회용 행을 만든다.** 그래서 기본 게이트가 아니다 —
env 가드와 설정(`testIgnore`) 이중으로 분리해 둔다.

실행 규칙:
- 일회용 마커만 만든다(참가자명 `zz_jprt_*`, 벌칙 `ZZ_<test-id>`), 만든 행만 지운다
- 실행 전후로 psql 스냅샷(행 수·md5·정책 수·마이그레이션 원장·publication)을 대조한다
- 과거 행, `user_game_stats`, `user_game_history`, `auth.users` 는 읽지도 쓰지도 않는다

측정 규율: **채널이 PostgreSQL 구독을 마친 뒤에 써야** 전송 성능을 측정한다.
구독 완료 이전 커밋은 Realtime 이 재생하지 않으므로(전송 특성), 그 구간을 섞으면
전송이 아니라 경합을 측정하게 된다.

보안 5종 배포 후에는 이 검증을 **동등하게 다시** 수행해야 한다(현재는 PRE-SECURITY 기준선).

## 보고 형식

각 층의 **정확한 수치**(파일 수 / 통과 / 실패 / 스킵 / 소요 시간)를 그대로 기재한다.
"대부분 통과" 같은 표현을 쓰지 않는다. 알려진 실패는 추적 ID 와 함께 기재한다.
