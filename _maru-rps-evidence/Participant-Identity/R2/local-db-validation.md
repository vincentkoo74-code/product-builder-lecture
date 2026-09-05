# KR Participant Identity R2 — Local DB Validation

## Scope

Local-only validation. No Seoul link, migration, Dashboard change, or
Tokyo/cmfx operation was performed. The isolated Supabase project is
`maru-rps-r2-local`; its configuration is in `/private/tmp/maru-rps-r2-local`.

## Docker and local stack

- Docker Client/Server: 29.7.2 / 29.7.2.
- Existing stack preserved: `woorimaru-fitflow-ios` from
  `/Users/vk/Projects/woorimaru-fitflow-ios`, including its published
  `54321`/`54322` ports. No existing container was stopped, removed, or
  modified.
- Validation stack used alternate ports: API `55421`, Postgres `55422`.
- Supabase CLI: 2.115.0.
- CLI workaround: temporary writable `HOME` and `XDG_CONFIG_HOME` under
  `/private/tmp/maru-rps-r2-cli-home`; the real user HOME was not changed.
- Local config: `/private/tmp/maru-rps-r2-local/supabase/config.toml`.
  `project_id = "maru-rps-r2-local"`, `db.major_version = 17`, and
  `[auth] enable_anonymous_sign_ins = true`. No remote project ref or DB URL
  is in the config. `supabase link` was never run.

## Baseline fixture and migration

The test-only fixture is `local-seoul-baseline-fixture.sql`. It reconstructs
only the 17 inspected rooms/participants columns, the text PK/FK, RLS, and
the two deployed `allow_all_*` policies. It contains no gameplay rows,
unsupported triggers, or application functions.

Baseline HTTP checks using the public anon API key returned HTTP 201 for room
INSERT and participant INSERT, reproducing the deployed broad baseline.

The identity migration applied with `ON_ERROR_STOP=1`. Result:

- `owner_user_id`: nullable `uuid`.
- FK: `auth.users(id) ON DELETE SET NULL`.
- Partial unique index: `(room_id, owner_user_id)` where owner is not NULL.
- Trigger: `BEFORE UPDATE ON public.participants`.
- Anon: SELECT true; INSERT/UPDATE/DELETE false.
- Authenticated: SELECT/INSERT/UPDATE/DELETE true; TRUNCATE false.
- The old `allow_all_participants` and `allow_all_rooms` policies are removed.
- New policies and helper functions are present.

The migration was reapplied successfully after the privilege correction.

## Runtime Auth/JWT matrix

Two local Anonymous Auth sessions and one local permanent authenticated user
were created. JWTs and refresh tokens were ephemeral and were not written to
the repository or included here. The runtime harness reported **30/30 PASS**:

- anonymous sign-in returns UUIDs and an existing session is reused;
- anon DML is rejected;
- owner-derived insert succeeds and owner spoofing fails;
- owner reassignment fails;
- non-host cross-user update/delete fails;
- host predicate distinguishes A from B;
- host-only room writes distinguish A from B;
- self host promotion fails;
- duplicate same-owner membership fails while a different room succeeds;
- legacy NULL ownership cannot be claimed;
- participant-ID collision does not transfer ownership;
- permanent Auth ownership follows the same `auth.uid()` path;
- a different anonymous session cannot reclaim the participant.

Host cross-row participant update/delete is intentionally permitted by the
current compatibility model only when the caller resolves as the room host;
the owner field remains immutable even for that host path.

## Rollback and repeatability

In the isolated database: baseline → migration → validation → rollback
restored the baseline owner-column absence and both `allow_all_*` policies;
the migration then reapplied successfully. A direct second application also
completed successfully, consistent with the migration's `IF NOT EXISTS`,
`DROP/CREATE POLICY`, and `CREATE OR REPLACE FUNCTION` policy.

## Tests

- Focused identity/Auth/Kakao source suite: 26/26 PASS.
- Runtime local DB/Auth suite: 30/30 PASS.
- Full `npx vitest run`: intentionally stopped during the long RC3 timing
  simulations after the initial measurement files completed; no final full
  aggregate was obtained. This is not a full-regression pass.
- `git diff --check`: recorded separately in the handoff report.

## Remaining gates

The full regression aggregate must complete in a later gate. Seoul Anonymous
Sign-In remains disabled and the migration is not applied. Active room direct
write paths still rely on narrowly scoped host policies and require future
product-level verification against the entire direct DML matrix. Broad room
and participant SELECT visibility remains a P1 privacy/membership-narrowing
follow-up.
