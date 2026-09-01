#!/usr/bin/env node
// MARU RPS V1.0_JP — 로컬 E2E 스택 정리. 생성한 것만 지운다.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RUN = path.join(ROOT, '.jp-e2e');
if (!fs.existsSync(RUN)) { console.log('  정리할 것이 없다.'); process.exit(0); }

const cfg = fs.existsSync(path.join(RUN, 'env.json'))
  ? JSON.parse(fs.readFileSync(path.join(RUN, 'env.json'), 'utf8')) : {};
const env = { ...process.env, PATH: `${cfg.pgbin || '/opt/homebrew/opt/postgresql@17/bin'}:${process.env.PATH}` };

const pidFile = path.join(RUN, 'postgrest.pid');
if (fs.existsSync(pidFile)) {
  const pid = Number(fs.readFileSync(pidFile, 'utf8').trim());
  try { process.kill(pid); console.log('  PostgREST 정지'); } catch { /* 이미 죽었다 */ }
}
try {
  execFileSync('pg_ctl', ['-D', path.join(RUN, 'pgdata'), '-m', 'fast', '-w', 'stop'], { env, stdio: 'pipe' });
  console.log('  PostgreSQL 정지');
} catch { /* 이미 정지 */ }

// 서명 비밀·DB 비밀번호가 담긴 파일을 먼저 확실히 지운다.
for (const f of ['env.json', 'postgrest.conf', 'postgrest.pid']) {
  const p = path.join(RUN, f);
  if (fs.existsSync(p)) fs.rmSync(p);
}
console.log('  로컬 전용 비밀 파일 삭제');

if (process.argv.includes('--purge')) {
  fs.rmSync(RUN, { recursive: true, force: true });
  console.log('  .jp-e2e/ 전체 삭제 (--purge)');
} else {
  console.log('  데이터 디렉터리는 남겼다 (전부 지우려면: npm run jp:e2e:teardown -- --purge)');
}
