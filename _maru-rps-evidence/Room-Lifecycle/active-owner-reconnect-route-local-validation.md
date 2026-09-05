# Active owner reconnect routing — local validation

Branch: `dev/kr-active-reconnect-route-fix`
Base: `ff872b8e3a52245194efb676d45bfd5c62c46205`

## Root cause and correction

`applyOwnedRoomRecovery()` hydrated `state.status` from the recovered server room before it called `subscribeToRoom()`. The subscription's initial `handleRoomUpdate(room)` therefore saw no status transition and did not route a recovered `waiting` host to the room screen. `initFromUrl()` then returned for the successful reclaim, leaving the cold-launch safe Home screen as the final route.

The correction leaves server ownership discovery unchanged and adds one awaited, canonical `handleRoomUpdate(room)` after subscription setup, with a startup-only prior-status marker. A recovered active room now makes the room route the final route. It does not insert a participant or create a room. A terminal-exit ledger remains an override and prevents recovery.

The prior `normalizeColdLaunchScreen()` fix remains the synchronous boot-safe screen normalization; it is not the final route decision.

## Local validation

- Focused source/security/room tests: 46 passed, 0 failed.
- HTML/JS syntax: PASS.
- Official release gate: Normal 360/360; correctness 100%; gate PASS.
- Full non-timing regression: 96 files passed; 1,564 passed, 10 skipped, 0 failed; 262.32s.
- RC3 isolated: 63/63 passed; 1680.08s.
- `git diff --check`: PASS before final commit.

No Seoul operation was performed. WZ5L, JKHC, and HGRU were not read, written, or deleted by this local branch work.

## Device retest

With WZ5L still containing its active host participant and no terminal-exit ledger row: launch the fixed direct-development build, force-quit, relaunch from the iPhone icon, dismiss the guide if shown, and verify WZ5L returns as host. Confirm no participant or room is inserted; only then proceed to terminal-exit Case B validation.
