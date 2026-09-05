import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { judgePure, computePlayerStatuses, getActiveIds, PLAYER_STATUS } from '../src/game-logic.mjs';

// ════════════════════════════════════════════════════════════════════════════
// A2 — 일반 참가자 "퇴장 예약(leave after current round)" RED 재현.
//
// 요구 계약(CEO, Build37):
//   나가기 클릭 → leave_after_round=true 예약 → 현재 라운드 참가자 유지
//   → 현재 선택/판정/술래 결정에 포함 → 결과 확정·표시 완료 → 그때 participant row 삭제
//   → 다음 라운드부터 제외
//
// 현재 구현은 위 어느 단계도 없다. _doLeaveRoom()이 라운드 상태와 무관하게 곧바로
// participants를 DELETE 한다. DB에는 participants.leave_after_round 컬럼이 이미 적용돼
// 있으나(Seoul 프로브 200/false 확인) 클라이언트 참조가 0건이다.
//
// 이 파일은 production 수정 없이 그 5가지를 RED로 고정한다.
// ⚠️ 라운드 미진행(waiting/lobby)의 즉시 퇴장은 계약상 허용이므로 대조군으로 GREEN 유지한다.
// ════════════════════════════════════════════════════════════════════════════

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
function extractBlock(a, b) {
  const s = html.indexOf(a); if (s < 0) throw new Error('start marker: ' + a);
  const e = html.indexOf(b, s); if (e < 0) throw new Error('end marker: ' + b);
  return html.slice(s, e);
}
const noop = () => {};

const LEAVE_ROOM_SRC   = extractBlock('async function leaveRoom() {', 'async function leaveRoomForce() {');
// ⚠️ 시작 마커 주의: index.html의 주석이 `async function _doLeaveRoom() {` 문자열을 그대로
// 인용하고 있어(테스트가 이 마커를 쓴다는 경고 주석) 단순 indexOf는 주석을 먼저 잡는다.
// 함수 본문 첫 줄까지 포함한 구체적 마커를 쓴다.
const DO_LEAVE_SRC     = extractBlock(
  'async function _doLeaveRoom() {\n      const successorHostId = state.pendingSuccessorHostId || null;',
  '// WRPS-056(DR-14): 마지막 1인만 남은');
const ROUND_PROG_SRC   = extractBlock('function isRoundInProgressForLeave() {', '// WRPS-083 2A: ready 잠금 계산에서');
const ACTIVITY_SRC     = extractBlock('function getParticipantSignature(participants = state.participants) {',
                                      'function getNewGameRoundParticipantPatch(extra = {}) {');

/** 참가자(비host) 단말이 playing 중 나가기를 눌렀을 때의 REAL 경로를 실행한다. */
function buildEnv({ status = 'playing', myChoice = 'rock' } = {}) {
  const ME = 'p2';
  const ops = [];            // DB 연산 기록
  const calls = { goHome: 0, clearRealtime: 0, confirmPopup: 0, beginNewGameRound: 0 };

  const state = {
    currentUserId: ME, role: 'participant', status,
    roomCode: 'BYZ7', round: 3, gameRound: 5,
    nickname: 'p2',
    penalty: JSON.stringify({ text: '커피', loserCount: 1, gameRound: 5 }),
    targetLoserCount: 1, confirmedSafeIds: [], confirmedLoserIds: [],
    participants: [
      { id: 'h1', name: 'host', is_host: true,  choice: 'scissors', is_ready: true },
      { id: ME,   name: 'p2',   is_host: false, choice: myChoice,   is_ready: true },
      { id: 'p3', name: 'p3',   is_host: false, choice: 'paper',    is_ready: true },
    ],
    roomClosing: false, hostTransferInFlight: false, leavingProcessing: false,
    pendingSuccessorHostId: null, publishingRoundResult: false, finishingRound: false,
  };

  const table = (name) => ({
    delete: () => { const rec = { table: name, op: 'delete', filters: {} };
      const chain = { eq: (c, v) => { rec.filters[c] = v; return chain; },
                      then: undefined };
      ops.push(rec);
      // supabase 체인은 await 가능해야 한다
      chain.then = (res) => res({ error: null });
      return chain; },
    update: (patch) => { const rec = { table: name, op: 'update', patch, filters: {} };
      const chain = { eq: (c, v) => { rec.filters[c] = v; return chain; } };
      ops.push(rec);
      chain.then = (res) => res({ error: null });
      return chain; },
  });
  // Terminal, non-round leave now uses the canonical server exit primitive
  // rather than a client-addressed participants.delete(). Keep this small
  // harness faithful to that production contract.
  const db = {
    from: table,
    rpc: async (fn, args) => {
      ops.push({ op: 'rpc', fn, args });
      return { error: null };
    },
  };

  const factory = new Function(
    'state','db','QA','t','getOnlineMode','loadNickname','showConfirmPopup','showHostLeavePopup',
    'showNextHostPopup','clearRealtime','goHome','beginNewGameRound','isRoomClosingOrDestroyed',
    'showToast','isNonPlayingChoice','clearRoomScopedCache','onGoHome','onClearRealtime','onConfirm','onBeginNewGameRound',
    ROUND_PROG_SRC + '\n' + ACTIVITY_SRC + '\n' + LEAVE_ROOM_SRC + '\n' + DO_LEAVE_SRC + '\n' +
    'return { leaveRoom, _doLeaveRoom, isRoundInProgressForLeave, hasCurrentGameRoundActivity };'
  );

  const mod = factory(
    state, db, { emit: noop }, k => k, () => true, () => 'p2',
    async () => { calls.confirmPopup++; return true; },              // 확인 팝업 = 수락
    noop, noop,
    () => { calls.clearRealtime++; },
    () => { calls.goHome++; },
    async () => { calls.beginNewGameRound++; },
    () => false, noop, noop,
    (c) => c === '__safe__' || c === '__loser__' || c === '__waiting__',
    noop, noop, noop, noop
  );

  return { mod, state, ops, calls, ME };
}

