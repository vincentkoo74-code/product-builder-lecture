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
