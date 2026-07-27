import { readFileSync } from 'node:fs';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  judgePure, resolveElimination, computePlayerStatuses, PLAYER_STATUS, maxLoserCountFor,
} from '../src/game-logic.mjs';
import {
  EXTRACTED_SOURCE_BLOCKS, EXTRACTED_COMBINED_SOURCE,
  createTrialWorld, runMeasuredTrial, PHASE_TOLERANCE_MS, DEFAULT_TARGET_ROUNDS,
  getPhaseSyncRenderEvent, createDevice, createRoomStore, mulberry32,
  HARD_FAILURE_TYPES, LATE_RENDER_THRESHOLD_MS, REALTIME_DELAY_REGIMES,
} from './rc3-harness-support.mjs';

// ════════════════════════════════════════════════════════════════════════════
// STOP-SHIP 미션: 3~20명 멀티참가자 동시 렌더 시뮬레이션 하니스 — 측정 전용(index.html 무수정).
//
// 이 파일은 "1단계 phase 상태기계 맵" 보고 산출물이 아니라 그 맵을 근거로 만든 실행 가능한
// 하니스/측정이다. 전체 서사(추출 경계, tolerance 근거, 실패모드 해석, 확신 낮은 부분)는
// orchestrator에게 보낸 최종 보고 본문에 있다 — 이 파일 상단 주석은 "이 테스트가 무엇을
// 검증하는가"만 요약한다.
//
// 실추출(REAL, index.html에서 new Function으로 그대로 구동) vs 하니스 대체(SUBSTITUTED, 정직 공개)
// 경계는 tests/rc3-harness-support.mjs 상단 주석에 상세 기록. 요약:
//   REAL: serverNow/syncServerClock, parsePenalty/buildPenaltyValue, getCountdownStartAt/
//   getChoiceEndAt/getNextCountdownStartAt/getNextPhaseScheduledAt, waitForPhaseRender(★),
//   runCountdown/runCountdownThenShowGame/beginRoundTimer, captureAndPublishChoiceWindowNow/
//   publishChoiceWindowEnd, computeChoiceRemainingSeconds, enterPlayingStateFromRoomUpdate,
//   handleRoomUpdate(★ stale-row guard), startGame, updateParticipantChoice,
//   publishHostRoundResult/judgeRound(judgePure 주입), nextRound류, showScreen/hideAllScreens.
//   SUBSTITUTED: finishRoundLocal(460줄, DOM/음성/통계/idempotency 캐시)은 여전히 추출하지 않지만,
//   RC-3 Phase1(codex-critic HIGH 충실성 수정) 이후 hasStoredResults 판정 + 미충족 시
//   judgeRound(raw) 폴백(index.html ~8036-8043)은 REAL 텍스트 그대로(new Function) 실행한다 —
//   더 이상 "항상 인코딩값을 신뢰"하지 않는다. 그 결과(win/lose/draw)는 src/game-logic.mjs의
//   resolveElimination()(REAL, 별도 검증된 단일 소스)에 위임. ready 화면의 "마지막 준비 참가자
//   클릭" 체인 → host의 REAL startGame() 직접 호출로 대체.

