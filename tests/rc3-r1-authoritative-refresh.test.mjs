// R1 — participants 권위 재조회가 프로덕션 fetchParticipants 와 동일한 상태 전이를 일으키는가.
//
// 검증 대상은 `refreshParticipantsAuthoritative` 가 재현하는 index.html:7140~7354 의 본문이다.
// 이 파일은 rc3 시나리오/`nextRound` 와 무관하게 그 계약만 고정한다.
// 어떤 테스트도 시뮬레이터 상태를 직접 주입해 통과시키지 않는다 — 전이는 항상
//   DB 변경 → participants 이벤트 → 디바운스 → 권위 재조회 → REAL 로직
// 경로로만 일어나야 한다.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  judgePure, resolveElimination, computePlayerStatuses, PLAYER_STATUS, maxLoserCountFor,
} from '../src/game-logic.mjs';
import { createTrialWorld, refreshParticipantsAuthoritative } from './rc3-harness-support.mjs';

function makeWorld(participantCount = 3, seed = 4242) {
  return createTrialWorld({
    participantCount, seed, targetLoserCount: 1,
    resolveElimination, judgePure, computePlayerStatuses, PLAYER_STATUS, maxLoserCountFor,
  });
}
// 재조회는 fake db 의 ack 지연(실제 setTimeout 기반)을 await 하므로, 가짜 타이머 환경에서는
// 호출자가 시간을 흘려보내 줘야 완료된다.
const refresh = async (world, device) => {
  const p = refreshParticipantsAuthoritative({
    db: device.env.db, roomStore: world.roomStore, implRef: () => device.impl,
  });
  await vi.advanceTimersByTimeAsync(3000);
  return p;
};
const rowOf = (world, id) => world.roomStore.participants.get(id);

describe('[R1] 호스트 역할 전환', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date(1_800_000_000_000)); });
  afterEach(() => { vi.useRealTimers(); });

  it('권위 스냅샷이 host 를 B 로 바꾸면 A 는 권위를 잃고 B 가 얻는다', async () => {
    const world = makeWorld();
    const [a, b, c] = world.devices;
    for (const d of world.devices) d.impl.state.roomCode = world.roomStore.id;
    a.impl.state.role = 'host'; b.impl.state.role = 'participant'; c.impl.state.role = 'participant';

    // DB 에서만 host 를 옮긴다 — 어떤 device 의 state.role 도 직접 건드리지 않는다.
    rowOf(world, 'p0').is_host = false;
    rowOf(world, 'p1').is_host = true;

    await refresh(world, a); await refresh(world, b); await refresh(world, c);

    expect(a.impl.state.role).toBe('participant');
    expect(b.impl.state.role).toBe('host');
    expect(c.impl.state.role).toBe('participant');
  });

  it('무관한 device 는 host 권위를 얻지 않는다', async () => {
    const world = makeWorld();
    const [, , c] = world.devices;
    c.impl.state.roomCode = world.roomStore.id;
    c.impl.state.role = 'participant';
    rowOf(world, 'p0').is_host = false;
    rowOf(world, 'p1').is_host = true;
    await refresh(world, c);
    expect(c.impl.state.role).toBe('participant');
  });

  it('host 가 그대로면 역할도 그대로다', async () => {
    const world = makeWorld();
    const [a] = world.devices;
    a.impl.state.roomCode = world.roomStore.id;
    a.impl.state.role = 'host';
    await refresh(world, a);
    expect(a.impl.state.role).toBe('host');
  });
});

describe('[R1] 권위 참가자 반영', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date(1_800_000_000_000)); });
  afterEach(() => { vi.useRealTimers(); });

  it('DB 의 readiness 변화가 재조회로 device 에 반영된다', async () => {
    const world = makeWorld();
    const [a] = world.devices;
    a.impl.state.roomCode = world.roomStore.id;
    rowOf(world, 'p1').is_ready = true;
    await refresh(world, a);
    expect(a.impl.state.participants.find((p) => p.id === 'p1').is_ready).toBe(true);
  });

  it('참가자가 사라지면 재조회가 목록에서 제거한다', async () => {
    const world = makeWorld();
    const [a] = world.devices;
    a.impl.state.roomCode = world.roomStore.id;
    await refresh(world, a);
    expect(a.impl.state.participants).toHaveLength(3);

    world.roomStore.participants.delete('p2');
    world.roomStore.order.splice(world.roomStore.order.indexOf('p2'), 1);
    await refresh(world, a);
    expect(a.impl.state.participants.map((p) => p.id)).toEqual(['p0', 'p1']);
  });

  it('참가자 제거 후에도 host 판정은 권위 스냅샷을 따른다', async () => {
    const world = makeWorld();
    const [, b] = world.devices;
    b.impl.state.roomCode = world.roomStore.id;
    b.impl.state.role = 'participant';
    // host 였던 p0 이 사라지고 p1 이 host 가 된다.
    world.roomStore.participants.delete('p0');
    world.roomStore.order.splice(world.roomStore.order.indexOf('p0'), 1);
    rowOf(world, 'p1').is_host = true;
    await refresh(world, b);
    expect(b.impl.state.role).toBe('host');
    expect(b.impl.state.participants.map((p) => p.id)).toEqual(['p1', 'p2']);
  });
});

