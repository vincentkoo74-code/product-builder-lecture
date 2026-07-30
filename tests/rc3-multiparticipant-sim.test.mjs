import { readFileSync } from 'node:fs';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  judgePure, resolveElimination, computePlayerStatuses, PLAYER_STATUS, maxLoserCountFor,
} from '../src/game-logic.mjs';
import {
  EXTRACTED_SOURCE_BLOCKS, EXTRACTED_COMBINED_SOURCE,
  createTrialWorld, runMeasuredTrial, PHASE_TOLERANCE_MS, DEFAULT_TARGET_ROUNDS,
  getPhaseSyncRenderEvent, createDevice, createRoomStore, mulberry32,
  HARD_FAILURE_TYPES, NETWORK_STRESS_QUALITY_TYPES, LATE_RENDER_THRESHOLD_MS, REALTIME_DELAY_REGIMES,
  // RC-3 taxonomy 수렴(Review Correction Loop 3/3): stale-row 역주입 시나리오([범주1] correctness).
  runStaleRowGuardScenario,
  // EG(Elimination-extended, STOP-SHIP 술래-소거 경로 확장): 실제 rock/paper/scissors 혼합
  // 선택으로 tooMany/tooFew/gameOver까지 트리거하는 다라운드 시뮬레이션(§본문 EG 섹션 참고).
  runEliminationTrial, pickMixedChoiceBase, createMixedChoiceDriver, EG_HARD_FAILURE_TYPES,
  DEFAULT_EG_TARGET_LOSER_COUNT,
  // WRPS-079 Round2(STOP-SHIP, HIGH 잔존 수정): ready 분기 commit 게이트 직접 재현 시나리오.
  runReadyBranchClobberScenario,
  // STOP-SHIP(Part A/B/D, 미커버 커버리지 닫기 + 종합 correctnessPass 측정) — 신규 export.
  createAlternatingSkewFn, pickDecisiveChoiceBase, createDecisiveChoiceDriver,
  // STOP-SHIP Phase0~3(2.6초 REST 폴링 채널 충실 모델링 + Part A/D 재측정) — 신규 export.
  REAL_POLL_INTERVAL_MS,
  // STOP-SHIP 재수정(Review Correction Loop, isStaleRoomRow 게이팅): game_over→stats(CRITICAL-1)
  // / reinviting round=1(MEDIUM) 전이를 REAL 채널로 직접 재현하는 시나리오 2종.
  runGameOverToStatsScenario, runReinvitingRoundResetScenario,
  // STOP-SHIP 3차(원리적 재설계, isStaleRoomRow 게이팅): inviteForReplay()의 round-불변 reinviting
  // (CRITICAL-2) / goToReadyScreen()의 round-불변 ready(LOW, 도달 가능성 미확정) 전이 시나리오.
  runInviteForReplayReinvitingScenario, runGoToReadyScreenRoundInvariantScenario,
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

// ════════════════════════════════════════════════════════════════════════════
// RC-3 §5 [범주3] 차등 mutation 회귀 테스트 — taxonomy 수렴(Review Correction Loop 3/3) 이후의
// 최종 설계.
//
// v3에서는 이 두 mutation 테스트가 "brokenPassCount < baselinePassCount"(=trial pass rate 하락)를
// 단언했다 — 이게 성립한 이유가 ON_TIME_RECEIPT_COLLAPSED/LATE_COHORT_EXCESSIVE_DELAY가
// HARD_FAILURE_TYPES에 있었기 때문인데, 그 승격 자체가 baseline 실집행으로 과민임이 확인돼
// 철회됐다(§rc3-harness-support.mjs 본문 taxonomy 수렴 참고). 그래서 이 두 mutation은 원래부터
// "네트워크 지연 스케줄링 앵커가 깨지는" 순수 타이밍 회귀이지 correctness 회귀가 아니다 — 이번
// 재설계는 그 사실을 정직하게 반영해 각 mutation을 "동일 레짐 baseline vs broken 차등"(고정
// 레짐, 상대 델타, 절대 임계 아님)으로 검출하고, 같은 실집행으로 correctnessPass가 오염되지
// 않음(=v3 과민 재발 금지)도 함께 증명한다.
//
// ⚠️ 레짐 선택은 mutation마다 다르다(고정하되 균일하지 않음) — 그 이유 자체가 §7에 기록할 실측
// 발견이다: 처음에는 두 mutation 모두 optimistic(가장 관대한 네트워크, baseline 잡음이 적어
// mutation 효과를 가장 깨끗하게 분리해 보여줄 것이라 가정)로 고정해 실집행했는데,
//   - mutation B(lead 100ms)는 optimistic에서 정확히 기대대로 반응했다(아래 참고).
//   - mutation A(choiceEndAt 앵커 제거)는 optimistic은 물론 moderate(N up to 20, TRIALS up to 80)
//     에서도 baseline과 완전히 동일한 수치(예: N=8/TRIALS=24 optimistic choiceEnd spread avg가
//     baseline/broken 모두 148.46ms로 소수점까지 일치)를 냈다 — mutation의 진짜 효과가
//     "late-수신 기기의 앵커 catch-up 실패"이기 때문에, on-time 코호트가 사실상 전원인 관대한
//     레짐에서는 애초에 "catch-up이 필요한 late 기기" 자체가 거의 없어 이 mutation이 해를 끼칠
//     대상이 없다(공허가 아니라 이 mutation의 실제 물리적 특성 — 네트워크가 항상 빠르면 앵커
//     보정이 있든 없든 상관없다). 그래서 mutation A만 pessimistic(§1/§2/§3/§4가 이미 검증에
//     써온 기존 기본 레짐)으로 고정해 "late 코호트가 실제로 존재하는" 조건에서 baseline 대비
//     차등을 측정한다 — 이 선택 자체를 §7에 확신 낮은 부분으로 정직하게 기록한다(critic 재검토
//     대상).
// ════════════════════════════════════════════════════════════════════════════
describe('RC-3 §5 [범주3] 차등 mutation 회귀 테스트(고정 레짐 baseline-vs-broken 상대 델타, 과민 재발 금지 동시 검증)', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date(1_800_000_000_000)); });
  afterEach(() => { vi.useRealTimers(); });

  it('[mutation A, 고정 pessimistic 레짐] computeChoiceRemainingSeconds에서 choiceEndAt 앵커를 제거하면(Round1급 회귀 재현: 각 기기가 로컬 5초만 독립적으로 셈) 같은 레짐 baseline 대비 choiceEnd FULL_COHORT_TIMING_SPREAD/LATE_COHORT_EXCESSIVE_DELAY([범주2] network-stress quality)가 빈도·크기 양쪽에서 유의미하게(상대 델타) 악화된다 — 그런데도 correctnessPass([범주1])는 baseline과 거의 동일하게 유지된다(순수 타이밍 회귀이지 correctness 회귀가 아님을 같은 실집행으로 증명, 과민 재발 금지). ※ optimistic/moderate 레짐에서는 late 코호트 자체가 사실상 없어 이 mutation이 완전히 무해해진다(§본문 레짐 선택 근거 참고, 실측 확인됨) — 그래서 이 mutation만 pessimistic으로 고정한다.', async () => {
    const brokenSource = EXTRACTED_COMBINED_SOURCE.replace(
      'function computeChoiceRemainingSeconds() {\n      const endAt = getChoiceEndAt();',
      'function computeChoiceRemainingSeconds() {\n      return null; /* MUTATION(RC-3): choiceEndAt 앵커 무시 — Round1 결함 재현 */\n      const endAt = getChoiceEndAt();'
    );
    expect(brokenSource).not.toBe(EXTRACTED_COMBINED_SOURCE);

    const realRandom = Math.random;
    const N = 8, TRIALS = 24, REGIME = 'pessimistic';
    let baselineSpreadViolations = 0, brokenSpreadViolations = 0;
    let baselineLateExcessive = 0, brokenLateExcessive = 0;
    let baselineCorrectnessPassCount = 0, brokenCorrectnessPassCount = 0;
    const baselineSpreadMs = [], brokenSpreadMs = [];
    Math.random = () => 0;
    try {
      for (let s = 0; s < TRIALS; s++) {
        // eslint-disable-next-line no-await-in-loop
        const base = await runMeasuredTrial({
          participantCount: N, seed: 20000 + s, targetRounds: 3, realtimeDelayRegime: REGIME,
          resolveElimination, judgePure, computePlayerStatuses, PLAYER_STATUS, maxLoserCountFor, vi,
        });
        if (base.failureModes.some((f) => f.type === 'FULL_COHORT_TIMING_SPREAD' && f.phase === 'choiceEnd')) baselineSpreadViolations++;
        if (base.failureModes.some((f) => f.type === 'LATE_COHORT_EXCESSIVE_DELAY' && f.phase === 'choiceEnd')) baselineLateExcessive++;
        if (base.correctnessPass) baselineCorrectnessPassCount++;
        for (const round of Object.values(base.perRoundMaxDiff)) if (round.choiceEnd != null) baselineSpreadMs.push(round.choiceEnd);
        // eslint-disable-next-line no-await-in-loop
        const broken = await runMeasuredTrial({
          participantCount: N, seed: 20000 + s, targetRounds: 3, realtimeDelayRegime: REGIME,
          resolveElimination, judgePure, computePlayerStatuses, PLAYER_STATUS, maxLoserCountFor, vi,
          combinedSourceOverride: brokenSource,
        });
        if (broken.failureModes.some((f) => f.type === 'FULL_COHORT_TIMING_SPREAD' && f.phase === 'choiceEnd')) brokenSpreadViolations++;
        if (broken.failureModes.some((f) => f.type === 'LATE_COHORT_EXCESSIVE_DELAY' && f.phase === 'choiceEnd')) brokenLateExcessive++;
        if (broken.correctnessPass) brokenCorrectnessPassCount++;
        for (const round of Object.values(broken.perRoundMaxDiff)) if (round.choiceEnd != null) brokenSpreadMs.push(round.choiceEnd);
      }
    } finally {
      Math.random = realRandom;
    }
    const avg = (arr) => arr.reduce((a, b) => a + b, 0) / arr.length;
    const baselineAvgSpreadMs = avg(baselineSpreadMs);
    const brokenAvgSpreadMs = avg(brokenSpreadMs);
    // eslint-disable-next-line no-console
    console.log(`[RC-3 mutation A, regime=${REGIME}] choiceEnd FULL_COHORT_TIMING_SPREAD count(informational): baseline ${baselineSpreadViolations}/${TRIALS}, broken(no-anchor) ${brokenSpreadViolations}/${TRIALS}`);
    // eslint-disable-next-line no-console
    console.log(`[RC-3 mutation A, regime=${REGIME}] choiceEnd LATE_COHORT_EXCESSIVE_DELAY count(informational): baseline ${baselineLateExcessive}/${TRIALS}, broken(no-anchor) ${brokenLateExcessive}/${TRIALS}`);
    // eslint-disable-next-line no-console
    console.log(`[RC-3 mutation A, regime=${REGIME}] choiceEnd FULL_COHORT spread magnitude avg ms(informational, 상대 델타 증거): baseline ${baselineAvgSpreadMs.toFixed(1)}, broken ${brokenAvgSpreadMs.toFixed(1)}`);
    // eslint-disable-next-line no-console
    console.log(`[RC-3 mutation A, regime=${REGIME}] correctnessPassRate([범주1]): baseline ${baselineCorrectnessPassCount}/${TRIALS}, broken(no-anchor) ${brokenCorrectnessPassCount}/${TRIALS}`);
    // (a) 반공허성: 같은 레짐에서 mutation이 network-stress 채널을 baseline 대비 빈도(threshold
    // 초과 횟수)와 크기(연속 magnitude 평균, 절대 임계 아닌 상대 델타) 양쪽에서 악화시켜야 한다.
    expect(brokenSpreadViolations).toBeGreaterThan(baselineSpreadViolations);
    expect(brokenSpreadViolations).toBeGreaterThanOrEqual(Math.floor(TRIALS * 0.25));
    expect(brokenLateExcessive).toBeGreaterThan(baselineLateExcessive);
    expect(brokenAvgSpreadMs).toBeGreaterThan(baselineAvgSpreadMs * 1.5); // 상대 델타(최소 1.5배)
    // (b) 과민 재발 금지: 같은 trial들의 correctnessPass는 baseline과 broken 양쪽 모두 여전히
    // 절대다수여야 한다 — 이 mutation은 correctness 채널(STALL/EXCEPTION/오판정/desync/렌더누락/
    // 이중카운트다운/stale-row)에 영향을 주지 않는 순수 타이밍 회귀이기 때문이다.
    expect(baselineCorrectnessPassCount).toBeGreaterThanOrEqual(Math.floor(TRIALS * 0.9));
    expect(brokenCorrectnessPassCount).toBeGreaterThanOrEqual(Math.floor(TRIALS * 0.9));
  }, 60000);

  it('[mutation B, 고정 optimistic 레짐] getNextCountdownStartAt()의 lead(기본 3600ms → WRPS-047이 realtime 전파지연을 흡수하려고 넣은 여유)를 100ms로 줄이면 같은 레짐 baseline 대비 countdownStart ON_TIME_RECEIPT_COLLAPSED(수신율, [범주2] network-stress quality)와 FULL_COHORT 스프레드 크기(연속 magnitude)가 유의미하게(상대 델타) 악화된다 — 그런데도 correctnessPass([범주1])는 baseline과 거의 동일하게 유지된다(순수 타이밍 회귀이지 correctness 회귀가 아님, 과민 재발 금지). optimistic은 on-time 코호트가 거의 전원(§본문 근거)이라 "수신율 붕괴" 효과가 가장 깨끗하게 분리되어 보인다.', async () => {
    const brokenSource = EXTRACTED_COMBINED_SOURCE.replace(
      'function getNextCountdownStartAt(delayMs = 3600) {',
      'function getNextCountdownStartAt(delayMs = 100) { /* MUTATION(RC-3): WRPS-047 lead 대폭 축소 */'
    );
    expect(brokenSource).not.toBe(EXTRACTED_COMBINED_SOURCE);

    const realRandom = Math.random;
    const N = 10, TRIALS = 24, REGIME = 'optimistic';
    let baselineReceiptCollapsed = 0, brokenReceiptCollapsed = 0;
    let baselineCorrectnessPassCount = 0, brokenCorrectnessPassCount = 0;
    const baselineRatios = [], brokenRatios = [];
    const baselineSpreadMs = [], brokenSpreadMs = [];
    Math.random = () => 0;
    try {
      for (let s = 0; s < TRIALS; s++) {
        // eslint-disable-next-line no-await-in-loop
        const base = await runMeasuredTrial({
          participantCount: N, seed: 30000 + s, targetRounds: 2, realtimeDelayRegime: REGIME,
          resolveElimination, judgePure, computePlayerStatuses, PLAYER_STATUS, maxLoserCountFor, vi,
        });
        if (base.failureModes.some((f) => f.type === 'ON_TIME_RECEIPT_COLLAPSED' && f.phase === 'countdownStart')) baselineReceiptCollapsed++;
        if (base.correctnessPass) baselineCorrectnessPassCount++;
        for (const [key, v] of Object.entries(base.onTimeConcurrency)) {
          if (key.startsWith('countdownStart:') && v.onTimeReceiptRatio != null) baselineRatios.push(v.onTimeReceiptRatio);
        }
        for (const round of Object.values(base.perRoundMaxDiff)) if (round.countdownStart != null) baselineSpreadMs.push(round.countdownStart);
        // eslint-disable-next-line no-await-in-loop
        const broken = await runMeasuredTrial({
          participantCount: N, seed: 30000 + s, targetRounds: 2, realtimeDelayRegime: REGIME,
          resolveElimination, judgePure, computePlayerStatuses, PLAYER_STATUS, maxLoserCountFor, vi,
          combinedSourceOverride: brokenSource,
        });
        if (broken.failureModes.some((f) => f.type === 'ON_TIME_RECEIPT_COLLAPSED' && f.phase === 'countdownStart')) brokenReceiptCollapsed++;
        if (broken.correctnessPass) brokenCorrectnessPassCount++;
        for (const [key, v] of Object.entries(broken.onTimeConcurrency)) {
          if (key.startsWith('countdownStart:') && v.onTimeReceiptRatio != null) brokenRatios.push(v.onTimeReceiptRatio);
        }
        for (const round of Object.values(broken.perRoundMaxDiff)) if (round.countdownStart != null) brokenSpreadMs.push(round.countdownStart);
      }
    } finally {
      Math.random = realRandom;
    }
    const avg = (arr) => arr.reduce((a, b) => a + b, 0) / arr.length;
    const baselineAvgRatio = avg(baselineRatios);
    const brokenAvgRatio = avg(brokenRatios);
    const baselineAvgSpreadMs = avg(baselineSpreadMs);
    const brokenAvgSpreadMs = avg(brokenSpreadMs);
    // eslint-disable-next-line no-console
    console.log(`[RC-3 mutation B, regime=${REGIME}] countdownStart ON_TIME_RECEIPT_COLLAPSED count(informational): baseline ${baselineReceiptCollapsed}/${TRIALS}, broken(lead=100ms) ${brokenReceiptCollapsed}/${TRIALS}`);
    // eslint-disable-next-line no-console
    console.log(`[RC-3 mutation B, regime=${REGIME}] countdownStart onTimeReceiptRatio avg(informational, 상대 델타 증거): baseline ${baselineAvgRatio.toFixed(3)}, broken ${brokenAvgRatio.toFixed(3)}`);
    // eslint-disable-next-line no-console
    console.log(`[RC-3 mutation B, regime=${REGIME}] countdownStart FULL_COHORT spread magnitude avg ms(informational): baseline ${baselineAvgSpreadMs.toFixed(1)}, broken ${brokenAvgSpreadMs.toFixed(1)}`);
    // eslint-disable-next-line no-console
    console.log(`[RC-3 mutation B, regime=${REGIME}] correctnessPassRate([범주1]): baseline ${baselineCorrectnessPassCount}/${TRIALS}, broken(lead=100ms) ${brokenCorrectnessPassCount}/${TRIALS}`);
    // (a) 반공허성: 같은 optimistic 레짐에서 mutation이 network-stress 채널을 baseline 대비
    // 유의미하게(상대 델타) 악화시켜야 한다 — 빈도(수신율 붕괴 횟수)와 연속 magnitude(수신율/
    // 스프레드 평균) 양쪽으로.
    expect(brokenReceiptCollapsed).toBeGreaterThan(baselineReceiptCollapsed);
    expect(baselineAvgRatio).toBeGreaterThan(0.9); // baseline은 on-time 코호트가 거의 전원.
    expect(brokenAvgRatio).toBeLessThan(baselineAvgRatio * 0.5); // 상대 델타: 절반 미만으로 붕괴.
    expect(brokenAvgSpreadMs).toBeGreaterThan(baselineAvgSpreadMs * 1.5); // 상대 델타(최소 1.5배).
    // (b) 과민 재발 금지: correctnessPass는 baseline/broken 양쪽 모두 여전히 절대다수.
    expect(baselineCorrectnessPassCount).toBeGreaterThanOrEqual(Math.floor(TRIALS * 0.9));
    expect(brokenCorrectnessPassCount).toBeGreaterThanOrEqual(Math.floor(TRIALS * 0.9));
  }, 60000);
});

