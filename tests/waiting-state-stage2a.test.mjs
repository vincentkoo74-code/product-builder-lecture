// WRPS-083 2A — WAITING 상태 분리 + Host 권한 완전 소멸 규칙 (CEO 승인 범위: W1~W29 / M1~M10).
//
// index.html·src/game-logic.mjs 무수정 원칙(tests/host-transfer-stage1.test.mjs 선례):
// 이 파일은 두 소스를 오직 readFileSync + 문자열 마커 슬라이싱으로만 읽고, 추출한 REAL 소스를
// new Function으로 그대로 실행한다. 손으로 베낀 시뮬레이션 / no-op mock / 문자열 존재 검사
// 단독 PASS는 금지다. 스텁은 렌더·이탈·시각 표면에만 쓴다.
//
// mutation-kill(M1~M10)도 전부 "프로덕션 원문 문자열을 치환한 mutant를 같은 하니스로 실행"하는
// 방식이다 — mutant 역시 REAL 코드 경로를 통과한다.

import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { computePlayerStatuses, getActiveIds, PLAYER_STATUS } from '../src/game-logic.mjs';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const logicSource = readFileSync(new URL('../src/game-logic.mjs', import.meta.url), 'utf8');

function extractBlock(startMarker, endMarker, label) {
  const start = html.indexOf(startMarker);
  if (start < 0) throw new Error(`[2A] start marker not found (${label}): ${startMarker}`);
  const end = html.indexOf(endMarker, start + startMarker.length);
  if (end < 0) throw new Error(`[2A] end marker not found (${label}): ${endMarker}`);
  return html.slice(start, end);
}

// ── REAL 소스 추출 ────────────────────────────────────────────────────────────
// 벌칙/라운드 파생값(parsePenalty·getTargetLoserCount·getGameRound) — build23/28과 동일 마커.
// WRPS-083 2B: 아래 REAL 블록이 destroyed 공통 가드(isRoomClosingOrDestroyed)를 호출한다.
// hand-copy/no-op stub 금지 — index.html 원문을 함께 추출한다.
const ROOM_GUARD_SRC = extractBlock(
  'function isRoomClosingOrDestroyed() {', 'function isJoinLocked(', 'roomGuard'
);
const PENALTY_BLOCK = extractBlock(
  'function toPositiveInt(value, fallback = 0) {', 'function getCountdownStartAt(raw) {', 'penalty'
);
// 진행 게이트 family(getActivePlayers/getWaitingPlayers/areAllActivePlayersReady/
// isTaggerSelectionComplete/canShowPlayAgainButton/blockPlayAgainIfPartialReplay) — build23/27/28과
// 동일 마커. 2A가 이 블록 안에 getWaitingPlayers를 추가하고 isTaggerSelectionComplete를 바꾼다.
const GUARD_BLOCK = extractBlock(
  'function getActivePlayers() {', 'function isJoinLocked(', 'guard'
);
const JOIN_LOCK_BLOCK = extractBlock(
  'function isJoinLocked(', 'function isBusyInAnotherActiveRoom(', 'joinLock'
);
const FORCE_START_BLOCK = extractBlock(
  'function canShowForceStartReplayButton() {', 'async function goToReadyScreen(', 'forceStart'
);
const JOIN_ROOM_BLOCK = extractBlock(
  'async function joinRoom() {', 'async function requestReplayFromJoinedRoom(', 'joinRoom'
);
const HOST_HELPERS_BLOCK = extractBlock(
  'function pickDeterministicHostCandidate(rows) {', 'async function leaveRoom() {', 'hostHelpers'
);
const LEAVE_CLUSTER_BLOCK = extractBlock(
  'async function leaveRoomForce() {', 'function startGameOverCountdown(seconds) {', 'leaveCluster'
);
// ensureHostExists(1단계) + recoverRoundWhenAllPlayersWaiting(2A C-2) 두 함수가 같은 구간에 있다.
const ENSURE_AND_RECOVERY_BLOCK = extractBlock(
  'async function ensureHostExists() {', 'async function returnToLobbyAfterGame() {', 'ensure+recovery'
);
// 새 게임 회차 참가자 초기화(다음 유효 라운드 복귀 경로) — getNewGameRoundParticipantPatch +
// resetLocalParticipantsForNewGameRound.
const NEW_ROUND_PATCH_BLOCK = extractBlock(
  'function getNewGameRoundParticipantPatch(extra = {}) {', 'function archiveCurrentRoundStats(', 'newRoundPatch'
);
const FETCH_CLUSTER_BLOCK = extractBlock(
  'function scheduleFetchParticipants(roomCode, delayMs = 80) {', 'async function updateRoomStatus(status) {', 'fetchCluster'
);
// C-2 writer 배선 line(프로덕션 원문 그대로). mutant는 이 한 줄만 제거한다.
const RECOVERY_WIRING_CALL = 'try { await recoverRoundWhenAllPlayersWaiting(); } catch (e) {}';

// ── 결정적 fake supabase (stage1 하니스 + insert 지원) ─────────────────────────
// 지원 체인: insert([rows]) / update(patch).eq(...)|.in(...) / delete().eq(...) /
// select(cols).eq(...)[.order(...)|.single()]. 모든 builder는 supabase-js v2와 동일하게 thenable.
function createFakeDb({ participants = [], rooms = [] } = {}) {
  const tables = {
    participants: participants.map((p) => ({ ...p })),
    rooms: rooms.map((r) => ({ ...r })),
  };
  const writeLog = [];
  function makeBuilder(table, op, payload) {
    const filters = [];
    const b = {
      _single: false,
      eq(col, val) { filters.push([col, val]); return b; },
      in(col, vals) { filters.push([col, vals, 'in']); return b; },
      order() { return b; },
      single() { b._single = true; return b; },
      then(resolve, reject) { return exec().then(resolve, reject); },
    };
    async function exec() {
      const match = (r) => filters.every(([col, val, kind]) => (kind === 'in' ? val.includes(r[col]) : r[col] === val));
      if (op === 'insert') {
        const rows = (Array.isArray(payload) ? payload : [payload]).map((r) => ({ ...r }));
        writeLog.push({ table, op, rows: rows.map((r) => ({ ...r })) });
        tables[table].push(...rows);
        return { data: rows, error: null };
      }
      const rows = tables[table].filter(match);
      if (op === 'update') {
        writeLog.push({ table, op, patch: { ...payload }, filters: filters.map((f) => [...f]), matched: rows.length });
        rows.forEach((r) => Object.assign(r, payload));
        return { data: null, error: null };
      }
      if (op === 'delete') {
        writeLog.push({ table, op, filters: filters.map((f) => [...f]), matched: rows.length });
        for (const r of rows) tables[table].splice(tables[table].indexOf(r), 1);
        return { data: null, error: null };
      }
      const copies = rows.map((r) => ({ ...r }));
      if (b._single) {
        return copies.length === 1
          ? { data: copies[0], error: null }
          : { data: null, error: { code: 'PGRST116', message: '[fake] expected 1 row, got ' + copies.length } };
      }
      return { data: copies, error: null };
    }
    return b;
  }
  return {
    tables,
    writeLog,
    hostRows() { return tables.participants.filter((p) => p.is_host); },
    participantWrites() { return writeLog.filter((w) => w.table === 'participants' && w.op !== 'select'); },
    roomWrites() { return writeLog.filter((w) => w.table === 'rooms' && w.op === 'update'); },
    from(table) {
      if (!tables[table]) throw new Error('[2A] unsupported table: ' + table);
      return {
        insert: (rows) => makeBuilder(table, 'insert', rows),
        update: (patch) => makeBuilder(table, 'update', patch),
        delete: () => makeBuilder(table, 'delete'),
        select: () => makeBuilder(table, 'select'),
      };
    },
  };
}

