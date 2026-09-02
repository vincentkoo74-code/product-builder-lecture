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

> **HTML 구문 게이트 트립와이어(JP-02C).** `scripts/check-html-syntax.mjs` 의
> `HTML_SYNTAX_TARGETS` 는 `index.html` 의 인라인/외부 `<script>` **개수를 고정**한다.
> 블록을 추가·삭제하면 7건이 한꺼번에 FAIL 한다. 이는 결함이 아니라 설계된 경보다 —
> 검사 커버리지가 조용히 달라지는 것을 막는다. 의도적 변경이면 대상 수를 갱신하고,
> **새 블록이 실제로 파싱되는지 뮤테이션으로 확인**한 뒤 통과시킨다.
> (2026-09-02: 로케일별 폰트 주입 스크립트 추가로 인라인 2 → 3.)

## 층 2 — CORE 회귀

층 1 에 포함된다. `nextRound` 카디널리티, 라운드 상태 기계, 판정 로직 등 KR/JP 공용 동작.
JP 작업이 CORE 를 건드렸다면 이 층의 결과를 보고서에 **명시적으로** 분리해 기재한다.

## 층 3 — rc3 권위(strict) 스위트

```
npm run test:rc3          # ← 공식 측정 명령 (직렬화 가드 포함)
```

`strictFilters` 가 **권위·릴리스 게이팅 모드**다(JP-BL-027-D). legacy 는 과거 참조 전용이다.

⚠️ **`npx vitest run tests/rc3-multiparticipant-sim.test.mjs` 직접 호출은 디버깅 전용이며
공식 릴리스 측정이 아니다.** 가드를 우회하기 때문이다(JP-RC3-FIELD-LATENCY-001 §15).

가드(`scripts/rc3-measure.mjs`)가 하는 일:
- 시작 전 `pgrep -f rc3-multiparticipant-sim` 로 경합 탐지 → 있으면 **fail-closed**
- 머신 전역 락(워크트리가 달라도 감지) + 죽은 락 안전 회수
- 피어·사용자 프로세스를 **절대 죽이지 않는다**
- 종료 시 재확인 → 실행 중 경합이 있었으면 `INVALID — MACHINE CONTENTION`

**경합 측정은 무효다.** 실측 대비: 동시 3개 = 11 실패/3591.95s/타임아웃 7,
단독 = 10 실패/~2450s/타임아웃 0. 부하를 이유로 임계값을 낮추지 않는다.

판정 기준: 0행 오류 0건, 타임아웃 0건, 실패 수가 확립된 기준선을 넘지 않을 것.
현재 기준선의 잔여 실패 10건은 `JP-H1A-STRICT-CALIBRATION` 으로 추적한다(전량 H1 분류).

## 층 4 — JP 브라우저 E2E  ← **JP-ENTRY-INVITE-002 이후 공식 게이트**

```
npm run jp:e2e:bootstrap     # 로컬 스택 구성(보안 5종 적용 + JWT 검증)
npm run test:e2e             # 게이트 실행
npm run jp:e2e:teardown      # 정리(로컬 전용 비밀 삭제). 전부 지우려면 -- --purge
```

부트스트랩은 깨끗한 PostgreSQL 클러스터를 만들고, 플랫폼(롤/`auth` shim/publication)을
재현한 뒤, 저장소 마이그레이션 전량을 적용하고, JWT 를 실제로 검증하는 PostgREST 를 띄운다.
**서명 비밀과 DB 비밀번호는 실행 시점에 난수로 생성**되어 `.jp-e2e/`(gitignore)에만 존재하고,
teardown 이 지운다. 프로덕션·Tokyo·Seoul 자격증명을 일절 쓰지 않는다.

스택이 없으면 스위트는 **무엇을 해야 하는지 말하면서 fail-closed 로 멈춘다** —
권한이 우회된 채 초록이 되는 경로를 만들지 않는다.