describe('RC-3 §5 충실성 증명(fidelity)', () => {
  it('마커가 index.html 실제 텍스트와 정확히 일치하고, 추출된 소스가 비어있지 않다', () => {
    for (const [name, src] of Object.entries(EXTRACTED_SOURCE_BLOCKS)) {
      expect(src.length, `block ${name} should be non-empty`).toBeGreaterThan(10);
    }
    // 결합 소스가 실제로 핵심 함수 시그니처들을 포함하는지(오타로 빈 블록이 되지 않았는지) 확인.
    for (const sig of [
      'function serverNow()', 'async function syncServerClock(', 'function parsePenalty(',
      'function buildPenaltyValue(', 'async function waitForPhaseRender(',
      'async function handleRoomUpdate(', 'async function runCountdown(',
      'async function runCountdownThenShowGame(', 'function beginRoundTimer(',
      'function computeChoiceRemainingSeconds(', 'async function startGame(',
      'async function nextRound(', 'function judgeRound(', 'async function publishHostRoundResult(',
    ]) {
      expect(EXTRACTED_COMBINED_SOURCE.includes(sig), `combined source should contain: ${sig}`).toBe(true);
    }
  });

  // RC-3 Phase1(codex-critic HIGH 충실성 수정) parity 증명: finishRoundLocal의 판정-소스 분기
  // (hasStoredResults 판정 + 미충족 시 judgeRound(raw) 폴백)를 하니스가 손으로 재작성하지 않고
  // index.html에서 그대로 슬라이싱했다는 것을 원문 대조로 재확인한다. 마커 자체의 존재는 이미
  // rc3-harness-support.mjs 로드 시점에 검증되지만(마커 누락 시 throw), 여기서는 그 슬라이스의
  // "내용"이 실제로 REAL 판정 분기라는 것(오타로 엉뚱한 블록이 잘리지 않았는지)까지 재확인한다.
  it('finishRoundLocal의 hasStoredResults 판정+폴백 블록이 index.html 원문과 정확히 일치한다(폴백 parity 증명)', () => {
    const block = EXTRACTED_SOURCE_BLOCKS.finishRoundLocalHasStoredResultsCheck;
    expect(block, 'hasStoredResults check block must be extracted').toBeTruthy();
    for (const fragment of [
      'const hasAnyMarkers = (state.participants || []).some(p => isNonPlayingChoice(p.choice));',
      'syncConfirmedIdsFromParticipants(state.participants || []);',
      'const activeForStoredResult = (state.participants || []).filter(p =>',
      '!(state.confirmedSafeIds || []).includes(p.id) &&',
      '!(state.confirmedLoserIds || []).includes(p.id) &&',
      'const hasStoredResults = activeForStoredResult.length > 0 &&',
      'activeForStoredResult.every(p => hasConfirmedRoundResult(p.choice));',
    ]) {
      expect(block.includes(fragment), `hasStoredResults block should contain: ${fragment}`).toBe(true);
    }
    // 원문 재확인: 지금 이 순간의 index.html에서 동일한 마커 구간을 직접 다시 슬라이싱해도
    // 정확히 같은 텍스트가 나와야 한다(하니스 내부 상수로 굳어 있는 게 아니라 매 로드마다
    // readFileSync로 다시 읽는다는 것을 이 테스트 스코프에서도 재확인).
    const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
    const startMarker = '\t      // 재연결/경쟁 조건으로 로컬 배열이 비어있을 경우 DB 마커에서 복원';
    const endMarker = '\t      // Build22-C: TAGGER_SNAPSHOT_GAVE_UP 이후 실제로 어느 데이터 소스로 판정했는지 QA에서';
    const start = html.indexOf(startMarker);
    const end = html.indexOf(endMarker, start + startMarker.length);
    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);
    expect(html.slice(start, end)).toBe(block);
  });

  let restoreRandom;
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(1_800_000_000_000));
  });
  afterEach(() => {
    vi.useRealTimers();
    if (restoreRandom) { restoreRandom(); restoreRandom = null; }
  });

  it('syncServerClock()으로 얻은 offsetMs가 RC-1 이론식(offset = uplink-skew-rtt/2 근사)과 부합한다(추출 코드가 진짜로 그 계산을 수행함을 재확인)', async () => {
    const world = createTrialWorld({
      participantCount: 3, seed: 555, targetLoserCount: 1,
      resolveElimination, judgePure, computePlayerStatuses, PLAYER_STATUS, maxLoserCountFor,
    });
    for (const d of world.devices) {
      // eslint-disable-next-line no-await-in-loop
      const p = d.impl.syncServerClock();
      // eslint-disable-next-line no-await-in-loop
      await vi.advanceTimersByTimeAsync(5000);
      // eslint-disable-next-line no-await-in-loop
      await p;
      expect(d.impl.getServerClockSynced()).toBe(true);
      // offsetMs를 적용한 serverNow()는 항상 "참 시각"에 근접해야 한다(±수백ms, RC-1 잔차범위).
      const trueNow = Date.now(); // 가짜타이머의 실제(스큐없는) 전역 시각
      const deviceServerNow = d.impl.serverNow();
      expect(Math.abs(deviceServerNow - trueNow)).toBeLessThan(1500);
    }
  });

  it('choiceStart는 항상 countdownStart와 동일한 기기간 최대격차를 갖는다(설계상 성질: choiceStart = countdownStart + 로케일 고정 애니메이션 상수 — RC-1 skew simulator가 이미 증명한 것과 동일한 원리를 실제 handleRoomUpdate/runCountdown 파이프라인 전체로 재확인)', async () => {
    const realRandom = Math.random;
    Math.random = () => 0;
    restoreRandom = () => { Math.random = realRandom; };
    const r = await runMeasuredTrial({
      participantCount: 6, seed: 9001, targetRounds: 2,
      resolveElimination, judgePure, computePlayerStatuses, PLAYER_STATUS, maxLoserCountFor, vi,
    });
    expect(r.completed).toBe(true);
    for (const round of [1, 2]) {
      const cd = r.perRoundMaxDiff[round].countdownStart;
      const cs = r.perRoundMaxDiff[round].choiceStart;
      if (cd != null && cs != null) expect(Math.abs(cd - cs)).toBeLessThanOrEqual(2); // ms 반올림 오차만 허용
    }
  }, 15000);
});

