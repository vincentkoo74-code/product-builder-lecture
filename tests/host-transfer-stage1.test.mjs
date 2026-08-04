// WRPS-083 1단계 — host transfer 안전화 결정적 테스트 (CEO 승인 범위: T1~T6).
//
// index.html 무수정 원칙(tests/rc3-harness-support.mjs 선례): 이 파일은 index.html을 오직
// readFileSync + 문자열 마커 슬라이싱으로만 읽고, 추출한 REAL 소스를 new Function으로 그대로
// 실행한다 — 손으로 베낀 시뮬레이션/no-op mock 금지. 스텁은 렌더/이탈 표면(showToast, goHome,
// clearRealtime, $, beginNewGameRound[게임 리셋 표면 — 이 파일의 검증 대상 아님])에만 쓴다.
//
// 검증 대상(전부 REAL 추출 실행):
//   pickDeterministicHostCandidate / promoteParticipantToHost / verifyExactlyOneHost
//   leaveRoomForce / transferHostAndLeave / becomeNextHost / _doLeaveRoom / ensureHostExists
//
// 시나리오:
//   T1 인계 성공 → old host row 삭제됨, host 정확히 1명(새 host)
//   T2 인계 write 실패 → old host row 미삭제, host 여전히 1명(=old host), 이탈 진행 안 함
//   T2b 인계 write가 error 없이 0-row no-op(대상 이미 퇴장 — Build31 Y1PK/1JDS 실측 클래스)
//       → 성공 확인(재조회)이 잡아내 이탈 중단
//   T3 host 0명 상태 주입 → ensureHostExists가 created_at 최소를 승격(연속 2회 관측 후),
//       host 정확히 1명 + fetchParticipants 배선 존재(소스 계약)
//   T4 동률 created_at → id 오름차순 승격(결정적)
//   T5 3단말 동시 host 0명 관측 → 후보 본인 1단말만 write, 중복 write 없이 동일 host 수렴
//   T6 mutation: (a) error 검사 제거 → T2 불변식 위반 발생(RED 증명)
//               (b) ensureHostExists 배선 제거 → T3 배선 계약 위반 발생(RED 증명)

import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

function extractBlock(startMarker, endMarker, label) {
  const start = html.indexOf(startMarker);
  if (start < 0) throw new Error(`[stage1] start marker not found (${label}): ${startMarker}`);
  const end = html.indexOf(endMarker, start + startMarker.length);
  if (end < 0) throw new Error(`[stage1] end marker not found (${label}): ${endMarker}`);
  return html.slice(start, end);
}

// ── REAL 소스 추출 ────────────────────────────────────────────────────────────
const HELPERS_SRC = extractBlock(
  'function pickDeterministicHostCandidate(rows) {', 'async function leaveRoom() {', 'helpers'
);
const LEAVE_CLUSTER_SRC = extractBlock(
  'async function leaveRoomForce() {', 'function startGameOverCountdown(seconds) {', 'leaveCluster'
);
const ENSURE_HOST_SRC = extractBlock(
  'async function ensureHostExists() {', 'async function returnToLobbyAfterGame() {', 'ensureHostExists'
);
// fetchParticipants 클러스터(REAL, 전문): scheduleFetchParticipants + finishFetchParticipants +
// fetchParticipants. T3/T6(b)의 행위 검증에서 이 프로덕션 소스를 그대로 new Function으로 구동한다
// (배선 제거 mutant도 이 소스의 문자열 치환으로만 파생 — 손으로 다시 짠 fetch 루프 아님).
const FETCH_CLUSTER_SRC = extractBlock(
  'function scheduleFetchParticipants(roomCode, delayMs = 80) {', 'async function updateRoomStatus(status) {', 'fetchCluster'
);
// 배선 line(프로덕션 원문 그대로) — mutant는 이 호출 한 줄만 제거한다(주석/나머지 소스 무변경).
const ENSURE_WIRING_CALL = 'try { await ensureHostExists(); } catch (e) {}';

