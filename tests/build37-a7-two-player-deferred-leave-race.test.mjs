import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

// ════════════════════════════════════════════════════════════════════════════
// A7 — 2인 방 deferred leave 경합 시뮬레이션.
//
// 실기기 blocker 후보(코드 리딩으로만 확인됐던 것)를 실행으로 확인한다:
//   2인 방에서 p2가 퇴장을 예약 → 결과 확정 → host의 sweep이 p2 row를 지움
//   → host의 fetchParticipants가 data.length===1을 관측
//   → WRPS-056(DR-14) 마지막 1인 가드가 destroyRoomAndGoHome("last_participant")를 발화?
//
// 검증 계약
//   1. 결과 확정 **전에는** 방이 파괴되지 않는다
//   2. 예약자는 결과를 끝까지 본다(퇴장 처리가 결과 표시보다 먼저 오면 안 된다)
//   3. 결과 확정 **후** p2 제거는 허용된다
//   4. 남은 host 1명 상태에서 destroy가 즉시 발화하는지 — 실행으로 관측한다
//
// 방법: production 무수정. index.html 원문을 추출해 new Function으로 구동하고,
//       두 단말(host / p2)이 **같은 fake DB 인스턴스**를 공유하게 해 write가 서로 보이게 한다.
//       fake DB는 host-transfer-stage1.test.mjs의 것과 같은 계약(실제 체인 의미)이다.
// ════════════════════════════════════════════════════════════════════════════

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
function extractBlock(startMarker, endMarker, label) {
  const start = html.indexOf(startMarker);
  if (start < 0) throw new Error(`[a7] start marker not found (${label}): ${startMarker}`);
  const end = html.indexOf(endMarker, start + startMarker.length);
  if (end < 0) throw new Error(`[a7] end marker not found (${label}): ${endMarker}`);
  return html.slice(start, end);
}
const noop = () => {};
const asyncNoop = async () => {};

// ── REAL 소스 추출 ──────────────────────────────────────────────────────────
const ROOM_GUARD_SRC = extractBlock('function isRoomClosingOrDestroyed() {', 'function isJoinLocked(', 'roomGuard');
const ROUND_PROG_SRC = extractBlock('function isRoundInProgressForLeave() {', '// WRPS-083 2A: ready 잠금 계산에서', 'roundProg');
const ACTIVITY_SRC   = extractBlock('function getParticipantSignature(participants = state.participants) {',
                                    'function getNewGameRoundParticipantPatch(extra = {}) {', 'activity');
// _doLeaveRoom + reserveDeferredLeave + processDeferredLeaves (destroyRoomAndGoHome 직전까지)
const LEAVE_SRC = extractBlock(
  'async function _doLeaveRoom() {\n      const successorHostId = state.pendingSuccessorHostId || null;',
  '// WRPS-056(DR-14): 마지막 1인만 남은', 'leave');
const FETCH_CLUSTER_SRC = extractBlock(
  'function scheduleFetchParticipants(roomCode', 'async function updateRoomStatus(status) {', 'fetchCluster');
const FINISH_SRC = extractBlock('async function finishRoundLocal() {', 'function scheduleRematchAutoAdvance(', 'finish');

