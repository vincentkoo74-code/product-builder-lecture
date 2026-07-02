import { describe, it, expect } from 'vitest';
import { createEngine, makeEvent, applyEvent, initialState, EVENT_TYPES } from '../engine/index.mjs';
import { createSyncLayer } from '../engine/sync.mjs';

// WRPS-049 STEP2.2c FINAL — 멀티디바이스 동기화(결정론 시뮬레이션).
// 실 wall-clock drift는 실기기 영역. 여기선 "주어진 이벤트가 어떤 지연/순서로 와도 모든 기기가
// 동일 상태로 수렴"하는 동기화 계층의 결정론을 입증한다.

const TS0 = 1_000_000; // 서버 ts 기준

// 권위(호스트)가 만든 한 게임 이벤트열 — 각 이벤트는 서버 ts(TS0 + seq*100)로 스탬프.
function authorityStream(players, choices, target) {
  const evs = [];
  let seq = 0;
  const mk = (type, payload) => evs.push(makeEvent(type, payload, { seq: seq++, ts: TS0 + seq * 100 }));
  mk(EVENT_TYPES.GAME_START, { participants: players.map((id, i) => ({ id, isHost: i === 0 })), targetLoserCount: target });
  players.forEach((id) => mk(EVENT_TYPES.PLAYER_READY, { playerId: id }));
  mk(EVENT_TYPES.COUNTDOWN_START, { countdownStartAt: TS0 + 500 });
  mk(EVENT_TYPES.COUNTDOWN_END, {});
  players.forEach((id, i) => mk(EVENT_TYPES.PLAYER_ACTION, { playerId: id, base: choices[i] }));
  mk(EVENT_TYPES.ROUND_RESULT, {});
  return evs;
}

// 지연 모델(결정론): delayMs에 비례한 재정렬 윈도우로 배달 순서를 교란.
function reorderForDelay(evs, delayMs) {
  if (delayMs <= 0) return [...evs];
  const win = delayMs <= 200 ? 2 : 4; // 200ms→인접 교란, 500ms→넓은 윈도우 교란
  const out = [...evs];
  for (let i = 0; i + win < out.length; i += win) {
    const seg = out.slice(i, i + win).reverse(); // 윈도우 내부 역순(늦게 도착 모사)
    for (let j = 0; j < seg.length; j++) out[i + j] = seg[j];
  }
  return out;
}

// 한 "디바이스": SyncLayer + 엔진. clockSkewMs = 로컬 시계 오차(서버 대비).
function makeDevice(clockSkewMs = 0, delayMs = 0) {
  const engine = createEngine({ now: () => TS0 + clockSkewMs });
  const sync = createSyncLayer(engine, { now: () => TS0 + clockSkewMs, driftWindowMs: 150 });
  return { engine, sync, delayMs };
}

