# KR room exit / re-entry lockout — local validation

Base: `6fce83d6d739cbc1c5eae60748dee95c12e58c5e`.

## Design

`room_membership_exits(room_id, owner_user_id)` is a durable terminal-exit ledger. It is keyed by server Auth ownership, survives participant deletion, and is intentionally not coupled to a soft-destroyed room row. Auth-user deletion cascades ledger cleanup.

`exit_room_permanently(room_id, reason, owner)` is the single idempotent SECURITY DEFINER primitive (fixed search path; no PUBLIC execute). It records the exit and deletes the active owned membership atomically. Insert is blocked both by a restrictive RLS policy and a before-insert trigger, so direct PostgREST cannot bypass a terminal exit.

Reconnect remains owner-based: an active participant with no exit record restores. Terminal exits clear room-local cache; startup, code join, QR/deep-link (via join), replay, and direct INSERT are denied. History (`user_game_history`) remains separate and never restores gameplay membership.

Current leave audit: explicit non-round leave formerly directly deleted a participant; active-round leaves are deferred and host cleanup now uses the same RPC. Existing host succession/destroy behavior remains intact. Legacy NULL-owner deferred rows cannot form an owner-keyed terminal record; they were already non-reclaimable under Identity R2.

## Local validation

- Local DB/Auth runtime: 15 checks PASS (`R2EXIT_*` data removed: 7 participants, 2 exits, 7 rooms; disposable local Auth users retained).
- Source lockout/reconnect/identity focused tests: 34 PASS.
- Deferred-leave compatibility contracts: 44 PASS.
- Official release gate: Normal 360/360, correctness 100%.
- Full non-timing: 95 files, 1,552 passed, 10 skipped, 0 failed, 134.96s.
- RC3 isolated: 63/63 passed, 1692.44s.
- HTML/JS syntax: PASS. `git diff --check`: PASS.

No Seoul/Tokyo/cmfx operation, migration application, or JKHC/HGRU mutation occurred.
