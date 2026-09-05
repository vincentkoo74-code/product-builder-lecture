# Seoul deployed schema analysis — R2

Source: `seoul-participant-identity-consolidated-result.csv`, executed manually against `maru-rps-production-kr` (`sannrfmhevebqgfdqcps`, `ap-northeast-2`). CSV integrity: 331 rows; section counts match the expected counts.

## Context and RLS state

| item | value |
|---|---|
| database / schema | `postgres` / `public` |
| inspection role | `postgres` |
| PostgreSQL | 17.6 |
| search_path | `"$user", public, extensions` |
| row_security | `on` |
| tables | `rooms`: RLS enabled, not forced, owner `postgres`; `participants`: RLS enabled, not forced, owner `postgres` |

## Exact columns

| table | column | PostgreSQL type / UDT | nullable | default |
|---|---|---|---|---|
| participants | id | `text` / `pg_catalog.text` | NO | — |
| participants | room_id | `text` / `pg_catalog.text` | YES | — |
| participants | name | `text` / `pg_catalog.text` | NO | — |
| participants | is_host | `boolean` / `bool` | YES | `false` |
| participants | choice | `text` / `text` | YES | — |
| participants | wins/losses/draws/penalties | `integer` / `int4` | YES | `0` |
| participants | created_at | `timestamp with time zone` / `timestamptz` | YES | `now()` |
| participants | is_ready | `boolean` / `bool` | YES | `false` |
| participants | leave_after_round | `boolean` / `bool` | NO | `false` |
| rooms | id | `text` / `pg_catalog.text` | NO | — |
| rooms | status | `text` / `text` | YES | `'waiting'::text` |
| rooms | penalty | `text` / `text` | YES | — |
| rooms | round | `integer` / `int4` | YES | `1` |
| rooms | created_at | `timestamp with time zone` / `timestamptz` | YES | `now()` |

No deployed `owner_user_id` exists. No identity/generated columns were present. `participants.id` and `rooms.id` are primary keys. `participants.room_id` references `rooms.id` with `ON DELETE CASCADE`, `ON UPDATE NO ACTION`.

## Constraints, indexes, triggers

Constraints: `participants_pkey`, `rooms_pkey`, and `participants_room_id_fkey`; no unique/check constraints beyond the primary keys were returned. Both primary-key indexes are unique, non-partial. The trigger section returned zero rows, which means zero matching triggers on `public.rooms`/`public.participants` in the executed inspection—not an omitted section.

## Deployed policies and effective security

| table | policy | role | command | mode | USING | WITH CHECK |
|---|---|---|---|---|---|---|
| participants | `allow_all_participants` | PUBLIC | ALL | PERMISSIVE | `true` | `true` |
| rooms | `allow_all_rooms` | PUBLIC | ALL | PERMISSIVE | `true` | `true` |

Both tables are therefore unrestricted for any role possessing table privileges. The CSV shows anon and authenticated `SELECT/INSERT/UPDATE/DELETE` grants on both tables. Consequently:

- anon can directly insert, update, delete, and select both tables;
- authenticated users can directly perform the same DML;
- RLS enabled is not meaningful protection while these policies remain;
- adding an owner policy without removing these permissive policies would leave an OR path around ownership;
- any future lifecycle RPC is not sufficient while arbitrary direct room/participant DML remains available.

## Functions and default ACLs

The nine filtered functions were platform `extensions`, `realtime`, and `storage` functions; no obvious public Maru RPS room/participant RPC appeared. The function-grants section returned zero rows. This does not prove no functions exist: it proves none matched the inspection filter as application RPCs with routine privilege rows. No triggers matched.

Default ACLs are broad: public-schema `supabase_admin` defaults grant table `arwdDxtm`, sequence `rwU`, and function `X` to anon/authenticated/service_role; a public-schema `postgres` table default also grants broad DML. These platform defaults must not be globally changed here. Application migrations must explicitly set/revoke object privileges.

## Policy composition

Current, for every table/command: `required table privilege AND (PUBLIC permissive policy = true)`, so anon and authenticated direct DML succeeds.

The local migration replacement is:

- participants SELECT: `anon/authenticated policy true` → room visibility;
- participants INSERT: authenticated policy `owner_user_id = auth.uid()`;
- participants UPDATE: authenticated policy `(owner_user_id = auth.uid() OR caller is owner-host)`;
- participants DELETE: authenticated policy `(owner_user_id = auth.uid() OR caller is owner-host)`;
- rooms SELECT: `anon/authenticated policy true` → room-code discovery;
- rooms INSERT: authenticated policy `auth.uid() IS NOT NULL`;
- rooms UPDATE/DELETE: authenticated policy `participant_caller_is_room_host(id)`;
- anon room/participant INSERT/UPDATE/DELETE: no table privilege, therefore denied before policy evaluation.

The owner-update trigger additionally prevents a non-host owner from changing `is_host`; host-state mutation requires an already-bound current host.

The current compatibility patch intentionally keeps participant/room SELECT broadly available for room-code preview and multiplayer rendering. That remains a P1 privacy/room-membership hardening item; it is not an ownership bypass for DML.

The local migration drops both broad policies before creating these role-scoped policies. No permissive legacy bypass remains in the proposed state.
