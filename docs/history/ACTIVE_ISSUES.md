# 🔴 ACTIVE ISSUES — 현재 살아있는 문제만

> **닫히지 않은 문제만** 우선순위별로 관리한다. 해결되면 이 문서에서 제거하고 `BUG_MASTER_LEDGER.md`에 `현재 상태=해결`로 기록한다.
> 기준 코드: `fix/build6-regression-recovery` (= build8) · 갱신: 2026-06-28 (**Build8.4** 코드 수정 — 한국어 음성 실기기 QA 결과)

집계: **P0 0건 · P1 2건 · P2 2건 · P3 2건** (총 6건 미해결) · Build8.2(042/043)·8.3(044)·**8.4(045/046/047/048)** 코드 수정(실기기 재검증 대기)

> ✅ **실기기 PASS 종결(Build8.1)**: WRPS-014(참가자 TTS) · WRPS-015(카운트다운 동기화) — 단 **WRPS-015는 음성팩 적용 후 재발 → WRPS-047(Build8.4)로 추적**.
> ✅ **Build8.4 코드 수정(실기기 재검증 대기)**: WRPS-047(P0 카운트다운 동기화 회귀) · WRPS-045/046(음성) · WRPS-048(버튼음). codex-critic 재검토 PASS, npm test 49/49.
> 📦 **TestFlight**: **Build8.4 = build 13 업로드 완료**(2026-06-28, Delivery UUID `f99e8308-…`, Processing VALID). Export 자동증가로 archive 10→IPA 13. (이전 Build8.3=build 9)

---

## ✅ Build8.4 코드 수정 완료 (한국어 음성 실기기 QA 결과 · 실기기 재검증 대기)

### WRPS-047 (P0) — 멀티단말 카운트다운 비동기 시작 → 보강 [회귀: WRPS-015 회차3]
- **원인**: HTTP `Date` 헤더 초단위 floor로 기기간 clock offset 최대 ~1s 오차 + realtime late-arrival 시 즉시 시작.
- **수정(`db0d16a`)**: `syncServerClock` +500ms 중앙보정·샘플 3→5, `getNextCountdownStartAt` lead 2800→3600ms, `runCountdown` sleep 캡 3000→4000. 판정/Firebase 무변경.
- **잔여**: 런타임 특성상 단위테스트 불가 → **실기기 멀티디바이스 매트릭스(BUILD4_P0_QA_MATRIX) 재검증 필수**. 닫기 전 NO-GO.

### WRPS-045 (P1) — 한국어 MC음성/TTS 혼재 → 수정
- `go`("가위바위보") 등 매핑 공백이 TTS 폴백 → intro(MC)와 혼재. `VOICE_SILENT` 센티넬로 `ko.go` 무음(풀구호 ko_game_start.mp3가 커버). MP3 이벤트는 speechSynthesis 미사용 보장. (`baebae2`)

### WRPS-046 (P1) — 게임 결과 음성 2회 재생 → 수정
- `finishRoundLocal` result→game_over 2회 호출 시 결과음성 무가드. `playResultVoiceOnce`(키=gameRound:round)로 1회. 새 게임/방 경계 3곳서 키 초기화. (`8c8bc1d`)

### WRPS-048 (P2) — 버튼 효과음 개선
- `playButtonClickSound` 합성음 재설계(sine 280→140Hz·lowpass·50ms) + 45ms 연타 디바운스. 음성과 별도 AudioContext. (`51d5c6a`)

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

## ✅ Build8.2 코드 수정 완료 (실기기 재검증 대기)

### WRPS-043 — 3인 게임 술래 2명 선택 불가 → 수정
- **원인**: `getMaxLoserCount`가 `(비호스트 수)−1`. 호스트 포함 3명 = 비호스트 2명 → 최대 1로 고정.
- **수정(Model P)**: 호스트도 플레이어 → `getMaxLoserCount = 전체 참가자 − 1`(`maxLoserCountFor`). `computePlayerStatuses` 호스트 특례 제거로 판정·소거에 호스트 포함 → 3명 술래 2 = 2술래+1승자(deadlock 없음). vitest 44 통과.

### WRPS-042 — 전원 Ready 시작 트리거 통일 → 수정
- `showReadyScreen`/`renderLobby` 호스트도 게임 준비 버튼 사용, `hostStartBtn`/`lobbyHostStartBtn` 폐지(숨김). 활성 전원(호스트 포함) ready 시 마지막 ready가 자동 시작.
- **잔여**: 호스트룸 초기 `startGameBtn`(setup→ready 진입)은 유지 — 게임 판정 무관, 후속 통일 검토.

> 위 2건 + WRPS-014/015(실기기 PASS)는 Build8.2 빌드로 실기기 재검증 후 최종 종결.

---

## ✅ Build8.3 코드 수정 완료 (실기기 재검증 대기)

### WRPS-044 — 호스트 승계 후 참가자 목록/HOST stale → 수정
- **확정**: Case A(DB 정상/UI 비정상) — Supabase REST 제어 테스트로 쓰기/RLS 정상·승계 후 DB 2행 정확 확인.
- **수정**: ① rooms realtime 리스너에 `scheduleFetchParticipants` 추가(방 변경=호스트 승계 시 확실히 발화) ② `handleRoomUpdate` 상태 전이 시 강제 재조회. 전체 재조회 → `state.participants` 교체 → `renderAll`(목록/HOST 배지 재계산)로 stale 제거. realtime participant DELETE 의존 제거.
- **원칙 준수**: DB 스키마/RLS/REPLICA IDENTITY/판정/Firebase 무변경. 기존 5s 폴링·realtime 유지(`scheduleFetchParticipants` 디바운스 재사용). 테스트 49 통과(WRPS-044 5건 신규).

---

## 🟧 P1 — 주요 (Major)

### WRPS-015 — 카운트다운 기기간 시차 → **실기기 PASS(Build8.1)**
- 2026-06-22 TestFlight 실기기에서 동기화 정상 확인 → **종결**. (late-arrival 보정 코드 미적용이나 실사용 문제 없음 확인)

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

## Build16 Device QA — OPEN (Triage 완료, Fix 미착수) 2026-07-01
> 원장: `docs/BUILD16_QA_PLAN.md`. Critical 10 + Evidence-gated 4 → Release NOT READY.
- **Critical(코드 Root Cause 확정)**: WRPS-053(UI권한), 054(invite), 055(join/leave audio), 056(room lifecycle), 061(결과화면 고착), 062(다중술래), 063(viewport)
- **Critical(Evidence-gated, build15 계측 선행)**: WRPS-058/059/060/064(sync drift·지연)
- **High**: WRPS-050(oauth), 051/052/057(audio), 065(QR), 066(닉네임), 067(직전결과)
- **Medium/Low(Build16 제외 polish)**: WRPS-068/069/070/071
