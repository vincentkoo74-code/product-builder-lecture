# Product Builder Lecture - Claude Notes

## 버그 수정 기록 (Bug Fix Log)

### [2026-05-18] 게임 준비 버튼 미표시 + 대기↔준비 깜빡임 버그
**브랜치:** `claude/fix-game-ready-button-bl7zf`
**커밋:** `94a3344`

**증상:**
- 한판더 실행 후 참가자 휴대폰에 "게임 준비" 버튼이 나타나지 않음 (또는 깜빡임)
- 호스트 화면에서 참가자 상태가 "대기" ↔ "준비"로 3초마다 반복 전환

**원인:**
`handleRoomUpdate()`의 `if (room.round === 1)` 블록에서 `p.is_ready = false` 로컬 리셋이 폴링(3초마다)을 포함한 **모든 호출 시마다** 실행됨. 참가자가 "게임 준비"를 눌러 DB에 `is_ready=true`가 저장돼도, 3초 후 폴링이 로컬 상태를 `false`로 덮어쓰고 `renderAll()`이 호출되어 버튼/배지가 리셋됨.

**수정:**
- `is_ready = false` 로컬 초기화를 `if (oldStatus !== state.status && state.status === "ready")` 블록 안으로 이동
- 상태가 실제로 바뀔 때(최초 "ready" 전환 시)만 한 번 실행하도록 수정
- `__safe__/__loser__` 마커 초기화는 `if (room.round === 1)` 블록에 유지 (매 폴링 실행 무해)

**수정 파일:** `index.html` (line ~1321–1341)

---

### [2026-05-18] 재게임 선택 시 참가자 화면에 게임준비 버튼 미표시
**브랜치:** `claude/fix-game-ready-button-bl7zf`
**커밋:** `9b7ff2e`

**증상:**
- 매번 라운드가 끝나고 재게임(한판더) 선택 시 호스트 이외 참가자 화면에 "게임 준비" 버튼이 나타나지 않음

**원인 (복합):**

1. **`invitePopup` 자동 닫힘 미구현**: `inviteForReplay()` → `status="reinviting"` → 참가자에게 "새 게임 초대" 팝업 표시. 이후 10초 카운트다운 종료 시 `resetGameKeepRoom()` → `status="ready"` 전환. `handleRoomUpdate`가 `showReadyScreen()`을 호출하지만, `invitePopup`은 `hideAllScreens()`에 포함되지 않아 팝업이 `screenReady` 위를 덮고 있어 버튼이 보이지 않음.

2. **`acceptInvite()` 화면 전환 오류**: 카운트다운이 이미 끝나 `status="ready"`가 된 후에 참가자가 "수락하기"를 누르면, `acceptInvite()`가 무조건 `showScreen("screenParticipantWait")`을 호출해 `screenReady`를 덮어버림. 이후 폴링은 `oldStatus === "ready"` 동일이라 화면을 다시 바꾸지 않아 참가자가 대기 화면에 영원히 갇힘.

**수정:**
- `handleRoomUpdate`에서 `status → "ready"` 전환 시 `$("invitePopup").classList.add("hidden")` 추가 (팝업 자동 닫기)
- `acceptInvite()`에서 `state.status === "ready"` 여부를 확인해 이미 게임이 시작됐으면 `showReadyScreen()`, 아직 대기 중이면 `showScreen("screenParticipantWait")` 호출

**수정 파일:** `index.html` (line ~1339, ~2464)

---

### [2026-05-18] 게임 시작 시 참가자 단말기에서 "안내면 술래 가위바위보" 맨트 미재생
**브랜치:** `claude/fix-game-ready-button-bl7zf`
**커밋:** `4a8cbda`

**증상:**
- 게임 시작 시 호스트 단말기에서는 카운트다운 TTS("안내면 술래 가위바위보")가 정상 재생되지만, 참가자 단말기에서는 재생되지 않음

**원인:**
모바일 브라우저(iOS Safari, Android Chrome)의 **사용자 제스처(user gesture) 요구 정책**.

`speak()` 함수 호출 경로: Supabase WebSocket 이벤트 → `handleRoomUpdate` → `runCountdownThenShowGame` → `runCountdown` → `speak()`. 이 경로는 사용자 제스처 없이 실행되므로 모바일 브라우저가 `speechSynthesis.speak()`를 차단함.