// ════════════════════════════════════════════════════════════════════════════
// RC-3 §1 finishRoundLocal 폴백 충실성(단위) — codex-critic HIGH 지적 수정 검증.
// N=16 seed 1600151 통계적 재측정(§1 보고)과 별개로, 결정론적 최소 재현으로 "왜" 고쳐졌는지를
// 빠르게(비-통계적으로) 증명한다: (a) choice가 raw(미인코딩)면 REAL judgeRound(raw) 폴백을 타
// 실제 base 선택으로 정확히 재판정하고, (b) choice가 이미 인코딩돼 있으면 그 값을 그대로 신뢰한다.
// ════════════════════════════════════════════════════════════════════════════
describe('RC-3 §1 finishRoundLocal 판정-소스 분기(단위, 결정론적)', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date(1_800_000_000_000)); });
  afterEach(() => { vi.useRealTimers(); });

  it('참가자 choice가 raw(미인코딩, 예: "scissors")이면 hasStoredResults=false로 REAL judgeRound(raw) 폴백을 타 allDraw를 정확히 판정한다(수정 전에는 getChoiceResult("scissors")==="" 를 그대로 써 팬텀 오분류를 냈다)', async () => {
    const roomStore = createRoomStore('ROOM-UNIT-FALLBACK-1');
    const rng = mulberry32(42);
    const device = createDevice({
      id: 'p0', isHost: true, roomStore, rng, participantCount: 3,
      resolveElimination, judgePure, computePlayerStatuses, PLAYER_STATUS, maxLoserCountFor, targetLoserCount: 1,
    });
    device.impl.state.participants = [
      { id: 'p0', choice: 'scissors', wins: 0, losses: 0, draws: 0 },
      { id: 'p1', choice: 'scissors', wins: 0, losses: 0, draws: 0 },
      { id: 'p2', choice: 'scissors', wins: 0, losses: 0, draws: 0 },
    ];
    device.impl.state.confirmedSafeIds = [];
    device.impl.state.confirmedLoserIds = [];
    device.impl.state.round = 1;

    const res = await device.env.finishRoundLocal();

    expect(res.outcome).toBe('allDraw'); // 전원 동일 선택(scissors) → 무승부가 REAL 정답
    const sourceEv = device.telemetry.events.find((e) => e.eventType === 'FINISH_ROUND_SUBSTITUTE_SOURCE');
    expect(sourceEv, 'FINISH_ROUND_SUBSTITUTE_SOURCE metric must be emitted').toBeTruthy();
    expect(sourceEv.source).toBe('localJudge'); // hasStoredResults=false → 폴백 경로를 탔음을 확인
    expect(device.telemetry.events.some((e) => e.eventType === 'PHANTOM_OR_CORRUPTED_OUTCOME')).toBe(false);
  });

  it('참가자 choice가 raw이고 서로 다른 base(가위/바위/보)를 낸 경우에도 REAL judgeRound(raw)이 정확한 승/패를 계산한다(수정 전에는 getChoiceResult가 전부 ""를 반환해 판정 자체가 불가능했다)', async () => {
    const roomStore = createRoomStore('ROOM-UNIT-FALLBACK-2');
    const rng = mulberry32(7);
    const device = createDevice({
      id: 'p0', isHost: true, roomStore, rng, participantCount: 3,
      resolveElimination, judgePure, computePlayerStatuses, PLAYER_STATUS, maxLoserCountFor, targetLoserCount: 1,
    });
    // rock(p0) vs scissors(p1) vs scissors(p2): rock이 scissors 둘을 이기므로 p0=win, p1/p2=lose.
    // targetLoserCount=1이므로 lose가 2명(remainingSlots=1보다 많음) → tooMany(패자끼리 재대결).
    device.impl.state.participants = [
      { id: 'p0', choice: 'rock', wins: 0, losses: 0, draws: 0 },
      { id: 'p1', choice: 'scissors', wins: 0, losses: 0, draws: 0 },
      { id: 'p2', choice: 'scissors', wins: 0, losses: 0, draws: 0 },
    ];
    device.impl.state.confirmedSafeIds = [];
    device.impl.state.confirmedLoserIds = [];
    device.impl.state.round = 1;

    const res = await device.env.finishRoundLocal();

    expect(res.outcome).toBe('tooMany');
    expect(res.newConfirmedSafeIds).toEqual(['p0']);
    const sourceEv = device.telemetry.events.find((e) => e.eventType === 'FINISH_ROUND_SUBSTITUTE_SOURCE');
    expect(sourceEv.source).toBe('localJudge');
  });

  it('참가자 choice가 이미 인코딩(base|result)돼 있으면 hasStoredResults=true로 그 값을 그대로 신뢰한다(REAL publishHostRoundResult가 이미 확정한 판정 — raw로 재계산하지 않음)', async () => {
    const roomStore = createRoomStore('ROOM-UNIT-STORED-1');
    const rng = mulberry32(99);
    const device = createDevice({
      id: 'p0', isHost: true, roomStore, rng, participantCount: 3,
      resolveElimination, judgePure, computePlayerStatuses, PLAYER_STATUS, maxLoserCountFor, targetLoserCount: 1,
    });
    // 인코딩된 값 자체가 raw 판정과 다르게 조작돼 있어도(테스트 목적) hasStoredResults=true면
    // 그 값을 그대로 신뢰해야 한다 — 이것이 REAL의 "이미 확정된 서버 판정을 재계산하지 않는다"는
    // 설계 의도(publishHostRoundResult가 idempotent하게 한 번만 판정)를 그대로 증명한다.
    device.impl.state.participants = [
      { id: 'p0', choice: 'rock|win', wins: 0, losses: 0, draws: 0 },
      { id: 'p1', choice: 'scissors|lose', wins: 0, losses: 0, draws: 0 },
      { id: 'p2', choice: 'scissors|lose', wins: 0, losses: 0, draws: 0 },
    ];
    device.impl.state.confirmedSafeIds = [];
    device.impl.state.confirmedLoserIds = [];
    device.impl.state.round = 1;

    const res = await device.env.finishRoundLocal();

    expect(res.outcome).toBe('tooMany'); // p0=win, p1/p2=lose, targetLoserCount=1 → tooMany
    const sourceEv = device.telemetry.events.find((e) => e.eventType === 'FINISH_ROUND_SUBSTITUTE_SOURCE');
    expect(sourceEv.source).toBe('stored');
  });
});