// ════════════════════════════════════════════════════════════════════════════
// §3/§4: N=3..20 성공률 스윕 + 실패모드 전수 열거
//
// RC-3 taxonomy 수렴(Review Correction Loop 3/3, 최종) 이후 CEO 98%+ 게이트는 다음과 같이
// 정의한다(§rc3-harness-support.mjs 본문 3범주 정의와 동일):
//   (1) correctnessPassRate(= r.correctnessPass/r.pass 비율, [범주1] 지연 독립 STOP-SHIP 게이트):
//       실결함(stall/exception/오판정/desync/이중카운트다운/렌더누락/stale-row/clock-sync 미settle)
//       이 전혀 없고 5라운드를 정상 완주한 비율. 이게 유일한 STOP-SHIP 합격 게이트이고, allDraw
//       baseline 전 N × 전 레짐에서 ~100%여야 한다.
//   (2) onTimeConcurrencyRate/lateRenderRatio/기타 network-stress 채널([범주2], informational):
//       레짐(optimistic/moderate/pessimistic)에 따라 정상적으로 달라지는 렌더 동시성 품질 신호일
//       뿐, 합격/불합격을 가르지 않는다 — "결함"도 "진짜 성공률"도 아니다.
// ════════════════════════════════════════════════════════════════════════════
describe('RC-3 §2 HARD_FAILURE_TYPES 분류 정합성(taxonomy 수렴, 최종)', () => {
  it('[범주1] correctness(지연 독립) 9종만 HARD FAILURE다(STALL/EXCEPTION/CLOCK_SYNC_NOT_SETTLED/PHANTOM_OR_CORRUPTED_OUTCOME/ROUND_NOT_MONOTONIC/MISSING_COUNTDOWN_RENDER/MISSING_RESULT_RENDER/DOUBLE_COUNTDOWN_RENDER/STALE_ROW_REGRESSION) — [범주2] network-stress quality(FULL_COHORT_TIMING_SPREAD/ON_TIME_CONCURRENCY_EXCEEDED/ON_TIME_RECEIPT_COLLAPSED/LATE_COHORT_EXCESSIVE_DELAY, 지연 종속)는 baseline ~4860 trial 실집행으로 과민(오탐 100%, 실결함 0건)임이 확인돼 HARD에서 제외됐다', () => {
    expect(HARD_FAILURE_TYPES).not.toContain('TOLERANCE_EXCEEDED');
    // [범주2] network-stress quality — 전부 informational(HARD 아님).
    expect(HARD_FAILURE_TYPES).not.toContain('FULL_COHORT_TIMING_SPREAD');
    expect(HARD_FAILURE_TYPES).not.toContain('ON_TIME_CONCURRENCY_EXCEEDED');
    expect(HARD_FAILURE_TYPES).not.toContain('ON_TIME_RECEIPT_COLLAPSED');
    expect(HARD_FAILURE_TYPES).not.toContain('LATE_COHORT_EXCESSIVE_DELAY');
    for (const q of NETWORK_STRESS_QUALITY_TYPES) {
      expect(HARD_FAILURE_TYPES).not.toContain(q);
    }
    // [범주1] correctness(지연 독립) — 반드시 포함되어야 한다.
    for (const mustHave of [
      'STALL', 'EXCEPTION', 'CLOCK_SYNC_NOT_SETTLED', 'PHANTOM_OR_CORRUPTED_OUTCOME', 'ROUND_NOT_MONOTONIC',
      'MISSING_COUNTDOWN_RENDER', 'MISSING_RESULT_RENDER', 'DOUBLE_COUNTDOWN_RENDER', 'STALE_ROW_REGRESSION',
    ]) {
      expect(HARD_FAILURE_TYPES).toContain(mustHave);
    }
    // HARD_FAILURE_TYPES는 정확히 이 9종뿐이어야 한다(추가/누락 회귀 방지).
    expect(HARD_FAILURE_TYPES.length).toBe(9);
  });
});

describe('RC-3 §3/§4 성공률 스윕 N=3..20', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date(1_800_000_000_000)); });
  afterEach(() => { vi.useRealTimers(); });

  it('N=3..20 각 200 trial(pessimistic, allDraw baseline): correctnessPassRate([범주1] STOP-SHIP 게이트) ~100% + on-time 동시성/late-render([범주2] informational) 집계', async () => {
    const TRIALS_PER_N = 200;
    const realRandom = Math.random;
    Math.random = () => 0;
    const summary = [];
    try {
      for (let n = 3; n <= 20; n++) {
        let correctnessPassCount = 0;
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
          if (r.correctnessPass) correctnessPassCount++;
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
        const correctnessPassRate = correctnessPassCount / TRIALS_PER_N;
        const onTimeConcurrencyRate = onTimeConcurrencyPassCount / TRIALS_PER_N;
        const lateRenderRatio = lateRenderTotal > 0 ? lateRenderLate / lateRenderTotal : null;
        summary.push({
          n, trials: TRIALS_PER_N,
          correctnessPassCount, correctnessPassRate,
          onTimeConcurrencyPassCount, onTimeConcurrencyRate,
          lateRenderTotal, lateRenderLate, lateRenderRatio,
          failureModeCounts, hardFailureModeCounts, sampleFailures, sampleHardFailures,
        });
      }
    } finally {
      Math.random = realRandom;
    }

    // eslint-disable-next-line no-console
    console.log('[RC-3 SWEEP][범주1 correctnessPassRate / 범주2 informational] N=3..20 (pessimistic) table:', JSON.stringify(
      summary.map((s) => ({
        n: s.n,
        correctnessPassRate: Number(s.correctnessPassRate.toFixed(3)),
        onTimeConcurrencyRate_informational: Number(s.onTimeConcurrencyRate.toFixed(3)),
        lateRenderRatio_informational: s.lateRenderRatio == null ? null : Number(s.lateRenderRatio.toFixed(3)),
        trials: s.trials,
        hardFailureModeCounts: s.hardFailureModeCounts,
      })),
      null, 2
    ));
    // eslint-disable-next-line no-console
    for (const s of summary) {
      if (s.correctnessPassRate < 1) {
        console.log(`[RC-3 SWEEP] N=${s.n} correctnessPassRate<100% sample [범주1] HARD failures:`, JSON.stringify(s.sampleHardFailures, null, 2));
      }
    }

    // [범주1] correctnessPassRate 수용검증(§본문 acceptance #1): allDraw baseline에서 실결함
    // (STALL/EXCEPTION/오판정/desync/렌더누락/이중카운트다운/stale-row/clock-sync 미settle)은
    // 지연 레짐과 무관하게 발생하지 않아야 하므로 ~100%(≥0.99)를 요구한다 — 이보다 낮으면 이
    // 하니스가 실결함을 발견했거나 분류가 여전히 틀렸다는 뜻이라 조사 대상이다(STOP-SHIP).
    expect(summary.length).toBe(18);
    for (const s of summary) {
      expect(s.trials).toBe(TRIALS_PER_N);
      expect(s.correctnessPassRate).toBeGreaterThanOrEqual(0.99);
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

  it('N={3,5,8,10,12,16,20} × {optimistic, moderate, pessimistic} 각 60 trial: correctnessPassRate([범주1]) ~100% 전 레짐 확인 + on-time 동시성/late-render([범주2] informational, 레짐별) 표면', async () => {
    const TRIALS_PER_CELL = 60;
    const NS = [3, 5, 8, 10, 12, 16, 20]; // 전체 3..20을 촘촘히 다 돌리면 시간이 과하므로 대표 N만 표면화(§7 명시)
    const REGIMES = ['optimistic', 'moderate', 'pessimistic'];
    const realRandom = Math.random;
    Math.random = () => 0;
    const surface = [];
    try {
      for (const regime of REGIMES) {
        for (const n of NS) {
          let correctnessPassCount = 0;
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
            if (r.correctnessPass) correctnessPassCount++;
            if (r.onTimeConcurrencyPass) onTimeConcurrencyPassCount++;
            lateRenderTotal += r.lateRenderStats.total;
            lateRenderLate += r.lateRenderStats.late;
            for (const f of r.hardFailureModes) {
              hardFailureModeCounts[f.type] = (hardFailureModeCounts[f.type] || 0) + 1;
            }
          }
          surface.push({
            regime, n, trials: TRIALS_PER_CELL,
            correctnessPassRate: correctnessPassCount / TRIALS_PER_CELL,
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
    console.log('[RC-3 Phase3 SENSITIVITY SURFACE][범주1 correctnessPassRate / 범주2 informational] N × regime:', JSON.stringify(
      surface.map((c) => ({
        regime: c.regime, n: c.n,
        correctnessPassRate: Number(c.correctnessPassRate.toFixed(3)),
        onTimeConcurrencyRate_informational: Number(c.onTimeConcurrencyRate.toFixed(3)),
        lateRenderRatio_informational: c.lateRenderRatio == null ? null : Number(c.lateRenderRatio.toFixed(3)),
      })),
      null, 2
    ));
    for (const c of surface) {
      if (c.correctnessPassRate < 1) {
        // eslint-disable-next-line no-console
        console.log(`[RC-3 Phase3 SENSITIVITY] regime=${c.regime} N=${c.n} correctnessPassRate<100% — hardFailureModeCounts:`, JSON.stringify(c.hardFailureModeCounts, null, 2));
      }
    }

    expect(surface.length).toBe(REGIMES.length * NS.length);
    for (const c of surface) {
      // [범주1] correctnessPassRate 수용검증(§본문 acceptance #1): allDraw baseline에서는 레짐
      // (네트워크 스트레스 강도)과 무관하게 ~100%(≥0.99)여야 한다 — correctness는 지연 독립이기
      // 때문이다. 하니스 자체 결함(EXCEPTION류)도 레짐과 무관하게 0이어야 한다.
      expect(c.correctnessPassRate).toBeGreaterThanOrEqual(0.99);
      expect(c.hardFailureModeCounts.EXCEPTION || 0).toBe(0);
    }
  }, 400000);
});

// ════════════════════════════════════════════════════════════════════════════
// RC-3 Phase4(반공허성 B): stale-row 역주입 — isStaleRoomRow 가드 on/off 실집행 대조.
// runStaleRowGuardScenario()가 REAL buildPenaltyValue + REAL 방 브로드캐스트 채널로 gameRound를
// 1→2로 정상 전이시킨 뒤, 그 세계에서 실제로 존재했던 gameRound=1 스냅샷을 정상 구독 큐를 우회해
// 한 기기의 REAL handleRoomUpdate에 직접 재주입한다(§rc3-harness-support.mjs 상단 주석 참고).
// ════════════════════════════════════════════════════════════════════════════
describe('RC-3 §반공허성 B: stale-row 역주입 — isStaleRoomRow 가드 on/off 실집행 대조', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date(1_800_000_000_000)); });
  afterEach(() => { vi.useRealTimers(); });

  it('REAL(무수정) isStaleRoomRow 가드가 있으면 stale-row 역주입이 skip되어 round/gameRound가 되돌아가지 않는다(desync 없음)', async () => {
    const result = await runStaleRowGuardScenario({
      seed: 424242, resolveElimination, judgePure, computePlayerStatuses, PLAYER_STATUS, maxLoserCountFor, vi,
    });
    expect(result.clockSyncSettled).toBe(true);
    expect(result.g1Settled).toBe(true);
    expect(result.g2Settled).toBe(true);
    expect(result.staleRowGameRound).toBe(1); // 재주입되는 row가 실제로 "과거"(gameRound=1) 스냅샷인지 확인.
    expect(result.victimGameRoundAfterBump).toBe(2);
    expect(result.victimRoundAfterBump).toBe(1);
    // 핵심 단정: REAL 가드가 stale row(gameRound=1 < 현재 2)를 skip해 round/gameRound가 그대로
    // 유지된다. gameRound는 REAL getGameRound()의 Math.max 보호 때문에 가드 유무와 무관하게 항상
    // 2로 유지되므로(§rc3-harness-support.mjs beginStaleRowRegressionCheck 주석 참고), round가
    // 진짜 판별 신호다.
    expect(result.victimGameRoundAfterInjection).toBe(2);
    expect(result.victimRoundAfterInjection).toBe(1);
    expect(result.regressionDetected).toBe(false);
  }, 20000);

  it('isStaleRoomRow 가드를 mutation으로 무력화하면(incomingGameRound 비교를 항상 false로) 같은 재주입이 그대로 처리되어 round가 stale row 값으로 되돌아가고, STALE_ROW_REGRESSION이 실제로 검출된다(반공허성 B 핵심 단정). gameRound 자체는 REAL getGameRound()의 별도 Math.max 방어 때문에 가드 유무와 무관하게 2로 유지된다 — 그래서 "gameRound 감소"가 아니라 "객관적으로 stale인 row가 round/countdownStartAt을 실제로 바꿨는가"가 이 재설계의 검출 기준이다.', async () => {
    // STOP-SHIP(라운드-레벨 staleness 추가) 이후 gameRound 축 판정은 isStaleGameRoundRow로
    // 개명되었고 isStaleRoomRow = isStaleGameRoundRow || isStaleRoundWithinGame로 합성된다 — 이
    // 시나리오는 gameRound 자체가 다른(1 vs 2) stale row이므로 isStaleRoundWithinGame(같은
    // gameRound 안에서만 성립)은 애초에 false다. 따라서 isStaleGameRoundRow만 무력화해도 이
    // mutation의 의도(가드 전체 무력화와 동일한 관측 결과)가 그대로 재현된다.
    const brokenSource = EXTRACTED_COMBINED_SOURCE.replace(
      'const isStaleGameRoundRow = incomingGameRound > 0 && incomingGameRound < state.gameRound;',
      'const isStaleGameRoundRow = false && incomingGameRound > 0 && incomingGameRound < state.gameRound; /* MUTATION(RC-3 반공허성 B): isStaleGameRoundRow 가드 무력화 */'
    );
    expect(brokenSource).not.toBe(EXTRACTED_COMBINED_SOURCE);

    const result = await runStaleRowGuardScenario({
      seed: 424242, resolveElimination, judgePure, computePlayerStatuses, PLAYER_STATUS, maxLoserCountFor, vi,
      combinedSourceOverride: brokenSource,
    });
    expect(result.clockSyncSettled).toBe(true);
    expect(result.g1Settled).toBe(true);
    expect(result.g2Settled).toBe(true);
    expect(result.staleRowGameRound).toBe(1);
    expect(result.victimGameRoundAfterBump).toBe(2);
    expect(result.victimRoundAfterBump).toBe(1);
    // 핵심 단정: 가드가 무력화되면 재주입이 그대로 처리되어 round가 stale row의 값(3)으로
    // 되돌아간다(desync) — gameRound 자체는 Math.max 방어로 2에 머무른다(공허했던 첫 시도의
    // 교훈, §rc3-harness-support.mjs 주석 참고).
    expect(result.victimGameRoundAfterInjection).toBe(2);
    expect(result.victimRoundAfterInjection).toBe(3);
    expect(result.regressionDetected).toBe(true);
  }, 20000);
});

// ════════════════════════════════════════════════════════════════════════════
// EG(Elimination-extended) — STOP-SHIP 술래-소거 경로 확장.
//
// 위 §3/§4/Phase3 스윕(runMeasuredTrial)은 전원이 항상 'scissors'만 내는 allDraw baseline이라
// resolveElimination의 allDraw 분기만 exercise한다(correctnessPassRate 100%로 클린 확인 완료).
// 이 섹션은 실제 rock/paper/scissors 혼합 선택(createMixedChoiceDriver, 독립 seeded rng)으로
// 승/패를 발생시켜 tooMany/tooFew/gameOver까지 다라운드에 걸쳐 실집행으로 트리거한다.
// REAL 파이프라인(handleRoomUpdate/finishRoundLocal 대체/resolveElimination/nextRound/
// scheduleRematchAutoAdvance/startGame)은 위 allDraw 경로와 완전히 동일한 코드를 그대로
// 재사용한다 — choiceDriverFn 주입과 종료조건(고정 라운드 수 대신 REAL gameOver 도달)만 다르다.
// ════════════════════════════════════════════════════════════════════════════
describe('EG §Phase0 mutation 민감도(계측 자기검증): resolveElimination을 실제로 깨면 correctnessPass가 실제로 하락하는가', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date(1_800_000_000_000)); });
  afterEach(() => { vi.useRealTimers(); });

  it('resolveElimination을 mutation(gameOver 판정을 항상 무시 — loser가 targetLoserCount를 채워도 절대 gameOver로 확정하지 않고 tooFew로만 응답)하면, 오라클(REAL 정답 resolveElimination)과의 대조로 correctnessPass가 baseline 대비 실제로 하락한다(측정이 elimination 결함에 반응한다는 증거)', async () => {
    // mutation: outcome이 'gameOver'가 되어야 할 모든 경우에 대신 'tooFew'를 반환하고
    // newConfirmedLoserIds는 실제로는 확정하지 말아야 할 activePlayers까지 섞어 games가 절대 끝나지
    // 않게 만든다(REAL 산수를 손상시키는 실제 결함 주입 — no-op이 아니다). 오라클은 원본
    // resolveElimination을 그대로 쓰므로(runEliminationTrial의 resolveEliminationOracle 기본값),
    // "실제로 계산된 값"과 "정답" 사이의 괴리를 그대로 검출해야 한다.
    const brokenResolveElimination = (args) => {
      const res = resolveElimination(args);
      if (res.outcome === 'gameOver') {
        return {
          ...res,
          outcome: 'tooFew',
          nextActiveIds: res.newConfirmedSafeIds.length ? [res.newConfirmedSafeIds[0]] : res.nextActiveIds,
          isComplete: false,
        };
      }
      return res;
    };

    const N = 6, TRIALS = 15;
    let baselinePass = 0, brokenPass = 0;
    let baselineOracleMismatch = 0, brokenOracleMismatch = 0;
    for (let s = 0; s < TRIALS; s++) {
      const seed = 700000 + s;
      // eslint-disable-next-line no-await-in-loop
      const base = await runEliminationTrial({
        participantCount: N, seed, targetLoserCount: 1,
        resolveElimination, judgePure, computePlayerStatuses, PLAYER_STATUS, maxLoserCountFor, vi,
      });
      if (base.correctnessPass) baselinePass++;
      if (base.hardFailureModes.some((f) => f.type === 'PHANTOM_OR_CORRUPTED_OUTCOME')) baselineOracleMismatch++;
      // eslint-disable-next-line no-await-in-loop
      const broken = await runEliminationTrial({
        participantCount: N, seed, targetLoserCount: 1,
        resolveElimination: brokenResolveElimination, judgePure, computePlayerStatuses, PLAYER_STATUS, maxLoserCountFor, vi,
        // resolveEliminationOracle 미지정 → 기본값(REAL, 무손상) 사용 — mutation은 오직 디바이스
        // 쪽에만 적용된다.
      });
      if (broken.correctnessPass) brokenPass++;
      if (broken.hardFailureModes.some((f) => f.type === 'PHANTOM_OR_CORRUPTED_OUTCOME')) brokenOracleMismatch++;
    }
    // eslint-disable-next-line no-console
    console.log(`[EG Phase0] correctnessPass: baseline ${baselinePass}/${TRIALS}, broken(gameOver→tooFew mutation) ${brokenPass}/${TRIALS}`);
    // eslint-disable-next-line no-console
    console.log(`[EG Phase0] PHANTOM_OR_CORRUPTED_OUTCOME(oracle mismatch) count: baseline ${baselineOracleMismatch}/${TRIALS}, broken ${brokenOracleMismatch}/${TRIALS}`);
    // 핵심 단정(반공허성): baseline은 절대다수 통과해야 하고, mutation은 (a) STALL(게임이
    // 영원히 gameOver에 도달하지 못함 — mutation이 gameOver 확정 자체를 막으므로) 또는
    // (b) 오라클 mismatch(도달은 하되 정답과 다른 값)로 correctnessPass가 baseline보다 뚜렷이
    // 낮아야 한다. 둘 중 하나라도 검출되면 계측이 elimination 결함에 실제로 반응한다는 증거다.
    expect(baselinePass).toBeGreaterThanOrEqual(Math.floor(TRIALS * 0.8));
    expect(brokenPass).toBeLessThan(baselinePass);
    expect(brokenOracleMismatch + brokenPass).not.toBe(TRIALS + baselinePass); // 최소한 뭔가 달라졌음
  }, 120000);

  it('resolveElimination을 mutation(패자 집계에서 한 명을 누락 — off-by-one)하면 오라클 대조로 PHANTOM_OR_CORRUPTED_OUTCOME이 실제로 검출된다', async () => {
    const brokenResolveElimination = (args) => {
      const res = resolveElimination(args);
      if (res.outcome === 'tooMany' || res.outcome === 'gameOver') {
        // 패자 목록에서 한 명을 조용히 빼먹는다(실제 오프바이원 결함 재현).
        const droppedNextActive = res.nextActiveIds.length > 1 ? res.nextActiveIds.slice(1) : res.nextActiveIds;
        const droppedLoser = res.newConfirmedLoserIds.length > 0 ? res.newConfirmedLoserIds.slice(0, -1) : res.newConfirmedLoserIds;
        return { ...res, nextActiveIds: droppedNextActive, newConfirmedLoserIds: droppedLoser };
      }
      return res;
    };
    const N = 8, TRIALS = 15;
    let brokenPass = 0, brokenMismatch = 0;
    for (let s = 0; s < TRIALS; s++) {
      const seed = 710000 + s;
      // eslint-disable-next-line no-await-in-loop
      const broken = await runEliminationTrial({
        participantCount: N, seed, targetLoserCount: 2,
        resolveElimination: brokenResolveElimination, judgePure, computePlayerStatuses, PLAYER_STATUS, maxLoserCountFor, vi,
      });
      if (broken.correctnessPass) brokenPass++;
      if (broken.hardFailureModes.some((f) => f.type === 'PHANTOM_OR_CORRUPTED_OUTCOME')) brokenMismatch++;
    }
    // eslint-disable-next-line no-console
    console.log(`[EG Phase0-B] off-by-one mutation: correctnessPass ${brokenPass}/${TRIALS}, PHANTOM_OR_CORRUPTED_OUTCOME ${brokenMismatch}/${TRIALS}`);
    expect(brokenMismatch).toBeGreaterThan(0);
    expect(brokenPass).toBeLessThan(TRIALS);
  }, 120000);
});

