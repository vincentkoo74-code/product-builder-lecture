# 🚦 QA_STATUS — 가장 먼저 확인하는 문서

> **개발 시작 전 · 디버그 시작 전 · 버전업 전 · 릴리즈 전, 항상 이 파일을 먼저 연다.**
> 상세는 `docs/history/`(BUG_MASTER_LEDGER / BUG_TIMELINE / ACTIVE_ISSUES / REGRESSION_TRACKER / RELEASE_QA_CHECKLIST / FEATURE_DECISION_HISTORY / KNOWN_BEHAVIORS / README).
>
> 최종 갱신: **2026-06-28 (Build8.4)** · 기준 브랜치: `fix/build6-regression-recovery` (iOS build 9 업로드됨, Build8.4는 10 업로드 예정)

---

## 📊 현재 열린 버그 수

| 우선순위 | 건수 | 비고 |
|---|---|---|
| **P0** | **0** | — |
| **P1** | **2** | WRPS-026(호스트 빠짐) · WRPS-036(멀티디바이스 매트릭스) |
| **P2** | **2** | WRPS-020 · WRPS-034 |
| **P3** | **2** | WRPS-019 · WRPS-021 |
| 합계(미해결) | 6 | + Build8.1/8.2 수정 다수(실기기 검증 대기) |

**실기기 PASS 종결**: WRPS-014(참가자 TTS). ⚠️ WRPS-015(카운트다운 동기화)는 **음성팩 후 재발→WRPS-047(Build8.4)로 추적**.
**Build8.2 코드 수정(실기기 재검증 대기)**: WRPS-042(전원 Ready 통일) · WRPS-043(다중 술래) · WRPS-013/018(재초대 고착).
**Build8.4 코드 수정(실기기 재검증 대기)**: 🔴 **WRPS-047(P0 카운트다운 동기화 회귀)** · WRPS-045/046(한국어 음성 혼재·2회재생) · WRPS-048(버튼음). codex-critic PASS·test 49/49.

> P1 표기 3건은 핵심 미검증 게이트 기준. WRPS-037은 설계상 의도 동작(경쟁조건 보강 검토).

---

## ♻️ 최근 회귀 버그 (Build8.1 처리)

- **수정 완료(실기기 검증 대기)**: WRPS-013(재초대 수락 고착), WRPS-014(참가자 TTS), WRPS-018(고착 안전망), WRPS-041(자동시작 문서 드리프트).
- **구조적 회귀 원인**: Lineage A(`fix-game-ready-button-bl7zf`) 미머지 → Build8.1에서 **국소 패턴만 선별 이식**(전체 머지 금지).
- **build8 마이그레이션 자체 회귀: 여전히 0건**(WRPS-040, 격리 유지).

---

## 🔝 Top 10 위험 버그

| # | ID | 문제 | 위험도 | 상태 |
|---|---|---|---|---|
| 1 | WRPS-013 | 재초대 수락 후 대기화면 고착 | High→**수정** | ✅ Build8.1 수정 · 실기기 검증 대기 |
| 2 | WRPS-014 | 참가자 단말 카운트다운 TTS 미재생 | High→**수정** | ✅ Build8.1 수정 · iOS 실기기 검증 대기 |
| 2.5 | WRPS-042 | 전원 Ready 시작 트리거 통일(호스트 시작 버튼 폐지) | Medium | 사양 확정 · 코드 불일치 → **Build8.2** |
| 3 | WRPS-026 | 3인 호스트 빠짐 판정 프리즈 | Medium | 코드OK · 실기기 미검증 |
| 4 | WRPS-036 | 다인전 멀티디바이스 매트릭스 54셀 미완 | Medium | 미수행 |
| 5 | WRPS-015 | 카운트다운 기기간 시차(late-arrival) | Medium | 부분완화 |
| 6 | WRPS-037 | 자동시작 stale-state 오발화 위험 | Medium | 보강 검토 |
| 7 | WRPS-018 | participantWait 고착 복구 안전망 | Low→**수정** | ✅ Build8.1 수정 |
| 8 | WRPS-020 | 참가자 목록 표시 지연/깜빡임 | Low | 미반영 |
| 9 | WRPS-034 | 영/일 모드 토스트 한글 잔존 | Low | 부분반영 |
| 10 | WRPS-041 | GAME_LOGIC.md 자동시작 문서 드리프트 | Low→**수정** | ✅ Build8.1 정정 |

---

## 🆕 이번 Build(8.1) 신규 버그
- **없음.** (코드 수정은 기존 누락분 이식이며 신규 회귀 미발견 — 문법/단위/빌드/싱크 통과.)

## ✅ 이번 Build(8.1) 해결 버그
- **WRPS-013 · WRPS-014 · WRPS-018**(코드) + **WRPS-041**(문서). 단 13/14는 실기기 검증 통과 시 최종 종결.

---

## 🚦 릴리즈 상태: **Build8.4 코드 수정 완료 · 빌드 미업로드(build 9→10 필요) · 실기기 QA 대기**

### Build8.4 코드 게이트 (2026-06-28 — 한국어 음성 실기기 QA 결과)
- ✅ **코드 수정 4건 독립 커밋**: WRPS-047(`db0d16a`,P0)·046(`8c8bc1d`)·045(`baebae2`)·048(`51d5c6a`).
- ✅ **codex-critic 재검토 PASS**(WRPS-046 HIGH·047 MEDIUM 지적 → 보정 → Review Correction Loop 통과, critical/high 0).
- ✅ npm test **49/49** · ✅ 인라인 JS 문법 OK · ✅ DB 스키마/RLS/Firebase/판정(game-logic.mjs) 무변경.
- ⏳ **빌드 번호 아직 9** — Build8.4 실기기 QA를 위해 **9→10 bump + Archive + TestFlight 업로드 필요**.

### (이전) Build8.3 (build 9) 업로드 완료
- ✅ TestFlight build **9**, Delivery UUID `eb3547e1-7df0-4879-81cb-d2d2f2a160b8`. (build 8=Build8.2, build 7=Build8.1)

### 다음: build 10 업로드 후 실기기 QA
- 신규 재검증: **WRPS-047(P0 카운트다운 동기화 — 멀티디바이스 매트릭스)** · WRPS-045/046(한국어 음성) · WRPS-048(버튼음 청취).
- 기존 재검증 대상: WRPS-044/043/042/013/018, 미검증 게이트 WRPS-026/036.
> 외부/스토어 릴리즈는 실기기 체크리스트(특히 WRPS-047 P0) 통과 전 **NO-GO**.

---

## 🧭 개발자 운영 규칙 (필수)
1. **개발 시작 전** → 이 파일(`QA_STATUS.md`) 확인
2. **버그 수정 시** → `docs/history/BUG_MASTER_LEDGER.md` 갱신(ID·상태)
3. **릴리즈 전** → `docs/history/RELEASE_QA_CHECKLIST.md` 전 항목 확인
4. **회귀 발생 시** → `docs/history/REGRESSION_TRACKER.md` 회차 추가
5. **기능 변경 시** → `docs/history/FEATURE_DECISION_HISTORY.md` 한 줄 추가
6. 버그 수정은 **독립 커밋**(squash 금지) — Lineage A 누락 재발 방지