describe('RC-3 §5 mutation(시뮬레이션이 실제 결함을 검출하는지)', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date(1_800_000_000_000)); });
  afterEach(() => { vi.useRealTimers(); });

  it('computeChoiceRemainingSeconds에서 choiceEndAt 앵커를 제거하면(Round1급 회귀 재현: 각 기기가 로컬 5초만 독립적으로 셈) choiceEnd tolerance 위반이 급증한다', async () => {
    const brokenSource = EXTRACTED_COMBINED_SOURCE.replace(
      'function computeChoiceRemainingSeconds() {\n      const endAt = getChoiceEndAt();',
      'function computeChoiceRemainingSeconds() {\n      return null; /* MUTATION(RC-3): choiceEndAt 앵커 무시 — Round1 결함 재현 */\n      const endAt = getChoiceEndAt();'
    );
    expect(brokenSource).not.toBe(EXTRACTED_COMBINED_SOURCE);

    const realRandom = Math.random;
    const N = 8, TRIALS = 24;
    let baselineViolations = 0, brokenViolations = 0;
    Math.random = () => 0;
    try {
      for (let s = 0; s < TRIALS; s++) {
        // eslint-disable-next-line no-await-in-loop
        const base = await runMeasuredTrial({
          participantCount: N, seed: 20000 + s, targetRounds: 3,
          resolveElimination, judgePure, computePlayerStatuses, PLAYER_STATUS, maxLoserCountFor, vi,
        });
        if (base.failureModes.some((f) => f.type === 'FULL_COHORT_TIMING_SPREAD' && f.phase === 'choiceEnd')) baselineViolations++;
        // eslint-disable-next-line no-await-in-loop
        const broken = await runMeasuredTrial({
          participantCount: N, seed: 20000 + s, targetRounds: 3,
          resolveElimination, judgePure, computePlayerStatuses, PLAYER_STATUS, maxLoserCountFor, vi,
          combinedSourceOverride: brokenSource,
        });
        if (broken.failureModes.some((f) => f.type === 'FULL_COHORT_TIMING_SPREAD' && f.phase === 'choiceEnd')) brokenViolations++;
      }
    } finally {
      Math.random = realRandom;
    }
    // eslint-disable-next-line no-console
    console.log(`[RC-3 mutation] choiceEnd tolerance violations: baseline ${baselineViolations}/${TRIALS}, broken(no-anchor) ${brokenViolations}/${TRIALS}`);
    expect(brokenViolations).toBeGreaterThan(baselineViolations);
    expect(brokenViolations).toBeGreaterThanOrEqual(Math.floor(TRIALS * 0.25));
  }, 60000);

  it('getNextCountdownStartAt()의 lead(기본 3600ms → WRPS-047이 realtime 전파지연을 흡수하려고 넣은 여유)를 100ms로 줄이면 countdownStart/choiceStart tolerance 위반이 급증한다(전파지연을 흡수할 여유가 없어지므로)', async () => {
    const brokenSource = EXTRACTED_COMBINED_SOURCE.replace(
      'function getNextCountdownStartAt(delayMs = 3600) {',
      'function getNextCountdownStartAt(delayMs = 100) { /* MUTATION(RC-3): WRPS-047 lead 대폭 축소 */'
    );
    expect(brokenSource).not.toBe(EXTRACTED_COMBINED_SOURCE);

    const realRandom = Math.random;
    const N = 10, TRIALS = 24;
    let baselineViolations = 0, brokenViolations = 0;
    Math.random = () => 0;
    try {
      for (let s = 0; s < TRIALS; s++) {
        // eslint-disable-next-line no-await-in-loop
        const base = await runMeasuredTrial({
          participantCount: N, seed: 30000 + s, targetRounds: 2,
          resolveElimination, judgePure, computePlayerStatuses, PLAYER_STATUS, maxLoserCountFor, vi,
        });
        if (base.failureModes.some((f) => f.type === 'FULL_COHORT_TIMING_SPREAD' && f.phase === 'countdownStart')) baselineViolations++;
        // eslint-disable-next-line no-await-in-loop
        const broken = await runMeasuredTrial({
          participantCount: N, seed: 30000 + s, targetRounds: 2,
          resolveElimination, judgePure, computePlayerStatuses, PLAYER_STATUS, maxLoserCountFor, vi,
          combinedSourceOverride: brokenSource,
        });
        if (broken.failureModes.some((f) => f.type === 'FULL_COHORT_TIMING_SPREAD' && f.phase === 'countdownStart')) brokenViolations++;
      }
    } finally {
      Math.random = realRandom;
    }
    // eslint-disable-next-line no-console
    console.log(`[RC-3 mutation] countdownStart tolerance violations: baseline ${baselineViolations}/${TRIALS}, broken(lead=100ms) ${brokenViolations}/${TRIALS}`);
    expect(brokenViolations).toBeGreaterThan(baselineViolations);
  }, 60000);
});