describe('A2 — 참가자 퇴장 예약: 소스 계약', () => {
  it('[RED-2] 클라이언트에 leave_after_round 예약 write가 존재하지 않는다', () => {
    expect(html.includes('leave_after_round'),
      'participants.leave_after_round 를 읽거나 쓰는 코드가 있어야 한다').toBe(true);
  });

  it('[RED-4] 결과 확정 후 예약자를 제거하는 경로가 존재하지 않는다', () => {
    const hasProcessor =
      html.includes('processDeferredLeaves') ||
      html.includes('deferredLeave') ||
      /결과 확정[^\n]*예약자[^\n]*제거/.test(html);
    expect(hasProcessor, '예약자 정리 함수(processDeferredLeaves 등)가 있어야 한다').toBe(true);
  });

  it('전제: DB 컬럼은 이미 있고(마이그레이션 존재), 클라이언트만 비어 있다', () => {
    const mig = readFileSync(new URL('../supabase/migrations/20260806013625_participants_leave_after_round.sql', import.meta.url), 'utf8');
    expect(mig).toContain('leave_after_round');
    expect(mig).toContain('boolean not null default false');
  });
});

describe('A2 — 참가자 퇴장 예약: 동작', () => {
  it('전제: 라운드 진행 중 판정이다 (playing → isRoundInProgressForLeave true)', () => {
    const { mod } = buildEnv({ status: 'playing' });
    expect(mod.isRoundInProgressForLeave()).toBe(true);
  });

  it('[RED-1] playing 중 나가기는 participant row를 즉시 삭제하면 안 된다', async () => {
    const env = buildEnv({ status: 'playing' });
    await env.mod.leaveRoom();
    const deletes = env.ops.filter(o => o.table === 'participants' && o.op === 'delete');
    expect(deletes.length, `즉시 삭제가 ${deletes.length}건 발생했다`).toBe(0);
  });

  it('[RED-2b] playing 중 나가기는 leave_after_round=true 를 write 해야 한다', async () => {
    const env = buildEnv({ status: 'playing' });
    await env.mod.leaveRoom();
    const reserve = env.ops.filter(o =>
      o.table === 'participants' && o.op === 'update' && o.patch && o.patch.leave_after_round === true);
    expect(reserve.length, '예약 write가 없다').toBe(1);
  });

  it('[RED-3] 예약자는 현재 라운드 판정 후보에서 사라지면 안 된다', async () => {
    const env = buildEnv({ status: 'playing', myChoice: 'rock' });
    await env.mod.leaveRoom();
    // 나가기 이후 DB에 남아 있어야 할 참가자 집합을 재구성한다.
    const deletedIds = new Set(env.ops
      .filter(o => o.table === 'participants' && o.op === 'delete')
      .map(o => o.filters.id).filter(Boolean));
    const remaining = env.state.participants.filter(p => !deletedIds.has(p.id));
    const activeIds = getActiveIds(remaining, [], []);
    expect(activeIds, '예약자 p2가 판정 후보에 남아 있어야 한다').toContain(env.ME);
  });

  it('[RED-3b] 예약자의 선택이 이번 라운드 판정에 반영되어야 한다', async () => {
    const env = buildEnv({ status: 'playing', myChoice: 'rock' });
    // ⚠️ judgePure는 { id, base } 계약이다({ id, choice }를 넘기면 전부 걸러져 {}가 되어
    //    공허하게 통과한다 — 실제로 한 번 그렇게 만들었다가 잡았다).
    const toActive = rows => rows.map(p => ({ id: p.id, base: p.choice }));
    const before = judgePure(toActive(env.state.participants));
    expect(Object.keys(before).length, '공허성 가드: 판정 결과가 비어 있으면 안 된다').toBe(3);

    await env.mod.leaveRoom();
    const deletedIds = new Set(env.ops
      .filter(o => o.table === 'participants' && o.op === 'delete')
      .map(o => o.filters.id).filter(Boolean));
    const remaining = env.state.participants.filter(p => !deletedIds.has(p.id));
    const after = judgePure(toActive(remaining));
    expect(after, '나가기 전후로 이번 라운드 판정 결과가 달라지면 안 된다').toEqual(before);
  });

  it('[RED-5] 결과 확정 전에는 방을 떠나지 않는다 (goHome 즉시 호출 금지)', async () => {
    const env = buildEnv({ status: 'playing' });
    await env.mod.leaveRoom();
    expect(env.calls.goHome, '결과 확정 전 goHome이 호출됐다').toBe(0);
    expect(env.calls.clearRealtime, '결과 확정 전 realtime을 끊었다').toBe(0);
  });

  it('[대조군] waiting 상태의 즉시 퇴장은 계약상 허용이므로 종전대로 동작한다', async () => {
    const env = buildEnv({ status: 'waiting' });
    await env.mod.leaveRoom();
    const exits = env.ops.filter(o => o.op === 'rpc' && o.fn === 'exit_room_permanently');
    expect(exits.length, 'waiting에서는 canonical terminal exit이 정상').toBe(1);
    expect(env.calls.goHome).toBe(1);
  });

  it('[대조군] result 상태도 라운드 진행 중으로 취급된다', () => {
    const { mod } = buildEnv({ status: 'result' });
    expect(mod.isRoundInProgressForLeave()).toBe(true);
  });
});
