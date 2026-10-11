# Maru RPS KR one-person operations

## Normal change path

Codex prepares a focused change, runs the relevant automated checks, and opens a pull request. The existing `Deploy Supabase` workflow must remain disabled until the protected replacement has been reviewed and merged. The replacement workflow runs validation on pull requests and `main` pushes; neither path receives deployment credentials or runs production commands.

## Prepare and approve a KR deployment

1. Before requesting a deployment, complete the production backup and isolated restore, Build 76 compatibility decision, test evidence, and rollback plan. Record all four as `PASS` in `docs/qa/kr-production-deployment-evidence.json`; the template currently records `NOT_VERIFIED` and is not sufficient.
2. Run **Actions → Supabase KR validation and approved deployment → Run workflow** on `main`, select `prepare_kr_deployment`, and enter the exact candidate commit SHA. This job has no production credentials. It emits an approval artifact with a request ID, SHA-256 hashes for the exact migration/function bundle, test evidence, compatibility, backup/restore status, and rollback reference.
3. Review the artifact and the matching workflow run. If any source, evidence, scope, or content changes, prepare again; the request ID binds the request contents and run ID.
4. After deciding to approve, run the workflow again on the same `main` commit with `deploy_approved_kr_bundle`, and enter the candidate SHA, request ID, and Prepare run ID. GitHub pauses the protected job at the `supabase-KR` environment reviewer gate. The owner reviews and approves that deployment in **Actions → workflow run → Review deployments**. This approval is the explicit production-change approval; merely dispatching the workflow is not approval.
5. The deploy job checks the Prepare run, artifact, request ID, commit, approved file hashes, KR project ref, and all release evidence again. It refuses to deploy any additional migrations or Edge Functions. Review the Actions log and Supabase migration ledger/function revision after completion.

The protected job expects only the environment secrets `KR_SUPABASE_ACCESS_TOKEN` and `KR_SUPABASE_DB_PASSWORD` in **Settings → Environments → supabase-KR**. It must not fall back to repository secrets. Do not add, move, or delete secrets without a separately approved credential change. These environment secrets are currently absent, so deployment remains blocked.

## Failed or interrupted deployment

Do not rerun blindly. Preserve the workflow run ID and logs, check the KR migration ledger and deployed function version, then decide whether the operation partially completed. A migration that is already recorded must not be replayed by editing its history. Use a new forward migration for correction; database rollback is not assumed to be safe. If an unauthorized run is pending, use the workflow run's **Cancel workflow** control; if unauthorized executions are possible, disable the replacement workflow and keep the legacy workflow disabled.

## Audit trail and emergency stop

Keep the approval artifact, request ID, source SHA, deployment run ID, migration ledger result, and function revision together in the QA release record. GitHub retains workflow runs and environment approval history; periodically export those records to the controlled project archive. For an emergency stop, disable the exact deployment workflow in **Actions → workflow → … → Disable workflow** and verify its API state is `disabled_manually`. Do not disable the separate Production Smoke Test.

## Current limitations

- The repository is public and the connected GitHub identity has repository administrator/write permissions. A one-person model therefore relies on the human owner reviewing and approving the environment gate; a Codex token with the same authority could potentially initiate and approve a run. Use a separate least-privilege automation identity that cannot approve deployments before production use.
- `supabase-KR` currently has a required reviewer, but self-review prevention is off; this permits the sole operator to approve their own initiated deployment. Admin bypass and branch protection must be reviewed and tightened through GitHub settings before controlled rollout.
- `main` currently has no branch protection, and the environment's deployment branch allowlist does not include `main`. Those remote settings are intentionally not changed by this local preparation.
- No KR environment secrets, encrypted production backup, isolated restore evidence, or Build 76 compatibility PASS evidence currently exists. The workflow deliberately refuses to proceed while these gates are missing.
