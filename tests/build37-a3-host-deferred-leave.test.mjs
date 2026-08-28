import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { judgePure } from '../src/game-logic.mjs';

// ════════════════════════════════════════════════════════════════════════════
// A3 — Host "퇴장 예약 + 승계" RED 재현.
//
// 요구 계약(CEO, Build37): 라운드 진행 중 host 나가기는
//   ① 자기 row 즉시 삭제 금지 ② leave_after_round=true 예약
//   ③ successor 정확히 1명 ④ is_host 이전 ⑤ 기존 host는 is_host=false로 라운드 끝까지 잔류
//   ⑥ 기존 host의 choice/result가 이번 라운드 판정에 계속 포함
//   ⑦ round/status/countdown/choice/result 초기화 금지
//   ⑧ successor가 progression authority 인수
//   ⑨ 결과 확정 후에만 기존 host row 제거 ⑩ 다음 라운드는 기존 host 없이 진행
//
// 현재 구현은 ③④⑦은 만족하지만 ①②⑤⑥⑨를 만족하지 못한다 —
// transferHostAndLeave / leaveRoomForce 모두 승격 직후 자기 row를 DELETE 한다.
// A2에서 확인한 것과 같은 correctness 파괴가 host에도 그대로 일어난다.
//
// production 수정 없이 RED로 고정한다. Build36의 round/status 보존 계약은 GREEN 유지.
// ════════════════════════════════════════════════════════════════════════════

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
function extractBlock(a, b) {
  const s = html.indexOf(a); if (s < 0) throw new Error('start marker: ' + a);
  const e = html.indexOf(b, s); if (e < 0) throw new Error('end marker: ' + b);
  return html.slice(s, e);
}
const noop = () => {};

const ROUND_PROG_SRC = extractBlock('function isRoundInProgressForLeave() {', '// WRPS-083 2A: ready 잠금 계산에서');
const ACTIVITY_SRC   = extractBlock('function getParticipantSignature(participants = state.participants) {',
                                    'function getNewGameRoundParticipantPatch(extra = {}) {');
const PICK_SRC       = extractBlock('function pickDeterministicHostCandidate(rows) {', 'async function promoteParticipantToHost(participantId) {');
const LEAVE_ROOM_SRC = extractBlock('async function leaveRoom() {', 'async function leaveRoomForce() {');
const FORCE_SRC      = extractBlock('async function leaveRoomForce() {', '// Build33 후속(P0-2, 실기기 BLOCKER: "호스트가 퇴장하면 진행 중 게임 및 게임방이 멈춤").');
// ⚠️ 주석이 마커 문자열을 인용하므로 본문 첫 줄까지 포함한다(A2에서 겪은 함정).
const DO_LEAVE_SRC   = extractBlock(
  'async function _doLeaveRoom() {\n      const successorHostId = state.pendingSuccessorHostId || null;',
  '// WRPS-056(DR-14): 마지막 1인만 남은');
const TRANSFER_SRC   = extractBlock('async function transferHostAndLeave(newHostId) {', 'async function becomeNextHost() {');

const OLD_HOST = 'h1', P2 = 'p2', P3 = 'p3';

