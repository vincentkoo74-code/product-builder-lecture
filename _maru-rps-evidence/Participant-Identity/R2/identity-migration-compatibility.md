# Identity migration compatibility — R2

## Deployed-to-draft matrix

| item | deployed evidence | draft compatibility |
|---|---|---|
| participants.id | `text NOT NULL PK` | compatible; participant IDs remain domain IDs |
| participants.room_id | `text NULL`, FK to rooms.id | compatible with helper signature `text` |
| rooms.id | `text NOT NULL PK` | compatible |
| owner_user_id | absent | nullable `uuid` addition required |
| FK | existing room FK is CASCADE | auth FK uses SET NULL independently |
| current index names | only `participants_pkey`, `rooms_pkey` | new names do not collide |
| current trigger names | zero matching triggers | new trigger name does not collide |
| current public functions | no matching application RPC | helper signatures do not collide in evidence |
| current policies | `allow_all_participants`, `allow_all_rooms` | must be dropped; otherwise ownership is bypassed |

## Required local corrections

`20260905090000_participant_owner_identity.sql` now:

1. adds nullable `owner_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL`;
2. keeps legacy rows NULL and adds an owner index plus partial unique `(room_id, owner_user_id)`;
3. makes owner/participant identity reassignment impossible, rejects unauthenticated trigger updates, and blocks non-host self-promotion;
4. derives host authority from `auth.uid()` and a bound `is_host` row;
5. drops deployed broad policies;
6. revokes anon room/participant security-sensitive DML;
7. preserves anon/authenticated SELECT for multiplayer discovery/visibility;
8. permits authenticated room creation, but restricts room UPDATE/DELETE to the authenticated owner-host;
9. restricts participant INSERT/normal UPDATE/DELETE to owner or proven host authority.

## ON DELETE SET NULL verdict

`SET NULL` is appropriate for the identity foundation: deleting an Auth user must not cascade-delete a room participant row or historical/game-domain state. The resulting unowned row cannot pass the new owner INSERT/normal lifecycle ownership predicates and must not be used by future secured lifecycle RPCs.

## Legacy and rollback

The partial unique index ignores NULL owners, so existing legacy rows do not collide. They remain visible under SELECT and may remain writable only through the proposed host path if an authenticated bound host can prove authority; a legacy NULL row itself cannot prove caller ownership. Fresh-room QA is required after migration; no backfill or cleanup is allowed.

Rollback must be a separately reviewed reverse migration. It must restore the exact pre-apply grants/policies from Seoul evidence before dropping the column; broad `PUBLIC ALL` restoration is intentionally not embedded as an automatic rollback.

## SECURITY DEFINER review

`public.prevent_participant_owner_reassignment()` and `public.participant_caller_is_room_host(text)` use `SECURITY DEFINER`, fixed `search_path = pg_catalog, public`, schema-qualified `public.participants`, explicit `auth.uid()`, no dynamic SQL, and `PUBLIC` execution revoked. The host helper is executable only by `authenticated`. Both reject `auth.uid() IS NULL`.

No application RPCs were deployed in the inspected result. The nine filtered functions were platform functions and were not changed.
