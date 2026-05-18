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