// ── 결정적 fake supabase (두 단말이 공유) ───────────────────────────────────
function createSharedDb({ participants = [], rooms = [] } = {}) {
  const tables = { participants: participants.map(p => ({ ...p })), rooms: rooms.map(r => ({ ...r })) };
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
      const match = r => filters.every(([col, val, kind]) => (kind === 'in' ? val.includes(r[col]) : r[col] === val));
      const rows = tables[table].filter(match);
      if (op === 'update') {
        writeLog.push({ table, op, patch: { ...patch }, filters: filters.map(f => [...f]), matched: rows.length });
        rows.forEach(r => Object.assign(r, patch));
        return { data: null, error: null };
      }
      if (op === 'delete') {
        writeLog.push({ table, op, filters: filters.map(f => [...f]), matched: rows.length });
        for (const r of rows) tables[table].splice(tables[table].indexOf(r), 1);
        return { data: null, error: null };
      }
      const copies = rows.map(r => ({ ...r }));
      if (b._single) {
        return copies.length === 1 ? { data: copies[0], error: null }
          : { data: null, error: { code: 'PGRST116', message: '[fake] rows=' + copies.length } };
      }
      return { data: copies, error: null };
    }
    return b;
  }
  return {
    tables, writeLog,
    ids() { return tables.participants.map(p => p.id).sort(); },
    deletes() { return writeLog.filter(w => w.table === 'participants' && w.op === 'delete'); },
    reserves() { return writeLog.filter(w => w.table === 'participants' && w.op === 'update'
      && w.patch && w.patch.leave_after_round === true); },
    from(table) {
      if (!tables[table]) throw new Error('[a7] unsupported table: ' + table);
      return { update: p => makeBuilder(table, 'update', p),
               delete: () => makeBuilder(table, 'delete'),
               select: () => makeBuilder(table, 'select') };
    },
  };
}

const ROOM = 'BYZ7';
const seedRows = () => ([
  { id: 'h1', room_id: ROOM, name: 'host', is_host: true,  choice: 'scissors', is_ready: true,
    leave_after_round: false, created_at: '2026-08-20T10:00:00Z' },
  { id: 'p2', room_id: ROOM, name: 'p2',   is_host: false, choice: 'rock',     is_ready: true,
    leave_after_round: false, created_at: '2026-08-20T10:01:00Z' },
]);

// ── 단말 A: 나가기/예약/정리 경로 ───────────────────────────────────────────
function buildLeaveTerminal({ db, currentUserId, role, status = 'playing' }) {
  const calls = { goHome: 0, clearRealtime: 0, toast: [], qa: [] };
  const state = {
    currentUserId, role, status, roomCode: ROOM, round: 3, gameRound: 5,
    nickname: currentUserId === 'h1' ? 'host' : 'p2',
    participants: seedRows().map(r => ({ ...r })),
    confirmedSafeIds: [], confirmedLoserIds: [], targetLoserCount: 1,
    penalty: JSON.stringify({ text: '커피', loserCount: 1, gameRound: 5 }),
    roomClosing: false, hostTransferInFlight: false, leavingProcessing: false,
    pendingSuccessorHostId: null, publishingRoundResult: false, finishingRound: false,
    gameStarting: false,
  };
  const factory = new Function(
    'state', 'db', 'QA', 'getOnlineMode', 'loadNickname', 'showToast', 't',
    'clearRealtime', 'goHome', 'beginNewGameRound', 'isNonPlayingChoice', 'getGameRound',
    `"use strict";\n${ROOM_GUARD_SRC}\n${ROUND_PROG_SRC}\n${ACTIVITY_SRC}\n${LEAVE_SRC}\n` +
    'return { _doLeaveRoom, reserveDeferredLeave, processDeferredLeaves, isRoundInProgressForLeave };'
  );
  const impl = factory(
    state, db, { emit: (kind, p) => calls.qa.push({ kind, ...p }) },
    () => true, () => state.nickname, m => calls.toast.push(m), k => k,
    () => { calls.clearRealtime++; }, () => { calls.goHome++; },
    asyncNoop, c => c === '__safe__' || c === '__loser__' || c === '__waiting__',
    () => state.gameRound
  );
  return { state, calls, impl };
}

