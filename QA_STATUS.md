# 🚦 QA_STATUS — 가장 먼저 확인하는 문서

> **개발 시작 전 · 디버그 시작 전 · 버전업 전 · 릴리즈 전, 항상 이 파일을 먼저 연다.**
> 상세는 `docs/history/`(BUG_MASTER_LEDGER / BUG_TIMELINE / ACTIVE_ISSUES / REGRESSION_TRACKER / RELEASE_QA_CHECKLIST / FEATURE_DECISION_HISTORY / KNOWN_BEHAVIORS / README).
>
> 최종 갱신: **2026-06-22 (Build8.1)** · 기준 브랜치: `fix/build6-regression-recovery` (build8 기반, iOS build 7)

---

## 📊 현재 열린 버그 수

| 우선순위 | 건수 | 비고 |
|---|---|---|
| **P0** | **0** | (WRPS-013 Build8.1 수정, 실기기 검증 대기로 전환) |
| **P1** | **3** | WRPS-015 · WRPS-026 · WRPS-036 · WRPS-037 (오발화 위험) |
| **P2** | **2** | WRPS-020 · WRPS-034 |
| **P3** | **2** | WRPS-019 · WRPS-021 |
| 합계(미해결) | 8 | + Build8.1 수정 4건(실기기 검증 대기) |

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

## 🚦 릴리즈 가능 여부: **Internal TestFlight = 게이트 PASS(업로드 인증 대기) · 외부/스토어 = 조건부 NO-GO**

### 빌드/아카이브 게이트 (2026-06-22 Build8.1)
- ✅ 빌드 성공 · ✅ **ARCHIVE SUCCEEDED** · ✅ **IPA EXPORT SUCCEEDED**(`build/export-build8.1/WooriMaruRPS.ipa`, App Store 배포 서명)
- ✅ P0 코드 수정 완료(WRPS-013) · ✅ P0 릴리즈 차단 이슈 없음 · ✅ 게임 판정/Firebase 영역 무변경(diff 격리)
- ✅ npm test 39/39 · ✅ 코드 검색 5종 통과
- ⛔ **TestFlight 업로드 BLOCKED** — App Store Connect 자격증명(API 키 `.p8` 또는 app-specific password)이 환경에 없어 `altool` 인증 실패. **빌드 결함 아님, 인증 차단.**

### 미해결(실기기 검증 대기)
1. WRPS-013/014 코드 수정 완료, **실기기 멀티디바이스 검증 미수행**.
2. WRPS-026(호스트 빠짐)·WRPS-036(매트릭스 54셀) 실기기 미검증.

**업로드 재개 조건(사용자 1회 작업)**: ASC API 키(`~/.appstoreconnect/private_keys/AuthKey_XXXX.p8` + issuer/key id) 또는 app-specific password 제공 → IPA 업로드(아래 다음 조치 명령). build 번호 **7**이 기존 TestFlight와 충돌 시 8로 증가 후 재아카이브.
> Internal TestFlight 배포 자체는 게이트 PASS(검증 목적). 외부/스토어 릴리즈는 실기기 체크리스트 통과 전 NO-GO.

---

## 🧭 개발자 운영 규칙 (필수)
1. **개발 시작 전** → 이 파일(`QA_STATUS.md`) 확인
2. **버그 수정 시** → `docs/history/BUG_MASTER_LEDGER.md` 갱신(ID·상태)
3. **릴리즈 전** → `docs/history/RELEASE_QA_CHECKLIST.md` 전 항목 확인
4. **회귀 발생 시** → `docs/history/REGRESSION_TRACKER.md` 회차 추가
5. **기능 변경 시** → `docs/history/FEATURE_DECISION_HISTORY.md` 한 줄 추가
6. 버그 수정은 **독립 커밋**(squash 금지) — Lineage A 누락 재발 방지