**JP-E2E-JWT-FIDELITY 이후 이 층은 실제 인가를 검증한다.** 인증 헤더를 벗기지 않는다 —
경계에서 **로컬 서명 토큰으로 치환**하고, PostgREST 가 서명을 실제로 검증하며,
목표 GRANT/RLS 가 강제된다. 비밀이 없으면 스위트가 **fail-closed 로 중단**한다
(권한을 우회한 채 초록이 되는 경로를 남기지 않는다).

⚠️ **프로덕션 서명 재료를 로컬에 복사하지 않는다.** 로컬 전용 비밀만 쓰고 저장소에 두지 않는다.

실제 브라우저에서 **실제 앱 DOM/네비게이션**을 구동한다. 단위 테스트가 각 계층을 개별
검증하며 전부 통과하는 동안에도 **계층 사이의 순서 결함**은 잡히지 않는다 —
JP-ENTRY-INVITE-002 가 정확히 그 사례였고, 이 층이 그것을 발견했다.

필요 환경(사전 준비):
- 로컬 PostgreSQL + PostgREST (저장소 마이그레이션 적용) — 포트는 `tests/e2e/harness.mjs` 참조
- Playwright 브라우저. 로컬에 headless shell 이 없어 현재는 시스템 Chrome 채널을 쓴다(I1 환경 제약)

**커버리지:** 보안 토큰 발급·영속, 짧은 방 코드 비노출, 신원 없는 초대자의 보류→합류,
새로고침 복구(소비 전/후), 멱등성(중복 참가자·중복 방 없음), 오류 4종, 그리고
준비 → 카운트다운 → **실제 1라운드**.

### 층 4 의 로컬 스택 (보안 5종 적용 상태)

> **2026-09-01 갱신:** 보안 5종은 **Tokyo 프로덕션에 배포 완료**됐다(원장 7행).
> 따라서 이 층은 더 이상 "미래의 Tokyo"가 아니라 **현재의 Tokyo 와 같은 보안 상태**를 검증한다.

이 층은 **Tokyo 배포 예정인 보안 5종이 이미 적용된** 로컬 PostgreSQL/PostgREST 를 대상으로 한다.
즉 게이트는 "지금의 Tokyo"가 아니라 **"보안 적용 후의 Tokyo"** 를 기준으로 앱을 검증한다.

구성:
- PostgreSQL 17 (:55601), 데이터베이스 `jp_sec`
- 플랫폼 재현 bootstrap(롤 anon/authenticated/service_role/authenticator, `auth` 스키마와
  `auth.uid()/role()/jwt()` shim) → 저장소 마이그레이션 10종 순차 적용
- PostgREST 16 (:55702), `jwt-secret` = 로컬 전용 비밀, `db-anon-role = anon`

토큰 2종만 쓴다:
- **anon** — JP 게스트 플레이의 프로덕션 롤을 그대로 유지한다(테스트 편의로 authenticated 로 바꾸지 않는다)
- **authenticated** (`sub` = 소유자 uuid) — 통계/이력 소유자 범위 경로용

DB 초기화는 관리자 경로(psql)로 한다 — 목표 GRANT 에서 `rooms` DELETE 는 클라이언트 롤에 없고,
그걸 우회하려고 권한을 열지 않는다.

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

보안 5종 배포 후 재검증을 **완료했다**(2026-09-01, JP-TOKYO-SECURITY-DEPLOY-001):
전 시나리오 REALTIME 도달, 폴링 구제 0건, 3라운드 완주.

⚠️ 배포 이후 anon 은 `rooms` DELETE 권한이 없다. 일회용 방 행 정리는 관리자 경로가 필요하며,
`JP_TOKYO_ADMIN_URI` 로 주입한다(저장소에 두지 않는다). 참가자는 종전대로 anon 경로로 지운다.

## 보고 형식

각 층의 **정확한 수치**(파일 수 / 통과 / 실패 / 스킵 / 소요 시간)를 그대로 기재한다.
"대부분 통과" 같은 표현을 쓰지 않는다. 알려진 실패는 추적 ID 와 함께 기재한다.