describe('[R1] 비호스트는 host 전용 후속을 실행하지 않는다', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date(1_800_000_000_000)); });
  afterEach(() => { vi.useRealTimers(); });

  it('status=ready + 전원 준비여도 비호스트는 startGame 을 호출하지 않는다', async () => {
    const world = makeWorld();
    const [, b] = world.devices;
    b.impl.state.roomCode = world.roomStore.id;
    b.impl.state.role = 'participant';
    b.impl.state.status = 'ready';
    let started = 0;
    b.impl.startGame = async () => { started += 1; };
    for (const id of ['p0', 'p1', 'p2']) rowOf(world, id).is_ready = true;
    await refresh(world, b);
    expect(started).toBe(0);
  });

  it('status=playing + 전원 선택이어도 비호스트는 결과를 발행하지 않는다', async () => {
    const world = makeWorld();
    const [, b] = world.devices;
    b.impl.state.roomCode = world.roomStore.id;
    b.impl.state.role = 'participant';
    b.impl.state.status = 'playing';
    let published = 0;
    b.impl.publishHostRoundResult = async () => { published += 1; };
    for (const id of ['p0', 'p1', 'p2']) rowOf(world, id).choice = 'rock';
    await refresh(world, b);
    expect(published).toBe(0);
  });
});

describe('[R1] host 결과 발행 트리거', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date(1_800_000_000_000)); });
  afterEach(() => { vi.useRealTimers(); });

  it('status=playing + 활성 전원 선택 완료면 host 가 결과를 발행한다', async () => {
    const world = makeWorld();
    const [a] = world.devices;
    a.impl.state.roomCode = world.roomStore.id;
    a.impl.state.role = 'host';
    a.impl.state.status = 'playing';
    const calls = [];
    a.impl.publishHostRoundResult = async (rows) => { calls.push(rows.map((p) => p.id)); };
    for (const id of ['p0', 'p1', 'p2']) rowOf(world, id).choice = 'rock';
    await refresh(world, a);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual(['p0', 'p1', 'p2']);
  });

  it('한 명이라도 선택하지 않았으면 발행하지 않는다', async () => {
    const world = makeWorld();
    const [a] = world.devices;
    a.impl.state.roomCode = world.roomStore.id;
    a.impl.state.role = 'host';
    a.impl.state.status = 'playing';
    let published = 0;
    a.impl.publishHostRoundResult = async () => { published += 1; };
    rowOf(world, 'p0').choice = 'rock'; rowOf(world, 'p1').choice = 'rock';
    await refresh(world, a);
    expect(published).toBe(0);
  });

  it('status 가 playing 이 아니면 발행하지 않는다', async () => {
    const world = makeWorld();
    const [a] = world.devices;
    a.impl.state.roomCode = world.roomStore.id;
    a.impl.state.role = 'host';
    a.impl.state.status = 'ready';
    let published = 0;
    a.impl.publishHostRoundResult = async () => { published += 1; };
    for (const id of ['p0', 'p1', 'p2']) rowOf(world, id).choice = 'rock';
    await refresh(world, a);
    expect(published).toBe(0);
  });

  it('이미 결과가 인코딩된 라운드는 재발행하지 않는다(폴링·Realtime 이중 집계 방지)', async () => {
    const world = makeWorld();
    const [a] = world.devices;
    a.impl.state.roomCode = world.roomStore.id;
    a.impl.state.role = 'host';
    a.impl.state.status = 'playing';
    let published = 0;
    a.impl.publishHostRoundResult = async () => { published += 1; };
    for (const id of ['p0', 'p1', 'p2']) {
      rowOf(world, id).choice = a.impl.encodeRoundChoice
        ? a.impl.encodeRoundChoice('rock', 'draw')
        : 'rock';
    }
    await refresh(world, a);
    // 인코딩된 결과가 있으면 alreadyProcessed 로 차단된다.
    if (a.impl.hasConfirmedRoundResult(rowOf(world, 'p0').choice)) expect(published).toBe(0);
    else expect(published).toBe(1); // encodeRoundChoice 미노출 환경에서는 일반 경로
  });
});