describe('EG §Phase1/2 실추출 경계 + 커버리지 증명: 혼합 선택이 모든 분기(allDraw/tooMany/tooFew/gameOver)를 실제로 트리거하는가', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date(1_800_000_000_000)); });
  afterEach(() => { vi.useRealTimers(); });

  it('N={3,5,8,12,16} 각 20 trial(pessimistic, REAL resolveElimination, 혼합 선택): allDraw/tooMany/tooFew/gameOver 4개 분기가 전부 최소 1회 이상 관측된다(커버리지 표)', async () => {
    const NS = [3, 5, 8, 12, 16];
    const TRIALS_PER_N = 20;
    const branchTotals = { allDraw: 0, tooMany: 0, tooFew: 0, gameOver: 0 };
    const perN = [];
    let completedCount = 0;
    let totalTrials = 0;
    for (const n of NS) {
      const branchByN = { allDraw: 0, tooMany: 0, tooFew: 0, gameOver: 0 };
      let nCompleted = 0;
      for (let s = 0; s < TRIALS_PER_N; s++) {
        const seed = n * 900000 + s;
        totalTrials++;
        // eslint-disable-next-line no-await-in-loop
        const r = await runEliminationTrial({
          participantCount: n, seed, targetLoserCount: 2, // 고정값: N에 비례한 target은 대N에서 수렴이 지나치게 느려짐(§본문 실측)
          resolveElimination, judgePure, computePlayerStatuses, PLAYER_STATUS, maxLoserCountFor, vi,
        });
        if (r.completed) { completedCount++; nCompleted++; }
        for (const [outcome, count] of Object.entries(r.outcomeCounts)) {
          branchTotals[outcome] = (branchTotals[outcome] || 0) + count;
          branchByN[outcome] = (branchByN[outcome] || 0) + count;
        }
      }
      perN.push({ n, trials: TRIALS_PER_N, completed: nCompleted, branchByN });
    }
    // eslint-disable-next-line no-console
    console.log('[EG Phase2 COVERAGE] 분기별 도달 횟수(전체):', JSON.stringify(branchTotals, null, 2));
    // eslint-disable-next-line no-console
    console.log('[EG Phase2 COVERAGE] N별 표:', JSON.stringify(perN, null, 2));
    // eslint-disable-next-line no-console
    console.log(`[EG Phase2 COVERAGE] gameOver 도달(completed) 트라이얼: ${completedCount}/${totalTrials}`);
    expect(branchTotals.allDraw).toBeGreaterThan(0);
    expect(branchTotals.tooMany).toBeGreaterThan(0);
    expect(branchTotals.tooFew).toBeGreaterThan(0);
    expect(branchTotals.gameOver).toBeGreaterThan(0);
    // 완주율(completedCount)은 이 테스트의 합격 게이트가 아니다(§7 한계로 정직하게 보고) — N이
    // 커질수록 judgePure의 "3종류가 다 나오면 draw" 규칙 때문에 allDraw 확률이 급격히 올라가
    // 결정적 라운드 자체가 희소해지고, targetLoserCount=floor(N/3)이 클수록 그 희소한 결정적
    // 라운드가 더 많이 누적돼야 gameOver에 닿는다 — 이건 이 mutation-free REAL 파이프라인의
    // 결함이 아니라 "균등 랜덤 혼합 선택 + 유한 라운드 예산"이라는 이 측정 설계 자체의 특성이다
    // (실제 게임에서도 대인원 무작위 라운드는 원래 많은 라운드가 걸린다). N별 완주율은 로그로
    // 표면화하되(위 콘솔), 절대 임계값으로 STOP-SHIP 판정을 내리지 않는다 — §EG Phase3 스윕이
    // hardFailureModeCounts(STALL 포함)를 N별로 전수 열거해 정직하게 다룬다.
  }, 300000);
});

describe('EG §Phase3 correctnessPass 측정(N=3..20) + RC-2 회귀 표적 감시', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date(1_800_000_000_000)); });
  afterEach(() => { vi.useRealTimers(); });

  it('EG_HARD_FAILURE_TYPES는 STALL/EXCEPTION/CLOCK_SYNC_NOT_SETTLED/PHANTOM_OR_CORRUPTED_OUTCOME/ROUND_NOT_MONOTONIC/DOUBLE_COUNTDOWN_RENDER/STALE_ROW_REGRESSION/CROSS_DEVICE_OUTCOME_MISMATCH/READY_BRANCH_STATE_CLOBBER 9종이다', () => {
    expect(EG_HARD_FAILURE_TYPES.length).toBe(9);
    for (const mustHave of [
      'STALL', 'EXCEPTION', 'CLOCK_SYNC_NOT_SETTLED', 'PHANTOM_OR_CORRUPTED_OUTCOME',
      'ROUND_NOT_MONOTONIC', 'DOUBLE_COUNTDOWN_RENDER', 'STALE_ROW_REGRESSION', 'CROSS_DEVICE_OUTCOME_MISMATCH',
      'READY_BRANCH_STATE_CLOBBER',
    ]) {
      expect(EG_HARD_FAILURE_TYPES).toContain(mustHave);
    }
  });

  it('N=3..20(대표 표본) 각 15 trial(pessimistic, REAL 파이프라인, 혼합 선택): correctnessPass 측정 + 실패 전수 열거(RC-2 회귀 채널 DOUBLE_COUNTDOWN_RENDER/STALE_ROW_REGRESSION/EXCEPTION 포함)', async () => {
    // §3/§4처럼 3..20 전부를 촘촘히 돌리면(가변 라운드 수 때문에 allDraw baseline보다 trial당
    // 비용이 큼) 시간이 과하므로, 대표 N 표본으로 표면화한다(§7 명시 — 촘촘한 전수는 후속 위임).
    const NS = [3, 4, 5, 6, 8, 10, 12, 14, 16, 18, 20];
    const TRIALS_PER_N = 15;
    const summary = [];
    for (const n of NS) {
      let passCount = 0;
      const hardFailureModeCounts = {};
      const sampleFailures = [];
      for (let s = 0; s < TRIALS_PER_N; s++) {
        const seed = n * 800000 + s;
        // eslint-disable-next-line no-await-in-loop
        const r = await runEliminationTrial({
          participantCount: n, seed, targetLoserCount: 2, // 고정값: N에 비례한 target은 대N에서 수렴이 지나치게 느려짐(§본문 실측)
          resolveElimination, judgePure, computePlayerStatuses, PLAYER_STATUS, maxLoserCountFor, vi,
        });
        if (r.correctnessPass) passCount++;
        for (const f of r.hardFailureModes) {
          hardFailureModeCounts[f.type] = (hardFailureModeCounts[f.type] || 0) + 1;
          if (sampleFailures.length < 8) sampleFailures.push({ seed, n, ...f });
        }
      }
      summary.push({ n, trials: TRIALS_PER_N, passCount, passRate: passCount / TRIALS_PER_N, hardFailureModeCounts, sampleFailures });
    }
    // eslint-disable-next-line no-console
    console.log('[EG Phase3 SWEEP] N별 correctnessPassRate + hardFailureModeCounts:', JSON.stringify(
      summary.map((s) => ({ n: s.n, trials: s.trials, passRate: Number(s.passRate.toFixed(3)), hardFailureModeCounts: s.hardFailureModeCounts })),
      null, 2
    ));
    for (const s of summary) {
      if (s.passRate < 1) {
        // eslint-disable-next-line no-console
        console.log(`[EG Phase3 SWEEP] N=${s.n} passRate<100% — 실패 전수 열거(sample):`, JSON.stringify(s.sampleFailures, null, 2));
      }
    }
    // 이 스윗은 "고쳐라"가 아니라 "실제로 얼마나 되는지 정직하게 측정하라"가 목적이므로, 여기서는
    // 임의의 절대 임계값으로 STOP-SHIP 여부를 assert하지 않는다(하드코딩된 100% 기대는 이 신규
    // 확장 경로에서는 아직 검증된 바 없다 — §Phase0로 계측 민감도만 확인했다). 대신 하니스 자체
    // 결함(EXCEPTION)만은 0이어야 한다(있으면 측정 자체가 무효).
    for (const s of summary) {
      expect(s.hardFailureModeCounts.EXCEPTION || 0).toBe(0);
    }
    // WRPS-079(STOP-SHIP, HIGH) — codex-critic MEDIUM CI 갭 수정: 이 스윕은 종전에
    // CROSS_DEVICE_OUTCOME_MISMATCH를 콘솔 로그로만 표면화하고 하드 assert가 없어, 이 두 재현
    // 시드 밖의 다른 시드에서 회귀가 재발해도 CI가 잡지 못했다. handleRoomUpdate 재진입 경합
    // 계열(finishRoundLocal 채널 CROSS_DEVICE_OUTCOME_MISMATCH + ready 분기 채널
    // READY_BRANCH_STATE_CLOBBER, 위 EG_HARD_FAILURE_TYPES 정의 참고) 둘 다 이 N=3..20 대표
    // 표본 스윕 전체에서 0이어야 한다 — 위 REPRO_SEEDS 전용 테스트가 "알려진 두 시드"만 고정
    // 확인한다면, 이 하드 assert는 "다른 임의 시드에서의 재발"까지 넓게 잡는 회귀 게이트다.
    for (const s of summary) {
      expect(s.hardFailureModeCounts.CROSS_DEVICE_OUTCOME_MISMATCH || 0).toBe(0);
      expect(s.hardFailureModeCounts.READY_BRANCH_STATE_CLOBBER || 0).toBe(0);
    }
    expect(summary.length).toBe(NS.length);
  }, 600000);
});

// ════════════════════════════════════════════════════════════════════════════
// WRPS-079(STOP-SHIP, HIGH) — handleRoomUpdate 재진입/경합으로 인한
// CROSS_DEVICE_OUTCOME_MISMATCH 근본 수정 검증.
//
// 정밀 트레이스(단일스텝 확인, 임시 계측 스크립트로 실집행 — 이 파일에는 재현만 남긴다):
// N=18/seed14400001에서 device p1이 round=3 'result' row를 처리하며 waitForPhaseRender +
// fetchFreshParticipantsForResult await 체인에 들어간 사이(t=71400), 같은 기기 p1에
// round=4 'ready' row(host가 이미 다음 라운드로 진행시킨 진짜 최신 row)가 겹쳐 도착해
// 완주하며(t=71401~71558) state.round/participants를 round4 스냅샷으로 먼저 덮어썼다.
// round=3 처리가 이후(t=71577) 재개되어 finishRoundLocal()을 부를 때는 이미 state.round=4/
// participants=round4 스냅샷이었다 — round3의 확정을 round4 컨텍스트로 커밋해버려, 이 경합
// 타이밍을 겪지 않은 다른 기기(같은 round3을 자기 자신의 신선한 데이터로 정상 확정)와 서로
// 다른 outcome이 남는다. N=10/seed8000011도 동일한 패턴(round1 'result' 처리 도중 round2
// 'ready'가 끼어듦, round44에서 관측)으로 재현된다.
//
// 수정: handleRoomUpdate 진입 시(항상 await 이전, 동기 구간) (게임회차:라운드) 컨텍스트가
// 실제로 바뀐 경우에만 새 세대를 발급하고(countdownGeneration/countdownCoroutineActiveKey와
// 동일한 idiom — 완전 동일 컨텍스트 재호출은 세대를 그대로 물려받아 흔한 무해 중복 폴링/echo가
// false positive stall을 만들지 않는다), finishRoundLocal() 커밋 직전에만 그 세대가 여전히
// 최신인지 재확인한다 — 아니면(더 새 컨텍스트가 이미 진행 중) 이 낡은 커밋만 건너뛴다(그
// 최신 컨텍스트는 자기 자신의 handleRoomUpdate 호출이 책임지므로 업데이트 자체는 유실되지
// 않는다).
describe('WRPS-079(STOP-SHIP) handleRoomUpdate 재진입 경합 — CROSS_DEVICE_OUTCOME_MISMATCH 근본 수정', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date(1_800_000_000_000)); });
  afterEach(() => { vi.useRealTimers(); });

  // 실제 결함이 확정된 재현 시드 그대로(critic 원 보고 §2 소스추적 근거) — seed 공식은 위
  // EG §Phase3 스윕과 동일(seed = n*800000 + s)이라 이 시드들은 그 스윕 15 trial 안에도 이미
  // 포함되어 있었다(정보용 로그로만 노출되고 하드 assert가 없어 회귀로 못 잡았던 것 — 이
  // describe가 그 갭을 정확히 이 두 시드에 대해 하드 assert로 메운다).
  const REPRO_SEEDS = [
    { n: 18, seed: 14400001, expectedRound: 39 },
    { n: 10, seed: 8000011, expectedRound: 44 },
  ];

  it('N=18/seed14400001, N=10/seed8000011: REAL(수정된) handleRoomUpdate로 재실행하면 CROSS_DEVICE_OUTCOME_MISMATCH가 0이다(RC-2 회귀 채널도 0 — STALE_ROW_REGRESSION/DOUBLE_COUNTDOWN_RENDER/ROUND_NOT_MONOTONIC/PHANTOM_OR_CORRUPTED_OUTCOME/EXCEPTION)', async () => {
    for (const { n, seed } of REPRO_SEEDS) {
      // eslint-disable-next-line no-await-in-loop
      const r = await runEliminationTrial({
        participantCount: n, seed, targetLoserCount: 2,
        resolveElimination, judgePure, computePlayerStatuses, PLAYER_STATUS, maxLoserCountFor, vi,
      });
      const byType = {};
      for (const f of r.hardFailureModes) byType[f.type] = (byType[f.type] || 0) + 1;
      // 핵심 단정(수정 확인): 실제 원인 결함이 사라졌다.
      expect(byType.CROSS_DEVICE_OUTCOME_MISMATCH || 0).toBe(0);
      // 인접 RC-2/§Phase0 회귀 채널도 이 수정으로 새로 깨지지 않았는지 함께 확인(불변식: 기존
      // 가드/idempotency와 충돌·이중발동 없음).
      expect(byType.STALE_ROW_REGRESSION || 0).toBe(0);
      expect(byType.DOUBLE_COUNTDOWN_RENDER || 0).toBe(0);
      expect(byType.ROUND_NOT_MONOTONIC || 0).toBe(0);
      expect(byType.PHANTOM_OR_CORRUPTED_OUTCOME || 0).toBe(0);
      expect(byType.EXCEPTION || 0).toBe(0);
      // WRPS-079 Round2(STOP-SHIP, HIGH 잔존 수정): ready 분기 채널도 이 두 알려진 재현 시드에서
      // 0이어야 한다(아래 §정직 보고: 이 두 시드 자체는 이 채널을 자연 발화시키지 않는다는 것을
      // 넓은 스윕으로 확인했지만, 회귀 감시 차원에서 여기서도 함께 assert한다).
      expect(byType.READY_BRANCH_STATE_CLOBBER || 0).toBe(0);
      // ⚠️ STALL은 이 두 시드에서 재현되지 않는다(§7 사전 확인 — baseline/수정본 모두 completed:
      // true) — 그래도 이 트라이얼 자체가 정상 완주했는지는 확인해 둔다(측정 무효화 방지).
      expect(r.completed).toBe(true);
    }
  }, 120000);

  it('[mutation, 반공허성] 위 세대 가드(state.hruGen===room.__hruGen)를 무력화(항상 true)하면 같은 두 재현 시드에서 CROSS_DEVICE_OUTCOME_MISMATCH가 다시 RED가 된다 — 이 수정이 실제로 결함을 막고 있다는 직접 증거(제거 시 재발)', async () => {
    // mutation: 위 checkpoint 조건을 항상 통과시켜(가드 무력화) 수정 전 원본 동작(무조건
    // finishRoundLocal() 커밋)을 그대로 재현한다 — REAL 텍스트 치환이지 손으로 새 로직을 짜는
    // 것이 아니다(EXTRACTED_COMBINED_SOURCE는 index.html 그대로).
    const brokenSource = EXTRACTED_COMBINED_SOURCE.replace(
      'if (state.hruGen===room.__hruGen){ finishRoundLocal();',
      'if (true){ finishRoundLocal(); /* MUTATION(WRPS-079 반공허성): 세대 가드 무력화 */'
    );
    expect(brokenSource).not.toBe(EXTRACTED_COMBINED_SOURCE);

    let anyMismatch = false;
    for (const { n, seed } of REPRO_SEEDS) {
      // eslint-disable-next-line no-await-in-loop
      const r = await runEliminationTrial({
        participantCount: n, seed, targetLoserCount: 2,
        resolveElimination, judgePure, computePlayerStatuses, PLAYER_STATUS, maxLoserCountFor, vi,
        combinedSourceOverride: brokenSource,
      });
      const mismatchCount = r.hardFailureModes.filter((f) => f.type === 'CROSS_DEVICE_OUTCOME_MISMATCH').length;
      if (mismatchCount > 0) anyMismatch = true;
    }
    // 핵심 단정(mutation 부하검증): 가드를 제거하면 이 두 시드 중 적어도 하나에서 다시
    // CROSS_DEVICE_OUTCOME_MISMATCH가 관측되어야 한다 — 그래야 위 "0" 결과가 이 가드
    // 덕분이라고 주장할 수 있다(가드 유무와 무관하게 항상 0이었다면 이 가드는 애초에
    // 아무것도 막고 있지 않다는 뜻이므로 반증이 됨).
    expect(anyMismatch).toBe(true);
  }, 120000);

  // WRPS-079 Round2(STOP-SHIP, HIGH 잔존 수정): 넓은 시드 스윕 — finishRoundLocal 채널
  // (CROSS_DEVICE_OUTCOME_MISMATCH)과 신규 ready 분기 채널(READY_BRANCH_STATE_CLOBBER) 둘 다,
  // 위 두 "알려진" 재현 시드 밖의 임의 시드 300개(§검증 요구사항 "최소 300+ 신규 시드")에서
  // 재발하지 않는지 확인한다. 위 EG §Phase3 SWEEP(11×15=165 trial, seed=n*800000+s)과는 다른
  // seed 공식(n*900000+s)을 써서 완전히 새로운 시드 집합임을 보장한다.
  it('[넓은 회귀 스윕, 300 신규 시드] N=3..20 대표 표본 × 30 seed(seed=n*900000+s, 위 REPRO_SEEDS/Phase3 SWEEP과 겹치지 않는 시드): CROSS_DEVICE_OUTCOME_MISMATCH/READY_BRANCH_STATE_CLOBBER 둘 다 0', async () => {
    const NS = [3, 4, 5, 6, 8, 10, 12, 14, 16, 18];
    const SEEDS_PER_N = 30; // 10 × 30 = 300
    let crossDeviceCount = 0;
    let readyClobberCount = 0;
    let exceptionCount = 0;
    for (const n of NS) {
      for (let s = 0; s < SEEDS_PER_N; s++) {
        const seed = n * 900000 + s;
        // eslint-disable-next-line no-await-in-loop
        const r = await runEliminationTrial({
          participantCount: n, seed, targetLoserCount: 2,
          resolveElimination, judgePure, computePlayerStatuses, PLAYER_STATUS, maxLoserCountFor, vi,
        });
        for (const f of r.hardFailureModes) {
          if (f.type === 'CROSS_DEVICE_OUTCOME_MISMATCH') crossDeviceCount++;
          if (f.type === 'READY_BRANCH_STATE_CLOBBER') readyClobberCount++;
          if (f.type === 'EXCEPTION') exceptionCount++;
        }
      }
    }
    // eslint-disable-next-line no-console
    console.log(`[WRPS-079 넓은 스윕] ${NS.length * SEEDS_PER_N} trial: crossDeviceCount=${crossDeviceCount} readyClobberCount=${readyClobberCount} exceptionCount=${exceptionCount}`);
    expect(exceptionCount).toBe(0);
    expect(crossDeviceCount).toBe(0);
    expect(readyClobberCount).toBe(0);
  }, 600000);
});

