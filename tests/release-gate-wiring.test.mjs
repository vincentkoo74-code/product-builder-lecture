// ════════════════════════════════════════════════════════════════════════════
// §M-A′: 릴리즈 게이트 **실물 배선** 검증.
//
// 왜 별도 파일인가(중요 — 되돌리지 말 것):
//   이 파일의 테스트들은 저장소 산출물(package.json의 게이트 스크립트,
//   .github/workflows/release-gate.yml, scripts/run-release-gate.mjs)을 **파일로 읽어서**
//   검사한다. 즉 "CI 배선" 커밋의 산출물을 검증하는 테스트다.
//   이들이 tests/ceo-official-measurement.test.mjs(= 측정 베이스라인 커밋) 안에 있으면
//   그 커밋 시점의 격리 트리에서 ENOENT/AssertionError로 RED가 되고, 결과적으로
//   `git bisect`와 per-commit CI가 그 구간에서 무력화된다(forward reference).
//   그래서 검증 대상과 같은 커밋에 들어가도록 여기로 분리했다. 테스트 내용은
//   ceo-official-measurement.test.mjs에서 **그대로 옮긴 것**이며 단언을 약화시키지 않았다.
//
// 왜 `await import()`(동적)인가:
//   필요한 순수 헬퍼(GATE_EXECUTION_PLAN / analyzeGateWiring / isGateStrictMode)는
//   ceo-official-measurement.test.mjs가 export한다. 그러나 **테스트 파일을 top-level에서
//   static import 하면 vitest가 그 파일의 describe/it을 이 파일 안에 다시 등록**해
//   62초짜리 측정 스위트가 통째로 중복 실행된다(vitest 2.1.9에서 실측 확인).
//   테스트 본문 안에서 동적 import 하면 수집(collection)이 이미 끝난 뒤라 스위트가
//   중복 등록되지 않는다. 로직 복제(드리프트 위험)를 피하면서 중복 실행도 피하는 경로다.
// ════════════════════════════════════════════════════════════════════════════
import { describe, it, expect } from 'vitest';

// 측정 파일이 export하는 순수 계약 헬퍼. (테스트 본문에서만 호출할 것 — 위 주석 참조.)
const loadGateContract = () => import('./ceo-official-measurement.test.mjs');