const noop = () => {};
const asyncNoop = async () => {};
const fakeEl = () => ({
  classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
  style: {}, innerHTML: '', textContent: '', value: '', disabled: false, readOnly: false,
  appendChild() {}, querySelectorAll: () => [],
});

// ── 하니스 1: 진행 게이트 family(REAL) ────────────────────────────────────────
function loadGuards({
  participants, confirmedSafeIds = [], confirmedLoserIds = [], role = 'host',
  targetLoserCount = 1, round = 2, gameRound = 1, status = 'result', guardSrcOverride = null,
}) {
  const state = {
    role, participants: participants.map((p) => ({ ...p })),
    confirmedSafeIds, confirmedLoserIds,
    penalty: { text: '', loserCount: targetLoserCount }, // parsePenalty 객체 분기로 loserCount 주입
    targetLoserCount, round, gameRound, status, roomCode: 'R1', lastRoundResolution: null,
    gameStarting: false, autoStartInFlight: false,
  };
  const emitted = [];
  const src = `${PENALTY_BLOCK}\n${guardSrcOverride ?? GUARD_BLOCK}\n${FORCE_START_BLOCK}`;
  const factory = new Function(
    'state', 'QA', 'computePlayerStatuses', 'PLAYER_STATUS', 'document', 'startGame',
    `"use strict";\n${src}\nreturn { getActivePlayers, getWaitingPlayers, areAllActivePlayersReady,` +
    ` isTaggerSelectionComplete, canShowPlayAgainButton, blockPlayAgainIfPartialReplay,` +
    ` canShowForceStartReplayButton, getTargetLoserCount };`
  );
  const impl = factory(
    state, { emit: (kind, payload) => emitted.push({ kind, ...payload }) },
    computePlayerStatuses, PLAYER_STATUS,
    { querySelectorAll: () => [] }, asyncNoop
  );
  return { state, impl, emitted };
}

// ── 하니스 2: isJoinLocked(REAL) ──────────────────────────────────────────────
function loadJoinLocked(srcOverride = null) {
  const factory = new Function(
    'state', `"use strict";\n${srcOverride ?? JOIN_LOCK_BLOCK}\nreturn isJoinLocked;`
  );
  return factory({ participants: [], status: 'waiting' });
}

// ── 하니스 3: joinRoom(REAL) + isJoinLocked(REAL) ─────────────────────────────
// 스텁은 DOM/저장소/구독/화면 표면뿐이다. 입장 허용 판정·waitingChoice 계산·insert payload는
// 전부 REAL 소스가 수행한다.
function loadJoinRoom({
  db, code, name, lastJoinedRoomCode = '', savedNickname = '',
  joinScreenMode = 'normal', joinRecentRoom = null, joinRoomSrcOverride = null,
}) {
  const state = {
    role: '', currentUserId: '', nickname: '', roomCode: '', status: '',
    participants: [], confirmedSafeIds: [], confirmedLoserIds: [],
    joinScreenMode, joinScreenAction: 'join', joinRecentRoom,
    penalty: '', gameRound: 1, round: 1, lastStartedGameRound: 0,
  };
  const calls = { toast: [], saveLastJoined: [], subscribe: [], screens: [] };
  const els = {
    joinRoomCode: { ...fakeEl(), value: code },
    joinName: { ...fakeEl(), value: name },
    joinBtn: fakeEl(),
  };
  const src = `${ROOM_GUARD_SRC}\n${joinRoomSrcOverride ?? JOIN_ROOM_BLOCK}\n${JOIN_LOCK_BLOCK}`;
  const factory = new Function(
    'state', 'db', '$', 'showToast', 't', 'setBtnText', 'loadNickname', 'saveNickname',
    'getLastJoinedRoomCode', 'saveLastJoinedRoomCode', 'subscribeToRoom', 'showScreen',
    'showReadyScreen', 'resetRoomLocalState', 'getDefaultShareBaseUrl', 'buildRoomUrl',
    'getOnlineMode', 'getPenaltyGameRound', 'cleanupDuplicateRoomProfiles',
    'requestReplayFromJoinedRoom',
    `"use strict";\n${src}\nreturn { joinRoom };`
  );
  const impl = factory(
    state, db,
    (id) => els[id] || fakeEl(),
    (msg) => calls.toast.push(msg),
    (key) => key,
    noop,
    () => savedNickname,
    noop,
    () => lastJoinedRoomCode,
    (...args) => calls.saveLastJoined.push(args),
    (c) => calls.subscribe.push(c),
    (id) => calls.screens.push(id),
    () => calls.screens.push('screenReady'),
    noop,
    () => '',
    () => '',
    () => true,
    () => 1,
    asyncNoop,
    asyncNoop
  );
  return { state, calls, impl };
}

// ── 하니스 4: host 인계 클러스터(REAL, stage1과 동일 구성) ────────────────────
function loadHostCluster({ db, currentUserId, role, participants, roomCode = 'R1' }) {
  const state = {
    currentUserId, role, roomCode,
    participants: participants.map((p) => ({ ...p })),
    nickname: 'nick_' + currentUserId,
    confirmedSafeIds: [], confirmedLoserIds: [],
    gameStarting: false, becomingNextHost: false, gameOverTimeout: null,
  };
  const calls = { toast: [], beginNewGameRound: [], goHome: 0, clearRealtime: 0, qa: [] };
  const combined = `${ROOM_GUARD_SRC}\n${HOST_HELPERS_BLOCK}\n${LEAVE_CLUSTER_BLOCK}`;
  const factory = new Function(
    'state', 'db', 'QA', 'getOnlineMode', 'showToast', 't', 'clearRealtime', 'goHome',
    'beginNewGameRound', 'hasCurrentGameRoundActivity', 'loadNickname', 'stopGameOverCountdown',
    'showHostRoom', '$', 'document',
    `"use strict";\n${combined}\nreturn { transferHostAndLeave, leaveRoomForce, becomeNextHost,` +
    ` pickDeterministicHostCandidate, verifyExactlyOneHost };`
  );
  const impl = factory(
    state, db,
    { emit: (kind, payload) => calls.qa.push({ kind, ...payload }) },
    () => true,
    (msg) => calls.toast.push(msg),
    (key) => key,
    () => { calls.clearRealtime += 1; },
    () => { calls.goHome += 1; },
    async (opts) => { calls.beginNewGameRound.push(opts); },
    () => true,
    () => 'nick_' + currentUserId,
    noop, noop, fakeEl,
    { getElementById: () => null, createElement: fakeEl }
  );
  return { state, calls, impl };
}

// ── 하니스 5: C-2 복구 writer(REAL) + ensureHostExists(REAL) ──────────────────
function loadRecovery({
  db, participants, role = 'host', confirmedSafeIds = [], confirmedLoserIds = [],
  targetLoserCount = 1, status = 'result', round = 2, currentUserId = 'H',
  roomClosing = false, gameStarting = false, advancingRound = false, recoverySrcOverride = null,
}) {
  const state = {
    role, currentUserId, roomCode: 'R1', status, round,
    participants: participants.map((p) => ({ ...p })),
    confirmedSafeIds, confirmedLoserIds,
    penalty: { text: '', loserCount: targetLoserCount },
    targetLoserCount, gameRound: 1,
    roomClosing, gameStarting, advancingRound,
  };
  const calls = { qa: [] };
  const combined = `${ROOM_GUARD_SRC}\n${PENALTY_BLOCK}\n${GUARD_BLOCK}\n${HOST_HELPERS_BLOCK}\n` +
    `${recoverySrcOverride ?? ENSURE_AND_RECOVERY_BLOCK}`;
  const factory = new Function(
    'state', 'db', 'QA', 'getOnlineMode', 'computePlayerStatuses', 'PLAYER_STATUS',
    'buildPenaltyValue', 'getNextPhaseScheduledAt',
    `"use strict";\n${combined}\nreturn { recoverRoundWhenAllPlayersWaiting, ensureHostExists,` +
    ` getActivePlayers, getWaitingPlayers, pickDeterministicHostCandidate };`
  );
  const impl = factory(
    state, db,
    { emit: (kind, payload) => calls.qa.push({ kind, ...payload }) },
    () => true,
    computePlayerStatuses, PLAYER_STATUS,
    ({ gameRound, phaseScheduledAt, phaseKind }) => `g${gameRound}|${phaseKind}|${phaseScheduledAt}`,
    () => 1000
  );
  return { state, calls, impl };
}

