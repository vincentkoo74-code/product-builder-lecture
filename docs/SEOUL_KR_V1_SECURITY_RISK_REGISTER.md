# Seoul (KR V1.0_KR) — Security Risk Register & V2 Backlog

Status: CEO-approved as of Phase 3C (2026-08-11). This document records what
V1 KR deliberately does NOT fix, and what V2 must fix. It is not a "resolved
issues" log — it is an accepted-risk register.

Scope: `public.rooms` / `public.participants` on the Seoul Supabase project
(migration `20260811010000_kr_v1_core_rooms_participants.sql`). Applies
identically to Tokyo today — these are pre-existing exposures inherited from
the current production architecture, not regressions introduced for Seoul.

## Accepted V1 risks (known security debt, NOT fixed by Option A)

### R1 — CRITICAL: Host authority has no server-verified invariant
Any participant can write `is_host:true` to their own row and `is_host:false`
to another participant's row via a direct REST call, with zero server-side
check. Multiple legitimate client flows already do this without proving host
lineage (`becomeNextHost`, `requestReplayFromJoinedRoom`, host-transfer). A
malicious actor who knows a room code can self-promote to host or demote the
real host at will.

### R2 — CRITICAL: Unfiltered UPDATE/DELETE achieves full-table tampering/wipe
`rooms`/`participants` RLS policy is `USING(true) WITH CHECK(true)` (allow
all) because current gameplay requires the host to write choice/is_ready/
wins/losses/draws/penalties on OTHER participants' rows (round judging,
ready-resets, auto-fill), and the "last participant cleans up the room" path
has no host check either. A plain unfiltered `DELETE /rest/v1/participants`
(or `/rooms`) with the public anon key removes every row PostgREST's
grant+RLS combination allows — currently all of them. No RLS-only mitigation
exists without breaking these flows (verified: header/JWT-claim-based tricks
were evaluated and rejected — the anon key is shipped client-side, so any
policy keyed on request headers is trivially forgeable, and there is no
`owner`/`user_id` column to key `auth.uid()`-based policies on even for
logged-in users).

### R3 — MEDIUM: Unlimited anonymous INSERT
`WITH CHECK(true)` on INSERT means anyone holding the (publicly embedded)
anon key can create unlimited `rooms`/`participants` rows — no rate limit or
quota at the DB layer. Spam/storage-abuse risk, not addressed by Option A.

### R4 — LOW: Edge Function CORS wildcard
`kakao-auth`, `line-auth`, `delete-account` all set
`Access-Control-Allow-Origin: "*"`. Not judged severely exploitable given the
auth model (OAuth code exchange is bound to the caller's own session;
`delete-account` requires a bearer token), but flagged for a future pass.
Out of RLS scope.

## What Option A actually does (applied in this migration)

Revokes `TRUNCATE`/`REFERENCES`/`TRIGGER` grants from `anon`/`authenticated`
on `rooms`/`participants`. This is unused-privilege hygiene only:
- Confirmed via full-file grep of `index.html` and review of all three Edge
  Functions that no client/server code path relies on these privileges.
- PostgREST does not expose `TRUNCATE` as a REST verb in the first place, so
  this does not close R2 (the real wipe vector is unfiltered DELETE/UPDATE,
  which remains fully open).
- Framed explicitly as defense-in-depth cleanup, not a resolution of R1/R2.

## V2 Security Architecture — required backlog (not optional)

The only real fix for R1/R2 is ownership-based access control, which needs
all of the following (CEO-mandated minimum scope for V2):

1. Supabase Anonymous Auth (`signInAnonymously()`) as the default guest
   identity — every device gets a real, non-shared `auth.uid()`.
2. `participants.owner_uid` (or equivalent) — a server-verifiable ownership
   column, set at insert time from `auth.uid()`.
3. `auth.uid()`-based RLS for self-scoped actions (choice submit, ready
   toggle, `leave_after_round`) — replacing today's `id`/`name`-matched,
   trust-the-client scoping.
4. Server-side verification of host authority — no client-asserted
   `state.role === 'host'` may be trusted for privileged writes.
5. Migrate host-only mutations (round judging, room-wide ready/choice
   resets, host transfer, room status transitions, room destroy) to
   `SECURITY DEFINER` RPCs (or an equivalent authoritative server API) that
   re-verify host status server-side before writing — mirroring the
   `search_path`-pinning pattern already used correctly in
   `supabase/migrations/20260726104300_server_now_rpc.sql`.
6. Abuse/rate-limiting for unrestricted room/participant creation (R3).
7. Guest → Apple/Kakao account upgrade path: design UID continuity and game
   history preservation when a guest's anonymous identity later links to a
   real login (must not orphan existing stats/history on upgrade).
8. Re-validate the Realtime authorization model under the new ownership
   design (Realtime `postgres_changes` delivery depends on the subscribing
   role's table-level grants being checked ahead of RLS — this interacts
   with whatever grant/policy changes V2 introduces and must be tested live,
   not assumed).

## Explicitly out of scope for V1 KR

- Option B (RPC-gated reads) — rejected for V1 due to unverified Realtime
  subscription breakage risk and understated client call-site count (24+
  actual vs. an initial ~10 estimate). May be revisited only with a live
  staging validation, independent of the V2 timeline.
- Any change to Tokyo. Tokyo is read-only reference for this entire
  register; nothing here is applied there.
- LINE-related functions/config — excluded from Seoul per standing KR
  decision, unrelated to this register.
