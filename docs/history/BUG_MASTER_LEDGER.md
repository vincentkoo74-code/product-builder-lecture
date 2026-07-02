# 🗂️ BUG MASTER LEDGER — 마루의 가위바위보

> **프로젝트 영구 버그 마스터 DB.** 프로젝트 종료 시까지 유지·누적한다.
> 최초 복원: 2026-06-22 (Build1~Build6 QA 전수조사 기반) · 복원자: Claude (Opus 4.8 1M)
> ⚠️ 버그를 수정/발견할 때마다 이 표를 **반드시** 갱신한다. 새 항목은 `WRPS-NNN` 다음 번호를 부여한다.

---

## 0. 사용 규칙

1. **ID는 영구 불변**(`WRPS-001`…). 한 번 부여하면 재사용·재배치 금지.
2. 한 버그가 여러 번 재발하면 **같은 ID 유지** + `재발 여부=YES` + `REGRESSION_TRACKER.md`에 회차 기록.
3. `현재 반영 여부` 5분류: **유지됨 / 대체구현 / 미반영 / 회귀 / 문서드리프트**.
4. 우선순위: **P0**(릴리즈 차단) · **P1**(주요) · **P2**(부차) · **P3**(개선/기능).
5. 빌드 넘버링: Build2=첫 TestFlight · Build3~6=QA 안정화 · Build7(=Build8 코드명)=Firebase 마이그레이션.

---

## 1. 빌드 계보 (Lineage) — 회귀 이해의 핵심

```
b07d0e3 (05-17 "all bug fixes")  ← 공통 조상
   ├── Lineage A  claude/fix-game-ready-button-bl7zf (05-18)
   │     └── replay/countdown 버그 7건 수정 → ❌ 본류에 한 번도 머지 안 됨 (폐기)
   │
   └── Lineage B  main → … → 7fb82d2(06-02) → ded6154(build6, 06-21) → build8(35cd68d)
         └── Build3/4/5 QA로 ready/start/countdown 전면 재구현 (출시 본류)

build8 = build6 + 격리된 Firebase 스캐폴딩(+36줄). 게임 로직 byte 동일 → build8 회귀 0.
```
- `git merge-base build8 fix-game-ready-button` = `b07d0e3` (검증됨).
- git **태그 없음**. 모든 Build3~6 QA가 단일 커밋 `ded6154`로 squash(증분 커밋 부재) → Lineage A 머지 누락의 근본 은폐 원인.

---

## 2. 마스터 원장 (Master Ledger)