// ── 하니스 6: fetchParticipants(REAL) — C-2 배선 실구동 ───────────────────────
function loadFetchTerminal({ db, currentUserId = 'H', status = 'result', fetchSrcOverride = null }) {
  const state = {
    currentUserId, role: 'host', status, roomCode: 'R1', round: 2, gameRound: 1,
    participants: [],
    penalty: { text: '', loserCount: 1 }, targetLoserCount: 1,
    confirmedSafeIds: [], confirmedLoserIds: [],
    fetchParticipantsSeq: 0, fetchParticipantsBusy: false, fetchParticipantsPending: false,
    fetchParticipantsTimer: null,
    cleaningDuplicateProfiles: false, myReadyLocallySetAt: 0,
    gameStarting: false, autoStartInFlight: false, advancingRound: false, roomClosing: false,
    newRoundResetting: false,
  };
  const calls = { qa: [] };
  const combined = `${ROOM_GUARD_SRC}\n${PENALTY_BLOCK}\n${GUARD_BLOCK}\n${HOST_HELPERS_BLOCK}\n` +
    `${ENSURE_AND_RECOVERY_BLOCK}\n${fetchSrcOverride ?? FETCH_CLUSTER_BLOCK}`;
  const factory = new Function(
    'state', 'db', 'QA', 'getOnlineMode', 'computePlayerStatuses', 'PLAYER_STATUS',
    'buildPenaltyValue', 'getNextPhaseScheduledAt',
    'cleanupDuplicateRoomProfiles', 'destroyRoomAndGoHome', 'shouldResetForParticipantChange',
    'beginNewGameRound', 'SoundManager', 'updateSelectedCount', 'renderAll', '$',
    'isSafeParticipant', 'isConfirmedLoser', 'isWaitingForNextGame', 'showReadyScreen',
    'showScreen', 'renderLobby', 'showHostRoom', 'isNonPlayingChoice', 'hasConfirmedRoundResult',
    'getChoiceBase', 'publishHostRoundResult', 'startFromLobby', 'renderReadyList', 'startGame',
    'showToast', 't',
    `"use strict";\n${combined}\nreturn { fetchParticipants };`
  );
  const impl = factory(
    state, db,
    { emit: (kind, payload) => calls.qa.push({ kind, ...payload }) },
    () => true,
    computePlayerStatuses, PLAYER_STATUS,
    ({ gameRound, phaseScheduledAt, phaseKind }) => `g${gameRound}|${phaseKind}|${phaseScheduledAt}`,
    () => 1000,
    asyncNoop, asyncNoop, () => false,
    asyncNoop, { playJoinMeow: noop, playLeaveMeow: noop }, noop, noop, fakeEl,
    () => false, () => false, () => false, noop,
    noop, noop, noop, (c) => c === '__safe__' || c === '__loser__' || c === '__waiting__',
    () => false, () => '', asyncNoop, asyncNoop, noop, asyncNoop,
    noop, (key) => key
  );
  return { state, calls, impl };
}

// game-logic.mjs를 mutant로 실행하기 위한 로더(sync-game-logic과 동일하게 export 제거).
function loadGameLogic(srcOverride = null) {
  const inlined = (srcOverride ?? logicSource).replace(/^export\s+/gm, '');
  const factory = new Function(`"use strict";\n${inlined}\nreturn { computePlayerStatuses, getActiveIds, PLAYER_STATUS };`);
  return factory();
}

const T0 = '2026-01-01T00:00:00.000Z';
const T5 = '2026-01-01T00:00:05.000Z';
const T10 = '2026-01-01T00:00:10.000Z';