// 배선 계약(보조 검사): state.participants = data 확정 "이후", WRPS-018 안전망 "이전"에
// ensureHostExists를 await 호출한다(스냅샷 확정 직후 = host 0명 감지 지점).
// ⚠️ 주 증명은 아래 buildFetchTerminal 기반 "행위" 단정(T3/T6b)이다 — 이 문자열 검사는 위치
// 계약(어디에 배선돼야 하는가)만 고정하는 보조 장치다.
function hasEnsureHostWiring(fetchSrc) {
  const assignIdx = fetchSrc.indexOf('state.participants = data;\n');
  const callIdx = fetchSrc.indexOf('await ensureHostExists();');
  const wrps018Idx = fetchSrc.indexOf('// WRPS-018');
  return assignIdx >= 0 && callIdx > assignIdx && wrps018Idx > callIdx;
}

// ── fetchParticipants 실구동 단말(REAL: fetch 클러스터 + ensureHostExists + 헬퍼 3종) ─────────
// 스텁은 전부 렌더/사운드/게임진행 표면이다(updateSelectedCount/renderAll/$/showScreen/
// SoundManager/publishHostRoundResult/startFromLobby/startGame 등) — host 0명 감지·승격 로직은
// 전부 REAL 추출 소스가 수행한다. status='waiting'으로 두어 host 전용 auto-trigger 분기
// (playing/lobby/ready)는 프로덕션 조건식 그대로 스스로 skip된다.
function buildFetchTerminal({ db, currentUserId, roomCode = 'ROOM1', fetchSourceOverride = null }) {
  const state = {
    currentUserId, role: 'participant', status: 'waiting', roomCode,
    participants: [],
    fetchParticipantsSeq: 0, fetchParticipantsBusy: false, fetchParticipantsPending: false,
    fetchParticipantsTimer: null,
    confirmedSafeIds: [], confirmedLoserIds: [],
    cleaningDuplicateProfiles: false, myReadyLocallySetAt: 0,
  };
  const calls = { qa: [], renderAll: 0 };
  const noop = () => {};
  const asyncNoop = async () => {};
  const combined = `${HELPERS_SRC}\n${ENSURE_HOST_SRC}\n${fetchSourceOverride ?? FETCH_CLUSTER_SRC}`;
  const factory = new Function(
    'state', 'db', 'QA', 'getOnlineMode',
    'cleanupDuplicateRoomProfiles', 'destroyRoomAndGoHome', 'shouldResetForParticipantChange',
    'beginNewGameRound', 'SoundManager', 'updateSelectedCount', 'renderAll', '$',
    'isSafeParticipant', 'isConfirmedLoser', 'isWaitingForNextGame', 'showReadyScreen',
    'showScreen', 'renderLobby', 'showHostRoom', 'isNonPlayingChoice', 'hasConfirmedRoundResult',
    'getChoiceBase', 'publishHostRoundResult', 'areAllActivePlayersReady', 'startFromLobby',
    'renderReadyList', 'startGame', 'showToast', 't',
    `"use strict";\n${combined}\nreturn { fetchParticipants, ensureHostExists };`
  );
  const impl = factory(
    state, db,
    { emit: (kind, payload) => calls.qa.push({ kind, ...payload }) },
    () => true,
    asyncNoop, asyncNoop, () => false,
    asyncNoop, { playJoinMeow: noop, playLeaveMeow: noop }, noop,
    () => { calls.renderAll += 1; }, () => null,
    () => false, () => false, () => false, noop,
    noop, noop, noop, () => false, () => false,
    () => '', asyncNoop, () => false, asyncNoop,
    noop, asyncNoop, noop, (key) => key
  );
  return { state, calls, impl };
}

