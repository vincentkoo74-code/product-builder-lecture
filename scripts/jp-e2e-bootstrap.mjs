#!/usr/bin/env node
// MARU RPS V1.0_JP — 로컬 E2E 스택 부트스트랩
//
// JP 브라우저 E2E 게이트는 **보안 5종이 적용된** 로컬 스택을 요구한다. 이 스크립트가 그것을
// 재현 가능하게 세운다 — 개인 스크래치패드 절차에 의존하지 않도록.
//
// 만드는 것: 깨끗한 PostgreSQL 클러스터 + 데이터베이스 → 플랫폼 재현(롤/auth shim) →
//            저장소 마이그레이션 전량 적용 → JWT 를 실제로 검증하는 PostgREST.
//
// ⚠️ 프로덕션/Tokyo/Seoul 자격증명을 일절 쓰지 않는다. 서명 비밀과 DB 비밀번호는
//    **실행 시점에 난수로 생성**하고 .jp-e2e/ 아래(gitignore 대상)에만 둔다.
import { execFileSync, spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RUN = path.join(ROOT, '.jp-e2e');
const PG_PORT = Number(process.env.JP_E2E_PG_PORT || 55601);
const REST_PORT = Number(process.env.JP_E2E_REST_PORT || 55702);
const DB = process.env.JP_E2E_DB || 'jp_e2e_sec';

const PGBIN = process.env.JP_E2E_PGBIN || '/opt/homebrew/opt/postgresql@17/bin';
const env = { ...process.env, PATH: `${PGBIN}:${process.env.PATH}` };
const run = (cmd, args, opts = {}) => {
  try { return execFileSync(cmd, args, { env, stdio: 'pipe', encoding: 'utf8', ...opts }); }
  catch (e) {
    const out = [e.stdout, e.stderr].filter(Boolean).map(String).join('\n').trim();
    const err = new Error(`${cmd} 실패${out ? `:\n${out.split('\n').slice(-8).map((l) => '      ' + l).join('\n')}` : ''}`);
    err.cause = e; throw err;
  }
};
const say = (m) => console.log(`  ${m}`);

function which(bin) {
  try { run('sh', ['-c', `command -v ${bin}`]); return true; } catch { return false; }
}

// ── 사전 요구 ────────────────────────────────────────────────────────────────
for (const bin of ['pg_ctl', 'initdb', 'psql', 'postgrest']) {
  if (!which(bin)) {
    console.error(`\n  ${bin} 을 찾을 수 없다.`);
    console.error('  PostgreSQL 17 과 PostgREST 가 필요하다. 예: brew install postgresql@17 postgrest');
    console.error(`  (PostgreSQL 경로가 다르면 JP_E2E_PGBIN 으로 지정)\n`);
    process.exit(1);
  }
}

fs.mkdirSync(RUN, { recursive: true });
const DATA = path.join(RUN, 'pgdata');

// ── 1) 클러스터 ──────────────────────────────────────────────────────────────
if (!fs.existsSync(path.join(DATA, 'PG_VERSION'))) {
  say('PostgreSQL 클러스터 생성');
  run('initdb', ['-D', DATA, '-U', 'postgres', '--auth=trust', '-E', 'UTF8']);
}
try { run('pg_ctl', ['-D', DATA, 'status']); say('PostgreSQL 이미 실행 중'); }
catch {
  say(`PostgreSQL 기동 (:${PG_PORT})`);
  try {
    run('pg_ctl', ['-D', DATA, '-l', path.join(RUN, 'pg.log'), '-o', `-p ${PG_PORT}`, '-w', 'start']);
  } catch (e) {
    console.error(`\n  ${e.message}`);
    console.error(`  포트 ${PG_PORT} 이 이미 쓰이고 있을 수 있다 — JP_E2E_PG_PORT 로 바꾸거나`);
    console.error('  기존 인스턴스를 정지하라. 로그: .jp-e2e/pg.log\n');
    process.exit(1);
  }
}

const admin = (db) => `postgres://postgres@127.0.0.1:${PG_PORT}/${db}`;
const psql = (db, args) => run('psql', [admin(db), '-v', 'ON_ERROR_STOP=1', '-q', ...args]);

// ── 2) 깨끗한 데이터베이스 ───────────────────────────────────────────────────
say(`데이터베이스 재생성: ${DB}`);
psql('postgres', ['-c', `drop database if exists ${DB} with (force);`]);
psql('postgres', ['-c', `create database ${DB};`]);

// ── 3) 플랫폼 재현 + 로컬 전용 비밀 생성 ─────────────────────────────────────
const dbPass = randomBytes(24).toString('base64url');
const jwtSecret = randomBytes(48).toString('base64url');
say('플랫폼 재현 (롤 / auth 스키마 / JWT 클레임 shim / publication)');
psql(DB, ['-f', path.join(ROOT, 'supabase', 'local', 'bootstrap.sql')]);
psql(DB, ['-c', `alter role authenticator with login password '${dbPass}';`]);

// ── 4) 마이그레이션 전량 적용 (보안 5종 포함) ────────────────────────────────
const dir = path.join(ROOT, 'supabase', 'migrations');
const files = fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
say(`마이그레이션 ${files.length}종 순차 적용`);
for (const f of files) {
  try { psql(DB, ['-f', path.join(dir, f)]); }
  catch (e) {
    console.error(`\n  ❌ ${f}\n${(e.stderr || e.stdout || '').toString().split('\n').slice(-6).join('\n')}`);
    process.exit(1);
  }
  say(`  ✅ ${f}`);
}

// ── 5) PostgREST (JWT 를 실제로 검증한다) ────────────────────────────────────
const conf = path.join(RUN, 'postgrest.conf');
fs.writeFileSync(conf,
  `db-uri = "postgres://authenticator:${dbPass}@127.0.0.1:${PG_PORT}/${DB}"\n` +
  `db-schemas = "public"\n` +
  `db-anon-role = "anon"\n` +
  `server-port = ${REST_PORT}\n` +
  `jwt-secret = "${jwtSecret}"\n` +
  `jwt-role-claim-key = ".role"\n`, { mode: 0o600 });

say(`PostgREST 기동 (:${REST_PORT})`);
const log = fs.openSync(path.join(RUN, 'postgrest.log'), 'a');
const child = spawn('postgrest', [conf], { env, detached: true, stdio: ['ignore', log, log] });
child.unref();
fs.writeFileSync(path.join(RUN, 'postgrest.pid'), String(child.pid));

// 준비될 때까지 기다린다 — 임의의 sleep 을 쓰지 않는다.
const restUrl = `http://127.0.0.1:${REST_PORT}`;
let ready = false;
for (let i = 0; i < 60; i++) {
  try {
    const r = await fetch(`${restUrl}/rooms?select=id&limit=1`);
    if (r.status === 200) { ready = true; break; }
  } catch { /* 아직 안 떴다 */ }
  await new Promise((r) => setTimeout(r, 500));
}
if (!ready) {
  console.error('\n  PostgREST 가 준비되지 않았다. .jp-e2e/postgrest.log 를 확인하라.\n');
  process.exit(1);
}

// ── 6) 러너가 읽는 환경 기술 ────────────────────────────────────────────────
fs.writeFileSync(path.join(RUN, 'env.json'), JSON.stringify({
  restUrl, adminUri: admin(DB), jwtSecret, pgPort: PG_PORT, restPort: REST_PORT, db: DB, pgbin: PGBIN,
}, null, 2), { mode: 0o600 });

console.log(`\n  준비 완료. 이제:  npm run test:e2e`);
console.log(`  정리:            npm run jp:e2e:teardown\n`);
