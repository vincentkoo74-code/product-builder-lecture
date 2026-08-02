#!/usr/bin/env node
// ════════════════════════════════════════════════════════════════════════════
// M-A′: 공식 release-gate 실행 경로(strict).
//
// 이 파일이 "릴리즈 판정" 진입점이다. `npm run test:release-gate`(별칭 `gate:release`).
//
// 계약(하나라도 어기면 게이트가 무의미해진다):
//   1. strict가 **기본이자 유일한 모드**다. CEO_GATE_STRICT를 환경에서 읽지 않고
//      여기서 무조건 '1'로 강제한다. 환경변수가 없어도 permissive로 빠지지 않는다.
//      (호출자가 CEO_GATE_STRICT=0을 넣어도 무시하고 덮어쓴 뒤 그 사실을 출력한다.)
//   2. 자식(vitest) 종료코드를 그대로 전파한다. 시그널 종료는 1로 정규화한다.
//   3. 자식이 0으로 끝났더라도 **strict 판정 마커가 출력에 없으면 1로 강등**한다.
//      (테스트 필터/파일 미수집/리포터 사고로 "아무것도 안 돌고 0" 나는 우회를 막는다.)
//   4. 게이트 우회 스위치(--force/--skip/SKIP_* 등)는 존재하지 않는다.
//
// 이름 주의: 기존 scripts/release-gate.mjs는 QA_STATUS 버그카운트 게이트로 별개 관심사다.
// 이름 충돌을 피하려고 이 파일은 run-release-gate.mjs다.
// ════════════════════════════════════════════════════════════════════════════
import { spawn } from 'node:child_process';
import { existsSync as fsExistsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(HERE, '..');

export const GATE_STRICT_ENV = 'CEO_GATE_STRICT';
export const GATE_STRICT_VALUE = '1';
export const MEASUREMENT_TEST_FILE = 'tests/ceo-official-measurement.test.mjs';
// strict 실행이 실제로 게이트 판정까지 도달했다는 증거. 측정 본문이 strict 분기에서만 찍는다.
export const STRICT_VERDICT_MARKER = '[CEO-RELEASE-GATE][STRICT]';

/** strict 강제: 환경 입력과 무관하게 항상 '1'. permissive fallback 경로 없음. */
export function buildGateEnv(baseEnv = process.env) {
  const inherited = baseEnv[GATE_STRICT_ENV];
  return {
    env: { ...baseEnv, [GATE_STRICT_ENV]: GATE_STRICT_VALUE },
    overrode: inherited !== undefined && inherited !== GATE_STRICT_VALUE,
    inherited: inherited === undefined ? null : inherited,
  };
}

/**
 * 순수 함수: 자식 프로세스 결과 → 게이트 종료코드.
 * fail-closed. code=0인데 strict 마커가 없으면 통과시키지 않는다.
 */
export function resolveGateExit({ code, signal, output }) {
  if (signal) {
    return { exitCode: 1, reason: `RUNNER_SIGNAL(${signal}) — 자식 프로세스가 시그널로 종료됐다.` };
  }
  if (code === null || code === undefined) {
    return { exitCode: 1, reason: 'RUNNER_NO_EXIT_CODE — 자식 종료코드를 알 수 없다.' };
  }
  if (code !== 0) {
    return { exitCode: code, reason: `GATE_FAILED — vitest exit ${code} (릴리즈 차단).` };
  }
  if (!String(output || '').includes(STRICT_VERDICT_MARKER)) {
    return {
      exitCode: 1,
      reason: `GATE_NOT_EXECUTED — exit 0이지만 출력에 ${STRICT_VERDICT_MARKER} 마커가 없다. `
        + '측정 게이트가 실제로 실행되지 않았다(파일 미수집/필터/리포터 사고). 통과시키지 않는다.',
    };
  }
  return { exitCode: 0, reason: 'GATE_PASS — strict 판정 도달 + 위반 없음.' };
}

/**
 * vitest 실행 커맨드를 결정한다. 크로스플랫폼 안전을 위해 셸/인라인 env 문법을 쓰지 않고
 * node로 vitest 엔트리(.mjs)를 직접 실행한다(POSIX/Windows 동일 동작).
 */
export function resolveVitestCommand({ root = REPO_ROOT, existsSync } = {}) {
  const entry = path.join(root, 'node_modules', 'vitest', 'vitest.mjs');
  if (!existsSync || existsSync(entry)) return { command: process.execPath, args: [entry] };
  // fallback: 게이트 우회가 아니라 실행 수단의 대체다(strict는 여전히 강제된다).
  return { command: 'npx', args: ['vitest'], needsShellOnWin: true };
}

export function runGate({ root = REPO_ROOT, extraArgs = [] } = {}) {
  const { env, overrode, inherited } = buildGateEnv(process.env);
  const { command, args: baseArgs, needsShellOnWin } = resolveVitestCommand({ root, existsSync: fsExistsSync });
  const args = [...baseArgs, 'run', MEASUREMENT_TEST_FILE, ...extraArgs];

  // eslint-disable-next-line no-console
  console.log('════════════════════════════════════════════════════════════════════');
  // eslint-disable-next-line no-console
  console.log('[CEO-RELEASE-GATE][RUNNER] strict 모드 강제 실행 (릴리즈 판정)');
  // eslint-disable-next-line no-console
  console.log(`  ${GATE_STRICT_ENV}=${GATE_STRICT_VALUE} (강제 — 환경변수로 완화 불가)`);
  if (overrode) {
    // eslint-disable-next-line no-console
    console.log(`  ⚠ 호출 환경의 ${GATE_STRICT_ENV}=${JSON.stringify(inherited)}를 무시하고 덮어썼다.`);
  }
  // eslint-disable-next-line no-console
  console.log(`  ${command} ${args.join(' ')}`);
  // eslint-disable-next-line no-console
  console.log('════════════════════════════════════════════════════════════════════');

  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: root,
      env,
      shell: !!needsShellOnWin && process.platform === 'win32',
      stdio: ['inherit', 'pipe', 'pipe'],
    });
    let output = '';
    child.stdout.on('data', (d) => { output += d; process.stdout.write(d); });
    child.stderr.on('data', (d) => { output += d; process.stderr.write(d); });
    child.on('error', (err) => {
      resolve({ code: 1, signal: null, output: `${output}\n[RUNNER-SPAWN-ERROR] ${err && err.message}` });
    });
    child.on('close', (code, signal) => resolve({ code, signal, output }));
  });
}

const isDirectRun = (() => {
  if (!process.argv[1]) return false;
  try { return path.resolve(process.argv[1]) === fileURLToPath(import.meta.url); } catch { return false; }
})();

if (isDirectRun) {
  const result = await runGate({ extraArgs: process.argv.slice(2) });
  const verdict = resolveGateExit(result);
  // eslint-disable-next-line no-console
  console.log('════════════════════════════════════════════════════════════════════');
  // eslint-disable-next-line no-console
  console.log(`[CEO-RELEASE-GATE][RUNNER] exitCode=${verdict.exitCode} ${verdict.reason}`);
  // eslint-disable-next-line no-console
  console.log('════════════════════════════════════════════════════════════════════');
  process.exit(verdict.exitCode);
}
