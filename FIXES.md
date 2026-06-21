# 버그 수정 기록

## [Fix] 모달 버튼 텍스트 중앙 정렬

- **수정일시**: 2026-06-04 21:54 (KST)
- **수정자**: Claude (claude-sonnet-4-6)

### 문제

`확인` / `취소` 버튼의 텍스트가 버튼 중앙에 정렬되지 않고 좌측으로 치우쳐 표시됨.

### 원인

`index.html` 내 전역 `button` CSS에 `text-align: center` 속성이 누락되어 있었음.

### 수정 내용

**파일**: `index.html` — line 321

```css
/* 수정 전 */
button {
  border: 0;
  border-radius: 18px;
  padding: 15px 16px;
  font-weight: 800;
  cursor: pointer;
  transition: 0.18s ease;
}

/* 수정 후 */
button {
  border: 0;
  border-radius: 18px;
  padding: 15px 16px;
  font-weight: 800;
  cursor: pointer;
  transition: 0.18s ease;
  text-align: center; /* 추가 */
}
```

### 영향 범위

전역 `button` 스타일 수정이므로 앱 내 모든 버튼(확인, 취소, 나가기 등)에 동일하게 적용됨.

---

## [Fix] 모든 라운드 첫 대결 시작 로직 통일 + 호스트 게임 시작 버그 수정

- **수정일시**: 2026-06-06 (KST)
- **수정자**: Claude (claude-sonnet-4-6)

### 문제

1. 2라운드 이후 첫 대결에서 참가자와 호스트가 게임 준비 버튼을 누르면:
   - 참가자: 정상 게임 시작 ✅
   - 호스트: 게임 시작 안 되고 대기 화면으로 돌아감 ❌

2. 라운드마다 게임 시작 로직이 달라 일관성 없음
   - 1라운드: 호스트가 게임 시작 버튼 수동 클릭
   - 2라운드~: 모든 참가자 준비 완료 시 자동 시작

### 원인 (버그 1 — 타이밍 충돌)

`startGame()` 내부에서 `state.gameStarting = false` 리셋이 `updateRoomStatus('playing')` 이후에 실행되어, Realtime이 `playing` 상태를 수신하는 시점에 `gameStarting = true`가 남아있어 호스트의 `runCountdownThenShowGame()` 실행이 막힘.

```
startGame() 호출
  → state.gameStarting = true
  → DB: status = 'playing'
     ↓ Realtime 도착 (gameStarting=true 상태)
     → runCountdownThenShowGame() 실행 안 됨 ❌
  → state.gameStarting = false  ← 너무 늦음
```

### 원인 (버그 2 — 로직 불일치)

라운드 > 1에서 `triggerReplayIfLastReady()` 및 Realtime 리스너가 자동으로 `startGame()`을 호출해 호스트가 버튼을 누르기 전에 시작됨.

### 수정 내용

**① `showReadyScreen()` — 모든 라운드에서 호스트 게임 시작 버튼 표시**
```javascript
// 수정 전: round === 1 에서만 hostStartBtn 표시
if (state.role === "host" && state.round === 1) { ... }

// 수정 후: 모든 라운드에서 호스트는 hostStartBtn 표시, myReadyBtn 숨김
if (state.role === "host") {
  $("hostStartBtn").classList.remove("hidden");
  $("myReadyBtn").classList.add("hidden");
}
```

**② `triggerReplayIfLastReady()` — 자동 시작 제거**
```javascript
// 수정 전: 모두 준비 시 자동으로 startGame() 호출
// 수정 후: renderReadyList()만 호출 → 게임 시작 버튼 활성화 처리
```

**③ Realtime 리스너 — 자동 시작 로직 제거**
```javascript
// 수정 전: 모든 참가자 ready 시 startGame() 자동 호출
// 수정 후: renderReadyList()만 호출 → 버튼 상태 업데이트
```