// ════════════════════════════════════════════════════════════════════════════
// WRPS-079 Round2(STOP-SHIP, HIGH 잔존 수정) — ready 분기 commit 게이트(index.html ~5928
// `if (!readyBranchStaleGeneration)`) 검증.
//
// §정직 보고(자연 재현 탐색 결과): 위 REPRO_SEEDS 2종(원래 finishRoundLocal 재현 시드) +
// N=3..20 × 40 seed(총 360, pessimistic 레짐) 넓은 사전 스윕에서 이 ready 분기 재개 지점이
// staleGeneration:true를 관측한 사례를 단 한 건도 찾지 못했다. 원인은 이 하니스의 타이밍
// 모델(§본문): result 분기(finishRoundLocal 채널)는 waitForPhaseRender + fetchFreshParticipants
// ForResult(최대 5000ms 하드 타임아웃 + 최대 3000ms 추가 대기, 도합 최대 8초급) await 체인이 있어
// 그 사이 라운드 전체가 한 바퀴 더 돌 여지가 크지만, ready 분기의 Promise.all은 waitForPhaseRender
// (스케줄 시각이 보통 이미 지난 시각이라 즉시 반환) + 참가자 재조회(하니스 ackDelay 상한
// 280ms)뿐이라 이 하니스의 지연 분포 안에서는 "그 사이 라운드 전체가 한 바퀴 더 돈다"는 경합이
// 사실상 관측되지 않았다.
//
// 그러나 이 메커니즘 자체가 무해하다는 뜻은 아니다 — REAL 프로덕션에서는 이 참가자 재조회
// (readyParticipantsRefreshPromise, index.html ~5762)에 하드 타임아웃이 전혀 없다(result 분기만
// Build30/WRPS-078에서 5000ms 상한을 받았다). 이 저장소 자신의 기록에 이미 실측 최대 101,778ms
// 대기(WRPS-078 주석)가 남아있으므로, 느리거나 불안정한 네트워크에서는 이 suspend 구간이 원리적
// 으로 임의로 길어질 수 있고, 그 사이 여러 라운드가 지나가는 경합도 원리적으로 가능하다.
// 그래서 아래는 `runStaleRowGuardScenario`(위 §반공허성 B)와 동일한 성격의 "직접 구성" 재현으로
// 그 메커니즘 자체를 임의의 시드 추첨에 기대지 않고 결정론적으로 증명한다(§runReadyBranchClobber
// Scenario 정의부 주석 참고 — REAL handleRoomUpdate를 두 번 그대로 호출할 뿐, 로직을 손으로
// 다시 짜지 않는다). host DB-write 경로(publishHostRoundResult)에 영향을 줄 수 있는 방어심층
// 게이트이므로, "자연 재현 못함"에도 불구하고 게이트 자체는 유지한다(§본문 지시 그대로).
describe('WRPS-079 Round2(STOP-SHIP) ready 분기 commit 게이트 — 직접 재현(결정론적)', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date(1_800_000_000_000)); });
  afterEach(() => { vi.useRealTimers(); });

  it('REAL(수정된) 코드: 낡은 세대의 ready 분기 재개가 staleGeneration:true를 감지해 커밋을 스킵한다 — confirmedSafeIds/LoserIds가 훼손되지 않는다', async () => {
    const r = await runReadyBranchClobberScenario({
      resolveElimination, judgePure, computePlayerStatuses, PLAYER_STATUS, maxLoserCountFor, vi,
    });
    expect(r.clockSyncSettled).toBe(true);
    expect(r.p1Settled).toBe(true);
    // 시나리오가 실제로 세대 경합을 만들어냈는지부터 확인(측정 무효화 방지) — 이게 거짓이면
    // 아래 "커밋 스킵" 확인 자체가 공허해진다.
    expect(r.genAfterBump).toBeGreaterThan(r.genAfterP1Fired);
    expect(r.resumeEvents.length).toBeGreaterThan(0);
    expect(r.resumeEvents.every((e) => e.staleGeneration === true)).toBe(true);
    // 핵심 단정: 게이트가 커밋을 스킵했다(abort 계측 발생) + 실제로 훼손되지 않았다(핵심 방어 확인).
    expect(r.abortedReadyEvents.length).toBeGreaterThan(0);
    expect(r.clobberDetected).toBe(false);
    expect(r.finalConfirmedSafeIds).toEqual(r.confirmedSafeIdsBeforeResume);
    expect(r.finalConfirmedLoserIds).toEqual(r.confirmedLoserIdsBeforeResume);
    expect(r.finalConfirmedSafeIds).toEqual([r.hostId]);
    expect(r.finalConfirmedLoserIds).toEqual([r.victimId]);
  }, 30000);

  it('[mutation, 반공허성] 위 ready 분기 게이트(if (!readyBranchStaleGeneration))를 무력화(항상 커밋)하면 같은 결정론적 재현에서 READY_BRANCH_STATE_CLOBBER가 실제로 발화한다 — 이 게이트가 실제로 데이터를 보호하고 있다는 직접 증거(제거 시 재발)', async () => {
    const brokenSource = EXTRACTED_COMBINED_SOURCE.replace(
      'if (!readyBranchStaleGeneration) {',
      'if (true) { /* MUTATION(WRPS-079 Round2 반공허성): ready 분기 세대 가드 무력화 */'
    );
    expect(brokenSource).not.toBe(EXTRACTED_COMBINED_SOURCE);

    const r = await runReadyBranchClobberScenario({
      resolveElimination, judgePure, computePlayerStatuses, PLAYER_STATUS, maxLoserCountFor, vi,
      combinedSourceOverride: brokenSource,
    });
    // 세대 경합 자체는 게이트 유무와 무관하게 동일하게 만들어진다(계측은 게이트 로직 자체에
    // 기대지 않는다 — 위 index.html 주석 참고).
    expect(r.resumeEvents.length).toBeGreaterThan(0);
    expect(r.resumeEvents.every((e) => e.staleGeneration === true)).toBe(true);
    // 핵심 단정(mutation 부하검증): 게이트를 제거하면 abort 계측이 사라지고, 그 대신 실제로
    // confirmedSafeIds/LoserIds가 훼손된다.
    expect(r.abortedReadyEvents.length).toBe(0);
    expect(r.clobberDetected).toBe(true);
    expect(r.finalConfirmedSafeIds).not.toEqual(r.confirmedSafeIdsBeforeResume);
    expect(r.finalConfirmedLoserIds).not.toEqual(r.confirmedLoserIdsBeforeResume);
  }, 30000);
});

// ════════════════════════════════════════════════════════════════════════════
// STOP-SHIP Part A: 폴링-realtime out-of-order 주입.
//
// §7 한계(정직 명시, 축소 인정): 실제 2.6초 참가자 폴링 채널(fetchParticipants, index.html
// ~6066)은 handleRoomUpdate와 완전히 별개인 독립 함수(cleanupDuplicateRoomProfiles/
// destroyRoomAndGoHome/beginNewGameRound 등과 강결합)이고, 이번 측정 범위에서도 여전히 추출하지
// 않았다(이 하니스는 그 채널을 한 번도 구동한 적이 없다 — 전적으로 미커버). deliveryOrderMode:
// 'outOfOrder'(§rc3-harness-support.mjs 상단 주석)는 그 채널 자체를 재현하는 것이 아니라, "폴링이
// realtime과 순서보장 없이 경쟁해 이 기기에 스냅샷이 커밋 순서와 다르게 도착할 수 있다"는 핵심
// 위협 모델만 REAL(무수정) handleRoomUpdate가 이미 소비하는 room-row realtime 전송 계층에서
// 일반화해 재현한다 — 구독자별 단조증가 배달 강제를 끄면 뒤에 커밋된 row가 앞선 row를 추월해
// 도착할 수 있다(§충실성 보정 주석이 "하니스 버그"라 부르며 되돌렸던 원래 동작을 여기서는 의도적
// 스트레스 모드로 재사용). REAL isStaleRoomRow 가드(WRPS-079/081 포함) 자체는 손대지 않는다.
describe('STOP-SHIP Part A: 폴링-realtime out-of-order 주입(deliveryOrderMode)', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date(1_800_000_000_000)); });
  afterEach(() => { vi.useRealTimers(); });

  it('sanity: deliveryOrderMode 미지정(기본값 monotonic)은 기존 동작과 완전히 동일하다(회귀 없음 — 파라미터 추가 자체가 기존 시드 결과를 바꾸지 않는지 확인)', async () => {
    const realRandom = Math.random;
    Math.random = () => 0;
    try {
      const r = await runMeasuredTrial({
        participantCount: 6, seed: 9001, targetRounds: 2,
        resolveElimination, judgePure, computePlayerStatuses, PLAYER_STATUS, maxLoserCountFor, vi,
      });
      expect(r.completed).toBe(true);
      expect(r.correctnessPass).toBe(true);
    } finally {
      Math.random = realRandom;
    }
  }, 15000);

  it('[allDraw baseline, out-of-order] N={3,5,8,12,16,20} 각 100 trial: REAL isStaleRoomRow/WRPS-079/WRPS-081 가드가 재정렬된 room-row 배달에서도 correctnessPass를 유지하는가 — 새 desync 유무를 correctness 채널로 판정(결함이면 열거만, 여기서 고치지 않음)', async () => {
    const NS = [3, 5, 8, 12, 16, 20];
    const TRIALS_PER_N = 100;
    const realRandom = Math.random;
    Math.random = () => 0;
    const summary = [];
    try {
      for (const n of NS) {
        let correctnessPassCount = 0;
        const hardFailureModeCounts = {};
        const sampleHardFailures = [];
        for (let s = 0; s < TRIALS_PER_N; s++) {
          const seed = n * 5100000 + s;
          // eslint-disable-next-line no-await-in-loop
          const r = await runMeasuredTrial({
            participantCount: n, seed, targetRounds: DEFAULT_TARGET_ROUNDS,
            resolveElimination, judgePure, computePlayerStatuses, PLAYER_STATUS, maxLoserCountFor, vi,
            deliveryOrderMode: 'outOfOrder',
          });
          if (r.correctnessPass) correctnessPassCount++;
          for (const f of r.hardFailureModes) {
            hardFailureModeCounts[f.type] = (hardFailureModeCounts[f.type] || 0) + 1;
            if (sampleHardFailures.length < 10) sampleHardFailures.push({ seed, n, ...f });
          }
        }
        summary.push({ n, trials: TRIALS_PER_N, correctnessPassCount, correctnessPassRate: correctnessPassCount / TRIALS_PER_N, hardFailureModeCounts, sampleHardFailures });
      }
    } finally {
      Math.random = realRandom;
    }
    // eslint-disable-next-line no-console
    console.log('[STOP-SHIP Part A][allDraw, out-of-order] N별 correctnessPassRate + hardFailureModeCounts:', JSON.stringify(
      summary.map((s) => ({ n: s.n, trials: s.trials, correctnessPassRate: Number(s.correctnessPassRate.toFixed(3)), hardFailureModeCounts: s.hardFailureModeCounts })),
      null, 2
    ));
    for (const s of summary) {
      if (s.correctnessPassRate < 1) {
        // eslint-disable-next-line no-console
        console.log(`[STOP-SHIP Part A] N=${s.n} correctnessPassRate<100%(out-of-order) — 실패 전수 열거(sample):`, JSON.stringify(s.sampleHardFailures, null, 2));
      }
    }
    // 하니스 자체 결함(EXCEPTION)만은 이 모드에서도 0이어야 한다(있으면 측정 자체가 무효 — 이
    // deliveryOrderMode 확장 자체가 새 미처리 예외를 던지지 않는지 확인).
    for (const s of summary) {
      expect(s.hardFailureModeCounts.EXCEPTION || 0).toBe(0);
    }
    expect(summary.length).toBe(NS.length);
  }, 400000);

  it('[EG 혼합(mixed) 선택, out-of-order] N={3,8,16} 각 40 trial(targetLoserCount=2): 재정렬된 배달 아래서도 CROSS_DEVICE_OUTCOME_MISMATCH/STALE_ROW_REGRESSION 등 EG 하드 실패 채널이 새로 발화하는지 측정(결함이면 열거만)', async () => {
    const NS = [3, 8, 16];
    const TRIALS_PER_N = 40;
    const summary = [];
    for (const n of NS) {
      let correctnessPassCount = 0;
      const hardFailureModeCounts = {};
      const sampleHardFailures = [];
      for (let s = 0; s < TRIALS_PER_N; s++) {
        const seed = n * 5200000 + s;
        // eslint-disable-next-line no-await-in-loop
        const r = await runEliminationTrial({
          participantCount: n, seed, targetLoserCount: 2,
          resolveElimination, judgePure, computePlayerStatuses, PLAYER_STATUS, maxLoserCountFor, vi,
          deliveryOrderMode: 'outOfOrder',
        });
        if (r.correctnessPass) correctnessPassCount++;
        for (const f of r.hardFailureModes) {
          hardFailureModeCounts[f.type] = (hardFailureModeCounts[f.type] || 0) + 1;
          if (sampleHardFailures.length < 10) sampleHardFailures.push({ seed, n, ...f });
        }
      }
      summary.push({ n, trials: TRIALS_PER_N, correctnessPassCount, correctnessPassRate: correctnessPassCount / TRIALS_PER_N, hardFailureModeCounts, sampleHardFailures });
    }
    // eslint-disable-next-line no-console
    console.log('[STOP-SHIP Part A][EG mixed, out-of-order] N별 correctnessPassRate + hardFailureModeCounts:', JSON.stringify(
      summary.map((s) => ({ n: s.n, trials: s.trials, correctnessPassRate: Number(s.correctnessPassRate.toFixed(3)), hardFailureModeCounts: s.hardFailureModeCounts })),
      null, 2
    ));
    for (const s of summary) {
      if (s.correctnessPassRate < 1) {
        // eslint-disable-next-line no-console
        console.log(`[STOP-SHIP Part A][EG] N=${s.n} correctnessPassRate<100%(out-of-order) — 실패 전수 열거(sample):`, JSON.stringify(s.sampleHardFailures, null, 2));
      }
    }
    for (const s of summary) {
      expect(s.hardFailureModeCounts.EXCEPTION || 0).toBe(0);
    }
    expect(summary.length).toBe(NS.length);
  }, 400000);
});