// ── 단말 B: host의 fetchParticipants (마지막 1인 가드 관측용) ────────────────
function buildFetchTerminal({ db, participants, status = 'result' }) {
  const calls = { destroy: [], qa: [], renderAll: 0, showScreen: [] };
  const state = {
    currentUserId: 'h1', role: 'host', status, roomCode: ROOM, round: 3, gameRound: 5,
    participants: participants.map(p => ({ ...p })),
    fetchParticipantsSeq: 0, fetchParticipantsBusy: false, fetchParticipantsPending: false,
    fetchParticipantsTimer: null,
    confirmedSafeIds: [], confirmedLoserIds: [],
    cleaningDuplicateProfiles: false, myReadyLocallySetAt: 0,
    gameStarting: false, timer: null,
  };
  const fakeEl = () => ({ classList: { add() {}, remove() {} }, style: {}, innerHTML: '', textContent: '' });
  const factory = new Function(
    'state', 'db', 'QA', 'getOnlineMode',
    'cleanupDuplicateRoomProfiles', 'destroyRoomAndGoHome', 'shouldResetForParticipantChange',
    'beginNewGameRound', 'SoundManager', 'updateSelectedCount', 'renderAll', '$',
    'isSafeParticipant', 'isConfirmedLoser', 'isWaitingForNextGame', 'showReadyScreen',
    'showScreen', 'renderLobby', 'showHostRoom', 'isNonPlayingChoice', 'hasConfirmedRoundResult',
    'getChoiceBase', 'publishHostRoundResult', 'areAllActivePlayersReady', 'startFromLobby',
    'renderReadyList', 'startGame', 'showToast', 't',
    `"use strict";\n${ROOM_GUARD_SRC}\n${FETCH_CLUSTER_SRC}\nreturn { fetchParticipants };`
  );
  const impl = factory(
    state, db, { emit: (kind, p) => calls.qa.push({ kind, ...p }) }, () => true,
    asyncNoop,
    async (reason) => { calls.destroy.push(reason); },
    () => false, asyncNoop,
    { playJoinMeow: noop, playLeaveMeow: noop }, noop,
    () => { calls.renderAll++; }, fakeEl,
    () => false, () => false, () => false, noop,
    s => calls.showScreen.push(s), noop, noop,
    c => c === '__safe__' || c === '__loser__' || c === '__waiting__',
    () => false, () => '', asyncNoop, () => false, asyncNoop, noop, asyncNoop,
    noop, k => k
  );
  return { state, calls, impl };
}

// ════════════════════════════════════════════════════════════════════════════
describe('A7 — 공허성 가드', () => {
  it('추출한 REAL 소스에 이번 시나리오의 핵심 코드가 실제로 들어 있다', () => {
    expect(LEAVE_SRC, '예약 write').toContain('update({ leave_after_round: true })');
    expect(LEAVE_SRC, 'sweep 삭제').toContain(".eq('leave_after_round', true)");
    expect(FETCH_CLUSTER_SRC, '마지막 1인 가드').toContain('destroyRoomAndGoHome("last_participant")');
    expect(FETCH_CLUSTER_SRC).toContain('oldParticipants.length > 1 && data.length === 1');
  });

  it('fake DB가 두 단말 사이에서 실제로 공유된다', async () => {
    const db = createSharedDb({ participants: seedRows(), rooms: [{ id: ROOM, status: 'playing' }] });
    await db.from('participants').update({ is_ready: false }).eq('id', 'p2');
    const { data } = await db.from('participants').select('*').eq('room_id', ROOM);
    expect(data.find(r => r.id === 'p2').is_ready).toBe(false);
    expect(db.ids()).toEqual(['h1', 'p2']);
  });
});

