# 🧭 WRPS-049 — v2 Event-Sourced 엔진 단계적 전환 (추적)

> 최종 목표: **Event-Sourced Server-Authoritative Real-Time Game Engine** 전면 적용.
> 원칙: 한 번에 대규모 전환 금지 · 각 단계 독립 커밋 · 각 단계 테스트 · 각 단계 QA 문서 갱신 ·
> 각 단계 목적/영향/리스크 기록 · **main merge 금지** · **TestFlight RC는 별도 승인 전까지 금지** · 모든 이슈 WRPS ID 추적.
> 브랜치: `feature/rps-v2-engine`(엔진 코어, RC에 스택) · 기준: `fix/build6-regression-recovery`(=build13 RC).

## 진행 순서 / 상태
| # | 단계 | 상태 |
|---|---|---|
| 1 | v2 engine core를 별도 브랜치/PR로 보존 | 🟢 **진행/완료(이 문서)** |
| 2 | client migration STEP1 (호스트 판정→엔진 섀도우) | ⬜ 대기 |
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
