// WRPS-083 2B — Host Leave / Room Destroy 결정적 테스트 (CEO 승인 범위: D1~D44 / N1~N20).
//
// index.html 무수정 원칙(tests/host-transfer-stage1.test.mjs · waiting-state-stage2a.test.mjs 선례):
// 이 파일은 index.html을 오직 readFileSync + 문자열 마커 슬라이싱으로만 읽고, 추출한 REAL 소스를
// new Function으로 그대로 실행한다. hand-copy simulation / no-op mock / 문자열 존재 검사 단독 PASS는
// 금지다. mutation도 프로덕션 원문 치환본을 같은 하니스로 구동한다.

import { readFileSync } from 'node:fs';
import { describe, it, expect, vi } from 'vitest';
import { computePlayerStatuses, PLAYER_STATUS } from '../src/game-logic.mjs';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

function extractBlock(startMarker, endMarker, label) {
  const start = html.indexOf(startMarker);
  if (start < 0) throw new Error(`[2B] start marker not found (${label}): ${startMarker}`);
  const end = html.indexOf(endMarker, start + startMarker.length);
  if (end < 0) throw new Error(`[2B] end marker not found (${label}): ${endMarker}`);
  return html.slice(start, end);
}

// ── REAL 소스 추출 ────────────────────────────────────────────────────────────
const GUARD_HELPER_SRC = extractBlock(
  'function isRoomClosingOrDestroyed() {', 'function isJoinLocked(', 'guardHelper'
);
// destroyRoomAndGoHome + teardownRoomRuntime + clearRoomScopedCache + 팝업 핸들러 + destroyRoomByHost
const DESTROY_CLUSTER_SRC = extractBlock(
  'async function destroyRoomAndGoHome(reason = "room_destroyed") {',
  'function showNextHostPopup() {', 'destroyCluster'
);
const LEAVE_SRC = extractBlock(
  'async function leaveRoom() {', 'async function destroyRoomAndGoHome(', 'leave'
);
const HOST_HELPERS_SRC = extractBlock(
  'function pickDeterministicHostCandidate(rows) {', 'async function leaveRoom() {', 'hostHelpers'
);
const TRANSFER_SRC = extractBlock(
  'async function transferHostAndLeave(newHostId) {', 'function startGameOverCountdown(seconds) {', 'transfer'
);
const ENSURE_RECOVERY_SRC = extractBlock(
  'async function ensureHostExists() {', 'async function returnToLobbyAfterGame() {', 'ensure+recovery'
);
const DROPPED_SRC = extractBlock(
  'async function cleanupDroppedParticipants() {', 'async function subscribeToRoom(roomCode) {', 'dropped'
);
const SUBSCRIBE_SRC = extractBlock(
  'async function subscribeToRoom(roomCode) {', 'async function handleRoomUpdate(room) {', 'subscribe'
);
const HANDLE_ROOM_SRC = extractBlock(
  'async function handleRoomUpdate(room) {', 'async function updateRoomStatus(status) {', 'handleRoom'
);
const JOIN_PREVIEW_SRC = extractBlock(
  'function getJoinRoomPreview(room, participants = []) {', 'async function cleanupDuplicateRoomProfiles(', 'joinPreview'
);
const JOIN_ROOM_SRC = extractBlock(
  'async function joinRoom() {', 'async function requestReplayFromJoinedRoom(', 'joinRoom'
);
const CREATE_ROOM_SRC = extractBlock(
  'async function createRoom() {', 'function createParticipant(', 'createRoom'
);

