# 📚 QA / 버그 히스토리 관리 시스템 — 인덱스 & 운영 체계

> 마루의 가위바위보 프로젝트의 **영구 QA/버그/기능 이력 관리 시스템**.
> 모든 문서는 프로젝트 종료 시까지 유지·누적한다. 삭제·통합하지 않고 **확장**한다.
> 최초 구축: 2026-06-22

---

## 🗂️ 중요도 기준 분류 (Tier)

### 🔵 Tier 1 — 매일 확인 (개발 시작 전 반드시)
| # | 문서 | 역할 |
|---|---|---|
| 1 | [`/QA_STATUS.md`](../../QA_STATUS.md) | 현재 열린 버그 수 · Top10 위험 · GO/NO-GO 판정 |
| 2 | [`ACTIVE_ISSUES.md`](ACTIVE_ISSUES.md) | 살아있는 문제만 (P0~P3) |
| 3 | [`FEATURE_DECISION_HISTORY.md`](FEATURE_DECISION_HISTORY.md) | 기능 사양 결정 이력(번복 방지) |

### 🟡 Tier 2 — 버그 작업 시
| # | 문서 | 역할 |
|---|---|---|
| 4 | [`BUG_MASTER_LEDGER.md`](BUG_MASTER_LEDGER.md) | 전체 버그 마스터 DB (WRPS-NNN) |
| 5 | [`REGRESSION_TRACKER.md`](REGRESSION_TRACKER.md) | 재발/회귀 전용 + 회차 로그 |
| 6 | [`KNOWN_BEHAVIORS.md`](KNOWN_BEHAVIORS.md) | 버그로 오인되는 정상 동작 |

### 🟢 Tier 3 — 릴리즈 전
| # | 문서 | 역할 |
|---|---|---|
| 7 | [`RELEASE_QA_CHECKLIST.md`](RELEASE_QA_CHECKLIST.md) | 릴리즈 전 필수 확인(GO/NO-GO 게이트) |
| 8 | [`BUG_TIMELINE.md`](BUG_TIMELINE.md) | Build별 QA 히스토리(누적) |

---

## 👤 개발자가 매일 봐야 하는 문서 3개
1. **`QA_STATUS.md`** — 오늘 시작해도 되는 상태인가? (GO/NO-GO)
2. **`ACTIVE_ISSUES.md`** — 지금 살아있는 문제는?
3. **`FEATURE_DECISION_HISTORY.md`** — 내가 바꾸려는 기능, 과거에 결정된 적 있나?

---

## 🔁 워크플로별 진입점
- **개발 시작 전** → Tier 1 (3개)
- **버그 수정 중** → Tier 2 + 해당 `WRPS-NNN` 갱신
- **회귀 발견** → `REGRESSION_TRACKER.md` 회차 추가 + `ACTIVE_ISSUES.md` 승격
- **기능 변경** → `FEATURE_DECISION_HISTORY.md` 한 줄 추가
- **릴리즈 직전** → Tier 3 전 항목 통과 + `QA_STATUS.md` GO

---

## 📌 ID 체계
- 버그: `WRPS-NNN` (영구 불변, `BUG_MASTER_LEDGER.md` 관리)
- 정상동작: `KB-NN` (`KNOWN_BEHAVIORS.md`)
- 레거시 ID 매핑: `BUG-01~13`(Build3) → WRPS-022~034 / `BLOCKER-001`(Build5) → WRPS-038

---

## 🛠️ Build9+ 문서 유지 규칙
1. **새 Build 시작** → `BUG_TIMELINE.md`에 Build 섹션 추가, `QA_STATUS.md` 헤더(커밋/날짜) 갱신.
2. **버그 발견/수정** → `BUG_MASTER_LEDGER.md`에 행 추가/갱신(ID 불변), `ACTIVE_ISSUES.md` 동기화.
3. **회귀** → `REGRESSION_TRACKER.md` 회차 로그 + 위험도 분류.
4. **기능 변경** → `FEATURE_DECISION_HISTORY.md` 한 줄 추가(폐기는 상태만 변경, 삭제 금지).
5. **정상이나 오인되는 동작** → `KNOWN_BEHAVIORS.md` KB-NN 추가.
6. **릴리즈** → `RELEASE_QA_CHECKLIST.md` 통과 후 `QA_STATUS.md` GO/NO-GO 갱신.
7. **불변 원칙**: 문서 삭제·통합 금지(확장만). 버그 수정은 **독립 커밋**(squash 금지) — Lineage A 누락 재발 방지.
8. **문서 드리프트 점검**: 코드와 문서(특히 `GAME_LOGIC.md`)가 어긋나면 WRPS로 등록.
