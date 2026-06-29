# 🧭 WRPS-049 — v2 Event-Sourced 엔진 단계적 전환 (추적)

> 최종 목표: **Event-Sourced Server-Authoritative Real-Time Game Engine** 전면 적용.
> 원칙: 한 번에 대규모 전환 금지 · 각 단계 독립 커밋 · 각 단계 테스트 · 각 단계 QA 문서 갱신 ·
> 각 단계 목적/영향/리스크 기록 · **main merge 금지** · **TestFlight RC는 별도 승인 전까지 금지** · 모든 이슈 WRPS ID 추적.
> 브랜치: `feature/rps-v2-engine`(엔진 코어, RC에 스택) · 기준: `fix/build6-regression-recovery`(=build13 RC).

## 진행 순서 / 상태
| # | 단계 | 상태 |
|---|---|---|
| 1 | v2 engine core를 별도 브랜치/PR로 보존 | 🟢 **진행/완료(이 문서)** |
| 2 | client migration STEP1 (호스트 판정→엔진 섀도우) | 🟡 진행중 — 2.1 번들러 ✅ / 2.2a 주입(inert) ✅ / 2.2b 섀도우 ⬜ |
| 3 | audio event reaction 전환 | ⬜ 대기 |
| 4 | sync/host/result flow server-authoritative 전환 | ⬜ 대기(전송계층 C/B/A 결정 필요) |
| 5 | 실기기 QA | ⬜ 대기 |
| 6 | PR review | ⬜ 대기 |
| 7 | release candidate | ⬜ 대기(별도 승인) |

## 미결정 게이트
- **전송계층**: C(엔진=호스트두뇌, 무스키마·권장) / B(호스트 브로드캐스트) / A(game_events 신규테이블, **DB 스키마/RLS 승인 필요**). STEP4 전제.

---

## STEP 1 — v2 engine core 보존 (브랜치/PR 분리)
- **변경 파일**: (신규, 라이브 무변경)
  - `engine/events.mjs · EventBus.mjs · EventLog.mjs · GameEngine.mjs · index.mjs · client-binding.mjs · adapters/supabase.mjs`
  - `tests/engine.test.mjs · engine-adapter.test.mjs · engine-e2e.test.mjs`
  - `docs/history/V2_MIGRATION.md`(본 문서)
- **변경 목적**: 검증된 엔진 코어(67→72/72)를 막힌 RC PR과 분리해 독립 보존·리뷰. 라이브 코드 오염 방지.
- **영향 범위**: 0(추가 모듈만). `index.html`·iOS·`main`·DB 무변경. 엔진은 `src/game-logic.mjs` 판정 규칙 재사용(변경 0).
- **테스트 결과**: 72/72 PASS · `build:web` OK.
- **남은 리스크**: LOW(추가·무회귀). 단 `game-logic.mjs`가 main에 없어 엔진 PR은 main이 아닌 **RC 브랜치에 스택**(base=`fix/build6-regression-recovery`).
- **다음 단계**: STEP 2 — `finishRoundLocal` 등 호스트 판정을 엔진으로 **섀도우 계산**(flag OFF, 기존 결과와 대조만, 동작 무변경).
- **rollback**: `git branch -D feature/rps-v2-engine`(브랜치 폐기) + 원격 PR close. 라이브/RC/main 영향 없으므로 즉시 무해 복구.

---

## STEP 2 — client migration STEP1 (호스트 판정 → 엔진 섀도우)
대규모 주입 전에 안전 슬라이스로 분할: **2.1 번들러 → 2.2 주입+섀도우(flag OFF)**.

### STEP 2.1 — 엔진 인라인 번들러 (index.html 무변경)
- **변경 파일**: `scripts/sync-engine.mjs`(신규), `tests/engine-bundle.test.mjs`(신규).
- **변경 목적**: 엔진(.mjs 모듈)을 인라인 `<script>`에 넣을 단일 IIFE 번들로 변환·검증. game-logic 패턴과 동일하게 index.html 인라인 스코프에서 동작하도록 준비.
- **영향 범위**: 0(추가 모듈만). `index.html`·`build:web`·iOS·DB 무변경. 번들은 아직 어디서도 사용 안 함(inert).
- **테스트 결과**: 76/76 PASS. 신규 4케이스 — 모듈구문 잔존 0, 공개 API 노출, **인라인 번들+game-logic 결합 라운드 판정 정확(h:win/a:lose)**, replay 일치.
- **남은 리스크**: LOW. index.html 주입(2.2) 시 ~900줄 인라인 추가 예정이라, 주입 후 인라인 JS 문법검증·동작무변경 확인 필수.
- **다음 단계**: STEP 2.2 — `sync-engine`를 build에 연결, index.html에 `/*__ENGINE_V2_START/END__*/` 마커 주입, `RPSEngineV2` 전역 노출(inert). 이어서 `finishRoundLocal`에 **flag OFF 섀도우 판정+대조 로깅**(동작 무변경).
- **rollback**: 두 신규 파일 삭제(`git rm scripts/sync-engine.mjs tests/engine-bundle.test.mjs`) 또는 커밋 revert. 라이브 무영향.

### STEP 2.2a — 엔진 주입(inert, flag OFF)
- **변경 파일**: `index.html`(+13줄: 마커+flag+가드 init), `scripts/sync-engine.mjs`(syncEngine 추가), `scripts/build-web.mjs`(dist 주입 연결), `docs/history/V2_MIGRATION.md`.
- **변경 목적**: 엔진을 런타임에 "사용 가능"하게 만들되 **어떤 동작도 바꾸지 않음**. dist 빌드에만 번들 주입(`RPSEngineV2` 전역), `__engineV2` 인스턴스 생성. `ENGINE_V2_ENABLED=false`·`ENGINE_V2_SHADOW=false` 기본 OFF.
- **영향 범위**: 라이브 root index.html은 마커/flag/가드 init만(+13줄). 번들(~900줄)은 **dist(gitignore)에만** 주입 → 커밋 diff 최소. game 흐름(startGame/finishRoundLocal/countdown/audio) **미연결**. legacy 100% 유지.
- **테스트 결과**: 76/76 PASS. root·dist 인라인 JS 문법 OK. dist 엔진 주입 1, root 0(inert).
- **남은 리스크**: LOW. 엔진 IIFE는 parse 시 실행되나 createEngine만(부수효과 0, game-logic 미호출), STEP2.1 실평가 테스트로 안전 입증. `typeof RPSEngineV2` 가드로 미주입 환경 무해.
- **다음 단계**: STEP 2.2b — `finishRoundLocal`에 **`ENGINE_V2_SHADOW` 게이트 섀도우 판정 + 기존 결과 대조 로깅**(동작 무변경). 이후 STEP3(audio)·STEP4(권위 전환, 전송계층 결정 후).
- **rollback**: `git revert <STEP2.2a 커밋>`. flag OFF라 되돌려도 동작 동일. 라이브/RC/main 무영향.
