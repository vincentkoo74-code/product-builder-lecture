import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  judgePure, resolveElimination, computePlayerStatuses, PLAYER_STATUS, maxLoserCountFor,
} from '../src/game-logic.mjs';
import {
  EXTRACTED_COMBINED_SOURCE, createDevice, createRoomStore, mulberry32,
  runRematchAdvanceRecoveryScenario, runMeasuredTrial,
} from './rc3-harness-support.mjs';

// ════════════════════════════════════════════════════════════════════════════
// H-1: rematch auto-advance의 REAL 5경로 모델링 검증(측정도구 자체의 충실성 테스트).
//
// index.html에서 scheduleRematchAutoAdvance()를 호출하는 지점은 정확히 5곳이다:
//   #1 :8636 finishRoundLocal allDraw 분기
//   #2 :8670 finishRoundLocal tooMany 분기(confirmedSafeIds 대입 :8664 직후)
//   #3 :8682 finishRoundLocal tooFew 분기(confirmedLoserIds 대입 :8672 직후)
//   #4 :9733 scheduleRematchAdvanceRetryAfterFailure(안전망 A) ← nextRound() catch(:9825)
//   #5 :9759 maybeRecoverStalledRematchAdvance(안전망 B) ← finishRoundLocal :8212
//      (idempotent 조기반환 :8188 안, 비-gameOver일 때만)
//
// H-1 이전 이 하니스는 #1~#3만 모델했고 #4/#5는 구조적으로 도달 불가였다:
//   #4 — fake db가 항상 { error: null }을 반환해 nextRound()의 error→throw 승격
//        (index.html:9789/9793/9797/9803)이 절대 발화하지 못했다.
//   #5 — finishRoundLocal 대체에 idempotency 캐시(state.lastRoundResolution)가 없어
//        REAL의 조기반환 조건(:8188)이 영원히 거짓이었다.
// 그 결과 duplicate 'result' 호출이 오면 REAL은 "재판정 없이 안전망 B로 복구"하는데 하니스는
// "매번 전량 재판정 + REAL 예산(MAX_REMATCH_ADVANCE_RETRIES)을 무시한 무제한 재예약"을 해서,
// REAL에 없는 재분류(phantom outcome)와 REAL에 있는 예산 소진 STALL의 은폐를 동시에 만들었다.
//
// 이 파일은 그 5경로가 실제로 발화하는지(테스트 1~5), 하니스가 여전히 진짜 STALL을 검출하는지
// (테스트 6), false STALL/재분류를 만들지 않는지(테스트 7), 무한 재시도가 불가능한지(테스트 8)를
// 실집행으로 확인하고, 각 모델링 요소를 mutation으로 떼어냈을 때 그 테스트가 실제로 RED가 되는지
// (mutation 1~4)까지 같이 고정한다(반공허성).
//
// index.html 무수정 원칙: mutation은 전부 EXTRACTED_COMBINED_SOURCE 문자열 치환 +
// combinedSourceOverride 주입(§rc3-multiparticipant-sim.test.mjs mutation-3a/3b와 동일 관례)이거나,
// 하니스 자체 요소에 대해서는 파라미터 토글(idempotencyCacheEnabled / dbErrorInjectionFn)이다.
// ════════════════════════════════════════════════════════════════════════════

// nextRound()의 최종 write(rooms.update({ round, status:'ready', penalty }))만 실패시키는 주입기 —
// vendored supabase-js v2의 실전 실패 모델({ error }로 resolve, reject 아님) 그대로다.
function makeNextRoundAdvanceFailureFn({ message = 'injected: nextRound rooms.advance failed' } = {}) {
  return ({ table, op, patch }) => (
    (table === 'rooms' && op === 'update' && patch && patch.status === 'ready')
      ? { message }
      : null
  );
}