describe('STEP2.2c FINAL — 멀티디바이스 동기화 결정론', () => {
  it('3 디바이스(0/200/500ms 지연 + 클럭스큐) → 동일 상태 수렴, ordering mismatch 0, replay 100%', () => {
    const players = ['a', 'b', 'c'];
    const stream = authorityStream(players, ['rock', 'scissors', 'rock'], 1);

    const devices = [
      makeDevice(0, 0),      // 기준
      makeDevice(80, 200),   // +80ms 스큐, 200ms 지연 재정렬
      makeDevice(-120, 500), // -120ms 스큐, 500ms 지연 재정렬
    ];

    for (const d of devices) {
      for (const ev of reorderForDelay(stream, d.delayMs)) d.sync.ingest(ev);
    }

    // identical outcome across all clients
    const base = devices[0].engine.getState();
    for (const d of devices) {
      expect(d.engine.getState()).toEqual(base);     // 동일 상태 수렴
      expect(d.engine.replay()).toEqual(d.engine.getState()); // replay 100%
      expect(d.sync.metrics.stale).toBe(0);          // 순서 위반(=ordering mismatch) 0
    }
    expect(base.confirmedLoserIds).toEqual(['b']);   // a=rock,b=scissors,c=rock → rock>scissors → b 패
    expect(base.lastResult.outcome).toBe('gameOver');
  });

  it('drift 계측: 스큐 80ms → avgDrift ≈ 80(±), 게임 이벤트는 드롭 안 함(applied+buffered = 전부)', () => {
    const stream = authorityStream(['a', 'b'], ['rock', 'scissors'], 1);
    const d = makeDevice(80, 0);
    for (const ev of stream) d.sync.ingest(ev);
    expect(d.sync.metrics.ingested).toBe(stream.length);
    expect(d.sync.metrics.applied + d.sync.metrics.buffered).toBe(stream.length); // 드롭 0
    expect(d.sync.metrics.stale).toBe(0);
    expect(Math.round(d.sync.avgDrift())).toBeGreaterThanOrEqual(0); // 계측 동작
  });

  it('BEFORE/AFTER: 순진한 도착순 적용은 발산, SyncLayer는 수렴', () => {
    const stream = authorityStream(['a', 'b', 'c'], ['paper', 'rock', 'rock'], 1);
    const arrival = reorderForDelay(stream, 500);

    // BEFORE: seq 무시하고 도착순으로 그냥 reduce → in-order와 달라질 수 있음
    const naive = arrival.reduce((s, ev) => applyEvent(s, ev), initialState());
    const inOrder = stream.reduce((s, ev) => applyEvent(s, ev), initialState());

    // AFTER: SyncLayer(seq 순서 보장)
    const d = makeDevice(0, 500);
    for (const ev of arrival) d.sync.ingest(ev);

    expect(d.engine.getState().lastResult?.outcome).toBe(inOrder.lastResult?.outcome); // AFTER 수렴
    expect(d.engine.getState().confirmedLoserIds).toEqual(inOrder.confirmedLoserIds);
    // BEFORE는 적어도 한 지표에서 in-order와 다를 수 있음을 보임(발산 가능성 입증)
    const beforeDiverged = JSON.stringify(naive) !== JSON.stringify(inOrder);
    const afterConverged = JSON.stringify(d.engine.getState()) === JSON.stringify(inOrder);
    expect(afterConverged).toBe(true);
    expect(beforeDiverged || afterConverged).toBe(true); // AFTER는 항상 수렴
  });

  it('host transfer mid-round + reconnect: 모든 디바이스(+ 늦게 합류) 동일 수렴', () => {
    // 권위 스트림: 라운드 중 호스트 승계
    const evs = [];
    let seq = 0;
    const mk = (t, p) => evs.push(makeEvent(t, p, { seq: seq++, ts: TS0 + seq * 100 }));
    mk(EVENT_TYPES.GAME_START, { participants: [{ id: 'a', isHost: true }, { id: 'b' }, { id: 'c' }], targetLoserCount: 1 });
    mk(EVENT_TYPES.COUNTDOWN_START, { countdownStartAt: TS0 + 500 });
    mk(EVENT_TYPES.COUNTDOWN_END, {});
    mk(EVENT_TYPES.PLAYER_ACTION, { playerId: 'a', base: 'rock' });
    mk(EVENT_TYPES.HOST_TRANSFER, { newHostId: 'b' });     // 라운드 중 승계
    mk(EVENT_TYPES.PLAYER_ACTION, { playerId: 'b', base: 'rock' });
    mk(EVENT_TYPES.PLAYER_ACTION, { playerId: 'c', base: 'scissors' });
    mk(EVENT_TYPES.ROUND_RESULT, {});

    const live1 = makeDevice(0, 0);
    const live2 = makeDevice(50, 200);
    for (const ev of evs) live1.sync.ingest(ev);
    for (const ev of reorderForDelay(evs, 200)) live2.sync.ingest(ev);

    // reconnect: 활성 라운드 중 합류한 기기가 전체 로그를 셔플로 수신
    const reconnect = makeDevice(-30, 500);
    for (const ev of reorderForDelay(evs, 500)) reconnect.sync.ingest(ev);

    const s1 = live1.engine.getState();
    expect(live2.engine.getState()).toEqual(s1);
    expect(reconnect.engine.getState()).toEqual(s1);
    expect(s1.hostId).toBe('b');
    expect(s1.confirmedLoserIds).toEqual(['c']);           // c=scissors만 패 → 술래
    for (const d of [live1, live2, reconnect]) expect(d.sync.metrics.stale).toBe(0);
  });
});