describe('§M-A′(critic): release-gate 실물 배선(package.json / CI 워크플로 / 러너 소스)', () => {
  it('[GX-7] 저장소 실제 배선 상태를 코드가 읽어서 확인한다(가짜 게이트 스크립트 차단)', async () => {
    const { analyzeGateWiring, GATE_EXECUTION_PLAN } = await loadGateContract();
    const { readFileSync, existsSync, readdirSync } = await import('node:fs');
    const root = new URL('../', import.meta.url);
    const pkg = JSON.parse(readFileSync(new URL('package.json', root), 'utf8'));
    const wfDir = new URL('.github/workflows/', root);
    const workflowTexts = {};
    if (existsSync(wfDir)) {
      for (const f of readdirSync(wfDir)) workflowTexts[f] = readFileSync(new URL(f, wfDir), 'utf8');
    }
    const wiring = analyzeGateWiring({ pkgScripts: pkg.scripts || {}, workflowTexts });
    // eslint-disable-next-line no-console
    console.log('[CEO-GATE-WIRING]', JSON.stringify({ ...wiring, npmTest: (pkg.scripts || {}).test }, null, 2));
    // 불변식: 게이트 이름을 가진 스크립트가 존재한다면 그것은 반드시 strict를 켜야 한다(이름만 게이트 금지).
    expect(wiring.violations).toEqual([]);
    // §M-A′: 설계안이 아니라 **실제 배선**을 요구한다. 스크립트가 빠지면 여기서 RED.
    for (const [name, cmd] of Object.entries(GATE_EXECUTION_PLAN.requiredScripts)) {
      expect((pkg.scripts || {})[name]).toBe(cmd);
      expect(wiring.gateScripts).toContain(name);
      expect(wiring.strictScripts).toContain(name);
    }
    expect(wiring.strictWiredAnywhere).toBe(true);
    // 문서 필드가 실제 저장소 상태와 어긋나면 보고가 거짓이 된다 — 실물과 대조한다.
    expect(GATE_EXECUTION_PLAN.currentRepoFacts.npmTestScript).toBe((pkg.scripts || {}).test);
    expect(GATE_EXECUTION_PLAN.currentRepoFacts.ceoGateStrictSetAnywhere).toBe(wiring.strictWiredAnywhere);
    expect(Object.keys(workflowTexts).sort()).toEqual([...GATE_EXECUTION_PLAN.currentRepoFacts.existingWorkflows].sort());
  });

  it('[GX-9] CI 워크플로가 게이트를 실제로 호출한다(npm ci → npm test → test:syntax → test:release-gate)', async () => {
    const { analyzeGateWiring, GATE_EXECUTION_PLAN } = await loadGateContract();
    const { readFileSync } = await import('node:fs');
    const root = new URL('../', import.meta.url);
    const wfPath = new URL(`.github/workflows/${GATE_EXECUTION_PLAN.ciContract.workflow}`, root);
    const text = readFileSync(wfPath, 'utf8');
    // 4개 스텝이 전부, 그리고 이 순서대로 있어야 한다.
    let cursor = -1;
    for (const step of GATE_EXECUTION_PLAN.ciContract.steps) {
      const at = text.indexOf(step, cursor + 1);
      expect(at, `워크플로에 "${step}" 스텝이 순서대로 없다`).toBeGreaterThan(cursor);
      cursor = at;
    }
    // 트리거 3종.
    expect(text).toMatch(/^\s*pull_request:/m);
    expect(text).toMatch(/^\s*workflow_dispatch:/m);
    expect(text).toMatch(/tags:/);
    // 게이트 스텝을 무력화하는 흔한 우회 패턴이 없어야 한다(주석은 제외하고 실행 라인만 본다).
    const effective = text.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');
    expect(effective).not.toMatch(/continue-on-error/);
    expect(effective).not.toMatch(/\|\|\s*true/);
    expect(effective).not.toMatch(/if:\s*false/);
    const wiring = analyzeGateWiring({
      pkgScripts: JSON.parse(readFileSync(new URL('package.json', root), 'utf8')).scripts || {},
      workflowTexts: { [GATE_EXECUTION_PLAN.ciContract.workflow]: text },
    });
    expect(wiring.workflowsRunningTest).toContain(GATE_EXECUTION_PLAN.ciContract.workflow);
    expect(wiring.workflowsRunningGateScript).toContain(GATE_EXECUTION_PLAN.ciContract.workflow);
    expect(GATE_EXECUTION_PLAN.currentRepoFacts.ciWorkflowsRunningNpmTest).toEqual([GATE_EXECUTION_PLAN.ciContract.workflow]);
  });

  it('[GX-10] 러너가 strict를 스스로 강제한다(환경변수 부재/0에도 permissive로 빠지지 않음)', async () => {
    const { isGateStrictMode } = await loadGateContract();
    const { buildGateEnv, resolveGateExit, GATE_STRICT_ENV, GATE_STRICT_VALUE, STRICT_VERDICT_MARKER } =
      await import('../scripts/run-release-gate.mjs');
    // (a) 환경변수가 아예 없어도 strict.
    expect(buildGateEnv({}).env[GATE_STRICT_ENV]).toBe(GATE_STRICT_VALUE);
    expect(buildGateEnv({}).overrode).toBe(false);
    // (b) 명시적으로 꺼도 무시하고 덮어쓴다 — 우회 불가.
    const off = buildGateEnv({ [GATE_STRICT_ENV]: '0' });
    expect(off.env[GATE_STRICT_ENV]).toBe('1');
    expect(off.overrode).toBe(true);
    expect(isGateStrictMode(off.env)).toBe(true);
    expect(isGateStrictMode({ [GATE_STRICT_ENV]: '0' })).toBe(false); // 대조군
    // (c) exit code 전파 + fail-closed.
    const ok = `x ${STRICT_VERDICT_MARKER} exitCode(예정)=0 violations=0`;
    expect(resolveGateExit({ code: 0, signal: null, output: ok }).exitCode).toBe(0);
    expect(resolveGateExit({ code: 1, signal: null, output: ok }).exitCode).toBe(1);
    expect(resolveGateExit({ code: 2, signal: null, output: ok }).exitCode).toBe(2);
    expect(resolveGateExit({ code: null, signal: 'SIGKILL', output: ok }).exitCode).toBe(1);
    // exit 0인데 판정 마커가 없으면 "게이트가 안 돌았다"로 보고 통과시키지 않는다.
    const noMarker = resolveGateExit({ code: 0, signal: null, output: 'No test files found' });
    expect(noMarker.exitCode).toBe(1);
    expect(noMarker.reason).toContain('GATE_NOT_EXECUTED');
  });

  it('[GX-11] 러너 소스에 게이트 우회 경로가 없다', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(new URL('../scripts/run-release-gate.mjs', import.meta.url), 'utf8');
    // 주석을 제거한 "실행되는 소스"만 검사한다(주석에서 우회 스위치를 언급하는 것은 허용).
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
    // strict 값을 환경에서 읽어 그대로 쓰는 경로가 없어야 한다.
    expect(code).toContain('[GATE_STRICT_ENV]: GATE_STRICT_VALUE');
    expect(code).not.toMatch(/SKIP_GATE|FORCE_PASS|allowFailure|--force|--no-gate/i);
    // strict 판정을 "환경변수가 1일 때만" 켜는 조건부가 없어야 한다(permissive fallback 금지).
    expect(code).not.toMatch(/if\s*\([^)]*GATE_STRICT_ENV[^)]*\)\s*\{[\s\S]{0,80}return/);
    // 러너가 참조하는 측정 파일이 실재해야 한다.
    const { MEASUREMENT_TEST_FILE } = await import('../scripts/run-release-gate.mjs');
    expect(MEASUREMENT_TEST_FILE).toBe('tests/ceo-official-measurement.test.mjs');
    expect(readFileSync(new URL(`../${MEASUREMENT_TEST_FILE}`, import.meta.url), 'utf8').length).toBeGreaterThan(0);
  });
});