// ════════════════════════════════════════════════════════════════════════════
// §3/§4: N=3..20 성공률 스윕 + 실패모드 전수 열거
//
// RC-3 Phase2(codex-critic C) 이후 CEO 98%+ 게이트는 두 축으로 나눠 보고한다(§2 정의):
//   (1) hardFailureFreeRate: r.pass(= completed && hardFailureModes.length===0) 비율 — 실결함
//       (stall/exception/오판정/desync/이중카운트다운/렌더누락)이 전혀 없고 5라운드를 정상
//       완주한 비율. 이게 "진짜 성공률" 게이트다.
//   (2) onTimeConcurrencyRate: r.onTimeConcurrencyPass 비율 — REAL lateRenderMs로 "제때 받은"
//       기기끼리 tolerance 이내로 동시 렌더했는가(품질 게이트, hardFailureFreeRate와 별개).
//   late-render 비율은 순수 정보용(감점 없음, 설계상 정상)으로 별도 표기한다.
// ════════════════════════════════════════════════════════════════════════════
describe('RC-3 §2 HARD_FAILURE_TYPES 분류 정합성', () => {
  it('TOLERANCE류(FULL_COHORT_TIMING_SPREAD/ON_TIME_CONCURRENCY_EXCEEDED)는 HARD FAILURE 목록에 없다(graceful late-render를 감점하지 않는다는 설계 의도의 회귀 방지)', () => {
    expect(HARD_FAILURE_TYPES).not.toContain('TOLERANCE_EXCEEDED');
    expect(HARD_FAILURE_TYPES).not.toContain('FULL_COHORT_TIMING_SPREAD');
    expect(HARD_FAILURE_TYPES).not.toContain('ON_TIME_CONCURRENCY_EXCEEDED');
    // 실결함류는 반드시 포함되어야 한다.
    for (const mustHave of [
      'STALL', 'EXCEPTION', 'PHANTOM_OR_CORRUPTED_OUTCOME', 'ROUND_NOT_MONOTONIC',
      'MISSING_COUNTDOWN_RENDER', 'MISSING_RESULT_RENDER', 'DOUBLE_COUNTDOWN_RENDER',
    ]) {
      expect(HARD_FAILURE_TYPES).toContain(mustHave);
    }
  });
});

