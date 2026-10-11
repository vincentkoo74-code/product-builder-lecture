import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const workflow = readFileSync(path.join(root, '.github/workflows/supabase-deploy.yml'), 'utf8');
const ciWorkflow = readFileSync(path.join(root, '.github/workflows/kr-deployment-guard-ci.yml'), 'utf8');
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
    assert.ok(pushTrigger.includes('branches:'));
    assert.ok(pushTrigger.includes('- main'));
    assert.match(workflow, /deploy-approved-kr-bundle:[\s\S]*?if:\s*github\.event_name == 'workflow_dispatch'/);
    assert.ok(workflow.includes("github.ref == 'refs/heads/main'"));
    assert.ok(workflow.includes('environment: supabase-KR'));
    assert.ok(workflow.includes('npm test'));
    assert.ok(workflow.includes('npm run test:syntax'));
    assert.ok(workflow.includes('pull_request:'));
    assert.ok(ciWorkflow.includes('pull_request:'));
    assert.ok(ciWorkflow.includes('branches:'));
    assert.ok(ciWorkflow.includes('- main'));
    assert.ok(!ciWorkflow.includes('paths:'));
    assert.ok(ciWorkflow.includes('contents: read'));
    assert.ok(ciWorkflow.includes('npm test'));
    assert.ok(ciWorkflow.includes('node --test tests/kr-deployment-workflow-guard.test.mjs'));
    assert.doesNotMatch(ciWorkflow, /supabase (?:db push|functions deploy|link)/);
    assert.doesNotMatch(ciWorkflow, /secrets\./i);
    const ciActions = [...ciWorkflow.matchAll(/^\s+uses:\s+([^\s]+)(?:\s+#.*)?$/gm)].map((match) => match[1]);
    assert.ok(ciActions.length > 0);
    for (const action of ciActions) assert.match(action, /@[0-9a-f]{40}(?:\s|$)/);
    const deploymentJob = workflow.slice(workflow.indexOf('  deploy-approved-kr-bundle:'));
    assert.doesNotMatch(workflow.slice(0, workflow.indexOf('  deploy-approved-kr-bundle:')), /supabase (?:db push|functions deploy|link)/);
    assert.ok(deploymentJob.includes("github.event_name == 'workflow_dispatch'"));
    assert.match(workflow, /deploy-approved-kr-bundle:[\s\S]*?concurrency:[\s\S]*?group: supabase-kr-production-deploy/);
    assert.match(workflow, /deploy-approved-kr-bundle:[\s\S]*?environment: supabase-KR/);
    assert.match(workflow, /prepare-kr-deployment:[\s\S]*?Generate approval request manifest/);
  });

  it('pins KR target and only the reviewed migration and Edge Function', () => {
    assert.ok(workflow.includes('SUPABASE_PROJECT_REF: sannrfmhevebqgfdqcps'));
    assert.ok(workflow.includes('supabase functions deploy delete-account --project-ref'));
    assert.doesNotMatch(workflow, /supabase functions deploy\s+--project-ref/);
    assert.ok(workflow.includes('assert-kr-security-migration-scope.mjs'));
    assert.ok(approvalScripts.includes('edd7913cedb1199d0b2b46c1adf9f02de809d2a32bf68764cabd2a043e419a6f'));
    assert.ok(approvalScripts.includes('5ce018839b8663ba149078eabad5658b303b2928872eaa7a879130a629d86b9f'));
    assert.ok(approvalScripts.includes('02a35c5619bc351876ffc3fa6ce3b3d6cbfd112174a5aae5df294992fc1c1fe9'));
    assert.ok(workflow.includes('secrets.KR_SUPABASE_ACCESS_TOKEN'));
    assert.ok(workflow.includes('secrets.KR_SUPABASE_DB_PASSWORD'));
    assert.ok(!workflow.includes('secrets.SUPABASE_ACCESS_TOKEN'));
    assert.ok(!workflow.includes('secrets.SUPABASE_DB_PASSWORD'));
    assert.ok(workflow.includes('inputs.prepare_run_id'));
    assert.ok(workflow.includes('verify-kr-deployment-approval.mjs'));
    assert.ok(workflow.includes('actions/download-artifact@d3f86a106a0bac45b974a628896c90dbdf5c8093'));
    assert.ok(workflow.includes('environment: supabase-KR'));
    const actions = [...workflow.matchAll(/^\s+uses:\s+([^\s]+)(?:\s+#.*)?$/gm)].map((match) => match[1]);
    assert.ok(actions.length > 0);
    for (const action of actions) assert.match(action, /@[0-9a-f]{40}(?:\s|$)/);
  });

  it('fails closed when the CLI format or pending migration set differs', () => {
    const exact = 'Would push these migrations:\n • 20261010100000_release_security_scoped_reads_and_account_results.sql\n • 20261010110000_resumable_account_deletion.sql\n';
    assert.strictEqual(checkDryRun(exact, '20261010100000', '20261010110000').status, 0);
    assert.notEqual(checkDryRun('no migrations are pending\n', '20261010100000', '20261010110000').status, 0);
    assert.notEqual(checkDryRun('Would push these migrations:\n • 20261010100000_a.sql\n • 20261010110000_b.sql\n • 20261010120000_unreviewed.sql\n', '20261010100000', '20261010110000').status, 0);
    assert.notEqual(checkDryRun('Would push these migrations:\n • 20261010110000_b.sql\n', '20261010100000', '20261010110000').status, 0);
  });

  it('binds an approval request to exact source hashes and fails closed until all release evidence passes', () => {
    const temp = mkdtempSync(path.join(os.tmpdir(), 'kr-deploy-approval-'));
    try {
      const manifestPath = path.join(temp, 'approval-request.json');
      const commit = 'a'.repeat(40);
      const runId = '123456789';
      const bundleFiles = new Map([
        [
        'supabase/migrations/20261010100000_release_security_scoped_reads_and_account_results.sql',
          'fixture migration one',
        ],
        [
        'supabase/migrations/20261010110000_resumable_account_deletion.sql',
          'fixture migration two',
        ],
        [
        'supabase/functions/delete-account/index.ts',
          'fixture Edge Function',
        ],
      ]);
      const pinnedHashes = [
        'edd7913cedb1199d0b2b46c1adf9f02de809d2a32bf68764cabd2a043e419a6f',
        '5ce018839b8663ba149078eabad5658b303b2928872eaa7a879130a629d86b9f',
        '02a35c5619bc351876ffc3fa6ce3b3d6cbfd112174a5aae5df294992fc1c1fe9',
      ];
      const fixtureHashes = [...bundleFiles.values()].map((contents) => createHash('sha256').update(contents).digest('hex'));
      for (const file of bundleFiles.keys()) mkdirSync(path.dirname(path.join(temp, file)), { recursive: true });
      [...bundleFiles].forEach(([file, contents]) => writeFileSync(path.join(temp, file), contents));

      const createSource = readFileSync(createApproval, 'utf8');
      const verifySource = readFileSync(verifyApproval, 'utf8');
      for (let index = 0; index < pinnedHashes.length; index += 1) {
        assert.ok(createSource.includes(pinnedHashes[index]));
        assert.ok(verifySource.includes(pinnedHashes[index]));
      }
      const fixtureCreate = path.join(temp, 'create-approval.mjs');
      const fixtureVerify = path.join(temp, 'verify-approval.mjs');
      writeFileSync(fixtureCreate, pinnedHashes.reduce((source, hash, index) => source.replaceAll(hash, fixtureHashes[index]), createSource));
      writeFileSync(fixtureVerify, pinnedHashes.reduce((source, hash, index) => source.replaceAll(hash, fixtureHashes[index]), verifySource));

      const blockedGeneration = spawnSync(process.execPath, [fixtureCreate, '--commit', commit, '--run-id', runId, '--output', manifestPath], { cwd: temp, encoding: 'utf8' });
      assert.strictEqual(blockedGeneration.status, 0);
      const blockedDraft = JSON.parse(readFileSync(manifestPath, 'utf8'));
      assert.strictEqual(blockedDraft.backupRestore.encryptedBackup, 'NOT_VERIFIED');
      assert.notEqual(spawnSync(process.execPath, [fixtureVerify, manifestPath, '--commit', commit, '--request-id', blockedDraft.requestId, '--run-id', runId], { cwd: temp, encoding: 'utf8' }).status, 0);

      mkdirSync(path.join(temp, 'docs/qa'), { recursive: true });
      writeFileSync(path.join(temp, 'docs/qa/kr-production-deployment-evidence.json'), JSON.stringify({
        encrypted_backup: 'PASS', isolated_restore: 'PASS', build76_compatibility: 'PASS', rollback_plan: 'PASS', failure_plan: 'PASS',
      }));
      const generated = spawnSync(process.execPath, [fixtureCreate, '--commit', commit, '--run-id', runId, '--output', manifestPath], { cwd: temp, encoding: 'utf8' });
      assert.strictEqual(generated.status, 0);
      const draft = JSON.parse(readFileSync(manifestPath, 'utf8'));
      assert.strictEqual(draft.projectRef, 'sannrfmhevebqgfdqcps');
      assert.strictEqual(draft.backupRestore.encryptedBackup, 'PASS');

      const { requestId: _oldId, ...body } = draft;
      const newId = `KR-${createHash('sha256').update(JSON.stringify(body)).digest('hex').slice(0, 16)}`;
      writeFileSync(manifestPath, `${JSON.stringify({ ...body, requestId: newId }, null, 2)}\n`);
      assert.strictEqual(spawnSync(process.execPath, [fixtureVerify, manifestPath, '--commit', commit, '--request-id', newId, '--run-id', runId], { cwd: temp, encoding: 'utf8' }).status, 0);
      assert.notEqual(spawnSync(process.execPath, [fixtureVerify, manifestPath, '--commit', 'b'.repeat(40), '--request-id', newId, '--run-id', runId], { cwd: temp, encoding: 'utf8' }).status, 0);
      assert.notEqual(spawnSync(process.execPath, [fixtureVerify, manifestPath, '--commit', commit, '--request-id', blockedDraft.requestId, '--run-id', runId], { cwd: temp, encoding: 'utf8' }).status, 0);

      body.migrations[0].sha256 = '0'.repeat(64);
      const wrongHashId = `KR-${createHash('sha256').update(JSON.stringify(body)).digest('hex').slice(0, 16)}`;
      writeFileSync(manifestPath, `${JSON.stringify({ ...body, requestId: wrongHashId }, null, 2)}\n`);
      assert.notEqual(spawnSync(process.execPath, [fixtureVerify, manifestPath, '--commit', commit, '--request-id', wrongHashId, '--run-id', runId], { cwd: temp, encoding: 'utf8' }).status, 0);
    } finally {
      rmSync(temp, { recursive: true, force: true });
    }
  });
});