describe('[R1] host 자동 시작 트리거', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date(1_800_000_000_000)); });
  afterEach(() => { vi.useRealTimers(); });

  it('status=ready + 활성 전원 준비 완료면 host 가 startGame 을 정확히 1회 호출한다', async () => {
    const world = makeWorld();
    const [a] = world.devices;
    a.impl.state.roomCode = world.roomStore.id;
    a.impl.state.role = 'host';
    a.impl.state.status = 'ready';
    let started = 0;
    a.impl.startGame = async () => { started += 1; };
    for (const id of ['p0', 'p1', 'p2']) rowOf(world, id).is_ready = true;
    await refresh(world, a);
    expect(started).toBe(1);
  });

  it('gameStarting 중이면 시작하지 않는다(프로덕션 가드)', async () => {
    const world = makeWorld();
    const [a] = world.devices;
    a.impl.state.roomCode = world.roomStore.id;
    a.impl.state.role = 'host';
    a.impl.state.status = 'ready';
    a.impl.state.gameStarting = true;
    let started = 0;
    a.impl.startGame = async () => { started += 1; };
    for (const id of ['p0', 'p1', 'p2']) rowOf(world, id).is_ready = true;
    await refresh(world, a);
    expect(started).toBe(0);
  });

  it('준비되지 않은 활성 참가자가 있으면 시작하지 않는다', async () => {
    const world = makeWorld();
    const [a] = world.devices;
    a.impl.state.roomCode = world.roomStore.id;
    a.impl.state.role = 'host';
    a.impl.state.status = 'ready';
    let started = 0;
    a.impl.startGame = async () => { started += 1; };
    rowOf(world, 'p0').is_ready = true;
    await refresh(world, a);
    expect(started).toBe(0);
  });
});

describe('[R1] 방 격리 / 경합 가드', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date(1_800_000_000_000)); });
  afterEach(() => { vi.useRealTimers(); });

  it('다른 방의 재조회는 이 device 의 host 권위를 바꾸지 않는다', async () => {
    const world = makeWorld();
    const [a] = world.devices;
    a.impl.state.roomCode = 'OTHER-ROOM';
    a.impl.state.role = 'participant';
    rowOf(world, 'p0').is_host = true;
    await refresh(world, a);
    expect(a.impl.state.role).toBe('participant');
  });

  it('roomCode 가 비어 있으면 재조회 결과를 반영하지 않는다', async () => {
    const world = makeWorld();
    const [a] = world.devices;
    a.impl.state.roomCode = null;
    a.impl.state.participants = [];
    a.impl.state.role = 'participant';
    rowOf(world, 'p0').is_host = true;
    await refresh(world, a);
    expect(a.impl.state.participants).toEqual([]);
    expect(a.impl.state.role).toBe('participant');
  });

  it('오래된 재조회 응답이 최신 참가자 상태를 덮어쓰지 않는다', async () => {
    const world = makeWorld();
    const [a] = world.devices;
    a.impl.state.roomCode = world.roomStore.id;
    // seq 를 앞질러 놓으면 이 응답은 폐기되어야 한다.
    const fresh = [{ id: 'zz', room_id: world.roomStore.id }];
    a.impl.state.participants = fresh;
    const db = {
      from: () => ({
        select() { return this; }, eq() { return this; },
        async order() { a.impl.state._fetchParticipantsSeq += 5; return { data: [] }; },
      }),
    };
    const pending = refreshParticipantsAuthoritative({ db, roomStore: world.roomStore, implRef: () => a.impl });
    await vi.advanceTimersByTimeAsync(3000);
    await pending;
    expect(a.impl.state.participants).toBe(fresh);
  });
});

describe('[R1] class-D 전제 트립와이어', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date(1_800_000_000_000)); });
  afterEach(() => { vi.useRealTimers(); });

  // shouldResetForParticipantChange / ensureHostExists / recoverRoundWhenAllPlayersWaiting 를
  // 미구현으로 두는 근거는 "라운드 진행 중 참가자 증감 없음"이라는 암묵 불변식이다.
  // 그 전제가 깨지면 조용히 프로덕션과 갈라지므로, 깨지는 즉시 실패해야 한다.
  it('라운드 진행 중(playing) 참가자가 사라지면 즉시 실패한다', async () => {
    const world = makeWorld();
    const [a] = world.devices;
    a.impl.state.roomCode = world.roomStore.id;
    a.impl.state.status = 'playing';
    await refresh(world, a);
    expect(a.impl.state.participants).toHaveLength(3);

    world.roomStore.participants.delete('p2');
    world.roomStore.order.splice(world.roomStore.order.indexOf('p2'), 1);
    const p = refreshParticipantsAuthoritative({
      db: a.env.db, roomStore: world.roomStore, implRef: () => a.impl,
    });
    // 타이머를 진행시키기 전에 rejection 핸들러를 먼저 붙인다(unhandled rejection 방지).
    const assertion = expect(p).rejects.toThrow(/class-D 전제 위반/);
    await vi.advanceTimersByTimeAsync(3000);
    await assertion;
  });

  it('비진행 상태(waiting)에서의 참가자 증감은 트립와이어를 울리지 않는다', async () => {
    const world = makeWorld();
    const [a] = world.devices;
    a.impl.state.roomCode = world.roomStore.id;
    a.impl.state.status = 'waiting';
    await refresh(world, a);
    world.roomStore.participants.delete('p2');
    world.roomStore.order.splice(world.roomStore.order.indexOf('p2'), 1);
    await refresh(world, a);
    expect(a.impl.state.participants).toHaveLength(2);
  });
});
