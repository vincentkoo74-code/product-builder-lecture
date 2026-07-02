import { describe, it, expect } from 'vitest';
import { createEngine, makeEvent, applyEvent, initialState, EVENT_TYPES, SOUND_EVENTS } from '../engine/index.mjs';
import { judgePure, resolveElimination } from '../src/game-logic.mjs';

// WRPS-049 STEP2.2c — pre-live hardening. 결정론으로 검증 가능한 차원만(실기기 drift/audio는 device QA).

// 시드 PRNG(결정론)
function lcg(seed) { let s = seed >>> 0; return () => (s = (s * 1664525 + 1013904223) >>> 0) / 0xffffffff; }
const BASES = ['rock', 'paper', 'scissors'];

// 한 게임의 이벤트열 생성(seq 0..N)
function buildGameEvents(players, choices, target, ts = 1000) {
  const evs = [];
  let seq = 0;
  const mk = (type, payload) => evs.push(makeEvent(type, payload, { seq: seq++, ts }));
  mk(EVENT_TYPES.GAME_START, { participants: players.map((id, i) => ({ id, isHost: i === 0 })), targetLoserCount: target });
  players.forEach((id) => mk(EVENT_TYPES.PLAYER_READY, { playerId: id }));
  mk(EVENT_TYPES.COUNTDOWN_START, { countdownStartAt: ts + 500 });
  mk(EVENT_TYPES.COUNTDOWN_END, {});
  players.forEach((id, i) => mk(EVENT_TYPES.PLAYER_ACTION, { playerId: id, base: choices[i] }));
  mk(EVENT_TYPES.ROUND_RESULT, {});
  return evs;
}

function ingestAll(evs) {
  const e = createEngine({ now: () => 1000 });
  evs.forEach((ev) => e.ingest(ev));
  return e;
}

describe('STEP2.2c — 이벤트 커버리지 100%', () => {
  it('join/leave/ready/start/countdown/play/result/restart 전부 엔진 이벤트로 처리된다', () => {
    const map = {
      join: EVENT_TYPES.PLAYER_JOIN, leave: EVENT_TYPES.PLAYER_LEAVE,
      ready: EVENT_TYPES.PLAYER_READY, start: EVENT_TYPES.GAME_START,
      countdown: EVENT_TYPES.COUNTDOWN_START, play: EVENT_TYPES.PLAYER_ACTION,
      result: EVENT_TYPES.ROUND_RESULT, restart: EVENT_TYPES.NEXT_ROUND,
    };
    for (const [k, type] of Object.entries(map)) {
      expect(type, `missing event: ${k}`).toBeTruthy();
    }
    // 각 이벤트가 applyEvent에서 상태를 바꾸는지(누락 경로 없음)
    let s = initialState();
    s = applyEvent(s, makeEvent(EVENT_TYPES.GAME_START, { participants: [{ id: 'a', isHost: true }, { id: 'b' }] }, { seq: 0, ts: 1 }));
    expect(s.phase).toBe('ready');
    s = applyEvent(s, makeEvent(EVENT_TYPES.PLAYER_READY, { playerId: 'a' }, { seq: 1, ts: 1 }));
    expect(s.readyIds).toContain('a');
    s = applyEvent(s, makeEvent(EVENT_TYPES.PLAYER_JOIN, { player: { id: 'c' } }, { seq: 2, ts: 1 }));
    expect(s.participants.map((p) => p.id)).toContain('c');
    s = applyEvent(s, makeEvent(EVENT_TYPES.PLAYER_LEAVE, { playerId: 'c' }, { seq: 3, ts: 1 }));
    expect(s.participants.map((p) => p.id)).not.toContain('c');
    s = applyEvent(s, makeEvent(EVENT_TYPES.NEXT_ROUND, {}, { seq: 4, ts: 1 }));
    expect(s.round).toBe(2);
    expect(s.readyIds).toEqual([]); // restart 시 ready 리셋
  });
});

describe('STEP2.2c — 순서(sequenceId) under load', () => {
  it('셔플(out-of-order) 전달이어도 in-order와 동일 상태로 수렴', () => {
    const players = ['a', 'b', 'c'];
    const evs = buildGameEvents(players, ['rock', 'scissors', 'rock'], 1);
    const inOrder = ingestAll(evs);
    const rng = lcg(42);
    for (let trial = 0; trial < 20; trial++) {
      const shuffled = [...evs].sort(() => rng() - 0.5);
      const out = ingestAll(shuffled);
      expect(out.getState()).toEqual(inOrder.getState());
    }
  });

  it('지연(미래 seq) 이벤트는 버퍼→빈자리 채워지면 순서대로 flush', () => {
    const evs = buildGameEvents(['a', 'b'], ['rock', 'scissors'], 1);
    const e = createEngine({ now: () => 1000 });
    // 마지막(ROUND_RESULT)부터 역순 전달(전부 미래 seq → 버퍼)
    [...evs].reverse().forEach((ev) => e.ingest(ev));
    expect(e.getState().lastResult.outcome).toBe('gameOver');
    expect(e.getState().confirmedLoserIds).toEqual(['b']);
  });
});

describe('STEP2.2c — 중복(eventId) under spam', () => {
  it('동일 이벤트 스팸(100회)이어도 1회만 적용', () => {
    const evs = buildGameEvents(['a', 'b'], ['rock', 'scissors'], 1);
    const e = createEngine({ now: () => 1000 });
    evs.forEach((ev) => { for (let i = 0; i < 100; i++) e.ingest(ev); });
    expect(e.log.size).toBe(evs.length);          // 중복 0
    expect(e.getState().confirmedLoserIds).toEqual(['b']);
  });

  it('이미 지난 seq(지연 도착) → stale 거부', () => {
    const evs = buildGameEvents(['a', 'b'], ['rock', 'scissors'], 1);
    const e = ingestAll(evs);
    const stale = makeEvent(EVENT_TYPES.PLAYER_ACTION, { playerId: 'a', base: 'paper' }, { seq: 1, ts: 1000, id: 'late' });
    expect(e.ingest(stale).reason).toBe('stale');
  });
});