// ═══════════════════════════════════════════════════════════════════════════════
describe('fidelity — 추출 계약과 금지 영역 무변경', () => {
  it('2A 블록이 모두 존재한다', () => {
    expect(GUARD_BLOCK).toContain('function getWaitingPlayers() {');
    expect(GUARD_BLOCK).toContain('function isTaggerSelectionComplete() {');
    expect(JOIN_LOCK_BLOCK).toContain("p.choice !== '__waiting__'");
    expect(JOIN_ROOM_BLOCK).toContain('const waitingChoice = locked ?');
    expect(ENSURE_AND_RECOVERY_BLOCK).toContain('async function recoverRoundWhenAllPlayersWaiting() {');
    expect(FETCH_CLUSTER_BLOCK).toContain(RECOVERY_WIRING_CALL);
  });

  it('절대 금지 영역이 원문 그대로다(판정/stale gate/폴 주기)', () => {
    // judgePure / resolveElimination / judgeRound 본체 무변경
    expect(logicSource).toContain('export function judgePure(active) {');
    expect(logicSource).toContain("if (selectedTypes.length === 1 || selectedTypes.length === 3) {");
    expect(logicSource).toContain('const remainingSlots = targetLoserCount - prevLosers.length;');
    // stale gate 임계값 / 폴 주기
    expect(html).toContain('const STALE_ROOM_UPDATE_SELF_HEAL_THRESHOLD = 5;');
    expect(html).toContain('}, 2600);');
  });

  it('W29 — src/game-logic.mjs와 index.html GAME_LOGIC 블록이 동일하다', () => {
    const START = '/*__GAME_LOGIC_START__*/';
    const END = '/*__GAME_LOGIC_END__*/';
    const block = html.slice(html.indexOf(START) + START.length, html.lastIndexOf(END));
    const expected = logicSource.replace(/^export\s+/gm, '').trim();
    expect(block).toContain(expected);
    expect(block).toContain('WAITING: \'WAITING\'');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('W1~W4 — WAITING 분류(computePlayerStatuses / getActiveIds)', () => {
  it('W1 — choice="__waiting__" → WAITING', () => {
    const s = computePlayerStatuses([{ id: 'a' }, { id: 'w', choice: '__waiting__' }], [], []);
    expect(s).toEqual({ a: PLAYER_STATUS.ACTIVE, w: PLAYER_STATUS.WAITING });
  });

  it('W2 — confirmedLoserIds + __waiting__ → LOSER_CONFIRMED(재입장 부활 금지)', () => {
    const s = computePlayerStatuses([{ id: 'x', choice: '__waiting__' }], [], ['x']);
    expect(s.x).toBe(PLAYER_STATUS.LOSER_CONFIRMED);
  });

  it('W3 — confirmedSafeIds + __waiting__ → WINNER_CONFIRMED', () => {
    const s = computePlayerStatuses([{ id: 'x', choice: '__waiting__' }], ['x'], []);
    expect(s.x).toBe(PLAYER_STATUS.WINNER_CONFIRMED);
  });

  it('W4 — getActiveIds가 WAITING을 제외한다', () => {
    const rows = [{ id: 'a' }, { id: 'w', choice: '__waiting__' }, { id: 'b' }];
    expect(getActiveIds(rows, [], [])).toEqual(['a', 'b']);
  });

  it('기존 계약 무회귀 — 확정 술래/안전 우선순위와 호스트 ACTIVE 유지', () => {
    const s = computePlayerStatuses(
      [{ id: 'h', isHost: true }, { id: 'a' }, { id: 'b' }, { id: 'c', choice: '__safe__' }, { id: 'd', choice: '__loser__' }],
      ['a'], ['b']
    );
    expect(s).toEqual({
      h: 'ACTIVE', a: 'WINNER_CONFIRMED', b: 'LOSER_CONFIRMED', c: 'WINNER_CONFIRMED', d: 'LOSER_CONFIRMED',
    });
  });
});

describe('M1/M2 — WAITING 분류 mutation-kill', () => {
  it('M1 — WAITING 분기를 삭제하면 W1이 RED가 된다', () => {
    const mutated = logicSource.replace(
      "    if (p.choice === '__waiting__') { map[p.id] = PLAYER_STATUS.WAITING; return; }\n", ''
    );
    expect(mutated).not.toBe(logicSource); // mutation이 실제로 적용됐는가
    const mut = loadGameLogic(mutated);
    expect(mut.computePlayerStatuses([{ id: 'w', choice: '__waiting__' }], [], []).w)
      .toBe(PLAYER_STATUS.ACTIVE); // WAITING이 아니라 ACTIVE로 낙하 = RED
    expect(mut.getActiveIds([{ id: 'w', choice: '__waiting__' }], [], [])).toEqual(['w']);
  });

  it('M2 — WAITING을 loser/safe보다 앞으로 옮기면 W2/W3가 RED가 된다', () => {
    const waitingLine = "    if (p.choice === '__waiting__') { map[p.id] = PLAYER_STATUS.WAITING; return; }\n";
    const loserLine = "    if (loser.has(p.id) || p.choice === '__loser__') { map[p.id] = PLAYER_STATUS.LOSER_CONFIRMED; return; }\n";
    const mutated = logicSource.replace(waitingLine, '').replace(loserLine, waitingLine + loserLine);
    expect(mutated).not.toBe(logicSource);
    const mut = loadGameLogic(mutated);
    expect(mut.computePlayerStatuses([{ id: 'x', choice: '__waiting__' }], [], ['x']).x)
      .toBe(PLAYER_STATUS.WAITING); // 확정 술래가 재입장만으로 부활 = RED
    expect(mut.computePlayerStatuses([{ id: 'y', choice: '__waiting__' }], ['y'], []).y)
      .toBe(PLAYER_STATUS.WAITING);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('W16/W17/W19/W20 — 진행 게이트에서의 WAITING 제외(REAL 게이트 실행)', () => {
  const ACTIVE_AND_WAITING = [
    { id: 'h', is_host: true, is_ready: true },
    { id: 'a', is_host: false, is_ready: true },
    { id: 'w', is_host: false, is_ready: false, choice: '__waiting__' },
  ];

  it('W16 — WAITING이 active candidate / play-again / force-start 계산에서 제외된다', () => {
    const { impl } = loadGuards({ participants: ACTIVE_AND_WAITING, status: 'ready', round: 2 });
    expect(impl.getActivePlayers().map((p) => p.id)).toEqual(['h', 'a']);
    expect(impl.getWaitingPlayers().map((p) => p.id)).toEqual(['w']);
    // 활성 전원 준비 완료 → force start 버튼은 노출되지 않는다(=자동 시작이 정상 성립).
    expect(impl.canShowForceStartReplayButton()).toBe(false);
  });

  it('W17 — WAITING의 is_ready=false가 ACTIVE 참가자의 준비 완료를 막지 않는다', () => {
    const { impl } = loadGuards({ participants: ACTIVE_AND_WAITING, status: 'ready' });
    expect(impl.areAllActivePlayersReady()).toBe(true);
  });

  it('W17 대조군 — ACTIVE가 준비 안 됐으면 여전히 false다', () => {
    const { impl } = loadGuards({
      participants: [
        { id: 'h', is_host: true, is_ready: true },
        { id: 'a', is_host: false, is_ready: false },
        { id: 'w', is_host: false, is_ready: false, choice: '__waiting__' },
      ], status: 'ready',
    });
    expect(impl.areAllActivePlayersReady()).toBe(false);
  });

  it('W19 — C-2(ACTIVE=0 · WAITING>0 · 술래 미달) → 선정 미완료, gameOver/한번더 차단', () => {
    const { impl } = loadGuards({
      participants: [
        { id: 'h', is_host: true, is_ready: true, choice: '__safe__' },
        { id: 'w', is_host: false, is_ready: false, choice: '__waiting__' },
      ],
      confirmedSafeIds: ['h'], confirmedLoserIds: [], targetLoserCount: 1,
    });
    expect(impl.getActivePlayers().length).toBe(0);
    expect(impl.getWaitingPlayers().length).toBe(1);
    expect(impl.isTaggerSelectionComplete()).toBe(false);
    expect(impl.canShowPlayAgainButton()).toBe(false);
    expect(impl.blockPlayAgainIfPartialReplay()).toBe(true);
  });

  it('W20 — C-1(ACTIVE=0 · WAITING>0 · 술래 충족) → 선정 완료', () => {
    const { impl } = loadGuards({
      participants: [
        { id: 'h', is_host: true, is_ready: true, choice: '__safe__' },
        { id: 'L', is_host: false, is_ready: true, choice: '__loser__' },
        { id: 'w', is_host: false, is_ready: false, choice: '__waiting__' },
      ],
      confirmedSafeIds: ['h'], confirmedLoserIds: ['L'], targetLoserCount: 1,
    });
    expect(impl.getActivePlayers().length).toBe(0);
    expect(impl.isTaggerSelectionComplete()).toBe(true);
    expect(impl.canShowPlayAgainButton()).toBe(true);
    expect(impl.blockPlayAgainIfPartialReplay()).toBe(false);
  });

  it('무회귀 — WAITING이 0인 기존 조합에서 isTaggerSelectionComplete가 종전과 같다', () => {
    // 확정 완료(ACTIVE=0) → true
    const done = loadGuards({
      participants: [
        { id: 'h', is_host: true, is_ready: true, choice: '__safe__' },
        { id: 'L', is_host: false, is_ready: true, choice: '__loser__' },
      ], confirmedSafeIds: ['h'], confirmedLoserIds: ['L'], targetLoserCount: 1,
    });
    expect(done.impl.isTaggerSelectionComplete()).toBe(true);
    // 부분 재경기 진행 중(ACTIVE>0) → false
    const partial = loadGuards({
      participants: [
        { id: 'h', is_host: true, is_ready: true },
        { id: 'a', is_host: false, is_ready: true },
      ], targetLoserCount: 1,
    });
    expect(partial.impl.isTaggerSelectionComplete()).toBe(false);
    // 참가자 0명 → false(기존 LOW 방어 유지)
    const empty = loadGuards({ participants: [], targetLoserCount: 1 });
    expect(empty.impl.isTaggerSelectionComplete()).toBe(false);
  });
});

describe('M5 — C-2 예외 삭제 mutation-kill', () => {
  it('isTaggerSelectionComplete에서 C-2 분기를 제거하면 W19가 RED가 된다', () => {
    const c2Branch = `      if (getWaitingPlayers().length > 0 &&
          (state.confirmedLoserIds || []).length < getTargetLoserCount()) return false;\n`;
    const mutated = GUARD_BLOCK.replace(c2Branch, '');
    expect(mutated).not.toBe(GUARD_BLOCK);
    const { impl } = loadGuards({
      participants: [
        { id: 'h', is_host: true, is_ready: true, choice: '__safe__' },
        { id: 'w', is_host: false, is_ready: false, choice: '__waiting__' },
      ],
      confirmedSafeIds: ['h'], confirmedLoserIds: [], targetLoserCount: 1,
      guardSrcOverride: mutated,
    });
    expect(impl.isTaggerSelectionComplete()).toBe(true);   // 술래 0/목표 1인데 "완료" = RED
    expect(impl.canShowPlayAgainButton()).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('W18 + M4 — isJoinLocked 정합성', () => {
  const M4_MUTANT = JOIN_LOCK_BLOCK.replace(
    "(participants || []).filter(p => !p.is_host && p.choice !== '__waiting__')",
    "(participants || []).filter(p => !p.is_host)"
  );

  it('M4 mutation이 실제로 적용된다', () => {
    expect(M4_MUTANT).not.toBe(JOIN_LOCK_BLOCK);
  });

  it('W18 — WAITING이 없는 모든 조합에서 수정 전(M4 mutant)과 반환값이 동일하다', () => {
    const real = loadJoinLocked();
    const before = loadJoinLocked(M4_MUTANT);
    const statuses = ['waiting', 'lobby', 'ready', 'playing', 'result', 'stats', 'game_over', 'reinviting'];
    const rosters = [
      [],
      [{ is_host: true, is_ready: false }],
      [{ is_host: true, is_ready: true }, { is_host: false, is_ready: true }],
      [{ is_host: true, is_ready: true }, { is_host: false, is_ready: false }],
      [{ is_host: false, is_ready: true }, { is_host: false, is_ready: true }],
      [{ is_host: false, is_ready: true }, { is_host: false, is_ready: false }],
      [{ is_host: false, is_ready: true, choice: '__safe__' }, { is_host: false, is_ready: true, choice: '__loser__' }],
    ];
    for (const status of statuses) {
      for (const roster of rosters) {
        expect([status, roster.length, real(roster, status)])
          .toEqual([status, roster.length, before(roster, status)]);
      }
    }
  });

  it('M4 — WAITING 제외를 제거하면 재입장자 1명이 방 전체 ready 잠금을 영구히 막는다(RED)', () => {
    const roster = [
      { is_host: false, is_ready: true },
      { is_host: false, is_ready: false, choice: '__waiting__' },
    ];
    expect(loadJoinLocked()(roster, 'ready')).toBe(true);        // 2A: ACTIVE 전원 준비 → 잠금
    expect(loadJoinLocked(M4_MUTANT)(roster, 'ready')).toBe(false); // mutant: 영구 미잠금 = RED
  });

  it('진행 중 상태의 잠금은 WAITING 유무와 무관하게 유지된다(신규 입장 거부 정책 불변)', () => {
    const real = loadJoinLocked();
    const roster = [{ is_host: false, is_ready: false, choice: '__waiting__' }];
    expect(real(roster, 'playing')).toBe(true);
    expect(real(roster, 'result')).toBe(true);
    expect(real(roster, 'stats')).toBe(true);
    expect(real(roster, 'game_over')).toBe(false); // GAP-2: 기존 정책 그대로(무변경)
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('W13/W14/W15 + M3 — joinRoom 입장 정책과 GAP-1', () => {
  function seedRoom({ status = 'playing', participants }) {
    return createFakeDb({
      rooms: [{ id: 'R1', status, round: 2, penalty: '' }],
      participants,
    });
  }
  const IN_ROUND_ROSTER = [
    { id: 'B', room_id: 'R1', name: 'B', is_host: true, is_ready: true, created_at: T0 },
    { id: 'C', room_id: 'R1', name: 'C', is_host: false, is_ready: true, created_at: T5 },
  ];

  it('W13 — 완전 신규 참가자는 진행 중 방 입장이 거부된다(row 생성 0건)', async () => {
    const db = seedRoom({ participants: IN_ROUND_ROSTER });
    const { impl, calls, state } = loadJoinRoom({
      db, code: 'R1', name: 'NEW', lastJoinedRoomCode: '', savedNickname: '',
    });
    await impl.joinRoom();
    expect(db.tables.participants.map((p) => p.id)).toEqual(['B', 'C']); // insert 0건
    expect(db.writeLog.filter((w) => w.op === 'insert')).toEqual([]);
    expect(calls.toast.some((m) => String(m).includes('새로 참가할 수 없습니다'))).toBe(true);
    expect(state.currentUserId).not.toBe('');  // 로컬 id는 만들어지지만 DB row는 없다
    expect(db.hostRows().map((p) => p.id)).toEqual(['B']);
  });

  it('W14/W15 — returning participant는 입장이 허용되고 insert payload에 __waiting__이 실린다', async () => {
    const db = seedRoom({ participants: IN_ROUND_ROSTER });
    const { impl, state } = loadJoinRoom({
      db, code: 'R1', name: 'A', lastJoinedRoomCode: 'R1', savedNickname: 'A',
    });
    await impl.joinRoom();
    const inserts = db.writeLog.filter((w) => w.op === 'insert');
    expect(inserts.length).toBe(1);
    expect(inserts[0].rows[0]).toMatchObject({
      room_id: 'R1', name: 'A', is_host: false, choice: '__waiting__', is_ready: false,
    });
    const row = db.tables.participants.find((p) => p.name === 'A');
    expect(row.choice).toBe('__waiting__');
    expect(row.is_host).toBe(false);
    expect(state.role).toBe('participant');
    // 현재 Host는 그대로 B 한 명
    expect(db.hostRows().map((p) => p.id)).toEqual(['B']);
  });

  it('잠기지 않은 방(waiting)에 재입장하면 __waiting__을 달지 않는다', async () => {
    const db = seedRoom({
      status: 'waiting',
      participants: [{ id: 'B', room_id: 'R1', name: 'B', is_host: true, is_ready: false, created_at: T0 }],
    });
    const { impl } = loadJoinRoom({
      db, code: 'R1', name: 'A', lastJoinedRoomCode: 'R1', savedNickname: 'A',
    });
    await impl.joinRoom();
    const row = db.tables.participants.find((p) => p.name === 'A');
    expect(row.choice).toBe(null);
  });

  it('기존 row가 남아 있는 재입장(existing 분기)도 __waiting__을 받는다', async () => {
    const db = seedRoom({
      participants: [
        ...IN_ROUND_ROSTER,
        { id: 'A', room_id: 'R1', name: 'A', is_host: false, is_ready: true, choice: 'rock', created_at: T10 },
      ],
    });
    const { impl } = loadJoinRoom({
      db, code: 'R1', name: 'A', lastJoinedRoomCode: 'R1', savedNickname: 'A',
    });
    await impl.joinRoom();
    expect(db.writeLog.filter((w) => w.op === 'insert')).toEqual([]);
    const row = db.tables.participants.find((p) => p.id === 'A');
    expect(row.choice).toBe('__waiting__');
    expect(row.is_ready).toBe(false);
  });

  it('M3 — insert payload의 choice를 제거하면 재입장자가 즉시 ACTIVE가 된다(RED)', async () => {
    const mutated = JOIN_ROOM_BLOCK.replace(
      'id, room_id: code, name, is_host: false, choice: waitingChoice, is_ready: false',
      'id, room_id: code, name, is_host: false, is_ready: false'
    );
    expect(mutated).not.toBe(JOIN_ROOM_BLOCK);
    const db = seedRoom({ participants: IN_ROUND_ROSTER });
    const { impl } = loadJoinRoom({
      db, code: 'R1', name: 'A', lastJoinedRoomCode: 'R1', savedNickname: 'A',
      joinRoomSrcOverride: mutated,
    });
    await impl.joinRoom();
    const row = db.tables.participants.find((p) => p.name === 'A');
    expect(row.choice).toBeUndefined();
    // 그리고 그 결과가 실제 분류 결함으로 이어진다(GAP-1의 실기기 증상).
    expect(computePlayerStatuses([{ id: row.id, choice: row.choice }], [], [])[row.id])
      .toBe(PLAYER_STATUS.ACTIVE);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('W5~W12 + M9/M10 — Host 권한 완전 소멸과 재입장', () => {
  // A(host) → B에게 양도 후 이탈 → A가 같은 방에 재입장하는 전체 경로를 하나의 DB로 잇는다.
  async function transferThenRejoin({ joinRoomSrcOverride = null, joinScreenMode = 'recent' } = {}) {
    const db = createFakeDb({
      rooms: [{ id: 'R1', status: 'playing', round: 2, penalty: '' }],
      participants: [
        { id: 'A', room_id: 'R1', name: 'A', is_host: true, is_ready: true, created_at: T0 },
        { id: 'B', room_id: 'R1', name: 'B', is_host: false, is_ready: true, created_at: T5 },
        { id: 'C', room_id: 'R1', name: 'C', is_host: false, is_ready: true, created_at: T10 },
      ],
    });
    const hostTerm = loadHostCluster({
      db, currentUserId: 'A', role: 'host',
      participants: [
        { id: 'A', is_host: true, created_at: T0 },
        { id: 'B', is_host: false, created_at: T5 },
        { id: 'C', is_host: false, created_at: T10 },
      ],
    });
    await hostTerm.impl.transferHostAndLeave('B');
    const rejoin = loadJoinRoom({
      db, code: 'R1', name: 'A', lastJoinedRoomCode: 'R1', savedNickname: 'A',
      joinScreenMode,
      // 과거 host였다는 이력(참가자 id + role)이 그대로 남아 있는 상태에서 재입장한다.
      joinRecentRoom: { participantId: 'A', nickname: 'A', role: 'host' },
      joinRoomSrcOverride,
    });
    await rejoin.impl.joinRoom();
    return { db, hostTerm, rejoin };
  }

  it('W5/W6 — 양도가 성립하고, 양도 직후 A는 더 이상 host가 아니다', async () => {
    const db = createFakeDb({
      rooms: [{ id: 'R1', status: 'playing', round: 2, penalty: '' }],
      participants: [
        { id: 'A', room_id: 'R1', name: 'A', is_host: true, created_at: T0 },
        { id: 'B', room_id: 'R1', name: 'B', is_host: false, created_at: T5 },
      ],
    });
    const hostTerm = loadHostCluster({
      db, currentUserId: 'A', role: 'host',
      participants: [{ id: 'A', is_host: true, created_at: T0 }, { id: 'B', is_host: false, created_at: T5 }],
    });
    await hostTerm.impl.transferHostAndLeave('B');
    expect(db.tables.participants.filter((p) => p.id === 'A' && p.is_host)).toEqual([]);
    expect(db.hostRows().map((p) => p.id)).toEqual(['B']);
    expect(hostTerm.calls.goHome).toBe(1);
  });

  it('W8/W9/W10/W11 — 재입장한 A는 participant + is_host=false + __waiting__, 현재 Host는 B 유지', async () => {
    const { db, rejoin } = await transferThenRejoin();
    const rowA = db.tables.participants.find((p) => p.name === 'A');
    expect(rowA).toBeDefined();
    expect(rowA.is_host).toBe(false);          // W9
    expect(rowA.choice).toBe('__waiting__');   // W9
    expect(rowA.is_ready).toBe(false);
    expect(rejoin.state.role).toBe('participant'); // W11: 과거 host 이력이 role 복원에 쓰이지 않음
    expect(db.hostRows().map((p) => p.id)).toEqual(['B']); // W10/W27: 현재 Host 정확히 1명(B)
  });

  it('W7 — 재입장한 A에게 Host 전용 게이트가 전부 닫혀 있다', async () => {
    const { db, rejoin } = await transferThenRejoin();
    const rows = db.tables.participants.map((p) => ({
      id: p.id, is_host: p.is_host, is_ready: p.is_ready, choice: p.choice,
    }));
    const { impl } = loadGuards({
      participants: rows, role: rejoin.state.role, status: 'ready', round: 2, targetLoserCount: 1,
    });
    expect(impl.canShowPlayAgainButton()).toBe(false);        // host 아님
    expect(impl.canShowForceStartReplayButton()).toBe(false); // host 아님
    // 그리고 A는 이번 라운드 WAITING이라 활성 후보에도 없다.
    expect(impl.getWaitingPlayers().map((p) => p.id)).toEqual([rows.find((r) => r.id !== 'B' && r.id !== 'C').id]);
    expect(impl.getActivePlayers().map((p) => p.id).sort()).toEqual(['B', 'C']);
  });

  it('W12 — 다음 유효 라운드 초기화 후 A가 일반 참가자로 ACTIVE 복귀한다(__waiting__ 재기록 없음)', async () => {
    const { db } = await transferThenRejoin();
    const rowA = db.tables.participants.find((p) => p.name === 'A');
    const state = {
      participants: db.tables.participants.map((p) => ({
        id: p.id, is_host: p.is_host, is_ready: p.is_ready, choice: p.choice,
      })),
    };
    const factory = new Function('state',
      `"use strict";\n${NEW_ROUND_PATCH_BLOCK}\nreturn { getNewGameRoundParticipantPatch, resetLocalParticipantsForNewGameRound };`);
    const impl = factory(state);
    expect(impl.getNewGameRoundParticipantPatch().choice).toBe(null);
    impl.resetLocalParticipantsForNewGameRound();
    const after = state.participants.find((p) => p.id === rowA.id);
    expect(after.choice).toBe(null);
    expect(after.is_ready).toBe(false);
    expect(after.is_host).toBe(false); // 과거 host 이력은 복원되지 않는다
    expect(computePlayerStatuses(state.participants.map((p) => ({ id: p.id, choice: p.choice })), [], [])[rowA.id])
      .toBe(PLAYER_STATUS.ACTIVE);
  });

  it('M8 — 다음 라운드에서 __waiting__을 재기록하면 W12가 RED가 된다', async () => {
    const mutated = NEW_ROUND_PATCH_BLOCK.replace(
      '...getNewGameRoundParticipantPatch({ is_host: p.is_host }),',
      "...getNewGameRoundParticipantPatch({ is_host: p.is_host, choice: p.choice === '__waiting__' ? '__waiting__' : null }),"
    );
    expect(mutated).not.toBe(NEW_ROUND_PATCH_BLOCK);
    const state = { participants: [{ id: 'A', is_host: false, is_ready: false, choice: '__waiting__' }] };
    const factory = new Function('state',
      `"use strict";\n${mutated}\nreturn { resetLocalParticipantsForNewGameRound };`);
    factory(state).resetLocalParticipantsForNewGameRound();
    expect(state.participants[0].choice).toBe('__waiting__'); // 복귀 실패 = RED
    expect(computePlayerStatuses([{ id: 'A', choice: state.participants[0].choice }], [], []).A)
      .toBe(PLAYER_STATUS.WAITING);
  });

  it('M9 — 재입장 시 과거 Host role을 복원하면 W11이 RED가 된다', async () => {
    const mutated = JOIN_ROOM_BLOCK.replace(
      `            state.currentUserId = id;
            state.role = "participant";`,
      `            state.currentUserId = id;
            state.role = (state.joinRecentRoom && state.joinRecentRoom.role) || "participant";`
    );
    expect(mutated).not.toBe(JOIN_ROOM_BLOCK);
    const { rejoin } = await transferThenRejoin({ joinRoomSrcOverride: mutated });
    expect(rejoin.state.role).toBe('host'); // 과거 이력으로 권한 부활 = RED
  });

  it('M10 — 재입장 insert가 is_host=true면 현재 Host가 덮어써진다(RED)', async () => {
    const mutated = JOIN_ROOM_BLOCK.replace(
      'id, room_id: code, name, is_host: false, choice: waitingChoice, is_ready: false',
      'id, room_id: code, name, is_host: true, choice: waitingChoice, is_ready: false'
    );
    expect(mutated).not.toBe(JOIN_ROOM_BLOCK);
    const { db } = await transferThenRejoin({ joinRoomSrcOverride: mutated });
    expect(db.hostRows().length).toBe(2); // host exactly-one 위반 = RED
    expect(db.hostRows().map((p) => p.name).sort()).toEqual(['A', 'B']);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('W21~W24 + M6/M7 — C-2 자동 복구 writer(REAL)', () => {
  // ACTIVE=0(전원 확정 안전) · WAITING=1 · 확정 술래 0 / 목표 1 → C-2
  function c2Setup(extra = {}) {
    const db = createFakeDb({
      rooms: [{ id: 'R1', status: 'result', round: 2, penalty: '' }],
      participants: [
        { id: 'H', room_id: 'R1', name: 'H', is_host: true, is_ready: true, choice: '__safe__', created_at: T0 },
        { id: 'S', room_id: 'R1', name: 'S', is_host: false, is_ready: true, choice: '__safe__', created_at: T5 },
        { id: 'W', room_id: 'R1', name: 'W', is_host: false, is_ready: false, choice: '__waiting__', created_at: T10 },
      ],
    });
    const term = loadRecovery({
      db,
      participants: [
        { id: 'H', is_host: true, is_ready: true, choice: '__safe__' },
        { id: 'S', is_host: false, is_ready: true, choice: '__safe__' },
        { id: 'W', is_host: false, is_ready: false, choice: '__waiting__' },
      ],
      confirmedSafeIds: ['H', 'S'], confirmedLoserIds: [], targetLoserCount: 1,
      ...extra,
    });
    return { db, term };
  }

  it('W21 — 1회 관측에서는 write가 0건이다', async () => {
    const { db, term } = c2Setup();
    await term.impl.recoverRoundWhenAllPlayersWaiting();
    expect(term.state.allWaitingObservationStreak).toBe(1);
    expect(db.writeLog).toEqual([]);
  });

  it('W22/W23/W24 — 2회 연속 관측에서 정확히 1회 복구, round 미증가, WAITING 소멸', async () => {
    const { db, term } = c2Setup();
    await term.impl.recoverRoundWhenAllPlayersWaiting();
    await term.impl.recoverRoundWhenAllPlayersWaiting();

    const roomWrites = db.roomWrites();
    expect(roomWrites.length).toBe(1);                       // W22: 정확히 1회
    expect(roomWrites[0].patch.status).toBe('ready');
    expect('round' in roomWrites[0].patch).toBe(false);      // W23: round 미증가
    expect(db.tables.rooms[0].round).toBe(2);
    expect(db.tables.rooms[0].status).toBe('ready');

    // W24: waiting marker 초기화 + 확정 안전 마커는 재기록
    expect(db.tables.participants.find((p) => p.id === 'W').choice).toBe(null);
    expect(db.tables.participants.find((p) => p.id === 'W').is_ready).toBe(false);
    expect(db.tables.participants.find((p) => p.id === 'H').choice).toBe('__safe__');
    expect(db.tables.participants.find((p) => p.id === 'S').choice).toBe('__safe__');

    // 복구 후 스냅샷에서 W가 ACTIVE로 복귀한다
    const rows = db.tables.participants.map((p) => ({ id: p.id, choice: p.choice }));
    expect(getActiveIds(rows, ['H', 'S'], [])).toEqual(['W']);

    // 3회차 호출은 조건 불성립(로컬 스냅샷 기준으로도 streak 리셋됨) → 추가 write 없음
    const before = db.writeLog.length;
    term.state.participants = db.tables.participants.map((p) => ({ ...p }));
    await term.impl.recoverRoundWhenAllPlayersWaiting();
    expect(db.writeLog.length).toBe(before);
    expect(term.state.allWaitingObservationStreak).toBe(0);
  });

  it('C-1(술래 충족)에서는 2회 관측해도 복구하지 않는다', async () => {
    const db = createFakeDb({
      rooms: [{ id: 'R1', status: 'result', round: 2, penalty: '' }],
      participants: [
        { id: 'H', room_id: 'R1', is_host: true, choice: '__safe__', created_at: T0 },
        { id: 'L', room_id: 'R1', is_host: false, choice: '__loser__', created_at: T5 },
        { id: 'W', room_id: 'R1', is_host: false, choice: '__waiting__', created_at: T10 },
      ],
    });
    const term = loadRecovery({
      db,
      participants: [
        { id: 'H', is_host: true, choice: '__safe__' },
        { id: 'L', is_host: false, choice: '__loser__' },
        { id: 'W', is_host: false, choice: '__waiting__' },
      ],
      confirmedSafeIds: ['H'], confirmedLoserIds: ['L'], targetLoserCount: 1,
    });
    await term.impl.recoverRoundWhenAllPlayersWaiting();
    await term.impl.recoverRoundWhenAllPlayersWaiting();
    expect(db.writeLog).toEqual([]);
    expect(term.state.allWaitingObservationStreak).toBe(0);
  });

  it('8조건 게이트 — host 아님 / roomClosing / gameStarting / advancingRound / WAITING=0 / ACTIVE>0 에서 write 0건', async () => {
    const variants = [
      { role: 'participant' },
      { roomClosing: true },
      { gameStarting: true },
      { advancingRound: true },
    ];
    for (const v of variants) {
      const { db, term } = c2Setup(v);
      await term.impl.recoverRoundWhenAllPlayersWaiting();
      await term.impl.recoverRoundWhenAllPlayersWaiting();
      expect([JSON.stringify(v), db.writeLog.length]).toEqual([JSON.stringify(v), 0]);
      expect(term.state.allWaitingObservationStreak).toBe(0);
    }
    // ACTIVE>0 (아직 겨룰 사람이 남아 있음)
    const db2 = createFakeDb({
      rooms: [{ id: 'R1', status: 'result', round: 2, penalty: '' }],
      participants: [{ id: 'H', room_id: 'R1', is_host: true, created_at: T0 }],
    });
    const t2 = loadRecovery({
      db: db2,
      participants: [{ id: 'H', is_host: true }, { id: 'W', is_host: false, choice: '__waiting__' }],
      confirmedSafeIds: [], confirmedLoserIds: [], targetLoserCount: 1,
    });
    await t2.impl.recoverRoundWhenAllPlayersWaiting();
    await t2.impl.recoverRoundWhenAllPlayersWaiting();
    expect(db2.writeLog).toEqual([]);
    // WAITING=0
    const db3 = createFakeDb({
      rooms: [{ id: 'R1', status: 'result', round: 2, penalty: '' }],
      participants: [{ id: 'H', room_id: 'R1', is_host: true, choice: '__safe__', created_at: T0 }],
    });
    const t3 = loadRecovery({
      db: db3,
      participants: [{ id: 'H', is_host: true, choice: '__safe__' }],
      confirmedSafeIds: ['H'], confirmedLoserIds: [], targetLoserCount: 1,
    });
    await t3.impl.recoverRoundWhenAllPlayersWaiting();
    await t3.impl.recoverRoundWhenAllPlayersWaiting();
    expect(db3.writeLog).toEqual([]);
  });

  it('M6 — target 미달 한정자를 삭제하면 C-1(정상 완료)에서도 복구가 발화한다(RED)', async () => {
    const mutated = ENSURE_AND_RECOVERY_BLOCK.replace(
      'if (!(activeCount === 0 && waitingCount > 0 && confirmedLoserCount < targetLoserCount)) {',
      'if (!(activeCount === 0 && waitingCount > 0)) {'
    );
    expect(mutated).not.toBe(ENSURE_AND_RECOVERY_BLOCK);
    const db = createFakeDb({
      rooms: [{ id: 'R1', status: 'result', round: 2, penalty: '' }],
      participants: [
        { id: 'H', room_id: 'R1', is_host: true, choice: '__safe__', created_at: T0 },
        { id: 'L', room_id: 'R1', is_host: false, choice: '__loser__', created_at: T5 },
        { id: 'W', room_id: 'R1', is_host: false, choice: '__waiting__', created_at: T10 },
      ],
    });
    const term = loadRecovery({
      db,
      participants: [
        { id: 'H', is_host: true, choice: '__safe__' },
        { id: 'L', is_host: false, choice: '__loser__' },
        { id: 'W', is_host: false, choice: '__waiting__' },
      ],
      confirmedSafeIds: ['H'], confirmedLoserIds: ['L'], targetLoserCount: 1,
      recoverySrcOverride: mutated,
    });
    await term.impl.recoverRoundWhenAllPlayersWaiting();
    await term.impl.recoverRoundWhenAllPlayersWaiting();
    expect(db.roomWrites().length).toBe(1); // 정상 종료된 게임을 ready로 되돌림 = RED
  });

  it('M7 — 2회 관측 게이트를 삭제하면 1회 관측에서 즉시 write가 발생한다(RED)', async () => {
    const mutated = ENSURE_AND_RECOVERY_BLOCK.replace(
      'if (state.allWaitingObservationStreak < 2) return;\n', ''
    );
    expect(mutated).not.toBe(ENSURE_AND_RECOVERY_BLOCK);
    const { db, term } = c2Setup({ recoverySrcOverride: mutated });
    await term.impl.recoverRoundWhenAllPlayersWaiting();
    expect(db.roomWrites().length).toBe(1); // W21 위반 = RED
  });

  it('QA 비간섭 — QA.emit이 던져도 DB write 순서/결과가 동일하다', async () => {
    const withQa = c2Setup();
    await withQa.term.impl.recoverRoundWhenAllPlayersWaiting();
    await withQa.term.impl.recoverRoundWhenAllPlayersWaiting();

    const off = c2Setup();
    // QA 계측을 "완전 실패"로 대체해도 상태 전이가 같아야 한다.
    const factoryState = off.term.state;
    const dbOff = off.db;
    const combined = `${ROOM_GUARD_SRC}\n${PENALTY_BLOCK}\n${GUARD_BLOCK}\n${HOST_HELPERS_BLOCK}\n${ENSURE_AND_RECOVERY_BLOCK}`;
    const implOff = new Function(
      'state', 'db', 'QA', 'getOnlineMode', 'computePlayerStatuses', 'PLAYER_STATUS',
      'buildPenaltyValue', 'getNextPhaseScheduledAt',
      `"use strict";\n${combined}\nreturn { recoverRoundWhenAllPlayersWaiting };`
    )(
      factoryState, dbOff,
      { emit: () => { throw new Error('[QA off] emit must not affect state transitions'); } },
      () => true, computePlayerStatuses, PLAYER_STATUS,
      ({ gameRound, phaseScheduledAt, phaseKind }) => `g${gameRound}|${phaseKind}|${phaseScheduledAt}`,
      () => 1000
    );
    await implOff.recoverRoundWhenAllPlayersWaiting();
    await implOff.recoverRoundWhenAllPlayersWaiting();

    const shape = (d) => d.writeLog.map((w) => [w.table, w.op, JSON.stringify(w.patch || w.rows || null)]);
    expect(shape(off.db)).toEqual(shape(withQa.db));
    expect(off.db.tables.rooms[0].status).toBe(withQa.db.tables.rooms[0].status);
    expect(off.db.tables.rooms[0].round).toBe(withQa.db.tables.rooms[0].round);
    expect(off.term.state.allWaitingObservationStreak).toBe(withQa.term.state.allWaitingObservationStreak);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('W22 배선 + M5(배선) — fetchParticipants가 C-2 writer를 실제로 호출한다', () => {
  function c2Db() {
    return createFakeDb({
      rooms: [{ id: 'R1', status: 'result', round: 2, penalty: '' }],
      participants: [
        { id: 'H', room_id: 'R1', name: 'H', is_host: true, is_ready: true, choice: '__safe__', created_at: T0 },
        { id: 'S', room_id: 'R1', name: 'S', is_host: false, is_ready: true, choice: '__safe__', created_at: T5 },
        { id: 'W', room_id: 'R1', name: 'W', is_host: false, is_ready: false, choice: '__waiting__', created_at: T10 },
      ],
    });
  }

  it('폴링 2회(REAL fetchParticipants)에서 C-2 복구가 정확히 1회 실행된다', async () => {
    const db = c2Db();
    const term = loadFetchTerminal({ db });
    term.state.confirmedSafeIds = ['H', 'S'];
    await term.impl.fetchParticipants('R1');
    expect(db.roomWrites().length).toBe(0);   // 1회 관측: write 0건
    term.state.confirmedSafeIds = ['H', 'S'];
    await term.impl.fetchParticipants('R1');
    expect(db.roomWrites().length).toBe(1);   // 2회 관측: 정확히 1회 복구
    expect(db.roomWrites()[0].patch.status).toBe('ready');
    expect(db.tables.participants.find((p) => p.id === 'W').choice).toBe(null);
  });

  it('배선 line을 제거하면 방이 C-2에서 영구 정지한다(RED)', async () => {
    const mutated = FETCH_CLUSTER_BLOCK.replace(RECOVERY_WIRING_CALL, '');
    expect(mutated).not.toBe(FETCH_CLUSTER_BLOCK);
    const db = c2Db();
    const term = loadFetchTerminal({ db, fetchSrcOverride: mutated });
    for (let i = 0; i < 4; i += 1) {
      term.state.confirmedSafeIds = ['H', 'S'];
      await term.impl.fetchParticipants('R1');
    }
    expect(db.roomWrites().length).toBe(0);  // 영원히 복구되지 않음 = RED
    expect(db.tables.participants.find((p) => p.id === 'W').choice).toBe('__waiting__');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('W25~W28 — WRPS-083 1단계 무회귀', () => {
  it('W25/W26 — 전원 WAITING + host 0명이어도 ensureHostExists가 결정적 후보를 승격한다', async () => {
    const db = createFakeDb({
      rooms: [{ id: 'R1', status: 'result', round: 2, penalty: '' }],
      participants: [
        { id: 'w2', room_id: 'R1', is_host: false, choice: '__waiting__', created_at: T5 },
        { id: 'w1', room_id: 'R1', is_host: false, choice: '__waiting__', created_at: T0 },
      ],
    });
    const term = loadRecovery({
      db, role: 'participant', currentUserId: 'w1',
      participants: [
        { id: 'w2', is_host: false, choice: '__waiting__', created_at: T5 },
        { id: 'w1', is_host: false, choice: '__waiting__', created_at: T0 },
      ],
    });
    // W26: WAITING이어도 host 후보다(후보 선택은 choice를 읽지 않는다).
    expect(term.impl.pickDeterministicHostCandidate(term.state.participants).id).toBe('w1');
    await term.impl.ensureHostExists(); // 1회 관측 — 승격 없음
    expect(db.hostRows()).toEqual([]);
    await term.impl.ensureHostExists(); // 2회 관측 — 후보 본인만 승격
    expect(db.hostRows().map((p) => p.id)).toEqual(['w1']); // W25/W27: host 정확히 1명
    expect(term.state.role).toBe('host');
  });

  it('W27/W28 — 승격 write가 0-row no-op이면 기존 Host를 유지하고 이탈하지 않는다', async () => {
    const db = createFakeDb({
      rooms: [{ id: 'R1', status: 'playing', round: 2, penalty: '' }],
      participants: [{ id: 'A', room_id: 'R1', name: 'A', is_host: true, created_at: T0 }],
    });
    const hostTerm = loadHostCluster({
      db, currentUserId: 'A', role: 'host',
      participants: [{ id: 'A', is_host: true, created_at: T0 }, { id: 'GONE', is_host: false, created_at: T5 }],
    });
    await hostTerm.impl.transferHostAndLeave('GONE'); // 대상 row가 DB에 없다(이미 퇴장)
    expect(db.tables.participants.map((p) => p.id)).toEqual(['A']); // 기존 host row 유지
    expect(db.hostRows().map((p) => p.id)).toEqual(['A']);          // host 여전히 1명
    expect(hostTerm.calls.goHome).toBe(0);                          // 이탈하지 않음
    expect(hostTerm.calls.toast.length).toBe(1);
  });
});
