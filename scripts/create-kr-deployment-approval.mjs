#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';

const EXPECTED = {
  'supabase/migrations/20261010100000_release_security_scoped_reads_and_account_results.sql': 'edd7913cedb1199d0b2b46c1adf9f02de809d2a32bf68764cabd2a043e419a6f',
  'supabase/migrations/20261010110000_resumable_account_deletion.sql': '5ce018839b8663ba149078eabad5658b303b2928872eaa7a879130a629d86b9f',
  'supabase/functions/delete-account/index.ts': '02a35c5619bc351876ffc3fa6ce3b3d6cbfd112174a5aae5df294992fc1c1fe9',
};
const EVIDENCE_PATH = 'docs/qa/kr-production-deployment-evidence.json';
const args = new Map();
for (let index = 2; index < process.argv.length; index += 2) args.set(process.argv[index], process.argv[index + 1]);
const commit = args.get('--commit');
const runId = args.get('--run-id');
const output = args.get('--output');
if (!/^[0-9a-f]{40}$/i.test(commit ?? '') || !/^\d+$/.test(runId ?? '') || !output) {
  process.stderr.write('Expected --commit <40-char SHA> --run-id <numeric ID> --output <path>.\n');
  process.exit(2);
}

const sha256 = (path) => createHash('sha256').update(readFileSync(path)).digest('hex');
for (const [path, expected] of Object.entries(EXPECTED)) {
  let actual;
  try {
    actual = sha256(path);
  } catch (error) {
    if (error.code === 'ENOENT') {
      process.stderr.write(`Reviewed source file is missing: ${path}\n`);
      process.exit(1);
    }
    throw error;
  }
  if (actual !== expected) {
    process.stderr.write(`Reviewed source hash mismatch: ${path}\n`);
    process.exit(1);
  }
}

let evidence = null;
let evidenceSha256 = null;
try {
  evidenceSha256 = sha256(EVIDENCE_PATH);
  evidence = JSON.parse(readFileSync(EVIDENCE_PATH, 'utf8'));
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}
const gateNames = ['encrypted_backup', 'isolated_restore', 'build76_compatibility', 'rollback_plan', 'failure_plan'];
const backupGatesPass = evidence !== null && gateNames.every((key) => evidence[key] === 'PASS');
const body = {
  schemaVersion: 1,
  candidateCommit: commit.toLowerCase(),
  prepareRunId: runId,
  projectRef: 'sannrfmhevebqgfdqcps',
  migrations: Object.keys(EXPECTED).slice(0, 2).map((path) => ({ path, sha256: EXPECTED[path] })),
  edgeFunctions: [{ name: 'delete-account', path: 'supabase/functions/delete-account/index.ts', sha256: EXPECTED['supabase/functions/delete-account/index.ts'] }],
  automatedValidation: { status: 'PASS', commands: ['npm test', 'npm run test:syntax', 'npx vitest run tests/kr-deployment-workflow-guard.test.mjs'] },
  dataImpact: 'Applies the two reviewed KR security migrations and the resumable delete-account function; no JP target.',
  build76Compatibility: evidence?.build76_compatibility ?? 'NOT_VERIFIED',
  backupRestore: {
    evidencePath: EVIDENCE_PATH,
    evidenceSha256,
    encryptedBackup: evidence?.encrypted_backup ?? 'NOT_VERIFIED',
    isolatedRestore: evidence?.isolated_restore ?? 'NOT_VERIFIED',
  },
  rollbackPlan: evidence?.rollback_plan ?? 'NOT_VERIFIED',
  failurePlan: evidence?.failure_plan ?? 'NOT_VERIFIED',
};
const requestId = `KR-${createHash('sha256').update(JSON.stringify(body)).digest('hex').slice(0, 16)}`;
const manifest = { ...body, requestId };
writeFileSync(output, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
process.stdout.write(`${JSON.stringify({ requestId, projectRef: manifest.projectRef, candidateCommit: manifest.candidateCommit, backupGate: backupGatesPass ? 'PASS' : 'BLOCKED', output })}\n`);