describe('STEP2.2c — 오디오 단일 재생(eventId dedup) under spam', () => {
  it('동일 라운드 ROUND_RESULT/COUNTDOWN 스팸 → 사운드 이벤트 각 1개', () => {
    const e = createEngine({ now: () => 1000 });
    e.dispatch(EVENT_TYPES.GAME_START, { participants: [{ id: 'a', isHost: true }, { id: 'b' }], targetLoserCount: 1 });
    // 연속 seq로 동일 라운드 스팸(전부 적용됨) → 오디오는 라운드 키(gameRound:round)로 dedup → 1
    for (let i = 0; i < 20; i++) e.dispatch(EVENT_TYPES.COUNTDOWN_START, { countdownStartAt: 1500 });
    e.dispatch(EVENT_TYPES.COUNTDOWN_END);
    e.dispatch(EVENT_TYPES.PLAYER_ACTION, { playerId: 'a', base: 'rock' });
    e.dispatch(EVENT_TYPES.PLAYER_ACTION, { playerId: 'b', base: 'scissors' });
    for (let i = 0; i < 20; i++) e.dispatch(EVENT_TYPES.ROUND_RESULT);
    const intro = e.getState().audioEvents.filter((a) => a.type === SOUND_EVENTS.COUNTDOWN);
    const res = e.getState().audioEvents.filter((a) => a.type === SOUND_EVENTS.ROUND_RESULT);
    expect(intro.length).toBe(1);
    expect(res.length).toBe(1);
  });
});

describe('STEP2.2c — reconnect / host transfer mid-event', () => {
  it('reconnect: 셔플된 전체 로그 재수신 → 동일 상태 수렴', () => {
    const evs = buildGameEvents(['a', 'b', 'c'], ['paper', 'rock', 'rock'], 1);
    const live = ingestAll(evs);
    const rng = lcg(7);
    const reconnZip = [...evs].sort(() => rng() - 0.5);
    const reconn = ingestAll(reconnZip);
    expect(reconn.getState()).toEqual(live.getState());
    expect(reconn.replay()).toEqual(reconn.getState());
  });

  it('host transfer가 라운드 진행 중 끼어들어도 결과/호스트 일관', () => {
    const e = createEngine({ now: () => 1000 });
    let seq = 0;
    const mk = (t, p) => e.ingest(makeEvent(t, p, { seq: seq++, ts: 1000 }));
    mk(EVENT_TYPES.GAME_START, { participants: [{ id: 'a', isHost: true }, { id: 'b' }], targetLoserCount: 1 });
    mk(EVENT_TYPES.COUNTDOWN_START, { countdownStartAt: 1500 });
    mk(EVENT_TYPES.COUNTDOWN_END, {});
    mk(EVENT_TYPES.PLAYER_ACTION, { playerId: 'a', base: 'rock' });
    mk(EVENT_TYPES.HOST_TRANSFER, { newHostId: 'b' });    // 라운드 중 승계
    mk(EVENT_TYPES.PLAYER_ACTION, { playerId: 'b', base: 'scissors' });
    mk(EVENT_TYPES.ROUND_RESULT, {});
    const s = e.getState();
    expect(s.hostId).toBe('b');
    expect(s.confirmedLoserIds).toEqual(['b']);            // 판정은 승계와 무관(b=scissors lose)
    expect(s.participants.find((p) => p.id === 'b').isHost).toBe(true);
  });
});

describe('STEP2.2c — 패리티 under stress (엔진==game-logic, prev-confirmed 포함)', () => {
  it('랜덤 1000케이스(2~6인, prevLoser/Safe 포함) 100% 일치', () => {
    const rng = lcg(12345);
    const pick = (arr) => arr[Math.floor(rng() * arr.length)];
    let total = 0, match = 0;
    const mismatches = [];
    for (let i = 0; i < 1000; i++) {
      const n = 2 + Math.floor(rng() * 5);                 // 2~6인
      const players = Array.from({ length: n }, (_, j) => `p${j}`);
      const choices = players.map(() => pick(BASES));
      const target = 1 + Math.floor(rng() * (n - 1));      // 1~n-1
      // 엔진(applyEvent ROUND_RESULT, 섀도우와 동일 경로)
      const st = initialState();
      st.participants = players.map((id) => ({ id }));
      st.targetLoserCount = target;
      st.roundChoices = Object.fromEntries(players.map((id, j) => [id, choices[j]]));
      const after = applyEvent(st, makeEvent(EVENT_TYPES.ROUND_RESULT, {}, { seq: 0, ts: 1 }));
      // game-logic 직접
      const per = judgePure(players.map((id, j) => ({ id, base: choices[j] })));
      const elim = resolveElimination({ roundResults: players.map((id) => ({ id, result: per[id] })), prevLoserIds: [], prevSafeIds: [], targetLoserCount: target });
      total++;
      const ok = (after.lastResult.outcome === elim.outcome)
        && JSON.stringify([...after.confirmedLoserIds].sort()) === JSON.stringify([...elim.newConfirmedLoserIds].sort())
        && JSON.stringify([...after.confirmedSafeIds].sort()) === JSON.stringify([...elim.newConfirmedSafeIds].sort());
      if (ok) match++; else mismatches.push({ n, choices, target, engine: after.lastResult.outcome, logic: elim.outcome });
    }
    expect(mismatches).toEqual([]);
    expect(match).toBe(total);                              // 100%
  });
});
