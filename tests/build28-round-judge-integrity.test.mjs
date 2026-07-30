import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { computePlayerStatuses, PLAYER_STATUS } from '../src/game-logic.mjs';

// Build28(WRPS-075) — 실기기 QA(3대, roomId 5I1L, 29라운드)에서 실측된 3개 결함의 공통 근본원인:
// finishRoundLocal()이 스냅샷 완결성 검증 없이 로컬 재판정을 강행하고, idempotency 캐시가 그
// 오판을 고착시킨다. 이 파일은 다음 4건의 수정을 "실제 소스 추출 + new Function() 실행"
// 패턴(tests/build24-sync-snapshot-stability.test.mjs / build27-replay-force-start.test.mjs와 동일
// 방식, hand-copy 로직 검증 금지)으로 검증한다.
//   [수정1-a] finishRoundLocal(): 빈 스냅샷(activePlayers/prevSafeIds/prevLoserIds 전부 0) 판정 보류
//   [수정1-b] finishRoundLocal(): 술래 정원 충족(remainingSlots<=0 && confirmedLoser>=target) 시
//             남은 활성 인원 결과와 무관하게 즉시 gameOver
//   [수정2]   handleRoomUpdate(): stale room row(penalty에 인코딩된 gameRound < state.gameRound) 스킵
//   [수정3]   fetchFreshParticipantsForResult(): 판정 불가(choice 있는 활성 후보 0 + confirmed 0)
//             스냅샷을 "신선"으로 오판해 조기 return 하지 않고 재시도 계속
//   [수정4]   recordRoundResolution 헬퍼: localJudge & activePlayers=0 결과는 lastRoundResolution에
//             고착시키지 않음(idempotency 캐시 오염 방지)
//
// 판정 알고리즘 본체(judgePure/judgeRound/resolveElimination)는 무변경 — 이 테스트들도 그 경계를
// 넘지 않는다(judgeRound는 스텁으로 주입하고, 활성 참가자의 결과는 choice 인코딩("base|result")으로
// 미리 확정해 hasStoredResults 경로를 타게 하는 기존 컨벤션을 그대로 따른다).

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

function extractBlock(startMarker, endMarker, includeEndFirstChar = false) {
  const start = html.indexOf(startMarker);
  if (start < 0) throw new Error(`start marker not found: ${startMarker}`);
  let end = html.indexOf(endMarker, start);
  if (end < 0) throw new Error(`end marker not found: ${endMarker}`);
  if (includeEndFirstChar) end += 1;
  return html.slice(start, end);
}

// ── 실제 소스 블록 추출 ──────────────────────────────────────────────
const CHOICE_HELPERS_BLOCK = extractBlock(
  'function isNonPlayingChoice(choice) {',
  'function getParticipantSignature('
);
const SCHEDULING_BLOCK = extractBlock(
  'function toPositiveInt(value, fallback = 0) {',
  'function isLoserCountEditable() {'
);
const FINISH_ROUND_LOCAL_SRC = extractBlock(
  'async function finishRoundLocal() {',
  '// 오프라인/프로토타입용 원본 finishRound'
);
// handleRoomUpdate() 상단: Build28 stale 가드(Round2부터 penalty/gameRound 대입보다 먼저 위치,
// LOW-2) + penalty/gameRound 할당 + round===1 리셋 블록 + round/status 할당(oldStatus 캡처 포함).
const ROOM_UPDATE_HEAD_SRC = extractBlock(
  'if (!room) return;',
  'if (oldStatus !== state.status) {'
);
// Build30-R2 Phase B(WRPS-078): getUnresolvedActiveParticipants가 fetchFreshParticipantsForResult
// 내부 지역 함수(unresolvedOf)에서 모듈 스코프로 끌어올려졌다 — 실제 소스를 함께 추출한다.
const GET_UNRESOLVED_ACTIVE_PARTICIPANTS_SRC = extractBlock(
  'function getUnresolvedActiveParticipants(rows) {',
  'async function fetchFreshParticipantsForResult(roomCode, maxRetries = 2, delayMs = 300, isContextStillValid = null) {'
);
const FETCH_FRESH_SRC = extractBlock(
  'async function fetchFreshParticipantsForResult(roomCode, maxRetries = 2, delayMs = 300, isContextStillValid = null) {',
  'function syncConfirmedIdsFromParticipants(participants = state.participants) {'
);
// HIGH-1 검증용: canShowPlayAgainButton()/isTaggerSelectionComplete()/getActivePlayers() 실제 소스
// (tests/build23-play-again-guard.test.mjs와 동일한 추출 마커/패턴).
const PENALTY_BLOCK = extractBlock(
  'function toPositiveInt(value, fallback = 0) {',
  'function getCountdownStartAt(raw) {'
);
const GUARD_BLOCK = extractBlock(
  'function getActivePlayers() {',
  'function isJoinLocked('
);
// Round3 NEW-HIGH-1(2)/NEW-MEDIUM-1/NEW-LOW-1 검증용: 타이머 취소·카운터 초기화가 실제로
// 방/세션 리셋 함수 3곳 모두에 들어갔는지 실제 소스 실행으로 검증한다.
const DISCARD_IN_PROGRESS_SRC = extractBlock(
  'function discardInProgressRoomSession() {',
  'function resetRoomLocalState({ keepRoomCode = "" } = {}) {'
);
const RESET_ROOM_LOCAL_STATE_SRC = extractBlock(
  'function resetRoomLocalState({ keepRoomCode = "" } = {}) {',
  'async function createRoom() {'
);
// tests/build24-sync-snapshot-stability.test.mjs와 동일한 마커(beginNewGameRound 전체).
const BEGIN_NEW_GAME_ROUND_SRC = extractBlock(
  'async function beginNewGameRound({ status = "lobby"',
  '// Build19(WRPS-072-B19): result/game_over 전환 시 참가자 스냅샷 완결성 보장'
);

// ── 로더 ────────────────────────────────────────────────────────────
function loadSchedulingHelpers(state) {
  const factory = new Function(
    'state', 'maxLoserCountFor',
    SCHEDULING_BLOCK +
      '\n; return { toPositiveInt, parsePenalty, getPenaltyText, getTargetLoserCount, getPenaltyGameRound, getGameRound, getCountdownStartAt, getChoiceEndAt, serverNow, getNextCountdownStartAt, buildPenaltyValue, getNextPhaseScheduledAt, getMaxLoserCount, clampLoserCount };'
  );
  // maxLoserCountFor는 이 테스트 범위에서 사용되지 않으므로 단순 스텁(참가자 수 그대로 반환)으로 충분.
  return factory(state, (n) => n);
}

function runRoomUpdateHead(room, state) {
  const emitted = [];
  const QA = { emit: (channel, data) => emitted.push(data) };
  const scheduling = loadSchedulingHelpers(state);
  const factory = new Function(
    'room', 'state', 'QA', 'getTargetLoserCount', 'getGameRound', 'getCountdownStartAt', 'getPenaltyGameRound', 'getChoiceEndAt', 'toPositiveInt',
    CHOICE_HELPERS_BLOCK + '\n(() => {\n' + ROOM_UPDATE_HEAD_SRC + '\nstate.status = room.status;\n})();'
  );
  factory(room, state, QA, scheduling.getTargetLoserCount, scheduling.getGameRound,
    scheduling.getCountdownStartAt, scheduling.getPenaltyGameRound, scheduling.getChoiceEndAt, scheduling.toPositiveInt);
  return emitted;
}

