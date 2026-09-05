# Explicit leave terminal-exit — local validation

Branch: `dev/kr-explicit-leave-terminal-exit-fix`
Base: `baba33fe29706efc430daecdb03c498cf7f2a1b8`

## Root cause

The waiting host-room `처음으로` button directly invoked generic `goHome()`. That function intentionally clears local room state and realtime subscriptions for ordinary navigation, but does not call `exit_room_permanently`. The UI therefore reached Home while the active participant and terminal-exit ledger remained unchanged on the server.

## Correction

Only the active host-room Home action now enters the existing `leaveRoom()` flow. That flow retains host succession and deferred-leave behavior and reaches `_doLeaveRoom()`, which awaits `exit_room_permanently(room_id, 'explicit_leave', null)` before cache/local-state cleanup and Home routing.

RPC failure is now a non-navigation result: it keeps the active room/subscription intact, shows the existing recoverable synchronization message, and emits a non-secret QA event. Settings/Home navigation remains `goHome()` only and never invokes the terminal-exit RPC.

## Validation

- Focused leave/reconnect/cold-launch/exit-lockout/identity/deferred-leave: 103 passed, 0 failed.
- HTML/JS syntax and `git diff --check`: PASS before final commit.
- Official release gate: 98 passed; Normal 360/360; correctness 100%; 77.44s.
- Full non-timing: 97 files passed; 1,570 passed, 10 skipped, 0 failed; 335.45s.
- RC3 isolated: 63/63 passed; 1649.61s.

No Seoul operation was run. WZ5L, JKHC, and HGRU were not read, written, or deleted during this local implementation.

## WZ5L device retest

1. Confirm the fixed build first restores WZ5L as its active host room.
2. Press `처음으로`; complete the existing host-leave confirmation/choice if presented.
3. Wait for successful server exit before Home appears.
4. Verify WZ5L has zero participant rows for the user, one exit-ledger row, and `explicit_leave` reason.
5. Force-quit and relaunch: WZ5L must not restore; old code/QR/deep link must be denied; another room remains allowed.