| ID | 문제명 | 최초 Build | 최초 날짜 | 수정 Build | 수정 커밋 | 재발 | 재발 Build | 현재 반영 | 현재 상태 | 우선순위 |
|---|---|---|---|---|---|---|---|---|---|---|
| WRPS-001 | 모달 버튼 텍스트 좌측 치우침 | B2(pre-3) | 2026-06-04 | pre-3 | FIXES.md(미커밋) | NO | — | 유지됨 | 정상 | P3 |
| WRPS-002 | 라운드 시작 로직 불일치 + 호스트 `gameStarting` 타이밍으로 호스트만 미시작 | B2(pre-3) | 2026-06-06 | pre-3 | FIXES.md | NO | — | 유지됨(진화) | 정상 | P1 |
| WRPS-003 | 통계 이중집계(무승부 재대결 직후) | B2(pre-3) | 2026-06-06 | pre-3 | FIXES.md | NO | — | 유지됨 | 정상(`hasConfirmedRoundResult`×6) | P1 |
| WRPS-004 | 첫 대결 game_over 오판(`prevLoserIds` 오염) | B2(pre-3) | 2026-06-06 | pre-3 | FIXES.md | NO | — | 유지됨 | 정상(`hasAnyMarkers`) | P1 |
| WRPS-005 | 화면 깜빡임 ready↔대기(3초 폴링이 is_ready 리셋) | B2 | 2026-05-20 | B2 | a541007 / 0d184b5 | NO | — | 유지됨 | 정상 | P1 |
| WRPS-006 | 호스트 활성참가자 제외/포함 혼란(게임 멈춤) | B2 | 2026-05-20 | B2 | dcbafda / 19263cd | NO | — | 유지됨 | 정상(심판 모델 확정) | P1 |
| WRPS-007 | 호스트 벌칙 수정 시 참가자 화면 미동기화 | B2 | 2026-05-20 | B2 | 459c210 | NO | — | 유지됨 | 정상 | P2 |
| WRPS-008 | 호스트 게임화면 미표시 + 참가자 5초 타이머 무동작 | B2 | 2026-05-20 | B2 | ed21c83 | NO | — | 유지됨 | 정상 | P1 |
| WRPS-009 | 게임완료 후 호스트 로비우회 복귀 + 호스트전환 race | B2 | 2026-05-21 | B2 | eb54a86 | NO | — | 유지됨 | 정상 | P2 |
| WRPS-010 | 다음게임 호스트 5초 카운트다운 자동진행 차단 | B2 | 2026-05-20 | B2 | 713eb4d | NO | — | 유지됨 | 정상 | P2 |
| WRPS-011 | 무승부 후 자동 재경기 진행(→수동 전환) | B2 | 2026-05-20 | B2 | fce00c7 / 3c0ee3a | **YES(정책)** | B4 재채택 | 대체구현 | WRPS-037 참조(자동시작 재도입) | P2 |
| WRPS-012 | replay(한판더) 후 ready 버튼 깜빡임 | Lineage A | 2026-05-18 | (미머지) | 94a3344 | — | — | 대체구현 | Lineage B(WRPS-005)가 독립 해결 | P2 |
| WRPS-013 | 재초대 수락 후 status=ready인데 **대기화면 고착**(참가자 게임 진행 불가) | Lineage A | 2026-05-18 | **Build8.1 (2026-06-22)** | 9b7ff2e→선별이식 | — | — | **수정반영** | `acceptInvite` ready-aware로 수정 + WRPS-018 안전망 — 실기기 검증 대기 | P0→수정됨 |
| WRPS-014 | 게임 시작 시 **참가자 단말 카운트다운 TTS 미재생**(호스트만 재생) | Lineage A | 2026-05-18 | **Build8.1 (2026-06-22)** | 4a8cbda→선별이식 | — | — | **수정반영** | `markReady`에 제스처 언락(빈 발화) 추가 — iOS 실기기 검증 대기 | P1→수정됨 |
| WRPS-015 | 게임 시작 시 참가자 화면 간 카운트다운 시차(time lag) | Lineage A | 2026-05-18 | (미머지) | 145e954 | — | — | 대체구현 | `serverNow`/`countdownStartAt`로 대체, **late-arrival 보정 공백** | P1 |
| WRPS-016 | round=1에서 `isConfirmedLoser`/`isSafe` choice 폴백 race | Lineage A | 2026-05-18 | (미머지) | fc00595 | — | — | 부분대체 | ready전환 fresh refetch로 부분 방어 | P2 |
| WRPS-017 | round=1 ready 시 stale choice 정규화(게임준비 버튼 오탐) | Lineage A | 2026-05-18 | (미머지) | 329bd54 | — | — | 부분대체 | `handleRoomUpdate` fresh refetch(5059)로 부분 방어 | P2 |
| WRPS-018 | `screenParticipantWait` 고착 안전망 | Lineage A | 2026-05-18 | **Build8.1 (2026-06-22)** | 065af4c→선별이식 | — | — | **수정반영** | `fetchParticipants` 3초 폴링 복구 안전망 추가 | P2→수정됨 |
| WRPS-019 | 드롭된 참가자 ready/reinviting 상태 미정리 | Lineage A | 2026-05-18 | (미머지) | 9ce864b | — | — | 미반영 | gracePeriod 정리 부재 | P3 |
| WRPS-020 | 참가자 INSERT 실시간 병합 미구현(표시 지연/깜빡임) | Lineage A | 2026-05-18 | (미머지) | 355a656 | — | — | 미반영 | 폴링 재조회 의존(최대 3초 지연) | P2 |
| WRPS-021 | 대기실 1분 무조작 자동 로그아웃 **[기능]** | Lineage A | 2026-05-18 | (미머지) | 4e3e1f3 | — | — | 미반영 | 기능 미도입 | P3 |
| WRPS-022 | 자동선택 시 실제 승/패인데 **무승부 오표시** (BUG-01) | Build3 | 2026-06-12 | B3 | ded6154(squash) | NO | — | 유지됨 | 정상(`autoFillChoices` DB 재조회) | P0 |
| WRPS-023 | 게임 중 승률에 **현재 라운드만** 표시 (BUG-02) | Build3 | 2026-06-12 | B3 | ded6154 | NO | — | 유지됨 | 정상(`buildRoomStatsSummary`×3) | P0 |
| WRPS-024 | 게임 종료 후 홈 → **직전 게임 결과 없음** (BUG-03) | Build3 | 2026-06-12 | B3 | ded6154 | NO | — | 유지됨 | 정상(`rpsLastCompletedGame`) | P0 |
| WRPS-025 | 새 방에 이전 게임 화면/상태 잔류 (BUG-04) | Build3 | 2026-06-12 | B3 | ded6154 | NO | — | 유지됨 | 정상(`resetRoomLocalState`×3) | P1 |
| WRPS-026 | 3인 게임 호스트 빠짐 → **판정 멈춤/프리즈** (BUG-05) | Build3 | 2026-06-12 | B3 | ded6154 | — | — | 유지됨(코드) | **실기기 미검증(OPEN-01)** | P1 |
| WRPS-027 | 자동/직접 선택 구분 불가(라벨 없음) (BUG-06) | Build3 | 2026-06-12 | B3 | ded6154 | NO | — | 유지됨 | 정상(`isAutoChoice`×4, `tag.auto`) | P1 |
| WRPS-028 | 게임 화면 하단 버튼/UI 잘림(iPhone) (BUG-07) | Build3 | 2026-06-12 | B3 | ded6154 | NO | — | 유지됨 | 정상(`100dvh`, `safe-area-inset`×13) | P1 |
| WRPS-029 | 호스트가 "게임준비"로 표시(추정) (BUG-08) | Build3 | 2026-06-12 | B3 | (검증) | NO | — | 유지됨 | 정상(이미 충족, N/A) | P2 |
| WRPS-030 | 결과 문구 "생존"/"승리" 혼재 (BUG-09) | Build3 | 2026-06-12 | B3 | ded6154 | NO | — | 유지됨 | 정상(승리!/Win!/勝利！) | P2 |
| WRPS-031 | 참가자 카드 정보 과다 (BUG-10) | Build3 | 2026-06-12 | B3 | ded6154 | NO | — | 유지됨 | 정상(1열 풀폭) | P2 |
| WRPS-032 | Me/방코드/벌칙 레이블 과대 (BUG-11) | Build3 | 2026-06-12 | B3 | ded6154 | NO | — | 유지됨 | 정상 | P2 |
| WRPS-033 | 역할별 상태 문구 하드코딩 한글 (BUG-12) | Build3 | 2026-06-12 | B3 | ded6154 | NO | — | 유지됨 | 정상(`ready.*` i18n) | P2 |
| WRPS-034 | 영어 UI 잔존 한글(토스트) (BUG-13) | Build3 | 2026-06-12 | B3 | ded6154 | **YES** | B5+ | 부분반영 | **토스트 하드코딩 잔존(OPEN-02)** | P2 |
| WRPS-035 | 술래 수 상한 deadlock(호스트 포함 계산) | Build4 | 2026-06-13 | B4 | ded6154 | NO | — | 유지됨 | 정상(상한=비호스트−1) | P1 |
| WRPS-036 | 다인전(3/4/5) 멀티디바이스 실시간 동기화 매트릭스 | Build4 | 2026-06-13 | (진행) | — | — | — | 유지됨(로직) | **실기기 매트릭스 미완(54셀 빈칸)** | P1 |
| WRPS-037 | 자동 시작 정식 재채택(활성 전원 ready→자동시작) | Build4 | 2026-06-13 | B4 | ded6154 | — | — | 유지됨(설계) | **GAME_LOGIC.md와 불일치**, stale-state 오발화 위험 | P1 |
| WRPS-038 | 술래 숫자 드롭다운 프리즈(iOS WKWebView 피커) (BLOCKER-001) | Build5 | 2026-06-14 | B5 | ded6154 | NO | — | 유지됨 | 정상(`activeElement===sel` 가드) | P0→해결 |
| WRPS-039 | ready 상태에서 술래 수 편집 불가 | Build5 | 2026-06-14 | B5 | ded6154 | NO | — | 유지됨 | 정상(`isLoserCountEditable` ready 추가) | P2 |
| WRPS-040 | Firebase(Build8) 마이그레이션 통합 | Build8 | 2026-06-21 | B8 | 9797a0c…35cd68d | NO | — | 유지됨(격리) | **회귀 0** — 게임로직 byte 동일 | N/A |
| WRPS-041 | GAME_LOGIC.md 자동시작 기술이 코드와 불일치(문서 드리프트) | Build4 이후 | 2026-06-13 | **Build8.1 (2026-06-22)** | 문서수정 | — | — | **수정반영** | GAME_LOGIC.md §3/§11에 Build4 자동시작 재채택 정정 반영 | P2→수정됨 |
| WRPS-042 | 전원 Ready 기반 시작 트리거 통일(호스트 시작 버튼 폐지·호스트 포함 전원 ready) | Build8.1(QA) | 2026-06-22 | **Build8.2 (2026-06-22)** | 코드수정 | — | — | **수정반영** | Model P 채택 — `showReadyScreen`/`renderLobby` 호스트도 ready 버튼, hostStartBtn/lobbyHostStartBtn 폐지. 실기기 검증 대기 | P1→수정됨 |
| WRPS-043 | 3인 게임에서 술래 2명 선택 불가(1명 고정) — 다중 술래 회귀 | Build8.1 실기기 QA | 2026-06-22 | **Build8.2 (2026-06-22)** | 코드수정 | YES(재발) | Build8.1 | **수정반영** | 원인: `getMaxLoserCount`가 비호스트−1. Model P로 호스트=플레이어 → 전체−1. game-logic.mjs 호스트 특례 제거 + maxLoserCountFor 단일소스 + 테스트 44 | P1→수정됨 |
| WRPS-044 | 호스트 승계+퇴장 후 참가자 목록/HOST 태그 stale(새 호스트는 본인만, 타 참가자는 옛 호스트 잔존) | Build8.1 실기기 QA | 2026-06-22 | **Build8.3 (2026-06-22)** | 코드수정 | — | — | **수정반영** | Case A(DB 정상/UI). 수정: rooms realtime 리스너 + handleRoomUpdate 상태전이 시 `scheduleFetchParticipants` 강제 재조회(불안정한 participant DELETE 의존 제거). DB 스키마/RLS 무변경. 테스트 49 | P1→수정됨 |
| WRPS-045 | 한국어 MC 녹음음성과 기존 TTS 혼재(intro는 MC, go "가위바위보"·일부 안내는 기계음 TTS) | Build8.3 음성팩(03571d9) | 2026-06-26 | **Build8.4 (2026-06-28)** | `baebae2` | NO(신규) | — | **수정반영** | 원인: `go` 등 매핑 공백 → TTS 폴백. ko_game_start.mp3=풀구호(사용자 청취확인)라 `go`를 `VOICE_SILENT` 센티넬로 무음 처리(intro 클립이 커버)→혼재 제거. MP3 이벤트는 speechSynthesis 미사용 보장. 매핑표 재정리. 실기기 검증 대기 | P1→수정됨 |
| WRPS-046 | 게임 결과 음성("이겼/졌습니다") 2회 반복 재생 | Build8.3 음성팩(03571d9) | 2026-06-26 | **Build8.4 (2026-06-28)** | `8c8bc1d` | NO(신규·구조잠복) | — | **수정반영** | 원인: `finishRoundLocal`이 result→game_over로 2회 호출되는데 결과음성 setTimeout에 가드 없음(과거 TTS는 cancel로 은폐). `playResultVoiceOnce`(키=`gameRound:round`)로 라운드당 1회. 새 게임/방 경계 3곳서 키 초기화. 실기기 검증 대기 | P1→수정됨 |
| WRPS-047 | 멀티단말 카운트다운 비동기 시작(시작/입력/판정/결과 시점 단말별 상이) | **재발: WRPS-015** | 2026-06-28 | **Build8.4 (2026-06-28)** | `db0d16a` | **YES(WRPS-015 회차3)** | Build8.3 음성팩 이후 재노출 | **수정반영** | 원인: HTTP `Date` 헤더 초단위 floor→기기간 clock offset 최대 ~1s 오차 + late-arrival 공백. `syncServerClock` +500ms 중앙보정·샘플 3→5, lead 2800→3600ms, runCountdown sleep캡 3000→4000. 판정/Firebase 무변경. **실기기 멀티디바이스 매트릭스 재검증 필수** | P0→수정됨(실기기 미검증) |
| WRPS-048 | 버튼 효과음이 가볍고 기계음 → 몰입 저하 | Build8.x | 2026-06-28 | **Build8.4 (2026-06-28)** | `51d5c6a` | NO(개선) | — | **수정반영** | `playButtonClickSound` 합성음 재설계(sine 280→140Hz·lowpass1200·50ms, 묵직·짧은 클릭) + 45ms 연타 디바운스(노이즈 방지). 음성과 별도 AudioContext라 음성 끊김 없음. 실기기 청취 확인 대기 | P2→수정됨 |
| WRPS-014 | 참가자 단말 카운트다운 TTS 미재생 — **실기기 PASS** | Lineage A | 2026-05-18 | Build8.1 | 4a8cbda→이식 | NO | — | **검증완료** | 2026-06-22 TestFlight 실기기 참가자 폰 음성 정상 확인 → 종결 | 종결 |
| WRPS-015 | 카운트다운 기기간 시차 — 실기기 PASS(Build8.1) **후 재발** | Lineage A | 2026-05-18 | (대체구현) | serverNow/countdownStartAt | **YES** | 2026-06-28 | **재발→WRPS-047로 추적** | 06-22 PASS 후 음성팩 적용 환경에서 재노출(clock offset/late-arrival). 회차3 보강은 **WRPS-047(Build8.4)** 참조 | 재발(WRPS-047) |

