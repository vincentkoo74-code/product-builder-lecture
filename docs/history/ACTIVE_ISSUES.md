# 🔴 ACTIVE ISSUES — 현재 살아있는 문제만

> **닫히지 않은 문제만** 우선순위별로 관리한다. 해결되면 이 문서에서 제거하고 `BUG_MASTER_LEDGER.md`에 `현재 상태=해결`로 기록한다.
> 기준 코드: `fix/build6-regression-recovery` (= build8) · 갱신: 2026-06-22 (Build8.1 코드 수정 + **TestFlight 업로드 완료**)

집계: **P0 0건 · P1 3건 · P2 3건 · P3 2건** (총 8건 미해결) · **Build8.1에서 3건 코드 수정**(WRPS-013/014/018, 실기기 검증 대기)

> 📦 **TestFlight: build 7 업로드 완료**(2026-06-22, Delivery UUID `8432a629-20d7-4320-bbac-0a5dcaaa2e7a`). ASC Processing 후 내부 테스터 실기기 QA 진행 → 통과 시 WRPS-013/014 종결.

---

## ✅ Build8.1 코드 수정 완료 (실기기 검증 대기 — 닫기 전 RELEASE_QA_CHECKLIST 3절 통과 필요)

- **WRPS-013** (구 P0) 재초대 수락 대기화면 고착 → `acceptInvite()` ready-aware 분기 + `fetchParticipants` 안전망(WRPS-018).
- **WRPS-014** (구 P1) 참가자 TTS 미재생 → `markReady()` 제스처 언락(빈 발화) 추가.
- **WRPS-018** (구 P2) participantWait 고착 복구 안전망 → `fetchParticipants` 3초 폴링 복구 추가.
- **WRPS-041** (구 P2) 자동시작 문서 드리프트 → `GAME_LOGIC.md` 정정.
> 위 4건은 **코드/문서상 수정 완료**이나, 실기기 멀티디바이스 검증 통과 전까지 `BUG_MASTER_LEDGER`에서 완전 종결(closed)하지 않는다.

---

## 🟥 P0 — 릴리즈 차단 (Release Blocker)

- **현재 없음.** (WRPS-013 Build8.1에서 수정, 실기기 검증 대기로 전환)

---

## 🟧 P1 — 주요 (Major)

### WRPS-015 — 카운트다운 기기간 시차 (late-arrival 보정 공백)
- **증상**: 늦게 이벤트를 받은 기기가 카운트다운 단계가 밀림.
- **현재 메커니즘**: `runCountdown`(6304)이 `getCountdownStartAt()`+`serverNow()`로 예정시각까지 대기 후 동시 시작. 단 이벤트가 예정시각 **경과 후** 도착하면 `waitMs<=40` → 스킵 없이 고정 sleep(900+700ms) 풀재생.
- **Lineage A 대안**: `commit_timestamp` 기준 `elapsedMs`만큼 카운트다운 **건너뛰기**(`145e954`) — late-arrival 보정.
- **상태**: 🟡 부분완화(대체구현 존재) · late-arrival skip 미적용

### WRPS-026 — 3인 호스트 빠짐 판정 프리즈 (실기기 미검증)
- **코드**: `startHostJudgeBackstop`(6362)로 `getCountdownStartAt()+11s` 백스톱 보장 — 로직 존재.
- **갭**: 런타임 동작이라 단위테스트 불가. **호스트가 우선안전/술래로 빠지는 재대결** 실기기 멀티디바이스 검증 미완(OPEN-01).
- **상태**: 🟡 코드 반영 · 실기기 검증 필수

### WRPS-036 — 다인전(3/4/5) 멀티디바이스 동기화 매트릭스 미완
- **갭**: `BUILD4_P0_QA_MATRIX` 9조합×6동작=54셀 실기기 결과 빈칸. 로직(소거/술래상한)은 단위테스트 통과하나 실시간 기기간 동기화 미검증.
- **상태**: 🟡 로직 OK · 실기기 매트릭스 미수행

### WRPS-037 — 자동 시작 stale-state 오발화 위험 (+ 문서 불일치)
- **현황**: `triggerReplayIfLastReady`(7879)가 활성 전원 ready 시 호스트 권위로 `startGame()` 자동 호출(Build4 정식 사양). `autoStartInFlight` 가드 있음.
- **위험**: 재대결 직후 폴링이 stale `is_ready/choice`를 덮어쓰면 `areAllActivePlayersReady()` 오판 → 조기/오발화 가능. Lineage A의 stale 정규화(WRPS-016/017)가 부분대체만 됨.
- **상태**: 🟡 설계상 의도 동작 · 경쟁조건 보강 검토 필요 · (문서 불일치 WRPS-041은 Build8.1에서 해소)

---

## 🟨 P2 — 부차 (Minor)

### WRPS-020 — 참가자 목록 표시 지연/깜빡임
- 실시간 INSERT 즉시 병합(`355a656`) 미반영 → 폴링 재조회 의존(최대 3초 지연/깜빡임).

### WRPS-034 — 영어/일어 모드 토스트 한글 하드코딩 잔존 (OPEN-02)
- 게임/역할 문구는 i18n화됐으나 토스트류 일부 한글 노출.

> ✅ WRPS-018(고착 안전망), WRPS-041(문서 드리프트)는 Build8.1에서 수정 완료 → 상단 "Build8.1 코드 수정 완료" 참조.

---

## 🟦 P3 — 개선/기능 (Low)

### WRPS-019 — 드롭된 참가자 ready/reinviting 상태 정리(gracePeriod) 미반영
### WRPS-021 — 대기실 1분 무조작 자동 로그아웃 [기능] 미도입

---

## 검증 게이트 요약 (릴리즈 전 반드시 실기기로 닫아야 할 것)
1. WRPS-013 재초대 수락 고착 — **Build8.1 수정됨**, 실기기 재현 검증 필요
2. WRPS-014 참가자 TTS — **Build8.1 수정됨**, iOS 실기기 검증 필요
3. WRPS-026 호스트 빠짐 프리즈 (P1) — 코드 OK, 실기기 미검증
4. WRPS-036 멀티디바이스 매트릭스 54셀 (P1) — 미수행