- **호스트**: 방금 "게임 시작" 버튼을 클릭(제스처 컨텍스트 유효) → TTS 작동
- **참가자**: 마지막 제스처("게임 준비" 클릭)로부터 일정 시간이 지나 제스처 컨텍스트 만료 → TTS 차단, 카운트다운 화면은 표시되지만 소리 없음

**수정:**
- `markReady()`에서 "게임 준비" 버튼 클릭 시점(제스처 컨텍스트)에 빈 발화(`new SpeechSynthesisUtterance('')`)로 `speechSynthesis`를 미리 잠금 해제
- `speak()`에서 `speechSynthesis.speaking` 상태일 때도 `resume()` 호출하도록 조건 보완

**수정 파일:** `index.html` (line ~2790, ~3014)

---

### [2026-05-18] 게임 시작 시 참가자 화면 간 시차(time lag) 발생
**브랜치:** `claude/fix-game-ready-button-bl7zf`

**증상:**
- 게임 시작 후 참가자마다 카운트다운 시작 시점이 달라 일부 기기는 이미 가위바위보 화면인데 다른 기기는 아직 "안내면 술래" 단계에 있음

**원인:**
1. `handleRoomUpdate()` → `runCountdownThenShowGame()` 호출 경로에서 각 기기마다 네트워크 지연이 달라 Supabase 이벤트 수신 시각이 다름
2. `runCountdown()` 1단계가 `await speak("안내면 술래", ...)` — TTS 완료를 기다리는 가변 시간 —로 구현되어 기기별 음성합성 속도 차이가 시차를 더 증폭시킴

**수정:**
- Supabase realtime 이벤트의 `payload.commit_timestamp`(DB 커밋 시각, UTC ISO)를 `handleRoomUpdate(room, commitTimestamp)`로 전달
- `status === "playing"` 전환 시 `elapsedMs = Date.now() - commitTimestamp`로 각 기기의 경과 시간 계산 후 `runCountdownThenShowGame(elapsedMs)` 호출
- `runCountdown(elapsedMs = 0)`: 고정 구간(1단계 1500ms + 2단계 1800ms = 3300ms)을 기준으로 `elapsedMs`만큼 건너뜀
  - 1단계가 남아 있으면 나머지 시간만 sleep 후 2단계 전체(1800ms)
  - 1단계가 이미 지났으면 2단계 남은 시간만 sleep
  - 3300ms 초과 시 카운트다운 생략, 즉시 게임 화면으로 진행
- TTS는 `await` 없이 병렬 실행(`.speak()` 호출 후 즉시 고정 sleep)하여 음성 길이와 무관하게 타이밍 유지

**수정 파일:** `index.html` (line ~1278–1285, ~1379, ~1977–2040)

---

### [2026-05-18] 재게임 승낙 후 "게임 준비" 버튼 미표시 (경쟁 조건)
**브랜치:** `claude/fix-game-ready-button-bl7zf`

**증상:**
- 참가자가 재게임 초대를 "수락하기" 눌러 준비화면에 도달해도 "게임 준비" 버튼 대신 비활성화된 "게임 대기" 상태 유지

**원인 (경쟁 조건):**
`resetGameKeepRoom()`은 두 단계로 DB를 갱신함:
1. `participants.update({ choice: null, is_ready: false })` — 이전 게임 마커 초기화
2. `rooms.update({ round: 1, status: 'ready' })` — 방 상태 전환

폴링(3초 인터벌)의 `fetchParticipants()` SELECT가 단계 1 커밋 **이전**에 시작되면 PostgreSQL Read Committed 격리 수준에 의해 `choice='__loser__'`가 남아있는 구 스냅샷을 읽음. 이후 `handleRoomUpdate`("ready")가 로컬 `state.participants[].choice`를 `null`로 리셋하더라도, 뒤늦게 완료된 `fetchParticipants`가 `state.participants`를 오래된 데이터로 **덮어씀**.

결과: `renderAll()` → `updateMyReadyButton()` → `isConfirmedLoser()` fallback 체크(`p.choice === '__loser__'`)가 `true` 반환 → 버튼이 "게임 대기"(비활성)로 표시됨.

추가로, 이전 게임의 `reinviting` realtime 이벤트가 지연 도착하면 `oldStatus === "ready"` 상태에서도 invitePopup이 다시 열려 준비화면을 덮는 문제도 존재.