**④ `startGame()` — gameStarting 리셋 타이밍 수정**
```javascript
// 수정 전
await updateRoomStatus('playing');
state.gameStarting = false;  // ← Realtime 이미 처리된 후

// 수정 후
state.gameStarting = false;  // ← playing 업데이트 전에 리셋
await updateRoomStatus('playing');
```

### 수정 후 모든 라운드 동일 흐름

```
참가자: 게임 준비 버튼 클릭 → is_ready = true
모든 참가자 준비 완료 → 호스트의 "게임 시작" 버튼 활성화
호스트: 게임 시작 버튼 클릭 → 전원 게임 시작
```

---

## [Fix] 통계 이중 집계 버그 수정 (무승부 재대결 후 미관련 결과 추가)

- **수정일시**: 2026-06-06 (KST)
- **수정자**: Claude (claude-sonnet-4-6)

### 문제

무승부 후 재대결 시 실제 대결과 무관한 승패 결과가 라운드 통계에 추가되는 현상.
- 두 명일 때도 발생, 참가자 수가 많을수록 더 많이 발생
- 재대결 직후 갑자기 추가됨

### 원인

`fetchParticipants()` 내 결과 집계 트리거 조건에 중복 실행 방지 가드가 없었음.

무승부 후 재대결이 시작되면 Realtime과 3초 폴링이 동시에 `fetchParticipants()`를 호출하는 상황이 생기고, `publishHostRoundResult()` 가 중복으로 실행될 수 있음.

또한 이전 라운드에서 `choice` 컬럼에 인코딩된 결과(`"rock|win"` 등)가 남아있는 참가자가 있을 경우, 새 대결 시작 전에도 집계가 재실행됨.

### 수정 내용

**파일**: `index.html` — `fetchParticipants()` 내 결과 집계 트리거 조건

```javascript
// 수정 전: 인코딩된 결과(이미 처리된 라운드)도 재처리
if (activeForRound.length > 0 && activeForRound.every(p => getChoiceBase(p.choice))) {
  await publishHostRoundResult(data);
}

// 수정 후: hasConfirmedRoundResult()로 이미 처리된 라운드 감지 후 차단
const alreadyProcessed = activeForRound.some(p => hasConfirmedRoundResult(p.choice));
if (!alreadyProcessed && activeForRound.length > 0 && activeForRound.every(p => getChoiceBase(p.choice))) {
  await publishHostRoundResult(data);
}
```

---

## [UI] 호스트 게임 시작 버튼 텍스트 — 준비 완료 시 "재대결 시작"으로 변경

- **수정일시**: 2026-06-06 (KST)
- **수정자**: Claude (claude-sonnet-4-6)

### 변경 내용

**파일**: `index.html` — `updateHostStartButton()`

| 상태 | 이전 텍스트 | 변경 후 텍스트 |
|---|---|---|
| 참가자 준비 미완료 | `🎮 게임 시작` (비활성) | `🎮 게임 시작` (비활성) — 유지 |
| 모든 참가자 준비 완료 | `🎮 게임 시작` (활성) | `🔄 재대결 시작` (활성) |
| 호스트 클릭 후 처리 중 | `시작 중...` | `시작 중...` — 유지 |

```javascript
// 수정 전: 텍스트 변경 없음
btn.disabled = !allReady;
btn.style.opacity = allReady ? "1" : "0.5";

// 수정 후: 준비 완료 여부에 따라 텍스트 변경
btn.disabled = !allReady;
btn.style.opacity = allReady ? "1" : "0.5";
if (allReady) {
  btn.textContent = "🔄 재대결 시작";
} else {
  btn.textContent = "🎮 게임 시작";
}
```

---

### 동작 원리

`hasConfirmedRoundResult(choice)`는 `choice` 값이 `"rock|win"`, `"scissors|lose"` 등 인코딩된 결과 형식인지 확인. 이미 결과 처리가 완료된 라운드는 `choice` 컬럼에 인코딩 결과가 기록되어 있으므로, 이후 Realtime/폴링 호출에서 재처리되지 않음.

### 영향 범위