// ════════════════════════════════════════════════════════════════════════════
// STOP-SHIP Part B: 기기별 비대칭 clock skew 주입 — ON_TIME_CONCURRENCY_EXCEEDED 활성화.
//
// critic B의 지적(§rc3-harness-support.mjs ON_TIME_CONCURRENCY_EXCEEDED 문서 참고): 기존
// mutation(computeChoiceRemainingSeconds 앵커 제거/lead 축소류)은 combinedSourceOverride로 "전
// 기기 동일 소스"를 바꾸는 방식이라, on-time으로 분류된 기기들끼리는 여전히 같은(깨진) 공식으로
// 수렴해 상대 스프레드 자체가 벌어지지 않는다 — 그래서 이 지표는 구조적으로 트립 불가였다.
// 이 구간은 두 가지를 함께 바꾼다: (1) createAlternatingSkewFn으로 기기 절반은 +스프레드, 절반은
// -스프레드로 결정론적으로 이분화된 skew를 주입하고, (2) waitForPhaseRender의 REAL 두 줄
// (index.html ~5295/~5300, waitMs/lateRenderMs 계산)에서 serverNow()(RC-1 clock-sync 보정을 거친
// 값)를 Date.now()(env.Date.now() — 보정되지 않은, skew가 그대로 남은 값)로 치환하는 REAL 텍스트
// mutation을 적용한다. mutation이 없으면(baseline) 비대칭 skew가 있어도 syncServerClock()의
// serverNow() 보정이 각 기기의 skew를 흡수해 on-time 코호트끼리는 여전히 clock-sync 잔차(≤1500ms)
// 안에 머문다 — mutation이 그 보정 자체를 우회하게 만들면, 기기마다 다른(비대칭) skew가 그대로
// waitMs/lateRenderMs 계산에 새어 들어가 on-time 코호트의 렌더 스프레드가 실제로
// ON_TIME_CONCURRENCY_CEILING_MS(3000ms)를 넘을 수 있다 — 이게 "구조적으로 트립 불가"였던 채널을
// 실제로 살리는 최소 개입이다(§본문 acceptance: baseline은 상한 이내, mutation은 실제 트립).
describe('STOP-SHIP Part B: 기기별 비대칭 skew — ON_TIME_CONCURRENCY_EXCEEDED 활성화', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date(1_800_000_000_000)); });
  afterEach(() => { vi.useRealTimers(); });

  it('mutation 소스가 실제로 REAL waitForPhaseRender의 serverNow() 두 곳을 Date.now()로 치환한다(치환 자체가 성립하는지 sanity)', () => {
    const brokenSource = EXTRACTED_COMBINED_SOURCE
      .replace(
        'const waitMs = scheduledAt ? Math.max(0, scheduledAt - serverNow()) : 0;',
        'const waitMs = scheduledAt ? Math.max(0, scheduledAt - Date.now()) : 0; /* MUTATION(STOP-SHIP Part B): clock-sync 보정 우회 */'
      )
      .replace(
        'const lateRenderMs = scheduledAt ? Math.max(0, serverNow() - scheduledAt) : 0;',
        'const lateRenderMs = scheduledAt ? Math.max(0, Date.now() - scheduledAt) : 0; /* MUTATION(STOP-SHIP Part B) */'
      );
    expect(brokenSource).not.toBe(EXTRACTED_COMBINED_SOURCE);
    expect(brokenSource.includes('MUTATION(STOP-SHIP Part B)')).toBe(true);
  });

  it('[baseline, REAL 무수정] N={3,6,10,14,20} 각 100 trial(alternating skew ±5000ms): on-time 코호트 스프레드가 ON_TIME_CONCURRENCY_CEILING_MS(3000ms) 이내로 유지된다(syncServerClock() 보정이 비대칭 skew를 흡수) — correctnessPass도 baseline 수준 유지', async () => {
    const NS = [3, 6, 10, 14, 20];
    const TRIALS_PER_N = 100;
    const skewMsOverrideFn = createAlternatingSkewFn(5000);
    const realRandom = Math.random;
    Math.random = () => 0;
    const summary = [];
    try {
      for (const n of NS) {
        let correctnessPassCount = 0;
        let onTimeConcurrencyExceededCount = 0;
        const sampleViolations = [];
        for (let s = 0; s < TRIALS_PER_N; s++) {
          const seed = n * 6100000 + s;
          // eslint-disable-next-line no-await-in-loop
          const r = await runMeasuredTrial({
            participantCount: n, seed, targetRounds: DEFAULT_TARGET_ROUNDS,
            resolveElimination, judgePure, computePlayerStatuses, PLAYER_STATUS, maxLoserCountFor, vi,
            skewMsOverrideFn,
          });
          if (r.correctnessPass) correctnessPassCount++;
          if (!r.onTimeConcurrencyPass) {
            onTimeConcurrencyExceededCount++;
            if (sampleViolations.length < 5) sampleViolations.push({ seed, violations: r.onTimeConcurrencyViolations });
          }
        }
        summary.push({
          n, trials: TRIALS_PER_N,
          correctnessPassRate: correctnessPassCount / TRIALS_PER_N,
          onTimeConcurrencyExceededCount, sampleViolations,
        });
      }
    } finally {
      Math.random = realRandom;
    }
    // eslint-disable-next-line no-console
    console.log('[STOP-SHIP Part B][baseline, alternating skew ±5000ms] N별 correctnessPassRate + ON_TIME_CONCURRENCY_EXCEEDED count:', JSON.stringify(
      summary.map((s) => ({ n: s.n, correctnessPassRate: Number(s.correctnessPassRate.toFixed(3)), onTimeConcurrencyExceededCount: s.onTimeConcurrencyExceededCount })),
      null, 2
    ));
    expect(summary.length).toBe(NS.length);
    for (const s of summary) {
      // [범주1] correctness는 skew 자체와 무관하다 — clock-sync 보정이 정상 동작하면 스프레드에
      // 영향이 없어야 한다.
      expect(s.correctnessPassRate).toBeGreaterThanOrEqual(0.99);
      // acceptance(§본문): baseline(REAL, 무수정)은 이 비대칭 skew 아래서도 상한 이내 유지 —
      // 트립이 있더라도 드물어야 한다(완전 0을 강제하면 clock-sync 잔차(≤1500ms×2=3000ms 경계
      // 근접) 자체의 자연 변동에 과민해질 수 있어 5% 여유를 둔다).
      expect(s.onTimeConcurrencyExceededCount / TRIALS_PER_N).toBeLessThanOrEqual(0.05);
    }
  }, 400000);

  it('[mutation, 반공허성] 위와 같은 alternating skew ±5000ms + waitForPhaseRender의 clock-sync 보정 우회 mutation을 함께 적용하면 N={3,6,10,14,20} 각 100 trial에서 ON_TIME_CONCURRENCY_EXCEEDED가 실제로(유의미한 빈도로) 트립된다 — 이 채널이 이제 "구조적으로 죽은 코드"가 아니라는 직접 증거. 동시에 correctnessPass([범주1])는 baseline과 거의 동일하게 유지되는지도 확인한다(순수 타이밍/스케줄링 mutation이지 correctness 회귀가 아님, 과민 재발 금지 원칙 준수)', async () => {
    const NS = [3, 6, 10, 14, 20];
    const TRIALS_PER_N = 100;
    const skewMsOverrideFn = createAlternatingSkewFn(5000);
    const brokenSource = EXTRACTED_COMBINED_SOURCE
      .replace(
        'const waitMs = scheduledAt ? Math.max(0, scheduledAt - serverNow()) : 0;',
        'const waitMs = scheduledAt ? Math.max(0, scheduledAt - Date.now()) : 0; /* MUTATION(STOP-SHIP Part B): clock-sync 보정 우회 */'
      )
      .replace(
        'const lateRenderMs = scheduledAt ? Math.max(0, serverNow() - scheduledAt) : 0;',
        'const lateRenderMs = scheduledAt ? Math.max(0, Date.now() - scheduledAt) : 0; /* MUTATION(STOP-SHIP Part B) */'
      );
    expect(brokenSource).not.toBe(EXTRACTED_COMBINED_SOURCE);
    const realRandom = Math.random;
    Math.random = () => 0;
    const summary = [];
    let totalExceeded = 0;
    let totalTrials = 0;
    try {
      for (const n of NS) {
        let correctnessPassCount = 0;
        let onTimeConcurrencyExceededCount = 0;
        for (let s = 0; s < TRIALS_PER_N; s++) {
          const seed = n * 6200000 + s;
          totalTrials++;
          // eslint-disable-next-line no-await-in-loop
          const r = await runMeasuredTrial({
            participantCount: n, seed, targetRounds: DEFAULT_TARGET_ROUNDS,
            resolveElimination, judgePure, computePlayerStatuses, PLAYER_STATUS, maxLoserCountFor, vi,
            skewMsOverrideFn, combinedSourceOverride: brokenSource,
          });
          if (r.correctnessPass) correctnessPassCount++;
          if (!r.onTimeConcurrencyPass) { onTimeConcurrencyExceededCount++; totalExceeded++; }
        }
        summary.push({
          n, trials: TRIALS_PER_N,
          correctnessPassRate: correctnessPassCount / TRIALS_PER_N,
          onTimeConcurrencyExceededCount, onTimeConcurrencyExceededRate: onTimeConcurrencyExceededCount / TRIALS_PER_N,
        });
      }
    } finally {
      Math.random = realRandom;
    }
    // eslint-disable-next-line no-console
    console.log('[STOP-SHIP Part B][mutation, alternating skew ±5000ms + clock-sync 보정 우회] N별 correctnessPassRate + ON_TIME_CONCURRENCY_EXCEEDED rate:', JSON.stringify(
      summary.map((s) => ({ n: s.n, correctnessPassRate: Number(s.correctnessPassRate.toFixed(3)), onTimeConcurrencyExceededRate: Number(s.onTimeConcurrencyExceededRate.toFixed(3)) })),
      null, 2
    ));
    // 핵심 단정(mutation 부하검증, 반공허성): 이 채널이 실제로 트립 가능해야 한다 — 전체 trial의
    // 상당수(≥30%)에서 ON_TIME_CONCURRENCY_EXCEEDED가 관측되어야 baseline의 "≤5%"가 이 mutation
    // 덕분에 대비된다고 주장할 수 있다(임의의 낮은 빈도라면 "구조적으로 죽은 코드"라는 원 지적이
    // 여전히 유효할 수 있으므로 넉넉한 문턱을 둔다).
    expect(totalExceeded / totalTrials).toBeGreaterThanOrEqual(0.3);
    for (const s of summary) {
      // correctnessPass([범주1])는 이 순수 타이밍 mutation으로 오염되지 않아야 한다(과민 재발 금지).
      expect(s.correctnessPassRate).toBeGreaterThanOrEqual(0.99);
    }
  }, 400000);
});

// ════════════════════════════════════════════════════════════════════════════
// STOP-SHIP Part C: 다양 targetLoserCount 스윕.
//
// 기존 EG 스윕(§Phase1/2 COVERAGE, §Phase3 SWEEP, WRPS-079 넓은 회귀 스윕)은 전부
// targetLoserCount=2로 고정돼 있었다(§본문 실측 근거: N에 비례한 target은 대N에서 균등 랜덤
// 선택 모델과 결합하면 수렴이 지나치게 느려짐). 이 구간은 그 축을 스윕한다 — tooMany/tooFew/
// gameOver 분기 비율이 targetLoserCount에 따라 달라지므로 각 config에서 correctnessPass를
// 별도로 측정한다. §Part D의 "결정적 choice 모델"(pickDecisiveChoiceBase)을 함께 써서 큰
// targetLoserCount·큰 N 조합에서도 유한 예산 안에 gameOver에 안정적으로 도달하게 한다(§Part D
// 문서 참고 — 균등 랜덤 모델을 그대로 썼다면 이 스윕 자체가 STALL 아티팩트에 오염됐을 것이다).
describe('STOP-SHIP Part C: 다양 targetLoserCount 스윕(1, 2, N-비례) — 결정적 choice 모델', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date(1_800_000_000_000)); });
  afterEach(() => { vi.useRealTimers(); });

  it('N={3,5,8,12,16,20} × targetLoserCount∈{1,2,floor(N/2)} 각 60 trial(decisive choice 모델): config별 correctnessPass + outcome 분포(tooMany/tooFew/gameOver 비율이 targetLoserCount에 따라 실제로 달라지는지) 측정', async () => {
    const NS = [3, 5, 8, 12, 16, 20];
    const LOSER_CONFIGS = [
      { label: 'fixed1', fn: () => 1 },
      { label: 'fixed2', fn: (n) => Math.min(2, maxLoserCountFor(n)) },
      { label: 'nProportionalHalf', fn: (n) => Math.max(1, Math.min(maxLoserCountFor(n), Math.floor(n / 2))) },
    ];
    const TRIALS_PER_CELL = 60;
    const surface = [];
    for (const n of NS) {
      for (const cfg of LOSER_CONFIGS) {
        const targetLoserCount = cfg.fn(n);
        let correctnessPassCount = 0;
        const outcomeTotals = {};
        const hardFailureModeCounts = {};
        const sampleHardFailures = [];
        for (let s = 0; s < TRIALS_PER_CELL; s++) {
          const seed = n * 7100000 + cfg.label.length * 131 + s;
          // eslint-disable-next-line no-await-in-loop
          const r = await runEliminationTrial({
            participantCount: n, seed, targetLoserCount,
            resolveElimination, judgePure, computePlayerStatuses, PLAYER_STATUS, maxLoserCountFor, vi,
            choiceDriverFactory: createDecisiveChoiceDriver,
          });
          if (r.correctnessPass) correctnessPassCount++;
          for (const [outcome, count] of Object.entries(r.outcomeCounts)) {
            outcomeTotals[outcome] = (outcomeTotals[outcome] || 0) + count;
          }
          for (const f of r.hardFailureModes) {
            hardFailureModeCounts[f.type] = (hardFailureModeCounts[f.type] || 0) + 1;
            if (sampleHardFailures.length < 6) sampleHardFailures.push({ seed, n, targetLoserCount, ...f });
          }
        }
        surface.push({
          n, targetLoserCountLabel: cfg.label, targetLoserCount, trials: TRIALS_PER_CELL,
          correctnessPassRate: correctnessPassCount / TRIALS_PER_CELL,
          outcomeTotals, hardFailureModeCounts, sampleHardFailures,
        });
      }
    }
    // eslint-disable-next-line no-console
    console.log('[STOP-SHIP Part C] N × targetLoserCount config별 correctnessPassRate + outcome 분포:', JSON.stringify(
      surface.map((c) => ({
        n: c.n, targetLoserCount: c.targetLoserCount, label: c.targetLoserCountLabel,
        correctnessPassRate: Number(c.correctnessPassRate.toFixed(3)), outcomeTotals: c.outcomeTotals,
        hardFailureModeCounts: c.hardFailureModeCounts,
      })),
      null, 2
    ));
    for (const c of surface) {
      if (c.correctnessPassRate < 1) {
        // eslint-disable-next-line no-console
        console.log(`[STOP-SHIP Part C] N=${c.n} targetLoserCount=${c.targetLoserCount}(${c.targetLoserCountLabel}) correctnessPassRate<100% — 실패 전수 열거(sample):`, JSON.stringify(c.sampleHardFailures, null, 2));
      }
    }
    expect(surface.length).toBe(NS.length * LOSER_CONFIGS.length);
    // 하니스 자체 결함(EXCEPTION)만은 config와 무관하게 0이어야 한다.
    for (const c of surface) {
      expect(c.hardFailureModeCounts.EXCEPTION || 0).toBe(0);
    }
  }, 600000);
});

// ════════════════════════════════════════════════════════════════════════════
// STOP-SHIP Part D: 종합 correctnessPass 측정(N=3..20, 98% 게이트).
//
// §근거(결정적 choice 모델 채택 이유, 위 rc3-harness-support.mjs pickDecisiveChoiceBase 정의부
// 참고): 균등 3종 랜덤(pickMixedChoiceBase)은 N이 클수록 judgePure의 "3종류가 다 나오면 draw"
// 규칙 때문에 allDraw로 수렴해, 유한 라운드 예산 안에 gameOver에 못 닿는 STALL이 "진짜 멈춤"과
// "그냥 안 끝남"으로 뒤섞인다(§EG Phase3 SWEEP 로그의 N=20 STALL 샘플이 실제로 이 현상 — 전부
// status:'playing'/'ready'에서 예산 소진, EXCEPTION/오판정 없음). pickDecisiveChoiceBase(rock/
// scissors 두 종류만 사용)는 이 아티팩트를 구조적으로 없앤다 — 매 라운드 draw 확률이 활성인원
// 수에 지수적으로 감소하므로(2×0.5^m) 오히려 N이 클수록 더 빨리 결판난다. 아래 타이밍 캘리브레이션
// (사전 실측, 이 파일에는 남기지 않음)으로 N=20/targetLoserCount=2에서도 평균 10라운드 안팎,
// 기본 예산(maxRounds=max(30,N*6), budgetMsPerRound=20000)을 전혀 위협하지 않음을 확인했다 — 그래서
// 이 스윕에서 STALL이 나오면 그건 "budget 내 미완주"가 아니라 "결판 났는데도 실제로 멈췄다"는
// 강한 신호로 해석해도 된다(§본문 요구사항 그대로).
//
// §7 한계(정직 명시): host-handover 시나리오는 이번 라운드에서 구현하지 않았다 — 실제 host
// 승계(transferHostAndLeave/becomeNextHost)는 fetchParticipants() 폴링 함수(index.html ~6066,
// Part A와 동일 사유로 미추출) 안에서 감지·처리되는데, 그 함수 전체(cleanupDuplicateRoomProfiles/
// destroyRoomAndGoHome/beginNewGameRound 등과 강결합)를 새로 추출하지 않고는 "다른 기기가 실제로
// host 권한과 함께 rooms.update 쓰기 권한을 이어받는" 전이를 이 하니스의 "host 단일 writer" 불변식
// (§createDb 상단 주석) 안에서 충실히 재현할 수 없다 — 얕은 모조(mock)로 구색만 맞추면 §no-op mock
// 금지 원칙을 어기게 되므로, 이번 측정에서는 이 시나리오를 아예 뺀다(§보고 5절에 명시적 gap으로
// 기록, 고치지 않고 후속 위임으로 남긴다).
describe('STOP-SHIP Part D: 종합 correctnessPass 측정(N=3..20, decisive 모델, 98% 게이트)', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date(1_800_000_000_000)); });
  afterEach(() => { vi.useRealTimers(); });

  it('[헤드라인] N=3..20 전체(18개) 각 150 trial(pessimistic, targetLoserCount=2, decisive choice 모델): N별 correctnessPass% + 98% 게이트 충족 여부 + STALL을 "결판났는데 멈춤"(실결함) vs "budget 내 미완주"(측정한계)로 구분', async () => {
    const NS = Array.from({ length: 18 }, (_, i) => i + 3); // 3..20
    const TRIALS_PER_N = 150;
    const summary = [];
    for (const n of NS) {
      let correctnessPassCount = 0;
      let completedCount = 0;
      const hardFailureModeCounts = {};
      const sampleHardFailures = [];
      const stallDetails = [];
      for (let s = 0; s < TRIALS_PER_N; s++) {
        const seed = n * 8100000 + s;
        // eslint-disable-next-line no-await-in-loop
        const r = await runEliminationTrial({
          participantCount: n, seed, targetLoserCount: 2,
          resolveElimination, judgePure, computePlayerStatuses, PLAYER_STATUS, maxLoserCountFor, vi,
          choiceDriverFactory: createDecisiveChoiceDriver,
        });
        if (r.completed) completedCount++;
        if (r.correctnessPass) correctnessPassCount++;
        for (const f of r.hardFailureModes) {
          hardFailureModeCounts[f.type] = (hardFailureModeCounts[f.type] || 0) + 1;
          if (f.type === 'STALL') stallDetails.push({ seed, finalRound: r.finalRound, detail: f.detail });
          if (sampleHardFailures.length < 8) sampleHardFailures.push({ seed, n, ...f });
        }
      }
      summary.push({
        n, trials: TRIALS_PER_N, completedCount, correctnessPassCount,
        correctnessPassRate: correctnessPassCount / TRIALS_PER_N,
        hardFailureModeCounts, sampleHardFailures, stallDetails,
      });
    }
    // eslint-disable-next-line no-console
    console.log('[STOP-SHIP Part D][헤드라인] N=3..20 × 150 trial(decisive, pessimistic, targetLoserCount=2) correctnessPassRate:', JSON.stringify(
      summary.map((s) => ({
        n: s.n, trials: s.trials, completedCount: s.completedCount,
        correctnessPassRate: Number(s.correctnessPassRate.toFixed(4)),
        meetsGate98: s.correctnessPassRate >= 0.98,
        hardFailureModeCounts: s.hardFailureModeCounts,
      })),
      null, 2
    ));
    for (const s of summary) {
      if (s.correctnessPassRate < 1) {
        // eslint-disable-next-line no-console
        console.log(`[STOP-SHIP Part D] N=${s.n} correctnessPassRate<100% — 실패 전수 열거(sample, STALL 상세 포함):`, JSON.stringify({ sampleHardFailures: s.sampleHardFailures, stallDetails: s.stallDetails }, null, 2));
      }
    }
    // 측정 무효화 방지: 하니스 자체 결함(EXCEPTION)은 0이어야 한다.
    for (const s of summary) {
      expect(s.hardFailureModeCounts.EXCEPTION || 0).toBe(0);
    }
    expect(summary.length).toBe(18);
    // 98% 게이트 자체를 하드 assert하지는 않는다(§본문 지시: "결함이면 열거만, 고치지 않는다" —
    // 이 스윕의 목적은 "98%를 강제로 통과시키는 것"이 아니라 "실제로 98% 이상인지, 아니면
    // STALL이 진짜 결함으로 나오는지"를 정직하게 측정해 보고하는 것이다). 게이트 판정 자체는
    // 위 console.log의 meetsGate98과 §보고 4절 헤드라인 숫자로 한다.
  }, 600000);

  it('[레짐 × targetLoserCount 교차] N={3,6,10,14,20} × {optimistic,moderate,pessimistic} × targetLoserCount∈{1,2,floor(N/2)} 각 50 trial(decisive 모델): correctnessPass가 레짐/구성 전반에서 일관되는지 교차 확인(레짐은 지연 종속 [범주2]에만 영향, correctness는 지연 독립이어야 한다는 §RC-3 taxonomy 수렴 가설의 EG 확장 재확인)', async () => {
    const NS = [3, 6, 10, 14, 20];
    const REGIMES = ['optimistic', 'moderate', 'pessimistic'];
    const LOSER_CONFIGS = [
      { label: 'fixed1', fn: () => 1 },
      { label: 'fixed2', fn: (n) => Math.min(2, maxLoserCountFor(n)) },
      { label: 'nProportionalHalf', fn: (n) => Math.max(1, Math.min(maxLoserCountFor(n), Math.floor(n / 2))) },
    ];
    const TRIALS_PER_CELL = 50;
    const surface = [];
    let totalTrials = 0;
    let totalPass = 0;
    let totalException = 0;
    for (const regime of REGIMES) {
      for (const n of NS) {
        for (const cfg of LOSER_CONFIGS) {
          const targetLoserCount = cfg.fn(n);
          let correctnessPassCount = 0;
          const hardFailureModeCounts = {};
          for (let s = 0; s < TRIALS_PER_CELL; s++) {
            const seed = n * 8200000 + regime.length * 97 + cfg.label.length * 131 + s;
            totalTrials++;
            // eslint-disable-next-line no-await-in-loop
            const r = await runEliminationTrial({
              participantCount: n, seed, targetLoserCount,
              resolveElimination, judgePure, computePlayerStatuses, PLAYER_STATUS, maxLoserCountFor, vi,
              choiceDriverFactory: createDecisiveChoiceDriver, realtimeDelayRegime: regime,
            });
            if (r.correctnessPass) { correctnessPassCount++; totalPass++; }
            for (const f of r.hardFailureModes) {
              hardFailureModeCounts[f.type] = (hardFailureModeCounts[f.type] || 0) + 1;
              if (f.type === 'EXCEPTION') totalException++;
            }
          }
          surface.push({
            regime, n, targetLoserCount, label: cfg.label, trials: TRIALS_PER_CELL,
            correctnessPassRate: correctnessPassCount / TRIALS_PER_CELL, hardFailureModeCounts,
          });
        }
      }
    }
    // eslint-disable-next-line no-console
    console.log(`[STOP-SHIP Part D][레짐×targetLoserCount 교차] ${totalTrials} trial 종합: correctnessPassRate=${(totalPass / totalTrials).toFixed(4)}`);
    for (const c of surface) {
      if (c.correctnessPassRate < 1) {
        // eslint-disable-next-line no-console
        console.log(`[STOP-SHIP Part D][교차] regime=${c.regime} N=${c.n} targetLoserCount=${c.targetLoserCount}(${c.label}) correctnessPassRate=${c.correctnessPassRate.toFixed(3)} hardFailureModeCounts:`, JSON.stringify(c.hardFailureModeCounts, null, 2));
      }
    }
    expect(surface.length).toBe(REGIMES.length * NS.length * LOSER_CONFIGS.length);
    expect(totalException).toBe(0);
  }, 600000);
});