**수정:**
- `isSafeParticipant()` / `isConfirmedLoser()`: `state.round === 1`이면 `p.choice` fallback 체크를 건너뜀. Round 1은 항상 새 게임 시작이므로 이전 게임의 `__safe__`/`__loser__` 마커는 무효
- `handleRoomUpdate` "reinviting" 분기: `oldStatus !== "ready"`일 때만 invitePopup 표시 (지연 이벤트로 인한 역행 전환 방지)

**수정 파일:** `index.html` (line ~1217–1228, ~1398–1401)

---

### [2026-05-18] 재게임 후 "게임 준비" 버튼 미표시 (fetchParticipants 스테일 choice 정규화)
**브랜치:** `claude/fix-game-ready-button-bl7zf`

**증상:**
- 첫 번째 게임을 마치고 "한번더" 메뉴로 재게임 시작 시, 참가자 디바이스에 "게임 준비" 버튼 대신 비활성 버튼이 표시됨

**원인:**
`resetGameKeepRoom()`은 두 단계 DB 쓰기를 수행: ① `participants.update({ choice: null, is_ready: false })` → ② `rooms.update({ round: 1, status: 'ready' })`. 3초 폴링의 SELECT가 ① 커밋 **이전**에 시작됐으면 이전 게임의 `choice`(rock/paper/scissors)와 `is_ready=true`가 남아있는 구 스냅샷을 반환. `handleRoomUpdate`("ready")가 로컬 `is_ready=false` 수동 초기화를 수행해도, 뒤늦게 완료된 `fetchParticipants()`가 `state.participants`를 스테일 데이터로 **덮어씀** → `updateMyReadyButton()`이 "준비 완료"(비활성)를 표시.

`isSafeParticipant/isConfirmedLoser` round=1 폴백 수정(이전 커밋)으로 "게임 대기" 오탐은 해결됐으나, `is_ready=true` 스테일 데이터 경로는 여전히 남아있었음.

**수정:**
- `fetchParticipants()`에서 `state.participants = data` 이후, `state.status === "ready" && state.round === 1`일 때 `choice !== null`인 참가자를 정규화 (`choice=null, is_ready=false` 강제). `choice`가 null이 아닌 것은 이전 게임 스냅샷의 확실한 증거(새 게임에서 choice는 항상 null). 이후 genuine 준비 완료(`is_ready=true, choice=null`)는 영향 없음

**수정 파일:** `index.html` (line ~1437)

---

### [2026-05-18] 재게임 수락 후 screenParticipantWait 고착 (안전망 추가)
**브랜치:** `claude/fix-game-ready-button-bl7zf`

**증상:**
- 참가자가 재게임 초대를 수락하고 대기실로 진입 후 "게임 준비" 버튼이 나타나지 않음 (screenParticipantWait에 머묾)
- `state.status === "ready"` 임에도 screenReady 전환이 안 됨 (⏳ 대기 배지 표시로 확인)

**원인:**
`handleRoomUpdate`의 화면 전환은 `if (oldStatus !== state.status)` 블록 안에만 있음. 폴링/WebSocket 경쟁으로 `state.status`가 이미 'ready'로 설정된 뒤 `handleRoomUpdate`가 또 호출되면, `oldStatus === state.status === 'ready'`로 전환 블록 전체를 건너뛰어 `showReadyScreen()`이 실행되지 않음. 참가자가 `acceptInvite()` → `showScreen("screenParticipantWait")`로 이동한 직후 이 경쟁 조건이 발생하면 영구적으로 대기 화면에 갇힘.

**수정:**
- `handleRoomUpdate` 전환 블록 이후, `fetchParticipants()` 완료 후 각각 안전망 추가
- `state.status === "ready" && screenParticipantWait가 visible && 참가자 역할`일 때 `showReadyScreen()` 강제 호출
- 중복 호출은 무해(idempotent)

**수정 파일:** `index.html` (line ~1420, ~1470)

---

### [2026-05-18] 신규 참가자 호스트 화면 미표시 + 게임준비 버튼 깜빡임
**브랜치:** `claude/fix-game-ready-button-bl7zf`
**커밋:** `355a656`