describe('A7 — 검증 2: 예약자는 결과를 끝까지 본다 (소스 순서 계약)', () => {
  it('finishRoundLocal의 모든 종료 분기에서 결과 표시가 예약 처리보다 먼저 온다', () => {
    // processDeferredLeaves는 recordRoundResolution 안에서 호출된다. 따라서 각 종료 분기에서
    // recordRoundResolution 호출이 결과 렌더/화면 전환보다 **뒤에** 있어야 예약자가 결과를 본다.
    const RENDER = ['renderRoundResult(', 'showRoundResultOrWait(', 'showScreen("screenRoundResult")'];
    const all = [];
    let p = FINISH_SRC.indexOf('recordRoundResolution({');
    while (p >= 0) { all.push(p); p = FINISH_SRC.indexOf('recordRoundResolution({', p + 1); }
    expect(all.length, 'recordRoundResolution 호출 지점을 못 찾았다 — 계약 검증이 공허해진다')
      .toBeGreaterThanOrEqual(4);

    const bad = [];
    for (const at of all) {
      const before = FINISH_SRC.slice(0, at);
      const lastRender = Math.max(...RENDER.map(m => before.lastIndexOf(m)));
      if (lastRender < 0) { bad.push(`오프셋 ${at}: 앞선 결과 표시 호출이 전혀 없다`); continue; }
      // 같은 분기 안인지 대략 확인: 사이에 다른 recordRoundResolution이 끼면 안 된다
      const between = FINISH_SRC.slice(lastRender, at);
      if (between.includes('recordRoundResolution({')) bad.push(`오프셋 ${at}: 표시와 확정 사이에 다른 확정이 끼었다`);
    }
    expect(bad, '결과 표시보다 예약 처리가 먼저 오는 분기').toEqual([]);
  });

  it('processDeferredLeaves는 recordRoundResolution 안에서만 호출된다', () => {
    // ⚠️ 단순 문자열 카운트는 주석까지 센다(index.html에 설명 주석 2곳이 있다).
    //    주석 줄을 걷어내고, 선언부(`async function ...`)도 제외한 실제 호출만 센다.
    const callLines = html.split('\n')
      .filter(l => l.includes('processDeferredLeaves()'))
      .filter(l => !l.trim().startsWith('//'))
      .filter(l => !l.includes('async function processDeferredLeaves'));
    expect(callLines.length,
      `실제 호출 지점 ${callLines.length}개 — 확정 지점 외에서 부르면 판정 전에 방을 떠날 위험이 생긴다:\n` +
      callLines.join('\n')).toBe(1);
    expect(callLines[0], '확정 지점의 호출이어야 한다').toContain('typeof processDeferredLeaves');
    const REC = extractBlock('const recordRoundResolution = (payload) => {', '};', 'record');
    expect(REC).toContain('processDeferredLeaves()');
    expect(REC.indexOf('state.lastRoundResolution = payload;'))
      .toBeLessThan(REC.indexOf('processDeferredLeaves()'));
  });
});