// ════════════════════════════════════════════════════════════════════════════
// STOP-SHIP Phase0~3: 2.6초 REST 폴링 채널 충실 모델링 + Part D/Part A/98% 재측정.
//
// 조사 결과 요약(§본문 지시): 지금까지(위 Part A/Part D 전부)의 하니스는 REAL
// subscribeToRoom(index.html 5578-5590)의 2.6초 폴링 백업을 단 한 번도 모델링하지 않았다 —
// Part A의 deliveryOrderMode:'outOfOrder'는 "폴링이 있으면 재정렬이 생길 수 있다"는 위협 모델을
// realtime 전송 계층 자체에서 일반화한 프록시("모든 realtime 배달을 재정렬")였을 뿐, 실제 이중
// 경로(정상 순서보장 realtime + 완전히 독립된 2.6초 REST 폴링)를 재현하지 않았다. 이 프록시가 실제
// 빈도를 과장하는지(모든 커밋을 재정렬하는 것 vs 폴링이 어쩌다 stale snapshot을 늦게 배달하는 것은
// 전혀 다른 발생률일 수 있다), 그리고 Part D 헤드라인 스윕의 산발적 STALL/오라클 mismatch가
// 이 미모델링된 폴링 채널의 부재로 생긴 하니스 아티팩트인지(폴링이 있었으면 참가자가 5초 window
// 안에 최신 상태를 인지해 사라졌을 것인지)를 이 섹션이 재측정한다.
//
// Phase0(아래 §Phase0)은 위 rc3-harness-support.mjs의 startDevicePolling/createDevice/
// createTrialWorld/runMeasuredTrial/runEliminationTrial에 추가된 pollingEnabled 옵션(기본값
// false — 회귀 없음)의 충실성을 원문 대조로 재확인한다. Phase1~3(§Phase1/§Phase2/§Phase3)이 실제
// 재측정이다.
describe('STOP-SHIP Phase0: 2.6초 REST 폴링 채널 모델 충실성(fidelity)', () => {
  it('폴링 모델의 주기 상수(REAL_POLL_INTERVAL_MS=2600)가 index.html의 실제 setInterval(...,2600) 호출과 바이트 동일하다', () => {
    expect(REAL_POLL_INTERVAL_MS).toBe(2600);
    const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
    // REAL 폴링 백업 자체(순서: rooms select → fetchParticipants → handleRoomUpdate(room), 주기
    // 2600ms)가 여전히 index.html에 그대로 있는지 원문으로 재확인한다(하니스가 실존하지 않는 코드를
    // 모델링하는 것을 방지).
    expect(html.includes("const { data: room } = await db.from('rooms').select('*').eq('id', roomCode).single();")).toBe(true);
    expect(html.includes('await fetchParticipants(roomCode);')).toBe(true);
    expect(html.includes('if (room) await handleRoomUpdate(room);')).toBe(true);
    expect(html.includes('}, 2600);')).toBe(true);
  });

  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date(1_800_000_000_000)); });
  afterEach(() => { vi.useRealTimers(); });

  it('sanity: pollingEnabled 미지정(기본값 false)은 기존 동작과 완전히 동일하다(회귀 없음 — 옵션 추가 자체가 기존 시드 결과를 바꾸지 않는지 확인)', async () => {
    const realRandom = Math.random;
    Math.random = () => 0;
    try {
      const r = await runMeasuredTrial({
        participantCount: 6, seed: 9001, targetRounds: 2,
        resolveElimination, judgePure, computePlayerStatuses, PLAYER_STATUS, maxLoserCountFor, vi,
      });
      expect(r.completed).toBe(true);
      expect(r.correctnessPass).toBe(true);
    } finally {
      Math.random = realRandom;
    }
  }, 15000);

  it('sanity: pollingEnabled:true는 실제로 REAL handleRoomUpdate를 폴링 경로로도 구동한다(POLL_TICK_THREW 없이, 정상 완주) — no-op이 아니라는 직접 증거', async () => {
    const realRandom = Math.random;
    Math.random = () => 0;
    try {
      const r = await runMeasuredTrial({
        participantCount: 6, seed: 9001, targetRounds: 3,
        resolveElimination, judgePure, computePlayerStatuses, PLAYER_STATUS, maxLoserCountFor, vi,
        pollingEnabled: true,
      });
      expect(r.completed).toBe(true);
      // 폴링 경로 자체가 예외 없이 동작했는지(POLL_TICK_THREW도 EXCEPTION으로 잡힌다).
      expect(r.hardFailureModes.filter((f) => f.type === 'EXCEPTION').length).toBe(0);
      // 트라이얼 전체 경과(3라운드, pessimistic 기본 레짐)가 최소 1회의 poll tick(2600ms)이
      // 지나갈 만큼 길었는지 sanity(폴링이 아예 발화하지 않는 무의미한 트라이얼이 아니었는지) —
      // r.elapsed는 clock-sync 대기 포함 누적 fake-time.
      expect(r.elapsed).toBeGreaterThan(2600);
    } finally {
      Math.random = realRandom;
    }
  }, 15000);
});

// ────────────────────────────────────────────────────────────────────────────
// §Phase1: Part D 재측정(아티팩트 확정) — N=14 seed=114801883(및 인근)을 폴링 OFF/ON 양쪽으로
// 재실행해 p4(host 관점) 오라클 mismatch/STALL이 폴링을 켜면 사라지는지 확인한다. 사라지면 "폴링
// 부재로 인해 참가자가 최신 상태를 인지하지 못해 생긴 하니스 아티팩트"라는 가설이 최종 확정되고,
// 사라지지 않으면(같은 seed에서 여전히 재현) 하니스 아티팩트가 아니라 재분석이 필요한 신호다.
// "및 인근"은 118011883 근방 10개 연속 seed(114801883..114801892)로 배치 재현해 단일 seed의
// 우연(clock-sync 타이밍 등)이 아닌지 함께 확인한다. targetLoserCount=2/decisive choice 모델은
// Part D 헤드라인 스윕과 동일 구성(같은 실패가 재현되는지 보려면 같은 조건이어야 한다).
describe('STOP-SHIP §Phase1: Part D 재측정(N=14 seed=114801883 및 인근, 폴링 OFF vs ON)', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date(1_800_000_000_000)); });
  afterEach(() => { vi.useRealTimers(); });

  it('[재현 배치] N=14, seed=114801883..114801892(10개): 폴링 OFF/ON 각각 correctnessPass + hardFailureModes 전수 기록 — OFF에서 재현되던 실패가 ON에서 사라지는지 대조', async () => {
    const N = 14;
    const SEEDS = Array.from({ length: 10 }, (_, i) => 114801883 + i);
    async function runBatch(pollingEnabled) {
      const rows = [];
      for (const seed of SEEDS) {
        // eslint-disable-next-line no-await-in-loop
        const r = await runEliminationTrial({
          participantCount: N, seed, targetLoserCount: 2,
          resolveElimination, judgePure, computePlayerStatuses, PLAYER_STATUS, maxLoserCountFor, vi,
          choiceDriverFactory: createDecisiveChoiceDriver,
          pollingEnabled,
        });
        rows.push({
          seed, completed: r.completed, correctnessPass: r.correctnessPass, finalRound: r.finalRound,
          hardFailureModes: r.hardFailureModes.map((f) => ({ type: f.type, detail: f.detail, round: f.round })),
        });
      }
      return rows;
    }
    const offRows = await runBatch(false);
    const onRows = await runBatch(true);
    // eslint-disable-next-line no-console
    console.log('[STOP-SHIP §Phase1][폴링 OFF] N=14 seed=114801883..92 결과:', JSON.stringify(offRows, null, 2));
    // eslint-disable-next-line no-console
    console.log('[STOP-SHIP §Phase1][폴링 ON] N=14 seed=114801883..92 결과:', JSON.stringify(onRows, null, 2));
    const offFailSeeds = offRows.filter((r) => !r.correctnessPass).map((r) => r.seed);
    const onFailSeeds = onRows.filter((r) => !r.correctnessPass).map((r) => r.seed);
    const healedByPolling = offFailSeeds.filter((s) => !onFailSeeds.includes(s));
    const stillFailingWithPolling = offFailSeeds.filter((s) => onFailSeeds.includes(s));
    const newFailuresWithPolling = onFailSeeds.filter((s) => !offFailSeeds.includes(s));
    // eslint-disable-next-line no-console
    console.log('[STOP-SHIP §Phase1] 요약: offFailSeeds=', offFailSeeds, 'onFailSeeds=', onFailSeeds,
      'healedByPolling(아티팩트 확정 후보)=', healedByPolling,
      'stillFailingWithPolling(진짜 결함 후보)=', stillFailingWithPolling,
      'newFailuresWithPolling(폴링이 새로 유발한 실패, 있으면 안 됨)=', newFailuresWithPolling);
    // 하니스 자체 결함(EXCEPTION)만은 폴링 ON/OFF 무관하게 0이어야 한다(있으면 이 측정 자체가 무효).
    expect(offRows.every((r) => !r.hardFailureModes.some((f) => f.type === 'EXCEPTION'))).toBe(true);
    expect(onRows.every((r) => !r.hardFailureModes.some((f) => f.type === 'EXCEPTION'))).toBe(true);
    // 게이트 자체는 하드 assert하지 않는다(§본문 지시: 확정은 보고에서, 여기서는 측정만) — 위
    // console.log의 healedByPolling/stillFailingWithPolling이 §보고 2절 "p4 소멸 여부" 판정 근거다.
    expect(offRows.length).toBe(SEEDS.length);
    expect(onRows.length).toBe(SEEDS.length);
  }, 300000);

  it('[헤드라인 재현 폭 확인] N=14, 헤드라인과 동일 seed 공식(n*8100000+s, s=0..149) 150 trial: 폴링 OFF/ON 각각 correctnessPassRate + STALL/오라클mismatch 상세(§Part D 헤드라인 재현 seed 공간과의 관계 확인용)', async () => {
    const N = 14;
    const TRIALS = 150;
    async function runSweep(pollingEnabled) {
      let correctnessPassCount = 0;
      const hardFailureModeCounts = {};
      const sampleHardFailures = [];
      const stallDetails = [];
      for (let s = 0; s < TRIALS; s++) {
        const seed = N * 8100000 + s;
        // eslint-disable-next-line no-await-in-loop
        const r = await runEliminationTrial({
          participantCount: N, seed, targetLoserCount: 2,
          resolveElimination, judgePure, computePlayerStatuses, PLAYER_STATUS, maxLoserCountFor, vi,
          choiceDriverFactory: createDecisiveChoiceDriver,
          pollingEnabled,
        });
        if (r.correctnessPass) correctnessPassCount++;
        for (const f of r.hardFailureModes) {
          hardFailureModeCounts[f.type] = (hardFailureModeCounts[f.type] || 0) + 1;
          if (f.type === 'STALL') stallDetails.push({ seed, finalRound: r.finalRound, detail: f.detail });
          if (sampleHardFailures.length < 12) sampleHardFailures.push({ seed, ...f });
        }
      }
      return { correctnessPassRate: correctnessPassCount / TRIALS, hardFailureModeCounts, sampleHardFailures, stallDetails };
    }
    const off = await runSweep(false);
    const on = await runSweep(true);
    // eslint-disable-next-line no-console
    console.log('[STOP-SHIP §Phase1][헤드라인 seed공간, 폴링 OFF] N=14 150 trial:', JSON.stringify(
      { correctnessPassRate: Number(off.correctnessPassRate.toFixed(4)), hardFailureModeCounts: off.hardFailureModeCounts }, null, 2));
    // eslint-disable-next-line no-console
    console.log('[STOP-SHIP §Phase1][헤드라인 seed공간, 폴링 ON] N=14 150 trial:', JSON.stringify(
      { correctnessPassRate: Number(on.correctnessPassRate.toFixed(4)), hardFailureModeCounts: on.hardFailureModeCounts }, null, 2));
    if (off.correctnessPassRate < 1) {
      // eslint-disable-next-line no-console
      console.log('[STOP-SHIP §Phase1][OFF] 실패 전수(sample):', JSON.stringify({ sampleHardFailures: off.sampleHardFailures, stallDetails: off.stallDetails }, null, 2));
    }
    if (on.correctnessPassRate < 1) {
      // eslint-disable-next-line no-console
      console.log('[STOP-SHIP §Phase1][ON] 실패 전수(sample):', JSON.stringify({ sampleHardFailures: on.sampleHardFailures, stallDetails: on.stallDetails }, null, 2));
    }
    expect(off.hardFailureModeCounts.EXCEPTION || 0).toBe(0);
    expect(on.hardFailureModeCounts.EXCEPTION || 0).toBe(0);
  }, 600000);
});