// ── 결정적 fake supabase(이 파일에서 새로 구현 — 하니스 인프라이지 판정 로직 아님) ──
// 지원 체인(프로덕션이 실제로 쓰는 것만): update(patch).eq(...) / delete().eq(...).eq(...) /
// select(cols).eq(...)[.order(...)|.single()]. 모든 builder는 supabase-js v2와 동일하게 thenable.
function createFakeDb({ participants = [], rooms = [], failIsHostPromoteWrite = false } = {}) {
  const tables = { participants: [...participants.map((p) => ({ ...p }))], rooms: [...rooms.map((r) => ({ ...r }))] };
  const writeLog = [];
  function makeBuilder(table, op, patch) {
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
      const rows = tables[table].filter(match);
      if (op === 'update') {
        writeLog.push({ table, op, patch: { ...patch }, filters: filters.map((f) => [...f]), matched: rows.length });
        if (failIsHostPromoteWrite && table === 'participants' && patch && patch.is_host === true) {
          return { data: null, error: { message: '[injected] promote write failed' } };
        }
        rows.forEach((r) => Object.assign(r, patch));
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
    isHostPromoteWrites() {
      return writeLog.filter((w) => w.table === 'participants' && w.op === 'update' && w.patch && w.patch.is_host === true);
    },
    from(table) {
      if (!tables[table]) throw new Error('[stage1] unsupported table: ' + table);
      return {
        update: (patch) => makeBuilder(table, 'update', patch),
        delete: () => makeBuilder(table, 'delete'),
        select: () => makeBuilder(table, 'select'),
      };
    },
  };
}

// ── REAL 소스 실행 환경(단말 1대) ─────────────────────────────────────────────
function buildTerminal({ db, currentUserId, role, participants, roomCode = 'ROOM1', combinedSourceOverride = null }) {
  const state = {
    currentUserId, role, roomCode,
    participants: participants.map((p) => ({ ...p })),
    nickname: 'nick_' + currentUserId,
    confirmedSafeIds: [], confirmedLoserIds: [],
    gameStarting: false, becomingNextHost: false,
    gameOverTimeout: null,
  };
  const calls = { toast: [], beginNewGameRound: [], goHome: 0, clearRealtime: 0, qa: [], showHostRoom: 0 };
  const fakeEl = () => ({ classList: { add() {}, remove() {} }, style: {}, innerHTML: '', textContent: '', appendChild() {} });
  const combined = combinedSourceOverride
    || `${HELPERS_SRC}\n${LEAVE_CLUSTER_SRC}\n${ENSURE_HOST_SRC}`;
  const factory = new Function(
    'state', 'db', 'QA', 'getOnlineMode', 'showToast', 't', 'clearRealtime', 'goHome',
    'beginNewGameRound', 'hasCurrentGameRoundActivity', 'loadNickname', 'stopGameOverCountdown',
    'showHostRoom', '$', 'document',
    `"use strict";\n${combined}\nreturn { pickDeterministicHostCandidate, promoteParticipantToHost, verifyExactlyOneHost, leaveRoomForce, transferHostAndLeave, becomeNextHost, ensureHostExists, _doLeaveRoom };`
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
    () => {},
    () => { calls.showHostRoom += 1; },
    fakeEl,
    { getElementById: () => null, createElement: fakeEl }
  );
  return { state, calls, impl };
}

const T0 = '2026-01-01T00:00:00.000Z';
const T5S = '2026-01-01T00:00:05.000Z';
const T10S = '2026-01-01T00:00:10.000Z';

describe('WRPS-083 1단계 — fidelity(추출 소스 계약)', () => {
  it('추출 블록이 모두 존재하고, 인계 클러스터에서 Math.random이 제거되었다(무작위 금지)', () => {
    expect(HELPERS_SRC).toContain('function promoteParticipantToHost');
    expect(HELPERS_SRC).toContain('function verifyExactlyOneHost');
    expect(LEAVE_CLUSTER_SRC).toContain('async function transferHostAndLeave');
    expect(LEAVE_CLUSTER_SRC).toContain('async function becomeNextHost');
    expect(HELPERS_SRC).not.toContain('Math.random');
    expect(LEAVE_CLUSTER_SRC).not.toContain('Math.random');
  });

  it('금지 영역 무변경 계약: stale gate 임계값/폴 주기 원문이 그대로다', () => {
    expect(html).toContain('const STALE_ROOM_UPDATE_SELF_HEAL_THRESHOLD = 5;');
    expect(html).toContain('}, 2600);');
  });
});

describe('T1 — 인계 성공: old host row 삭제 + host 정확히 1명', () => {
  it('transferHostAndLeave: 승격 성공 확인 후에만 자기 row를 삭제하고 이탈한다', async () => {
    const db = createFakeDb({
      participants: [
        { id: 'h1', is_host: true, created_at: T0, room_id: 'ROOM1', name: 'nick_h1' },
        { id: 'p2', is_host: false, created_at: T5S, room_id: 'ROOM1', name: 'nick_p2' },
      ],
      rooms: [{ id: 'ROOM1', status: 'game_over', round: 1, penalty: '' }],
    });
    const t1 = buildTerminal({
      db, currentUserId: 'h1', role: 'host',
      participants: [
        { id: 'h1', is_host: true, created_at: T0 },
        { id: 'p2', is_host: false, created_at: T5S },
      ],
    });
    await t1.impl.transferHostAndLeave('p2');
    expect(db.tables.participants.find((p) => p.id === 'h1')).toBeUndefined(); // old host 삭제됨
    expect(db.hostRows().map((p) => p.id)).toEqual(['p2']); // host 정확히 1명 = 새 host
    expect(t1.calls.beginNewGameRound.length).toBe(1);
    expect(t1.calls.beginNewGameRound[0].status).toBe('waiting');
    expect(t1.calls.goHome).toBe(1); // 이탈 완료
    expect(t1.calls.toast).toEqual([]); // 실패 토스트 없음
  });

  it('becomeNextHost: 승격 선행 → 해제 후행, 완료 후 host 정확히 1명(나)', async () => {
    const db = createFakeDb({
      participants: [
        { id: 'h1', is_host: true, created_at: T0, room_id: 'ROOM1' },
        { id: 'p2', is_host: false, created_at: T5S, room_id: 'ROOM1' },
      ],
    });
    const t2 = buildTerminal({
      db, currentUserId: 'p2', role: 'participant',
      participants: [
        { id: 'h1', is_host: true, created_at: T0 },
        { id: 'p2', is_host: false, created_at: T5S },
      ],
    });
    await t2.impl.becomeNextHost();
    expect(db.hostRows().map((p) => p.id)).toEqual(['p2']);
    expect(t2.state.role).toBe('host');
    expect(t2.calls.showHostRoom).toBe(1);
    // 쓰기 순서 계약: 첫 is_host write는 "승격(true)"이지 "해제(false)"가 아니다.
    const isHostWrites = db.writeLog.filter((w) => w.table === 'participants' && w.op === 'update' && w.patch && 'is_host' in w.patch);
    expect(isHostWrites[0].patch.is_host).toBe(true);
  });
});

describe('T2 — 인계 write 실패: old host row 미삭제, host 여전히 1명(=old host)', () => {
  it('transferHostAndLeave: 승격 write가 error면 자기 row를 삭제하지 않고 방에 남는다', async () => {
    const db = createFakeDb({
      participants: [
        { id: 'h1', is_host: true, created_at: T0, room_id: 'ROOM1', name: 'nick_h1' },
        { id: 'p2', is_host: false, created_at: T5S, room_id: 'ROOM1', name: 'nick_p2' },
      ],
      rooms: [{ id: 'ROOM1', status: 'game_over', round: 1, penalty: '' }],
      failIsHostPromoteWrite: true,
    });
    const t = buildTerminal({
      db, currentUserId: 'h1', role: 'host',
      participants: [
        { id: 'h1', is_host: true, created_at: T0 },
        { id: 'p2', is_host: false, created_at: T5S },
      ],
    });
    await t.impl.transferHostAndLeave('p2');
    expect(db.tables.participants.find((p) => p.id === 'h1')).toBeDefined(); // old host row 보존
    expect(db.hostRows().map((p) => p.id)).toEqual(['h1']); // host 여전히 1명 = old host
    expect(db.writeLog.filter((w) => w.op === 'delete').length).toBe(0); // 어떤 row도 삭제 안 됨
    expect(t.calls.goHome).toBe(0); // 이탈 진행 안 함(방에 남음)
    expect(t.calls.beginNewGameRound.length).toBe(0);
    expect(t.calls.toast).toEqual(['toast.hostTransferFailed']);
    expect(t.calls.qa.some((e) => e.eventType === 'HOST_TRANSFER_ABORTED' && e.path === 'transferHostAndLeave')).toBe(true);
  });

  it('leaveRoomForce: 승격 write가 error면 _doLeaveRoom을 진행하지 않는다', async () => {
    const db = createFakeDb({
      participants: [
        { id: 'h1', is_host: true, created_at: T0, room_id: 'ROOM1', name: 'nick_h1' },
        { id: 'p2', is_host: false, created_at: T5S, room_id: 'ROOM1', name: 'nick_p2' },
      ],
      rooms: [{ id: 'ROOM1', status: 'game_over', round: 1, penalty: '' }],
      failIsHostPromoteWrite: true,
    });
    const t = buildTerminal({
      db, currentUserId: 'h1', role: 'host',
      participants: [
        { id: 'h1', is_host: true, created_at: T0 },
        { id: 'p2', is_host: false, created_at: T5S },
      ],
    });
    await t.impl.leaveRoomForce();
    expect(db.tables.participants.find((p) => p.id === 'h1')).toBeDefined();
    expect(db.hostRows().map((p) => p.id)).toEqual(['h1']);
    expect(t.calls.goHome).toBe(0);
    expect(t.calls.qa.some((e) => e.eventType === 'HOST_TRANSFER_ABORTED' && e.path === 'leaveRoomForce')).toBe(true);
  });

  it('becomeNextHost: 승격 write가 error면 기존 host 해제(is_host:false) write 자체가 없다', async () => {
    const db = createFakeDb({
      participants: [
        { id: 'h1', is_host: true, created_at: T0, room_id: 'ROOM1' },
        { id: 'p2', is_host: false, created_at: T5S, room_id: 'ROOM1' },
      ],
      failIsHostPromoteWrite: true,
    });
    const t = buildTerminal({
      db, currentUserId: 'p2', role: 'participant',
      participants: [
        { id: 'h1', is_host: true, created_at: T0 },
        { id: 'p2', is_host: false, created_at: T5S },
      ],
    });
    await t.impl.becomeNextHost();
    expect(db.hostRows().map((p) => p.id)).toEqual(['h1']); // old host 그대로
    const demoteWrites = db.writeLog.filter((w) => w.op === 'update' && w.patch && w.patch.is_host === false);
    expect(demoteWrites.length).toBe(0); // 해제 write 미실행(host 0명 창 원천 차단)
    expect(t.state.role).toBe('participant');
    expect(t.calls.showHostRoom).toBe(0);
  });

  it('T2b(Build31 실측 클래스): 대상이 이미 퇴장해 승격이 error 없는 0-row no-op이어도 성공 확인이 잡아낸다', async () => {
    const db = createFakeDb({
      participants: [
        { id: 'h1', is_host: true, created_at: T0, room_id: 'ROOM1', name: 'nick_h1' },
        // p2 row 없음 — 인계 팝업이 뜬 뒤 대상이 퇴장한 상황.
      ],
      rooms: [{ id: 'ROOM1', status: 'game_over', round: 1, penalty: '' }],
    });
    const t = buildTerminal({
      db, currentUserId: 'h1', role: 'host',
      participants: [
        { id: 'h1', is_host: true, created_at: T0 },
        { id: 'p2', is_host: false, created_at: T5S }, // 로컬 스냅샷엔 아직 남아있음(stale)
      ],
    });
    await t.impl.transferHostAndLeave('p2');
    expect(db.tables.participants.find((p) => p.id === 'h1')).toBeDefined(); // old host row 보존
    expect(db.hostRows().map((p) => p.id)).toEqual(['h1']);
    expect(t.calls.goHome).toBe(0);
    expect(t.calls.qa.some((e) => e.eventType === 'HOST_PROMOTE_VERIFY_FAILED')).toBe(true);
  });
});

describe('T3 — host 0명 감지 → ensureHostExists 자동 승격(created_at 최소)', () => {
  it('fetchParticipants에 배선이 존재한다(스냅샷 확정 직후, WRPS-018 이전 — 보조 위치 계약)', () => {
    expect(hasEnsureHostWiring(FETCH_CLUSTER_SRC)).toBe(true);
  });

  it('[행위] REAL fetchParticipants 2회 구동: 1차 관측 무개입 → 2차 연속 관측 후 결정적 후보 승격 → host exactly one', async () => {
    const db = createFakeDb({
      participants: [
        { id: 'a', is_host: false, created_at: T0, room_id: 'ROOM1', name: 'name_a' },
        { id: 'b', is_host: false, created_at: T5S, room_id: 'ROOM1', name: 'name_b' },
      ],
    });
    const term = buildFetchTerminal({ db, currentUserId: 'a' });
    // 1차 폴링: host 0명 "관측"만 — 승격 write 0건(과도기 오탐 방지 게이트).
    await term.impl.fetchParticipants('ROOM1');
    expect(term.state.participants.map((p) => p.id).sort()).toEqual(['a', 'b']); // 스냅샷 확정됨
    expect(db.isHostPromoteWrites().length).toBe(0);
    expect(db.hostRows().length).toBe(0);
    expect(term.state.hostZeroObservationStreak).toBe(1);
    // 2차 폴링(연속 관측): created_at 최소 후보(a=본인)가 승격된다.
    await term.impl.fetchParticipants('ROOM1');
    expect(db.isHostPromoteWrites().length).toBe(1);
    expect(db.hostRows().map((p) => p.id)).toEqual(['a']);
    expect(term.state.role).toBe('host');
    expect(term.calls.qa.some((e) => e.eventType === 'HOST_AUTO_PROMOTED' && e.hostId === 'a')).toBe(true);
    // 재조회로 host exactly-one 확인(fake db가 아니라 REAL select 체인 경유).
    const { data: recheck } = await db.from('participants').select('id,is_host').eq('room_id', 'ROOM1');
    expect(recheck.filter((p) => p.is_host).map((p) => p.id)).toEqual(['a']);
    // 3차 폴링(안정성): host가 존재하므로 무개입 + 관측 카운터 리셋, 추가 write 없음.
    await term.impl.fetchParticipants('ROOM1');
    expect(db.isHostPromoteWrites().length).toBe(1);
    expect(term.state.hostZeroObservationStreak).toBe(0);
  });

  it('host 0명 연속 2회 관측 시 created_at 최소 참가자(본인 단말)가 승격된다', async () => {
    const rows = [
      { id: 'a', is_host: false, created_at: T0, room_id: 'ROOM1' },
      { id: 'b', is_host: false, created_at: T5S, room_id: 'ROOM1' },
    ];
    const db = createFakeDb({ participants: rows });
    const t = buildTerminal({ db, currentUserId: 'a', role: 'participant', participants: rows });
    await t.impl.ensureHostExists(); // 1회차 관측 — 개입하지 않음(과도기 오탐 방지)
    expect(db.isHostPromoteWrites().length).toBe(0);
    await t.impl.ensureHostExists(); // 2회차 관측 — 개입
    expect(db.hostRows().map((p) => p.id)).toEqual(['a']);
    expect(t.state.role).toBe('host');
    expect(db.isHostPromoteWrites().length).toBe(1);
    expect(t.calls.qa.some((e) => e.eventType === 'HOST_AUTO_PROMOTED' && e.hostId === 'a')).toBe(true);
  });

  it('host가 이미 있으면 관측 카운터가 리셋되고 아무것도 쓰지 않는다', async () => {
    const rows = [
      { id: 'a', is_host: true, created_at: T0, room_id: 'ROOM1' },
      { id: 'b', is_host: false, created_at: T5S, room_id: 'ROOM1' },
    ];
    const db = createFakeDb({ participants: rows });
    const t = buildTerminal({ db, currentUserId: 'a', role: 'host', participants: rows });
    t.state.hostZeroObservationStreak = 1; // 직전에 과도기 스냅샷을 한 번 봤더라도
    await t.impl.ensureHostExists();
    expect(t.state.hostZeroObservationStreak).toBe(0);
    expect(db.isHostPromoteWrites().length).toBe(0);
  });
});

describe('T4 — 동률 created_at → id 오름차순 승격(결정적)', () => {
  it('pickDeterministicHostCandidate: created_at 동률이면 id 오름차순', () => {
    const db = createFakeDb({});
    const t = buildTerminal({ db, currentUserId: 'x', role: 'participant', participants: [] });
    const picked = t.impl.pickDeterministicHostCandidate([
      { id: 'p_b', created_at: T0 },
      { id: 'p_a', created_at: T0 },
      { id: 'p_c', created_at: T5S },
    ]);
    expect(picked.id).toBe('p_a');
  });

  it('동률 상황에서 ensureHostExists도 id 오름차순 후보(본인)만 승격한다', async () => {
    const rows = [
      { id: 'p_b', is_host: false, created_at: T0, room_id: 'ROOM1' },
      { id: 'p_a', is_host: false, created_at: T0, room_id: 'ROOM1' },
    ];
    const db = createFakeDb({ participants: rows });
    const winner = buildTerminal({ db, currentUserId: 'p_a', role: 'participant', participants: rows });
    const loser = buildTerminal({ db, currentUserId: 'p_b', role: 'participant', participants: rows });
    for (const term of [winner, loser]) { await term.impl.ensureHostExists(); await term.impl.ensureHostExists(); }
    expect(db.hostRows().map((p) => p.id)).toEqual(['p_a']);
    expect(db.isHostPromoteWrites().length).toBe(1); // p_b 단말은 write하지 않았다
  });
});

describe('T5 — 3단말 동시 host 0명 관측 → 중복 write 없이 동일 host 수렴', () => {
  it('후보 본인 단말만 write하고 나머지는 관측만 한다', async () => {
    const rows = [
      { id: 'a', is_host: false, created_at: T0, room_id: 'ROOM1' },
      { id: 'b', is_host: false, created_at: T5S, room_id: 'ROOM1' },
      { id: 'c', is_host: false, created_at: T10S, room_id: 'ROOM1' },
    ];
    const db = createFakeDb({ participants: rows });
    const terms = ['a', 'b', 'c'].map((id) => buildTerminal({ db, currentUserId: id, role: 'participant', participants: rows }));
    // 폴링 2사이클을 3단말이 인터리브로 실행(동시 관측 재현 — 결정적 순서로 구동).
    await Promise.all(terms.map((t) => t.impl.ensureHostExists()));
    expect(db.isHostPromoteWrites().length).toBe(0); // 1회차: 전원 관측만
    await Promise.all(terms.map((t) => t.impl.ensureHostExists()));
    expect(db.hostRows().map((p) => p.id)).toEqual(['a']); // 동일 host로 수렴
    expect(db.isHostPromoteWrites().length).toBe(1); // 중복 write 없음
    expect(terms[0].state.role).toBe('host');
    expect(terms[1].state.role).toBe('participant');
    expect(terms[2].state.role).toBe('participant');
  });
});

describe('T6 — mutation: 안전장치 제거 시 T2/T3가 RED가 됨을 증명', () => {
  it('(a) error 검사 제거(if (!promoted) → if (false)) → 승격 실패에도 old host row가 삭제된다(T2 위반)', async () => {
    const mutatedCluster = LEAVE_CLUSTER_SRC.replaceAll('if (!promoted) {', 'if (false) {');
    expect(mutatedCluster).not.toBe(LEAVE_CLUSTER_SRC); // mutation이 실제로 적용됐다
    const db = createFakeDb({
      participants: [
        { id: 'h1', is_host: true, created_at: T0, room_id: 'ROOM1', name: 'nick_h1' },
        { id: 'p2', is_host: false, created_at: T5S, room_id: 'ROOM1', name: 'nick_p2' },
      ],
      rooms: [{ id: 'ROOM1', status: 'game_over', round: 1, penalty: '' }],
      failIsHostPromoteWrite: true,
    });
    const t = buildTerminal({
      db, currentUserId: 'h1', role: 'host',
      participants: [
        { id: 'h1', is_host: true, created_at: T0 },
        { id: 'p2', is_host: false, created_at: T5S },
      ],
      combinedSourceOverride: `${HELPERS_SRC}\n${mutatedCluster}\n${ENSURE_HOST_SRC}`,
    });
    await t.impl.transferHostAndLeave('p2');
    // T2의 핵심 불변식("승격 실패 시 old host row 보존")이 mutant에서는 깨진다 → T2는 RED가 된다.
    expect(db.tables.participants.find((p) => p.id === 'h1')).toBeUndefined(); // old host 삭제돼 버림
    expect(db.hostRows().length).toBe(0); // host 0명 — 정확히 Build31 정지 클래스
    expect(t.calls.goHome).toBe(1); // 이탈까지 진행돼 버림
  });

  it('(b)[행위] 배선 제거 mutant는 같은 입력·같은 2회 구동에서 복구가 일어나지 않는다(T3 RED 증명)', async () => {
    // mutant 파생: REAL 소스에서 배선 호출 한 줄만 제거(주석/나머지 소스 무변경) 후 재컴파일.
    const mutatedFetch = FETCH_CLUSTER_SRC.replace(ENSURE_WIRING_CALL, '');
    expect(mutatedFetch).not.toBe(FETCH_CLUSTER_SRC); // mutation이 실제로 적용됐다
    const seedRows = [
      { id: 'a', is_host: false, created_at: T0, room_id: 'ROOM1', name: 'name_a' },
      { id: 'b', is_host: false, created_at: T5S, room_id: 'ROOM1', name: 'name_b' },
    ];
    // 대조군(원본 소스): 동일 입력·동일 2회 구동에서 복구 성공(위 T3 행위 테스트와 동일 경로).
    const dbOriginal = createFakeDb({ participants: seedRows });
    const original = buildFetchTerminal({ db: dbOriginal, currentUserId: 'a' });
    await original.impl.fetchParticipants('ROOM1');
    await original.impl.fetchParticipants('ROOM1');
    expect(dbOriginal.hostRows().map((p) => p.id)).toEqual(['a']); // 원본: 복구됨(GREEN 기준선)
    // mutant: 같은 입력·같은 2회 구동 — 승격 write 0건, host 여전히 0명(복구 실패 = T3 RED).
    const dbMutant = createFakeDb({ participants: seedRows });
    const mutant = buildFetchTerminal({ db: dbMutant, currentUserId: 'a', fetchSourceOverride: mutatedFetch });
    await mutant.impl.fetchParticipants('ROOM1');
    await mutant.impl.fetchParticipants('ROOM1');
    expect(mutant.state.participants.map((p) => p.id).sort()).toEqual(['a', 'b']); // fetch 자체는 정상 동작
    expect(dbMutant.isHostPromoteWrites().length).toBe(0); // 승격 write가 전혀 없다
    expect(dbMutant.hostRows().length).toBe(0); // host 여전히 0명 — 방은 고아 상태로 남는다
    expect(mutant.state.role).toBe('participant');
    expect(mutant.calls.qa.some((e) => e.eventType === 'HOST_AUTO_PROMOTED')).toBe(false);
    // 보조(위치 계약): 문자열 검사도 함께 RED가 됨을 확인.
    expect(hasEnsureHostWiring(FETCH_CLUSTER_SRC)).toBe(true);
    expect(hasEnsureHostWiring(mutatedFetch)).toBe(false);
  });
});

describe('부가 — verifyExactlyOneHost 수렴 규칙(행위 단말 책임)', () => {
  it('host 2명(해제 write 유실 고착)이면 preferredHostId를 남기고 나머지를 해제한다', async () => {
    const db = createFakeDb({
      participants: [
        { id: 'old', is_host: true, created_at: T0, room_id: 'ROOM1' },
        { id: 'neo', is_host: true, created_at: T5S, room_id: 'ROOM1' },
      ],
    });
    const t = buildTerminal({ db, currentUserId: 'neo', role: 'host', participants: [] });
    const kept = await t.impl.verifyExactlyOneHost('ROOM1', 'neo');
    expect(kept).toBe('neo');
    expect(db.hostRows().map((p) => p.id)).toEqual(['neo']);
    expect(t.calls.qa.some((e) => e.eventType === 'HOST_EXACTLY_ONE_VIOLATION' && e.hostCount === 2)).toBe(true);
  });

  it('host 0명이면 preferredHostId(방에 있으면)를 재승격한다', async () => {
    const db = createFakeDb({
      participants: [
        { id: 'a', is_host: false, created_at: T0, room_id: 'ROOM1' },
        { id: 'neo', is_host: false, created_at: T5S, room_id: 'ROOM1' },
      ],
    });
    const t = buildTerminal({ db, currentUserId: 'neo', role: 'host', participants: [] });
    const kept = await t.impl.verifyExactlyOneHost('ROOM1', 'neo');
    expect(kept).toBe('neo');
    expect(db.hostRows().map((p) => p.id)).toEqual(['neo']);
  });

  it('참가자 0명(빈 방/파괴 중)이면 개입하지 않는다 — last_participant 파괴 경로 보존', async () => {
    const db = createFakeDb({ participants: [] });
    const t = buildTerminal({ db, currentUserId: 'x', role: 'host', participants: [] });
    const kept = await t.impl.verifyExactlyOneHost('ROOM1', 'x');
    expect(kept).toBeNull();
    expect(db.writeLog.length).toBe(0); // update/delete write 0건(관측 select만 수행)
  });
});
