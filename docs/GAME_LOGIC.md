# 마루의 가위바위보 — 게임 로직 문서

> **최종 수정**: 2026-06-06
> **수정자**: Claude (claude-sonnet-4-6)

---

## 1. 전체 게임 상태 흐름 (State Machine)

```
waiting
  └─→ penalty_setting   (호스트가 벌칙 설정 중)
        └─→ ready        (벌칙 설정 완료, 참가자 게임 준비 단계)
              └─→ playing    (게임 진행 중)
                    └─→ result / game_over
                          ├─→ ready      (재대결: 무승부 / 술래 초과/미달)
                          ├─→ lobby      (라운드 종료 후 다음 라운드 대기)
                          └─→ stats      (게임 완전 종료 → 통계)

lobby
  └─→ ready  (다음 라운드 시작)
```

### DB `rooms.status` 값 정의

| status | 의미 |
|---|---|
| `waiting` | 방 생성 직후, 참가자 입장 대기 |
| `penalty_setting` | 호스트가 벌칙 설정 중 |
| `ready` | 참가자 게임 준비 단계 (모든 라운드 공통) |
| `playing` | 가위바위보 진행 중 |
| `result` | 대결 결과 표시 중 (중간) |
| `game_over` | 술래 확정, 최종 결과 표시 |
| `lobby` | 라운드 간 대기 로비 |
| `reinviting` | 탈락자 재초대 중 |
| `stats` | 전체 통계 화면 |

---

## 2. 역할별 화면 흐름

### 호스트 (is_host = true)

```
앱 실행
  → 홈 화면
  → 방 만들기 → screenHostRoom (QR 코드 표시, 참가자 입장 대기)
  → 벌칙 설정 (screenPenalty)
  → [게임 시작] 버튼 클릭 → status = 'ready'
  → screenReady (참가자 준비 현황 확인)
      ↓ 모든 참가자 is_ready = true
  → [게임 시작] 버튼 활성화 → 호스트 클릭
  → status = 'playing' → screenHostPlaying (선택 현황 모니터링)
  → 결과 판정 → screenRoundResult
  → [다시해!] → nextRound() → status = 'ready' (재대결)
     또는 라운드 종료 → status = 'lobby'
```

### 참가자 (is_host = false)

```
QR 스캔 → 닉네임 입력 → 방 입장
  → screenParticipantWait (게임 시작 대기)
  → status = 'ready' → screenReady
      → [게임 준비] 버튼 클릭 → is_ready = true
  → status = 'playing' → screenGame (가위/바위/보 선택)
  → 결과 표시 → screenRoundResult
  → 반복 또는 종료
```

---

## 3. 라운드 시작 로직 (모든 라운드 공통) ✅ 2026-06-06 수정

### 핵심 원칙
> ⚠️ **이 절(2026-06-06 기준)은 이후 Build4(2026-06-13)에서 번복되었다.** 아래 §3 끝의 "변경 이력(2026-06-13 Build4)"을 먼저 보라.
> (2026-06-06 당시 원칙) ~~모든 라운드의 첫 대결은 반드시 호스트가 게임 시작 버튼을 눌러야 시작된다.~~
> **(현행 / Build4~) 활성(비호스트) 전원이 Ready를 누르면 호스트 클라이언트가 권위적으로 자동 시작한다.** 호스트 수동 시작 버튼도 병행 제공.

### 흐름

```
1. status = 'ready' 상태 진입
      ├─ 호스트: screenReady 이동
      │     → myReadyBtn 숨김
      │     → hostStartBtn 표시 (비활성 상태, opacity 0.5)
      │     → editPenaltyBtn 표시
      │
      └─ 참가자: screenReady 이동
            → myReadyBtn 표시
            → hostStartBtn 숨김

2. 참가자 [게임 준비] 클릭
      → DB: participants.is_ready = true
      → Realtime으로 전체 기기에 전파
      → renderReadyList() 실행 → updateHostStartButton() 호출

3. 모든 참가자(비호스트) is_ready = true
      → areAllPlayersReady() = true
      → hostStartBtn 활성화 (opacity 1.0)

4. 호스트 [게임 시작] 클릭 → startGame()
      → state.gameStarting = false  ← playing 업데이트 전에 리셋
      → DB: status = 'playing'
      → Realtime으로 전체 기기에 전파
      → 호스트/참가자 모두 runCountdownThenShowGame() 실행
```