describe('A7 — 2인 방 경합 시뮬레이션 (REAL 실행)', () => {
  async function runScenario() {
    const db = createSharedDb({ participants: seedRows(), rooms: [{ id: ROOM, status: 'playing' }] });
    const trace = [];

    // ① playing 중 p2가 나가기 → 예약만 된다
    const p2 = buildLeaveTerminal({ db, currentUserId: 'p2', role: 'participant', status: 'playing' });
    await p2.impl._doLeaveRoom();
    trace.push({ step: 'reserve', ids: db.ids(), deletes: db.deletes().length,
                 reserves: db.reserves().length, p2GoHome: p2.calls.goHome,
                 p2ClearRealtime: p2.calls.clearRealtime });

    // ② 결과 확정 **전** host가 폴링한다 — 방이 파괴되면 안 된다
    const hostBefore = buildFetchTerminal({ db, participants: seedRows(), status: 'playing' });
    await hostBefore.impl.fetchParticipants(ROOM);
    trace.push({ step: 'pollBeforeResult', destroy: [...hostBefore.calls.destroy], ids: db.ids() });

    // ③ 결과 확정 → 양 단말이 processDeferredLeaves를 수행한다
    const host = buildLeaveTerminal({ db, currentUserId: 'h1', role: 'host', status: 'result' });
    await host.impl.processDeferredLeaves();          // host: sweep
    trace.push({ step: 'hostSweep', ids: db.ids(), deletes: db.deletes().length });
    await p2.impl.processDeferredLeaves();            // p2: 실제 퇴장
    trace.push({ step: 'p2Leave', ids: db.ids(), p2GoHome: p2.calls.goHome });

    // ④ 확정 후 host가 다시 폴링한다 — data.length===1을 관측한다
    const hostAfter = buildFetchTerminal({ db, participants: seedRows(), status: 'result' });
    await hostAfter.impl.fetchParticipants(ROOM);
    trace.push({ step: 'pollAfterSweep', destroy: [...hostAfter.calls.destroy], ids: db.ids() });

    return { db, p2, host, hostBefore, hostAfter, trace };
  }

  it('[검증 1] 결과 확정 전에는 방이 파괴되지 않는다', async () => {
    const s = await runScenario();
    const before = s.trace.find(t => t.step === 'pollBeforeResult');
    expect(before.destroy, '결과 확정 전 destroy 발화').toEqual([]);
    expect(before.ids, '예약만 했는데 row가 사라졌다').toEqual(['h1', 'p2']);
  });

  it('[검증 1b] 예약 시점에 삭제·퇴장이 전혀 없다', async () => {
    const s = await runScenario();
    const r = s.trace.find(t => t.step === 'reserve');
    expect(r.deletes, '즉시 삭제가 발생했다').toBe(0);
    expect(r.reserves, '예약 write가 정확히 1건이어야 한다').toBe(1);
    expect(r.p2GoHome, '결과 확정 전 goHome').toBe(0);
    // ⚠️ 최종 상태가 아니라 **예약 시점**의 값을 봐야 한다. 확정 후에는 정상적으로 1이 된다.
    expect(r.p2ClearRealtime, '결과 확정 전 realtime 해제').toBe(0);
  });

  it('[검증 3] 결과 확정 후 p2 제거는 허용된다', async () => {
    const s = await runScenario();
    const sweep = s.trace.find(t => t.step === 'hostSweep');
    expect(sweep.ids, 'sweep 후 host만 남아야 한다').toEqual(['h1']);
    expect(s.p2.calls.goHome, '예약자는 확정 후 실제로 퇴장해야 한다').toBe(1);
  });

  it('[검증 4 · RED→GREEN] 결과 표시 구간에서는 last_participant destroy가 미뤄진다', async () => {
    const s = await runScenario();
    const after = s.trace.find(t => t.step === 'pollAfterSweep');
    console.log('\n── A7 2인 방 경합 trace ──\n' +
      s.trace.map(t => JSON.stringify(t)).join('\n'));
    expect(after.destroy,
      'sweep 직후(status=result) 폴링에서 destroy가 발화했다 — 결과를 볼 틈이 없다').toEqual([]);
    // 미뤘을 뿐 잊지 않았다는 것도 함께 고정한다(래치 생존).
    expect(s.hostAfter.state.pendingLastParticipantCleanup,
      '래치가 서 있어야 다음 전이에서 정리된다').toBe(true);
  });

  it('[대조군] 3인 방에서는 발화하지 않는다 — 2인 방 특유의 결함이다', async () => {
    const rows3 = [...seedRows(), { id: 'p3', room_id: ROOM, name: 'p3', is_host: false,
      choice: 'paper', is_ready: true, leave_after_round: false, created_at: '2026-08-20T10:02:00Z' }];
    const db = createSharedDb({ participants: rows3.map(r => ({ ...r })), rooms: [{ id: ROOM, status: 'playing' }] });
    const p2 = buildLeaveTerminal({ db, currentUserId: 'p2', role: 'participant', status: 'playing' });
    p2.state.participants = rows3.map(r => ({ ...r }));
    await p2.impl._doLeaveRoom();
    const host = buildLeaveTerminal({ db, currentUserId: 'h1', role: 'host', status: 'result' });
    host.state.participants = rows3.map(r => ({ ...r }));
    await host.impl.processDeferredLeaves();
    expect(db.ids(), 'sweep 후 2명이 남아야 한다').toEqual(['h1', 'p3']);
    const hostAfter = buildFetchTerminal({ db, participants: rows3, status: 'result' });
    await hostAfter.impl.fetchParticipants(ROOM);
    expect(hostAfter.calls.destroy, '3인 방에서는 destroy가 발화하면 안 된다').toEqual([]);
  });

  it('[RED→GREEN] 발화가 state.status에 의존한다 — 결과 표시 구간만 미룬다', async () => {
    // Phase A 관측: 가드에 status 조건이 전혀 없어 세 상태 모두에서 발화했다.
    // 안 C + R1 확정 계약: result/game_over만 미루고, playing은 종전대로 즉시 정리한다.
    // (R1 근거는 아래 'playing은 보호하지 않는다' 블록에서 별도로 고정한다.)
    const observed = {};
    for (const status of ['result', 'game_over']) {
      const db = createSharedDb({ participants: seedRows(), rooms: [{ id: ROOM, status }] });
      const p2 = buildLeaveTerminal({ db, currentUserId: 'p2', role: 'participant', status: 'playing' });
      await p2.impl._doLeaveRoom();
      const host = buildLeaveTerminal({ db, currentUserId: 'h1', role: 'host', status });
      await host.impl.processDeferredLeaves();
      const hostAfter = buildFetchTerminal({ db, participants: seedRows(), status });
      await hostAfter.impl.fetchParticipants(ROOM);
      observed[status] = { destroy: [...hostAfter.calls.destroy],
                           latch: Boolean(hostAfter.state.pendingLastParticipantCleanup) };
    }
    console.log('\n── status별 destroy 발화 ──\n' + JSON.stringify(observed, null, 2));
    // 가드가 실제로 status를 본다는 것을 소스로도 고정한다(공허성 방지).
    const guard = FETCH_CLUSTER_SRC.slice(
      FETCH_CLUSTER_SRC.indexOf('state.pendingLastParticipantCleanup && data.length === 1'));
    expect(guard.slice(0, 400), '가드가 status를 보지 않는다').toContain('includes(state.status)');
    expect(guard.slice(0, 400), 'playing은 보호 대상이 아니다').not.toContain('"playing"');
    for (const [st, o] of Object.entries(observed)) {
      expect(o.destroy, `${st}에서 destroy 발화`).toEqual([]);
      expect(o.latch, `${st}에서 래치가 유실됐다`).toBe(true);
    }
  });
});