function loadFinishRoundLocal({ state, db, judgeRound, getOnlineMode, isConfirmedLoser, fetchFreshParticipantsForResult }) {
  const calls = {
    renderRoundResult: [], showScreen: [], playResultSfxOnce: [], playResultVoiceOnce: [],
    shadowCompute: [], shadowCompare: [], recordMyAccountGameResult: [], scheduleRematchAutoAdvance: 0,
    stopRoundTimers: 0, syncConfirmedIdsFromParticipants: 0, fetchFreshParticipantsForResult: 0,
    showTaggerPopup: 0, autoSaveGameOverResultOnce: 0,
  };
  const emitted = [];
  const QA = { emit: (channel, data) => emitted.push(data) };
  const renderRoundResult = (caseType, roundLoserCount, remainingSlots) =>
    calls.renderRoundResult.push({ caseType, roundLoserCount, remainingSlots });
  const showScreen = (id) => calls.showScreen.push(id);
  // Build30 Phase1: 확정 gameOver 렌더 직후 호출되는 술래 팝업 — 이 파일의 관심사(판정 정확성)와
  // 무관하므로 호출 여부만 카운트하는 no-op 스텁을 주입한다(실제 index.html 소스는 무변경 검증).
  const showTaggerPopup = () => { calls.showTaggerPopup++; };
  // Build30 Phase2: 확정 gameOver 시 이번 게임 결과 자동 저장 — 이 파일의 관심사(판정 정확성)와
  // 무관하므로 호출 여부만 카운트하는 no-op 스텁을 주입한다(실제 index.html 소스는 무변경 검증).
  const autoSaveGameOverResultOnce = () => { calls.autoSaveGameOverResultOnce++; };
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
  // Build28 Round2(MEDIUM-1): defer-retry가 참조하는 fetchFreshParticipantsForResult를 주입.
  // 기본값은 no-op(빈 배열 반환) — defer-retry 테스트에서만 실제 스텁을 넘긴다.
  const fetchFreshWrapped = (...args) => {
    calls.fetchFreshParticipantsForResult++;
    return (fetchFreshParticipantsForResult || (() => Promise.resolve([])))(...args);
  };
  const factory = new Function(
    'state', 'QA', 'db', 'getGameRound', 'getTargetLoserCount', 'getOnlineMode', 'judgeRound',
    'isConfirmedLoser', 'syncConfirmedIdsFromParticipants', 'renderRoundResult', 'showScreen',
    'playResultSfxOnce', 'playResultVoiceOnce', '__engineV2ShadowComputeRound', '__engineV2ShadowCompare',
    'recordMyAccountGameResult', 'scheduleRematchAutoAdvance', 'stopRoundTimers', 'fetchFreshParticipantsForResult',
    'showTaggerPopup', 'autoSaveGameOverResultOnce',
    CHOICE_HELPERS_BLOCK + '\n' + FINISH_ROUND_LOCAL_SRC + '\n; return finishRoundLocal;'
  );
  const finishRoundLocal = factory(
    state, QA, db, getGameRound, getTargetLoserCount, getOnlineMode || (() => true),
    judgeRound || (() => ({})), isConfirmedLoser || (() => false), syncConfirmedIdsFromParticipants,
    renderRoundResult, showScreen, playResultSfxOnce, playResultVoiceOnce,
    __engineV2ShadowComputeRound, __engineV2ShadowCompare, recordMyAccountGameResult,
    scheduleRematchAutoAdvance, stopRoundTimers, fetchFreshWrapped, showTaggerPopup, autoSaveGameOverResultOnce
  );
  return { finishRoundLocal, calls, emitted };
}

function makeDb() {
  const calls = [];
  const db = {
    from: (table) => ({
      update: (payload) => ({
        // WRPS-081: rooms.update()가 이제 .eq('id',...).eq('status','result')로 체이닝된다(조건부
        // game_over write) — 반환값이 thenable이면서 .eq()로 계속 체이닝 가능해야 한다.
        eq: (col, val) => { calls.push({ table, payload, col, val }); const result = Promise.resolve({ data: null, error: null }); result.eq = () => result; return result; },
      }),
    }),
  };
  return { db, calls };
}

function loadFetchFreshParticipantsForResult({ state, db, sleepImpl }) {
  const emitted = [];
  const QA = { emit: (channel, data) => emitted.push(data) };
  const syncConfirmedIdsFromParticipants = () => {};
  const sleep = sleepImpl || (() => Promise.resolve());
  const factory = new Function(
    'state', 'QA', 'db', 'sleep', 'syncConfirmedIdsFromParticipants',
    CHOICE_HELPERS_BLOCK + '\n' + GET_UNRESOLVED_ACTIVE_PARTICIPANTS_SRC + '\n' + FETCH_FRESH_SRC + '\n; return fetchFreshParticipantsForResult;'
  );
  const fetchFreshParticipantsForResult = factory(state, QA, db, sleep, syncConfirmedIdsFromParticipants);
  return { fetchFreshParticipantsForResult, emitted };
}

// HIGH-1 검증용 로더: canShowPlayAgainButton/isTaggerSelectionComplete/getActivePlayers 실제 소스를
// 그대로 실행한다(tests/build23-play-again-guard.test.mjs의 loadPlayAgainGuard와 동일 패턴).
function loadPlayAgainGuard({ participants, confirmedSafeIds = [], confirmedLoserIds = [], role = 'host', targetLoserCount = 1, lastRoundResolution = null, round = 1, gameRound = 1 }) {
  const state = {
    role, participants, confirmedSafeIds, confirmedLoserIds,
    penalty: { text: '', loserCount: targetLoserCount },
    targetLoserCount, lastRoundResolution, round, gameRound,
  };
  const emitted = [];
  const QA = { emit: (channel, data) => emitted.push(data) };
  const factory = new Function(
    'state', 'QA', 'computePlayerStatuses', 'PLAYER_STATUS',
    PENALTY_BLOCK + '\n' + GUARD_BLOCK +
    '\n; return { getActivePlayers, isTaggerSelectionComplete, canShowPlayAgainButton, blockPlayAgainIfPartialReplay, getTargetLoserCount, getGameRound };'
  );
  const guard = factory(state, QA, computePlayerStatuses, PLAYER_STATUS);
  return { guard, state, emitted };
}

// Round3 NEW-HIGH-1(2)/NEW-MEDIUM-1/NEW-LOW-1 검증용 로더: discardInProgressRoomSession은
// 외부 함수 의존이 전혀 없다(전부 state 필드 대입 + clearTimeout뿐) — 그대로 실행 가능.
function loadDiscardInProgressRoomSession(state) {
  const factory = new Function('state', DISCARD_IN_PROGRESS_SRC + '\n; return discardInProgressRoomSession;');
  return factory(state);
}

// resetRoomLocalState는 stopTimers/clearRealtime/$/getScopedLocalStorageItem/setScopedLocalStorageItem에
// 의존한다 — 전부 no-op/스텁으로 주입(이 테스트의 관심사는 roundJudgeDeferTimer 취소·카운터 초기화뿐).
function loadResetRoomLocalState(state) {
  const stopTimers = () => {};
  const clearRealtime = () => {};
  const $ = () => null; // countdownOverlay 등 DOM 조작은 이 테스트 범위 밖
  const getScopedLocalStorageItem = () => null;
  const setScopedLocalStorageItem = () => {};
  const factory = new Function(
    'state', 'stopTimers', 'clearRealtime', '$', 'getScopedLocalStorageItem', 'setScopedLocalStorageItem',
    RESET_ROOM_LOCAL_STATE_SRC + '\n; return resetRoomLocalState;'
  );
  return factory(state, stopTimers, clearRealtime, $, getScopedLocalStorageItem, setScopedLocalStorageItem);
}

