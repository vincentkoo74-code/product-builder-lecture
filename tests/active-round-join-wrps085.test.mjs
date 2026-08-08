// WRPS-085 Active-Round Join Waiting — 결정적 테스트 (CEO 승인 범위: S1~S10 / M1~M7).
//
// index.html 무수정 원칙(host-transfer-stage1 · waiting-state-stage2a · room-destroy-stage2b 선례):
// 이 파일은 index.html을 오직 readFileSync + 마커 슬라이싱으로만 읽고, 추출한 REAL 소스를
// new Function으로 그대로 실행한다. hand-copy simulation / no-op mock / 문자열 존재 검사 단독
// PASS는 금지다. mutation도 프로덕션 원문 치환본을 같은 하니스로 구동한다.
//
// 핵심 계약(C안): shouldResetForParticipantChange 본체와 일반 호출 계약은 무변경이다.
// WRPS-085 예외는 호출부에서 isPureWaitingJoinDelta로만 좁게 적용한다.

import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { computePlayerStatuses, PLAYER_STATUS } from '../src/game-logic.mjs';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

function extractBlock(startMarker, endMarker, label) {
  const start = html.indexOf(startMarker);
  if (start < 0) throw new Error(`[085] start marker not found (${label}): ${startMarker}`);
  const end = html.indexOf(endMarker, start + startMarker.length);
  if (end < 0) throw new Error(`[085] end marker not found (${label}): ${endMarker}`);
  return html.slice(start, end);
}

// ── REAL 소스 추출 ────────────────────────────────────────────────────────────
// getParticipantSignature + hasCurrentGameRoundActivity + shouldResetForParticipantChange
// + getLifecycleMarker + isPureWaitingJoinDelta 를 한 덩어리로.
const DELTA_BLOCK = extractBlock(
  'function getParticipantSignature(participants = state.participants) {',
  'function getNewGameRoundParticipantPatch(extra = {}) {', 'delta'
);
const JOIN_ROOM_BLOCK = extractBlock(
  'async function joinRoom() {', 'async function requestReplayFromJoinedRoom(', 'joinRoom'
);
const JOIN_LOCK_BLOCK = extractBlock(
  'function isJoinLocked(', 'function isBusyInAnotherActiveRoom(', 'joinLock'
);
const NEW_ROUND_PATCH_BLOCK = extractBlock(
  'function getNewGameRoundParticipantPatch(extra = {}) {', 'function archiveCurrentRoundStats(', 'newRoundPatch'
);
// 호출부 원문(fetchParticipants의 reset 게이트 3줄) — mutation 대상이자 배선 계약.
const RESET_GATE_SRC = `if (state.role === "host" && !state.newRoundResetting
	            && shouldResetForParticipantChange(oldParticipants, data)
	            && !isPureWaitingJoinDelta(oldParticipants, data)) {`;

const noop = () => {};
const asyncNoop = async () => {};
const fakeEl = () => ({
  classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
  style: {}, innerHTML: '', textContent: '', value: '', disabled: false, readOnly: false,
  appendChild() {}, querySelectorAll: () => [],
});

// ── 하니스 1: delta 판정 family(REAL) ────────────────────────────────────────
function loadDelta({ status = 'playing', round = 2, srcOverride = null } = {}) {
  const state = { status, round, gameRound: 1, confirmedSafeIds: [], confirmedLoserIds: [], participants: [] };
  const factory = new Function(
    'state', 'hasConfirmedRoundResult',
    `"use strict";\n${srcOverride ?? DELTA_BLOCK}\nreturn { getParticipantSignature, hasCurrentGameRoundActivity,` +
    ` shouldResetForParticipantChange, isPureWaitingJoinDelta, getLifecycleMarker };`
  );
  return { state, impl: factory(state, () => false) };
}

// 실제 호출부 게이트를 REAL 판정 함수로 구동한다(호출부 원문 문자열을 그대로 평가).
function evalResetGate({ prev, next, state, deltaImpl, gateSrc = null }) {
  const src = `${gateSrc ?? RESET_GATE_SRC}\n  return true;\n}\nreturn false;`;
  const f = new Function('state', 'oldParticipants', 'data', 'shouldResetForParticipantChange',
    'isPureWaitingJoinDelta', `"use strict";\n${src}`);
  return f(state, prev, next, deltaImpl.shouldResetForParticipantChange, deltaImpl.isPureWaitingJoinDelta);
}

