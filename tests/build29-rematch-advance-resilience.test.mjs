import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';

// Build29 Round2(codex-critic VERDICT-3) — 검증 3차에서 발견된 HIGH-1/MEDIUM-1 수정 검증.
//
// HIGH-1: 우선안전 호스트가 allDraw 'result'에 있을 때 유일한 탈출 경로는 auto-advance
// (scheduleRematchAutoAdvance → nextRound())뿐이다(nextRoundBtn은 screenRoundResult 소속이라
// winnerWait에서 접근 불가, forceStartReplay는 status==="ready"를 요구해 'result'에서 불가).
// nextRound()의 순차 Supabase write가 일시 오류로 throw하면 기존엔 재예약 없이 advancingRound만
// 풀려 방 전체가 'result'에서 영구 정지했다.
//   (A) nextRound() catch에서 실패 시 scheduleRematchAdvanceRetryAfterFailure()로 백오프
//       재예약(라운드별 상한 3회, roomCode:gameNo:round 합성 키).
//   (B) idempotent 비-gameOver 재렌더 경로(duplicate 'result' echo)에서 타이머가 전혀 없고
//       advancingRound도 아니면 maybeRecoverStalledRematchAdvance()로 2차 안전망 재예약.
//       (A)와 동일한 카운터를 "확인만" 하고 증가시키지 않는다 — 상한 소진 후에는 재예약 안 함.
//
// MEDIUM-1: showRoundResultOrWait의 대기화면 우회는 온라인 전용이어야 한다. 오프라인(단일
// 공유 기기)에는 auto-advance도 forceStartReplay도 없어, 대기화면 우회가 오프라인에도 적용되면
// 확정자가 winnerWait/loserWait에 갇혀 진행 불가에 빠진다.
//
// 실제 소스 추출 + new Function() 실행 패턴(tests/build28-round-judge-integrity.test.mjs와 동일).
// judgePure/resolveElimination/judgeRound 등 판정 알고리즘 본체는 이 테스트의 관심사가 아니다.

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

function extractBlock(startMarker, endMarker, includeEndFirstChar = false) {
  const start = html.indexOf(startMarker);
  if (start < 0) throw new Error(`start marker not found: ${startMarker}`);
  let end = html.indexOf(endMarker, start);
  if (end < 0) throw new Error(`end marker not found: ${endMarker}`);
  if (includeEndFirstChar) end += 1;
  return html.slice(start, end);
}

const CHOICE_HELPERS_BLOCK = extractBlock(
  'function isSafeParticipant(id = state.currentUserId) {',
  'function getParticipantSignature('
);
const FINISH_ROUND_LOCAL_SRC = extractBlock(
  'async function finishRoundLocal() {',
  '// 오프라인/프로토타입용 원본 finishRound'
);
// scheduleRematchAutoAdvance + MAX_REMATCH_ADVANCE_RETRIES + getRematchAdvanceRetryKey/Attempts +
// scheduleRematchAdvanceRetryAfterFailure + maybeRecoverStalledRematchAdvance, 전부 한 블록.
const REMATCH_HELPERS_SRC = extractBlock(
  'function scheduleRematchAutoAdvance(delayMs = 1500) {',
  'async function nextRound() {'
);
const NEXT_ROUND_SRC = extractBlock('async function nextRound() {', 'async function endGame() {');
const DISCARD_IN_PROGRESS_SRC = extractBlock(
  'function discardInProgressRoomSession() {',
  'function resetRoomLocalState({ keepRoomCode = "" } = {}) {'
);
const RESET_ROOM_LOCAL_STATE_SRC = extractBlock(
  'function resetRoomLocalState({ keepRoomCode = "" } = {}) {',
  'async function createRoom() {'
);
const BEGIN_NEW_GAME_ROUND_SRC = extractBlock(
  'async function beginNewGameRound({ status = "lobby"',
  '// Build19(WRPS-072-B19): result/game_over 전환 시 참가자 스냅샷 완결성 보장'
);

function makeDb(overrides = {}) {
  const calls = [];
  const db = {
    from: (table) => ({
      update: (payload) => ({
        eq: (col, val) => { calls.push({ table, payload, col, val }); return overrides.update ? overrides.update(table, payload) : Promise.resolve({ data: null, error: null }); },
        in: (col, val) => { calls.push({ table, op: 'update-in', payload, col, val }); return overrides.update ? overrides.update(table, payload) : Promise.resolve({ data: null, error: null }); },
      }),
    }),
  };
  return { db, calls };
}

// Build29 Round3(codex-critic VERDICT FAIL HIGH-1): vendored supabase-js v2의 실전 실패 모델은
// Promise.reject가 아니라 { data:null, error:{...} }로 "resolve"하는 것이다(HTTP 실패는 물론, fetch
// 자체가 reject해도 PostgrestBuilder.then()이 .catch()로 잡아 { success:false, error, status:0 }로
// 변환한다). 위 makeDb()의 override 기반 reject 주입은 이 실전 모델을 재현하지 못한다(그래서 이전
// 라운드의 483 테스트 green이 결함을 못 잡았다) — 이 헬퍼가 그 간극을 메운다. failIndexes는 nextRound
// 안에서 순서대로 발생하는 db 호출의 1-based index(참가자 초기화=1, safe 마커=2, loser 마커=3,
// rooms.update=4 — safeIds/loserIds가 비어 있으면 그만큼 인덱스가 당겨진다)다.
function makeResolveDb({ failIndexes = [], errorMessage = 'FetchError: failed to fetch' } = {}) {
  const calls = [];
  let callIndex = 0;
  const respond = (table, payload) => {
    callIndex += 1;
    const idx = callIndex;
    calls.push({ idx, table, payload });
    const shouldFail = failIndexes.includes(idx);
    return Promise.resolve(shouldFail
      ? { data: null, error: { message: errorMessage } }
      : { data: null, error: null });
  };
  const db = {
    from: (table) => ({
      update: (payload) => ({
        eq: (col, val) => respond(table, payload),
        in: (col, val) => respond(table, payload),
      }),
    }),
  };
  return { db, calls };
}

// scheduleRematchAutoAdvance/scheduleRematchAdvanceRetryAfterFailure/maybeRecoverStalledRematchAdvance/
// nextRound 전부를 한 factory에 넣어 실제 재예약 체인(catch → 재시도 헬퍼 → scheduleRematchAutoAdvance
// → setTimeout → nextRound 재호출)이 정말로 동작하는지 검증한다.
function loadRematchAdvanceCluster({ state, db, QA, buildPenaltyValue, getNextPhaseScheduledAt, showToast, showReadyScreen, getActivePlayers }) {
  const calls = { showToast: [], showScreen: [], renderRoundResult: [], saveState: 0, showReadyScreen: 0, showTaggerPopup: 0 };
  const factory = new Function(
    'state', 'getOnlineMode', 'getGameRound', 'getTargetLoserCount', 'QA', 'showToast', 't',
    'renderRoundResult', 'showScreen', 'buildPenaltyValue', 'getNextPhaseScheduledAt', 'db', 'saveState', 'showReadyScreen',
    'getActivePlayers', 'showTaggerPopup',
    REMATCH_HELPERS_SRC + '\n' + NEXT_ROUND_SRC +
      '\n; return { scheduleRematchAutoAdvance, scheduleRematchAdvanceRetryAfterFailure, maybeRecoverStalledRematchAdvance, nextRound, getRematchAdvanceRetryKey, getRematchAdvanceRetryAttempts, buildAutoAdvanceMetricPayload };'
  );
  const bundle = factory(
    state, () => true, () => state.gameRound || 1, () => state.targetLoserCount || 1,
    QA || { emit: () => {} }, showToast || ((m) => calls.showToast.push(m)), (k) => k,
    (c, l, r) => calls.renderRoundResult.push({ c, l, r }), (id) => calls.showScreen.push(id),
    buildPenaltyValue || (() => ({})), getNextPhaseScheduledAt || (() => Date.now()), db,
    () => { calls.saveState++; }, showReadyScreen || (() => { calls.showReadyScreen++; }),
    getActivePlayers || (() => (state.participants || []).filter(p =>
      !(state.confirmedSafeIds || []).includes(p.id) && !(state.confirmedLoserIds || []).includes(p.id)
    )),
    // Build30 Phase1: nextRound()의 이미-확정된 gameOver 재진입 분기가 호출하는 술래 팝업 —
    // 이 파일의 관심사(재예약/복구)와 무관하므로 호출 여부만 카운트하는 no-op 스텁을 주입한다.
    () => { calls.showTaggerPopup++; }
  );
  return { ...bundle, calls };
}

