# Deployment Runbook

This project should be maintained through GitHub as the source of truth.

## Production URLs

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