describe('A7 — 안 C 계약: latch 기반 지연 정리', () => {
  // 공통: 2인 방에서 p2를 sweep으로 제거한 뒤, 주어진 status에서 host가 폴링한다.
  async function sweepThenPoll(statuses) {
    const db = createSharedDb({ participants: seedRows(), rooms: [{ id: ROOM, status: 'playing' }] });
    const p2 = buildLeaveTerminal({ db, currentUserId: 'p2', role: 'participant', status: 'playing' });
    await p2.impl._doLeaveRoom();
    const sweeper = buildLeaveTerminal({ db, currentUserId: 'h1', role: 'host', status: 'result' });
    await sweeper.impl.processDeferredLeaves();
    expect(db.ids(), 'sweep 전제').toEqual(['h1']);
    // 단말 하나가 status 전이를 겪으며 연속 폴링하는 상황을 재현한다.
    const host = buildFetchTerminal({ db, participants: seedRows(), status: statuses[0] });
    const observed = [];
    for (const st of statuses) {
      host.state.status = st;
      await host.impl.fetchParticipants(ROOM);
      observed.push({ status: st, destroy: [...host.calls.destroy],
                      latch: Boolean(host.state.pendingLastParticipantCleanup) });
    }
    return { host, observed, db };
  }

  it('result / game_over 에서는 destroy 0 — 결과 표시 전 파괴 금지', async () => {
    const { observed } = await sweepThenPoll(['result', 'game_over']);
    console.log('\n── 표시 구간 폴링 ──\n' + observed.map(o => JSON.stringify(o)).join('\n'));
    for (const o of observed) {
      expect(o.destroy, `${o.status}에서 destroy가 발화했다`).toEqual([]);
      expect(o.latch, `${o.status}에서 래치가 풀렸다 — 정리 주체를 잃는다`).toBe(true);
    }
  });

  // ── R1 확정 계약: playing은 보호하지 않는다 ────────────────────────────────
  // deferred leave의 정상 sweep은 result에서만 돈다. playing 중 2→1이 실제로 생기는
  // 경로는 dropped participant 정리(45초 이상 offline + !is_ready)뿐이고, 그때는
  // 1인 방으로 게임을 계속 진행시켜 host가 자동으로 술래 확정되는 것보다
  // 기존 WRPS-056 정리를 즉시 수행하는 것이 옳다(R1 조사로 확정된 의미 계약).
  it('[R1] playing 2→1(dropped cleanup)에서는 destroy가 정확히 1회 즉시 발화한다', async () => {
    const db = createSharedDb({ participants: seedRows(), rooms: [{ id: ROOM, status: 'playing' }] });
    // dropped participant 정리가 상대 row를 지운 상황(예약 없이 사라진다 — A2 경로가 아니다)
    await db.from('participants').delete().eq('id', 'p2');
    expect(db.reserves(), '전제: 예약 write가 없는 경로여야 한다').toEqual([]);
    const host = buildFetchTerminal({ db, participants: seedRows(), status: 'playing' });
    await host.impl.fetchParticipants(ROOM);
    expect(host.calls.destroy, 'playing 즉시 정리가 사라졌다').toEqual(['last_participant']);
    expect(host.state.pendingLastParticipantCleanup, '같은 tick에 소비되어야 한다').toBe(false);
  });

  it('[R1] playing 즉시 정리는 중복 폴링에서도 1회다', async () => {
    const db = createSharedDb({ participants: seedRows(), rooms: [{ id: ROOM, status: 'playing' }] });
    await db.from('participants').delete().eq('id', 'p2');
    const host = buildFetchTerminal({ db, participants: seedRows(), status: 'playing' });
    await host.impl.fetchParticipants(ROOM);
    await host.impl.fetchParticipants(ROOM);
    await host.impl.fetchParticipants(ROOM);
    expect(host.calls.destroy, `총 발화 ${host.calls.destroy.length}회`).toEqual(['last_participant']);
  });

  it('[R1] 정상 나가기(A2 deferred leave)는 playing에서 row를 지우지 않으므로 충돌하지 않는다', async () => {
    const db = createSharedDb({ participants: seedRows(), rooms: [{ id: ROOM, status: 'playing' }] });
    const p2 = buildLeaveTerminal({ db, currentUserId: 'p2', role: 'participant', status: 'playing' });
    await p2.impl._doLeaveRoom();
    expect(db.ids(), '예약만 되어 2명이 유지되어야 한다').toEqual(['h1', 'p2']);
    const host = buildFetchTerminal({ db, participants: seedRows(), status: 'playing' });
    await host.impl.fetchParticipants(ROOM);
    expect(host.calls.destroy, '예약 상태에서 방이 파괴됐다').toEqual([]);
    expect(host.state.pendingLastParticipantCleanup, '래치가 잘못 섰다').toBeFalsy();
  });

  it('비종결 result → ready 전이에서 cleanup이 정확히 1회 일어난다', async () => {
    const { observed } = await sweepThenPoll(['result', 'ready']);
    expect(observed[0].destroy, 'result에서는 대기').toEqual([]);
    expect(observed[1].destroy, 'ready 전이에서 정리').toEqual(['last_participant']);
    expect(observed[1].latch, '소비 후 래치 해제').toBe(false);
  });

  it('game_over 에서는 사용자 전이 전까지 대기하고, 전이(lobby) 후 1회 정리한다', async () => {
    const { observed } = await sweepThenPoll(['game_over', 'game_over', 'game_over', 'lobby']);
    expect(observed.slice(0, 3).flatMap(o => o.destroy),
      'game_over 반복 폴링 중 destroy 발화').toEqual([]);
    expect(observed[3].destroy, '한번더(lobby 전이) 후 정리').toEqual(['last_participant']);
  });

  it('중복 폴링에서도 destroy는 정확히 1회다 (idempotent)', async () => {
    const { host, observed } = await sweepThenPoll(['ready', 'ready', 'ready', 'lobby']);
    expect(host.calls.destroy, `총 발화 ${host.calls.destroy.length}회`).toEqual(['last_participant']);
    expect(observed[0].destroy).toEqual(['last_participant']);   // 첫 안전 상태에서 즉시
    expect(observed[1].latch, '두 번째 폴링에서 래치는 이미 소비됨').toBe(false);
  });

  it('[회귀 없음] 비진행 상태에서 마지막 1인이 되면 종전대로 같은 tick에 즉시 정리된다', async () => {
    // 래치 도입 전 동작: waiting/ready에서 2→1 전이가 관측되면 그 자리에서 destroy.
    const db = createSharedDb({ participants: seedRows(), rooms: [{ id: ROOM, status: 'ready' }] });
    await db.from('participants').delete().eq('id', 'p2');
    const host = buildFetchTerminal({ db, participants: seedRows(), status: 'ready' });
    await host.impl.fetchParticipants(ROOM);
    expect(host.calls.destroy, '비진행 상태의 즉시 정리가 사라졌다').toEqual(['last_participant']);
  });

  it('3인 방에서는 래치가 서지 않는다', async () => {
    const rows3 = [...seedRows(), { id: 'p3', room_id: ROOM, name: 'p3', is_host: false,
      choice: 'paper', is_ready: true, leave_after_round: false, created_at: '2026-08-20T10:02:00Z' }];
    const db = createSharedDb({ participants: rows3.map(r => ({ ...r })), rooms: [{ id: ROOM, status: 'result' }] });
    await db.from('participants').delete().eq('id', 'p2');   // 3 → 2
    const host = buildFetchTerminal({ db, participants: rows3, status: 'result' });
    await host.impl.fetchParticipants(ROOM);
    expect(host.state.pendingLastParticipantCleanup, '3인 방에서 래치가 섰다').toBeFalsy();
    host.state.status = 'ready';
    await host.impl.fetchParticipants(ROOM);
    expect(host.calls.destroy, '2명 남은 방을 파괴했다').toEqual([]);
  });

  it('재입장으로 data.length > 1이 되면 래치가 해제된다', async () => {
    const { host, db } = await sweepThenPoll(['result']);
    expect(host.state.pendingLastParticipantCleanup, '전제: 래치가 서 있다').toBe(true);
    // p3가 새로 들어온다
    db.tables.participants.push({ id: 'p3', room_id: ROOM, name: 'p3', is_host: false,
      choice: null, is_ready: false, leave_after_round: false, created_at: '2026-08-20T10:05:00Z' });
    host.state.status = 'ready';
    await host.impl.fetchParticipants(ROOM);
    expect(host.state.pendingLastParticipantCleanup, '재입장했는데 래치가 남았다').toBe(false);
    expect(host.calls.destroy, '사람이 들어온 방을 파괴했다').toEqual([]);
  });

  it('[소스 계약] WRPS-056/DR-14 문자열 계약이 보존된다', () => {
    expect(FETCH_CLUSTER_SRC).toMatch(/oldParticipants\.length > 1 && data\.length === 1/);
    expect(FETCH_CLUSTER_SRC).toContain('destroyRoomAndGoHome("last_participant")');
    expect(FETCH_CLUSTER_SRC, 'destroy 직전 스냅샷 반영').toContain('state.participants = data;');
    expect(FETCH_CLUSTER_SRC, '종료 중 방에는 재진입 금지').toContain('!isRoomClosingOrDestroyed()');
  });
});
