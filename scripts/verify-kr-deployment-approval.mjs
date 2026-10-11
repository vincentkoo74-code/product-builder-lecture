#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

const EXPECTED = {
  'supabase/migrations/20261010100000_release_security_scoped_reads_and_account_results.sql': 'edd7913cedb1199d0b2b46c1adf9f02de809d2a32bf68764cabd2a043e419a6f',
  'supabase/migrations/20261010110000_resumable_account_deletion.sql': '5ce018839b8663ba149078eabad5658b303b2928872eaa7a879130a629d86b9f',
  'supabase/functions/delete-account/index.ts': '02a35c5619bc351876ffc3fa6ce3b3d6cbfd112174a5aae5df294992fc1c1fe9',
};
const args = new Map();
for (let index = 3; index < process.argv.length; index += 2) args.set(process.argv[index], process.argv[index + 1]);
const [manifestPath] = process.argv.slice(2, 3);
const expectedCommit = args.get('--commit');
const expectedRequestId = args.get('--request-id');
const expectedRunId = args.get('--run-id');
const fail = (message) => { process.stderr.write(`${message}\n`); process.exit(1); };
if (!manifestPath || !/^[0-9a-f]{40}$/i.test(expectedCommit ?? '') || !/^KR-[0-9a-f]{16}$/.test(expectedRequestId ?? '') || !/^\d+$/.test(expectedRunId ?? '')) {
  process.stderr.write('Invalid verification arguments.\n');
  process.exit(2);
}
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
const { requestId, ...body } = manifest;
const calculatedRequestId = `KR-${createHash('sha256').update(JSON.stringify(body)).digest('hex').slice(0, 16)}`;
if (requestId !== calculatedRequestId || requestId !== expectedRequestId) fail('Approval request ID mismatch; request is stale or modified.');
if (manifest.schemaVersion !== 1 || manifest.projectRef !== 'sannrfmhevebqgfdqcps') fail('Only the KR project and supported request schema are allowed.');
if (manifest.candidateCommit !== expectedCommit.toLowerCase() || manifest.prepareRunId !== expectedRunId) fail('Candidate commit or Prepare run mismatch.');
if (manifest.automatedValidation?.status !== 'PASS') fail('Automated validation evidence is not PASS.');
if (manifest.migrations?.length !== 2 || manifest.edgeFunctions?.length !== 1) fail('Deployment bundle differs from the reviewed scope.');
for (const [path, expected] of Object.entries(EXPECTED)) {
  const item = manifest.migrations.find((entry) => entry.path === path) ?? manifest.edgeFunctions.find((entry) => entry.path === path);
  if (!item || item.sha256 !== expected || createHash('sha256').update(readFileSync(path)).digest('hex') !== expected) fail(`Reviewed artifact mismatch: ${path}`);
}
if (manifest.edgeFunctions[0].name !== 'delete-account') fail('Unapproved Edge Function in deployment request.');
if (manifest.backupRestore?.encryptedBackup !== 'PASS' || manifest.backupRestore?.isolatedRestore !== 'PASS' || manifest.build76Compatibility !== 'PASS' || manifest.rollbackPlan !== 'PASS' || manifest.failurePlan !== 'PASS') {
  fail('Backup, isolated restore, Build76 compatibility, failure response, or rollback evidence is incomplete.');
}
process.stdout.write('Immutable approval request verified; all deployment gates PASS.\n');