describe('RC-3 §3/§4 성공률 스윕 N=3..20', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date(1_800_000_000_000)); });
  afterEach(() => { vi.useRealTimers(); });

  it('N=3..20 각 200 trial: HARD-FAILURE-free 성공률 + on-time 동시성 + late-render 비율 집계', async () => {
    const TRIALS_PER_N = 200;
    const realRandom = Math.random;
    Math.random = () => 0;
    const summary = [];
    try {
      for (let n = 3; n <= 20; n++) {
        let hardFailureFreeCount = 0;
        let onTimeConcurrencyPassCount = 0;
        let lateRenderTotal = 0;
        let lateRenderLate = 0;
        const failureModeCounts = {};
        const hardFailureModeCounts = {};
        const sampleFailures = [];
        const sampleHardFailures = [];
        for (let s = 0; s < TRIALS_PER_N; s++) {
          const seed = n * 100000 + s;
          // eslint-disable-next-line no-await-in-loop
          const r = await runMeasuredTrial({
            participantCount: n, seed, targetRounds: DEFAULT_TARGET_ROUNDS,
            resolveElimination, judgePure, computePlayerStatuses, PLAYER_STATUS, maxLoserCountFor, vi,
          });
          if (r.pass) hardFailureFreeCount++;
          if (r.onTimeConcurrencyPass) onTimeConcurrencyPassCount++;
          lateRenderTotal += r.lateRenderStats.total;
          lateRenderLate += r.lateRenderStats.late;
          for (const f of r.failureModes) {
            failureModeCounts[f.type] = (failureModeCounts[f.type] || 0) + 1;
            if (f.type === 'FULL_COHORT_TIMING_SPREAD' || f.type === 'ON_TIME_CONCURRENCY_EXCEEDED') {
              const key = `${f.type}:${f.phase}`;
              failureModeCounts[key] = (failureModeCounts[key] || 0) + 1;
            }
            if (sampleFailures.length < 5) sampleFailures.push({ seed, ...f });
          }
          for (const f of r.hardFailureModes) {
            hardFailureModeCounts[f.type] = (hardFailureModeCounts[f.type] || 0) + 1;
            if (sampleHardFailures.length < 5) sampleHardFailures.push({ seed, ...f });
          }
        }
        const hardFailureFreeRate = hardFailureFreeCount / TRIALS_PER_N;
        const onTimeConcurrencyRate = onTimeConcurrencyPassCount / TRIALS_PER_N;
        const lateRenderRatio = lateRenderTotal > 0 ? lateRenderLate / lateRenderTotal : null;
        summary.push({
          n, trials: TRIALS_PER_N,
          hardFailureFreeCount, hardFailureFreeRate,
          onTimeConcurrencyPassCount, onTimeConcurrencyRate,
          lateRenderTotal, lateRenderLate, lateRenderRatio,
          failureModeCounts, hardFailureModeCounts, sampleFailures, sampleHardFailures,
        });
      }
    } finally {
      Math.random = realRandom;
    }

    // eslint-disable-next-line no-console
    console.log('[RC-3 SWEEP] N=3..20 HARD-FAILURE-free / on-time concurrency / late-render table:', JSON.stringify(
      summary.map((s) => ({
        n: s.n,
        hardFailureFreeRate: Number(s.hardFailureFreeRate.toFixed(3)),
        onTimeConcurrencyRate: Number(s.onTimeConcurrencyRate.toFixed(3)),
        lateRenderRatio: s.lateRenderRatio == null ? null : Number(s.lateRenderRatio.toFixed(3)),
        trials: s.trials,
        hardFailureModeCounts: s.hardFailureModeCounts,
      })),
      null, 2
    ));
    // eslint-disable-next-line no-console
    for (const s of summary) {
      if (s.hardFailureFreeRate < 0.98) {
        console.log(`[RC-3 SWEEP] N=${s.n} hardFailureFreeRate<98% sample HARD failures:`, JSON.stringify(s.sampleHardFailures, null, 2));
      }
      if (s.onTimeConcurrencyRate < 0.98) {
        console.log(`[RC-3 SWEEP] N=${s.n} onTimeConcurrencyRate<98% sample failures:`, JSON.stringify(
          s.sampleFailures.filter((f) => f.type === 'ON_TIME_CONCURRENCY_EXCEEDED'), null, 2
        ));
      }
    }

    // 최소 정합성만 검증한다(성공률 자체는 "고칠 곳을 찾는 계측" 산출물이지 강제 통과 기준이
    // 아니다 — CEO 지시: 결함이 나오면 orchestrator가 별도로 타깃 수정을 지시한다).
    expect(summary.length).toBe(18);
    for (const s of summary) {
      expect(s.trials).toBe(TRIALS_PER_N);
      // 하니스 자체 결함(EXCEPTION류)은 0이어야 한다 — 있으면 측정 자체가 무효.
      expect(s.hardFailureModeCounts.EXCEPTION || 0).toBe(0);
      expect(s.hardFailureModeCounts.CLOCK_SYNC_NOT_SETTLED || 0).toBe(0);
    }
  }, 400000);
});