// ────────────────────────────────────────────────────────────────────────────
// §Phase2: Part A 진짜 빈도 재측정 — "모든 realtime 재정렬"(deliveryOrderMode:'outOfOrder') 대신
// 실제 이중경로(realtime는 정상 순서보장 그대로 + 독립 2.6초 폴링만 추가)에서
// ROUND_NOT_MONOTONIC/DOUBLE_COUNTDOWN_RENDER 등이 실제로 얼마나 트립되는지 측정한다.
// deliveryOrderMode는 기본값('monotonic', realtime 순서보장 유지)으로 두고 pollingEnabled만 켠다 —
// 이게 "폴링이 stale rooms row를 newer realtime 뒤에 전달하는 자연스러운 빈도"를 재현하는
// 유일한 조합이다(outOfOrder는 realtime 자체를 재정렬하므로 이 측정과는 다른 스트레스 모드).
//
// §진단(1차 실집행 후 telemetry 직접 대조로 확인, "결함이면 열거만" 원칙에 따라 여기서 고치지는
// 않음): 아래 실측된 ROUND_NOT_MONOTONIC/DOUBLE_COUNTDOWN_RENDER는 항상 같은 패턴이다 — 한 기기가
// 이미 여러 라운드를 더 지나(예: round 1 countdown/result까지 렌더된 뒤) round=1의 countdown을
// "완전히 동일한 serverScheduledTs"로 다시 렌더한다(관측된 lateRenderMs가 수 초~10초대로 튐).
// isStaleRoomRow 가드(index.html handleRoomUpdate)는 room.penalty에 인코딩된 **gameRound**(게임
// 회차)만 비교한다 — 이 allDraw/decisive 트라이얼처럼 "같은 게임 안에서 5라운드가 진행"되는
// 동안에는 gameRound가 시종일관 1로 고정되므로, gameRound 기준 stale 검사는 이 시나리오에서 항상
// 무의미하게 통과한다(같은 게임의 더 오래된 **round**를 걸러내는 별도 가드는 존재하지 않는다).
// 폴링은 db.from('rooms').select(...)을 realtime 큐와 무관하게 직접 호출하므로, 이 select의 REST
// 지연(pessimistic 레짐 꼬리 최대 ~9000ms)이 큰 tick에서는 "select를 보낸 시점"의 오래된 room
// 스냅샷이 "resolve된 시점"(이미 여러 라운드가 realtime으로 더 진행된 뒤)에 뒤늦게 도착해
// handleRoomUpdate로 그대로 들어간다 — REAL 코드에는 이를 걸러낼 라운드-레벨 가드가 없으므로 이미
// 렌더된 라운드의 countdown이 그대로 재실행된다(§보고 3절 severity 재평가의 핵심 근거).
describe('STOP-SHIP §Phase2: Part A 진짜 이중경로(realtime 순서보장 + 독립 2.6초 폴링) 빈도 재측정', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date(1_800_000_000_000)); });
  afterEach(() => { vi.useRealTimers(); });

  it('[allDraw baseline, 실제 이중경로] N=3..20 각 60 trial: correctnessPassRate + ROUND_NOT_MONOTONIC/DOUBLE_COUNTDOWN_RENDER/STALE_ROW_REGRESSION 개별 트립 횟수(정직한 실빈도, "모든 재정렬" 프록시 아님)', async () => {
    const NS = Array.from({ length: 18 }, (_, i) => i + 3); // 3..20
    const TRIALS_PER_N = 60;
    const realRandom = Math.random;
    Math.random = () => 0;
    const summary = [];
    try {
      for (const n of NS) {
        let correctnessPassCount = 0;
        const hardFailureModeCounts = {};
        const sampleHardFailures = [];
        for (let s = 0; s < TRIALS_PER_N; s++) {
          const seed = n * 5300000 + s;
          // eslint-disable-next-line no-await-in-loop
          const r = await runMeasuredTrial({
            participantCount: n, seed, targetRounds: DEFAULT_TARGET_ROUNDS,
            resolveElimination, judgePure, computePlayerStatuses, PLAYER_STATUS, maxLoserCountFor, vi,
            pollingEnabled: true,
          });
          if (r.correctnessPass) correctnessPassCount++;
          for (const f of r.hardFailureModes) {
            hardFailureModeCounts[f.type] = (hardFailureModeCounts[f.type] || 0) + 1;
            if (sampleHardFailures.length < 10) sampleHardFailures.push({ seed, n, ...f });
          }
        }
        summary.push({
          n, trials: TRIALS_PER_N, correctnessPassCount, correctnessPassRate: correctnessPassCount / TRIALS_PER_N,
          hardFailureModeCounts, sampleHardFailures,
        });
      }
    } finally {
      Math.random = realRandom;
    }
    const totalTrials = NS.length * TRIALS_PER_N;
    const totalRoundNotMonotonic = summary.reduce((a, s) => a + (s.hardFailureModeCounts.ROUND_NOT_MONOTONIC || 0), 0);
    const totalDoubleCountdown = summary.reduce((a, s) => a + (s.hardFailureModeCounts.DOUBLE_COUNTDOWN_RENDER || 0), 0);
    const totalStaleRowRegression = summary.reduce((a, s) => a + (s.hardFailureModeCounts.STALE_ROW_REGRESSION || 0), 0);
    // eslint-disable-next-line no-console
    console.log('[STOP-SHIP §Phase2][allDraw, 실제 이중경로] N별 correctnessPassRate + hardFailureModeCounts:', JSON.stringify(
      summary.map((s) => ({ n: s.n, trials: s.trials, correctnessPassRate: Number(s.correctnessPassRate.toFixed(3)), hardFailureModeCounts: s.hardFailureModeCounts })),
      null, 2
    ));
    // eslint-disable-next-line no-console
    console.log(`[STOP-SHIP §Phase2][allDraw, 실제 이중경로] 종합(${totalTrials} trial): ROUND_NOT_MONOTONIC=${totalRoundNotMonotonic}(rate=${(totalRoundNotMonotonic / totalTrials).toFixed(4)}), DOUBLE_COUNTDOWN_RENDER=${totalDoubleCountdown}(rate=${(totalDoubleCountdown / totalTrials).toFixed(4)}), STALE_ROW_REGRESSION=${totalStaleRowRegression}(rate=${(totalStaleRowRegression / totalTrials).toFixed(4)})`);
    for (const s of summary) {
      if (s.correctnessPassRate < 1) {
        // eslint-disable-next-line no-console
        console.log(`[STOP-SHIP §Phase2] N=${s.n} correctnessPassRate<100%(실제 이중경로) — 실패 전수 열거(sample):`, JSON.stringify(s.sampleHardFailures, null, 2));
      }
    }
    // 하니스 자체 결함(EXCEPTION)만은 이 모드에서도 0이어야 한다.
    for (const s of summary) {
      expect(s.hardFailureModeCounts.EXCEPTION || 0).toBe(0);
    }
    expect(summary.length).toBe(NS.length);
  }, 600000);

  it('[EG decisive 모델, 실제 이중경로] N=3..20 각 30 trial(targetLoserCount=2): CROSS_DEVICE_OUTCOME_MISMATCH/ROUND_NOT_MONOTONIC/DOUBLE_COUNTDOWN_RENDER/STALE_ROW_REGRESSION 실빈도(§Part D 헤드라인과 동일 구성 + 실제 이중경로 결합)', async () => {
    const NS = Array.from({ length: 18 }, (_, i) => i + 3); // 3..20
    const TRIALS_PER_N = 30;
    const summary = [];
    for (const n of NS) {
      let correctnessPassCount = 0;
      const hardFailureModeCounts = {};
      const sampleHardFailures = [];
      for (let s = 0; s < TRIALS_PER_N; s++) {
        const seed = n * 5400000 + s;
        // eslint-disable-next-line no-await-in-loop
        const r = await runEliminationTrial({
          participantCount: n, seed, targetLoserCount: 2,
          resolveElimination, judgePure, computePlayerStatuses, PLAYER_STATUS, maxLoserCountFor, vi,
          choiceDriverFactory: createDecisiveChoiceDriver,
          pollingEnabled: true,
        });
        if (r.correctnessPass) correctnessPassCount++;
        for (const f of r.hardFailureModes) {
          hardFailureModeCounts[f.type] = (hardFailureModeCounts[f.type] || 0) + 1;
          if (sampleHardFailures.length < 10) sampleHardFailures.push({ seed, n, ...f });
        }
      }
      summary.push({
        n, trials: TRIALS_PER_N, correctnessPassCount, correctnessPassRate: correctnessPassCount / TRIALS_PER_N,
        hardFailureModeCounts, sampleHardFailures,
      });
    }
    const totalTrials = NS.length * TRIALS_PER_N;
    const totalRoundNotMonotonic = summary.reduce((a, s) => a + (s.hardFailureModeCounts.ROUND_NOT_MONOTONIC || 0), 0);
    const totalDoubleCountdown = summary.reduce((a, s) => a + (s.hardFailureModeCounts.DOUBLE_COUNTDOWN_RENDER || 0), 0);
    const totalCrossDeviceMismatch = summary.reduce((a, s) => a + (s.hardFailureModeCounts.CROSS_DEVICE_OUTCOME_MISMATCH || 0), 0);
    const totalStaleRowRegression = summary.reduce((a, s) => a + (s.hardFailureModeCounts.STALE_ROW_REGRESSION || 0), 0);
    // eslint-disable-next-line no-console
    console.log('[STOP-SHIP §Phase2][EG decisive, 실제 이중경로] N별 correctnessPassRate + hardFailureModeCounts:', JSON.stringify(
      summary.map((s) => ({ n: s.n, trials: s.trials, correctnessPassRate: Number(s.correctnessPassRate.toFixed(3)), hardFailureModeCounts: s.hardFailureModeCounts })),
      null, 2
    ));
    // eslint-disable-next-line no-console
    console.log(`[STOP-SHIP §Phase2][EG decisive, 실제 이중경로] 종합(${totalTrials} trial): ROUND_NOT_MONOTONIC=${totalRoundNotMonotonic}(rate=${(totalRoundNotMonotonic / totalTrials).toFixed(4)}), DOUBLE_COUNTDOWN_RENDER=${totalDoubleCountdown}(rate=${(totalDoubleCountdown / totalTrials).toFixed(4)}), CROSS_DEVICE_OUTCOME_MISMATCH=${totalCrossDeviceMismatch}(rate=${(totalCrossDeviceMismatch / totalTrials).toFixed(4)}), STALE_ROW_REGRESSION=${totalStaleRowRegression}(rate=${(totalStaleRowRegression / totalTrials).toFixed(4)})`);
    for (const s of summary) {
      if (s.correctnessPassRate < 1) {
        // eslint-disable-next-line no-console
        console.log(`[STOP-SHIP §Phase2][EG] N=${s.n} correctnessPassRate<100%(실제 이중경로) — 실패 전수 열거(sample):`, JSON.stringify(s.sampleHardFailures, null, 2));
      }
    }
    for (const s of summary) {
      expect(s.hardFailureModeCounts.EXCEPTION || 0).toBe(0);
    }
    expect(summary.length).toBe(NS.length);
  }, 600000);
});

// ────────────────────────────────────────────────────────────────────────────
// STOP-SHIP 게이팅 테스트(하드 assert, Phase3 지시사항 #4): 위 §Phase2 두 테스트는 카운트를
// console.log로만 보고하고(정보용) EXCEPTION만 하드 assert한다 — "결함이면 열거만" 원칙 때문에
// 의도적으로 그렇게 설계되었다. 이 테스트는 그와 별개로, isStaleRoomRow의 라운드/phase 레벨
// staleness 가드(§본문 수정)가 실제로 회귀하면 CI가 RED로 잡아내도록 ROUND_NOT_MONOTONIC/
// DOUBLE_COUNTDOWN_RENDER/STALE_ROW_REGRESSION을 하드 assert(=== 0)한다.
// 수정 전(isStaleRoomRow가 gameRound 축만 비교)에는 이 테스트가 FAIL했다 — allDraw baseline만도
// N=3..20 각 15 trial에서 매 N마다 최소 1건 이상의 ROUND_NOT_MONOTONIC/DOUBLE_COUNTDOWN_RENDER가
// 트립됐다(§보고 Phase0/Phase3 실측). 수정 후에는 allDraw baseline(1080 trial)과 EG decisive
// 혼합선택(540 trial) 양쪽 모두에서 0건으로 확인됐다(§보고 Phase3 §Phase2 재측정 표 참고) — 여기서는
// 그 회귀 감시를 더 빠른 예산(N당 15 trial, allDraw + decisive 둘 다)으로 상시 CI에 남긴다.
describe('STOP-SHIP §Phase2 게이팅(하드 assert): 라운드/phase-레벨 staleness 가드 회귀 감시', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date(1_800_000_000_000)); });
  afterEach(() => { vi.useRealTimers(); });

  it('[allDraw baseline, 실제 이중경로, 하드 게이트] N=3..20 각 15 trial: ROUND_NOT_MONOTONIC/DOUBLE_COUNTDOWN_RENDER/STALE_ROW_REGRESSION은 항상 0이어야 한다', async () => {
    const NS = Array.from({ length: 18 }, (_, i) => i + 3); // 3..20
    const TRIALS_PER_N = 15;
    const realRandom = Math.random;
    Math.random = () => 0;
    const allFailures = [];
    try {
      for (const n of NS) {
        for (let s = 0; s < TRIALS_PER_N; s++) {
          const seed = n * 6100000 + s;
          // eslint-disable-next-line no-await-in-loop
          const r = await runMeasuredTrial({
            participantCount: n, seed, targetRounds: DEFAULT_TARGET_ROUNDS,
            resolveElimination, judgePure, computePlayerStatuses, PLAYER_STATUS, maxLoserCountFor, vi,
            pollingEnabled: true,
          });
          for (const f of r.hardFailureModes) {
            if (['ROUND_NOT_MONOTONIC', 'DOUBLE_COUNTDOWN_RENDER', 'STALE_ROW_REGRESSION'].includes(f.type)) {
              allFailures.push({ seed, n, ...f });
            }
          }
        }
      }
    } finally {
      Math.random = realRandom;
    }
    if (allFailures.length) {
      // eslint-disable-next-line no-console
      console.log('[STOP-SHIP §Phase2 게이팅][allDraw] 회귀 검출:', JSON.stringify(allFailures, null, 2));
    }
    expect(allFailures).toEqual([]);
  }, 300000);

  it('[EG decisive 모델, 실제 이중경로, 하드 게이트] N=3..20 각 15 trial(targetLoserCount=2): ROUND_NOT_MONOTONIC/DOUBLE_COUNTDOWN_RENDER/STALE_ROW_REGRESSION/CROSS_DEVICE_OUTCOME_MISMATCH은 항상 0이어야 한다', async () => {
    const NS = Array.from({ length: 18 }, (_, i) => i + 3); // 3..20
    const TRIALS_PER_N = 15;
    const allFailures = [];
    for (const n of NS) {
      for (let s = 0; s < TRIALS_PER_N; s++) {
        const seed = n * 6200000 + s;
        // eslint-disable-next-line no-await-in-loop
        const r = await runEliminationTrial({
          participantCount: n, seed, targetLoserCount: 2,
          resolveElimination, judgePure, computePlayerStatuses, PLAYER_STATUS, maxLoserCountFor, vi,
          choiceDriverFactory: createDecisiveChoiceDriver,
          pollingEnabled: true,
        });
        for (const f of r.hardFailureModes) {
          if (['ROUND_NOT_MONOTONIC', 'DOUBLE_COUNTDOWN_RENDER', 'STALE_ROW_REGRESSION', 'CROSS_DEVICE_OUTCOME_MISMATCH'].includes(f.type)) {
            allFailures.push({ seed, n, ...f });
          }
        }
      }
    }
    if (allFailures.length) {
      // eslint-disable-next-line no-console
      console.log('[STOP-SHIP §Phase2 게이팅][EG decisive] 회귀 검출:', JSON.stringify(allFailures, null, 2));
    }
    expect(allFailures).toEqual([]);
  }, 300000);
});

// ────────────────────────────────────────────────────────────────────────────
// STOP-SHIP 3차 재설계(Review Correction Loop) 게이팅: isStaleRoomRow를 "status를 하나씩 나열하는
// 허용/차단목록"에서 "진행 중인 라운드의 4단계(playing/result/game_over/stats)에만 staleness
// 비교를 적용하고, 그 외 모든 status(reinviting/waiting/lobby/penalty_setting/미래의 새 status)는
// 두 축 모두 무조건 통과시킨다"는 원리적 분류로 교체했다(§index.html ACTIVE_ROUND_PHASE_ORDER).
// 이 describe 그룹은 그 재설계가 실제로 다음을 해소하는지 REAL 채널로 직접 검증한다:
//  1) CRITICAL-2(신규, 3차): inviteForReplay()의 round-불변 `{status:'reinviting'}`이 phase-축
//     `|| 0` 기본값 때문에 stats/game_over 뒤 stale로 오판되던 것.
//  2) CRITICAL-1(2차 잔존 회귀 감시): game_over→stats 정당 전이.
//  3) MEDIUM(1차 잔존 회귀 감시): requestReplayFromJoinedRoom()의 reinviting round=1 리셋.
//  4) render-desync 회복 게이트(ROUND_NOT_MONOTONIC/DOUBLE_COUNTDOWN_RENDER) 자체가 여전히
//     mutation에 민감한지(mutation-3, 완전 무력화 / ready-제외 두 변형).
//
// ⚠️ 정직 기록(codex-main 자가 발견, §회복-보존 실증): 직전(2차) 에이전트는 "허용목록 방식은
// nextRound()의 정상 'ready' 전이(그 round를 새로 여는 phase, 뒤이은 playing/result/game_over/
// stats와 같은 round 번호를 공유)를 잘못 배제해 render-desync 회복이 깨진다"고 기록했다. 이번
// 3차 재설계에서 이 주장을 재검증했다 — 'ready'를 ACTIVE_ROUND_PHASE_ORDER 밖으로 완전히 빼고(원
// STOP-SHIP 지시서의 문자 그대로의 스펙) 아래 "mutation-3b" 테스트를 실행하자 실제로
// ROUND_NOT_MONOTONIC/DOUBLE_COUNTDOWN_RENDER가 재현됐다(이 파일의 최종 코드에는 반영하지 않은
// 실험 결과, §STOP-SHIP 보고서 "회복 보존 실증" 절에 원문 로그 남김) — 그래서 이전 에이전트의
// 주장은 데이터로 확인됐고, index.html의 최종 ACTIVE_ROUND_PHASE_ORDER는 `ready: 0`을 포함한다.
// 다만 이번엔 "왜 안 되는지" 원인이 이전 기록보다 한 겹 더 정확하다 — 'ready'가 문제인 이유는
// "허용목록이라서"가 아니라, 'ready' 문자열이 진행 phase(nextRound)와 리셋 전이(goToReadyScreen/
// resetGameKeepRoom)를 모두 나타내는 오버로드된 상태라서 두 의미를 하나의 이름으로 구분할 수
// 없기 때문이다(그래서 "진행 phase만 통과 대상에서 제외"라는 이번 설계 원리 자체는 유지하되,
// 'ready'만 예외적으로 4단계 목록에 남긴다). 아래 mutation-3b가 이 트레이드오프를 회귀 테스트로
// 고정한다(index.html에서 `ready: 0,`을 지우면 이 테스트가 RED로 반응해야 한다).
describe('STOP-SHIP 3차 재설계 mutation: render-desync 회복 게이트(ROUND_NOT_MONOTONIC/DOUBLE_COUNTDOWN_RENDER) 무력화 재현', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date(1_800_000_000_000)); });
  afterEach(() => { vi.useRealTimers(); });

  it('[mutation-3a, 완전 무력화] round-축(isStaleRoundWithinGame)과 phase-축(isStaleStatusWithinRound)을 모두 false로 완전 무력화하면 N=5,10,16 각 10 trial(폴링 ON, 결정적 choice 모델)에서 ROUND_NOT_MONOTONIC/DOUBLE_COUNTDOWN_RENDER가 실제로 재현된다(render-desync 회복 게이트 자체의 mutation 민감도 증명)', async () => {
    const mutatedSource = EXTRACTED_COMBINED_SOURCE
      .replace(
        `      const isStaleRoundWithinGame = incomingGameRound > 0 && incomingRound > 0 &&
        incomingGameRound === state.gameRound && incomingRound < state.round &&
        isActiveRoundPhaseStatus(room.status);`,
        `      const isStaleRoundWithinGame = false; /* MUTATION 3a: round-축 완전 무력화 */`
      )
      .replace(
        `      const isStaleStatusWithinRound = incomingGameRound > 0 && incomingRound > 0 &&
        incomingGameRound === state.gameRound && incomingRound === state.round &&
        isActiveRoundPhaseStatus(room.status) && isActiveRoundPhaseStatus(state.status) &&
        getActiveRoundPhaseOrder(room.status) < getActiveRoundPhaseOrder(state.status);`,
        `      const isStaleStatusWithinRound = false; /* MUTATION 3a: phase-축 완전 무력화 */`
      );
    expect(mutatedSource).not.toBe(EXTRACTED_COMBINED_SOURCE);
    const NS = [5, 10, 16];
    const TRIALS_PER_N = 10;
    const allFailures = [];
    for (const n of NS) {
      for (let s = 0; s < TRIALS_PER_N; s++) {
        const seed = n * 9999000 + s;
        // eslint-disable-next-line no-await-in-loop
        const r = await runMeasuredTrial({
          participantCount: n, seed, targetRounds: DEFAULT_TARGET_ROUNDS,
          resolveElimination, judgePure, computePlayerStatuses, PLAYER_STATUS, maxLoserCountFor, vi,
          pollingEnabled: true, combinedSourceOverride: mutatedSource,
        });
        for (const f of r.hardFailureModes) {
          if (['ROUND_NOT_MONOTONIC', 'DOUBLE_COUNTDOWN_RENDER'].includes(f.type)) {
            allFailures.push({ seed, n, ...f });
          }
        }
      }
    }
    // eslint-disable-next-line no-console
    console.log('[mutation-3a] round+phase 축 완전 무력화 재현 건수:', allFailures.length, JSON.stringify(allFailures.slice(0, 5), null, 2));
    expect(allFailures.length).toBeGreaterThan(0);
  }, 300000);

  it("[mutation-3b, §회복-보존 실증 핵심] ACTIVE_ROUND_PHASE_ORDER에서 'ready: 0,' 항목 하나만 제거하면(그 외 4단계는 그대로) N=5,10,16 각 10 trial(폴링 ON)에서 ROUND_NOT_MONOTONIC/DOUBLE_COUNTDOWN_RENDER가 재현된다 — 이전 에이전트가 기록한 \"허용목록은 'ready'를 배제해 회복을 깬다\"는 주장을 이번 3차 재설계 위에서 데이터로 재확인한다(막연히 폐기하지 않고 직접 재현)", async () => {
    const mutatedSource = EXTRACTED_COMBINED_SOURCE.replace(
      `      const ACTIVE_ROUND_PHASE_ORDER = { ready: 0, playing: 1, result: 2, game_over: 3, stats: 4 };`,
      `      const ACTIVE_ROUND_PHASE_ORDER = { playing: 1, result: 2, game_over: 3, stats: 4 }; /* MUTATION 3b: ready 제외(원 지시서 리터럴 스펙) */`
    );
    expect(mutatedSource).not.toBe(EXTRACTED_COMBINED_SOURCE);
    const NS = [5, 10, 16];
    const TRIALS_PER_N = 10;
    const allFailures = [];
    for (const n of NS) {
      for (let s = 0; s < TRIALS_PER_N; s++) {
        const seed = n * 7777000 + s;
        // eslint-disable-next-line no-await-in-loop
        const r = await runMeasuredTrial({
          participantCount: n, seed, targetRounds: DEFAULT_TARGET_ROUNDS,
          resolveElimination, judgePure, computePlayerStatuses, PLAYER_STATUS, maxLoserCountFor, vi,
          pollingEnabled: true, combinedSourceOverride: mutatedSource,
        });
        for (const f of r.hardFailureModes) {
          if (['ROUND_NOT_MONOTONIC', 'DOUBLE_COUNTDOWN_RENDER'].includes(f.type)) {
            allFailures.push({ seed, n, ...f });
          }
        }
      }
    }
    // eslint-disable-next-line no-console
    console.log("[mutation-3b] 'ready' 단독 제외 재현 건수:", allFailures.length, JSON.stringify(allFailures.slice(0, 5), null, 2));
    expect(allFailures.length).toBeGreaterThan(0);
  }, 300000);
});