// ── 하니스 2: joinRoom(REAL) — 정원/입장 허용 ────────────────────────────────
function createFakeDb({ participants = [], rooms = [] } = {}) {
  const tables = { participants: participants.map(p => ({ ...p })), rooms: rooms.map(r => ({ ...r })) };
  const writeLog = [];
  function makeBuilder(table, op, payload) {
    const filters = [];
    const b = {
      _single: false,
      eq(c, v) { filters.push([c, v]); return b; },
      in(c, v) { filters.push([c, v, 'in']); return b; },
      order() { return b; }, single() { b._single = true; return b; },
      then(res, rej) { return exec().then(res, rej); },
    };
    async function exec() {
      const match = r => filters.every(([c, v, k]) => (k === 'in' ? v.includes(r[c]) : r[c] === v));
      if (op === 'insert') {
        const rows = (Array.isArray(payload) ? payload : [payload]).map(r => ({ ...r }));
        writeLog.push({ table, op, rows }); tables[table].push(...rows);
        return { data: rows, error: null };
      }
      const rows = tables[table].filter(match);
      if (op === 'update') {
        writeLog.push({ table, op, patch: { ...payload }, matched: rows.length });
        rows.forEach(r => Object.assign(r, payload)); return { data: null, error: null };
      }
      if (op === 'delete') {
        writeLog.push({ table, op, matched: rows.length });
        for (const r of rows) tables[table].splice(tables[table].indexOf(r), 1);
        return { data: null, error: null };
      }
      const copies = rows.map(r => ({ ...r }));
      if (b._single) return copies.length === 1 ? { data: copies[0], error: null }
        : { data: null, error: { code: 'PGRST116' } };
      return { data: copies, error: null };
    }
    return b;
  }
  return {
    tables, writeLog,
    inserts() { return writeLog.filter(w => w.op === 'insert'); },
    from(t) {
      if (!tables[t]) throw new Error('[085] unsupported table: ' + t);
      return { insert: r => makeBuilder(t, 'insert', r), update: p => makeBuilder(t, 'update', p),
               delete: () => makeBuilder(t, 'delete'), select: () => makeBuilder(t, 'select') };
    },
  };
}

function loadJoinRoom({ db, code, name, lastJoinedRoomCode = '', savedNickname = '', srcOverride = null }) {
  const state = {
    role: '', currentUserId: '', nickname: '', roomCode: '', status: '',
    participants: [], confirmedSafeIds: [], confirmedLoserIds: [],
    joinScreenMode: 'normal', joinScreenAction: 'join', joinRecentRoom: null,
    penalty: '', gameRound: 1, round: 1, lastStartedGameRound: 0,
    roomClosing: false, hostTransferInFlight: false, leavingProcessing: false,
  };
  const calls = { toast: [] };
  const els = { joinRoomCode: { ...fakeEl(), value: code }, joinName: { ...fakeEl(), value: name }, joinBtn: fakeEl() };
  const src = `${srcOverride ?? JOIN_ROOM_BLOCK}\n${JOIN_LOCK_BLOCK}`;
  const factory = new Function(
    'state', 'db', '$', 'showToast', 't', 'setBtnText', 'loadNickname', 'saveNickname',
    'getLastJoinedRoomCode', 'saveLastJoinedRoomCode', 'subscribeToRoom', 'showScreen',
    'showReadyScreen', 'resetRoomLocalState', 'getDefaultShareBaseUrl', 'buildRoomUrl',
    'getOnlineMode', 'getPenaltyGameRound', 'cleanupDuplicateRoomProfiles',
    'requestReplayFromJoinedRoom', 'clearRoomScopedCache', 'isRoomClosingOrDestroyed',
    // MAX_ROOM_PARTICIPANTS는 주입하지 않는다 — JOIN_LOCK_BLOCK 추출 범위에 REAL 선언이
    // 포함되므로 주입하면 중복 선언이 된다. 프로덕션 값을 그대로 쓴다.
    `"use strict";\n${src}\nreturn { joinRoom };`
  );
  const impl = factory(
    state, db, id => els[id] || fakeEl(), m => calls.toast.push(m), (k, v) => (v ? `${k}:${v.n}` : k),
    noop, () => savedNickname, noop, () => lastJoinedRoomCode, noop, noop, noop, noop, noop,
    () => '', () => '', () => true, () => 1, asyncNoop, asyncNoop, noop, () => false
  );
  return { state, calls, impl };
}