**증상:**
1. QR 스캔 후 참가자가 대기실에 입장해도 호스트 화면 참가자 목록에 나타나지 않음
2. 참가자가 "게임 준비" 버튼을 누른 후 버튼이 계속 깜빡거림 (준비 완료 → 게임 준비 반복)

**원인:**

1. **participants realtime INSERT seq 경쟁 조건**: `postgres_changes` 콜백이 `fetchParticipants()`를 호출하지만, 폴링(3초 인터벌)과 동시에 발생하면 `fetchParticipantsSeq` 카운터에 의해 드롭됨. 신규 참가자 INSERT가 유실되어 즉시 표시되지 않음.

2. **`markReady()` 로컬 상태 미갱신**: 온라인 브랜치에서 DB `is_ready=true` 업데이트 성공 후 로컬 `state.participants[me].is_ready`를 갱신하지 않음. 이후 WebSocket 이벤트 도착 시 `renderAll()` → `updateMyReadyButton()`이 stale `is_ready=false`로 버튼을 "✋ 게임 준비"로 되돌림.

**수정:**
- `participants` realtime 콜백에서 `payload.eventType === 'INSERT'`일 때 `payload.new`로 즉시 `state.participants`에 추가 후 `renderAll()` (seq 카운터 우회)
- `markReady()` 온라인 브랜치에서 DB 업데이트 성공 즉시 `me.is_ready = true; renderAll()` 호출

**수정 파일:** `index.html` (line ~1305, ~2886)

---

### [2026-05-18] 대기실 장시간 대기 참가자 자동 로그아웃 기능
**브랜치:** `claude/fix-game-ready-button-bl7zf`
**커밋:** `4e3e1f3`

**배경:**
참가자가 `screenParticipantWait`(대기실)에 1분 이상 머물면서 아무 조작을 하지 않으면, 브라우저 탭을 닫거나 자리를 비운 것으로 간주할 수 있음. 이런 참가자가 목록에 남아있으면 호스트가 게임을 진행하기 어렵고, `cleanupDroppedParticipants()`의 2분 타임아웃보다 먼저 명시적 퇴장 처리를 유도하는 것이 UX상 적합.

**동작:**
- `screenParticipantWait` 진입 시 1분(60,000ms) 타이머 시작
- 타이머 만료 시 5초 카운트다운 팝업(`idleLogoutPopup`) 표시
- "여기 있어요!" 버튼 클릭 → 팝업 닫기 + 타이머 재시작
- 5초 내 미응답 시 `_doLeaveRoom()` 호출하여 자동 퇴장
- 터치/클릭 이벤트 감지 시 타이머 리셋 (카운트다운 진행 중에는 명시적 버튼만 허용)
- 다른 화면으로 전환 시(`showScreen()`) 타이머 자동 초기화

**수정 파일:** `index.html` (line ~1048–1055 팝업 HTML, ~1563–1571 showScreen 연동, ~3254–3298 자동 로그아웃 로직)

---

### [2026-05-18] 드롭된 참가자가 ready/reinviting 상태 대기실에서 미제거
**브랜치:** `claude/fix-game-ready-button-bl7zf`
**커밋:** `9ce864b`

**증상:**
- 첫 번째 라운드 후 재게임 준비/재초대 상태에서 드롭된 참가자(Supabase Presence 오프라인)가 호스트와 다른 참가자 화면의 대기실에 계속 표시됨
- 드롭된 참가자가 남아 있으면 "전원 준비" 조건이 충족되지 않아 게임 진행이 불가능

**원인:**
`cleanupDroppedParticipants()`가 `state.status !== "waiting"` 조건으로 ready/reinviting 상태에서 실행을 건너뜀. 초기 구현 목적은 모바일 화면 잠금으로 인한 Presence 오탐 방지였으나, 재게임 흐름에서는 드롭 정리가 필요함.

**수정:**
- 실행 허용 상태를 `"waiting"` 단독에서 `["waiting", "ready", "reinviting"]`으로 확장
- 상태별 grace period 차등 적용: `waiting` = 5분(모바일 오탐 방지), `ready`/`reinviting` = 2분(게임 흐름 위해 빠른 정리)
- `playing`/`result` 등 게임 진행 중에는 여전히 실행 안 함 (일시 연결 끊김으로 진행 참가자 삭제 방지)

**수정 파일:** `index.html` (line ~1249–1278)