// 각 참가자 row의 choice는 REAL encodeRoundChoice로 만든다(손으로 "rock|win" 문자열을 짜지 않음).
// ⚠️ 순서 주의: REAL clampLoserCount(index.html:4618)는 getMaxLoserCount()(=참가자 수 기반 상한)로
// 값을 자른다 — 참가자를 먼저 채워 넣지 않고 buildPenaltyValue를 부르면 loserCount:2가 1로
// 클램프돼 tooFew 시나리오가 조용히 gameOver로 바뀐다(실집행으로 발견).
function makeSoloHost({ targetLoserCount = 1, seed = 424242, rows }) {
  const roomStore = createRoomStore('ROOM-H1');
  const rng = mulberry32(seed);
  const device = createDevice({
    id: 'p0', isHost: true, roomStore, rng, participantCount: rows.length,
    resolveElimination, judgePure, computePlayerStatuses, PLAYER_STATUS, maxLoserCountFor, targetLoserCount,
  });
  device.impl.state.participants = rows.map((r) => ({
    id: r.id, choice: device.impl.encodeRoundChoice(r.base, r.result), wins: 0, losses: 0, draws: 0,
  }));
  // REAL getTargetLoserCount()는 parsePenalty(state.penalty).loserCount를 우선 읽으므로(단락평가),
  // REAL buildPenaltyValue로 인코딩한 penalty를 넣어준다(§createTrialWorld 접합부 ⓪-pre와 동일).
  device.impl.state.penalty = device.impl.buildPenaltyValue({ loserCount: targetLoserCount, gameRound: 1 });
  device.impl.state.status = 'result'; // REAL도 finishRoundLocal이 도는 시점의 status는 result다.
  device.impl.state.round = 1;
  device.impl.state.confirmedSafeIds = [];
  device.impl.state.confirmedLoserIds = [];
  return device;
}

describe('H-1 §정상 예약(경로 #1~#3): finishRoundLocal 본문 3분기가 실제로 scheduleRematchAutoAdvance를 건다', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date(1_800_000_000_000)); });
  afterEach(() => { vi.useRealTimers(); });

  it('[테스트1, 경로 #1 allDraw(index.html:8636)] 전원 draw면 allDraw로 확정되고 host에 auto-advance 타이머가 예약된다(+ idempotency 캐시 기록)', async () => {
    const device = makeSoloHost({
      targetLoserCount: 1,
      rows: [
        { id: 'p0', base: 'rock', result: 'draw' },
        { id: 'p1', base: 'rock', result: 'draw' },
        { id: 'p2', base: 'rock', result: 'draw' },
      ],
    });

    const res = await device.env.finishRoundLocal();

    expect(res.outcome).toBe('allDraw');
    expect(Boolean(device.impl.state.rematchAdvanceTimer)).toBe(true);
    // H-1: REAL recordRoundResolution(:8498-8505)과 동일하게 이 라운드의 판정이 캐시된다.
    expect(device.impl.state.lastRoundResolution).toBeTruthy();
    expect(device.impl.state.lastRoundResolution.eventId).toBe('1:1'); // getGameRound():state.round
    expect(device.impl.state.lastRoundResolution.outcome).toBe('allDraw');
  });

  it('[테스트2, 경로 #2 tooMany(index.html:8670)] 패자가 남은 슬롯보다 많으면 tooMany로 확정되고 auto-advance 타이머가 예약된다', async () => {
    const device = makeSoloHost({
      targetLoserCount: 1,
      rows: [
        { id: 'p0', base: 'rock', result: 'win' },
        { id: 'p1', base: 'scissors', result: 'lose' },
        { id: 'p2', base: 'scissors', result: 'lose' },
      ],
    });

    const res = await device.env.finishRoundLocal();

    expect(res.outcome).toBe('tooMany');
    // REAL tooMany 분기는 승자만 safe로 확정한다(index.html:8664) — 예약은 그 직후(:8670).
    expect([...device.impl.state.confirmedSafeIds]).toEqual(['p0']);
    expect(Boolean(device.impl.state.rematchAdvanceTimer)).toBe(true);
    expect(device.impl.state.lastRoundResolution.outcome).toBe('tooMany');
  });

  it('[테스트3, 경로 #3 tooFew(index.html:8682)] 패자가 남은 슬롯보다 적으면 tooFew로 확정되고 auto-advance 타이머가 예약된다', async () => {
    const device = makeSoloHost({
      targetLoserCount: 2,
      rows: [
        { id: 'p0', base: 'scissors', result: 'win' },
        { id: 'p1', base: 'scissors', result: 'win' },
        { id: 'p2', base: 'paper', result: 'lose' },
      ],
    });

    const res = await device.env.finishRoundLocal();

    expect(res.outcome).toBe('tooFew');
    // REAL tooFew 분기는 이번 라운드 패자만 loser로 확정한다(index.html:8672) — 예약은 그 직후(:8682).
    expect([...device.impl.state.confirmedLoserIds]).toEqual(['p2']);
    expect(Boolean(device.impl.state.rematchAdvanceTimer)).toBe(true);
    expect(device.impl.state.lastRoundResolution.outcome).toBe('tooFew');
  });

  it('[보강] gameOver 분기(index.html:8531-8593/8598-8618/8645-8662)는 REAL도 예약하지 않으므로 타이머가 생기지 않는다', async () => {
    const device = makeSoloHost({
      targetLoserCount: 1,
      rows: [
        { id: 'p0', base: 'rock', result: 'win' },
        { id: 'p1', base: 'rock', result: 'win' },
        { id: 'p2', base: 'scissors', result: 'lose' },
      ],
    });

    // gameOver 분기만은 대체 함수 안에서 REAL과 동일하게 rooms.update({status:'game_over'})를
    // await하므로(§makeFinishRoundLocalSubstitute), 가짜 타이머를 흘려보내며 기다려야 한다
    // (그냥 await하면 아무도 타이머를 진행시키지 못해 교착 — 이 저장소의 반복 함정).
    let res = null;
    let settled = false;
    device.env.finishRoundLocal().then((v) => { res = v; settled = true; }, () => { settled = true; });
    for (let elapsed = 0; elapsed < 5000 && !settled; elapsed += 250) {
      // eslint-disable-next-line no-await-in-loop
      await vi.advanceTimersByTimeAsync(250);
    }

    expect(settled).toBe(true);
    expect(res.outcome).toBe('gameOver');
    expect(Boolean(device.impl.state.rematchAdvanceTimer)).toBe(false);
  });
});