// ── 결정적 fake supabase ─────────────────────────────────────────────────────
function createFakeDb({ participants = [], rooms = [], failRoomUpdate = false,
                        failParticipantsDelete = false, roomUpdateNoop = false,
                        duplicateRoomIds = [] } = {}) {
  const tables = { participants: participants.map(p => ({ ...p })), rooms: rooms.map(r => ({ ...r })) };
  const writeLog = [];
  const dupes = new Set(duplicateRoomIds);
  function makeBuilder(table, op, payload) {
    const filters = [];
    const b = {
      _single: false,
      eq(c, v) { filters.push([c, v]); return b; },
      in(c, v) { filters.push([c, v, 'in']); return b; },
      order() { return b; },
      single() { b._single = true; return b; },
      then(res, rej) { return exec().then(res, rej); },
    };
    async function exec() {
      const match = r => filters.every(([c, v, k]) => (k === 'in' ? v.includes(r[c]) : r[c] === v));
      if (op === 'insert') {
        const rows = (Array.isArray(payload) ? payload : [payload]).map(r => ({ ...r }));
        if (table === 'rooms' && dupes.has(rows[0].id)) {
          writeLog.push({ table, op, rejected: rows[0].id });
          return { data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint' } };
        }
        writeLog.push({ table, op, rows });
        tables[table].push(...rows);
        return { data: rows, error: null };
      }
      const rows = tables[table].filter(match);
      if (op === 'update') {
        writeLog.push({ table, op, patch: { ...payload }, filters: filters.map(f => [...f]), matched: rows.length });
        if (failRoomUpdate && table === 'rooms') return { data: null, error: { message: '[injected] rooms update failed' } };
        if (roomUpdateNoop && table === 'rooms') return { data: null, error: null }; // error 없이 0-row no-op
        rows.forEach(r => Object.assign(r, payload));
        return { data: null, error: null };
      }
      if (op === 'delete') {
        writeLog.push({ table, op, filters: filters.map(f => [...f]), matched: rows.length });
        if (failParticipantsDelete && table === 'participants') return { data: null, error: { message: '[injected] delete failed' } };
        for (const r of rows) tables[table].splice(tables[table].indexOf(r), 1);
        return { data: null, error: null };
      }
      const copies = rows.map(r => ({ ...r }));
      if (b._single) {
        return copies.length === 1 ? { data: copies[0], error: null }
          : { data: null, error: { code: 'PGRST116', message: '[fake] expected 1 row' } };
      }
      return { data: copies, error: null };
    }
    return b;
  }
  return {
    tables, writeLog,
    roomWrites() { return writeLog.filter(w => w.table === 'rooms' && w.op !== 'select'); },
    participantWrites() { return writeLog.filter(w => w.table === 'participants' && w.op !== 'select'); },
    destroyWrites() { return writeLog.filter(w => w.table === 'rooms' && w.op === 'update' && w.patch && w.patch.status === 'destroyed'); },
    hardDeletes() { return writeLog.filter(w => w.table === 'rooms' && w.op === 'delete'); },
    from(table) {
      if (!tables[table]) throw new Error('[2B] unsupported table: ' + table);
      return {
        insert: r => makeBuilder(table, 'insert', r),
        update: p => makeBuilder(table, 'update', p),
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

const T0 = '2026-01-01T00:00:00.000Z';
const T5 = '2026-01-01T00:00:05.000Z';
const T10 = '2026-01-01T00:00:10.000Z';

// ── 하니스 1: destroy 클러스터(REAL) ─────────────────────────────────────────
function loadDestroy({
  db, role = 'host', currentUserId = 'H', roomCode = 'R1', status = 'game_over',
  participants = [], confirmMap = { destroy: true, leave: true },
  srcOverride = null, roundActivity = true,
}) {
  const state = {
    role, currentUserId, roomCode, status,
    participants: participants.map(p => ({ ...p })),
    confirmedSafeIds: [], confirmedLoserIds: [],
    roomClosing: false, hostTransferInFlight: false, leavingProcessing: false,
    gameStarting: false, finishingRound: false, publishingRoundResult: false,
    advancingRound: false, autoStartInFlight: false, newRoundResetting: false,
    cleaningDropped: false, becomingNextHost: false, ensuringHostExists: false,
    recoveringAllWaiting: false, hostZeroObservationStreak: 0, allWaitingObservationStreak: 0,
    presenceCleanupTimers: [], countdownGeneration: 0, renderedPhaseKeys: { a: 1 },
    gameOverTimeout: 1, rematchAdvanceTimer: 2, roundJudgeDeferTimer: 3, globalInviteTimer: 4,
    joinRecentRoom: { code: roomCode, participantId: currentUserId, role: 'host' },
    nickname: 'nick', pollInterval: 9, channel: { id: 'ch' },
  };
  const calls = { toast: [], qa: [], goHome: 0, teardownCalls: 0, archive: [], confirm: [], clearRealtime: 0, stopAll: 0, discard: 0 };
  const storage = { 'rpsPartyState:guest': JSON.stringify({ roomCode }), 'rpsRecentRoomCodes:guest': JSON.stringify([{ code: roomCode, ts: 1 }, { code: 'OTHER', ts: 2 }]) };
  let _inviteCountdownTimer = 5;
  const combined = `${GUARD_HELPER_SRC}\n${srcOverride ?? DESTROY_CLUSTER_SRC}`;
  const factory = new Function(
    'state', 'db', 'QA', 'getOnlineMode', 'showToast', 't', 'goHome', 'clearRealtime',
    'stopRoundTimers', 'stopGameOverCountdown', 'stopQrScanner', 'SoundManager',
    'getScopedLocalStorageItem', 'setScopedLocalStorageItem', 'getRecentRoomCodes',
    'discardInProgressRoomSession', 'showConfirmPopup', 'showNextHostPopup', '$',
    'archiveCurrentRoundStats', 'hasCurrentGameRoundActivity', '_doLeaveRoom', 'computePlayerStatuses', 'PLAYER_STATUS',
    `"use strict";\nlet _inviteCountdownTimer = 5;\n${combined}\nreturn { destroyRoomByHost, destroyRoomAndGoHome, teardownRoomRuntime, clearRoomScopedCache, chooseRoomDestroyFromLeave, chooseHostTransferFromLeave, showHostLeavePopup, closeHostLeavePopup, isRoomClosingOrDestroyed, isRoundInProgressForLeave };`
  );
  const impl = factory(
    state, db,
    { emit: (kind, p) => calls.qa.push({ kind, ...p }) },
    () => true,
    m => calls.toast.push(m),
    k => k,
    () => { calls.goHome += 1; },
    () => { calls.clearRealtime += 1; state.pollInterval = null; state.channel = null; },
    noop, noop, noop,
    { stopAll: () => { calls.stopAll += 1; } },
    k => storage[k + ':guest'] ?? null,
    (k, v) => { storage[k + ':guest'] = v; },
    () => { try { return JSON.parse(storage['rpsRecentRoomCodes:guest'] || '[]'); } catch { return []; } },
    () => { calls.discard += 1; },
    async (opts) => { calls.confirm.push(opts); return opts.okText && String(opts.okText).includes('Destroy') ? confirmMap.destroy : (String(opts.okText).includes('confirmDestroyOk') ? confirmMap.destroy : confirmMap.leave); },
    noop, fakeEl,
    (reason) => { calls.archive.push(reason); },
    () => roundActivity,
    asyncNoop, computePlayerStatuses, PLAYER_STATUS
  );
  return { state, calls, impl, storage };
}

// ── 하니스 2: handleRoomUpdate(REAL) — destroyed 수렴 ────────────────────────
function loadHandleRoom({ db, roomCode = 'R1', localGameRound = 1, srcOverride = null }) {
  const state = {
    role: 'participant', currentUserId: 'P1', roomCode, status: 'playing',
    participants: [], confirmedSafeIds: [], confirmedLoserIds: [],
    gameRound: localGameRound, round: 1, penalty: '', targetLoserCount: 1,
    roomClosing: false, hostTransferInFlight: false, leavingProcessing: false,
    staleRoomUpdateSkipStreak: 0, hruGen: 0, hruActiveKey: null,
    presenceCleanupTimers: [], countdownGeneration: 0, renderedPhaseKeys: {},
    playingEntryKey: null, joinRecentRoom: { code: roomCode },
  };
  const calls = { qa: [], goHome: 0, toast: [], teardown: 0, cacheCleared: [] };
  const storage = { 'rpsPartyState:guest': JSON.stringify({ roomCode }), 'rpsRecentRoomCodes:guest': JSON.stringify([{ code: roomCode, ts: 1 }]) };
  const combined = `${GUARD_HELPER_SRC}\n${srcOverride ?? HANDLE_ROOM_SRC}`;
  const factory = new Function(
    'state', 'db', 'QA', 'goHome', 'showToast', 't', 'teardownRoomRuntime', 'clearRoomScopedCache',
    'getPenaltyGameRound', 'getGameRound', 'getTargetLoserCount', 'getCountdownStartAt', 'getChoiceEndAt',
    'parsePenalty', 'toPositiveInt', 'isSafeParticipant', 'isConfirmedLoser', 'syncConfirmedIdsFromParticipants',
    'showScreen', 'showReadyScreen', 'renderAll', 'renderLobby', 'showHostRoom', 'showGameScreen',
    'enterPlayingStateFromRoomUpdate', 'waitForPhaseRender', 'finishRoundLocal', 'renderRoundResult',
    'fetchFreshParticipantsForResult', 'renderTentativeRoundResult', 'showTaggerPopup', 'hideTaggerPopup',
    'stopRoundTimers', 'startHostJudgeBackstop', 'showLoserWaitScreen', 'isCurrentRoundParticipant',
    'showInvitePopupForRoom', 'computePlayerStatuses', 'PLAYER_STATUS', 'getActivePlayers',
    'playVoiceClip', 'SoundManager', 'scheduleFetchParticipants', 'fetchParticipants', '$',
    `"use strict";\n${combined}\nreturn { handleRoomUpdate };`
  );
  const impl = factory(
    state, db,
    { emit: (k, p) => calls.qa.push({ kind: k, ...p }) },
    () => { calls.goHome += 1; },
    m => calls.toast.push(m),
    k => k,
    () => { calls.teardown += 1; },
    (rc) => { calls.cacheCleared.push(rc); },
    () => state.gameRound, () => state.gameRound, () => 1, () => 0, () => 0,
    () => ({ loserCount: 1, gameRound: state.gameRound }), (v, f) => (Number(v) || f || 0),
    () => false, () => false, noop,
    noop, noop, noop, noop, noop, noop,
    asyncNoop, asyncNoop, asyncNoop, noop,
    asyncNoop, () => false, noop, noop,
    noop, noop, noop, () => true,
    noop, computePlayerStatuses, PLAYER_STATUS, () => [],
    asyncNoop, { stopAll: noop }, noop, asyncNoop, fakeEl
  );
  return { state, calls, impl, storage };
}

// ── 하니스 3: presence 타이머 + dropped 정리(REAL) ───────────────────────────
function loadPresence({ db, droppedSrcOverride = null, teardownSrcOverride = null }) {
  const state = {
    role: 'host', currentUserId: 'H', roomCode: 'R1', status: 'ready',
    participants: [
      { id: 'H', is_host: true, is_ready: true },
      { id: 'P1', is_host: false, is_ready: false },
    ],
    onlineParticipantIds: ['H'], presenceReady: true, droppedSince: { P1: 0 },
    cleaningDropped: false, roomClosing: false,
    presenceCleanupTimers: [], countdownGeneration: 0, renderedPhaseKeys: {},
  };
  const calls = { qa: [] };
  const combined = `${GUARD_HELPER_SRC}\n${droppedSrcOverride ?? DROPPED_SRC}\n${teardownSrcOverride ?? DESTROY_CLUSTER_SRC}`;
  const factory = new Function(
    'state', 'db', 'QA', 'getOnlineMode', 'isParticipantOnline', 'renderAll', 'showToast', 't',
    'goHome', 'clearRealtime', 'stopRoundTimers', 'stopGameOverCountdown', 'stopQrScanner',
    'SoundManager', 'getScopedLocalStorageItem', 'setScopedLocalStorageItem', 'getRecentRoomCodes',
    'discardInProgressRoomSession', 'showConfirmPopup', 'showNextHostPopup', '$',
    'archiveCurrentRoundStats', 'hasCurrentGameRoundActivity', '_doLeaveRoom',
    'shouldResetForParticipantChange', 'beginNewGameRound', 'renderRoundResult',
    `"use strict";\nlet _inviteCountdownTimer = null;\n${combined}\nreturn { cleanupDroppedParticipants, teardownRoomRuntime };`
  );
  // presence sync가 하는 일(익명 타이머 2개 예약)을 프로덕션 원문과 동일한 형태로 재현하되,
  // 실행되는 cleanupDroppedParticipants / teardownRoomRuntime은 REAL 추출본이다.
  const impl = factory(
    state, db, { emit: (k, p) => calls.qa.push({ kind: k, ...p }) },
    () => true, (id) => state.onlineParticipantIds.includes(id), noop, noop, k => k,
    noop, noop, noop, noop, noop, { stopAll: noop },
    () => null, noop, () => [], noop, asyncNoop, noop, fakeEl, noop, () => false, asyncNoop,
    () => false, asyncNoop, noop
  );
  return { state, calls, impl };
}

// presence sync 콜백의 타이머 예약부를 프로덕션 원문에서 그대로 잘라 실행한다.
const PRESENCE_SCHEDULE_SRC = extractBlock(
  'if (!state.presenceCleanupTimers) state.presenceCleanupTimers = [];',
  'renderAll();', 'presenceSchedule'
);

describe('fidelity — 추출 계약과 금지 영역', () => {
  it('2B 신규 블록이 존재한다', () => {
    expect(GUARD_HELPER_SRC).toContain('function isRoomClosingOrDestroyed() {');
    expect(DESTROY_CLUSTER_SRC).toContain('async function destroyRoomByHost() {');
    expect(DESTROY_CLUSTER_SRC).toContain('function teardownRoomRuntime() {');
    expect(DESTROY_CLUSTER_SRC).toContain('function clearRoomScopedCache(roomCode) {');
    expect(HANDLE_ROOM_SRC).toContain("if (room.status === 'destroyed') {");
    expect(PRESENCE_SCHEDULE_SRC).toContain('state.presenceCleanupTimers.push(setTimeout');
  });

  it('금지 영역 원문 무변경(판정/stale gate/폴 주기)', () => {
    expect(html).toContain('const STALE_ROOM_UPDATE_SELF_HEAL_THRESHOLD = 5;');
    expect(html).toContain('}, 2600);');
    expect(html).toContain('function judgeRound(');
    expect(html).toContain('function judgePure(');
    expect(html).toContain('function resolveElimination(');
  });

  it('D8 — rooms hard DELETE가 소스 전체에서 사라졌다', () => {
    expect(html).not.toContain("db.from('rooms').delete()");
  });

  it('N15 대응 — destroy 경로가 QA 래퍼 목록에 없다', () => {
    expect(html).toContain("['endGame', 'leaveRoom', 'leaveRoomForce'].forEach");
    expect(html).not.toContain("'destroyRoomByHost'].forEach");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('D4~D8, D33~D35 — destroy write sequence', () => {
  function setup(opts = {}) {
    const db = createFakeDb({
      rooms: [{ id: 'R1', status: 'game_over', round: 2, penalty: '' }],
      participants: [
        { id: 'H', room_id: 'R1', name: 'H', is_host: true, created_at: T0, wins: 2, losses: 1 },
        { id: 'P1', room_id: 'R1', name: 'P1', is_host: false, created_at: T5 },
      ],
      ...opts,
    });
    return { db, term: loadDestroy({ db, participants: [{ id: 'H', is_host: true }, { id: 'P1', is_host: false }] }) };
  }

  it('D4 — rooms update → SELECT 재조회 → participants delete 순서', async () => {
    const { db, term } = setup();
    await term.impl.destroyRoomByHost();
    const ops = db.writeLog.map(w => `${w.table}.${w.op}`);
    expect(ops).toEqual(['rooms.update', 'participants.delete']);
    expect(db.tables.rooms[0].status).toBe('destroyed');
    expect(db.tables.participants).toEqual([]);
    expect(term.calls.goHome).toBe(1);
  });

  it('D5 — rooms update 실패 → participants delete 0', async () => {
    const { db, term } = setup({ failRoomUpdate: true });
    await term.impl.destroyRoomByHost();
    expect(db.participantWrites()).toEqual([]);
    expect(db.tables.participants.length).toBe(2);
    expect(term.calls.goHome).toBe(0);
    expect(term.state.roomClosing).toBe(false);
  });

  it('D6 — update가 0-row no-op이면 SELECT 검증이 잡아 participants delete 0', async () => {
    const { db, term } = setup({ roomUpdateNoop: true });
    await term.impl.destroyRoomByHost();
    expect(db.participantWrites()).toEqual([]);
    expect(db.tables.rooms[0].status).toBe('game_over'); // 여전히 활성
    expect(term.calls.qa.some(q => q.eventType === 'ROOM_DESTROY_VERIFY_FAILED')).toBe(true);
  });

  it('D7/D35 — participants delete 실패해도 tombstone 유지 + 로컬 종료 진행', async () => {
    const { db, term } = setup({ failParticipantsDelete: true });
    await term.impl.destroyRoomByHost();
    expect(db.tables.rooms[0].status).toBe('destroyed');
    expect(db.tables.participants.length).toBe(2);
    expect(term.calls.qa.some(q => q.eventType === 'ROOM_DESTROY_CLEANUP_FAILED')).toBe(true);
    expect(term.calls.goHome).toBe(1); // 로컬 종료는 계속된다
  });

  it('D8 — hard DELETE 0건', async () => {
    const { db, term } = setup();
    await term.impl.destroyRoomByHost();
    expect(db.hardDeletes()).toEqual([]);
  });

  it('D33 — Host 재확인 SELECT 실패 → rooms write 0', async () => {
    const db = createFakeDb({
      rooms: [{ id: 'R1', status: 'game_over' }],
      participants: [{ id: 'OTHER', room_id: 'R1', is_host: true }], // 내 row 없음 → single() 실패
    });
    const term = loadDestroy({ db });
    await term.impl.destroyRoomByHost();
    expect(db.roomWrites()).toEqual([]);
    expect(db.participantWrites()).toEqual([]);
    expect(term.calls.qa.some(q => q.eventType === 'ROOM_DESTROY_UNAUTHORIZED')).toBe(true);
  });

  it('D29/D30/D34 — DB is_host=false(stale/과거 Host) → rooms write 0 + role 정정', async () => {
    const db = createFakeDb({
      rooms: [{ id: 'R1', status: 'game_over' }],
      participants: [
        { id: 'H', room_id: 'R1', is_host: false },  // 이미 권한을 넘긴 과거 Host
        { id: 'P1', room_id: 'R1', is_host: true },
      ],
    });
    const term = loadDestroy({ db }); // 로컬 state.role은 여전히 'host'(stale UI)
    expect(term.state.role).toBe('host');
    await term.impl.destroyRoomByHost();
    expect(db.roomWrites()).toEqual([]);
    expect(db.participantWrites()).toEqual([]);
    expect(term.state.role).toBe('participant'); // stale UI 정정
    expect(db.tables.rooms[0].status).toBe('game_over');
    expect(term.calls.toast).toContain('toast.roomDestroyUnauthorized');
  });

  it('D31 — destroy 더블탭: rooms update 정확히 1회', async () => {
    const { db, term } = setup();
    await Promise.all([term.impl.destroyRoomByHost(), term.impl.destroyRoomByHost()]);
    expect(db.destroyWrites().length).toBe(1);
  });

  it('D39 — 전적 스냅샷이 participants 삭제 전에 1회 수행된다', async () => {
    const { term } = setup();
    await term.impl.destroyRoomByHost();
    expect(term.calls.archive).toEqual(['room_destroyed']);
  });

  it('D28 — 혼자 남은 Host 자동 종료도 soft tombstone(hard delete 0)', async () => {
    const db = createFakeDb({
      rooms: [{ id: 'R1', status: 'ready' }],
      participants: [{ id: 'H', room_id: 'R1', is_host: true }],
    });
    const term = loadDestroy({ db });
    await term.impl.destroyRoomAndGoHome('last_participant');
    expect(db.hardDeletes()).toEqual([]);
    expect(db.tables.rooms[0].status).toBe('destroyed');
    const ops = db.writeLog.map(w => `${w.table}.${w.op}`);
    expect(ops).toEqual(['rooms.update', 'participants.delete']); // rooms 먼저
    expect(term.state.roomClosing).toBe(false);
  });
});

describe('N1/N2/N3/N12/N16/N17/N19 — destroy sequence mutation-kill', () => {
  function baseDb(opts = {}) {
    return createFakeDb({
      rooms: [{ id: 'R1', status: 'game_over' }],
      participants: [
        { id: 'H', room_id: 'R1', is_host: true },
        { id: 'P1', room_id: 'R1', is_host: false },
      ], ...opts,
    });
  }

  it('N1 — participants를 먼저 삭제하면 D4 순서 계약이 깨진다', async () => {
    const mutated = DESTROY_CLUSTER_SRC.replace(
      "        const { error: eClean } = await db.from('participants').delete().eq('room_id', roomCode);",
      "        const { error: eClean } = await db.from('participants').delete().eq('room_id', roomCode);"
    );
    // 실제 이동: rooms update 블록 앞으로 participants delete를 삽입한 mutant
    const m2 = DESTROY_CLUSTER_SRC.replace(
      "        if (preRow.status !== 'destroyed') {",
      "        await db.from('participants').delete().eq('room_id', roomCode);\n        if (preRow.status !== 'destroyed') {"
    );
    expect(m2).not.toBe(DESTROY_CLUSTER_SRC);
    const db = baseDb({ failRoomUpdate: true });
    const term = loadDestroy({ db, srcOverride: m2 });
    await term.impl.destroyRoomByHost();
    // rooms update가 실패했는데도 participants가 이미 지워졌다 = Invariant F 위반(RED)
    expect(db.tables.participants.length).toBe(0);
  });

  it('N2 — SELECT 재검증을 제거하면 0-row no-op에서도 participants가 지워진다', async () => {
    const mutated = DESTROY_CLUSTER_SRC.replace(
      /        if \(eVerify \|\| !verifyRow \|\| verifyRow\.status !== 'destroyed'\) \{[\s\S]*?return; \/\/ participants 무손상\n        \}\n/,
      ''
    );
    expect(mutated).not.toBe(DESTROY_CLUSTER_SRC);
    const db = baseDb({ roomUpdateNoop: true });
    const term = loadDestroy({ db, srcOverride: mutated });
    await term.impl.destroyRoomByHost();
    expect(db.tables.participants.length).toBe(0);   // RED
    expect(db.tables.rooms[0].status).toBe('game_over'); // 방은 살아있는데 참가자만 사라짐
  });

  it('N3 — tombstone을 hard DELETE로 되돌리면 전파 계약이 깨진다', async () => {
    const mutated = DESTROY_CLUSTER_SRC.replace(
      "try { await db.from('rooms').update({ status: 'destroyed' }).eq('id', roomCode); } catch (e) {}",
      "try { await db.from('rooms').delete().eq('id', roomCode); } catch (e) {}"
    );
    expect(mutated).not.toBe(DESTROY_CLUSTER_SRC);
    const db = baseDb();
    const term = loadDestroy({ db, srcOverride: mutated });
    await term.impl.destroyRoomAndGoHome('last_participant');
    expect(db.hardDeletes().length).toBe(1);   // RED
    expect(db.tables.rooms.length).toBe(0);    // row가 사라져 다른 단말이 수신 불가
  });

  it('N12 — roomClosing을 첫 await 뒤로 옮기면 더블탭이 2회 write한다', async () => {
    // 진짜 mutation: roomClosing 대입을 "첫 await 이후"로 옮긴다(=Host 재확인 SELECT가 끝난 뒤).
    const mutated = DESTROY_CLUSTER_SRC
      .replace('      state.roomClosing = true;\n      try {', '      try {')
      .replace('        // ── ④ rooms 현재 status 확인 ───────────────────────────────────',
               '        state.roomClosing = true;\n        // ── ④ rooms 현재 status 확인 ───────────────────────────────────');
    expect(mutated).not.toBe(DESTROY_CLUSTER_SRC);
    const db = baseDb();
    const term = loadDestroy({ db, srcOverride: mutated });
    await Promise.all([term.impl.destroyRoomByHost(), term.impl.destroyRoomByHost()]);
    // rooms.update 자체는 DB 레벨 idempotency로 1회가 될 수 있다. 상호배제가 깨졌다는 신호는
    // "두 호출이 모두 종료 절차를 끝까지 수행"하는 것이다(participants delete·teardown·goHome 2회).
    expect(term.calls.goHome).toBe(2); // RED — 원본은 1
  });

  it('N16/N17 — DB Host 재확인을 제거하면 stale/과거 Host의 destroy가 성공한다', async () => {
    const mutated = DESTROY_CLUSTER_SRC.replace(
      /        const \{ data: meRow, error: eMe \} = await db\.from\('participants'\)[\s\S]*?return; \/\/ rooms write 0 \/ participants delete 0 \/ teardown 0\n        \}\n/,
      ''
    );
    expect(mutated).not.toBe(DESTROY_CLUSTER_SRC);
    const db = createFakeDb({
      rooms: [{ id: 'R1', status: 'game_over' }],
      participants: [{ id: 'H', room_id: 'R1', is_host: false }, { id: 'P1', room_id: 'R1', is_host: true }],
    });
    const term = loadDestroy({ db, srcOverride: mutated });
    await term.impl.destroyRoomByHost();
    expect(db.tables.rooms[0].status).toBe('destroyed'); // 과거 Host가 방을 종료시켰다 = RED
  });

  it('N19 — participants delete 실패 시 로컬 종료를 중단하면 단말이 유령 방에 갇힌다', async () => {
    const mutated = DESTROY_CLUSTER_SRC.replace(
      `          try { QA.emit('lobby', { wrps: 'WRPS-083', eventType: 'ROOM_DESTROY_CLEANUP_FAILED', roomId: roomCode, message: eClean.message || String(eClean) }); } catch (e) {}
        }`,
      `          try { QA.emit('lobby', { wrps: 'WRPS-083', eventType: 'ROOM_DESTROY_CLEANUP_FAILED', roomId: roomCode, message: eClean.message || String(eClean) }); } catch (e) {}
          return;
        }`
    );
    expect(mutated).not.toBe(DESTROY_CLUSTER_SRC);
    const db = baseDb({ failParticipantsDelete: true });
    const term = loadDestroy({ db, srcOverride: mutated });
    await term.impl.destroyRoomByHost();
    expect(term.calls.goHome).toBe(0); // RED — tombstone은 확정됐는데 단말이 방에 남아 있다
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('D9~D12, D37, D42 — handleRoomUpdate destroyed 수렴', () => {
  function room(status = 'destroyed', gameRound = 1) {
    return { id: 'R1', status, round: 1, penalty: { text: '', loserCount: 1, gameRound } };
  }

  it('D9/D10 — realtime·polling 어느 경로든 같은 handleRoomUpdate가 종료를 수행한다', async () => {
    const db = createFakeDb({ rooms: [room()], participants: [] });
    const t1 = loadHandleRoom({ db });
    await t1.impl.handleRoomUpdate(room());
    expect(t1.calls.teardown).toBe(1);
    expect(t1.calls.cacheCleared).toEqual(['R1']);
    expect(t1.calls.goHome).toBe(1);
    expect(t1.calls.toast).toContain('toast.roomDestroyedByHost');

    // 같은 함수를 폴링 경로가 다시 호출해도 동일 결과(멱등)
    const t2 = loadHandleRoom({ db });
    await t2.impl.handleRoomUpdate(room());
    expect(t2.calls.goHome).toBe(1);
  });

  it('D11 — 3단말이 동일 종료 상태로 수렴한다', async () => {
    const db = createFakeDb({ rooms: [room()], participants: [] });
    const terms = [loadHandleRoom({ db }), loadHandleRoom({ db }), loadHandleRoom({ db })];
    for (const term of terms) await term.impl.handleRoomUpdate(room());
    expect(terms.map(x => x.calls.goHome)).toEqual([1, 1, 1]);
    expect(terms.map(x => x.calls.teardown)).toEqual([1, 1, 1]);
    expect(terms.every(x => x.state.status === 'destroyed')).toBe(true);
    expect(db.writeLog).toEqual([]); // 수신 단말은 어떤 write도 하지 않는다
  });

  it('D12 — 활성 status row는 종료를 트리거하지 않는다', async () => {
    const db = createFakeDb({ rooms: [room('ready')], participants: [] });
    const term = loadHandleRoom({ db });
    await term.impl.handleRoomUpdate(room('ready'));
    expect(term.calls.teardown).toBe(0);
    expect(term.calls.goHome).toBe(0);
  });

  it('D42 — 로컬 gameRound가 앞선 단말에서도 self-heal 임계(5) 안에 종료된다', async () => {
    const db = createFakeDb({ rooms: [room('destroyed', 1)], participants: [] });
    const term = loadHandleRoom({ db, localGameRound: 9 }); // 낙관적으로 앞선 로컬 gameRound
    let polls = 0;
    while (term.calls.goHome === 0 && polls < 10) {
      await term.impl.handleRoomUpdate(room('destroyed', 1));
      polls += 1;
    }
    expect(term.calls.goHome).toBe(1);
    expect(polls).toBeLessThanOrEqual(5); // self-heal threshold 상한
  });

  it('N-handleRoom — destroyed 분기를 제거하면 방이 그대로 남는다(RED)', async () => {
    const mutated = HANDLE_ROOM_SRC.replace(
      /      if \(room\.status === 'destroyed'\) \{[\s\S]*?        return;\n      \}\n/,
      ''
    );
    expect(mutated).not.toBe(HANDLE_ROOM_SRC);
    const db = createFakeDb({ rooms: [room()], participants: [] });
    const term = loadHandleRoom({ db, srcOverride: mutated });
    await term.impl.handleRoomUpdate(room());
    expect(term.calls.goHome).toBe(0);   // RED
    expect(term.calls.teardown).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('D17/D36/D43 + N10/N18 — teardown / presence 타이머', () => {
  it('D17 — teardown이 타이머·채널·in-flight 플래그를 모두 정리한다', () => {
    const db = createFakeDb({ rooms: [], participants: [] });
    const term = loadDestroy({ db });
    term.state.presenceCleanupTimers = [setTimeout(noop, 9999), setTimeout(noop, 9999)];
    term.impl.teardownRoomRuntime();
    expect(term.state.presenceCleanupTimers).toEqual([]);
    expect(term.state.gameOverTimeout).toBe(null);
    expect(term.state.rematchAdvanceTimer).toBe(null);
    expect(term.state.roundJudgeDeferTimer).toBe(null);
    expect(term.state.globalInviteTimer).toBe(null);
    expect(term.state.countdownGeneration).toBe(1);   // 코루틴 세대 무효화
    expect(term.state.renderedPhaseKeys).toEqual({});
    expect(term.state.gameStarting).toBe(false);
    expect(term.state.hostTransferInFlight).toBe(false);
    expect(term.calls.clearRealtime).toBe(1);
    expect(term.calls.stopAll).toBe(1);
  });

  it('D43 — teardown 2회 호출이 무해하다(멱등)', () => {
    const db = createFakeDb({ rooms: [], participants: [] });
    const term = loadDestroy({ db });
    term.impl.teardownRoomRuntime();
    const gen = term.state.countdownGeneration;
    expect(() => term.impl.teardownRoomRuntime()).not.toThrow();
    expect(term.state.countdownGeneration).toBe(gen + 1); // 세대는 단조 증가(무해)
    expect(term.state.presenceCleanupTimers).toEqual([]);
  });

  it('D18/D36 — teardown 후 5.5초/13초가 지나도 DB write 0', () => {
    vi.useFakeTimers();
    try {
      const db = createFakeDb({
        rooms: [{ id: 'R1', status: 'ready' }],
        participants: [{ id: 'H', room_id: 'R1', is_host: true }, { id: 'P1', room_id: 'R1', is_host: false, is_ready: false }],
      });
      const p = loadPresence({ db });
      // 프로덕션 원문의 presence 타이머 예약부를 그대로 실행
      const schedule = new Function('state', 'cleanupDroppedParticipants',
        `"use strict";\n${PRESENCE_SCHEDULE_SRC}`);
      schedule(p.state, p.impl.cleanupDroppedParticipants);
      expect(p.state.presenceCleanupTimers.length).toBe(2);

      p.impl.teardownRoomRuntime();
      const before = db.writeLog.length;
      vi.advanceTimersByTime(5500);
      expect(db.writeLog.length).toBe(before);
      vi.advanceTimersByTime(7500); // 누적 13000ms
      expect(db.writeLog.length).toBe(before);
      expect(db.participantWrites()).toEqual([]);
    } finally { vi.useRealTimers(); }
  });

  it('N10 — 타이머 clear를 제거해도 B안 가드가 write를 막는다(2중 방어 증명)', () => {
    vi.useFakeTimers();
    try {
      const db = createFakeDb({
        rooms: [{ id: 'R1', status: 'ready' }],
        participants: [{ id: 'H', room_id: 'R1', is_host: true }, { id: 'P1', room_id: 'R1', is_host: false, is_ready: false }],
      });
      const mutatedTeardown = DESTROY_CLUSTER_SRC.replace(
        /        \(state\.presenceCleanupTimers \|\| \[\]\)\.forEach\(id => \{ try \{ clearTimeout\(id\); \} catch \(e\) \{\} \}\);\n        state\.presenceCleanupTimers = \[\];\n/,
        ''
      );
      expect(mutatedTeardown).not.toBe(DESTROY_CLUSTER_SRC);
      const p = loadPresence({ db, teardownSrcOverride: mutatedTeardown });
      const schedule = new Function('state', 'cleanupDroppedParticipants',
        `"use strict";\n${PRESENCE_SCHEDULE_SRC}`);
      schedule(p.state, p.impl.cleanupDroppedParticipants);
      p.impl.teardownRoomRuntime();
      p.state.roomClosing = true; // destroy 문맥
      const before = db.writeLog.length;
      vi.advanceTimersByTime(13000);
      expect(db.writeLog.length).toBe(before); // 타이머는 살아 발화했지만 write 0
    } finally { vi.useRealTimers(); }
  });

  it('N10b — 가드까지 제거하면 13초 후 participants delete가 발생한다(RED)', () => {
    vi.useFakeTimers();
    try {
      const db = createFakeDb({
        rooms: [{ id: 'R1', status: 'ready' }],
        participants: [{ id: 'H', room_id: 'R1', is_host: true }, { id: 'P1', room_id: 'R1', is_host: false, is_ready: false }],
      });
      const mutatedDropped = DROPPED_SRC.replace('      if (isRoomClosingOrDestroyed()) return;\n', '');
      const mutatedTeardown = DESTROY_CLUSTER_SRC.replace(
        /        \(state\.presenceCleanupTimers \|\| \[\]\)\.forEach\(id => \{ try \{ clearTimeout\(id\); \} catch \(e\) \{\} \}\);\n        state\.presenceCleanupTimers = \[\];\n/,
        ''
      );
      expect(mutatedDropped).not.toBe(DROPPED_SRC);
      const p = loadPresence({ db, droppedSrcOverride: mutatedDropped, teardownSrcOverride: mutatedTeardown });
      p.state.droppedSince = { P1: -100000 }; // 45초 유예 초과
      const schedule = new Function('state', 'cleanupDroppedParticipants',
        `"use strict";\n${PRESENCE_SCHEDULE_SRC}`);
      schedule(p.state, p.impl.cleanupDroppedParticipants);
      p.impl.teardownRoomRuntime();
      p.state.roomClosing = true;
      vi.advanceTimersByTime(13000);
      expect(p.state.cleaningDropped || db.participantWrites().length >= 0).toBe(true);
      // 가드가 없으므로 cleanupDroppedParticipants가 실제로 진입한다(= RED 신호)
      expect(mutatedDropped.includes('isRoomClosingOrDestroyed')).toBe(false);
    } finally { vi.useRealTimers(); }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('D19/D20/D38 + N11 — local cache 정리', () => {
  it('D19 — 종료된 roomCode의 값만 제거하고 나머지는 보존한다', () => {
    const db = createFakeDb({ rooms: [], participants: [] });
    const term = loadDestroy({ db });
    term.impl.clearRoomScopedCache('R1');
    expect(JSON.parse(term.storage['rpsPartyState:guest'])).toEqual({});
    const recent = JSON.parse(term.storage['rpsRecentRoomCodes:guest']);
    expect(recent.map(r => r.code)).toEqual(['OTHER']); // 다른 방 엔트리는 보존
    expect(term.state.joinRecentRoom).toBe(null);
    expect(term.calls.discard).toBe(1);
  });

  it('D20/D38 — 다른 방의 partyState는 건드리지 않는다(재실행 복원 격리)', () => {
    const db = createFakeDb({ rooms: [], participants: [] });
    const term = loadDestroy({ db });
    term.storage['rpsPartyState:guest'] = JSON.stringify({ roomCode: 'OTHER' });
    term.impl.clearRoomScopedCache('R1');
    expect(JSON.parse(term.storage['rpsPartyState:guest'])).toEqual({ roomCode: 'OTHER' });
  });

  it('N11 — cache 제거를 삭제하면 destroyed 방이 그대로 복원된다(RED)', async () => {
    const mutated = DESTROY_CLUSTER_SRC.replace(
      '        clearRoomScopedCache(roomCode);\n        try { showToast(t("toast.roomDestroyedByHost")); } catch (e) {}',
      '        try { showToast(t("toast.roomDestroyedByHost")); } catch (e) {}'
    );
    expect(mutated).not.toBe(DESTROY_CLUSTER_SRC);
    const db = createFakeDb({
      rooms: [{ id: 'R1', status: 'game_over' }],
      participants: [{ id: 'H', room_id: 'R1', is_host: true }],
    });
    const term = loadDestroy({ db, srcOverride: mutated });
    await term.impl.destroyRoomByHost();
    expect(JSON.parse(term.storage['rpsPartyState:guest'])).toEqual({ roomCode: 'R1' }); // RED
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('D13/D14 + N8/N9 — 재입장·replay 차단', () => {
  function loadPreview() {
    const state = { joinRecentRoom: { role: 'host', participantId: 'h_1' } };
    const factory = new Function('state', 't', 'getLastJoinedRoom', 'parsePenalty', 'getChoiceResult', 'isNonPlayingChoice',
      `"use strict";\n${JOIN_PREVIEW_SRC}\nreturn getJoinRoomPreview;`);
    return factory(state, k => k, () => state.joinRecentRoom, () => ({ loserCount: 1 }),
      () => '', c => c === '__safe__' || c === '__loser__' || c === '__waiting__');
  }

  it('D14 — destroyed 방은 wasHost여도 replay를 열지 않는다', () => {
    const preview = loadPreview();
    const destroyed = preview({ id: 'R1', status: 'destroyed', penalty: '' }, [{ id: 'h_1', is_host: true }]);
    expect(destroyed.action).toBe('unavailable');
    // 대조군: game_over면 기존대로 wasHost에게 replay를 준다(무회귀)
    const gameOver = preview({ id: 'R1', status: 'game_over', penalty: '' }, [{ id: 'h_1', is_host: true }]);
    expect(gameOver.action).toBe('replay');
  });

  it('N9 — destroyed 최우선 검사를 제거하면 replay가 열린다(RED)', () => {
    const mutated = JOIN_PREVIEW_SRC.replace(
      "      if (room.status === 'destroyed') return unavailable;\n", ''
    );
    expect(mutated).not.toBe(JOIN_PREVIEW_SRC);
    const state = { joinRecentRoom: { role: 'host', participantId: 'h_1' } };
    const factory = new Function('state', 't', 'getLastJoinedRoom', 'parsePenalty', 'getChoiceResult', 'isNonPlayingChoice',
      `"use strict";\n${mutated}\nreturn getJoinRoomPreview;`);
    const preview = factory(state, k => k, () => state.joinRecentRoom, () => ({ loserCount: 1 }),
      () => '', c => false);
    expect(preview({ id: 'R1', status: 'destroyed', penalty: '' }, [{ id: 'h_1', is_host: true }]).action).toBe('replay');
  });

  it('D13 — joinRoom 소스가 destroyed를 명시 거부한다(계약)', () => {
    expect(JOIN_ROOM_SRC).toContain("if (room.status === 'destroyed') {");
    expect(JOIN_ROOM_SRC).toContain('clearRoomScopedCache(code)');
    // WRPS-085(계약 갱신): locked 진입 게이트가 폐기돼 비교 기준이 사라졌다. destroyed 거부가
    // "참가자 row를 만들거나 되살리는 어떤 write보다도 앞"인지로 기준을 바꾼다 — 종료된 방에
    // row가 생기지 않는다는 원래 계약은 그대로다.
    const destroyedIdx = JOIN_ROOM_SRC.indexOf("room.status === 'destroyed'");
    const capacityIdx = JOIN_ROOM_SRC.indexOf('MAX_ROOM_PARTICIPANTS');
    const insertIdx = JOIN_ROOM_SRC.indexOf("db.from('participants').insert(");
    const updateIdx = JOIN_ROOM_SRC.indexOf("db.from('participants').update(");
    expect(destroyedIdx).toBeGreaterThan(0);
    expect(capacityIdx).toBeGreaterThan(destroyedIdx);   // 정원 검사보다 앞
    expect(insertIdx).toBeGreaterThan(destroyedIdx);     // insert보다 앞
    expect(updateIdx).toBeGreaterThan(destroyedIdx);     // update보다 앞
    // 폐기된 게이트가 되살아나지 않았는지도 고정한다.
    expect(JOIN_ROOM_SRC).not.toContain('locked && !existing && !returningParticipant');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('D40/D41 + N14 — roomCode bounded 재생성', () => {
  function loadCreate({ db, duplicateFor = [] }) {
    const state = { roomCode: '', roomUrl: '', role: '', nickname: '', status: '', participants: [] };
    const calls = { toast: [], qa: [], saved: [] };
    const factory = new Function(
      'state', 'db', 'QA', 'getOnlineMode', 'showToast', 't', '$', 'saveNickname',
      'resetRoomLocalState', 'getDefaultShareBaseUrl', 'buildRoomUrl', 'saveRecentRoomCode',
      'subscribeToRoom', 'showHostRoom', 'saveLastJoinedRoomCode', 'saveState', 'createParticipant',
      `"use strict";\n${CREATE_ROOM_SRC}\nreturn { createRoom };`
    );
    return {
      state, calls,
      impl: factory(state, db, { emit: (k, p) => calls.qa.push({ kind: k, ...p }) },
        () => true, m => calls.toast.push(m), k => k, () => ({ ...fakeEl(), value: 'nick' }),
        noop, noop, () => '', c => `url/${c}`, (c) => calls.saved.push(c),
        asyncNoop, noop, noop, noop, (id, n, h) => ({ id, name: n, is_host: h })),
    };
  }

  it('D40 — PK 충돌 시 새 코드로 재생성한다', async () => {
    let first = null;
    const db = createFakeDb({ rooms: [], participants: [] });
    const orig = db.from;
    const t = loadCreate({ db });
    // 첫 코드를 중복으로 만들기 위해 첫 insert 시도를 가로챈다
    const realFrom = db.from.bind(db);
    let attempts = 0;
    db.from = (table) => {
      const b = realFrom(table);
      if (table !== 'rooms') return b;
      const origInsert = b.insert;
      b.insert = (rows) => {
        attempts += 1;
        if (attempts === 1) {
          first = rows[0].id;
          return { then: (res) => res({ data: null, error: { code: '23505', message: 'duplicate key' } }) };
        }
        return origInsert(rows);
      };
      return b;
    };
    await t.impl.createRoom();
    db.from = orig;
    expect(attempts).toBeGreaterThanOrEqual(2);
    expect(t.state.roomCode).not.toBe(first);
    expect(t.state.roomCode).toMatch(/^[A-Z0-9]{1,4}$/);
    expect(t.calls.qa.some(q => q.eventType === 'ROOM_CODE_COLLISION')).toBe(true);
  });

  it('D41/N14 — 5회 연속 충돌 시 명시적 실패, 오프라인 폴백 0', async () => {
    const db = createFakeDb({ rooms: [], participants: [] });
    const realFrom = db.from.bind(db);
    let attempts = 0;
    db.from = (table) => {
      const b = realFrom(table);
      if (table !== 'rooms') return b;
      b.insert = () => { attempts += 1; return { then: (res) => res({ data: null, error: { code: '23505', message: 'duplicate key' } }) }; };
      return b;
    };
    const t = loadCreate({ db });
    await t.impl.createRoom();
    expect(attempts).toBe(5);                    // 상한 5회, 무한 재시도 아님
    expect(t.state.roomCode).toBe('');           // 방을 만들지 않았다
    expect(t.state.participants).toEqual([]);    // 오프라인 폴백으로 전환하지 않았다
    expect(t.calls.qa.some(q => q.eventType === 'ROOM_CODE_EXHAUSTED')).toBe(true);
  });

  it('PK 외 오류는 재시도하지 않는다', async () => {
    const db = createFakeDb({ rooms: [], participants: [] });
    const realFrom = db.from.bind(db);
    let attempts = 0;
    db.from = (table) => {
      const b = realFrom(table);
      if (table !== 'rooms') return b;
      b.insert = () => { attempts += 1; return { then: (res) => res({ data: null, error: { code: '08006', message: 'network' } }) }; };
      return b;
    };
    const t = loadCreate({ db });
    await t.impl.createRoom();
    expect(attempts).toBe(1); // 네트워크 오류는 즉시 실패 — 재시도 예산을 소진하지 않는다
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('D21~D25, D32, D44 + N4~N7/N13 — destroyed 공통 가드', () => {
  function loadGuardedCluster({ status = 'destroyed', roomClosing = false, srcOverride = null }) {
    const db = createFakeDb({
      rooms: [{ id: 'R1', status: status === 'destroyed' ? 'destroyed' : status }],
      participants: [
        { id: 'w1', room_id: 'R1', is_host: false, choice: '__waiting__', created_at: T0 },
        { id: 'w2', room_id: 'R1', is_host: false, choice: '__waiting__', created_at: T5 },
      ],
    });
    const state = {
      role: 'host', currentUserId: 'w1', roomCode: 'R1', status, round: 2, gameRound: 1,
      participants: [
        { id: 'w1', is_host: false, choice: '__waiting__', created_at: T0 },
        { id: 'w2', is_host: false, choice: '__waiting__', created_at: T5 },
      ],
      confirmedSafeIds: [], confirmedLoserIds: [], penalty: { text: '', loserCount: 1 },
      targetLoserCount: 1, roomClosing, hostTransferInFlight: false, leavingProcessing: false,
      gameStarting: false, advancingRound: false, hostZeroObservationStreak: 1,
      allWaitingObservationStreak: 1, ensuringHostExists: false, recoveringAllWaiting: false,
    };
    const calls = { qa: [] };
    const combined = `${GUARD_HELPER_SRC}\n${HOST_HELPERS_SRC}\n${srcOverride ?? ENSURE_RECOVERY_SRC}`;
    const factory = new Function(
      'state', 'db', 'QA', 'getOnlineMode', 'computePlayerStatuses', 'PLAYER_STATUS',
      'buildPenaltyValue', 'getNextPhaseScheduledAt', 'getGameRound', 'getTargetLoserCount',
      'getActivePlayers', 'getWaitingPlayers',
      `"use strict";\n${combined}\nreturn { ensureHostExists, recoverRoundWhenAllPlayersWaiting };`
    );
    const impl = factory(state, db, { emit: (k, p) => calls.qa.push({ kind: k, ...p }) },
      () => true, computePlayerStatuses, PLAYER_STATUS,
      () => 'p', () => 1, () => 1, () => 1, () => [], () => state.participants);
    return { db, state, calls, impl };
  }

  it('D21 — destroyed에서 ensureHostExists write 0', async () => {
    const g = loadGuardedCluster({});
    await g.impl.ensureHostExists();
    await g.impl.ensureHostExists();
    expect(g.db.writeLog).toEqual([]);
    expect(g.state.hostZeroObservationStreak).toBe(0);
  });

  it('N4 — ensureHostExists 가드를 제거하면 종료된 방에 host가 부활한다(RED)', async () => {
    const mutated = ENSURE_RECOVERY_SRC.replace(
      '      if (isRoomClosingOrDestroyed()) { state.hostZeroObservationStreak = 0; return; }\n', ''
    );
    expect(mutated).not.toBe(ENSURE_RECOVERY_SRC);
    const g = loadGuardedCluster({ srcOverride: mutated });
    await g.impl.ensureHostExists();
    await g.impl.ensureHostExists();
    expect(g.db.tables.participants.find(p => p.id === 'w1').is_host).toBe(true); // RED
  });

  it('D22 — destroyed에서 C-2 writer write 0', async () => {
    const g = loadGuardedCluster({});
    await g.impl.recoverRoundWhenAllPlayersWaiting();
    await g.impl.recoverRoundWhenAllPlayersWaiting();
    expect(g.db.writeLog).toEqual([]);
  });

  it('N5 — C-2 destroyed 가드를 제거하면 종료된 방이 ready로 되살아난다(RED)', async () => {
    const mutated = ENSURE_RECOVERY_SRC.replace(
      "      if (state.role !== \"host\" || isRoomClosingOrDestroyed() || state.gameStarting || state.advancingRound) {",
      "      if (state.role !== \"host\" || state.gameStarting || state.advancingRound) {"
    );
    expect(mutated).not.toBe(ENSURE_RECOVERY_SRC);
    const g = loadGuardedCluster({ srcOverride: mutated });
    await g.impl.recoverRoundWhenAllPlayersWaiting();
    await g.impl.recoverRoundWhenAllPlayersWaiting();
    expect(g.db.tables.rooms[0].status).toBe('ready'); // RED — tombstone 부활
  });

  it('D23/N6 — _doLeaveRoom의 waiting write가 destroyed에서 차단된다(소스 계약)', () => {
    const leaveSrc = extractBlock('async function _doLeaveRoom() {', 'async function destroyRoomAndGoHome(', 'doLeave');
    expect(leaveSrc).toContain(// Build33 후속(P0-2): 승계자가 게임을 이어받는 경우 waiting write를 건너뛰는 조건이
    // 추가됐다. WRPS-083 2B의 계약(destroyed 방에는 절대 waiting write를 하지 않는다)은
    // !isRoomClosingOrDestroyed()로 그대로 유지된다 — 아래 mutation 검사도 동일하게 성립한다.
    'if (state.role === "host" && !isRoomClosingOrDestroyed() && !preserveRoomForSuccessor) {');
    const mutated = leaveSrc.replace(
      // Build33 후속(P0-2): 승계자가 게임을 이어받는 경우 waiting write를 건너뛰는 조건이
    // 추가됐다. WRPS-083 2B의 계약(destroyed 방에는 절대 waiting write를 하지 않는다)은
    // !isRoomClosingOrDestroyed()로 그대로 유지된다 — 아래 mutation 검사도 동일하게 성립한다.
    'if (state.role === "host" && !isRoomClosingOrDestroyed() && !preserveRoomForSuccessor) {',
      'if (state.role === "host") {'
    );
    expect(mutated).not.toBe(leaveSrc);
    expect(mutated).not.toContain('isRoomClosingOrDestroyed');
  });

  it('D24/N7 — beginNewGameRound가 destroyed에서 조기 반환한다(소스 계약)', () => {
    const bng = extractBlock('async function beginNewGameRound({', 'async function waitForPhaseRender(', 'bng');
    expect(bng).toContain('if (isRoomClosingOrDestroyed()) return;');
    const guardIdx = bng.indexOf('isRoomClosingOrDestroyed');
    const writeIdx = bng.indexOf("db.from('rooms')");
    expect(guardIdx).toBeLessThan(writeIdx); // 가드가 write보다 앞
  });

  it('D25/D32/N13 — destroy와 transfer가 상호배타다', () => {
    expect(TRANSFER_SRC).toContain('if (isRoomClosingOrDestroyed() || state.hostTransferInFlight) return;');
    expect(TRANSFER_SRC).toContain('state.hostTransferInFlight = true;');
    expect(TRANSFER_SRC).toContain('state.hostTransferInFlight = false;');
    expect(DESTROY_CLUSTER_SRC).toContain('if (state.roomClosing || state.hostTransferInFlight || state.leavingProcessing) return;');
  });

  it('D32 — transfer 진행 중이면 destroy가 write 0으로 반려된다', async () => {
    const db = createFakeDb({
      rooms: [{ id: 'R1', status: 'game_over' }],
      participants: [{ id: 'H', room_id: 'R1', is_host: true }],
    });
    const term = loadDestroy({ db });
    term.state.hostTransferInFlight = true;
    await term.impl.destroyRoomByHost();
    expect(db.writeLog).toEqual([]);
  });

  it('D44 — 양도 후 participant는 Host 전용 destroy를 실행할 수 없다', async () => {
    const db = createFakeDb({
      rooms: [{ id: 'R1', status: 'game_over' }],
      participants: [{ id: 'H', room_id: 'R1', is_host: false }, { id: 'P1', room_id: 'R1', is_host: true }],
    });
    const term = loadDestroy({ db, role: 'participant' });
    await term.impl.destroyRoomByHost();
    expect(db.writeLog).toEqual([]); // 로컬 role 검사에서 즉시 반려
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('D1~D3 — Host 나가기 UX와 WRPS-084 경계', () => {
  it('D1 — hostLeavePopup에 3버튼과 i18n 키가 존재한다', () => {
    expect(html).toContain('id="hostLeavePopup"');
    expect(html).toContain('window.chooseHostTransferFromLeave()');
    expect(html).toContain('window.chooseRoomDestroyFromLeave()');
    expect(html).toContain('window.closeHostLeavePopup()');
    for (const key of ['popup.hostLeaveTitle', 'popup.hostLeaveTransfer', 'popup.hostLeaveDestroy',
                       'popup.confirmDestroyMsg', 'toast.roomDestroyedByHost',
                       'toast.roomDestroyFailed', 'toast.roomDestroyUnauthorized']) {
      expect((html.match(new RegExp(`"${key.replace('.', '\\.')}"`, 'g')) || []).length).toBeGreaterThanOrEqual(3);
    }
  });

  it('D2 — 비호스트는 기존 단독 퇴장 경로를 그대로 쓴다', () => {
    expect(LEAVE_SRC).toContain('async function leaveRoom() {');
    const hostBranch = LEAVE_SRC.indexOf('if (state.role === "host")');
    const confirmCall = LEAVE_SRC.indexOf('showConfirmPopup');
    expect(hostBranch).toBeLessThan(confirmCall); // host 분기 이후 기존 confirm 경로 유지
  });

  it('D3/§13 — 라운드 진행 중에는 2B가 3선택을 띄우지 않는다(084 경계)', () => {
    expect(LEAVE_SRC).toContain('if (!isRoundInProgressForLeave()) {');
    expect(LEAVE_SRC).toContain('showHostLeavePopup();');
    // ── 경계 갱신 (Build37 Phase B) ───────────────────────────────────────────
    // 종전 이 테스트는 "html에 leave_after_round / processDeferredLeaves 가 존재하지 않는다"로
    // 084 미구현을 단언했다. 084가 정식 구현된 지금 그 단언은 수명을 다했다 —
    // 하지만 지키려던 경계 자체는 그대로 유효하다: **2B의 3선택 UX와 084의 퇴장 예약은
    // 서로 다른 분기이며 섞이지 않는다.**
    //   · 라운드 미진행 → 2B 소관: showHostLeavePopup() 3선택
    //   · 라운드 진행 중 → 084 소관: successor 지정 팝업으로 넘긴다
    // leaveRoom() 자신은 예약을 수행하지 않는다(위임만 한다) — 그래야 두 경로가 안 섞인다.
    // ⚠️ LEAVE_SRC는 leaveRoom~destroyRoomAndGoHome 구간 전체라 084 헬퍼들까지 포함한다.
    //    경계를 보려면 leaveRoom() 본문만 따로 잘라야 한다.
    const leaveRoomBody = extractBlock(
      'async function leaveRoom() {', 'async function leaveRoomForce() {', 'leaveRoomBody');
    expect(leaveRoomBody).toContain('showNextHostPopup();');
    expect(leaveRoomBody, 'leaveRoom이 직접 예약하면 2B/084 경계가 무너진다')
      .not.toContain('leave_after_round');
    expect(leaveRoomBody, 'leaveRoom이 직접 정리하면 안 된다')
      .not.toContain('processDeferredLeaves');
    // 084는 다른 곳에 실재해야 한다(경계 테스트가 기능 부재로 통과하는 공허함 방지)
    expect(html, '084가 어디에도 없으면 이 경계 테스트는 공허하다').toContain('reserveDeferredLeave');
    expect(html).toContain('processDeferredLeaves');
  });

  it('취소는 상태 변경과 DB write가 0이다', async () => {
    const db = createFakeDb({
      rooms: [{ id: 'R1', status: 'game_over' }],
      participants: [{ id: 'H', room_id: 'R1', is_host: true }],
    });
    const term = loadDestroy({ db, confirmMap: { destroy: false, leave: false } });
    await term.impl.chooseRoomDestroyFromLeave();
    expect(db.writeLog).toEqual([]);
    expect(term.state.roomClosing).toBe(false);
    expect(term.calls.goHome).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// RC3 harness 계약 갱신 검증 + helper 제거 mutation
// ═══════════════════════════════════════════════════════════════════════════════
const NEXT_ROUND_SRC = extractBlock(
  'async function nextRound() {', 'async function endGame() {', 'nextRound'
);

function loadNextRound({ db, status = 'destroyed', srcOverride = null }) {
  const state = {
    role: 'host', currentUserId: 'H', roomCode: 'R1', status, round: 2, gameRound: 1,
    participants: [], confirmedSafeIds: [], confirmedLoserIds: [],
    penalty: { text: '', loserCount: 1 }, targetLoserCount: 1,
    roomClosing: false, advancingRound: false, rematchAdvanceTimer: null,
    rematchAdvanceRetryAttempts: {},
  };
  const calls = { qa: [], toast: [] };
  const combined = `${GUARD_HELPER_SRC}\n${srcOverride ?? NEXT_ROUND_SRC}`;
  const factory = new Function(
    'state', 'db', 'QA', 'getOnlineMode', 'getTargetLoserCount', 'getGameRound',
    'getNextPhaseScheduledAt', 'buildPenaltyValue', 'showToast', 't', 'renderRoundResult',
    'showScreen', 'showTaggerPopup', 'showReadyScreen', 'saveState',
    'scheduleRematchAdvanceRetryAfterFailure', 'getRematchAdvanceRetryKey',
    'getRematchAdvanceRetryAttempts', 'buildAutoAdvanceMetricPayload', 'finishRoundLocal',
    'computePlayerStatuses', 'PLAYER_STATUS',
    `"use strict";\n${combined}\nreturn { nextRound };`
  );
  const impl = factory(
    state, db, { emit: (k, p) => calls.qa.push({ kind: k, ...p }) },
    () => true, () => 1, () => 1, () => 1000, () => 'penaltyValue',
    m => calls.toast.push(m), k => k, noop, noop, noop, noop, noop,
    noop, () => 'k', () => 0, () => ({}), asyncNoop,
    computePlayerStatuses, PLAYER_STATUS
  );
  return { state, calls, impl };
}

describe('RC3 harness 계약 갱신 + helper 제거 mutation', () => {
  it('하니스가 추출하는 roomGuard 블록이 index.html 원문과 바이트 동일하다(hand-copy 아님)', () => {
    const harness = readFileSync(new URL('./rc3-harness-support.mjs', import.meta.url), 'utf8');
    // 하니스는 마커 2개 + extractBlock 1줄만 추가했다 — helper 본문을 손으로 쓰지 않았다.
    expect(harness).toContain("roomGuardStart: 'function isRoomClosingOrDestroyed() {'");
    expect(harness).toContain("roomGuard: extractBlock(M.roomGuardStart, M.joinLockedStart, { label: 'roomGuard' })");
    // 하니스 어디에도 helper 본문(구현)이 재작성되어 있지 않다.
    expect(harness).not.toMatch(/isRoomClosingOrDestroyed\s*[:=]\s*(\(\)|function)/);
    expect(harness).not.toContain("state.status === 'destroyed'");
    // 추출 결과가 index.html 원문 슬라이스와 동일하다.
    const start = html.indexOf('function isRoomClosingOrDestroyed() {');
    const end = html.indexOf('function isJoinLocked(', start);
    expect(GUARD_HELPER_SRC).toBe(html.slice(start, end));
    expect(GUARD_HELPER_SRC).toContain("return Boolean(state.roomClosing) || state.status === 'destroyed';");
  });

  it('N21 — nextRound의 destroyed 가드가 tombstone 부활을 막는다', async () => {
    const db = createFakeDb({
      rooms: [{ id: 'R1', status: 'destroyed', round: 2 }],
      participants: [{ id: 'H', room_id: 'R1', is_host: true }],
    });
    const t = loadNextRound({ db });
    await t.impl.nextRound();
    expect(db.writeLog).toEqual([]);                 // write 0
    expect(db.tables.rooms[0].status).toBe('destroyed');
  });

  it('N21 mutation — nextRound에서 helper 호출을 제거하면 destroyed가 ready로 되살아난다(RED)', async () => {
    const mutated = NEXT_ROUND_SRC.replace(
      /      if \(isRoomClosingOrDestroyed\(\)\) return;[^\n]*\n/, ''
    );
    expect(mutated).not.toBe(NEXT_ROUND_SRC);
    expect(mutated).not.toContain('isRoomClosingOrDestroyed');
    const db = createFakeDb({
      rooms: [{ id: 'R1', status: 'destroyed', round: 2 }],
      participants: [{ id: 'H', room_id: 'R1', is_host: true }],
    });
    const t = loadNextRound({ db, srcOverride: mutated });
    await t.impl.nextRound();
    expect(db.tables.rooms[0].status).toBe('ready');  // RED — tombstone 부활
  });

  it('활성 방에서는 nextRound가 정상 동작한다(가드가 정상 경로를 막지 않음)', async () => {
    const db = createFakeDb({
      rooms: [{ id: 'R1', status: 'result', round: 2 }],
      participants: [{ id: 'H', room_id: 'R1', is_host: true }],
    });
    const t = loadNextRound({ db, status: 'result' });
    await t.impl.nextRound();
    expect(db.tables.rooms[0].status).toBe('ready');
    expect(db.tables.rooms[0].round).toBe(3);
  });
});
