# Participated rooms history-only — local validation

Branch: `dev/kr-participated-rooms-history-fix`
Base: `83e56b60cdbad5bd40105cef0814c40f004b2fd0`

## Root cause and correction

Home `참가했던 방` was wired to `showJoinScreen({ recent: true })`. That local-recent-room rejoin path opens the generic room-code UI and can lead to membership creation.

It now opens `screenParticipatedRoomsHistory`. The view reads only the authenticated user’s existing `user_game_history` rows, keeps the latest record per room, and renders display-only records containing room code, timestamp, and result. It performs no participant query, insert, join, QR/deep-link activation, or room routing. Active rooms remain recoverable only through owner-based startup recovery.

HGRU, WZ5L, and JKHC can be shown only when an authenticated `user_game_history` record exists; the feature does not manufacture records or alter lifecycle data.

## Validation

- Focused history/reconnect/exit-lockout/identity/cold-launch/explicit-leave: 57 passed, 0 failed.
- Syntax and `git diff --check`: PASS.
- Release gate: 98 passed; Normal 360/360; correctness 100%; 76.00s.
- Full non-timing: 98 files; 1,575 passed, 10 skipped, 0 failed; 140.67s.
- RC3 isolated: 63/63 passed; 1660.64s.

No Seoul action, schema change, or lifecycle/RLS/RPC change was made.