describe('H-1 §안전망 A(경로 #4, index.html:9733): nextRound() 실패 catch가 실제로 재예약한다', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date(1_800_000_000_000)); });
  afterEach(() => { vi.useRealTimers(); });

  it('[테스트4] DB write(rooms.update status:ready) 실패를 주입하면 REAL nextRound() catch(:9825) → scheduleRematchAdvanceRetryAfterFailure(:9717) → scheduleRematchAutoAdvance(backoff, :9733)가 실제로 발화한다', async () => {
    const r = await runRematchAdvanceRecoveryScenario({
      // JP-BL-027-D 이후 strict 가 기본값이지만, 이 시나리오는 정확한 필터가 **필수**이므로
      // 의도를 명시적으로 남긴다(기본값이 바뀌어도 이 테스트는 흔들리지 않는다).
      strictFilters: true,
      resolveElimination, judgePure, computePlayerStatuses, PLAYER_STATUS, maxLoserCountFor, vi,
      dbErrorInjectionFn: makeNextRoundAdvanceFailureFn(),
      simulateLostTimer: false, applyNextRoundMarkerWrites: false, deliverDuplicateEcho: false,
      preEchoDrainMs: 25000, settleBudgetMs: 45000,
    });

    // eslint-disable-next-line no-console
    console.log('[H-1 테스트4 안전망A]', JSON.stringify({
      firstOutcome: r.firstOutcome, timerAfterFirstResolution: r.timerAfterFirstResolution,
      nextRoundFailed: r.nextRoundFailedEvents.length,
      retryScheduled: r.retryScheduledEvents.map((e) => ({ retryCount: e.retryCount, backoffDelayMs: e.backoffDelayMs })),
      retryAttemptsBeforeEcho: r.retryAttemptsBeforeEcho, advanced: r.advancedToNextRound,
    }));
    expect(r.clockSyncSettled).toBe(true);
    expect(r.firstResolutionReached).toBe(true);
    expect(r.firstOutcome).toBe('tooMany');
    // 경로 #2(정상 예약)가 먼저 걸려 있어야 그 타이머가 발화해 nextRound()가 실제로 실패할 수 있다.
    expect(r.timerAfterFirstResolution).toBe(true);
    // 핵심 단정: REAL nextRound()의 error→throw 승격이 실제로 발화했고(주입 이전에는 dead였다),
    expect(r.nextRoundFailedEvents.length).toBeGreaterThan(0);
    // 그 catch가 안전망 A로 재예약했다(retryCount는 1부터 증가 — index.html:9731).
    expect(r.retryScheduledEvents.length).toBeGreaterThan(0);
    expect(r.retryScheduledEvents[0].retryCount).toBe(1);
    expect(r.retryScheduledEvents[0].backoffDelayMs).toBe(2000);
    // 안전망 A만이 카운터를 증가시킨다(index.html:9728).
    expect(r.retryAttemptsBeforeEcho).toBeGreaterThan(0);
  }, 120000);

  it("[mutation 1: 안전망 A 제거] scheduleRematchAdvanceRetryAfterFailure를 즉시 return으로 무력화하면 같은 실패 주입에서 재예약이 전혀 일어나지 않는다(테스트4가 RED가 된다)", async () => {
    const mutatedSource = EXTRACTED_COMBINED_SOURCE.replace(
      `    function scheduleRematchAdvanceRetryAfterFailure() {
      if (state.status !== "result") return;`,
      `    function scheduleRematchAdvanceRetryAfterFailure() {
      return; /* MUTATION H1-A: 안전망 A(재시도 재예약) 제거 */
      if (state.status !== "result") return;`
    );
    expect(mutatedSource).not.toBe(EXTRACTED_COMBINED_SOURCE);

    const r = await runRematchAdvanceRecoveryScenario({
      // JP-BL-027-D 이후 strict 가 기본값이지만, 이 시나리오는 정확한 필터가 **필수**이므로
      // 의도를 명시적으로 남긴다(기본값이 바뀌어도 이 테스트는 흔들리지 않는다).
      strictFilters: true,
      resolveElimination, judgePure, computePlayerStatuses, PLAYER_STATUS, maxLoserCountFor, vi,
      combinedSourceOverride: mutatedSource,
      dbErrorInjectionFn: makeNextRoundAdvanceFailureFn(),
      simulateLostTimer: false, applyNextRoundMarkerWrites: false, deliverDuplicateEcho: false,
      preEchoDrainMs: 25000, settleBudgetMs: 45000,
    });

    // eslint-disable-next-line no-console
    console.log('[H-1 mutation1 안전망A 제거]', JSON.stringify({
      nextRoundFailed: r.nextRoundFailedEvents.length, retryScheduled: r.retryScheduledEvents.length,
      timerBeforeEcho: r.timerBeforeEcho, advanced: r.advancedToNextRound, finalRoomStatus: r.finalRoomStatus,
    }));
    expect(r.nextRoundFailedEvents.length).toBeGreaterThan(0); // 실패 자체는 동일하게 일어나고
    expect(r.retryScheduledEvents.length).toBe(0); // 재예약만 사라진다(= 테스트4 RED)
    expect(r.timerBeforeEcho).toBe(false);
    expect(r.advancedToNextRound).toBe(false);
  }, 120000);

  it('[mutation 4: DB error injection 제거] 같은 시나리오를 주입 없이(dbErrorInjectionFn=null, 하니스 기본값) 돌리면 nextRound()가 성공해 실패/재예약 신호가 하나도 나오지 않는다(테스트4가 RED가 된다 — 주입 경로가 테스트4의 필수 조건임을 증명)', async () => {
    const r = await runRematchAdvanceRecoveryScenario({
      // JP-BL-027-D 이후 strict 가 기본값이지만, 이 시나리오는 정확한 필터가 **필수**이므로
      // 의도를 명시적으로 남긴다(기본값이 바뀌어도 이 테스트는 흔들리지 않는다).
      strictFilters: true,
      resolveElimination, judgePure, computePlayerStatuses, PLAYER_STATUS, maxLoserCountFor, vi,
      dbErrorInjectionFn: null,
      simulateLostTimer: false, applyNextRoundMarkerWrites: false, deliverDuplicateEcho: false,
      preEchoDrainMs: 25000, settleBudgetMs: 45000,
    });

    // eslint-disable-next-line no-console
    console.log('[H-1 mutation4 DB주입 제거]', JSON.stringify({
      nextRoundFailed: r.nextRoundFailedEvents.length, retryScheduled: r.retryScheduledEvents.length,
      advanced: r.advancedToNextRound, finalRoomRound: r.finalRoomRound, finalRoomStatus: r.finalRoomStatus,
    }));
    expect(r.firstOutcome).toBe('tooMany');
    expect(r.nextRoundFailedEvents.length).toBe(0);
    expect(r.retryScheduledEvents.length).toBe(0); // = 테스트4 RED
    // 대조군으로서 정상 진행 자체는 확인한다(주입이 없으면 방은 그냥 다음 라운드로 간다).
    expect(r.advancedToNextRound).toBe(true);
  }, 120000);
});

