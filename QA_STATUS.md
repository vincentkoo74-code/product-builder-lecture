# 🚦 QA_STATUS — 가장 먼저 확인하는 문서

> **개발 시작 전 · 디버그 시작 전 · 버전업 전 · 릴리즈 전, 항상 이 파일을 먼저 연다.**
> 상세는 `docs/history/`(BUG_MASTER_LEDGER / BUG_TIMELINE / ACTIVE_ISSUES / REGRESSION_TRACKER / RELEASE_QA_CHECKLIST / FEATURE_DECISION_HISTORY / KNOWN_BEHAVIORS / README).
>
> 최종 갱신: **2026-06-22 (Build8.2)** · 기준 브랜치: `fix/build6-regression-recovery` (iOS build 7→8 예정)

---

## 📊 현재 열린 버그 수

| 우선순위 | 건수 | 비고 |
|---|---|---|
| **P0** | **0** | — |
| **P1** | **2** | WRPS-026(호스트 빠짐) · WRPS-036(멀티디바이스 매트릭스) |
| **P2** | **2** | WRPS-020 · WRPS-034 |
| **P3** | **2** | WRPS-019 · WRPS-021 |
| 합계(미해결) | 6 | + Build8.1/8.2 수정 다수(실기기 검증 대기) |

**실기기 PASS 종결**: WRPS-014(참가자 TTS) · WRPS-015(카운트다운 동기화).
**Build8.2 코드 수정(실기기 재검증 대기)**: WRPS-042(전원 Ready 통일) · WRPS-043(다중 술래, 호스트=플레이어) · WRPS-013/018(재초대 고착).

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

## 🚦 릴리즈 상태: **Build8.3 (build 9) TestFlight 업로드 완료 · 실기기 QA 대기**

### 빌드/아카이브/업로드 게이트 (2026-06-22 Build8.3)
- ✅ **ARCHIVE SUCCEEDED** · ✅ **IPA EXPORT SUCCEEDED**(`build/export-build8.3/WooriMaruRPS.ipa`)
- ✅ **TestFlight UPLOAD SUCCEEDED** — build **9**, Delivery UUID `eb3547e1-7df0-4879-81cb-d2d2f2a160b8`(API Key 8FCAM7NFRL). **충돌 없음.**
- ✅ npm test **49/49** · ✅ 블록 문법 OK · ✅ DB 스키마/RLS/Firebase 무변경
- (이전) build 8(Build8.2) `47873144-…`, build 7(Build8.1) `8432a629-…`.

### 다음: 실기기 QA (build 9 설치 후)
- ⏳ ASC **Processing** 완료 후 내부 테스터 설치 → 아래 체크리스트 수행.
- 재검증 대상: **WRPS-044(호스트 승계 목록 동기화)** · WRPS-043(다중 술래 1~N-1) · WRPS-042(전원 Ready 시작) · WRPS-013/018(재초대 고착).
- 미검증 게이트: WRPS-026(호스트 빠짐) · WRPS-036(멀티디바이스 매트릭스).
> Internal TestFlight 배포 **완료**. 외부/스토어 릴리즈는 실기기 체크리스트 통과 전 NO-GO.

---

## 🧭 개발자 운영 규칙 (필수)
1. **개발 시작 전** → 이 파일(`QA_STATUS.md`) 확인
2. **버그 수정 시** → `docs/history/BUG_MASTER_LEDGER.md` 갱신(ID·상태)
3. **릴리즈 전** → `docs/history/RELEASE_QA_CHECKLIST.md` 전 항목 확인
4. **회귀 발생 시** → `docs/history/REGRESSION_TRACKER.md` 회차 추가
5. **기능 변경 시** → `docs/history/FEATURE_DECISION_HISTORY.md` 한 줄 추가
6. 버그 수정은 **독립 커밋**(squash 금지) — Lineage A 누락 재발 방지