---

## 3. 분류 요약

- **유지됨(정상 반영)**: WRPS-001~010, 022~033, 035, 038, 039, 040 — Build3/4/5 QA 및 초기 수정 전부 현재 코드 유지.
- **대체구현**: WRPS-011(자동시작 정책), 012(깜빡임), 015(카운트다운 동기화), 016/017(부분).
- **미반영(Lineage A 누락)**: WRPS-013, 014, 018, 019, 020, 021.
- **회귀/LIVE 후보**: WRPS-013(P0), WRPS-014(P1) — 출시 본류에 한 번도 없었던 수정이라 사용자에겐 "버그"로 체감.
- **검증 게이트(미검증)**: WRPS-026(BUG-05 실기기), WRPS-036(멀티디바이스 매트릭스).
- **문서 드리프트**: WRPS-041.

> 상세 근거: `BUG_TIMELINE.md`(빌드별), `REGRESSION_TRACKER.md`(재발), `ACTIVE_ISSUES.md`(살아있는 문제).

---

## Build16 Device QA Triage (2026-07-01) — WRPS-050~071 신규 등록

> 상세: `docs/BUILD16_QA_PLAN.md` (Evidence·5Whys·Root Cause·범위). 아래는 요약 인덱스.

| ID | 제목 | Sev | Regression | Build16 |
|----|------|-----|-----------|---------|
| WRPS-050 | 로그인 후 게임 자동복귀 실패 | High | 신규 | ✅ |
| WRPS-051 | Countdown "가위바위보" clip 매핑(go=SILENT) | High | 신규(정책) | ✅ |
| WRPS-052 | Audio 커버리지/상태머신(local trigger) | High | WRPS-046 계열 | ✅ |
| WRPS-053 | 대기/탈락자 재게임/준비 버튼 노출 | Critical | WRPS-029 계열 | ✅ |
| WRPS-054 | Restart 초대 일부만·room 섞임 | Critical | WRPS-025 계열 | ✅ |
| WRPS-055 | Join/Leave meow 일부 기기만 | Critical | 신규 | ✅ |
| WRPS-056 | 참가자 변동 room/round/record reset 미작동+1인 방 | Critical | WRPS-025 계열 | ✅ |
| WRPS-057 | Button Sound/Haptic 랜덤 누락 | High | WRPS-048 계열 | ✅ |
| WRPS-058 | 선택 5초 타이머 시작/종료 기기차 | Critical | WRPS-036/047 재발후보 | 계측확정후 |
| WRPS-059 | 결과화면 전환 시점 기기차 | Critical | WRPS-036 계열 | 계측확정후 |
| WRPS-060 | 6라운드 이후 전환/결과 지연 급증 | Critical | 신규 | 계측확정후 |
| WRPS-061 | 이탈 시 결과화면 고착+stale 리스트 | Critical | WRPS-044/026 계열 | ✅ |
| WRPS-062 | 다중 술래 판정 오류+전체 재게임 오전환 | Critical | WRPS-043 재발후보 | ✅ |
| WRPS-063 | 화면 확대/축소/이동(viewport 미잠금) | Critical | 신규 | ✅ |
| WRPS-064 | Zero Doubt 동기화 신뢰(집합 지표) | Critical | WRPS-026/036 계열 | 계측+개별Fix |
| WRPS-065 | QR 벌칙설정 후 잔존 | High | 신규 | ✅ |
| WRPS-066 | 닉네임 정책/변경 UI | High | 신규(정책) | ✅ |
| WRPS-067 | 직전 게임 결과 미노출 | High | WRPS-024 재발후보 | ✅ |
| WRPS-068 | 내기록 닫기 버튼 문구 불일치 | Low | WRPS-030/034 계열 | ✅(경미) |
| WRPS-069 | 승/패/무 효과음 품질 | Medium | 신규 | ❌(polish) |
| WRPS-070 | 가위바위보 텍스트/애니메이션 부재 | Medium | 신규 | ❌(polish) |
| WRPS-071 | 화면 공백/QR/버튼 촉감 polish | Medium | 신규 | ❌(polish) |

**신규 최대 WRPS = 071. 상태 = 전부 OPEN(Triage 완료, Fix 미착수 — 범위 승인 대기).**