describe('STOP-SHIP 3차 재설계 게이팅(하드 assert): inviteForReplay reinviting(CRITICAL-2) / game_over→stats(CRITICAL-1) / reinviting round=1(MEDIUM)', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date(1_800_000_000_000)); });
  afterEach(() => { vi.useRealTimers(); });

  for (const fromStatus of ['game_over', 'stats']) {
    it(`[CRITICAL-2 회귀 감시, 무수정, from=${fromStatus}] inviteForReplay()의 round-불변 reinviting(직전 game_over/stats와 같은 round)은 stale로 막히지 않고 즉시 전원 reinviting에 도달한다(STALE_ROOM_UPDATE_SKIPPED 0건, self-heal 불필요)`, async () => {
      const r = await runInviteForReplayReinvitingScenario({
        resolveElimination, judgePure, computePlayerStatuses, PLAYER_STATUS, maxLoserCountFor, vi, fromStatus,
      });
      expect(r.clockSyncSettled).toBe(true);
      expect(r.gameOverSettled).toBe(true);
      expect(r.statsSettled).toBe(true);
      expect(r.reinvitingSettled).toBe(true); // 참가자가 실제로 'reinviting'에 도달(stall 없음)
      expect(r.victimStatusAfterReinviting).toBe('reinviting');
      expect(r.victimRoundAfterReinviting).toBe(3); // round-불변 리셋이므로 직전 round(3)가 그대로 남아야 정상
      // eslint-disable-next-line no-console
      console.log(`[CRITICAL-2 무수정, from=${fromStatus}]`, JSON.stringify({ staleSkipCountForReinviting: r.staleSkipCountForReinviting, selfHealCount: r.selfHealCount }));
      expect(r.staleSkipCountForReinviting).toBe(0);
      expect(r.selfHealCount).toBe(0);
    }, 60000);
  }

  it('[CRITICAL-2 재현, pre-fix mutation: phase-축 active-gating 제거] phase-축의 "양쪽 다 4단계 안에 있어야 비교한다"는 게이팅을 제거하고 예전처럼 `|| 0` 기본값으로 되돌리면, inviteForReplay()의 round-불변 reinviting이 stats 뒤에서 다시 stale로 오판되어 스킵되고(self-heal로만 뒤늦게 복구) CRITICAL-2가 재현된다', async () => {
    const mutatedSource = EXTRACTED_COMBINED_SOURCE.replace(
      `      const isStaleStatusWithinRound = incomingGameRound > 0 && incomingRound > 0 &&
        incomingGameRound === state.gameRound && incomingRound === state.round &&
        isActiveRoundPhaseStatus(room.status) && isActiveRoundPhaseStatus(state.status) &&
        getActiveRoundPhaseOrder(room.status) < getActiveRoundPhaseOrder(state.status);`,
      `      const isStaleStatusWithinRound = incomingGameRound > 0 && incomingRound > 0 &&
        incomingGameRound === state.gameRound && incomingRound === state.round &&
        (getActiveRoundPhaseOrder(room.status) || 0) < (getActiveRoundPhaseOrder(state.status) || 0); /* MUTATION(재설계 되돌림): active-gating 제거, 2차 스타일 OR-0 기본값 복원 */`
    );
    expect(mutatedSource).not.toBe(EXTRACTED_COMBINED_SOURCE);

    const r = await runInviteForReplayReinvitingScenario({
      resolveElimination, judgePure, computePlayerStatuses, PLAYER_STATUS, maxLoserCountFor, vi,
      fromStatus: 'stats', combinedSourceOverride: mutatedSource,
    });
    expect(r.clockSyncSettled).toBe(true);
    expect(r.gameOverSettled).toBe(true);
    expect(r.statsSettled).toBe(true);
    // self-heal이 결국 rescue하므로 완전 영구 정지는 아니다 — 그 rescue 자체가 회귀의 증거다.
    expect(r.reinvitingSettled).toBe(true);
    // eslint-disable-next-line no-console
    console.log('[CRITICAL-2 재현]', JSON.stringify({ staleSkipCountForReinviting: r.staleSkipCountForReinviting, selfHealCount: r.selfHealCount }));
    expect(r.staleSkipCountForReinviting).toBeGreaterThan(0); // pre-fix에서는 반드시 stale로 스킵됨
    expect(r.selfHealCount).toBeGreaterThan(0); // self-heal이 실제로 발동해야만 rescue됨
  }, 60000);

  it('[CRITICAL-1 회귀 감시, 무수정] game_over→stats 정당 전이는 stale로 막히지 않고 즉시 전원 stats에 도달한다(STALE_ROOM_UPDATE_SKIPPED 0건, self-heal 불필요)', async () => {
    const r = await runGameOverToStatsScenario({
      resolveElimination, judgePure, computePlayerStatuses, PLAYER_STATUS, maxLoserCountFor, vi,
    });
    expect(r.clockSyncSettled).toBe(true);
    expect(r.gameOverSettled).toBe(true);
    expect(r.statsSettled).toBe(true); // 참가자가 실제로 'stats'에 도달(stall 없음)
    expect(r.victimStatusAfterStats).toBe('stats');
    // eslint-disable-next-line no-console
    console.log('[CRITICAL-1 무수정]', JSON.stringify({ staleSkipCountForStats: r.staleSkipCountForStats, selfHealCount: r.selfHealCount }));
    expect(r.staleSkipCountForStats).toBe(0); // 정당 전이가 단 한 번도 stale로 스킵되지 않음
    expect(r.selfHealCount).toBe(0); // self-heal이 뚫어줄 필요 자체가 없음(즉시 정상 통과)
  }, 60000);

  // ⚠️ 정직 기록: 2차 재수정의 "[CRITICAL-1 재현, pre-fix mutation]"(ACTIVE_ROUND_PHASE_ORDER에서
  // 'stats'만 빼는 mutation)는 이번 3차 설계 위에서는 더 이상 회귀를 재현하지 못한다 — 직접
  // 실행해 확인했다: 'stats'가 목록에서 빠지면 isActiveRoundPhaseStatus(room.status==='stats')가
  // false가 되어 phase-축이 애초에 적용되지 않고(양쪽 다 활성 상태여야 비교하므로) 그냥
  // 통과한다(막지 않음) — 즉 이 설계에서는 "진행 phase를 목록에 등록하는 걸 깜빡함"이 더 이상
  // 오탐(false positive, 정당한 전이를 막음)으로 이어지지 않는다(최악의 경우 어떤 stale row를
  // 놓치는 방향으로만 실패한다). 그래서 CRITICAL-1류(진행 phase 등록 누락) 회귀를 다시 만들려면
  // "누락"이 아니라 "리셋 status를 실수로 4단계 목록에 넣는" 정반대 방향의 실수가 필요한데, 그건
  // 이 저장소에 그런 실수가 없어 인위적으로 mutation을 만들어야 하고 이 STOP-SHIP의 실제 회귀
  // 이력과 무관해진다 — 그래서 이 자리에는 남기지 않는다(허위로 "재현됨"을 주장하지 않기 위해
  // 정직하게 생략). 대신 위 [CRITICAL-2 재현] 테스트가 이 설계에서 실제로 유효한 "active-gating
  // 제거" mutation을 담당한다.

  it('[MEDIUM 회귀 감시, 무수정] round>1에서 끝난 게임에 대한 reinviting round=1 리셋은 stale로 막히지 않고 즉시 통과한다(STALE_ROOM_UPDATE_SKIPPED 0건, self-heal 불필요)', async () => {
    const r = await runReinvitingRoundResetScenario({
      resolveElimination, judgePure, computePlayerStatuses, PLAYER_STATUS, maxLoserCountFor, vi,
    });
    expect(r.clockSyncSettled).toBe(true);
    expect(r.round3Settled).toBe(true);
    expect(r.reinvitingSettled).toBe(true);
    expect(r.victimStatusAfterReinviting).toBe('reinviting');
    expect(r.victimRoundAfterReinviting).toBe(1); // round=1 리셋이 실제로 적용됨(막히지 않음)
    // eslint-disable-next-line no-console
    console.log('[MEDIUM 무수정]', JSON.stringify({ staleSkipCountForReinviting: r.staleSkipCountForReinviting, selfHealCount: r.selfHealCount }));
    expect(r.staleSkipCountForReinviting).toBe(0);
    expect(r.selfHealCount).toBe(0);
  }, 60000);

  it('[MEDIUM 재현, pre-fix mutation: round-축 active-gating 제거] round-축의 "진행 phase일 때만 적용한다"는 게이팅을 제거해 status와 무관하게 "round가 감소했는가"만 보게 되돌리면, reinviting round=1 리셋이 다시 stale로 오판되어 스킵되고(self-heal로만 뒤늦게 복구) 회귀가 재현된다', async () => {
    const mutatedSource = EXTRACTED_COMBINED_SOURCE.replace(
      `      const isStaleRoundWithinGame = incomingGameRound > 0 && incomingRound > 0 &&
        incomingGameRound === state.gameRound && incomingRound < state.round &&
        isActiveRoundPhaseStatus(room.status);`,
      `      const isStaleRoundWithinGame = incomingGameRound > 0 && incomingRound > 0 &&
        incomingGameRound === state.gameRound && incomingRound < state.round; /* MUTATION(재설계 되돌림): active-gating 제거 */`
    );
    expect(mutatedSource).not.toBe(EXTRACTED_COMBINED_SOURCE);

    const r = await runReinvitingRoundResetScenario({
      resolveElimination, judgePure, computePlayerStatuses, PLAYER_STATUS, maxLoserCountFor, vi,
      combinedSourceOverride: mutatedSource,
    });
    expect(r.clockSyncSettled).toBe(true);
    expect(r.round3Settled).toBe(true);
    expect(r.reinvitingSettled).toBe(true);
    // eslint-disable-next-line no-console
    console.log('[MEDIUM 재현]', JSON.stringify({ staleSkipCountForReinviting: r.staleSkipCountForReinviting, selfHealCount: r.selfHealCount }));
    expect(r.staleSkipCountForReinviting).toBeGreaterThan(0); // pre-fix에서는 반드시 stale로 스킵됨
    expect(r.selfHealCount).toBeGreaterThan(0); // self-heal이 실제로 발동해야만 rescue됨
  }, 60000);
});

// ────────────────────────────────────────────────────────────────────────────
// STOP-SHIP 3차 §LOW 문서화(도달 가능성 미확정, 원 보고 그대로 유지): goToReadyScreen()의
// round-불변 `{status:'ready'}`가 game_over/stats 뒤 같은 round로 도착하는 경우 — 'ready'가
// §회복-보존 실증(위 mutation-3b) 근거로 ACTIVE_ROUND_PHASE_ORDER에 남아있으므로, 이 경로는
// CRITICAL-2/MEDIUM과 달리 이번 재설계로 새로 안전해지지 않았다(여전히 stale로 막힌다). 이는
// 회귀가 아니라 재설계 이전과 동일한 기존 동작이 유지된 것이다 — 아래 테스트는 "새로 고쳐졌다"를
// 주장하지 않고 "현재 이렇게 동작하며, 그 이유(회복 보존 트레이드오프)가 무엇인지"를 감시·문서화
// 한다(이 하니스는 goToReadyScreen()이 실제로 이 상태에서 호출될 수 있는지 자체는 확정하지 못한다
// — DOM 네비게이션을 재현하지 않으므로, 도달 가능성은 원 보고와 동일하게 "미확정"으로 남긴다).
describe('STOP-SHIP 3차 §LOW 문서화: goToReadyScreen round-불변 ready (도달 가능성 미확정)', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date(1_800_000_000_000)); });
  afterEach(() => { vi.useRealTimers(); });

  for (const fromStatus of ['game_over', 'stats']) {
    it(`[문서화, from=${fromStatus}] goToReadyScreen()의 round-불변 ready는 'ready'가 여전히 ACTIVE_ROUND_PHASE_ORDER에 남아있어(§회복-보존 실증) stale로 막힌다 — 회귀 아님, 기존 동작 그대로(self-heal로 최종 rescue됨)`, async () => {
      const r = await runGoToReadyScreenRoundInvariantScenario({
        resolveElimination, judgePure, computePlayerStatuses, PLAYER_STATUS, maxLoserCountFor, vi, fromStatus,
      });
      expect(r.clockSyncSettled).toBe(true);
      expect(r.gameOverSettled).toBe(true);
      expect(r.statsSettled).toBe(true);
      expect(r.readySettled).toBe(true); // self-heal로 결국 rescue되어 stall이 영구화되지는 않음
      // eslint-disable-next-line no-console
      console.log(`[LOW 문서화, from=${fromStatus}]`, JSON.stringify({ staleSkipCountForReady: r.staleSkipCountForReady, selfHealCount: r.selfHealCount }));
      expect(r.staleSkipCountForReady).toBeGreaterThan(0); // 현재 설계에서는 여전히 최소 1회 이상 stale 스킵됨
      expect(r.selfHealCount).toBeGreaterThan(0);
    }, 60000);
  }
});

// ────────────────────────────────────────────────────────────────────────────
// §Phase3: 98% 헤드라인 폴링포함 재측정 — 결정적 choice 모델 + 폴링 ON(실제 이중경로 포함)으로
// N=3..20 종합 correctnessPass 재측정. Part D 헤드라인(§위 describe, 폴링 없음 150 trial)과 직접
// 비교 가능하도록 동일 구성(targetLoserCount=2, decisive 모델, pessimistic 레짐)을 쓰되, 트라이얼당
// 폴링 오버헤드(라운드마다 최대 몇 회의 추가 REST 왕복) 때문에 이 파일 전체 실행 시간 예산 안에서
// trial 수를 150→60으로 줄였다(§7에 명시 — 98%+ 판정에 필요한 통계적 신뢰도는 N당 60 trial로도
// ±estimate가 헤드라인과 같은 자리수로 유지된다, 완전한 150-trial 재현은 후속 위임으로 남긴다).
describe('STOP-SHIP §Phase3: 98% 헤드라인 폴링포함 재측정(N=3..20, decisive 모델, 실제 이중경로)', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date(1_800_000_000_000)); });
  afterEach(() => { vi.useRealTimers(); });

  it('[헤드라인, 폴링 ON] N=3..20 전체(18개) 각 60 trial(pessimistic, targetLoserCount=2, decisive choice 모델, 실제 이중경로): N별 correctnessPass% + 98% 게이트 충족 여부 — 폴링 없는 헤드라인(위 Part D) 대비 유지/하락 여부 판정', async () => {
    const NS = Array.from({ length: 18 }, (_, i) => i + 3); // 3..20
    const TRIALS_PER_N = 60;
    const summary = [];
    for (const n of NS) {
      let correctnessPassCount = 0;
      let completedCount = 0;
      const hardFailureModeCounts = {};
      const sampleHardFailures = [];
      const stallDetails = [];
      for (let s = 0; s < TRIALS_PER_N; s++) {
        const seed = n * 8300000 + s;
        // eslint-disable-next-line no-await-in-loop
        const r = await runEliminationTrial({
          participantCount: n, seed, targetLoserCount: 2,
          resolveElimination, judgePure, computePlayerStatuses, PLAYER_STATUS, maxLoserCountFor, vi,
          choiceDriverFactory: createDecisiveChoiceDriver,
          pollingEnabled: true,
        });
        if (r.completed) completedCount++;
        if (r.correctnessPass) correctnessPassCount++;
        for (const f of r.hardFailureModes) {
          hardFailureModeCounts[f.type] = (hardFailureModeCounts[f.type] || 0) + 1;
          if (f.type === 'STALL') stallDetails.push({ seed, finalRound: r.finalRound, detail: f.detail });
          if (sampleHardFailures.length < 8) sampleHardFailures.push({ seed, n, ...f });
        }
      }
      summary.push({
        n, trials: TRIALS_PER_N, completedCount, correctnessPassCount,
        correctnessPassRate: correctnessPassCount / TRIALS_PER_N,
        hardFailureModeCounts, sampleHardFailures, stallDetails,
      });
    }
    // eslint-disable-next-line no-console
    console.log('[STOP-SHIP §Phase3][헤드라인, 폴링 ON] N=3..20 × 60 trial(decisive, pessimistic, targetLoserCount=2, 실제 이중경로) correctnessPassRate:', JSON.stringify(
      summary.map((s) => ({
        n: s.n, trials: s.trials, completedCount: s.completedCount,
        correctnessPassRate: Number(s.correctnessPassRate.toFixed(4)),
        meetsGate98: s.correctnessPassRate >= 0.98,
        hardFailureModeCounts: s.hardFailureModeCounts,
      })),
      null, 2
    ));
    const totalTrials = NS.length * TRIALS_PER_N;
    const totalPass = summary.reduce((a, s) => a + s.correctnessPassCount, 0);
    // eslint-disable-next-line no-console
    console.log(`[STOP-SHIP §Phase3][헤드라인, 폴링 ON] 종합(${totalTrials} trial): correctnessPassRate=${(totalPass / totalTrials).toFixed(4)}, meetsGate98=${(totalPass / totalTrials) >= 0.98}`);
    for (const s of summary) {
      if (s.correctnessPassRate < 1) {
        // eslint-disable-next-line no-console
        console.log(`[STOP-SHIP §Phase3] N=${s.n} correctnessPassRate<100%(폴링 ON) — 실패 전수 열거(sample, STALL 상세 포함):`, JSON.stringify({ sampleHardFailures: s.sampleHardFailures, stallDetails: s.stallDetails }, null, 2));
      }
    }
    // 측정 무효화 방지: 하니스 자체 결함(EXCEPTION)은 0이어야 한다.
    for (const s of summary) {
      expect(s.hardFailureModeCounts.EXCEPTION || 0).toBe(0);
    }
    expect(summary.length).toBe(18);
    // 98% 게이트 자체를 하드 assert하지는 않는다(§본문 지시와 동일 원칙: "결함이면 열거만, 고치지
    // 않는다") — 판정은 위 console.log의 meetsGate98 + §보고 4절 헤드라인 숫자로 한다.
  }, 600000);
});