describe('H-1 §안전망 B(경로 #5, index.html:8212→9759): duplicate result 호출이 idempotent 조기반환을 거쳐 복구를 재예약한다', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date(1_800_000_000_000)); });
  afterEach(() => { vi.useRealTimers(); });

  it('[테스트5] 예약 타이머가 유실된 뒤 duplicate result 호출이 오면 재판정 없이(idempotent) 안전망 B가 재예약한다 — 카운터는 증가하지 않는다(index.html:9740-9746 계약)', async () => {
    const r = await runRematchAdvanceRecoveryScenario({
      // JP-BL-027-D 이후 strict 가 기본값이지만, 이 시나리오는 정확한 필터가 **필수**이므로
      // 의도를 명시적으로 남긴다(기본값이 바뀌어도 이 테스트는 흔들리지 않는다).
      strictFilters: true,
      resolveElimination, judgePure, computePlayerStatuses, PLAYER_STATUS, maxLoserCountFor, vi,
      simulateLostTimer: true, deliverDuplicateEcho: true,
    });

    // eslint-disable-next-line no-console
    console.log('[H-1 테스트5 안전망B]', JSON.stringify({
      timerAfterFirstResolution: r.timerAfterFirstResolution, timerBeforeEcho: r.timerBeforeEcho,
      idempotentReplayCount: r.idempotentReplayCount, substituteOutcomes: r.substituteOutcomes,
      timerAfterEcho: r.timerAfterEcho, retryAttemptsAfterEcho: r.retryAttemptsAfterEcho,
    }));
    expect(r.firstOutcome).toBe('tooMany');
    expect(r.timerAfterFirstResolution).toBe(true);
    expect(r.timerBeforeEcho).toBe(false); // 유실 모사 직후에는 예약이 하나도 없다(= REAL 안전망 B의 전제)
    // 핵심 단정 1: REAL idempotent 조기반환(:8188)을 실제로 탔다 — 판정이 다시 일어나지 않았다.
    expect(r.idempotentReplayCount).toBe(1);
    expect(r.substituteOutcomes).toEqual(['tooMany']);
    // 핵심 단정 2: 그 안에서 안전망 B(:8212 → :9759)가 재예약했다.
    expect(r.timerAfterEcho).toBe(true);
    // 핵심 단정 3: B는 A와 같은 예산을 "확인"만 하고 증가시키지 않는다.
    expect(r.retryAttemptsAfterEcho).toBe(r.retryAttemptsBeforeEcho);
    expect(r.retryAttemptsAfterEcho).toBe(0);
  }, 120000);

  it('[테스트6] 복구 경로가 실제로 없으면(duplicate 호출 없음) 방은 result에서 빠져나오지 못한다 — 진짜 STALL은 그대로 검출된다', async () => {
    const r = await runRematchAdvanceRecoveryScenario({
      // JP-BL-027-D 이후 strict 가 기본값이지만, 이 시나리오는 정확한 필터가 **필수**이므로
      // 의도를 명시적으로 남긴다(기본값이 바뀌어도 이 테스트는 흔들리지 않는다).
      strictFilters: true,
      resolveElimination, judgePure, computePlayerStatuses, PLAYER_STATUS, maxLoserCountFor, vi,
      simulateLostTimer: true, deliverDuplicateEcho: false,
    });

    // eslint-disable-next-line no-console
    console.log('[H-1 테스트6 복구경로 없음(진짜 STALL)]', JSON.stringify({
      timerAfterEcho: r.timerAfterEcho, advanced: r.advancedToNextRound,
      finalRoomStatus: r.finalRoomStatus, finalRoomRound: r.finalRoomRound, finalHostStatus: r.finalHostStatus,
    }));
    expect(r.firstOutcome).toBe('tooMany');
    expect(r.idempotentReplayCount).toBe(0);
    expect(r.timerAfterEcho).toBe(false);
    expect(r.advancedToNextRound).toBe(false);
    expect(r.finalRoomStatus).toBe('result');
    expect(r.finalRoomRound).toBe(1);
  }, 120000);

  it('[테스트6-b, 트라이얼 단위] nextRound()의 room advance write가 영구 실패하면(복구 불가) runMeasuredTrial이 STALL을 하드 실패로 그대로 검출한다(idempotency 추가가 STALL 채널을 눈멀게 하지 않았다는 증거)', async () => {
    const r = await runMeasuredTrial({
      strictFilters: true,
      participantCount: 3, seed: 91910001, targetRounds: 2,
      resolveElimination, judgePure, computePlayerStatuses, PLAYER_STATUS, maxLoserCountFor, vi,
      dbErrorInjectionFn: makeNextRoundAdvanceFailureFn(),
    });

    expect(r.completed).toBe(false);
    expect(r.hardFailureModes.some((f) => f.type === 'STALL')).toBe(true);
    expect(r.pass).toBe(false);
  }, 180000);

  it('[테스트7] duplicate 호출로 복구되면 방은 실제로 다음 라운드로 진행한다 — false STALL도, 재판정(재분류)도 발생하지 않는다', async () => {
    const r = await runRematchAdvanceRecoveryScenario({
      // JP-BL-027-D 이후 strict 가 기본값이지만, 이 시나리오는 정확한 필터가 **필수**이므로
      // 의도를 명시적으로 남긴다(기본값이 바뀌어도 이 테스트는 흔들리지 않는다).
      strictFilters: true,
      resolveElimination, judgePure, computePlayerStatuses, PLAYER_STATUS, maxLoserCountFor, vi,
      simulateLostTimer: true, deliverDuplicateEcho: true, applyNextRoundMarkerWrites: true,
    });

    // eslint-disable-next-line no-console
    console.log('[H-1 테스트7 복구 성공/false STALL 없음]', JSON.stringify({
      advanced: r.advancedToNextRound, finalRoomRound: r.finalRoomRound, finalRoomStatus: r.finalRoomStatus,
      substituteOutcomes: r.substituteOutcomes, idempotentReplayCount: r.idempotentReplayCount,
    }));
    // 복구 성공(REAL nextRound()가 실제로 커밋한 { round:2, status:'ready' }를 그대로 관측).
    expect(r.advancedToNextRound).toBe(true);
    expect(r.finalRoomRound).toBe(2);
    expect(r.finalRoomStatus).toBe('ready');
    // 이 라운드는 단 한 번만 판정됐다 — duplicate 호출이 만들어내던 재분류(phantom outcome)가 없다.
    expect(r.substituteOutcomes).toEqual(['tooMany']);
    expect(r.idempotentReplayCount).toBe(1);
  }, 120000);

  it('[mutation 2: 안전망 B 제거] maybeRecoverStalledRematchAdvance를 즉시 return으로 무력화하면 같은 duplicate 호출이 와도 재예약이 없어 방이 result에 머문다(테스트5/7이 RED가 된다)', async () => {
    const mutatedSource = EXTRACTED_COMBINED_SOURCE.replace(
      `    function maybeRecoverStalledRematchAdvance() {
      if (state.role !== "host" || !getOnlineMode()) return;`,
      `    function maybeRecoverStalledRematchAdvance() {
      return; /* MUTATION H1-B: 안전망 B(duplicate echo 복구) 제거 */
      if (state.role !== "host" || !getOnlineMode()) return;`
    );
    expect(mutatedSource).not.toBe(EXTRACTED_COMBINED_SOURCE);

    const r = await runRematchAdvanceRecoveryScenario({
      // JP-BL-027-D 이후 strict 가 기본값이지만, 이 시나리오는 정확한 필터가 **필수**이므로
      // 의도를 명시적으로 남긴다(기본값이 바뀌어도 이 테스트는 흔들리지 않는다).
      strictFilters: true,
      resolveElimination, judgePure, computePlayerStatuses, PLAYER_STATUS, maxLoserCountFor, vi,
      combinedSourceOverride: mutatedSource,
      simulateLostTimer: true, deliverDuplicateEcho: true, applyNextRoundMarkerWrites: true,
    });

    // eslint-disable-next-line no-console
    console.log('[H-1 mutation2 안전망B 제거]', JSON.stringify({
      idempotentReplayCount: r.idempotentReplayCount, timerAfterEcho: r.timerAfterEcho,
      advanced: r.advancedToNextRound, finalRoomStatus: r.finalRoomStatus, substituteOutcomes: r.substituteOutcomes,
    }));
    expect(r.idempotentReplayCount).toBe(1); // 조기반환 자체는 그대로(캐시는 살아있음)
    expect(r.timerAfterEcho).toBe(false); // = 테스트5 RED
    expect(r.advancedToNextRound).toBe(false); // = 테스트7 RED
    expect(r.finalRoomStatus).toBe('result');
  }, 120000);

  it('[mutation 3: idempotency 캐시 제거] 캐시를 끄면(H-1 이전 하니스 동작) 같은 duplicate 호출이 이 라운드를 전량 재판정해 REAL에 없는 재분류가 발생한다(테스트7이 RED가 된다)', async () => {
    const r = await runRematchAdvanceRecoveryScenario({
      // JP-BL-027-D 이후 strict 가 기본값이지만, 이 시나리오는 정확한 필터가 **필수**이므로
      // 의도를 명시적으로 남긴다(기본값이 바뀌어도 이 테스트는 흔들리지 않는다).
      strictFilters: true,
      resolveElimination, judgePure, computePlayerStatuses, PLAYER_STATUS, maxLoserCountFor, vi,
      idempotencyCacheEnabled: false,
      simulateLostTimer: true, deliverDuplicateEcho: true, applyNextRoundMarkerWrites: true,
    });

    // eslint-disable-next-line no-console
    console.log('[H-1 mutation3 캐시 제거(재분류 발생)]', JSON.stringify({
      idempotentReplayCount: r.idempotentReplayCount, substituteOutcomes: r.substituteOutcomes,
      timerAfterEcho: r.timerAfterEcho, advanced: r.advancedToNextRound,
      finalRoomStatus: r.finalRoomStatus, finalRoomRound: r.finalRoomRound,
    }));
    // 조기반환이 아예 없으므로 idempotent 이벤트가 0이고,
    expect(r.idempotentReplayCount).toBe(0);
    // 같은 라운드가 두 번 판정된다 — 두 번째 판정은 REAL에는 존재하지 않는 재분류다(phantom).
    expect(r.substituteOutcomes.length).toBe(2); // = 테스트7의 `toEqual(['tooMany'])` RED
    expect(r.substituteOutcomes[0]).toBe('tooMany');
    expect(r.substituteOutcomes[1]).not.toBe('tooMany');
  }, 120000);
});