function buildEnv({ status = 'playing', path = 'transfer' } = {}) {
  const ops = [];
  const calls = { goHome: 0, clearRealtime: 0, beginNewGameRound: [], promoted: [], verifyExactlyOneHost: [] };

  // DB 참가자 테이블을 모델링한다 — 승격/삭제가 실제로 반영되어야 invariant를 볼 수 있다.
  let dbRows = [
    { id: OLD_HOST, name: 'host', is_host: true,  choice: 'scissors', is_ready: true, created_at: '2026-08-20T10:00:00Z' },
    { id: P2,       name: 'p2',   is_host: false, choice: 'rock',     is_ready: true, created_at: '2026-08-20T10:01:00Z' },
    { id: P3,       name: 'p3',   is_host: false, choice: 'paper',    is_ready: true, created_at: '2026-08-20T10:02:00Z' },
  ];

  const state = {
    currentUserId: OLD_HOST, role: 'host', status,
    roomCode: 'BYZ7', round: 3, gameRound: 5, nickname: 'host',
    penalty: JSON.stringify({ text: '커피', loserCount: 1, gameRound: 5 }),
    targetLoserCount: 1, confirmedSafeIds: [], confirmedLoserIds: [],
    participants: dbRows.map(r => ({ ...r })),
    roomClosing: false, hostTransferInFlight: false, leavingProcessing: false,
    pendingSuccessorHostId: null, publishingRoundResult: false, finishingRound: false,
  };

  // 실제 PostgREST 계약 모델링(JP-BL-027): .select() 를 붙이면 영향받은 행이 돌아오고,
  // 대상이 없으면 오류가 아니라 빈 배열이다. dbRows 를 기준으로 필터를 실제 평가한다.
  const matchDbRows = (rec) => {
    if (rec.table !== 'participants') return [{ id: state.roomCode }];
    return dbRows.filter(r => Object.entries(rec.filters).every(([c, v]) => r[c] === v));
  };
  const mkChain = (rec) => {
    const chain = { eq: (c, v) => { rec.filters[c] = v; return chain; },
                    in: (c, v) => { rec.filters[c] = v; return chain; },
                    select: () => ({ then: (res) => res({
                      data: matchDbRows(rec).map(r => ({ ...r, ...(rec.patch || {}) })), error: null }) }),
                    then: (res) => res({ error: null, data: null }) };
    return chain;
  };
  const db = { from: (table) => ({
    delete: () => { const rec = { table, op: 'delete', filters: {} }; ops.push(rec);
      const chain = mkChain(rec);
      const orig = chain.then;
      chain.then = (res) => { // 삭제를 DB 모델에 반영
        if (table === 'participants') {
          if (rec.filters.id) dbRows = dbRows.filter(r => r.id !== rec.filters.id);
          else if (rec.filters.name) dbRows = dbRows.filter(r => r.name !== rec.filters.name);
        }
        return orig(res);
      };
      return chain; },
    update: (patch) => { const rec = { table, op: 'update', patch, filters: {} }; ops.push(rec);
      const chain = mkChain(rec);
      const orig = chain.then;
      chain.then = (res) => {
        if (table === 'participants' && rec.filters.id) {
          dbRows = dbRows.map(r => r.id === rec.filters.id ? { ...r, ...patch } : r);
        }
        return orig(res);
      };
      return chain; },
    select: () => mkChain({ table, op: 'select', filters: {} }),
  }) };

  const factory = new Function(
    'state','db','QA','t','getOnlineMode','loadNickname','showConfirmPopup','showHostLeavePopup',
    'showNextHostPopup','closeNextHostPopup','clearRealtime','goHome','beginNewGameRound',
    'isRoomClosingOrDestroyed','showToast','promoteParticipantToHost','verifyExactlyOneHost',
    'getGameRound','isNonPlayingChoice',
    ROUND_PROG_SRC + '\n' + ACTIVITY_SRC + '\n' + PICK_SRC + '\n' +
    LEAVE_ROOM_SRC + '\n' + FORCE_SRC + '\n' + DO_LEAVE_SRC + '\n' + TRANSFER_SRC + '\n' +
    'return { leaveRoom, leaveRoomForce, transferHostAndLeave, _doLeaveRoom, ' +
    'isRoundInProgressForLeave, pickDeterministicHostCandidate };'
  );

  const mod = factory(
    state, db, { emit: noop }, k => k, () => true, () => 'host',
    async () => true, noop, noop, noop,
    () => { calls.clearRealtime++; },
    () => { calls.goHome++; },
    async (o) => { calls.beginNewGameRound.push(o); },
    () => false, noop,
    async (id) => { calls.promoted.push(id);
      dbRows = dbRows.map(r => ({ ...r, is_host: r.id === id ? true : (r.id === OLD_HOST ? false : r.is_host) }));
      return true; },
    async (room, preferred) => { calls.verifyExactlyOneHost.push({ room, preferred }); },
    () => state.gameRound,
    (c) => c === '__safe__' || c === '__loser__' || c === '__waiting__'
  );

  const run = () => path === 'transfer' ? mod.transferHostAndLeave(P2) : mod.leaveRoomForce();
  return { mod, state, ops, calls, run, rows: () => dbRows };
}

describe('A3 — Host 퇴장 예약: 소스 계약', () => {
  it('[RED→GREEN] host 두 경로 모두 예약 write에 도달한다', () => {
    // 문자열 존재만 보지 않고 호출 사슬을 확인한다: host 경로 → reserveDeferredLeave →
    // participants.update({leave_after_round:true}). 어느 고리가 끊겨도 실패한다.
    const transferSrc = extractBlock('async function transferHostAndLeave(newHostId) {', 'async function becomeNextHost() {');
    const doLeaveSrc = extractBlock(
      'async function _doLeaveRoom() {\n      const successorHostId = state.pendingSuccessorHostId || null;',
      '// WRPS-056(DR-14): 마지막 1인만 남은');
    // leaveRoomForce는 _doLeaveRoom을 통해 예약에 도달한다.
    const forceSrc = extractBlock('async function leaveRoomForce() {', '// Build33 후속(P0-2, 실기기 BLOCKER: "호스트가 퇴장하면 진행 중 게임 및 게임방이 멈춤").');
    expect(forceSrc, 'force 경로가 _doLeaveRoom을 거쳐야 한다').toContain('_doLeaveRoom()');
    expect(doLeaveSrc, '_doLeaveRoom이 진행 중이면 예약해야 한다').toContain('await reserveDeferredLeave();');
    expect(transferSrc, 'transfer 경로가 직접 예약해야 한다').toContain('await reserveDeferredLeave();');
    // 사슬의 끝 — 실제 컬럼 write
    const reserveSrc = extractBlock('async function reserveDeferredLeave() {', 'async function processDeferredLeaves() {');
    expect(reserveSrc).toContain("update({ leave_after_round: true })");
  });

  it('[RED] 결과 확정 후 예약된 host를 정리하는 경로가 없다', () => {
    expect(html.includes('processDeferredLeaves') || html.includes('deferredLeave'),
      '예약자 정리 함수가 있어야 한다').toBe(true);
  });

  it('전제: leaveRoom은 playing + 비host 존재 시 successor 선택 팝업으로 분기한다', () => {
    expect(LEAVE_ROOM_SRC).toContain('if (!isRoundInProgressForLeave()) {');
    expect(LEAVE_ROOM_SRC).toContain('showNextHostPopup();');
  });
});