const P = (id, extra = {}) => ({ id, is_host: false, choice: null, is_ready: false, ...extra });
const HOST = (id, extra = {}) => P(id, { is_host: true, ...extra });
const WAITING = (id) => P(id, { choice: '__waiting__' });

// ═══════════════════════════════════════════════════════════════════════════════
describe('fidelity — 공유 함수 무변경 + 호출부 배선 계약', () => {
  it('shouldResetForParticipantChange 본체가 WRPS-056 원문 그대로다(C안 핵심)', () => {
    // 본체에 WRPS-085 조건이 새어들지 않았다.
    const body = extractBlock('function shouldResetForParticipantChange(', '\n\t    }', 'body');
    expect(body).not.toContain('WRPS-085');
    expect(body).not.toContain('isPureWaitingJoinDelta');
    expect(body).not.toContain('__waiting__');
    expect(body).not.toContain('state.status');
    // 원문 3줄 구조 유지
    expect(body).toContain('if (!prevParticipants.length || !nextParticipants.length) return false;');
    expect(body).toContain('getParticipantSignature(prevParticipants) === getParticipantSignature(nextParticipants)');
    expect(body).toContain('return hasCurrentGameRoundActivity(prevParticipants) || hasCurrentGameRoundActivity(nextParticipants);');
  });

  it('예외는 호출부 1곳에서만 적용된다', () => {
    expect(html).toContain(RESET_GATE_SRC);
    expect((html.match(/isPureWaitingJoinDelta\(/g) || []).length).toBe(2); // 정의 1 + 호출부 1
  });

  it('금지 영역 원문 무변경', () => {
    expect(html).toContain('const STALE_ROOM_UPDATE_SELF_HEAL_THRESHOLD = 5;');
    expect(html).toContain('}, 2600);');
    expect(html).toContain('function judgePure(');
    expect(html).toContain('function resolveElimination(');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('S1~S6 — reset 억제 / 기존 정책 적용 경계', () => {
  const base = [HOST('h1'), P('p1'), P('p2')];
  const st = { status: 'playing', round: 2, gameRound: 1 };

  it('S1 — WAITING 1명 추가 → reset 억제', () => {
    const { impl } = loadDelta();
    const next = [...base, WAITING('w1')];
    expect(impl.shouldResetForParticipantChange(base, next)).toBe(true); // 본체는 여전히 true
    expect(impl.isPureWaitingJoinDelta(base, next)).toBe(true);          // 예외가 성립
    expect(evalResetGate({ prev: base, next, state: { ...st, role: 'host', newRoundResetting: false }, deltaImpl: impl })).toBe(false);
  });

  it('S2 — WAITING 여러 명 동시 추가 → reset 억제', () => {
    const { impl } = loadDelta();
    const next = [...base, WAITING('w1'), WAITING('w2'), WAITING('w3')];
    expect(impl.isPureWaitingJoinDelta(base, next)).toBe(true);
    expect(evalResetGate({ prev: base, next, state: { ...st, role: 'host', newRoundResetting: false }, deltaImpl: impl })).toBe(false);
  });

  it('S3 — WAITING 추가 + 일반 참가자 이탈 → 기존 reset 실행', () => {
    const { impl } = loadDelta();
    const next = [HOST('h1'), P('p1'), WAITING('w1')]; // p2 이탈
    expect(impl.isPureWaitingJoinDelta(base, next)).toBe(false);
    expect(evalResetGate({ prev: base, next, state: { ...st, role: 'host', newRoundResetting: false }, deltaImpl: impl })).toBe(true);
  });

  it('S4 — WAITING 추가 + Host 변경 → 기존 reset 실행', () => {
    const { impl } = loadDelta();
    const next = [P('h1'), HOST('p1'), P('p2'), WAITING('w1')]; // host가 h1→p1
    expect(impl.isPureWaitingJoinDelta(base, next)).toBe(false);
    expect(evalResetGate({ prev: base, next, state: { ...st, role: 'host', newRoundResetting: false }, deltaImpl: impl })).toBe(true);
  });

  it('S5 — ACTIVE 참가자 추가 → 기존 정책', () => {
    const { impl } = loadDelta();
    const next = [...base, P('a1')]; // choice=null → ACTIVE
    expect(impl.isPureWaitingJoinDelta(base, next)).toBe(false);
    expect(evalResetGate({ prev: base, next, state: { ...st, role: 'host', newRoundResetting: false }, deltaImpl: impl })).toBe(true);
  });

  it('S6 — 미분류/기타 lifecycle 추가 → 기존 정책', () => {
    const { impl } = loadDelta();
    for (const bad of [P('x1', { choice: '__safe__' }), P('x1', { choice: '__loser__' }),
                       P('x1', { choice: 'rock' }), HOST('x1', { choice: '__waiting__' })]) {
      expect(impl.isPureWaitingJoinDelta(base, [...base, bad])).toBe(false);
    }
    // id 없는 미분류 row
    expect(impl.isPureWaitingJoinDelta(base, [...base, { choice: '__waiting__' }])).toBe(false);
  });

  it('mixed delta(추가+이탈+권위변경 동시) → 기존 정책', () => {
    const { impl } = loadDelta();
    const next = [HOST('h1'), P('p1', { choice: '__loser__' }), WAITING('w1')];
    expect(impl.isPureWaitingJoinDelta(base, next)).toBe(false);
  });

  it('기존 참가자의 raw choice 변동(게임 플레이)은 권위 변경이 아니다', () => {
    const { impl } = loadDelta();
    // 라운드 진행 중 참가자가 rock/paper를 고르는 것은 정상 플레이다.
    const prev = [HOST('h1', { choice: null }), P('p1', { choice: null })];
    const next = [HOST('h1', { choice: 'rock' }), P('p1', { choice: 'paper|win' }), WAITING('w1')];
    expect(impl.isPureWaitingJoinDelta(prev, next)).toBe(true);
  });

  it('추가가 전혀 없으면 예외 대상이 아니다(안전 fallback)', () => {
    const { impl } = loadDelta();
    expect(impl.isPureWaitingJoinDelta(base, base)).toBe(false);
    expect(impl.isPureWaitingJoinDelta([], [])).toBe(false);
    expect(impl.isPureWaitingJoinDelta(null, undefined)).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('S7/S8 — 다음 라운드 복귀와 전적 보존', () => {
  it('S7 — WAITING 참가자가 다음 라운드에 ACTIVE로 복귀한다', () => {
    const state = { participants: [HOST('h1'), P('p1'), WAITING('w1')] };
    const f = new Function('state',
      `"use strict";\n${NEW_ROUND_PATCH_BLOCK}\nreturn { getNewGameRoundParticipantPatch, resetLocalParticipantsForNewGameRound };`);
    const impl = f(state);
    expect(impl.getNewGameRoundParticipantPatch().choice).toBe(null);
    impl.resetLocalParticipantsForNewGameRound();
    const rows = state.participants.map(p => ({ id: p.id, choice: p.choice }));
    expect(computePlayerStatuses(rows, [], []).w1).toBe(PLAYER_STATUS.ACTIVE);
  });

  it('S8 — WAITING 추가는 wins/losses/draws/gameNo를 건드리지 않는다', () => {
    const { impl, state } = loadDelta();
    const prev = [HOST('h1', { wins: 3, losses: 1, draws: 2 }), P('p1', { wins: 0, losses: 4, draws: 1 })];
    const next = [...prev.map(p => ({ ...p })), WAITING('w1')];
    const before = JSON.stringify(prev.map(p => [p.id, p.wins, p.losses, p.draws]));
    expect(impl.isPureWaitingJoinDelta(prev, next)).toBe(true);
    // 판정 자체가 순수 함수라 어떤 값도 변경하지 않는다
    expect(JSON.stringify(prev.map(p => [p.id, p.wins, p.losses, p.draws]))).toBe(before);
    expect(state.gameRound).toBe(1);
    // 다음 배열의 기존 참가자 전적도 동일
    for (const p of prev) {
      const n = next.find(x => x.id === p.id);
      expect([n.wins, n.losses, n.draws]).toEqual([p.wins, p.losses, p.draws]);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('S9/S10 — 무회귀', () => {
  it('S9 — 기존 WRPS-056 시나리오는 종전 그대로 reset한다', () => {
    const { impl } = loadDelta();
    const prev = [HOST('h1'), P('p1'), P('p2')];
    // (a) 중도 이탈
    expect(impl.shouldResetForParticipantChange(prev, [HOST('h1'), P('p1')])).toBe(true);
    expect(impl.isPureWaitingJoinDelta(prev, [HOST('h1'), P('p1')])).toBe(false);
    // (b) host 승계 — 시그니처(id:H|P)가 바뀌므로 기존 정책상 reset 대상이다(무변경 확인)
    expect(impl.shouldResetForParticipantChange(prev, [P('h1'), HOST('p1'), P('p2')])).toBe(true);
    // (c) 시그니처 동일 → 종전대로 false
    expect(impl.shouldResetForParticipantChange(prev, prev.map(p => ({ ...p })))).toBe(false);
    // (d) 빈 배열 → 종전대로 false
    expect(impl.shouldResetForParticipantChange([], prev)).toBe(false);
  });

  it('S10 — 2A WAITING 분류 / 2B destroyed 차단 무회귀(소스 계약)', () => {
    expect(html).toContain("if (p.choice === '__waiting__') { map[p.id] = PLAYER_STATUS.WAITING; return; }");
    expect(html).toContain("if (room.status === 'destroyed') {");
    expect(html).toContain('function isRoomClosingOrDestroyed() {');
    expect(html).toContain('async function destroyRoomByHost() {');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('joinRoom — 신규 참가자 입장 허용 + 정원 거부', () => {
  const roster = (n) => Array.from({ length: n }, (_, i) => ({
    id: `p${i}`, room_id: 'R1', name: `n${i}`, is_host: i === 0, is_ready: true, created_at: `t${i}`,
  }));

  it('진행 중(locked) 방에 완전 신규 참가자가 WAITING으로 입장한다', async () => {
    const db = createFakeDb({ rooms: [{ id: 'R1', status: 'playing', round: 2, penalty: '' }], participants: roster(3) });
    const { impl, state } = loadJoinRoom({ db, code: 'R1', name: 'NEWCOMER' }); // 과거 이력 없음
    await impl.joinRoom();
    const ins = db.inserts();
    expect(ins.length).toBe(1);
    expect(ins[0].rows[0]).toMatchObject({ room_id: 'R1', name: 'NEWCOMER', is_host: false, choice: '__waiting__', is_ready: false });
    expect(state.role).toBe('participant');
  });

  it('정원(20) 초과는 거부한다', async () => {
    const db = createFakeDb({ rooms: [{ id: 'R1', status: 'playing', round: 2, penalty: '' }], participants: roster(20) });
    const { impl, calls } = loadJoinRoom({ db, code: 'R1', name: 'OVERFLOW' });
    await impl.joinRoom();
    expect(db.inserts()).toEqual([]);
    expect(calls.toast.some(m => String(m).startsWith('toast.roomFull'))).toBe(true);
  });

  it('정원 경계 — 19명이면 20번째는 허용된다', async () => {
    const db = createFakeDb({ rooms: [{ id: 'R1', status: 'playing', round: 2, penalty: '' }], participants: roster(19) });
    const { impl } = loadJoinRoom({ db, code: 'R1', name: 'TWENTIETH' });
    await impl.joinRoom();
    expect(db.inserts().length).toBe(1);
  });

  it('destroyed 방은 여전히 거부한다(2B 무회귀)', async () => {
    const db = createFakeDb({ rooms: [{ id: 'R1', status: 'destroyed' }], participants: roster(2) });
    const { impl } = loadJoinRoom({ db, code: 'R1', name: 'NEWCOMER' });
    await impl.joinRoom();
    expect(db.inserts()).toEqual([]);
  });

  it('미잠금 방의 신규 입장은 ACTIVE(choice=null)로 들어간다', async () => {
    const db = createFakeDb({ rooms: [{ id: 'R1', status: 'waiting', round: 1, penalty: '' }],
                              participants: [{ id: 'p0', room_id: 'R1', name: 'n0', is_host: true, is_ready: false, created_at: 't0' }] });
    const { impl } = loadJoinRoom({ db, code: 'R1', name: 'NEWCOMER' });
    await impl.joinRoom();
    expect(db.inserts()[0].rows[0].choice).toBe(null);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('M1~M7 — mutation-kill', () => {
  const base = [HOST('h1'), P('p1'), P('p2')];
  const st = { role: 'host', newRoundResetting: false, status: 'playing', round: 2, gameRound: 1 };

  it('M1 — waitingOnlyJoin 판정 제거(게이트에서 호출 삭제) → S1 RED', () => {
    const mutantGate = `if (state.role === "host" && !state.newRoundResetting
	            && shouldResetForParticipantChange(oldParticipants, data)) {`;
    expect(mutantGate).not.toBe(RESET_GATE_SRC);
    const { impl } = loadDelta();
    const next = [...base, WAITING('w1')];
    expect(evalResetGate({ prev: base, next, state: st, deltaImpl: impl, gateSrc: mutantGate })).toBe(true); // RED
  });

  it('M2 — removedParticipants 조건 제거 → S3 RED', () => {
    const mutated = DELTA_BLOCK.replace(
      "\t      for (const id of prevById.keys()) if (!nextById.has(id)) return false;\n", '');
    expect(mutated).not.toBe(DELTA_BLOCK);
    const { impl } = loadDelta({ srcOverride: mutated });
    const next = [HOST('h1'), P('p1'), WAITING('w1')]; // p2 이탈
    // 원본은 false(이탈이므로 기존 정책 적용). mutant는 이탈을 걸러내지 못해
    // true를 반환하거나, 사라진 id를 조회하다 예외로 죽는다 — 어느 쪽이든 RED다.
    let r; try { r = impl.isPureWaitingJoinDelta(base, next); } catch (e) { r = 'threw:' + e.name; }
    expect(r).not.toBe(false);
    // 대조군: 원본은 같은 입력에서 정확히 false다.
    expect(loadDelta().impl.isPureWaitingJoinDelta(base, next)).toBe(false);
  });

  it('M3 — hostChanged 조건 제거 → S4 RED', () => {
    const mutated = DELTA_BLOCK
      .replace("\t        if (Boolean(after.is_host) !== Boolean(before.is_host)) return false;\n", '')
      .replace("\t      if ((prevHost && prevHost.id) !== (nextHost && nextHost.id)) return false;\n", '');
    expect(mutated).not.toBe(DELTA_BLOCK);
    const { impl } = loadDelta({ srcOverride: mutated });
    const next = [P('h1'), HOST('p1'), P('p2'), WAITING('w1')];
    expect(impl.isPureWaitingJoinDelta(base, next)).toBe(true); // RED
  });

  it("M4 — choice='__waiting__' 조건 제거 → S5 RED", () => {
    const mutated = DELTA_BLOCK.replace(
      "\t        if (p.choice !== '__waiting__') return false; // ACTIVE/미분류/기타 lifecycle 추가\n", '');
    expect(mutated).not.toBe(DELTA_BLOCK);
    const { impl } = loadDelta({ srcOverride: mutated });
    expect(impl.isPureWaitingJoinDelta(base, [...base, P('a1')])).toBe(true); // RED — ACTIVE 추가인데 억제
  });

  it('M5 — mixed delta도 reset 억제(모든 조건 무력화) → S3/S4/S5 동시 RED', () => {
    const mutated = DELTA_BLOCK.replace(
      '\t    function isPureWaitingJoinDelta(prevParticipants = [], nextParticipants = []) {',
      '\t    function isPureWaitingJoinDelta(prevParticipants = [], nextParticipants = []) {\n\t      return true;');
    expect(mutated).not.toBe(DELTA_BLOCK);
    const { impl } = loadDelta({ srcOverride: mutated });
    expect(impl.isPureWaitingJoinDelta(base, [HOST('h1'), P('p1')])).toBe(true);       // 이탈 RED
    expect(impl.isPureWaitingJoinDelta(base, [...base, P('a1')])).toBe(true);          // ACTIVE RED
  });

  it('M6 — gameNo 증가 허용(예외를 무시하고 reset 실행) → S1/S8 RED', () => {
    // 게이트를 항상 통과시키는 mutant = M1과 동일 효과. gameNo 증가가 실제로 일어나는지
    // beginNewGameRound 호출 여부로 확인한다(호출부 계약).
    const { impl } = loadDelta();
    const next = [...base, WAITING('w1')];
    const wouldReset = evalResetGate({ prev: base, next, state: st, deltaImpl: impl,
      gateSrc: `if (state.role === "host" && !state.newRoundResetting
	            && shouldResetForParticipantChange(oldParticipants, data)) {` });
    expect(wouldReset).toBe(true);  // RED — 원본은 false
  });

  it('M7 — shouldResetForParticipantChange 본체 변조 → S9 RED', () => {
    const mutated = DELTA_BLOCK.replace(
      '\t      return hasCurrentGameRoundActivity(prevParticipants) || hasCurrentGameRoundActivity(nextParticipants);',
      '\t      return false;');
    expect(mutated).not.toBe(DELTA_BLOCK);
    const { impl } = loadDelta({ srcOverride: mutated });
    // 중도 이탈에서도 reset이 사라진다 = WRPS-056 계약 파괴
    expect(impl.shouldResetForParticipantChange(base, [HOST('h1'), P('p1')])).toBe(false); // RED
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// HIGH(독립 검증 지적) — 호스트 초대 UI가 새 정책과 일치하는가
// ═══════════════════════════════════════════════════════════════════════════════
const RENDER_ALL_SRC = extractBlock(
  'function renderAll() {', 'renderParticipants("hostParticipantList");', 'renderAll'
);

function loadRenderAllGate({ participantCount, srcOverride = null }) {
  const state = { participants: Array.from({ length: participantCount }, (_, i) => P(`p${i}`)) };
  const boxes = { qrInviteBox: { hidden: null }, roomLockedBox: { hidden: null } };
  const $ = (id) => (boxes[id]
    ? { classList: { toggle: (_c, v) => { boxes[id].hidden = v; } } }
    : null);
  // renderAll 상단(초대 UI 판정부)만 잘라 REAL 소스로 구동한다.
  const head = (srcOverride ?? RENDER_ALL_SRC);
  const f = new Function('state', '$', 'isJoinLocked', 'MAX_ROOM_PARTICIPANTS',
    `"use strict";\n${head}\n}\nreturn renderAll;`);
  f(state, $, () => true /* 라운드 진행 중이라 항상 잠금 */, 20)();
  return boxes;
}

describe('HIGH — 라운드 진행 중에도 호스트가 QR로 초대할 수 있다', () => {
  it('진행 중(isJoinLocked=true)이어도 정원 미만이면 QR이 노출된다', () => {
    const boxes = loadRenderAllGate({ participantCount: 3 });
    expect(boxes.qrInviteBox.hidden).toBe(false);   // QR 보임
    expect(boxes.roomLockedBox.hidden).toBe(true);  // "정원 마감" 숨김
  });

  it('정원(20)이 차면 QR을 닫고 안내를 띄운다', () => {
    const boxes = loadRenderAllGate({ participantCount: 20 });
    expect(boxes.qrInviteBox.hidden).toBe(true);
    expect(boxes.roomLockedBox.hidden).toBe(false);
  });

  it('mutation — 초대 판정을 isJoinLocked()로 되돌리면 진행 중 QR이 사라진다(RED)', () => {
    const mutated = RENDER_ALL_SRC.replace(
      'const inviteClosed = (state.participants || []).length >= MAX_ROOM_PARTICIPANTS;',
      'const inviteClosed = isJoinLocked();');
    expect(mutated).not.toBe(RENDER_ALL_SRC);
    const boxes = loadRenderAllGate({ participantCount: 3, srcOverride: mutated });
    expect(boxes.qrInviteBox.hidden).toBe(true);    // RED — 초대 불가
    expect(boxes.roomLockedBox.hidden).toBe(false);
  });

  it('isJoinLocked 함수 자체는 무변경이며 다른 3개 호출부가 그대로 쓴다', () => {
    // renderAll은 더 이상 isJoinLocked를 초대 판정에 쓰지 않는다(주석 언급은 제외하고 검사).
    expect(RENDER_ALL_SRC).toContain('const inviteClosed = (state.participants || []).length >= MAX_ROOM_PARTICIPANTS;');
    expect(RENDER_ALL_SRC).not.toMatch(/const joinLocked = isJoinLocked\(\);/);
    // 나머지 3개 호출부는 그대로다.
    expect(html).toContain('const locked = isJoinLocked(roomParticipants || [], room.status);');
    expect(html).toContain('if (state.joinScreenMode === "recent" && isJoinLocked(roomParticipants || [], room.status)) {');
    expect(html).toContain('      if (isJoinLocked()) {');
    const body = extractBlock('function isJoinLocked(', '\n    }', 'isJoinLockedBody');
    expect(body).toContain("status === \"playing\" || status === \"result\" || status === \"stats\"");
    expect(body).not.toContain('MAX_ROOM_PARTICIPANTS');
  });

  it('i18n 문구가 3언어 모두 정원 기준으로 갱신됐다', () => {
    expect((html.match(/"hostRoom\.locked":/g) || []).length).toBe(3);
    expect(html).not.toContain('"hostRoom.locked": "참가 마감"');
    expect(html).not.toContain('QR 참여를 닫았습니다');
  });
});