온라인 멀티플레이 모드의 호스트 측 결과 집계 로직에만 영향. 무승부·재대결이 반복되는 상황에서 이중 집계 완전 차단.

---

## [Fix] 첫 대결 game_over 오판 (prevLoserIds 오염 버그)

- **수정일시**: 2026-06-06 (KST)
- **수정자**: Claude (claude-sonnet-4-6)

### 문제

새 게임 라운드 첫 대결에서 패자 수 = 목표 술래 수임에도 `game_over`가 아닌 `tooMany` (재대결) 메뉴가 표시됨.

### 원인

`finishRoundLocal()` 내 아래 코드:

```javascript
if ((state.confirmedSafeIds || []).length === 0 && (state.confirmedLoserIds || []).length === 0) {
  syncConfirmedIdsFromParticipants(state.participants || []);
}
```

새 게임 라운드 시작 시 두 배열이 모두 `[]`이면 무조건 `syncConfirmedIdsFromParticipants`를 호출. 이때 이전 게임의 `__loser__` 마커가 DB 전파 지연으로 `state.participants`에 잔존하면 `confirmedLoserIds`가 오염됨.

결과적으로 `remainingSlots = targetCount - prevLoserIds.length < targetCount`가 되어, 실제로 `roundLosers.length === targetCount`여도 `roundLosers.length > remainingSlots`가 성립 → `tooMany` 분기로 잘못 처리.

### 수정 내용

```javascript
// 수정 전: 무조건 동기화
if (... length === 0 && ... length === 0) {
  syncConfirmedIdsFromParticipants(...);
}

// 수정 후: __safe__/__loser__ 마커가 실제로 존재할 때만 동기화
const hasAnyMarkers = (state.participants || []).some(p => isNonPlayingChoice(p.choice));
if (hasAnyMarkers && ... length === 0 && ... length === 0) {
  syncConfirmedIdsFromParticipants(...);
}
```

---

## [Fix + Feature] 로비 자동 시작 제거 + 호스트 수동 시작 버튼 추가

- **수정일시**: 2026-06-06 (KST)
- **수정자**: Claude (claude-sonnet-4-6)

### 변경 요구사항

다음 라운드(새 게임) 진입 시 모든 라운드와 동일한 흐름 적용:
> 벌칙/술래 수 설정 → 참가자 전원 게임 준비 → **호스트가 게임 시작 버튼 클릭**

### 수정 내용

**① 로비 HTML에 호스트 전용 게임 시작 버튼 추가**
```html
<button id="lobbyHostStartBtn" class="btn-success btn-full hidden" onclick="window.startFromLobby()">🎮 게임 시작</button>
```

**② `renderLobby()` — 역할별 버튼 표시 분기**
- 호스트: `lobbyReadyBtn` 숨김, `lobbyHostStartBtn` 표시 (전원 준비 시 활성화)
- 참가자: `lobbyReadyBtn` 표시, `lobbyHostStartBtn` 숨김

**③ `fetchParticipants()` — 로비 자동 시작 로직 제거**
```javascript
// 수정 전: 전원 준비 시 자동 startFromLobby() 호출
if (state.status === "lobby" && !state.gameStarting) {
  if (data.every(p => p.is_ready)) startFromLobby();
}

// 수정 후: renderLobby()만 호출 → 버튼 활성화 처리
if (state.status === "lobby" && !state.gameStarting) {
  renderLobby();
}
```

---

## [UI] 게임 인디케이터 술래 표기 형식 변경

- **수정일시**: 2026-06-06 (KST)
- **수정자**: Claude (claude-sonnet-4-6)

### 변경 내용

**파일**: `index.html` — `renderRoundProgressCards()`

| 항목 | 이전 | 변경 후 |
|---|---|---|
| 숫자 | `${info.target}` | `${info.target}명` |
| 레이블 | `목표 술래` | `술래` |

**표시 예시**: `1명 / 술래` (목표 술래 수가 2명이면 `2명 / 술래`로 자동 변경)