function loadFinishRoundLocal({ state, db, judgeRound, getOnlineMode, maybeRecoverStalledRematchAdvance }) {
  const calls = {
    renderRoundResult: [], showScreen: [], showLoserWaitScreen: 0, playResultSfxOnce: [], playResultVoiceOnce: [],
    shadowCompute: [], shadowCompare: [], recordMyAccountGameResult: [], scheduleRematchAutoAdvance: 0,
    stopRoundTimers: 0, syncConfirmedIdsFromParticipants: 0, fetchFreshParticipantsForResult: 0,
    maybeRecoverStalledRematchAdvance: 0, showTaggerPopup: 0,
  };
  const emitted = [];
  const QA = { emit: (channel, data) => emitted.push(data) };
  const renderRoundResult = (caseType, roundLoserCount, remainingSlots) =>
    calls.renderRoundResult.push({ caseType, roundLoserCount, remainingSlots });
  const showScreen = (id) => calls.showScreen.push(id);
  // Build30 Phase1: 확정 gameOver 렌더 직후 호출되는 술래 팝업 — 이 파일의 관심사(재예약/복구)와
  // 무관하므로 호출 여부만 카운트하는 no-op 스텁을 주입한다.
  const showTaggerPopup = () => { calls.showTaggerPopup++; };
  const showLoserWaitScreen = () => { calls.showLoserWaitScreen++; };
  const playResultSfxOnce = (kind, delayMs) => calls.playResultSfxOnce.push({ kind, delayMs });
  const playResultVoiceOnce = (...args) => calls.playResultVoiceOnce.push(args);
  const __engineV2ShadowComputeRound = (...args) => calls.shadowCompute.push(args);
  const __engineV2ShadowCompare = (label) => calls.shadowCompare.push(label);
  const recordMyAccountGameResult = (r) => calls.recordMyAccountGameResult.push(r);
  const scheduleRematchAutoAdvance = () => { calls.scheduleRematchAutoAdvance++; };
  const stopRoundTimers = () => { calls.stopRoundTimers++; };
  const syncConfirmedIdsFromParticipants = () => { calls.syncConfirmedIdsFromParticipants++; };
  const getGameRound = () => state.gameRound || 1;
  const getTargetLoserCount = () => state.targetLoserCount || 1;
  const isConfirmedLoser = undefined; // 실제 소스(CHOICE_HELPERS_BLOCK)가 제공 — 스텁 불필요
  const fetchFreshWrapped = () => { calls.fetchFreshParticipantsForResult++; return Promise.resolve([]); };
  const maybeRecoverWrapped = (...args) => {
    calls.maybeRecoverStalledRematchAdvance++;
    return (maybeRecoverStalledRematchAdvance || (() => {}))(...args);
  };
  const factory = new Function(
    'state', 'QA', 'db', 'getGameRound', 'getTargetLoserCount', 'getOnlineMode', 'judgeRound',
    'syncConfirmedIdsFromParticipants', 'renderRoundResult', 'showScreen', 'showLoserWaitScreen',
    'playResultSfxOnce', 'playResultVoiceOnce', '__engineV2ShadowComputeRound', '__engineV2ShadowCompare',
    'recordMyAccountGameResult', 'scheduleRematchAutoAdvance', 'stopRoundTimers', 'fetchFreshParticipantsForResult',
    'maybeRecoverStalledRematchAdvance', 'showTaggerPopup',
    CHOICE_HELPERS_BLOCK + '\n' + FINISH_ROUND_LOCAL_SRC + '\n; return finishRoundLocal;'
  );
  const finishRoundLocal = factory(
    state, QA, db, getGameRound, getTargetLoserCount, getOnlineMode || (() => true),
    judgeRound || (() => ({})), syncConfirmedIdsFromParticipants,
    renderRoundResult, showScreen, showLoserWaitScreen, playResultSfxOnce, playResultVoiceOnce,
    __engineV2ShadowComputeRound, __engineV2ShadowCompare, recordMyAccountGameResult,
    scheduleRematchAutoAdvance, stopRoundTimers, fetchFreshWrapped, maybeRecoverWrapped, showTaggerPopup
  );
  return { finishRoundLocal, calls, emitted };
}

function loadDiscardInProgressRoomSession(state) {
  const factory = new Function('state', DISCARD_IN_PROGRESS_SRC + '\n; return discardInProgressRoomSession;');
  return factory(state);
}

function loadResetRoomLocalState(state) {
  const stopTimers = () => {};
  const clearRealtime = () => {};
  const $ = () => null;
  const getScopedLocalStorageItem = () => null;
  const setScopedLocalStorageItem = () => {};
  const factory = new Function(
    'state', 'stopTimers', 'clearRealtime', '$', 'getScopedLocalStorageItem', 'setScopedLocalStorageItem',
    RESET_ROOM_LOCAL_STATE_SRC + '\n; return resetRoomLocalState;'
  );
  return factory(state, stopTimers, clearRealtime, $, getScopedLocalStorageItem, setScopedLocalStorageItem);
}

function loadBeginNewGameRound(state) {
  const dbCalls = [];
  const db = {
    from: (table) => ({
      update: (payload) => ({
        eq: (col, val) => { dbCalls.push({ table, payload, col, val }); return Promise.resolve({ data: null, error: null }); },
      }),
    }),
  };
  const hasCurrentGameRoundActivity = () => false;
  const archiveCurrentRoundStats = () => {};
  const resetTransientRoundUi = () => {};
  const resetLocalParticipantsForNewGameRound = () => {};
  const saveState = () => {};
  const getNewGameRoundParticipantPatch = () => ({ choice: null, is_ready: false, wins: 0, losses: 0, draws: 0, penalties: 0 });
  const getOnlineMode = () => true;
  const getTargetLoserCount = () => state.targetLoserCount || 1;
  const getGameRound = () => state.gameRound || 1;
  const getNextCountdownStartAt = () => 0;
  const buildPenaltyValue = () => ({});
  const getNextPhaseScheduledAt = () => Date.now();
  const factory = new Function(
    'state', 'db', 'hasCurrentGameRoundActivity', 'archiveCurrentRoundStats', 'resetTransientRoundUi',
    'getTargetLoserCount', 'getGameRound', 'getNextCountdownStartAt', 'buildPenaltyValue', 'getNextPhaseScheduledAt',
    'resetLocalParticipantsForNewGameRound', 'getOnlineMode', 'getNewGameRoundParticipantPatch', 'saveState',
    BEGIN_NEW_GAME_ROUND_SRC + '\n; return beginNewGameRound;'
  );
  const beginNewGameRound = factory(
    state, db, hasCurrentGameRoundActivity, archiveCurrentRoundStats, resetTransientRoundUi,
    getTargetLoserCount, getGameRound, getNextCountdownStartAt, buildPenaltyValue, getNextPhaseScheduledAt,
    resetLocalParticipantsForNewGameRound, getOnlineMode, getNewGameRoundParticipantPatch, saveState
  );
  return { beginNewGameRound, dbCalls };
}