### 관련 함수

| 함수 | 역할 |
|---|---|
| `showReadyScreen()` | ready 화면 표시, 역할에 따라 버튼 가시성 제어 |
| `markReady()` | 참가자의 게임 준비 버튼 처리 |
| `areAllPlayersReady()` | 비호스트 참가자 전원 is_ready 여부 확인 |
| `updateHostStartButton()` | 게임 시작 버튼 활성화/비활성화 업데이트 |
| `triggerReplayIfLastReady()` | renderReadyList() 호출 (자동 시작 없음) |
| `startGame()` | 게임 시작 처리, status = 'playing'으로 변경 |

### ⚠️ 변경 이력 (2026-06-06)

**이전 동작 (버그)**
- round > 1에서 모든 참가자 is_ready 시 자동 시작 (`triggerReplayIfLastReady`)
- 호스트도 `myReadyBtn`을 눌러야 했음
- `startGame()` 내 `state.gameStarting` 타이밍 버그로 호스트 화면만 미시작

**2026-06-06 동작 (이후 번복됨)**
- 모든 라운드: 호스트는 `myReadyBtn` 없음, 항상 `hostStartBtn`으로 시작
- 자동 시작 로직 완전 제거
- `state.gameStarting = false`를 `updateRoomStatus('playing')` 이전으로 이동

### ⚠️ 변경 이력 (2026-06-13 Build4 — 현행) — WRPS-037 / WRPS-041
- **자동 시작 정식 재채택**: 활성(비호스트) 전원 `is_ready=true`가 되면 **호스트 클라이언트가 권위적으로** `startGame()`/`startFromLobby()`를 자동 호출(`triggerReplayIfLastReady`, `fetchParticipants`의 ready/lobby 분기).
- 중복 시작 방지: `state.autoStartInFlight` + `state.gameStarting` 가드, `areAllActivePlayersReady()` 게이트.
- 호스트 수동 `hostStartBtn`은 **병행 유지**(전원 ready 전 수동 시작 가능).
- `state.gameStarting = false`를 playing 업데이트 전에 두는 타이밍 수정은 유지.
- 근거: `docs/BUILD4_P0_QA_MATRIX.md` 항목 3, `docs/history/FEATURE_DECISION_HISTORY.md` §1, `docs/history/KNOWN_BEHAVIORS.md` KB-01.

---

## 4. 대결 결과 판정 로직

### 승패 판정 (`judgeRound`)

```
활성 플레이어 = 안전/술래 확정자 제외한 나머지

선택 종류가 1종류 → 전원 무승부 (draw)
선택 종류가 3종류 → 전원 무승부 (draw)
선택 종류가 2종류 → 이긴 선택 = win, 진 선택 = lose
```

### 결과 유형

| 결과 | 조건 | 다음 상태 |
|---|---|---|
| **무승부 (draw)** | 전원 같은 선택 또는 3종류 | `ready` (재대결) |
| **술래 확정 (gameOver)** | 패자 수 = 목표 술래 수 | `game_over` |
| **술래 초과 (tooMany)** | 패자 수 > 목표 술래 수 | `ready` (재대결, 패자 중 누가 술래인지 재결정) |
| **술래 미달 (tooFew)** | 패자 수 < 목표 술래 수 | `ready` (재대결, 추가 술래 결정 필요) |

---

## 5. 참가자 상태 마커

DB `participants.choice` 컬럼을 상태 마커로도 활용.

| 값 | 의미 |
|---|---|
| `null` | 아직 선택 안 함 |
| `'rock'` / `'scissors'` / `'paper'` | 가위바위보 선택 |
| `'__safe__'` | 이번 라운드 안전 확정 (다음 대결 참여 안 함) |
| `'__loser__'` | 술래 확정 (다음 대결 참여 안 함) |

