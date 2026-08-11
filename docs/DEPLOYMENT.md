# Deployment Runbook

This project should be maintained through GitHub as the source of truth.

## Regional Backend Separation — KR (Seoul) vs JP (Tokyo)

As of the KR V1.0_KR launch, this app ships against **two independent
Supabase projects**, selected by which values are hardcoded in
`index.html`'s `SUPABASE_URL`/`SUPABASE_ANON_KEY` constants:

| | KR V1.0_KR | JP (future) |
|---|---|---|
| Supabase project ref | `sannrfmhevebqgfdqcps` | `cmfxhehpreanijwanwrr` |
| Region | AWS `ap-northeast-2` (Seoul) | AWS `ap-northeast-1` (Tokyo) |
| Current `index.html` source of truth | ✅ this is what's live | not referenced in KR runtime source at all |
| Edge Functions deployed | `kakao-auth`, `delete-account` only | `kakao-auth`, `delete-account`, `line-auth` |
| LINE login | disabled in client (`ENABLE_LINE_LOGIN = false`), `line-auth` not deployed | preserved, deployable when JP ships |
| Apple Sign In provider | configured (Client ID `com.maru.rps.web`) | configured (pre-existing) |
| Google Sign In provider | disabled | enabled (pre-existing, unrelated to KR V1 scope) |
| Data | fresh KR V1 data only, no Tokyo data migrated | existing Tokyo data, untouched by KR work |

**Important — the JP/Tokyo values are intentionally not present anywhere in
`index.html` or other KR runtime source files**, per the KR V1 regional
separation decision. Anyone reintroducing a JP/Tokyo build should read the
`cmfxhehpreanijwanwrr` ref back in from this document (or a future
JP-specific build config), not from KR source history.

**CI/CD gap (known, not yet addressed)**: the `supabase-deploy.yml` workflow
below is hardcoded to the Tokyo (`cmfxhehpreanijwanwrr`) project ref and
only triggers on `supabase/**` changes on `main`. It does **not** deploy to
Seoul. Seoul's schema/functions were deployed manually via Supabase CLI
(see `docs/SEOUL_KR_V1_SECURITY_RISK_REGISTER.md` for the schema/RLS
decisions that shipped). Wiring Seoul into CI is a future task, not done as
part of this phase.

Known accepted V1 security risks for the Seoul backend (allow-all RLS on
`rooms`/`participants`, host authority not server-verified, etc.) are
tracked separately in `docs/SEOUL_KR_V1_SECURITY_RISK_REGISTER.md` — that
document also lists the required V2 security architecture backlog.

## Production URLs (JP / Tokyo — existing runbook below, unchanged)

- App: https://product-builder-lecture-phi.vercel.app
- Supabase project ref: `cmfxhehpreanijwanwrr`

## Step 1: Vercel Git Integration

In Vercel, open the production project and check:

- Settings -> Git -> Connected Git Repository:
  `vincentkoo74-code/product-builder-lecture`
- Settings -> Git -> Production Branch:
  `main`
- Settings -> Git -> Auto Deploy:
  enabled

After this is correct, every push to `main` should trigger Vercel production deployment.

## Step 2: GitHub Actions Secrets

Add these repository secrets in GitHub:

- `SUPABASE_ACCESS_TOKEN`
- `SUPABASE_DB_PASSWORD`

The Supabase deploy workflow uses the fixed project ref:

```text
cmfxhehpreanijwanwrr
```

`SUPABASE_ACCESS_TOKEN` must be a Supabase account access token that starts with
`sbp_`.

Create it at:

```text
https://supabase.com/dashboard/account/tokens
```

Do not use a publishable key, anon JWT, service role key, project URL, or database
password for `SUPABASE_ACCESS_TOKEN`.

`SUPABASE_DB_PASSWORD` must be the actual Postgres database password for this
project. If GitHub Actions shows `password authentication failed for user
"postgres"`, reset the database password in Supabase and update this secret.

## Workflows

- `.github/workflows/supabase-deploy.yml`
  - Pushes Supabase migrations.
  - Deploys all Edge Functions.
  - Runs migrations and Edge Function deployment as separate jobs so function
    deployment is not blocked by a bad database password.

- `.github/workflows/production-smoke.yml`
  - Waits for Vercel.
  - Checks production HTML contains the current app hooks.
  - Checks Kakao and LINE Edge Functions respond to `OPTIONS`.

## Normal Release Flow

1. Commit to `main`.
2. GitHub Actions deploys Supabase changes when `supabase/**` changes.
3. Vercel deploys the frontend from GitHub.
4. Production Smoke Test verifies the public app.