// beginNewGameRound 로더 — tests/build24-sync-snapshot-stability.test.mjs의 loadBeginNewGameRound와
// 동일 스텁 구성(그 파일이 이미 실제 소스 실행으로 검증한 패턴을 그대로 재사용).
function loadBeginNewGameRound(state, scheduling) {
  const dbCalls = [];
  const db = {
    from: (table) => ({
      update: (payload) => ({
        eq: (col, val) => { dbCalls.push({ table, payload, col, val }); const result = Promise.resolve({ data: null, error: null }); result.eq = () => result; return result; },
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
  const factory = new Function(
    'state', 'db', 'hasCurrentGameRoundActivity', 'archiveCurrentRoundStats', 'resetTransientRoundUi',
    'getTargetLoserCount', 'getGameRound', 'getNextCountdownStartAt', 'buildPenaltyValue', 'getNextPhaseScheduledAt',
    'resetLocalParticipantsForNewGameRound', 'getOnlineMode', 'getNewGameRoundParticipantPatch', 'saveState',
    BEGIN_NEW_GAME_ROUND_SRC + '\n; return beginNewGameRound;'
  );
  const beginNewGameRound = factory(
    state, db, hasCurrentGameRoundActivity, archiveCurrentRoundStats, resetTransientRoundUi,
    scheduling.getTargetLoserCount, scheduling.getGameRound, scheduling.getNextCountdownStartAt,
    scheduling.buildPenaltyValue, scheduling.getNextPhaseScheduledAt,
    resetLocalParticipantsForNewGameRound, getOnlineMode, getNewGameRoundParticipantPatch, saveState
  );
  return { beginNewGameRound, dbCalls };
}

// MEDIUM-1(defer-retry) 검증용: 'participants' select+update와 'rooms' update를 모두 지원하는 db
// (finishRoundLocal의 hasStoredResults=false && status==='playing' 분기가 참가자별 통계 update도
// 호출하므로 select/update 양쪽 다 필요).
function makeCombinedDb({ participantRows }) {
  const calls = [];
  let selectCall = 0;
  const db = {
    from: (table) => ({
      select: () => ({
        eq: () => ({
          order: () => {
            const rows = typeof participantRows === 'function' ? participantRows(selectCall) : participantRows;
            selectCall += 1;
            calls.push({ table, op: 'select' });
            return Promise.resolve({ data: rows });
          },
        }),
      }),
      update: (payload) => ({
        eq: (col, val) => { calls.push({ table, op: 'update', payload, col, val }); const result = Promise.resolve({ data: null, error: null }); result.eq = () => result; return result; },
      }),
    }),
  };
  return { db, calls, getSelectCallCount: () => selectCall };
}

// ════════════════════════════════════════════════════════════════════
describe('Build28 [수정1-a] finishRoundLocal — 빈 스냅샷 판정 보류(회귀 테스트 #1)', () => {
  it('참가자 전원 choice=null, confirmed 0 → tooFew를 렌더하지 않고 보류(finishingRound 해제, lastRoundResolution 미기록)', async () => {
    // Build28 Round4(잔여 LOW-2, 테스트 위생): 이 defer 분기는 350ms 재시도 타이머를 예약한다
    // (7448행대). fake timer 없이 실행하면 이 테스트가 끝난 뒤에도 실제 타이머가 살아있다가
    // 나중에(발화 시 status가 'playing'이라 3중 가드에 걸려 abandon되므로 판정에는 무해하지만)
    // 다른 테스트의 타이머와 섞여 CI 노이즈가 될 수 있다. 585행대 Round2 defer-retry 테스트들이
    // 이미 쓰는 vi.useFakeTimers()/vi.useRealTimers() 패턴을 그대로 재사용해 실제 타이머 예약을
    // 막는다 — 아래 검증 내용(판정/렌더 없음, finishingRound 해제, ROUND_JUDGE_DEFERRED emit)은
    // 감싸기 전과 완전히 동일하며, 추가로 타이머가 예약됐다가(1개) 발화 후 정리되어(0개) 누수 없음도
    // 확인한다.
    vi.useFakeTimers();
    try {
      const state = {
        role: 'host', status: 'playing', round: 1, gameRound: 6, roomCode: 'R1', currentUserId: 'p1',
        confirmedSafeIds: [], confirmedLoserIds: [], targetLoserCount: 1, finishingRound: false,
        lastRoundResolution: null,
        participants: [
          { id: 'p1', is_host: true, choice: null },
          { id: 'p2', is_host: false, choice: null },
          { id: 'p3', is_host: false, choice: null },
        ],
      };
      const { db } = makeDb();
      const { finishRoundLocal, calls, emitted } = loadFinishRoundLocal({ state, db });
      await finishRoundLocal();
      expect(calls.renderRoundResult).toEqual([]); // 판정/렌더 없음
      expect(calls.showScreen).toEqual([]);
      expect(state.finishingRound).toBe(false); // 다음 폴링에서 재시도 가능
      expect(state.lastRoundResolution).toBe(null); // 캐시 기록 없음
      const deferred = emitted.find((e) => e.eventType === 'ROUND_JUDGE_DEFERRED');
      expect(deferred).toBeTruthy();
      expect(deferred.wrps).toBe('WRPS-075');
      expect(deferred.reason).toBe('emptySnapshot');
      expect(deferred.eventId).toBe('6:1');
      expect(deferred.activeCount).toBe(0);
      expect(deferred.participantCount).toBe(3);
      // Build28 Round4(잔여 LOW-2): defer 재시도 타이머가 실제로 예약됐는지(1개) 확인.
      expect(vi.getTimerCount()).toBe(1);
      // status가 여전히 'playing'(3중 가드 중 status 화이트리스트 불통과)이므로 발화 시 즉시
      // abandon되어야 하고, 그 뒤에는 예약된 타이머가 남지 않아야 한다(누수 없음).
      await vi.advanceTimersByTimeAsync(400);
      expect(emitted.some((e) => e.eventType === 'ROUND_JUDGE_RETRY_ABANDONED' && e.reason === 'statusChanged')).toBe(true);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('Build28 [수정1-a 비침습] finishRoundLocal — 정당한 gameOver 재진입은 여전히 렌더된다(회귀 테스트 #2)', () => {
  it('전원 confirmed, activePlayers=0, remainingSlots=0 → gameOver가 여전히 렌더된다(1-a가 이 경로를 막지 않음)', async () => {
    const state = {
      role: 'host', status: 'result', round: 1, gameRound: 1, roomCode: 'R1', currentUserId: 'p1',
      confirmedSafeIds: ['p2', 'p3'], confirmedLoserIds: ['p1'], targetLoserCount: 1, finishingRound: false,
      lastRoundResolution: null,
      // Build29(WRPS-076) [P3] 실사실성 수정: 이번 라운드의 결정적 판정으로 방금 confirmed된
      // 참가자는 publishHostRoundResult()가 이미 "base|result"로 인코딩해 DB에 커밋한 뒤이므로
      // (7586 부근 주석 참고), 실제로는 순수 '__loser__'/'__safe__' 마커가 아니라 이렇게 인코딩된
      // choice를 갖는다 — 마커는 nextRound()/startGame()이 "다음" 라운드를 준비할 때만 쓰인다.
      // 이 구분이 바로 P3 가드(stale 마커만으로 구성된 정원충족 vs 실제 인코딩된 정원충족)의
      // 판별 기준이므로, 이 회귀 테스트도 실제 프로덕션 데이터 형태로 맞춘다(동작/기대값은 동일).
      participants: [
        { id: 'p1', is_host: true, choice: 'rock|lose' },
        { id: 'p2', is_host: false, choice: 'paper|win' },
        { id: 'p3', is_host: false, choice: 'paper|win' },
      ],
    };
    const { db, calls: dbCalls } = makeDb();
    const { finishRoundLocal, calls, emitted } = loadFinishRoundLocal({ state, db });
    await finishRoundLocal();
    expect(calls.renderRoundResult).toEqual([{ caseType: 'gameOver', roundLoserCount: 0, remainingSlots: 0 }]);
    expect(calls.showScreen).toEqual(['screenRoundResult']);
    expect(state.finishingRound).toBe(false);
    // 이 경로는 결함C 케이스와 동일하게 1-b(ROUND_GAMEOVER_SLOTS_FILLED)로 처리된다.
    const filled = emitted.find((e) => e.eventType === 'ROUND_GAMEOVER_SLOTS_FILLED');
    expect(filled).toBeTruthy();
    expect(filled.confirmedLoserCount).toBe(1);
    expect(filled.targetCount).toBe(1);
    // host이므로 rooms.status='game_over' write가 실제로 나간다.
    const roomsCall = dbCalls.find((c) => c.table === 'rooms');
    expect(roomsCall.payload.status).toBe('game_over');
  });
});

describe('Build28 [수정1-b] finishRoundLocal — 술래 정원 충족 시 즉시 gameOver(결함C, 회귀 테스트 #3)', () => {
  it('remainingSlots<=0 & confirmedLoser>=target & activePlayers=1(그 1명 draw) → allDraw가 아니라 gameOver', async () => {
    const state = {
      role: 'host', status: 'playing', round: 1, gameRound: 7, roomCode: 'R1', currentUserId: 'p3',
      confirmedSafeIds: [], confirmedLoserIds: ['p1', 'p2'], targetLoserCount: 2, finishingRound: false,
      lastRoundResolution: null,
      participants: [
        { id: 'p1', is_host: true, choice: '__loser__' },
        { id: 'p2', is_host: false, choice: '__loser__' },
        { id: 'p3', is_host: false, choice: 'rock|draw' }, // 유일한 활성 참가자, draw
      ],
    };
    const { db } = makeDb();
    const { finishRoundLocal, calls, emitted } = loadFinishRoundLocal({ state, db });
    await finishRoundLocal();
    expect(calls.renderRoundResult).toEqual([{ caseType: 'gameOver', roundLoserCount: 0, remainingSlots: 0 }]);
    expect(calls.renderRoundResult[0].caseType).not.toBe('draw'); // allDraw로 새지 않음
    const filled = emitted.find((e) => e.eventType === 'ROUND_GAMEOVER_SLOTS_FILLED');
    expect(filled).toBeTruthy();
    expect(filled.eventId).toBe('7:1');
    expect(filled.activeCount).toBe(1);
    expect(filled.confirmedLoserCount).toBe(2);
    expect(filled.targetCount).toBe(2);
    // confirmedLoserIds는 추가 없이 그대로 유지(p3은 loser로 새로 추가되지 않음).
    expect(state.confirmedLoserIds).toEqual(['p1', 'p2']);
    // Build28 Round2(codex-critic HIGH-1): 술래 정원이 이미 찼으므로 잔여 활성자(p3)는 정의상
    // safe다 — confirmedSafeIds에 반드시 포함되어야 한다(미분류로 남기지 않음).
    expect(state.confirmedSafeIds).toEqual(['p3']);
  });
});

describe('Build28 Round2 [HIGH-1] finishRoundLocal 1-b 이후 — 한번더 버튼이 정당하게 노출된다(회귀 테스트 #3-b)', () => {
  it('1-b 종료 후 getActivePlayers().length===0 이고 canShowPlayAgainButton()이 host에서 true', async () => {
    // codex-critic이 지적한 실패 시나리오 그대로: 술래 정원이 찬 상태(conf=target)에서 잔여 활성
    // 1명(choice='paper|win')이 있는 스냅샷으로 finishRoundLocal 진입.
    const state = {
      role: 'host', status: 'playing', round: 1, gameRound: 7, roomCode: 'R1', currentUserId: 'p3',
      confirmedSafeIds: [], confirmedLoserIds: ['p1', 'p2'], targetLoserCount: 2, finishingRound: false,
      lastRoundResolution: null,
      participants: [
        { id: 'p1', is_host: true, choice: '__loser__' },
        { id: 'p2', is_host: false, choice: '__loser__' },
        { id: 'p3', is_host: false, choice: 'paper|win' },
      ],
    };
    const { db } = makeDb();
    const { finishRoundLocal } = loadFinishRoundLocal({ state, db });
    await finishRoundLocal();
    // 수정 전(회귀): p3이 미분류로 남아 getActivePlayers()가 p3을 계속 ACTIVE로 세고
    // canShowPlayAgainButton()이 false로 고착되어 host의 '한번더'가 영구 숨겨졌다.
    const { guard } = loadPlayAgainGuard({
      participants: state.participants,
      confirmedSafeIds: state.confirmedSafeIds,
      confirmedLoserIds: state.confirmedLoserIds,
      role: 'host',
      targetLoserCount: 2,
    });
    expect(guard.getActivePlayers().length).toBe(0);
    expect(guard.isTaggerSelectionComplete()).toBe(true);
    expect(guard.canShowPlayAgainButton()).toBe(true);
  });
});

describe('Build28 [수정2] handleRoomUpdate — stale room row 전이 차단(결함A, 회귀 테스트 #4)', () => {
  it('stale room row(roomGameRound < state.gameRound) 수신 → state.round 이월 안 됨, status 전이 처리 스킵', () => {
    // 실측 재현: 로컬은 이미 gameNo 6으로 넘어갔는데(state.gameRound=6), 이전 게임(gameNo 5)의 늦게
    // 도착한 room row가 round:2, penalty.gameRound:5를 들고 옴.
    // Build28 Round3(codex-critic NEW-LOW-3-a): state.penalty/countdownStartAt에 "원본과 확실히
    // 구분되는" 값을 미리 심어둔다 — 이 가드가 (LOW-2 수정대로) 대입 이전 위치에 있어야만 이
    // 값들이 stale row로 덮이지 않는다는 걸 증명하기 위함이다. 가드를 Round 1 위치(대입 이후)로
    // 되돌리면 이 assert가 즉시 실패해야 한다(아래 mutation 자가검증에서 실제로 확인).
    const state = {
      role: 'host', status: 'playing', round: 1, gameRound: 6, roomCode: 'R1',
      confirmedSafeIds: [], confirmedLoserIds: [], targetLoserCount: 1,
      confirmedIdsResetGameNo: 'R1:6', renderedPhaseKeys: {}, renderedPhaseKeysGameNo: 6,
      penalty: { text: 'ORIGINAL-UNCHANGED', loserCount: 1, gameRound: 6 },
      countdownStartAt: 424242,
      participants: [{ id: 'p1', is_host: true, choice: 'rock' }],
    };
    const staleRoom = { round: 2, status: 'result', penalty: { text: 'STALE-SHOULD-NOT-LAND', loserCount: 1, gameRound: 5 } };
    const emitted = runRoomUpdateHead(staleRoom, state);
    expect(state.round).toBe(1); // 이월되지 않음(여전히 로컬 값 유지)
    expect(state.status).toBe('playing'); // status 전이도 적용되지 않음
    // NEW-LOW-3-a: stale row 조기 return 시 penalty/countdownStartAt 자체가 갱신되지 않아야 한다
    // (LOW-2가 옮긴 가드 위치를 이 테스트가 직접 고정 — round/status만으로는 위치 회귀를 못 잡는다).
    expect(state.penalty).toEqual({ text: 'ORIGINAL-UNCHANGED', loserCount: 1, gameRound: 6 });
    expect(state.countdownStartAt).toBe(424242);
    const stale = emitted.find((e) => e.eventType === 'STALE_ROOM_UPDATE_SKIPPED');
    expect(stale).toBeTruthy();
    expect(stale.wrps).toBe('WRPS-075');
    expect(stale.roomGameRound).toBe(5);
    expect(stale.localGameRound).toBe(6);
    expect(stale.roomRound).toBe(2);
    expect(stale.roomStatus).toBe('result');
  });

  it('신선한 room row(roomGameRound >= state.gameRound)는 여전히 정상 처리된다(회귀 없음)', () => {
    const state = {
      role: 'host', status: 'playing', round: 1, gameRound: 6, roomCode: 'R1',
      confirmedSafeIds: [], confirmedLoserIds: [], targetLoserCount: 1,
      confirmedIdsResetGameNo: 'R1:6', renderedPhaseKeys: {}, renderedPhaseKeysGameNo: 6,
      participants: [{ id: 'p1', is_host: true, choice: 'rock' }],
    };
    const freshRoom = { round: 2, status: 'playing', penalty: { text: '', loserCount: 1, gameRound: 6 } };
    const emitted = runRoomUpdateHead(freshRoom, state);
    expect(state.round).toBe(2); // 정상 이월
    expect(state.status).toBe('playing');
    expect(emitted.some((e) => e.eventType === 'STALE_ROOM_UPDATE_SKIPPED')).toBe(false);
  });

  it('penalty에 gameRound 필드가 없음(파싱 결과 0, "알 수 없음") → stale로 오판하지 않고 기존 경로 유지', () => {
    const state = {
      role: 'host', status: 'waiting', round: 1, gameRound: 3, roomCode: 'R1',
      confirmedSafeIds: [], confirmedLoserIds: [], targetLoserCount: 1,
      confirmedIdsResetGameNo: 'R1:3', renderedPhaseKeys: {}, renderedPhaseKeysGameNo: 3,
      participants: [{ id: 'p1', is_host: true, choice: null }],
    };
    const legacyRoom = { round: 2, status: 'ready', penalty: { text: '' } }; // gameRound 필드 자체가 없음
    const emitted = runRoomUpdateHead(legacyRoom, state);
    expect(state.round).toBe(2); // 정상 이월(막히지 않음)
    expect(state.status).toBe('ready');
    expect(emitted.some((e) => e.eventType === 'STALE_ROOM_UPDATE_SKIPPED')).toBe(false);
  });
});

describe('Build28 [수정3] fetchFreshParticipantsForResult — 빈 choice 스냅샷을 신선으로 오판하지 않음(결함B, 회귀 테스트 #5)', () => {
  it('전원 choice=null 스냅샷(confirmed 0) → 첫 시도에 return하지 않고 재시도한다(2회째에 실제 데이터 도착)', async () => {
    const state = { confirmedSafeIds: [], confirmedLoserIds: [], participants: [] };
    const emptyRows = [
      { id: 'p1', choice: null },
      { id: 'p2', choice: null },
      { id: 'p3', choice: null },
    ];
    const realRows = [
      { id: 'p1', choice: 'rock|lose' },
      { id: 'p2', choice: 'paper|win' },
      { id: 'p3', choice: 'paper|win' },
    ];
    let call = 0;
    const db = {
      from: () => ({
        select: () => ({
          eq: () => ({
            order: () => {
              call += 1;
              return Promise.resolve({ data: call === 1 ? emptyRows : realRows });
            },
          }),
        }),
      }),
    };
    const { fetchFreshParticipantsForResult, emitted } = loadFetchFreshParticipantsForResult({ state, db, sleepImpl: () => Promise.resolve() });
    const data = await fetchFreshParticipantsForResult('R1', 2, 1);
    expect(call).toBeGreaterThanOrEqual(2); // 첫 시도에서 끝나지 않고 재조회했다
    expect(data).toEqual(realRows);
    const retryMetric = emitted.find((e) => e.eventType === 'SNAPSHOT_UNJUDGEABLE_RETRY');
    expect(retryMetric).toBeTruthy();
    expect(retryMetric.wrps).toBe('WRPS-075');
    expect(retryMetric.attempt).toBe(0);
  });

  it('회귀 없음: 확정자가 이미 있는 정상 종료 스냅샷(conf=2/2, choice 있는 활성 row 0건)은 재시도 없이 첫 시도에 통과한다', async () => {
    const state = { confirmedSafeIds: ['p2'], confirmedLoserIds: ['p1'], participants: [] };
    const gameOverRows = [
      { id: 'p1', choice: '__loser__' },
      { id: 'p2', choice: '__safe__' },
    ];
    let call = 0;
    const db = {
      from: () => ({
        select: () => ({
          eq: () => ({
            order: () => { call += 1; return Promise.resolve({ data: gameOverRows }); },
          }),
        }),
      }),
    };
    const { fetchFreshParticipantsForResult, emitted } = loadFetchFreshParticipantsForResult({ state, db });
    const data = await fetchFreshParticipantsForResult('R1', 2, 1);
    expect(call).toBe(1); // 재시도 없이 즉시 통과
    expect(data).toEqual(gameOverRows);
    expect(emitted.some((e) => e.eventType === 'SNAPSHOT_UNJUDGEABLE_RETRY')).toBe(false);
  });

  it('회귀 없음: choice가 있는 미해결 참가자가 있으면 기존 TAGGER_SNAPSHOT_STALE 재시도 경로가 그대로 동작한다', async () => {
    const state = { confirmedSafeIds: [], confirmedLoserIds: [], participants: [] };
    const staleRows = [{ id: 'p1', choice: 'rock' }]; // choiceBase는 있지만 result 미확정
    let call = 0;
    const db = {
      from: () => ({
        select: () => ({
          eq: () => ({
            order: () => { call += 1; return Promise.resolve({ data: staleRows }); },
          }),
        }),
      }),
    };
    const { fetchFreshParticipantsForResult, emitted } = loadFetchFreshParticipantsForResult({ state, db, sleepImpl: () => Promise.resolve() });
    await fetchFreshParticipantsForResult('R1', 1, 1);
    expect(emitted.some((e) => e.eventType === 'TAGGER_SNAPSHOT_STALE')).toBe(true);
    expect(emitted.some((e) => e.eventType === 'SNAPSHOT_UNJUDGEABLE_RETRY')).toBe(false);
  });
});

describe('Build28 [수정4] recordRoundResolution — localJudge & activePlayers=0 결과는 캐시하지 않는다(회귀 테스트 #6)', () => {
  it('localJudge(hasStoredResults=false) & activePlayers=0 결과(1-b 경유) → lastRoundResolution 미기록', async () => {
    // hasStoredResults=false가 되도록 활성 후보(choiceBase 있는 미확정 row) 자체가 없는 스냅샷 구성 —
    // 참가자 전원이 이미 confirmed(마커) 상태라 activeForStoredResult가 비어 hasStoredResults=false.
    // Build29(WRPS-076) [P3] 실사실성 수정: choice는 마커가 아니라 실제 인코딩된 결과("base|result")
    // — 위 회귀 테스트 #2와 동일한 이유(publishHostRoundResult가 이미 커밋한 뒤 상태를 반영).
    const state = {
      role: 'host', status: 'result', round: 1, gameRound: 9, roomCode: 'R1', currentUserId: 'p1',
      confirmedSafeIds: [], confirmedLoserIds: ['p1', 'p2'], targetLoserCount: 2, finishingRound: false,
      lastRoundResolution: null,
      participants: [
        { id: 'p1', is_host: true, choice: 'rock|lose' },
        { id: 'p2', is_host: false, choice: 'scissors|lose' },
      ],
    };
    const { db } = makeDb();
    const { finishRoundLocal, calls } = loadFinishRoundLocal({ state, db });
    await finishRoundLocal();
    expect(calls.renderRoundResult).toEqual([{ caseType: 'gameOver', roundLoserCount: 0, remainingSlots: 0 }]);
    expect(state.lastRoundResolution).toBe(null); // localJudge & activePlayers=0 → 캐시하지 않음
  });

  it('정상 판정 결과(activePlayers>0)는 기존과 동일하게 lastRoundResolution에 기록된다(Build19 idempotency 회귀 방지)', async () => {
    const state = {
      role: 'host', status: 'playing', round: 3, gameRound: 2, roomCode: 'R1', currentUserId: 'p1',
      confirmedSafeIds: [], confirmedLoserIds: [], targetLoserCount: 1, finishingRound: false,
      lastRoundResolution: null,
      participants: [
        { id: 'p1', is_host: true, choice: 'rock|lose' },
        { id: 'p2', is_host: false, choice: 'paper|win' },
      ],
    };
    const { db } = makeDb();
    const { finishRoundLocal, calls } = loadFinishRoundLocal({ state, db });
    await finishRoundLocal();
    expect(calls.renderRoundResult).toEqual([{ caseType: 'gameOver', roundLoserCount: 1, remainingSlots: 1 }]);
    expect(state.lastRoundResolution).toBeTruthy(); // 정상 판정은 그대로 기록됨
    expect(state.lastRoundResolution.eventId).toBe('2:3');
    expect(state.lastRoundResolution.outcome).toBe('gameOver');
    // 동일 eventId 재호출 시 idempotent 재생 경로(TAGGER_REPLAY_IDEMPOTENT)를 탄다(회귀 없음).
    state.finishingRound = false;
    const { finishRoundLocal: second, calls: calls2, emitted: emitted2 } = loadFinishRoundLocal({ state, db });
    await second();
    expect(emitted2.some((e) => e.eventType === 'TAGGER_REPLAY_IDEMPOTENT')).toBe(true);
    expect(calls2.renderRoundResult).toEqual([{ caseType: 'gameOver', roundLoserCount: 1, remainingSlots: 1 }]);
  });
});

describe('Build28 Round2 [MEDIUM-1] finishRoundLocal 빈 스냅샷 defer — bounded 재시도(회귀 테스트 #7)', () => {
  it('defer 발생 후 실제로 재판정이 일어나 정상 렌더로 이어진다(fetchFreshParticipantsForResult로 최신 데이터 확보 후 재귀 판정)', async () => {
    vi.useFakeTimers();
    try {
      // Build28 Round3(codex-critic NEW-HIGH-1): status는 실제 호출 불변식(5447)과 일치하는
      // 'result'로 둔다 — defer-retry 발화 시 3중 가드(roomCode/eventId/status)가 status까지
      // 검사하므로, 정당한 재시도임을 증명하려면 처음부터 실제로 정당한 status여야 한다.
      const state = {
        role: 'host', status: 'result', round: 1, gameRound: 6, roomCode: 'R1', currentUserId: 'p1',
        confirmedSafeIds: [], confirmedLoserIds: [], targetLoserCount: 1, finishingRound: false,
        lastRoundResolution: null,
        participants: [
          { id: 'p1', is_host: true, choice: null },
          { id: 'p2', is_host: false, choice: null },
        ],
      };
      let selectCall = 0;
      const { db } = makeCombinedDb({
        participantRows: () => {
          selectCall += 1;
          // 첫 조회는 여전히 빈 스냅샷(아직 반영 전), 두 번째부터는 실제 데이터 도착.
          return selectCall === 1
            ? [{ id: 'p1', choice: null }, { id: 'p2', choice: null }]
            : [{ id: 'p1', choice: 'rock|lose' }, { id: 'p2', choice: 'paper|win' }];
        },
      });
      const fetchFreshParticipantsForResult = async (roomCode) => {
        const { data } = await db.from('participants').select('*').eq('room_id', roomCode).order('created_at', {});
        state.participants = data;
        return data;
      };
      const { finishRoundLocal, calls, emitted } = loadFinishRoundLocal({ state, db, fetchFreshParticipantsForResult });

      await finishRoundLocal();
      // 1차: defer됨 — 판정/렌더 없음, finishingRound 해제, 재시도 1회 예약됨.
      expect(calls.renderRoundResult).toEqual([]);
      expect(state.finishingRound).toBe(false);
      expect(emitted.filter((e) => e.eventType === 'ROUND_JUDGE_DEFERRED').length).toBe(1);

      // 예약된 재시도(350ms) 발동 — fetchFreshParticipantsForResult가 여전히 빈 스냅샷을 반환해
      // 2차 defer(카운터 소모)까지 재현한 뒤, 그 다음 재시도에서 실제 데이터가 도착해 정상 판정.
      await vi.advanceTimersByTimeAsync(400); // 재시도 #1: 여전히 빈 스냅샷 → 2차 defer
      await vi.advanceTimersByTimeAsync(400); // 재시도 #2: 실제 데이터 도착 → 정상 판정

      expect(calls.renderRoundResult.length).toBe(1);
      expect(calls.renderRoundResult[0].caseType).toBe('gameOver');
      expect(state.lastRoundResolution).toBeTruthy(); // 정상 판정은 캐시됨(수정4 회귀 없음)
      expect(emitted.some((e) => e.eventType === 'ROUND_JUDGE_DEFER_EXHAUSTED')).toBe(false); // 소진 전에 성공
      // Build28 Round3(codex-critic NEW-HIGH-1 정상 케이스): roomCode/eventId/status 중 아무것도
      // 바뀌지 않았으므로 3중 가드 중 어느 것도 재시도를 포기시키지 않아야 한다.
      expect(emitted.some((e) => e.eventType === 'ROUND_JUDGE_RETRY_ABANDONED')).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('재시도 상한(2회) 소진 시 더 이상 재시도하지 않고 안전하게 멈춘다(ROUND_JUDGE_DEFER_EXHAUSTED emit)', async () => {
    vi.useFakeTimers();
    try {
      // Build28 Round3(codex-critic NEW-HIGH-1): status는 실제 호출 불변식(5447)과 일치하는
      // 'result'로 둔다 — 위 테스트와 동일한 이유.
      const state = {
        role: 'host', status: 'result', round: 1, gameRound: 6, roomCode: 'R1', currentUserId: 'p1',
        confirmedSafeIds: [], confirmedLoserIds: [], targetLoserCount: 1, finishingRound: false,
        lastRoundResolution: null,
        participants: [
          { id: 'p1', is_host: true, choice: null },
          { id: 'p2', is_host: false, choice: null },
        ],
      };
      // 이 db는 절대 실제 데이터를 주지 않는다(영구 stale 시나리오) — 재시도가 무한히 반복되지
      // 않고 상한(2회)에서 멈추는지 검증.
      const { db } = makeCombinedDb({ participantRows: [{ id: 'p1', choice: null }, { id: 'p2', choice: null }] });
      const fetchFreshParticipantsForResult = async (roomCode) => {
        const { data } = await db.from('participants').select('*').eq('room_id', roomCode).order('created_at', {});
        state.participants = data;
        return data;
      };
      const { finishRoundLocal, calls, emitted } = loadFinishRoundLocal({ state, db, fetchFreshParticipantsForResult });

      await finishRoundLocal();
      // 재시도 #1, #2를 모두 소진할 때까지 충분히 시간을 흘려보낸다.
      await vi.advanceTimersByTimeAsync(400);
      await vi.advanceTimersByTimeAsync(400);
      await vi.advanceTimersByTimeAsync(400);
      // 여분으로 더 흘려도 추가 타이머가 없어야 한다(무한 루프/무한 타이머 금지 보장).
      await vi.advanceTimersByTimeAsync(2000);

      expect(calls.renderRoundResult).toEqual([]); // 끝내 판정되지 않음(허용된 트레이드오프)
      const deferredCount = emitted.filter((e) => e.eventType === 'ROUND_JUDGE_DEFERRED').length;
      expect(deferredCount).toBe(3); // 최초 1회 + 재시도 2회 = 3회 defer 후 소진
      const exhausted = emitted.find((e) => e.eventType === 'ROUND_JUDGE_DEFER_EXHAUSTED');
      expect(exhausted).toBeTruthy();
      expect(exhausted.wrps).toBe('WRPS-075');
      expect(exhausted.eventId).toBe('6:1');
      expect(exhausted.attempts).toBe(2);
      expect(vi.getTimerCount()).toBe(0); // 예약된 타이머가 더 이상 남아있지 않음
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('Build28 Round2 [LOW-1] handleRoomUpdate stale-skip self-heal — 연속 5회 skip 후 자가 회복(회귀 테스트 #8)', () => {
  it('동일 stale row가 5회 연속 수신되면 5번째에 STALE_ROOM_UPDATE_SELF_HEAL을 emit하고 통과시킨다', () => {
    const state = {
      role: 'host', status: 'playing', round: 1, gameRound: 6, roomCode: 'R1',
      confirmedSafeIds: [], confirmedLoserIds: [], targetLoserCount: 1,
      confirmedIdsResetGameNo: 'R1:6', renderedPhaseKeys: {}, renderedPhaseKeysGameNo: 6,
      participants: [{ id: 'p1', is_host: true, choice: 'rock' }],
    };
    const staleRoom = { round: 2, status: 'result', penalty: { text: '', loserCount: 1, gameRound: 5 } };
    let lastEmitted = [];
    for (let i = 1; i <= 4; i++) {
      lastEmitted = runRoomUpdateHead(staleRoom, state);
      expect(lastEmitted.some((e) => e.eventType === 'STALE_ROOM_UPDATE_SELF_HEAL')).toBe(false);
      expect(lastEmitted.some((e) => e.eventType === 'STALE_ROOM_UPDATE_SKIPPED')).toBe(true);
      expect(state.round).toBe(1); // 여전히 이월되지 않음
    }
    // 5번째 연속 skip → self-heal 발동, 이번엔 막지 않고 통과.
    lastEmitted = runRoomUpdateHead(staleRoom, state);
    const healed = lastEmitted.find((e) => e.eventType === 'STALE_ROOM_UPDATE_SELF_HEAL');
    expect(healed).toBeTruthy();
    expect(healed.wrps).toBe('WRPS-075');
    expect(healed.consecutiveSkips).toBe(5);
    expect(healed.roomGameRound).toBe(5);
    expect(healed.localGameRound).toBe(6);
    expect(state.round).toBe(2); // 이번엔 통과되어 이월됨
    expect(state.status).toBe('result');
  });

  it('정상 row가 중간에 한 번이라도 처리되면 연속 skip 카운터가 리셋된다(오탐 self-heal 방지)', () => {
    const state = {
      role: 'host', status: 'playing', round: 1, gameRound: 6, roomCode: 'R1',
      confirmedSafeIds: [], confirmedLoserIds: [], targetLoserCount: 1,
      confirmedIdsResetGameNo: 'R1:6', renderedPhaseKeys: {}, renderedPhaseKeysGameNo: 6,
      participants: [{ id: 'p1', is_host: true, choice: 'rock' }],
    };
    const staleRoom = { round: 2, status: 'result', penalty: { text: '', loserCount: 1, gameRound: 5 } };
    for (let i = 1; i <= 3; i++) {
      runRoomUpdateHead(staleRoom, state);
    }
    // 정상(fresh) row 1건 처리 — 카운터가 0으로 리셋되어야 한다.
    const freshRoom = { round: 3, status: 'playing', penalty: { text: '', loserCount: 1, gameRound: 6 } };
    runRoomUpdateHead(freshRoom, state);
    // 다시 4회 연속 stale이 와도(합쳐서 7회지만 리셋 후 4회이므로) 아직 self-heal이 발동하지 않아야 한다.
    let lastEmitted = [];
    for (let i = 1; i <= 4; i++) {
      lastEmitted = runRoomUpdateHead(staleRoom, state);
    }
    expect(lastEmitted.some((e) => e.eventType === 'STALE_ROOM_UPDATE_SELF_HEAL')).toBe(false);
    expect(lastEmitted.some((e) => e.eventType === 'STALE_ROOM_UPDATE_SKIPPED')).toBe(true);
  });
});

// ════════════════════════════════════════════════════════════════════
// Build28 Round3 — codex-critic Round2 재검토 결과(VERDICT: FAIL, HIGH 1건) 대응.
// NEW-HIGH-1: defer-retry setTimeout이 예약 시점 컨텍스트를 캡처하지 않고 발화 시 상태 일치도
// 확인하지 않아, host의 scheduleRematchAutoAdvance(2.6s)가 먼저(또는 fetch 도중) 다음 라운드로
// 전이시키면 뒤늦게 깨어난 재시도가 "새 라운드"에 팬텀 판정을 실행하는 결함A 클래스가 재발했다.
describe('Build28 Round3 [NEW-HIGH-1] defer-retry 3중 가드 — 예약 후 컨텍스트가 바뀌면 재시도를 포기한다(회귀 테스트 #9)', () => {
  it('타이머 발화 전 roomCode가 바뀌면(방 이동) reason=roomChanged로 즉시 포기하고 fetch조차 시도하지 않는다', async () => {
    vi.useFakeTimers();
    try {
      const state = {
        role: 'host', status: 'result', round: 1, gameRound: 6, roomCode: 'R1', currentUserId: 'p1',
        confirmedSafeIds: [], confirmedLoserIds: [], targetLoserCount: 1, finishingRound: false,
        lastRoundResolution: null,
        participants: [
          { id: 'p1', is_host: true, choice: null },
          { id: 'p2', is_host: false, choice: null },
        ],
      };
      const { db } = makeDb();
      const fetchFreshParticipantsForResult = async () => { throw new Error('roomChanged 가드 통과 전에는 fetch가 호출되면 안 된다'); };
      const { finishRoundLocal, calls, emitted } = loadFinishRoundLocal({ state, db, fetchFreshParticipantsForResult });

      await finishRoundLocal();
      expect(emitted.filter((e) => e.eventType === 'ROUND_JUDGE_DEFERRED').length).toBe(1);

      // 타이머 발화 전 방을 이동(호스트 승계/방 나가기 등으로 roomCode가 바뀌는 상황을 모사).
      state.roomCode = 'R2';
      await vi.advanceTimersByTimeAsync(400);

      expect(calls.renderRoundResult).toEqual([]); // 재판정이 실행되지 않았다
      expect(calls.fetchFreshParticipantsForResult).toBe(0); // fetch도 시도되지 않았다(전위 가드에서 즉시 포기)
      const abandoned = emitted.find((e) => e.eventType === 'ROUND_JUDGE_RETRY_ABANDONED');
      expect(abandoned).toBeTruthy();
      expect(abandoned.wrps).toBe('WRPS-075');
      expect(abandoned.reason).toBe('roomChanged');
      expect(abandoned.capturedEventId).toBe('6:1');
    } finally {
      vi.useRealTimers();
    }
  });

  it('타이머 발화 전 round가 바뀌어 eventId가 달라지면 reason=contextChanged로 포기한다', async () => {
    vi.useFakeTimers();
    try {
      const state = {
        role: 'host', status: 'result', round: 1, gameRound: 6, roomCode: 'R1', currentUserId: 'p1',
        confirmedSafeIds: [], confirmedLoserIds: [], targetLoserCount: 1, finishingRound: false,
        lastRoundResolution: null,
        participants: [
          { id: 'p1', is_host: true, choice: null },
          { id: 'p2', is_host: false, choice: null },
        ],
      };
      const { db } = makeDb();
      const fetchFreshParticipantsForResult = async () => { throw new Error('contextChanged 가드 통과 전에는 fetch가 호출되면 안 된다'); };
      const { finishRoundLocal, calls, emitted } = loadFinishRoundLocal({ state, db, fetchFreshParticipantsForResult });

      await finishRoundLocal();
      expect(emitted.filter((e) => e.eventType === 'ROUND_JUDGE_DEFERRED').length).toBe(1);

      // 타이머 발화 전 다음 라운드로 이미 진행됨(round 증가) — eventId가 "6:1"→"6:2"로 바뀐다.
      state.round = 2;
      await vi.advanceTimersByTimeAsync(400);

      expect(calls.renderRoundResult).toEqual([]);
      expect(calls.fetchFreshParticipantsForResult).toBe(0);
      const abandoned = emitted.find((e) => e.eventType === 'ROUND_JUDGE_RETRY_ABANDONED');
      expect(abandoned).toBeTruthy();
      expect(abandoned.reason).toBe('contextChanged');
      expect(abandoned.capturedEventId).toBe('6:1');
      expect(abandoned.currentEventId).toBe('6:2');
    } finally {
      vi.useRealTimers();
    }
  });

  it("타이머 발화 전 status가 result/game_over 밖(예: 'ready')으로 전이하면 reason=statusChanged로 포기한다", async () => {
    vi.useFakeTimers();
    try {
      const state = {
        role: 'host', status: 'result', round: 1, gameRound: 6, roomCode: 'R1', currentUserId: 'p1',
        confirmedSafeIds: [], confirmedLoserIds: [], targetLoserCount: 1, finishingRound: false,
        lastRoundResolution: null,
        participants: [
          { id: 'p1', is_host: true, choice: null },
          { id: 'p2', is_host: false, choice: null },
        ],
      };
      const { db } = makeDb();
      const fetchFreshParticipantsForResult = async () => { throw new Error('statusChanged 가드 통과 전에는 fetch가 호출되면 안 된다'); };
      const { finishRoundLocal, calls, emitted } = loadFinishRoundLocal({ state, db, fetchFreshParticipantsForResult });

      await finishRoundLocal();
      expect(emitted.filter((e) => e.eventType === 'ROUND_JUDGE_DEFERRED').length).toBe(1);

      // host의 scheduleRematchAutoAdvance/nextRound가 먼저 다음 라운드 'ready'를 써버린 상황을 모사.
      state.status = 'ready';
      await vi.advanceTimersByTimeAsync(400);

      expect(calls.renderRoundResult).toEqual([]);
      expect(calls.fetchFreshParticipantsForResult).toBe(0);
      const abandoned = emitted.find((e) => e.eventType === 'ROUND_JUDGE_RETRY_ABANDONED');
      expect(abandoned).toBeTruthy();
      expect(abandoned.reason).toBe('statusChanged');
      expect(abandoned.status).toBe('ready');
    } finally {
      vi.useRealTimers();
    }
  });

  it('fetch 도중(왕복 시간 동안) status가 바뀌면 — fetch는 실행되지만 그 직후 가드가 다시 잡아내 finishRoundLocal 재귀 실행을 막는다(post-fetch race, 결함A 재발 지점)', async () => {
    vi.useFakeTimers();
    try {
      const state = {
        role: 'host', status: 'result', round: 1, gameRound: 6, roomCode: 'R1', currentUserId: 'p1',
        confirmedSafeIds: [], confirmedLoserIds: [], targetLoserCount: 1, finishingRound: false,
        lastRoundResolution: null,
        participants: [
          { id: 'p1', is_host: true, choice: null },
          { id: 'p2', is_host: false, choice: null },
        ],
      };
      const { db } = makeDb();
      // 실제로는 fetchFreshParticipantsForResult 자체가 최대 ~1.2~2.5초 걸리는 재시도 루프다 — 그
      // 시간 동안 host의 scheduleRematchAutoAdvance가 다음 라운드 'ready'를 써버리는 레이스를,
      // "fetch가 완료되는 시점에 status가 이미 바뀌어 있다"로 모사한다.
      const fetchFreshParticipantsForResult = async () => {
        state.status = 'ready';
        return [];
      };
      const { finishRoundLocal, calls, emitted } = loadFinishRoundLocal({ state, db, fetchFreshParticipantsForResult });

      await finishRoundLocal();
      expect(emitted.filter((e) => e.eventType === 'ROUND_JUDGE_DEFERRED').length).toBe(1);

      await vi.advanceTimersByTimeAsync(400);

      expect(calls.fetchFreshParticipantsForResult).toBe(1); // 전위 가드는 통과해 fetch가 실제로 호출됐다
      expect(calls.renderRoundResult).toEqual([]); // 그러나 fetch 도중 바뀐 status 때문에 재귀 판정은 실행되지 않음
      const abandoned = emitted.find((e) => e.eventType === 'ROUND_JUDGE_RETRY_ABANDONED');
      expect(abandoned).toBeTruthy();
      expect(abandoned.reason).toBe('statusChanged');
      expect(abandoned.status).toBe('ready');
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('Build28 Round3 [NEW-MEDIUM-1] defer 카운터 room-scoped 키 — 방 이동 후에도 재시도가 다시 가능하다(회귀 테스트 #10)', () => {
  it('방 A에서 "1:1" defer를 2회 소진해도, 방 B의 동일 eventId("1:1")는 독립적으로 다시 2회 재시도 가능하다', async () => {
    vi.useFakeTimers();
    try {
      const stateA = {
        role: 'host', status: 'result', round: 1, gameRound: 1, roomCode: 'ROOMA', currentUserId: 'p1',
        confirmedSafeIds: [], confirmedLoserIds: [], targetLoserCount: 1, finishingRound: false,
        lastRoundResolution: null,
        participants: [
          { id: 'p1', is_host: true, choice: null },
          { id: 'p2', is_host: false, choice: null },
        ],
      };
      const { db } = makeDb();
      // 방 A: 절대 신선 데이터를 주지 않아 재시도(defer) 2회를 모두 소진시킨다.
      const fetchFreshA = async () => [];
      const { finishRoundLocal: finishA, emitted: emittedA } = loadFinishRoundLocal({ state: stateA, db, fetchFreshParticipantsForResult: fetchFreshA });
      await finishA();
      await vi.advanceTimersByTimeAsync(400);
      await vi.advanceTimersByTimeAsync(400);
      await vi.advanceTimersByTimeAsync(400);
      expect(emittedA.some((e) => e.eventType === 'ROUND_JUDGE_DEFER_EXHAUSTED')).toBe(true);
      expect(stateA.roundJudgeDeferAttempts['ROOMA:1:1']).toBe(2); // 방A 전용 키가 상한까지 소진됨

      // 방 B로 이동 — resetRoomLocalState/discardInProgressRoomSession이 실제로 하는 일(카운터 맵
      // 전체 초기화)을 그대로 반영한 새 state. gameRound가 우연히 다시 1로 시작되는 흔한 케이스.
      const stateB = {
        role: 'host', status: 'result', round: 1, gameRound: 1, roomCode: 'ROOMB', currentUserId: 'q1',
        confirmedSafeIds: [], confirmedLoserIds: [], targetLoserCount: 1, finishingRound: false,
        lastRoundResolution: null,
        roundJudgeDeferAttempts: {}, // 방 이동 시 초기화됨(NEW-MEDIUM-1/NEW-LOW-1 수정)
        participants: [
          { id: 'q1', is_host: true, choice: null },
          { id: 'q2', is_host: false, choice: null },
        ],
      };
      let selectCall = 0;
      const fetchFreshB = async () => {
        selectCall += 1;
        if (selectCall < 2) return [];
        stateB.participants = [{ id: 'q1', choice: 'rock|lose' }, { id: 'q2', choice: 'paper|win' }];
        return stateB.participants;
      };
      const { finishRoundLocal: finishB, calls: callsB, emitted: emittedB } = loadFinishRoundLocal({ state: stateB, db, fetchFreshParticipantsForResult: fetchFreshB });
      await finishB();
      expect(emittedB.filter((e) => e.eventType === 'ROUND_JUDGE_DEFERRED').length).toBe(1);
      await vi.advanceTimersByTimeAsync(400); // 재시도 #1(방 B 독자 카운터 1회 소모, 여전히 빈 스냅샷)
      await vi.advanceTimersByTimeAsync(400); // 재시도 #2 → 실제 데이터 도착, 정상 판정

      expect(callsB.renderRoundResult.length).toBe(1); // 방 B에서 정상적으로 재판정됨(카운터가 이월되지 않았음)
      expect(emittedB.some((e) => e.eventType === 'ROUND_JUDGE_DEFER_EXHAUSTED')).toBe(false);
      // 방 B는 방 A와 무관하게 자신만의 예산(최대 2회)을 온전히 다시 받아 그 안에서 성공했다
      // (첫 판정 defer + 재시도 1회 defer = 2, 소진(EXHAUSTED)에 도달하지 않고 재시도 2회째에 성공).
      expect(stateB.roundJudgeDeferAttempts['ROOMB:1:1']).toBe(2);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('Build28 Round3 [NEW-HIGH-1(2)/NEW-MEDIUM-1/NEW-LOW-1] 타이머 핸들 취소 + 카운터/스트릭 초기화(회귀 테스트 #11)', () => {
  it('discardInProgressRoomSession: roundJudgeDeferTimer를 clearTimeout하고 null로, 카운터/stale-skip 스트릭을 초기화한다', () => {
    const fakeHandle = 12345;
    const clearedHandles = [];
    const realClearTimeout = global.clearTimeout;
    global.clearTimeout = (h) => { clearedHandles.push(h); };
    try {
      const state = {
        roundJudgeDeferTimer: fakeHandle,
        roundJudgeDeferAttempts: { 'ROOMA:1:1': 2 },
        staleRoomUpdateSkipStreak: 3,
      };
      const discardInProgressRoomSession = loadDiscardInProgressRoomSession(state);
      discardInProgressRoomSession();
      expect(clearedHandles).toContain(fakeHandle);
      expect(state.roundJudgeDeferTimer).toBe(null);
      expect(state.roundJudgeDeferAttempts).toEqual({});
      expect(state.staleRoomUpdateSkipStreak).toBe(0);
    } finally {
      global.clearTimeout = realClearTimeout;
    }
  });

  it('resetRoomLocalState: roundJudgeDeferTimer를 clearTimeout하고 null로, 카운터/stale-skip 스트릭을 초기화한다', () => {
    const fakeHandle = 67890;
    const clearedHandles = [];
    const realClearTimeout = global.clearTimeout;
    global.clearTimeout = (h) => { clearedHandles.push(h); };
    try {
      const state = {
        roundJudgeDeferTimer: fakeHandle,
        roundJudgeDeferAttempts: { 'ROOMA:1:1': 2 },
        staleRoomUpdateSkipStreak: 4,
        rematchAdvanceTimer: null,
      };
      const resetRoomLocalState = loadResetRoomLocalState(state);
      resetRoomLocalState();
      expect(clearedHandles).toContain(fakeHandle);
      expect(state.roundJudgeDeferTimer).toBe(null);
      expect(state.roundJudgeDeferAttempts).toEqual({});
      expect(state.staleRoomUpdateSkipStreak).toBe(0);
    } finally {
      global.clearTimeout = realClearTimeout;
    }
  });

  it('beginNewGameRound: roundJudgeDeferTimer를 clearTimeout하고 null로, 카운터 맵을 초기화한다', async () => {
    const fakeHandle = 24680;
    const clearedHandles = [];
    const realClearTimeout = global.clearTimeout;
    global.clearTimeout = (h) => { clearedHandles.push(h); };
    try {
      const state = {
        newRoundResetting: false, participants: [], confirmedSafeIds: ['p1'], confirmedLoserIds: [],
        gameRound: 1, round: 1, status: 'lobby', roomCode: '', targetLoserCount: 1,
        roundJudgeDeferTimer: fakeHandle,
        roundJudgeDeferAttempts: { 'ROOMA:1:1': 2 },
      };
      const scheduling = loadSchedulingHelpers(state);
      const { beginNewGameRound } = loadBeginNewGameRound(state, scheduling);
      await beginNewGameRound({ status: 'lobby', increment: true, reason: 'test' });
      expect(clearedHandles).toContain(fakeHandle);
      expect(state.roundJudgeDeferTimer).toBe(null);
      expect(state.roundJudgeDeferAttempts).toEqual({});
    } finally {
      global.clearTimeout = realClearTimeout;
    }
  });

  // Build28 Round4(잔여 LOW-1): discardInProgressRoomSession/resetRoomLocalState는 이미 위 두 테스트로
  // stale-skip 스트릭 초기화가 검증돼 있었지만, 같은 방에서 다음 게임회차로 넘어가는 가장 흔한 경로인
  // beginNewGameRound에는 이 초기화가 빠져 있었다(Round3 보고서의 "3곳" 서술이 사실과 달랐음). 새
  // 게임회차 진입 시 state.gameRound가 즉시 올라가므로, 리셋이 없으면 직전 게임회차에서 누적된
  // stale-skip 카운트가 새 게임회차로 그대로 이월되어 self-heal이 조기 발동할 수 있었다.
  it('beginNewGameRound: 새 게임회차 시작 시 staleRoomUpdateSkipStreak도 0으로 리셋된다', async () => {
    const state = {
      newRoundResetting: false, participants: [], confirmedSafeIds: ['p1'], confirmedLoserIds: [],
      gameRound: 1, round: 1, status: 'lobby', roomCode: '', targetLoserCount: 1,
      staleRoomUpdateSkipStreak: 4,
    };
    const scheduling = loadSchedulingHelpers(state);
    const { beginNewGameRound } = loadBeginNewGameRound(state, scheduling);
    await beginNewGameRound({ status: 'lobby', increment: true, reason: 'test' });
    expect(state.staleRoomUpdateSkipStreak).toBe(0);
  });
});

// ════════════════════════════════════════════════════════════════════
describe('Build28 비침습 계약(금지사항) — 판정 알고리즘/Build19~27 가드 무변경', () => {
  it('판정 순수함수 시그니처는 그대로 유지된다', () => {
    expect(html).toContain('function judgeRound(');
    expect(html).toContain('function resolveElimination(');
    expect(html).toContain('function judgePure(');
  });
  it('Build19 idempotency 가드/Build22-C TAGGER_FALLBACK_SOURCE는 재작성되지 않았다', () => {
    expect(html).toMatch(/const roundEventId = getGameRound\(\) \+ ':' \+ \(state\.round \|\| 1\);/);
    expect(html).toMatch(/if \(state\.lastRoundResolution && state\.lastRoundResolution\.eventId === roundEventId\)/);
    expect(html).toMatch(/eventType: 'TAGGER_FALLBACK_SOURCE', source: hasStoredResults \? 'stored' : 'localJudge'/);
  });
  it('Build27 handleRoomUpdate 리셋 가드(room-scoped confirmedIdsResetKey)는 무변경', () => {
    expect(html).toContain('if (room.round === 1 && state.confirmedIdsResetGameNo !== confirmedIdsResetKey) {');
  });
});