for (const path of ['transfer', 'force']) {
  describe(`A3 — Host 퇴장 예약: 동작 (${path === 'transfer' ? 'transferHostAndLeave' : 'leaveRoomForce'})`, () => {
    it('[GREEN 유지] successor가 정확히 1명 선정되고 is_host가 이전된다', async () => {
      const env = buildEnv({ path });
      await env.run();
      expect(env.calls.promoted, 'successor 승격 1회').toEqual([P2]);
      const hosts = env.rows().filter(r => r.is_host);
      expect(hosts.length, 'host는 정확히 1명').toBe(1);
      expect(hosts[0].id).toBe(P2);
    });

    it('[GREEN 유지] Build36 계약 — round/status를 초기화하지 않는다', async () => {
      const env = buildEnv({ path });
      await env.run();
      expect(env.calls.beginNewGameRound, '진행 중 게임을 리셋하면 안 된다').toEqual([]);
      expect(env.state.round, 'round 되감기 없음').toBe(3);
      const roomWrites = env.ops.filter(o => o.table === 'rooms' && o.op === 'update');
      expect(roomWrites, 'rooms.status를 waiting으로 되돌리면 안 된다').toEqual([]);
    });

    it('[RED-1] 기존 host의 participant row를 즉시 삭제하면 안 된다', async () => {
      const env = buildEnv({ path });
      await env.run();
      const stillThere = env.rows().some(r => r.id === OLD_HOST);
      expect(stillThere, '기존 host row가 즉시 삭제됐다').toBe(true);
    });

    it('[RED-2] leave_after_round=true 예약 write가 있어야 한다', async () => {
      const env = buildEnv({ path });
      await env.run();
      const reserve = env.ops.filter(o =>
        o.table === 'participants' && o.op === 'update' && o.patch && o.patch.leave_after_round === true);
      expect(reserve.length, '예약 write가 없다').toBe(1);
    });

    it('[RED-5] 기존 host는 is_host=false 로 라운드 끝까지 잔류해야 한다', async () => {
      const env = buildEnv({ path });
      await env.run();
      const old = env.rows().find(r => r.id === OLD_HOST);
      expect(old, '기존 host가 참가자 목록에서 사라졌다').toBeTruthy();
      expect(old && old.is_host, '권한은 넘기되 참가자로는 남아야 한다').toBe(false);
    });

    it('[RED-6] 기존 host의 선택이 이번 라운드 판정에 계속 포함되어야 한다', async () => {
      const env = buildEnv({ path });
      const toActive = rows => rows.map(r => ({ id: r.id, base: r.choice }));
      const before = judgePure(toActive(env.rows()));
      expect(Object.keys(before).length, '공허성 가드').toBe(3);
      await env.run();
      const after = judgePure(toActive(env.rows()));
      expect(after, '나가기 전후로 이번 라운드 판정이 달라지면 안 된다').toEqual(before);
    });

    it('[RED-9] 결과 확정 전에 방을 떠나면 안 된다', async () => {
      const env = buildEnv({ path });
      await env.run();
      expect(env.calls.goHome, '결과 확정 전 goHome 호출').toBe(0);
      expect(env.calls.clearRealtime, '결과 확정 전 realtime 해제').toBe(0);
    });
  });
}

describe('A3 — 대조군: 라운드 미진행 시 즉시 퇴장 (계약상 허용)', () => {
  for (const status of ['waiting', 'lobby']) {
    it(`[대조군] ${status}에서 host 나가기는 successor 지정 후 즉시 퇴장한다`, async () => {
      const env = buildEnv({ status, path: 'force' });
      await env.run();
      expect(env.calls.promoted, 'successor 승격은 유지').toEqual([P2]);
      expect(env.rows().some(r => r.id === OLD_HOST), '즉시 퇴장이 정상').toBe(false);
      expect(env.calls.goHome, 'goHome 호출이 정상').toBe(1);
      const hosts = env.rows().filter(r => r.is_host);
      expect(hosts.length, 'host exactly one 유지').toBe(1);
      expect(hosts[0].id).toBe(P2);
    });
  }
});