describe('H-1 §공유 예산(index.html:9681/9740-9746): 안전망 A/B가 한 예산을 공유하고, 소진 후에는 아무도 재예약하지 않는다', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date(1_800_000_000_000)); });
  afterEach(() => { vi.useRealTimers(); });

  it('[테스트8] 안전망 A가 상한(MAX_REMATCH_ADVANCE_RETRIES=3)을 모두 소진한 뒤 duplicate 호출이 와도 안전망 B는 재예약하지 않는다(무한 루프 불가) — EXHAUSTED(source=duplicateEchoRecovery)만 남는다', async () => {
    const r = await runRematchAdvanceRecoveryScenario({
      // JP-BL-027-D 이후 strict 가 기본값이지만, 이 시나리오는 정확한 필터가 **필수**이므로
      // 의도를 명시적으로 남긴다(기본값이 바뀌어도 이 테스트는 흔들리지 않는다).
      strictFilters: true,
      resolveElimination, judgePure, computePlayerStatuses, PLAYER_STATUS, maxLoserCountFor, vi,
      dbErrorInjectionFn: makeNextRoundAdvanceFailureFn(),
      simulateLostTimer: false, deliverDuplicateEcho: true,
      preEchoDrainMs: 30000, settleBudgetMs: 45000,
    });

    // eslint-disable-next-line no-console
    console.log('[H-1 테스트8 예산 소진]', JSON.stringify({
      retryAttemptsBeforeEcho: r.retryAttemptsBeforeEcho,
      retryScheduled: r.retryScheduledEvents.map((e) => e.retryCount),
      exhausted: r.retryExhaustedEvents.map((e) => ({ retryCount: e.retryCount, source: e.source || null })),
      timerBeforeEcho: r.timerBeforeEcho, timerAfterEcho: r.timerAfterEcho,
      retryAttemptsAfterEcho: r.retryAttemptsAfterEcho, advanced: r.advancedToNextRound,
    }));
    // 예산이 실제로 소진됐고(A가 3회까지만 증가시킨다),
    expect(r.retryAttemptsBeforeEcho).toBe(3);
    expect(r.retryScheduledEvents.map((e) => e.retryCount)).toEqual([1, 2, 3]);
    expect(r.timerBeforeEcho).toBe(false); // 소진 후에는 A도 더 이상 예약하지 않는다
    // duplicate 호출은 idempotent 조기반환을 그대로 타지만,
    expect(r.idempotentReplayCount).toBe(1);
    // 안전망 B는 상한을 확인하고 재예약을 거부한다(index.html:9751-9758).
    expect(r.timerAfterEcho).toBe(false);
    expect(r.retryAttemptsAfterEcho).toBe(3); // B는 카운터를 증가시키지도 않는다
    expect(r.retryExhaustedEvents.some((e) => e.source === 'duplicateEchoRecovery')).toBe(true);
    expect(r.advancedToNextRound).toBe(false);
  }, 180000);

  it('[mutation 3-b: idempotency 캐시 제거] 캐시를 끄면 duplicate 호출이 REAL 예산을 우회해(조기반환 대신 재판정 후 onOutcome이 무조건 재예약) 소진된 예산 뒤에도 타이머가 되살아난다 — 테스트8이 RED가 된다', async () => {
    const r = await runRematchAdvanceRecoveryScenario({
      // JP-BL-027-D 이후 strict 가 기본값이지만, 이 시나리오는 정확한 필터가 **필수**이므로
      // 의도를 명시적으로 남긴다(기본값이 바뀌어도 이 테스트는 흔들리지 않는다).
      strictFilters: true,
      resolveElimination, judgePure, computePlayerStatuses, PLAYER_STATUS, maxLoserCountFor, vi,
      idempotencyCacheEnabled: false,
      dbErrorInjectionFn: makeNextRoundAdvanceFailureFn(),
      simulateLostTimer: false, deliverDuplicateEcho: true,
      preEchoDrainMs: 30000, settleBudgetMs: 45000,
    });

    // eslint-disable-next-line no-console
    console.log('[H-1 mutation3-b 캐시 제거(예산 우회)]', JSON.stringify({
      retryAttemptsBeforeEcho: r.retryAttemptsBeforeEcho, idempotentReplayCount: r.idempotentReplayCount,
      timerAfterEcho: r.timerAfterEcho, substituteOutcomes: r.substituteOutcomes,
    }));
    expect(r.retryAttemptsBeforeEcho).toBe(3);
    expect(r.idempotentReplayCount).toBe(0);
    expect(r.timerAfterEcho).toBe(true); // = 테스트8 RED(예산 우회)
  }, 180000);
});
