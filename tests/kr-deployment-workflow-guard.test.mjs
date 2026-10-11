import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const workflow = readFileSync(path.join(root, '.github/workflows/supabase-deploy.yml'), 'utf8');
const approvalScripts = `${readFileSync(path.join(root, 'scripts/create-kr-deployment-approval.mjs'), 'utf8')}\n${readFileSync(path.join(root, 'scripts/verify-kr-deployment-approval.mjs'), 'utf8')}`;
const guard = path.join(root, 'scripts/assert-kr-security-migration-scope.mjs');
const createApproval = path.join(root, 'scripts/create-kr-deployment-approval.mjs');
const verifyApproval = path.join(root, 'scripts/verify-kr-deployment-approval.mjs');

function checkDryRun(output, ...ids) {
  return spawnSync(process.execPath, [guard, ...ids], { input: output, encoding: 'utf8' });
}

describe('KR Supabase deployment guard', () => {
  it('keeps ordinary main pushes in a validation-only workflow path', () => {
    const pushTrigger = workflow.slice(workflow.indexOf('\n  push:'), workflow.indexOf('\n  workflow_dispatch:'));
    expect(pushTrigger).toContain('branches:');
    expect(pushTrigger).toContain('- main');
    expect(workflow).toMatch(/deploy-approved-kr-bundle:[\s\S]*?if:\s*github\.event_name == 'workflow_dispatch'/);
    expect(workflow).toContain("github.ref == 'refs/heads/main'");
    expect(workflow).toContain('environment: supabase-KR');
    expect(workflow).toContain('npm test');
    expect(workflow).toContain('npm run test:syntax');
    expect(workflow).toContain('pull_request:');
    const deploymentJob = workflow.slice(workflow.indexOf('  deploy-approved-kr-bundle:'));
    expect(workflow.slice(0, workflow.indexOf('  deploy-approved-kr-bundle:'))).not.toMatch(/supabase (?:db push|functions deploy|link)/);
    expect(deploymentJob).toContain("github.event_name == 'workflow_dispatch'");
    expect(workflow).toMatch(/deploy-approved-kr-bundle:[\s\S]*?concurrency:[\s\S]*?group: supabase-kr-production-deploy/);
    expect(workflow).toMatch(/deploy-approved-kr-bundle:[\s\S]*?environment: supabase-KR/);
    expect(workflow).toMatch(/prepare-kr-deployment:[\s\S]*?Generate approval request manifest/);
  });

  it('pins KR target and only the reviewed migration and Edge Function', () => {
    expect(workflow).toContain('SUPABASE_PROJECT_REF: sannrfmhevebqgfdqcps');
    expect(workflow).toContain('supabase functions deploy delete-account --project-ref');
    expect(workflow).not.toMatch(/supabase functions deploy\s+--project-ref/);
    expect(workflow).toContain('assert-kr-security-migration-scope.mjs');
    expect(approvalScripts).toContain('edd7913cedb1199d0b2b46c1adf9f02de809d2a32bf68764cabd2a043e419a6f');
    expect(approvalScripts).toContain('5ce018839b8663ba149078eabad5658b303b2928872eaa7a879130a629d86b9f');
    expect(approvalScripts).toContain('02a35c5619bc351876ffc3fa6ce3b3d6cbfd112174a5aae5df294992fc1c1fe9');
    expect(workflow).toContain('secrets.KR_SUPABASE_ACCESS_TOKEN');
    expect(workflow).toContain('secrets.KR_SUPABASE_DB_PASSWORD');
    expect(workflow).not.toContain('secrets.SUPABASE_ACCESS_TOKEN');
    expect(workflow).not.toContain('secrets.SUPABASE_DB_PASSWORD');
    expect(workflow).toContain('inputs.prepare_run_id');
    expect(workflow).toContain('verify-kr-deployment-approval.mjs');
    expect(workflow).toContain('actions/download-artifact@d3f86a106a0bac45b974a628896c90dbdf5c8093');
    expect(workflow).toContain('environment: supabase-KR');
    const actions = [...workflow.matchAll(/^\s+uses:\s+([^\s]+)(?:\s+#.*)?$/gm)].map((match) => match[1]);
    expect(actions.length).toBeGreaterThan(0);
    for (const action of actions) expect(action).toMatch(/@[0-9a-f]{40}(?:\s|$)/);
  });

  it('fails closed when the CLI format or pending migration set differs', () => {
    const exact = 'Would push these migrations:\n • 20261010100000_release_security_scoped_reads_and_account_results.sql\n • 20261010110000_resumable_account_deletion.sql\n';
    expect(checkDryRun(exact, '20261010100000', '20261010110000').status).toBe(0);
    expect(checkDryRun('no migrations are pending\n', '20261010100000', '20261010110000').status).not.toBe(0);
    expect(checkDryRun('Would push these migrations:\n • 20261010100000_a.sql\n • 20261010110000_b.sql\n • 20261010120000_unreviewed.sql\n', '20261010100000', '20261010110000').status).not.toBe(0);
    expect(checkDryRun('Would push these migrations:\n • 20261010110000_b.sql\n', '20261010100000', '20261010110000').status).not.toBe(0);
  });

  it('binds an approval request to exact source hashes and fails closed until all release evidence passes', () => {
    const temp = mkdtempSync(path.join(os.tmpdir(), 'kr-deploy-approval-'));
    try {
      const manifestPath = path.join(temp, 'approval-request.json');
      const commit = 'a'.repeat(40);
      const runId = '123456789';
      const generated = spawnSync(process.execPath, [createApproval, '--commit', commit, '--run-id', runId, '--output', manifestPath], { cwd: root, encoding: 'utf8' });
      const bundleFiles = [
        'supabase/migrations/20261010100000_release_security_scoped_reads_and_account_results.sql',
        'supabase/migrations/20261010110000_resumable_account_deletion.sql',
        'supabase/functions/delete-account/index.ts',
      ];
      if (!bundleFiles.every((file) => existsSync(path.join(root, file)))) {
        expect(generated.status).not.toBe(0);
        expect(generated.stderr).toMatch(/Reviewed source (file is missing|hash mismatch)/);
        return;
      }
      expect(generated.status).toBe(0);
      const draft = JSON.parse(readFileSync(manifestPath, 'utf8'));
      expect(draft.projectRef).toBe('sannrfmhevebqgfdqcps');
      expect(draft.backupRestore.encryptedBackup).toBe('NOT_VERIFIED');
      const blocked = spawnSync(process.execPath, [verifyApproval, manifestPath, '--commit', commit, '--request-id', draft.requestId, '--run-id', runId], { cwd: root, encoding: 'utf8' });
      expect(blocked.status).not.toBe(0);

      const { requestId: _oldId, ...body } = draft;
      body.backupRestore.encryptedBackup = 'PASS';
      body.backupRestore.isolatedRestore = 'PASS';
      body.build76Compatibility = 'PASS';
      body.rollbackPlan = 'PASS';
      body.failurePlan = 'PASS';
      const newId = `KR-${createHash('sha256').update(JSON.stringify(body)).digest('hex').slice(0, 16)}`;
      writeFileSync(manifestPath, `${JSON.stringify({ ...body, requestId: newId }, null, 2)}\n`);
      expect(spawnSync(process.execPath, [verifyApproval, manifestPath, '--commit', commit, '--request-id', newId, '--run-id', runId], { cwd: root, encoding: 'utf8' }).status).toBe(0);
      expect(spawnSync(process.execPath, [verifyApproval, manifestPath, '--commit', 'b'.repeat(40), '--request-id', newId, '--run-id', runId], { cwd: root, encoding: 'utf8' }).status).not.toBe(0);
      expect(spawnSync(process.execPath, [verifyApproval, manifestPath, '--commit', commit, '--request-id', draft.requestId, '--run-id', runId], { cwd: root, encoding: 'utf8' }).status).not.toBe(0);

      body.migrations[0].sha256 = '0'.repeat(64);
      const wrongHashId = `KR-${createHash('sha256').update(JSON.stringify(body)).digest('hex').slice(0, 16)}`;
      writeFileSync(manifestPath, `${JSON.stringify({ ...body, requestId: wrongHashId }, null, 2)}\n`);
      expect(spawnSync(process.execPath, [verifyApproval, manifestPath, '--commit', commit, '--request-id', wrongHashId, '--run-id', runId], { cwd: root, encoding: 'utf8' }).status).not.toBe(0);
    } finally {
      rmSync(temp, { recursive: true, force: true });
    }
  });
});