### 활성 참가자 기준 (`isCurrentRoundParticipant`)

```
!isSafeParticipant(id) && !isConfirmedLoser(id) && !isWaitingForNextGame(id)
```

### `areAllPlayersReady` 기준

```javascript
getRoomPlayers()  // is_host = false 인 참가자만
  .every(p => p.is_ready)
```
→ **호스트는 is_ready 체크 대상 제외**

---

## 6. 통계 집계 보호 로직 ✅ 2026-06-06 수정

### 문제: 이중 집계

Realtime과 3초 폴링이 동시에 `fetchParticipants()`를 호출할 경우,  
`publishHostRoundResult()`가 중복 실행되어 통계가 두 번 이상 기록될 수 있음.

무승부 재대결 직후 이전 라운드의 인코딩 결과(`"rock|win"`)가 잠깐 남아있는 경우도  
새 대결로 오인해 재집계되는 문제 발생.

### 해결책: `alreadyProcessed` 가드

```javascript
// fetchParticipants() 내 결과 집계 트리거
const alreadyProcessed = activeForRound.some(p => hasConfirmedRoundResult(p.choice));
if (!alreadyProcessed && activeForRound.length > 0 && activeForRound.every(p => getChoiceBase(p.choice))) {
  await publishHostRoundResult(data);
}
```

`hasConfirmedRoundResult(choice)` — `"rock|win"` 등 인코딩 결과 형식 여부 반환.  
활성 참가자 중 한 명이라도 인코딩 결과를 가지면 이미 처리된 라운드로 판단, 재집계 차단.

---

## 7. 재대결 흐름

```
screenRoundResult 표시
  → [다시해!] 버튼 클릭 → nextRound()
      → DB: participants 초기화 (choice=null, is_ready=false)
      → 안전/술래 확정자: choice 마커 재기록, is_ready=true
      → DB: round+1, status='ready'
      → Realtime 전파 → 전원 screenReady 이동
      → (3. 라운드 시작 로직과 동일하게 진행)
```

---

## 8. 라운드 간 로비 흐름

```
라운드 종료 (술래 미확정 상태로 다음 라운드)
  → status = 'lobby'
  → 전원 screenLobby 이동
  → 참가자 [게임 준비] 클릭 → is_ready = true
  → 전원 준비 시 startFromLobby()
      → status = 'ready' → (3. 라운드 시작 로직)
```

---

## 9. 게임 종료 흐름

```
game_over 확정
  → screenRoundResult (최종 결과)
  → [통계 보기] → endGame() → status = 'stats'
  → screenStats (라운드별 통계)
  → [게임 종료] 또는 [다시하기]
```

---

## 10. 타이머 & 타임아웃

| 항목 | 시간 |
|---|---|
| 라운드 선택 타이머 | 별도 설정값 (`state.timerSec`) |
| DB 업데이트 타임아웃 | 5,000ms (`Promise.race`) |
| 결과 표시 후 자동 전환 없음 | 수동 버튼 클릭 필요 |

---

## 11. Realtime 구독 구조

```
supabase.channel('room:{roomCode}')
  ├─ rooms 테이블 변경 → onRoomChanged()
  │     → status 변경 감지 → 화면 전환
  └─ participants 테이블 변경 → onParticipantsChanged()
        → is_ready 변경 → renderReadyList() → updateHostStartButton()
        → status=ready/lobby 일 때 활성 전원 ready면 **호스트가 자동 시작**(Build4~, WRPS-037) + 수동 버튼 병행
```

---

## 12. 오프라인 / 온라인 분기

```javascript
getOnlineMode()  // state.roomCode && db 존재 여부
```

- **온라인**: Supabase DB 업데이트 → Realtime으로 전파 → UI 업데이트
- **오프라인**: 로컬 `state` 직접 수정 → 즉시 UI 업데이트

---

*이 문서는 코드 변경 시 함께 업데이트해야 합니다.*
*관련 파일: `index.html` (단일 파일 앱)*