// ════════════════════════════════════════════════════════════════════════════
// RC-3 Phase3(codex-critic B 지연 출처 소명 + 민감도): 인용된 "median 0.9~1.0s/max 6.4s/
// SYNC_LATE_RENDER 11.9s"는 저장소 전체에서 이 하니스 자신의 옛 주석 말고는 출처가 없다(출처
// 불명 — tests/rc3-harness-support.mjs의 sampleRealtimeDelayMs 상단 주석에 grep 결과와 함께
// 기록). 유일한 저장소 근거값(index.html:5732 "host 중앙값 179ms/participant 최악 6432ms")은
// realtime 전파 지연이 아니라 fetchFreshParticipantsForResult()의 REST 재시도 왕복 시간이며,
// 그 REST 재시도는 이 하니스에서 이미 별도 채널(ackDelayFn, ~60~280ms/op)로 소비된다 —
// sampleRealtimeDelayMs는 오직 rooms.update 브로드캐스트 전파에만 쓰인다(§3 위 harness-support
// 주석 참고, 네트워크 전파 vs 앱 스케줄링 대기가 이미 구조적으로 분리돼 있음).
// 실측 근거가 없으므로 3개 레짐(optimistic/moderate/pessimistic, REALTIME_DELAY_REGIMES)으로
// 민감도를 스윕해 "현실적 레짐에서 98%+ 충족"인지 "비관 레짐에서만 실패"인지 판별한다.
// ════════════════════════════════════════════════════════════════════════════
describe('RC-3 Phase3 지연 레짐 민감도 스윕(N=3..20 × 3 레짐)', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date(1_800_000_000_000)); });
  afterEach(() => { vi.useRealTimers(); });

  it('REALTIME_DELAY_REGIMES 3종이 서로 다른 지연 분포를 갖는다(레짐 파라미터가 실제로 다른 값을 만드는지 sanity check)', () => {
    expect(Object.keys(REALTIME_DELAY_REGIMES)).toEqual(['optimistic', 'moderate', 'pessimistic']);
    expect(REALTIME_DELAY_REGIMES.optimistic.tailHi).toBeLessThan(REALTIME_DELAY_REGIMES.moderate.tailHi);
    expect(REALTIME_DELAY_REGIMES.moderate.tailHi).toBeLessThan(REALTIME_DELAY_REGIMES.pessimistic.tailHi);
  });

  it('N=3..20 × {optimistic, moderate, pessimistic} 각 60 trial: HARD-FAILURE-free 성공률 표면', async () => {
    const TRIALS_PER_CELL = 60;
    const NS = [3, 5, 8, 10, 12, 16, 20]; // 전체 3..20을 촘촘히 다 돌리면 시간이 과하므로 대표 N만 표면화(§7 명시)
    const REGIMES = ['optimistic', 'moderate', 'pessimistic'];
    const realRandom = Math.random;
    Math.random = () => 0;
    const surface = [];
    try {
      for (const regime of REGIMES) {
        for (const n of NS) {
          let hardFailureFreeCount = 0;
          let onTimeConcurrencyPassCount = 0;
          let lateRenderTotal = 0;
          let lateRenderLate = 0;
          const hardFailureModeCounts = {};
          for (let s = 0; s < TRIALS_PER_CELL; s++) {
            const seed = n * 1000000 + s * 7 + regime.length; // 레짐 간 시드 충돌 방지용 소폭 오프셋
            // eslint-disable-next-line no-await-in-loop
            const r = await runMeasuredTrial({
              participantCount: n, seed, targetRounds: DEFAULT_TARGET_ROUNDS,
              resolveElimination, judgePure, computePlayerStatuses, PLAYER_STATUS, maxLoserCountFor, vi,
              realtimeDelayRegime: regime,
            });
            if (r.pass) hardFailureFreeCount++;
            if (r.onTimeConcurrencyPass) onTimeConcurrencyPassCount++;
            lateRenderTotal += r.lateRenderStats.total;
            lateRenderLate += r.lateRenderStats.late;
            for (const f of r.hardFailureModes) {
              hardFailureModeCounts[f.type] = (hardFailureModeCounts[f.type] || 0) + 1;
            }
          }
          surface.push({
            regime, n, trials: TRIALS_PER_CELL,
            hardFailureFreeRate: hardFailureFreeCount / TRIALS_PER_CELL,
            onTimeConcurrencyRate: onTimeConcurrencyPassCount / TRIALS_PER_CELL,
            lateRenderRatio: lateRenderTotal > 0 ? lateRenderLate / lateRenderTotal : null,
            hardFailureModeCounts,
          });
        }
      }
    } finally {
      Math.random = realRandom;
    }

    // eslint-disable-next-line no-console
    console.log('[RC-3 Phase3 SENSITIVITY SURFACE] N × regime:', JSON.stringify(
      surface.map((c) => ({
        regime: c.regime, n: c.n,
        hardFailureFreeRate: Number(c.hardFailureFreeRate.toFixed(3)),
        onTimeConcurrencyRate: Number(c.onTimeConcurrencyRate.toFixed(3)),
        lateRenderRatio: c.lateRenderRatio == null ? null : Number(c.lateRenderRatio.toFixed(3)),
      })),
      null, 2
    ));
    for (const c of surface) {
      if (c.hardFailureFreeRate < 0.98 || c.onTimeConcurrencyRate < 0.98) {
        // eslint-disable-next-line no-console
        console.log(`[RC-3 Phase3 SENSITIVITY] regime=${c.regime} N=${c.n} below 98% — hardFailureModeCounts:`, JSON.stringify(c.hardFailureModeCounts, null, 2));
      }
    }

    expect(surface.length).toBe(REGIMES.length * NS.length);
    for (const c of surface) {
      // 하니스 자체 결함은 레짐과 무관하게 0이어야 한다(레짐은 지연 분포만 바꾸지 판정/스케줄링
      // 로직 자체를 바꾸지 않으므로, EXCEPTION류가 나오면 측정 자체가 무효).
      expect(c.hardFailureModeCounts.EXCEPTION || 0).toBe(0);
    }
  }, 400000);
});
