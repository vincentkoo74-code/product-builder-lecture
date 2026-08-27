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

> ⛔ **2026-08-27: Tokyo Supabase 프로젝트(`cmfxhehpreanijwanwrr`)는 존재하지 않는다.**
> 3개 공용 DNS 리졸버 모두 NXDOMAIN. 위 표의 "JP (future)" 열 중 project ref /
> Edge Functions / Auth provider 항목은 **더 이상 사실이 아니다.**
> [JP_V1_BASELINE.md](JP_V1_BASELINE.md) 0절과 [JP_RELEASE_BACKLOG.md](JP_RELEASE_BACKLOG.md)
> `JP-BL-013` 을 먼저 읽을 것.

> **이 브랜치는 JP(V1.0_JP) 빌드다.** 위 표의 "JP (future)" 열이 현재 이 브랜치의
> 실제 설정이다. 작업 기준점·분기 SHA·현재 상태는
> [JP_V1_BASELINE.md](JP_V1_BASELINE.md) 를 먼저 읽을 것.

**리전 값의 단일 기준이 바뀌었다.** 예전에는 이 문서가 project ref 의 출처였지만,
지금은 기계가 읽는 두 파일이 단일 기준이다.

- `config/regions.json` — 국가별 백엔드/공개 식별자 레지스트리
- `config/active-region.json` — 이 브랜치가 빌드하는 국가 선언 (현재 **JP**)

`index.html` 의 `SUPABASE_URL`/`SUPABASE_ANON_KEY` 를 손으로 바꾸는 대신,
`scripts/region-guard.mjs` 가 빌드마다 이 선언과 실제 상수의 일치를 검사하고
어긋나면 빌드를 중단한다(fail-closed). 설계는
[KR_JP_CONFIG_SEPARATION.md](KR_JP_CONFIG_SEPARATION.md) 참조.

**CI/CD 갭 — 해소됨 (2026-08-27).** 이전 `supabase-deploy.yml` 은 `main` 에 push 되면
Tokyo 프로젝트에 마이그레이션과 Edge Function 을 **자동 배포**했다. KR/JP 이원 운영에서
이는 의도하지 않은 타국 프로덕션 변경 경로였다. 현재는 다음과 같이 바뀌었다.

- 자동 트리거 전면 삭제 — `workflow_dispatch` 전용
- 배포 대상 국가를 입력으로 받고 project ref 는 `config/regions.json` 에서 도출
- 대상 project ref 를 그대로 타이핑해야 진행
- 브랜치의 `active-region.json` 과 배포 대상이 다르면 중단
- `environment: supabase-<REGION>` — **단, GitHub Settings > Environments 에서
  required reviewers 를 걸어야 실제 승인 게이트가 생긴다 (JP-BL-004, 미완료)**

Seoul 은 여전히 CI 에 연결되어 있지 않고 Supabase CLI 로 수동 배포한다. 위 워크플로에
`region: KR` 로 실행하면 Seoul 에도 배포할 수 있으나, 아직 실사용 검증은 하지 않았다.

미해결 항목은 [JP_RELEASE_BACKLOG.md](JP_RELEASE_BACKLOG.md) 에서 추적한다.

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

The Supabase deploy workflow no longer uses a fixed project ref. It resolves the
target from `config/regions.json` using the `region` input (KR|JP) and refuses to
run unless the typed confirmation matches that project ref.

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
