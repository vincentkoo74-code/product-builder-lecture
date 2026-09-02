#!/usr/bin/env node
// MARU RPS — rc3 권위 측정 러너 (JP-H1A-STRICT-CALIBRATION)
//
// rc3 는 실시간 타이밍(카운트다운 동기·전파 지연·on-time 동시성)을 재므로 CPU 경합에
// 직접 반응한다. 이 머신에서는 여러 워크트리(JP/KR)와 사용자가 투입한 CLI 가 동시에
// 같은 스위트를 돌릴 수 있고, 실제로 겹쳐서 측정이 오염된 전례가 있다:
//   오염(3개 동시): 11 실패 / 52 통과 / 3591.95s / 타임아웃 7
//   단독(유효):     10 실패 / 53 통과 / 2408.85s / 타임아웃 0
//
// 그래서 측정은 **fail-closed** 로 직렬화한다.
//   - 다른 rc3 프로세스가 있으면 시작하지 않는다(죽이지 않는다 — 사용자/피어 소유일 수 있다)
//   - 머신 전역 락을 잡는다(워크트리가 달라도 감지되도록 /tmp 에 둔다)
//   - 죽은 락은 안전하게 회수한다(PID 생존 확인)
//   - 정상 종료·시그널 모두에서 락을 푼다
//
// 이 스크립트는 rc3 테스트 로직을 일절 바꾸지 않는다. 실행을 감쌀 뿐이다.
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SPEC = 'tests/rc3-multiparticipant-sim.test.mjs';
const PATTERN = 'rc3-multiparticipant-sim';
// 머신 전역 위치 — 워크트리가 달라도 같은 락을 본다.
const LOCK = process.env.RC3_LOCK_PATH || path.join(os.tmpdir(), 'maru-rc3-measure.lock');

const say = (m) => console.log(`  ${m}`);
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } };

// ── 1) 프로세스 기반 경합 탐지 (가장 신뢰도 높다) ────────────────────────────
function competingPids() {
  let out = '';
  try { out = execFileSync('pgrep', ['-f', PATTERN], { encoding: 'utf8' }); }
  catch (e) { out = ''; }                     // 일치 없음 → pgrep exit 1
  return out.split('\n').map((s) => s.trim()).filter(Boolean)
    .map(Number).filter((p) => p && p !== process.pid);
}
function describe(pid) {
  try {
    return execFileSync('ps', ['-o', 'command=', '-p', String(pid)], { encoding: 'utf8' }).trim().slice(0, 120);
  } catch (e) { return '(조회 불가)'; }
}

// ── 2) 락 (부차 방어 — 프로세스 탐지가 놓치는 창을 좁힌다) ───────────────────
function readLock() {
  try { return JSON.parse(fs.readFileSync(LOCK, 'utf8')); } catch (e) { return null; }
}
function acquireLock() {
  const held = readLock();
  if (held && held.pid && alive(held.pid)) return held;      // 살아 있는 소유자
  if (held) { say(`죽은 락 회수 (pid ${held.pid})`); try { fs.rmSync(LOCK); } catch (e) {} }
  // 비밀은 담지 않는다 — pid / 시각 / 워크트리 경로만.
  const payload = { pid: process.pid, startedAt: new Date().toISOString(), worktree: ROOT, host: os.hostname() };
  try {
    fs.writeFileSync(LOCK, JSON.stringify(payload, null, 2), { flag: 'wx', mode: 0o644 });
    return null;
  } catch (e) {
    if (e.code === 'EEXIST') return readLock() || { pid: 0 };  // 경합에서 졌다
    throw e;
  }
}
function releaseLock() {
  const held = readLock();
  if (held && held.pid === process.pid) { try { fs.rmSync(LOCK); } catch (e) {} }
}

// ── 3) 시작 전 fail-closed 확인 ──────────────────────────────────────────────
const competing = competingPids();
if (competing.length) {
  console.error(`\n  ❌ rc3 측정을 시작하지 않는다 — 이미 실행 중인 rc3 프로세스가 있다.\n`);
  for (const p of competing) console.error(`     pid ${p}: ${describe(p)}`);
  console.error(`\n  이 프로세스들은 다른 워크트리나 사용자가 띄운 것일 수 있어 **자동으로 죽이지 않는다**.`);
  console.error(`  끝날 때까지 기다렸다가 다시 실행하라. 겹친 측정은 무효(MACHINE CONTENTION)다.\n`);
  process.exit(2);
}
const blocked = acquireLock();
if (blocked) {
  console.error(`\n  ❌ 다른 측정이 락을 쥐고 있다 — pid ${blocked.pid}, 시작 ${blocked.startedAt || '?'}`);
  console.error(`     워크트리: ${blocked.worktree || '?'}`);
  console.error(`  ${LOCK}\n`);
  process.exit(2);
}
say(`측정 락 획득 (pid ${process.pid})`);
say(`락 파일: ${LOCK}`);

// ── 4) 실행 ─────────────────────────────────────────────────────────────────
const startedAt = new Date();
say(`시작: ${startedAt.toISOString()}`);
try {
  say(`머신 부하(before): ${os.loadavg().map((n) => n.toFixed(2)).join(' ')}`);
} catch (e) {}

const extra = process.argv.slice(2);
const child = spawn('npx', ['vitest', 'run', SPEC, ...extra],
  { cwd: ROOT, stdio: 'inherit', env: process.env });

let released = false;
const cleanup = () => { if (!released) { released = true; releaseLock(); } };
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  process.on(sig, () => { cleanup(); try { child.kill(sig); } catch (e) {} process.exit(130); });
}
process.on('exit', cleanup);

child.on('exit', (code, signal) => {
  const endedAt = new Date();
  const dur = ((endedAt - startedAt) / 1000).toFixed(2);
  cleanup();
  console.log(`\n  ── 측정 종료 ──`);
  console.log(`  종료: ${endedAt.toISOString()}  소요: ${dur}s  exit=${code}${signal ? ` signal=${signal}` : ''}`);
  try { console.log(`  머신 부하(after): ${os.loadavg().map((n) => n.toFixed(2)).join(' ')}`); } catch (e) {}
  // 실행 도중 다른 rc3 가 끼어들었는지 사후 확인 — 끼어들었다면 이 측정은 무효다.
  const late = competingPids();
  if (late.length) {
    console.log(`\n  ⚠️ INVALID — MACHINE CONTENTION: 실행 중 다른 rc3 프로세스가 관측됐다 (${late.join(', ')}).`);
    console.log(`     이 측정치는 채택하지 말고, 경합이 사라진 뒤 재측정하라.`);
  } else {
    console.log(`  경합 없음 — 단독 측정으로 유효하다.`);
  }
  process.exit(code === null ? 1 : code);
});