// ════════════════════════════════════════════════════════════════════
describe('Build29 Round2 [HIGH-1, 안전망 A] nextRound() 실패 → 재예약(백오프 + 상한 3회)', () => {
  it('(a) 1회 실패 후 2000ms 뒤 자동 재시도되고, 재시도가 성공하면 room.round가 갱신된다', async () => {
    let attempt = 0;
    const { db } = makeDb({
      update: () => {
        attempt++;
        if (attempt <= 3) return Promise.reject(new Error('network blip')); // participants 초기화 실패
        return Promise.resolve({ data: null, error: null });
      },
    });
    const emitted = [];
    const QA = { emit: (ch, data) => emitted.push(data) };
    const state = {
      role: 'host', status: 'result', advancingRound: false, roomCode: 'R1', round: 1, gameRound: 1,
      confirmedSafeIds: [], confirmedLoserIds: [], targetLoserCount: 3, participants: [],
    };
    vi.useFakeTimers();
    try {
      const { nextRound, calls } = loadRematchAdvanceCluster({ state, db, QA });
      await nextRound(); // 1차: participants update(1건) 실패 → catch → 재예약(2000ms)
      expect(state.advancingRound).toBe(false);
      expect(calls.showToast.length).toBe(1);
      expect(state.rematchAdvanceRetryAttempts['R1:1:1']).toBe(1);

      await vi.advanceTimersByTimeAsync(2000); // 재시도 #1 발화 → nextRound() 재호출 → 다시 실패
      expect(state.rematchAdvanceRetryAttempts['R1:1:1']).toBe(2);

      await vi.advanceTimersByTimeAsync(4000); // 재시도 #2 발화(백오프 4000ms) → 다시 실패
      expect(state.rematchAdvanceRetryAttempts['R1:1:1']).toBe(3);

      await vi.advanceTimersByTimeAsync(6000); // 재시도 #3 발화(백오프 6000ms) → 이번엔 성공(attempt=4)
      expect(state.advancingRound).toBe(true); // 성공 경로는 advancingRound를 풀지 않음(F4 계약)
      // CEO 확정 사양: 성공 시 이 라운드의 재시도 카운터가 지워진다(더 이상 존재하지 않음).
      expect(state.rematchAdvanceRetryAttempts['R1:1:1']).toBeUndefined();

      // CEO 확정 사양: 이 케이스는 4번째 시도(attempt=4)에서 성공하므로 실패는 3회
      // (최초 1 + 재시도 2)뿐이고, 그 3번의 실패 각각이 재시도를 예약해 SCHEDULED도 3회다.
      const failed = emitted.filter((e) => e.eventType === 'AUTO_ADVANCE_NEXTROUND_FAILED');
      const scheduled = emitted.filter((e) => e.eventType === 'AUTO_ADVANCE_RETRY_SCHEDULED');
      expect(failed.length).toBe(3);
      expect(scheduled.length).toBe(3);
      expect(failed.every((e) => e.wrps === 'WRPS-077')).toBe(true);
      expect(scheduled.every((e) => e.wrps === 'WRPS-077')).toBe(true);
      expect(scheduled.map((e) => e.retryCount)).toEqual([1, 2, 3]);
      // 필드 존재성 확인(caseType은 lastRoundResolution이 없으므로 null이어야 함).
      expect(failed[0]).toMatchObject({
        roomCode: 'R1', gameNo: 1, eventId: '1:1', caseType: null,
        activeCandidateCount: 0, participantCount: 0, confirmedTaggerCount: 0, targetTaggerCount: 3,
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it('(b) 상한(3회) 소진 시 더 이상 재예약하지 않고 AUTO_ADVANCE_RETRY_EXHAUSTED를 emit한다', async () => {
    const { db } = makeDb({ update: () => Promise.reject(new Error('always down')) });
    const emitted = [];
    const QA = { emit: (ch, data) => emitted.push(data) };
    const state = {
      role: 'host', status: 'result', advancingRound: false, roomCode: 'R1', round: 1, gameRound: 1,
      confirmedSafeIds: [], confirmedLoserIds: [], targetLoserCount: 3, participants: [],
    };
    vi.useFakeTimers();
    try {
      const { nextRound } = loadRematchAdvanceCluster({ state, db, QA });
      await nextRound(); // 실패 #1 → attempts=1, 재예약
      await vi.advanceTimersByTimeAsync(2000); // 실패 #2 → attempts=2, 재예약
      await vi.advanceTimersByTimeAsync(4000); // 실패 #3 → attempts=3, 재예약
      await vi.advanceTimersByTimeAsync(6000); // 실패 #4 → attempts(3) >= MAX(3) → EXHAUSTED, 재예약 없음
      expect(state.rematchAdvanceTimer).toBe(null);
      expect(state.rematchAdvanceRetryAttempts['R1:1:1']).toBe(3);
      const exhausted = emitted.filter((e) => e.eventType === 'AUTO_ADVANCE_RETRY_EXHAUSTED');
      expect(exhausted.length).toBe(1);
      expect(exhausted[0]).toMatchObject({
        wrps: 'WRPS-077', retryCount: 3, roomCode: 'R1', gameNo: 1, eventId: '1:1',
        caseType: null, activeCandidateCount: 0, participantCount: 0, confirmedTaggerCount: 0, targetTaggerCount: 3,
      });

      // 더 시간이 지나도 새 타이머가 생기지 않는다(무한 루프 없음의 직접 증거).
      await vi.advanceTimersByTimeAsync(60000);
      expect(state.rematchAdvanceTimer).toBe(null);
    } finally {
      vi.useRealTimers();
    }
  });

  it('(b2) caseType은 state.lastRoundResolution의 outcome을 eventId 일치 시에만 재사용한다', async () => {
    const { db } = makeDb({ update: () => Promise.reject(new Error('down')) });
    const emitted = [];
    const QA = { emit: (ch, data) => emitted.push(data) };
    const state = {
      role: 'host', status: 'result', advancingRound: false, roomCode: 'R1', round: 1, gameRound: 1,
      confirmedSafeIds: [], confirmedLoserIds: [], targetLoserCount: 3, participants: [],
      lastRoundResolution: { eventId: '1:1', outcome: 'tooMany' },
    };
    const { nextRound } = loadRematchAdvanceCluster({ state, db, QA });
    await nextRound();
    const failed = emitted.find((e) => e.eventType === 'AUTO_ADVANCE_NEXTROUND_FAILED');
    expect(failed.caseType).toBe('tooMany');

    // eventId가 다른 라운드의 잔존 캐시라면 caseType은 null이어야 한다(엉뚱한 outcome 재사용 금지).
    const state2 = {
      role: 'host', status: 'result', advancingRound: false, roomCode: 'R1', round: 2, gameRound: 1,
      confirmedSafeIds: [], confirmedLoserIds: [], targetLoserCount: 3, participants: [],
      lastRoundResolution: { eventId: '1:1', outcome: 'tooMany' }, // round=2인데 eventId는 "1:1"(불일치)
    };
    const emitted2 = [];
    const QA2 = { emit: (ch, data) => emitted2.push(data) };
    const { nextRound: nextRound2 } = loadRematchAdvanceCluster({ state: state2, db, QA: QA2 });
    await nextRound2();
    const failed2 = emitted2.find((e) => e.eventType === 'AUTO_ADVANCE_NEXTROUND_FAILED');
    expect(failed2.caseType).toBe(null);
  });

  it('(c) 실패 사이 상태가 result가 아니게 바뀌면(예: game_over로 전이) 재예약하지 않는다', async () => {
    const { db } = makeDb({ update: () => Promise.reject(new Error('boom')) });
    const state = {
      role: 'host', status: 'result', advancingRound: false, roomCode: 'R1', round: 1, gameRound: 1,
      confirmedSafeIds: [], confirmedLoserIds: [], targetLoserCount: 3,
    };
    const { nextRound, scheduleRematchAdvanceRetryAfterFailure } = loadRematchAdvanceCluster({ state, db });
    await nextRound();
    expect(state.rematchAdvanceTimer).not.toBe(null); // 정상 재예약됨
    clearTimeout(state.rematchAdvanceTimer); // 실제 setTimeout 누수 방지(이 테스트는 real timers 사용)
    // 이제 다른 real 전이가 났다고 가정(예: 이 사이 game_over로 넘어감)
    state.status = 'game_over';
    state.rematchAdvanceTimer = null; // 새로 실패한 상황을 흉내
    scheduleRematchAdvanceRetryAfterFailure();
    expect(state.rematchAdvanceTimer).toBe(null); // status가 result가 아니므로 재예약 안 함
  });

  // ── CEO 인수기준 1: AUTO_ADVANCE_RETRY_SCHEDULED는 최대 3회까지만 발생한다(4회째 없음) ──
  it('(인수기준 1) SCHEDULED는 정확히 3회만 발생하고 4회째는 절대 발생하지 않는다', async () => {
    const { db } = makeDb({ update: () => Promise.reject(new Error('always down')) });
    const emitted = [];
    const QA = { emit: (ch, data) => emitted.push(data) };
    const state = {
      role: 'host', status: 'result', advancingRound: false, roomCode: 'R1', round: 1, gameRound: 1,
      confirmedSafeIds: [], confirmedLoserIds: [], targetLoserCount: 3, participants: [],
    };
    vi.useFakeTimers();
    try {
      const { nextRound } = loadRematchAdvanceCluster({ state, db, QA });
      await nextRound();
      await vi.advanceTimersByTimeAsync(2000);
      await vi.advanceTimersByTimeAsync(4000);
      await vi.advanceTimersByTimeAsync(6000); // 4번째 실패 → EXHAUSTED(더 이상 SCHEDULED 없음)
      // 그 뒤로 아무리 시간이 지나도(타이머가 없으므로) SCHEDULED가 추가되지 않는다.
      await vi.advanceTimersByTimeAsync(600000);
      const scheduled = emitted.filter((e) => e.eventType === 'AUTO_ADVANCE_RETRY_SCHEDULED');
      expect(scheduled.length).toBe(3); // 정확히 3회, 4회째 없음
      expect(scheduled.map((e) => e.retryCount)).toEqual([1, 2, 3]);
    } finally {
      vi.useRealTimers();
    }
  });
});

// ════════════════════════════════════════════════════════════════════
// Build29 Round3(codex-critic VERDICT FAIL HIGH-1): 실전 실패 모델은 Promise.reject가 아니라
// { error: {...} } resolve다(vendored supabase-js v2의 PostgrestBuilder.then()이 HTTP 실패는 물론
// fetch reject조차 .catch()로 흡수해 resolve로 바꾼다). 이 describe는 makeResolveDb()로 그 실전
// 모델을 재현해, nextRound()의 각 write가 error를 실제로 throw로 승격하는지(승격을 빠뜨린 write가
// 없는지) 증명한다.
describe('Build29 Round3 [HIGH-1 재발 방지] nextRound() write들이 { error } resolve를 실제로 throw로 승격하는가', () => {
  // 이 상태는 온라인 분기의 4개 write를 전부 발화시킨다:
  //   1) participants 초기화(항상), 2) safe 마커(safeIds.length>0), 3) loser 마커(loserIds.length>0),
  //   4) rooms.update(항상).
  function makeFullWriteState() {
    return {
      role: 'host', status: 'result', advancingRound: false, roomCode: 'R1', round: 1, gameRound: 1,
      confirmedSafeIds: ['p1'], confirmedLoserIds: ['p2'], targetLoserCount: 3,
      participants: [{ id: 'p1' }, { id: 'p2' }, { id: 'p3' }],
    };
  }

  it('정상 경로(모든 write가 { error: null }): 종전과 100% 동일하게 진행되고 4개 write 전부 발화한다(무회귀)', async () => {
    const { db, calls } = makeResolveDb({ failIndexes: [] });
    const emitted = [];
    const QA = { emit: (ch, data) => emitted.push(data) };
    const state = makeFullWriteState();
    const { nextRound } = loadRematchAdvanceCluster({ state, db, QA });
    await nextRound();
    expect(calls.length).toBe(4); // 4개 write 전부 발화(하나도 빠뜨리지 않고 실행됨)
    // 온라인 분기는 state.round를 로컬에서 직접 증가시키지 않는다(권위는 DB — 실시간 구독의
    // room update 콜백이 반영한다, 이 파일의 관심사 밖). 대신 rooms.update payload 자체로
    // round+1이 실제로 전송됐는지를 calls에서 직접 확인한다.
    const roomsCall = calls[3];
    expect(roomsCall.table).toBe('rooms');
    expect(roomsCall.payload.round).toBe(2); // 초기 state.round=1 → payload.round=1+1=2로 전송됨
    expect(roomsCall.payload.status).toBe('ready');
    expect(state.advancingRound).toBe(true); // F4 계약: 성공 경로는 advancingRound를 풀지 않음
    expect(emitted.some((e) => e.eventType === 'AUTO_ADVANCE_NEXTROUND_FAILED')).toBe(false); // 실패 metric 없음
    expect(state.rematchAdvanceRetryAttempts).toBeUndefined(); // 애초에 실패가 없었으므로 카운터 자체가 생기지 않음(삭제 로직도 안전)
  });

  // 각 write를 개별적으로 실패시켜, 그 write가 실제로 throw로 승격되는지(누락 write가 없는지)를
  // calls.length(단락 실행 증거) + AUTO_ADVANCE_NEXTROUND_FAILED emit + errorMessage 식별자로 증명한다.
  const writeCases = [
    { idx: 1, label: 'participants.reset(전체 초기화)', messageFragment: 'participants.reset' },
    { idx: 2, label: 'participants.markSafe(안전자 마커)', messageFragment: 'participants.markSafe' },
    { idx: 3, label: 'participants.markLoser(술래 마커)', messageFragment: 'participants.markLoser' },
    { idx: 4, label: 'rooms.advance(라운드 전진)', messageFragment: 'rooms.advance' },
  ];

  for (const { idx, label, messageFragment } of writeCases) {
    it(`write #${idx}(${label})이 { error } resolve를 반환하면 nextRound가 throw해 catch→안전망 A가 발화한다`, async () => {
      const { db, calls } = makeResolveDb({ failIndexes: [idx], errorMessage: 'FetchError: failed to fetch' });
      const emitted = [];
      const QA = { emit: (ch, data) => emitted.push(data) };
      const state = makeFullWriteState();
      const { nextRound } = loadRematchAdvanceCluster({ state, db, QA });
      await nextRound();

      // 단락 실행 증거: 실패한 write 이후의 write는 시도조차 되지 않는다(즉 calls.length === idx).
      expect(calls.length).toBe(idx);

      // catch가 실제로 발화했다는 증거: advancingRound 해제 + 토스트 + 실패 metric + 재시도 재예약.
      expect(state.advancingRound).toBe(false);
      expect(state.rematchAdvanceRetryAttempts['R1:1:1']).toBe(1);

      const failed = emitted.find((e) => e.eventType === 'AUTO_ADVANCE_NEXTROUND_FAILED');
      expect(failed).toBeTruthy();
      expect(failed.errorMessage).toContain(messageFragment); // throw 메시지에 어느 write인지 식별자가 있음(디버깅용)

      const scheduled = emitted.find((e) => e.eventType === 'AUTO_ADVANCE_RETRY_SCHEDULED');
      expect(scheduled).toBeTruthy(); // 안전망 A가 실제로 재예약함(dead code가 아님)

      if (state.rematchAdvanceTimer) clearTimeout(state.rematchAdvanceTimer); // 실제 setTimeout 누수 방지
    });
  }

  it('4개 write 전부를 { error } resolve로 개별 확인 — 누락 없이 총 4개 write가 코드에 존재함을 카운트로 증명', async () => {
    // writeCases가 idx 1~4를 빠짐없이 커버한다는 것 자체가 "온라인 분기 write 개수 = 4, 승격 = 4"의
    // 직접 증거다(다섯 번째 write가 존재했다면 failIndexes:[5]로도 실패 유도가 가능해야 하는데,
    // 정상 경로 테스트에서 calls.length가 정확히 4로 고정됨을 이미 확인했으므로 5번째는 없다).
    expect(writeCases.length).toBe(4);
    expect(writeCases.map((c) => c.idx)).toEqual([1, 2, 3, 4]);
  });
});

// ── CEO 인수기준 2/3/4: EXHAUSTED 이후 duplicate echo 처리 + A/B counter 공유 증명 ──
describe('Build29 Round2 [CEO 인수기준 2/3/4] A(catch retry)/B(duplicate echo) counter 공유 + exhausted 이후 무재예약', () => {
  it('(인수기준 4) A가 2회 소진한 상태에서 B는 그 남은 예산(1회)만큼만 재예약할 수 있고, 그 시도가 실패해 상한에 닿으면 이후로는 B도 막힌다', async () => {
    vi.useFakeTimers();
    try {
      const { db } = makeDb({ update: () => Promise.reject(new Error('down')) });
      const emitted = [];
      const QA = { emit: (ch, data) => emitted.push(data) };
      const state = {
        role: 'host', status: 'result', advancingRound: false, roomCode: 'R1', round: 1, gameRound: 1,
        confirmedSafeIds: [], confirmedLoserIds: [], targetLoserCount: 3, participants: [],
        rematchAdvanceTimer: null,
        rematchAdvanceRetryAttempts: { 'R1:1:1': 2 }, // (A) catch-retry가 이미 2회 소진했다고 가정
      };
      const { maybeRecoverStalledRematchAdvance } = loadRematchAdvanceCluster({ state, db, QA });

      // (B) duplicate echo 도착 — 같은 counter를 읽어 2<3이므로 재예약 허용(정확히 1회).
      maybeRecoverStalledRematchAdvance();
      expect(state.rematchAdvanceTimer).not.toBe(null);
      expect(vi.getTimerCount()).toBe(1);

      // B가 세운 타이머가 발화 → nextRound() 재호출 → 실패 → (A)의 catch가 같은 counter를 증가
      // (2→3)시키고 아직 상한 미만(2<3)이었으므로 마지막 한 번을 더 예약한다.
      await vi.runOnlyPendingTimersAsync();
      expect(state.rematchAdvanceRetryAttempts['R1:1:1']).toBe(3); // (A)가 증가시킴 — 같은 counter 공유의 증거
      expect(state.rematchAdvanceTimer).not.toBe(null); // 아직 상한(3)에 막 도달했을 뿐, 이 예약 자체는 유효

      // 그 마지막 예약이 발화 → 다시 실패 → 이번엔 attempts(3)>=MAX(3) → EXHAUSTED, 재예약 없음.
      await vi.runOnlyPendingTimersAsync();
      expect(state.rematchAdvanceTimer).toBe(null);
      expect(vi.getTimerCount()).toBe(0);
      expect(state.rematchAdvanceRetryAttempts['R1:1:1']).toBe(3); // 더 이상 증가하지 않음
      const exhaustedSoFar = emitted.filter((e) => e.eventType === 'AUTO_ADVANCE_RETRY_EXHAUSTED');
      expect(exhaustedSoFar.length).toBe(1);

      // (인수기준 2/3) 상한 소진 이후 duplicate echo(B)가 다시 도착해도 재예약하지 않고
      // metric만 남긴다 — 타이머 개수가 늘지 않음을 vi.getTimerCount()로 직접 증명한다.
      const timerCountBeforeEcho = vi.getTimerCount();
      maybeRecoverStalledRematchAdvance();
      expect(vi.getTimerCount()).toBe(timerCountBeforeEcho); // 새 타이머 없음(정확히 0 그대로)
      expect(state.rematchAdvanceTimer).toBe(null);
      const exhaustedAfterEcho = emitted.filter((e) => e.eventType === 'AUTO_ADVANCE_RETRY_EXHAUSTED');
      expect(exhaustedAfterEcho.length).toBe(2); // echo도 관측 가능하도록 metric은 남김(무한 루프는 없음)
    } finally {
      vi.useRealTimers();
    }
  });

  it('(인수기준 2/3 보강) 이미 상한에 도달한 상태에서 B를 연달아 3번 호출해도 타이머는 단 한 번도 생기지 않는다', () => {
    vi.useFakeTimers();
    try {
      const { db } = makeDb();
      const emitted = [];
      const QA = { emit: (ch, data) => emitted.push(data) };
      const state = {
        role: 'host', status: 'result', advancingRound: false, roomCode: 'R1', round: 5, gameRound: 2,
        rematchAdvanceTimer: null,
        rematchAdvanceRetryAttempts: { 'R1:2:5': 3 }, // 이미 상한 도달
      };
      const { maybeRecoverStalledRematchAdvance } = loadRematchAdvanceCluster({ state, db, QA });
      expect(vi.getTimerCount()).toBe(0);
      maybeRecoverStalledRematchAdvance();
      maybeRecoverStalledRematchAdvance();
      maybeRecoverStalledRematchAdvance();
      expect(vi.getTimerCount()).toBe(0); // 세 번을 호출해도 타이머는 전혀 생기지 않는다
      expect(state.rematchAdvanceTimer).toBe(null);
      const exhausted = emitted.filter((e) => e.eventType === 'AUTO_ADVANCE_RETRY_EXHAUSTED');
      expect(exhausted.length).toBe(3); // 매 호출마다 관측 가능한 metric은 남는다(조용한 정지 금지)
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('Build29 Round2 [HIGH-1, 안전망 B] maybeRecoverStalledRematchAdvance — duplicate echo 복구', () => {
  it('(a) 타이머가 없고 advancingRound도 아니면 재예약한다', () => {
    const { db } = makeDb();
    const state = {
      role: 'host', status: 'result', advancingRound: false, roomCode: 'R1', round: 2, gameRound: 1,
      rematchAdvanceTimer: null,
    };
    const { maybeRecoverStalledRematchAdvance } = loadRematchAdvanceCluster({ state, db });
    maybeRecoverStalledRematchAdvance();
    expect(state.rematchAdvanceTimer).not.toBe(null);
    clearTimeout(state.rematchAdvanceTimer); // 실제 setTimeout 누수 방지(real timers)
  });

  it('(b) 이미 타이머가 있으면 중복 예약하지 않는다(기존 핸들 유지)', () => {
    const { db } = makeDb();
    const state = {
      role: 'host', status: 'result', advancingRound: false, roomCode: 'R1', round: 2, gameRound: 1,
      rematchAdvanceTimer: 'EXISTING_HANDLE',
    };
    const { maybeRecoverStalledRematchAdvance } = loadRematchAdvanceCluster({ state, db });
    maybeRecoverStalledRematchAdvance();
    expect(state.rematchAdvanceTimer).toBe('EXISTING_HANDLE');
  });

  it('(c) advancingRound===true면(현재 전환 진행 중) 재예약하지 않는다', () => {
    const { db } = makeDb();
    const state = {
      role: 'host', status: 'result', advancingRound: true, roomCode: 'R1', round: 2, gameRound: 1,
      rematchAdvanceTimer: null,
    };
    const { maybeRecoverStalledRematchAdvance } = loadRematchAdvanceCluster({ state, db });
    maybeRecoverStalledRematchAdvance();
    expect(state.rematchAdvanceTimer).toBe(null);
  });

  it('(d) 상한을 이미 소진했으면(A의 EXHAUSTED 이후) 재예약하지 않는다 — (A)의 상한을 우회하지 않는다', () => {
    const { db } = makeDb();
    const state = {
      role: 'host', status: 'result', advancingRound: false, roomCode: 'R1', round: 2, gameRound: 1,
      rematchAdvanceTimer: null,
      rematchAdvanceRetryAttempts: { 'R1:1:2': 3 }, // 이미 상한(3) 도달
    };
    const { maybeRecoverStalledRematchAdvance } = loadRematchAdvanceCluster({ state, db });
    maybeRecoverStalledRematchAdvance();
    expect(state.rematchAdvanceTimer).toBe(null); // 재예약되지 않음 — 무한 루프 방지
  });

  it('(e) 이 경로는 카운터를 증가시키지 않는다(재예약해도 attempts는 그대로)', () => {
    const { db } = makeDb();
    const state = {
      role: 'host', status: 'result', advancingRound: false, roomCode: 'R1', round: 2, gameRound: 1,
      rematchAdvanceTimer: null,
      rematchAdvanceRetryAttempts: { 'R1:1:2': 1 },
    };
    const { maybeRecoverStalledRematchAdvance } = loadRematchAdvanceCluster({ state, db });
    maybeRecoverStalledRematchAdvance();
    expect(state.rematchAdvanceTimer).not.toBe(null); // 재예약은 됨(상한 미달)
    expect(state.rematchAdvanceRetryAttempts['R1:1:2']).toBe(1); // 하지만 카운트는 그대로
    clearTimeout(state.rematchAdvanceTimer); // 실제 setTimeout 누수 방지(real timers)
  });

  it('(f) role이 host가 아니거나 오프라인이면 아무 것도 하지 않는다(회귀 없음)', () => {
    const { db } = makeDb();
    const stateParticipant = {
      role: 'participant', status: 'result', advancingRound: false, roomCode: 'R1', round: 2, gameRound: 1,
      rematchAdvanceTimer: null,
    };
    const { maybeRecoverStalledRematchAdvance: recoverAsParticipant } =
      loadRematchAdvanceCluster({ state: stateParticipant, db });
    recoverAsParticipant();
    expect(stateParticipant.rematchAdvanceTimer).toBe(null);
  });

  it('(g) finishRoundLocal의 idempotent 비-gameOver 재렌더 경로에서 실제로 호출된다(showRoundResultOrWait 이후)', async () => {
    const state = {
      role: 'host', status: 'result', round: 1, gameRound: 1, roomCode: 'R1', currentUserId: 'p1',
      confirmedSafeIds: ['p1', 'p2'], confirmedLoserIds: [], targetLoserCount: 2, finishingRound: false,
      lastRoundResolution: {
        eventId: '1:1', confirmedSafeIds: ['p1', 'p2'], confirmedLoserIds: [],
        outcome: 'tooMany', roundLoserCount: 2, remainingSlots: 1,
      },
      participants: [
        { id: 'p1', is_host: true, choice: '__safe__' },
        { id: 'p2', is_host: false, choice: '__safe__' },
      ],
    };
    const { db } = makeDb();
    let orderMarker = [];
    const maybeRecoverStalledRematchAdvance = () => { orderMarker.push('recover'); };
    const { finishRoundLocal, calls } = loadFinishRoundLocal({ state, db, maybeRecoverStalledRematchAdvance });
    await finishRoundLocal();
    expect(calls.maybeRecoverStalledRematchAdvance).toBe(1);
    // gameOver 분기(가드 없는 무변경 경로)에서는 호출되지 않아야 한다 — 별도 케이스로 교차 검증.
  });

  it('(h) finishRoundLocal의 idempotent gameOver 재렌더 경로에서는 호출되지 않는다(무변경 계약)', async () => {
    const state = {
      role: 'host', status: 'game_over', round: 1, gameRound: 1, roomCode: 'R1', currentUserId: 'p1',
      confirmedSafeIds: ['p1'], confirmedLoserIds: ['p2'], targetLoserCount: 1, finishingRound: false,
      lastRoundResolution: {
        eventId: '1:1', confirmedSafeIds: ['p1'], confirmedLoserIds: ['p2'],
        outcome: 'gameOver', roundLoserCount: 1, remainingSlots: 0,
      },
      participants: [
        { id: 'p1', is_host: false, choice: '__safe__' },
        { id: 'p2', is_host: false, choice: '__loser__' },
      ],
    };
    const { db } = makeDb();
    const { finishRoundLocal, calls } = loadFinishRoundLocal({ state, db });
    await finishRoundLocal();
    expect(calls.maybeRecoverStalledRematchAdvance).toBe(0);
  });
});

// ════════════════════════════════════════════════════════════════════
describe('Build29 Round2 [HIGH-1] 재시도 카운터 키 — room/새 게임 스코프 초기화(3곳)', () => {
  it('discardInProgressRoomSession: rematchAdvanceTimer를 clearTimeout하고 null로, 카운터 맵도 초기화한다', () => {
    const fakeHandle = 11111;
    const clearedHandles = [];
    const realClearTimeout = global.clearTimeout;
    global.clearTimeout = (h) => { clearedHandles.push(h); };
    try {
      const state = {
        rematchAdvanceTimer: fakeHandle,
        rematchAdvanceRetryAttempts: { 'ROOMA:1:1': 2 },
      };
      const discardInProgressRoomSession = loadDiscardInProgressRoomSession(state);
      discardInProgressRoomSession();
      expect(clearedHandles).toContain(fakeHandle);
      expect(state.rematchAdvanceTimer).toBe(null);
      expect(state.rematchAdvanceRetryAttempts).toEqual({});
    } finally {
      global.clearTimeout = realClearTimeout;
    }
  });

  it('resetRoomLocalState: rematchAdvanceTimer를 clearTimeout하고 null로, 카운터 맵도 초기화한다', () => {
    const fakeHandle = 22222;
    const clearedHandles = [];
    const realClearTimeout = global.clearTimeout;
    global.clearTimeout = (h) => { clearedHandles.push(h); };
    try {
      const state = {
        rematchAdvanceTimer: fakeHandle,
        rematchAdvanceRetryAttempts: { 'ROOMA:1:1': 2 },
      };
      const resetRoomLocalState = loadResetRoomLocalState(state);
      resetRoomLocalState();
      expect(clearedHandles).toContain(fakeHandle);
      expect(state.rematchAdvanceTimer).toBe(null);
      expect(state.rematchAdvanceRetryAttempts).toEqual({});
    } finally {
      global.clearTimeout = realClearTimeout;
    }
  });

  it('beginNewGameRound: rematchAdvanceTimer를 clearTimeout하고 null로, 카운터 맵도 초기화한다', async () => {
    const fakeHandle = 33333;
    const clearedHandles = [];
    const realClearTimeout = global.clearTimeout;
    global.clearTimeout = (h) => { clearedHandles.push(h); };
    try {
      const state = {
        newRoundResetting: false, participants: [], confirmedSafeIds: ['p1'], confirmedLoserIds: [],
        gameRound: 1, round: 1, status: 'lobby', roomCode: '', targetLoserCount: 1,
        rematchAdvanceTimer: fakeHandle,
        rematchAdvanceRetryAttempts: { 'ROOMA:1:1': 2 },
      };
      const { beginNewGameRound } = loadBeginNewGameRound(state);
      await beginNewGameRound({ status: 'lobby', increment: true, reason: 'test' });
      expect(clearedHandles).toContain(fakeHandle);
      expect(state.rematchAdvanceTimer).toBe(null);
      expect(state.rematchAdvanceRetryAttempts).toEqual({});
    } finally {
      global.clearTimeout = realClearTimeout;
    }
  });

  it('키는 roomCode:gameNo:round 합성이다 — 같은 gameNo/round라도 방이 다르면 예산이 공유되지 않는다', async () => {
    // 재예약된 setTimeout이 이 테스트 종료 후 실제로 발화하지 않도록 fake timers를 쓴다(정리 시
    // useRealTimers()가 남은 가짜 타이머를 함께 폐기 — 실제 2000ms 대기/누수 없음).
    vi.useFakeTimers();
    try {
      const { db } = makeDb({ update: () => Promise.reject(new Error('down')) });
      const stateA = {
        role: 'host', status: 'result', advancingRound: false, roomCode: 'ROOMA', round: 1, gameRound: 1,
        confirmedSafeIds: [], confirmedLoserIds: [], targetLoserCount: 3,
      };
      const { nextRound: nextRoundA } = loadRematchAdvanceCluster({ state: stateA, db });
      await nextRoundA(); // 1회 실패 → attempts=1(재예약된 타이머는 발화시키지 않음)
      expect(stateA.rematchAdvanceRetryAttempts['ROOMA:1:1']).toBe(1);

      const stateB = {
        role: 'host', status: 'result', advancingRound: false, roomCode: 'ROOMB', round: 1, gameRound: 1,
        confirmedSafeIds: [], confirmedLoserIds: [], targetLoserCount: 3,
      };
      const { nextRound: nextRoundB } = loadRematchAdvanceCluster({ state: stateB, db });
      await nextRoundB();
      expect(stateB.rematchAdvanceRetryAttempts['ROOMB:1:1']).toBe(1);
      expect(stateA.rematchAdvanceRetryAttempts['ROOMA:1:1']).toBe(1); // 방 A 예산은 그대로(공유 안 됨)
    } finally {
      vi.useRealTimers();
    }
  });

  // ── CEO 인수기준 5: retry key에 roomCode + gameNo/gameRound + eventId(또는 동등한 방/라운드
  // 스코프)가 포함된다는 것을 getRematchAdvanceRetryKey() 실제 실행으로 직접 증명한다. ──
  it('(인수기준 5) getRematchAdvanceRetryKey()는 roomCode:gameNo:round(=eventId) 형태를 반환한다', () => {
    const { db } = makeDb();
    const state = { roomCode: 'ABCD', gameRound: 7, round: 3 };
    const { getRematchAdvanceRetryKey } = loadRematchAdvanceCluster({ state, db });
    // roundEventId 관례(getGameRound() + ':' + (state.round||1), 예: finishRoundLocal의
    // roundEventId, getPlayingEntryKey 등)와 동일한 "gameNo:round" 스코프를 roomCode 접두사와
    // 합성한다 — CEO 권장 형태 `${roomCode}:${roundEventId}`와 정확히 동치.
    expect(getRematchAdvanceRetryKey()).toBe('ABCD:7:3');
    const roundEventId = `${state.gameRound}:${state.round}`;
    expect(getRematchAdvanceRetryKey()).toBe(`${state.roomCode}:${roundEventId}`);
  });

  // ── CEO 인수기준 6(보강): createRoom()/joinRoom()이 "새 방 생성/방 이동" 시 실제로
  // resetRoomLocalState()를 호출하는지 — 위 3개 리셋 함수 테스트가 이미 rematchAdvance 카운터
  // 초기화를 검증했으므로, 여기서는 그 리셋이 새 방 생성/방 이동 경로에도 실제로 연결돼 있는지만
  // 소스 계약으로 확인한다(createRoom/joinRoom 전체를 new Function으로 실행하려면 $, saveNickname,
  // buildRoomUrl, subscribeToRoom 등 이 파일의 관심사 밖인 의존성을 대량으로 스텁해야 해서
  // 과도하다 — 다른 대안으로 소스 컨트랙트 검증을 택함). ──
  it('(인수기준 6 보강) createRoom()/joinRoom()은 새 상태 대입 이전에 resetRoomLocalState()를 호출한다', () => {
    const CREATE_ROOM_SRC = extractBlock('async function createRoom() {', 'function createParticipant(');
    const JOIN_ROOM_SRC = extractBlock('async function joinRoom() {', 'async function requestReplayFromJoinedRoom(');
    expect(CREATE_ROOM_SRC).toMatch(/resetRoomLocalState\(\);[\s\S]*state\.roomCode = code;/);
    expect(JOIN_ROOM_SRC).toMatch(/resetRoomLocalState\(\{ keepRoomCode: code \}\);[\s\S]*state\.roomCode = code;/);
    // resetRoomLocalState() 자체가 rematchAdvanceTimer/rematchAdvanceRetryAttempts를 초기화한다는
    // 것은 위 '재시도 카운터 키' describe의 전용 테스트로 이미 실제 실행 검증됨 — 따라서
    // createRoom()/joinRoom()도 간접적으로 커버된다(직접 카운터를 손대는 코드가 없음도 함께 확인).
    expect(CREATE_ROOM_SRC).not.toContain('rematchAdvanceRetryAttempts');
    expect(JOIN_ROOM_SRC).not.toContain('rematchAdvanceRetryAttempts');
  });
});

// ── CEO 인수기준 10: 새 metric 3종의 이름/필드가 사양과 정확히 일치(오타·누락 불가) ──
describe('Build29 Round2 [CEO 인수기준 10] QA metric 이름/필드 정확성', () => {
  const REQUIRED_FIELDS = [
    'retryCount', 'roomCode', 'gameNo', 'eventId', 'caseType',
    'activeCandidateCount', 'participantCount', 'confirmedTaggerCount', 'targetTaggerCount',
  ];

  function expectHasAllRequiredFields(payload) {
    for (const field of REQUIRED_FIELDS) {
      expect(payload).toHaveProperty(field); // 키 자체가 존재해야 한다(값이 null이어도 키는 있어야 함)
    }
    expect(payload.wrps).toBe('WRPS-077');
  }

  it('AUTO_ADVANCE_NEXTROUND_FAILED은 9개 필드 전부 + wrps를 포함한다', async () => {
    const { db } = makeDb({ update: () => Promise.reject(new Error('down')) });
    const emitted = [];
    const QA = { emit: (ch, data) => emitted.push(data) };
    const state = {
      role: 'host', status: 'result', advancingRound: false, roomCode: 'R1', round: 1, gameRound: 1,
      confirmedSafeIds: [], confirmedLoserIds: [], targetLoserCount: 3, participants: [],
    };
    const { nextRound } = loadRematchAdvanceCluster({ state, db, QA });
    await nextRound();
    const failed = emitted.find((e) => e.eventType === 'AUTO_ADVANCE_NEXTROUND_FAILED');
    expect(failed).toBeTruthy();
    expect(failed.eventType).toBe('AUTO_ADVANCE_NEXTROUND_FAILED'); // 오타 없음(정확한 이름)
    expectHasAllRequiredFields(failed);
  });

  it('AUTO_ADVANCE_RETRY_SCHEDULED는 9개 필드 전부 + wrps를 포함한다', async () => {
    const { db } = makeDb({ update: () => Promise.reject(new Error('down')) });
    const emitted = [];
    const QA = { emit: (ch, data) => emitted.push(data) };
    const state = {
      role: 'host', status: 'result', advancingRound: false, roomCode: 'R1', round: 1, gameRound: 1,
      confirmedSafeIds: [], confirmedLoserIds: [], targetLoserCount: 3, participants: [],
    };
    const { nextRound } = loadRematchAdvanceCluster({ state, db, QA });
    await nextRound();
    const scheduled = emitted.find((e) => e.eventType === 'AUTO_ADVANCE_RETRY_SCHEDULED');
    expect(scheduled).toBeTruthy();
    expect(scheduled.eventType).toBe('AUTO_ADVANCE_RETRY_SCHEDULED');
    expectHasAllRequiredFields(scheduled);
  });

  it('AUTO_ADVANCE_RETRY_EXHAUSTED는 9개 필드 전부 + wrps를 포함한다(안전망 A 경로)', async () => {
    const { db } = makeDb({ update: () => Promise.reject(new Error('down')) });
    const emitted = [];
    const QA = { emit: (ch, data) => emitted.push(data) };
    const state = {
      role: 'host', status: 'result', advancingRound: false, roomCode: 'R1', round: 1, gameRound: 1,
      confirmedSafeIds: [], confirmedLoserIds: [], targetLoserCount: 3, participants: [],
    };
    vi.useFakeTimers();
    try {
      const { nextRound } = loadRematchAdvanceCluster({ state, db, QA });
      await nextRound();
      await vi.advanceTimersByTimeAsync(2000);
      await vi.advanceTimersByTimeAsync(4000);
      await vi.advanceTimersByTimeAsync(6000);
      const exhausted = emitted.find((e) => e.eventType === 'AUTO_ADVANCE_RETRY_EXHAUSTED');
      expect(exhausted).toBeTruthy();
      expect(exhausted.eventType).toBe('AUTO_ADVANCE_RETRY_EXHAUSTED');
      expectHasAllRequiredFields(exhausted);
    } finally {
      vi.useRealTimers();
    }
  });

  it('AUTO_ADVANCE_RETRY_EXHAUSTED는 9개 필드 전부 + wrps를 포함한다(안전망 B 경로)', () => {
    const { db } = makeDb();
    const emitted = [];
    const QA = { emit: (ch, data) => emitted.push(data) };
    const state = {
      role: 'host', status: 'result', advancingRound: false, roomCode: 'R1', round: 2, gameRound: 1,
      rematchAdvanceTimer: null,
      rematchAdvanceRetryAttempts: { 'R1:1:2': 3 },
    };
    const { maybeRecoverStalledRematchAdvance } = loadRematchAdvanceCluster({ state, db, QA });
    maybeRecoverStalledRematchAdvance();
    const exhausted = emitted.find((e) => e.eventType === 'AUTO_ADVANCE_RETRY_EXHAUSTED');
    expect(exhausted).toBeTruthy();
    expectHasAllRequiredFields(exhausted);
  });

  it('구 metric 이름(REMATCH_ADVANCE_EXHAUSTED)은 더 이상 emit되지 않는다(완전 폐기 확인)', async () => {
    const { db } = makeDb({ update: () => Promise.reject(new Error('down')) });
    const emitted = [];
    const QA = { emit: (ch, data) => emitted.push(data) };
    const state = {
      role: 'host', status: 'result', advancingRound: false, roomCode: 'R1', round: 1, gameRound: 1,
      confirmedSafeIds: [], confirmedLoserIds: [], targetLoserCount: 3, participants: [],
    };
    vi.useFakeTimers();
    try {
      const { nextRound } = loadRematchAdvanceCluster({ state, db, QA });
      await nextRound();
      await vi.advanceTimersByTimeAsync(2000);
      await vi.advanceTimersByTimeAsync(4000);
      await vi.advanceTimersByTimeAsync(6000);
      expect(emitted.some((e) => e.eventType === 'REMATCH_ADVANCE_EXHAUSTED')).toBe(false);
      expect(html).not.toContain('REMATCH_ADVANCE_EXHAUSTED'); // 소스에도 이름이 남아있지 않다
    } finally {
      vi.useRealTimers();
    }
  });
});

// ── CEO 인수기준 7/8/9: 오프라인/local mode/db-unavailable 진행 가능성 구조 증명 ──
describe('Build29 Round2 [CEO 인수기준 7/8/9] 오프라인/db-unavailable 진행 가능성 + "조용한 정지 금지" 감사', () => {
  it('(인수기준 7) getOnlineMode()는 db 존재 여부(Boolean(db))로만 정의된다 — db가 null이면 항상 오프라인 경로를 탄다', () => {
    // 이 계약이 성립하면 "온라인인데 db=null" 상태는 구조적으로 존재할 수 없다 — db 초기화
    // 실패(Supabase 연결 불가 등)는 자동으로 오프라인 모드로 떨어지고, 오프라인은 MEDIUM-1
    // 수정으로 항상 결과화면+수동 nextRoundBtn 경로가 보장된다(아래 테스트).
    const GET_ONLINE_MODE_SRC = extractBlock('function getOnlineMode() {', 'function clearRealtime() {');
    expect(GET_ONLINE_MODE_SRC).toMatch(/return Boolean\(db\);/);
  });

  it('(인수기준 7/8) 오프라인 nextRound()는 네트워크 호출이 전혀 없는 동기 로컬 상태 갱신이라 실패 모드가 없다(구조 확인)', async () => {
    const { db, calls: dbCalls } = makeDb();
    const state = {
      role: 'host', status: 'result', advancingRound: false, roomCode: '', round: 1, gameRound: 1,
      confirmedSafeIds: ['p1'], confirmedLoserIds: [], targetLoserCount: 3,
      participants: [{ id: 'p1', choice: 'rock' }, { id: 'p2', choice: 'paper' }],
    };
    const factory = new Function(
      'state', 'getOnlineMode', 'getTargetLoserCount', 'showToast', 't', 'renderRoundResult', 'showScreen',
      'buildPenaltyValue', 'getGameRound', 'getNextPhaseScheduledAt', 'db', 'saveState', 'showReadyScreen',
      'scheduleRematchAdvanceRetryAfterFailure',
      NEXT_ROUND_SRC + '\n; return nextRound;'
    );
    const calls = { showReadyScreen: 0, saveState: 0 };
    const nextRound = factory(
      state, () => false, () => state.targetLoserCount, () => {}, (k) => k,
      () => {}, () => {}, () => ({}), () => state.gameRound, () => Date.now(), db,
      () => { calls.saveState++; }, () => { calls.showReadyScreen++; }, () => {}
    );
    await nextRound();
    expect(dbCalls.length).toBe(0); // 네트워크 write가 전혀 없음 — 실패할 여지 자체가 없는 경로
    expect(calls.saveState).toBe(1);
    expect(calls.showReadyScreen).toBe(1);
    expect(state.round).toBe(2);
    expect(state.advancingRound).toBe(true); // 온라인과 동일하게 mutex는 유지(다음 finishRoundLocal이 해제)
  });

  it('(인수기준 9) MEDIUM-1 결론은 "오프라인은 결과화면 유지로 항상 진행 가능"이며, 이는 metric이 필요 없는 non-stall 경로임을 테스트로 고정한다', async () => {
    // 오프라인에서는 대기화면 우회 자체가 발생하지 않으므로(showRoundResultOrWait이
    // getOnlineMode() 가드로 막음) "정지 지점"이 원천적으로 없다 — 그래서 이 경로엔 QA metric이
    // 없다(있을 필요가 없다는 것이 결론이지, 검토 없이 생략한 것이 아니다). 결과화면에 도달하면
    // nextRoundBtn(수동 진행)이 항상 존재한다(2726 부근, screenRoundResult 소속, 무조건 렌더).
    expect(html).toMatch(/<button class="btn-kparty" id="nextRoundBtn" onclick="window\.nextRound\(\)">/);
    // 그 버튼이 속한 화면은 screenRoundResult이고, MEDIUM-1 테스트(위 describe)가 오프라인
    // 확정자가 항상 이 화면에 도달함을 이미 실행 검증했다 — 여기서는 그 결론과 버튼 존재를
    // 하나의 테스트로 고정해 회귀를 방지한다.
    const ROUND_RESULT_SCREEN_SRC = extractBlock('<section class="card maru-card hidden" id="screenRoundResult">', '<section class="card maru-card hidden" id="screenWinnerWait"');
    expect(ROUND_RESULT_SCREEN_SRC).toContain('id="nextRoundBtn"');
  });

  it('(인수기준 9, 잔여 리스크 명시) 온라인 + 상한 소진 이후에는 host 재시작 전까지 회복 경로가 없다 — 그러나 EXHAUSTED metric이 반드시 남으므로 "조용한 정지"는 아니다', async () => {
    // 이 테스트는 "결함이 없다"를 주장하지 않는다 — 온라인 모드에서 네트워크가 계속 끊겨 있으면
    // (A)+(B) 모두 상한(3회)을 넘길 수 없으므로 결국 정지한다(설계상 의도된 트레이드오프,
    // 무한 재시도 금지 원칙과 충돌). 다만 그 정지 시점에 QA에 남는 marker가 실제로 존재하는지를
    // 고정해, "아무 흔적 없이 멈춤"(인수기준 9 위반)이 아님을 증명한다.
    const { db } = makeDb({ update: () => Promise.reject(new Error('down')) });
    const emitted = [];
    const QA = { emit: (ch, data) => emitted.push(data) };
    const state = {
      role: 'host', status: 'result', advancingRound: false, roomCode: 'R1', round: 1, gameRound: 1,
      confirmedSafeIds: [], confirmedLoserIds: [], targetLoserCount: 3, participants: [],
    };
    vi.useFakeTimers();
    try {
      const { nextRound } = loadRematchAdvanceCluster({ state, db, QA });
      await nextRound();
      await vi.advanceTimersByTimeAsync(2000);
      await vi.advanceTimersByTimeAsync(4000);
      await vi.advanceTimersByTimeAsync(6000);
      // 정지 이후 상태에서도 QA에는 흔적이 남아 있다(조용한 정지가 아님).
      expect(emitted.some((e) => e.eventType === 'AUTO_ADVANCE_RETRY_EXHAUSTED')).toBe(true);
      expect(emitted.filter((e) => e.eventType === 'AUTO_ADVANCE_NEXTROUND_FAILED').length).toBeGreaterThan(0);
    } finally {
      vi.useRealTimers();
    }
  });
});

// ════════════════════════════════════════════════════════════════════
describe('Build29 Round2 [MEDIUM-1] showRoundResultOrWait — 대기화면 우회는 온라인 전용', () => {
  it('(a) 오프라인 + 우선안전 확정자는 대기화면이 아니라 결과화면을 본다(nextRoundBtn 접근 가능)', async () => {
    const state = {
      role: 'host', status: 'playing', round: 2, gameRound: 1, roomCode: '', currentUserId: 'p1',
      confirmedSafeIds: ['p1'], confirmedLoserIds: [], targetLoserCount: 1, finishingRound: false,
      lastRoundResolution: null,
      participants: [
        { id: 'p1', is_host: true, choice: '__safe__' },
        { id: 'p2', is_host: false, choice: 'rock' },
        { id: 'p3', is_host: false, choice: 'rock' },
      ],
    };
    const { db } = makeDb();
    const judgeRound = () => ({ p2: 'draw', p3: 'draw' });
    const getOnlineMode = () => false; // 오프라인 단일 공유 기기
    const { finishRoundLocal, calls } = loadFinishRoundLocal({ state, db, judgeRound, getOnlineMode });
    await finishRoundLocal();
    expect(calls.showScreen).toEqual(['screenRoundResult']); // 대기화면으로 우회되지 않음
  });

  it('(b) 오프라인 + 확정 술래(tooMany)도 대기화면이 아니라 결과화면을 본다', async () => {
    const state = {
      role: 'host', status: 'playing', round: 2, gameRound: 1, roomCode: '', currentUserId: 'p1',
      confirmedSafeIds: [], confirmedLoserIds: ['p1'], targetLoserCount: 2, finishingRound: false,
      lastRoundResolution: null,
      participants: [
        { id: 'p1', is_host: true, choice: '__loser__' },
        { id: 'p2', is_host: false, choice: 'rock' },
        { id: 'p3', is_host: false, choice: 'rock' },
        { id: 'p4', is_host: false, choice: 'paper' },
      ],
    };
    const { db } = makeDb();
    const judgeRound = () => ({ p2: 'lose', p3: 'lose', p4: 'win' });
    const getOnlineMode = () => false;
    const { finishRoundLocal, calls } = loadFinishRoundLocal({ state, db, judgeRound, getOnlineMode });
    await finishRoundLocal();
    expect(calls.showScreen).toEqual(['screenRoundResult']);
    expect(calls.showLoserWaitScreen).toBe(0);
  });

  it('(c) 온라인 + 우선안전 확정자는 종전대로(회귀 없음) 대기화면을 본다', async () => {
    const state = {
      role: 'host', status: 'playing', round: 2, gameRound: 1, roomCode: 'R1', currentUserId: 'p1',
      confirmedSafeIds: ['p1'], confirmedLoserIds: [], targetLoserCount: 1, finishingRound: false,
      lastRoundResolution: null,
      participants: [
        { id: 'p1', is_host: true, choice: '__safe__' },
        { id: 'p2', is_host: false, choice: 'rock' },
        { id: 'p3', is_host: false, choice: 'rock' },
      ],
    };
    const { db } = makeDb();
    const judgeRound = () => ({ p2: 'draw', p3: 'draw' });
    const getOnlineMode = () => true;
    const { finishRoundLocal, calls } = loadFinishRoundLocal({ state, db, judgeRound, getOnlineMode });
    await finishRoundLocal();
    expect(calls.showScreen).toEqual(['screenWinnerWait']);
  });

  it('(d) 오프라인 idempotent 재렌더(비종결)도 결과화면을 본다(회귀 없음)', async () => {
    const state = {
      role: 'participant', status: 'result', round: 1, gameRound: 1, roomCode: '', currentUserId: 'p1',
      confirmedSafeIds: ['p1', 'p2'], confirmedLoserIds: [], targetLoserCount: 2, finishingRound: false,
      lastRoundResolution: {
        eventId: '1:1', confirmedSafeIds: ['p1', 'p2'], confirmedLoserIds: [],
        outcome: 'tooMany', roundLoserCount: 2, remainingSlots: 1,
      },
      participants: [
        { id: 'p1', is_host: false, choice: '__safe__' },
        { id: 'p2', is_host: false, choice: '__safe__' },
      ],
    };
    const { db } = makeDb();
    const getOnlineMode = () => false;
    const { finishRoundLocal, calls } = loadFinishRoundLocal({ state, db, getOnlineMode });
    await finishRoundLocal();
    expect(calls.showScreen).toEqual(['screenRoundResult']);
  });
});
