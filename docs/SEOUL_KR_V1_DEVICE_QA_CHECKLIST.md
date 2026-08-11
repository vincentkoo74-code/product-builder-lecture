# Seoul (KR V1.0_KR) — Real Device E2E QA Checklist

Status: pre-TestFlight. Not yet executed — this document defines what a
human must verify on a real iPhone before this build is considered
release-ready. Nothing in this checklist has been run; static/code-level
verification only has been completed (see commit and Phase 3D-3 report).

Build under test: KR V1.0_KR, Seoul Supabase backend (project ref
`sannrfmhevebqgfdqcps`), Tokyo (`cmfxhehpreanijwanwrr`) must remain
completely unaffected by any of these scenarios.

---

## A. Guest flow
- [ ] First app launch → auth screen renders correctly
- [ ] "로그인 없이 마루랑 놀기" (guest) works, no login required
- [ ] Nickname set/saved
- [ ] Room create as guest
- [ ] Room join as guest (by code and by QR)
- [ ] Ready toggle reflected for all participants
- [ ] RPS choice submission works
- [ ] Round progresses through judge → result → next round correctly
- [ ] Realtime: a second device/participant's actions appear live (not just via 2.6s poll fallback)
- [ ] `leave_after_round` UI (if wired to any control) behaves as expected — note: this feature is currently uncommitted WIP (WRPS-084) and is NOT part of this KR V1 release; confirm the guest flow works correctly with or without it being present
- [ ] Re-entering a room after leaving works
- [ ] Room ends/destroys correctly when last participant leaves

## B. Kakao login
- [ ] Kakao login button visible, tapping opens Kakao auth flow
- [ ] Login completes successfully, returns to app authenticated
- [ ] Confirm (via Seoul dashboard, not Tokyo) a new row appears in Seoul `auth.users` for this login — NOT in Tokyo
- [ ] Session persists across app restart
- [ ] Game stats/history save correctly after playing a round (`user_game_stats`/`user_game_history` in Seoul)
- [ ] Log out and log back in with the same Kakao account — same identity/stats resume correctly
- [ ] `delete-account` from account screen succeeds
- [ ] After delete: local session cleared (returns to auth screen, no stale nickname/session data), Seoul `auth.users` row removed, cascade-deleted `user_game_stats`/`user_game_history` for that user

## C. Apple login
- [ ] Apple Sign In button visible, tapping opens Apple auth flow
- [ ] Login completes successfully
- [ ] Confirm a new row appears in Seoul `auth.users` — NOT in Tokyo
- [ ] Session persists across app restart
- [ ] Game stats/history save correctly
- [ ] Log out and log back in with the same Apple ID — same identity/stats resume correctly
- [ ] `delete-account` succeeds, same cleanup checks as Kakao (B) above

## D. Region isolation (critical — verify via Seoul/Tokyo dashboards directly, not just app behavior)
- [ ] A newly created KR test account (Kakao or Apple) appears in **Seoul** `auth.users`
- [ ] A newly created KR test room appears in **Seoul** `rooms`/`participants`
- [ ] **Tokyo** `auth.users`/`rooms`/`participants` show **zero** new rows from this testing session
- [ ] Tokyo project's Edge Function invocation logs (if checked) show no calls originating from this KR test session

## E. Regression / disabled-feature checks
- [ ] LINE login button does NOT appear on the auth screen
- [ ] No code path allows reaching a LINE OAuth flow (attempting a stale `?provider=line` deep link, if testable, should not complete a login)
- [ ] Google Sign In button may be visually present but tapping it must NOT complete a real login (provider disabled on Seoul) — confirm it fails gracefully, not with a crash
- [ ] Core game loop (create → join → ready → choice → judge → next round → game over → stats) behaves identically to the pre-Seoul-migration build — no visual or functional regression
- [ ] App does not crash or hang on any of the above flows

---

## How to verify Seoul vs Tokyo without exposing credentials
Use the Supabase Dashboard UI (logged in as the account owner) for both
projects side by side — Table Editor for `auth.users`/`rooms`/`participants`/
`user_game_stats`/`user_game_history`, filtered by recent `created_at`. Do
not paste connection strings, access tokens, or database passwords into any
QA report or bug ticket derived from this checklist.

## Sign-off
This checklist must be completed and attached to the release decision
before any TestFlight/App Store upload. Uploading is explicitly out of
scope for this document and must not be performed as part of executing it.
