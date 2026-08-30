import { describe, it, expect } from 'vitest';
import { createRoomStore, createDb } from './rc3-harness-support.mjs';

// JP-BL-027-C — participants Realtime 전파 계약.
//
// 프로덕션(subscribeToRoom)은 rooms 와 participants 를 **양쪽** postgres_changes 로 구독하고,
// participants 콜백은 `scheduleFetchParticipants(roomCode)` 만 호출한다 — 이벤트 페이로드로
// 로컬 상태를 직접 고치지 않고 **권위 재조회**를 트리거한다.
// 이 파일은 하니스가 그 모델을 따르는지 nextRound 와 무관하게 검증한다.

function world() {
  const roomStore = createRoomStore('R-A');
  const other = createRoomStore('R-B');
  const add = (store, id, extra = {}) => {
    store.participants.set(id, {
      id, room_id: store.id, name: id, choice: null, is_ready: false,
      is_host: false, wins: 0, losses: 0, draws: 0, penalties: 0, created_at: id, ...extra,
    });
    store.order.push(id);
  };
  add(roomStore, 'p1', { is_host: true }); add(roomStore, 'p2'); add(roomStore, 'p3');
  add(other, 'q1');
  // 두 방의 참가자를 같은 스토어에서 보이게 하려면 A 스토어에 B 방 행도 넣어 격리를 검증한다.
  roomStore.participants.set('q9', { id: 'q9', room_id: 'R-B', name: 'q9', choice: null, is_ready: false, created_at: 'q9' });
  roomStore.order.push('q9');

  const mkDb = () => createDb({
    roomStore, deviceId: 'p1', isHost: true, rng: () => 0.5,
    clockRttFn: () => ({ rttBase: 1, upFrac: 0.5, jitterMs: 0 }),
    ackDelayFn: () => 0, strictFilters: true, realtimeDelayRegime: 'optimistic',
  });
  const events = [];
  roomStore.participantSubscribers.push({
    deviceId: 'sub1', onParticipantsChange: async () => { events.push({ sub: 'sub1', at: events.length }); },
  });
  roomStore.participantSubscribers.push({
    deviceId: 'sub2', onParticipantsChange: async () => { events.push({ sub: 'sub2', at: events.length }); },
  });
  return { roomStore, db: mkDb(), events };
}
// optimistic 레짐 최악 지연 ~2000ms + 여유. 배달은 실제 타이머를 탄다.
const settle = () => new Promise((r) => setTimeout(r, 2600));

describe('[C7] participants UPDATE 전파', () => {
  it('실제로 바뀐 행이 있으면 모든 구독자에게 이벤트가 간다', async () => {
    const { db, events } = world();
    await db.from('participants').update({ is_ready: true }).eq('room_id', 'R-A');
    await settle();
    expect(events.map((e) => e.sub).sort()).toEqual(['sub1', 'sub2']);
  });

  it('단일 행 갱신도 전파된다', async () => {
    const { db, events } = world();
    await db.from('participants').update({ choice: 'rock' }).eq('id', 'p2');
    await settle();
    expect(events).toHaveLength(2);
  });
});

describe('[C7] 0행이면 이벤트가 없다', () => {
  it('매치되는 행이 없는 UPDATE 는 이벤트를 만들지 않는다', async () => {
    const { db, events } = world();
    const res = await db.from('participants').update({ choice: 'rock' }).eq('id', 'ghost').select('id');
    await settle();
    expect(res.data).toEqual([]);
    expect(events, '0행인데 이벤트가 발생했다').toHaveLength(0);
  });

  it('매치되는 행이 없는 DELETE 는 이벤트를 만들지 않는다', async () => {
    const { db, events } = world();
    const res = await db.from('participants').delete().eq('id', 'ghost').select('id');
    await settle();
    expect(res.data).toEqual([]);
    expect(events).toHaveLength(0);
  });

  it('실패한 write(오류 주입)는 이벤트를 만들지 않는다', async () => {
    const roomStore = createRoomStore('R-C');
    roomStore.participants.set('p1', { id: 'p1', room_id: 'R-C', choice: null, created_at: 'p1' });
    roomStore.order.push('p1');
    const events = [];
    roomStore.participantSubscribers.push({ deviceId: 's', onParticipantsChange: () => events.push(1) });
    const db = createDb({
      roomStore, deviceId: 'p1', isHost: true, rng: () => 0.5, strictFilters: true,
      clockRttFn: () => ({ rttBase: 1, upFrac: 0.5, jitterMs: 0 }), ackDelayFn: () => 0,
      realtimeDelayRegime: 'optimistic',
      dbErrorInjectionFn: ({ table }) => (table === 'participants' ? { message: 'boom' } : null),
    });
    const res = await db.from('participants').update({ choice: 'rock' }).eq('id', 'p1').select('id');
    await settle();
    expect(res.error?.message).toBe('boom');
    expect(events, '실패한 write 가 이벤트를 냈다').toHaveLength(0);
  });
});

describe('[C7] 교차 방 격리', () => {
  it('다른 방 행만 바뀌면 이 방 구독자에게 이벤트가 가지 않는다', async () => {
    const { db, roomStore, events } = world();
    const res = await db.from('participants').update({ choice: 'rock' }).eq('room_id', 'R-B').select('id');
    await settle();
    expect(res.data.map((r) => r.id)).toEqual(['q9']); // 변경은 일어났지만
    expect(events, '다른 방 변경이 이 방 구독자에게 전파됐다').toHaveLength(0);
  });

  it('이 방 대상 변경은 다른 방 행을 건드리지 않는다', async () => {
    const { db, roomStore } = world();
    await db.from('participants').update({ is_ready: true }).eq('room_id', 'R-A');
    expect(roomStore.participants.get('q9').is_ready, '다른 방 행이 오염됐다').toBe(false);
  });
});

describe('[C7] DELETE 전파', () => {
  it('실제로 지워진 행이 있으면 전파된다', async () => {
    const { db, roomStore, events } = world();
    await db.from('participants').delete().eq('id', 'p3');
    await settle();
    expect(events).toHaveLength(2);
    expect(roomStore.participants.get('p3')).toBeUndefined();
  });

  it('다른 방 행 삭제는 이 방 구독자에게 가지 않는다', async () => {
    const { db, events } = world();
    await db.from('participants').delete().eq('room_id', 'R-B');
    await settle();
    expect(events).toHaveLength(0);
  });
});

describe('[C7] 체인 필터와 이벤트 대응', () => {
  it('교집합이 비면 이벤트가 없다', async () => {
    const { db, events } = world();
    const res = await db.from('participants').update({ choice: 'rock' })
      .eq('room_id', 'R-A').eq('id', 'q9').select('id');
    await settle();
    expect(res.data).toEqual([]);
    expect(events).toHaveLength(0);
  });

  it('교집합이 있으면 그 행에 대해서만 이벤트가 난다', async () => {
    const { db, roomStore, events } = world();
    const res = await db.from('participants').update({ choice: 'paper' })
      .eq('room_id', 'R-A').eq('id', 'p2').select('id');
    await settle();
    expect(res.data.map((r) => r.id)).toEqual(['p2']);
    expect(events).toHaveLength(2);
    expect(roomStore.participants.get('p1').choice).toBeNull();
  });
});

describe('[C7] 배달 합침과 순서 보장 (프로덕션 scheduleFetchParticipants 모델)', () => {
  function mk() {
    const roomStore = createRoomStore('R-D');
    for (const id of ['a', 'b']) {
      roomStore.participants.set(id, { id, room_id: 'R-D', choice: null, created_at: id });
      roomStore.order.push(id);
    }
    const arrivals = [];
    roomStore.participantSubscribers.push({
      deviceId: 'only', onParticipantsChange: () => { arrivals.push(Date.now()); },
    });
    const db = createDb({
      roomStore, deviceId: 'a', isHost: true, rng: () => 0.5, strictFilters: true,
      clockRttFn: () => ({ rttBase: 1, upFrac: 0.5, jitterMs: 0 }), ackDelayFn: () => 0,
      realtimeDelayRegime: 'optimistic',
    });
    return { roomStore, db, arrivals };
  }

  it('짧은 시간에 몰린 변경은 한 번의 재조회로 합쳐진다', async () => {
    // 프로덕션의 scheduleFetchParticipants 는 직전 타이머를 clearTimeout 하고 다시 건다.
    // 즉 연속 이벤트는 단일 재조회로 붕괴한다 — 재조회는 실행 시점의 최신 상태를 읽으므로
    // 관측 결과가 같다. 이벤트 수만큼 재조회하는 모델은 프로덕션과 다르다.
    const { db, arrivals } = mk();
    await db.from('participants').update({ choice: 'r1' }).eq('id', 'a');
    await db.from('participants').update({ choice: 'r2' }).eq('id', 'b');
    await new Promise((r) => setTimeout(r, 2600));
    expect(arrivals.length, '연속 이벤트가 합쳐지지 않았다').toBe(1);
  }, 20000);

  it('합쳐진 재조회는 마지막 변경까지 반영된 상태를 읽는다', async () => {
    const { roomStore, db } = mk();
    const seen = [];
    roomStore.participantSubscribers[0].onParticipantsChange = async () => {
      const { data } = await db.from('participants').select('*').eq('room_id', 'R-D').order('created_at');
      seen.push(data.map((r) => r.choice).join(','));
    };
    await db.from('participants').update({ choice: 'r1' }).eq('id', 'a');
    await db.from('participants').update({ choice: 'r2' }).eq('id', 'b');
    await new Promise((r) => setTimeout(r, 2600));
    expect(seen, '합쳐진 재조회가 최신 상태를 못 봤다').toEqual(['r1,r2']);
  }, 20000);

  it('충분히 떨어진 변경은 각각 배달되고 순서가 역전되지 않는다', async () => {
    const { db, arrivals } = mk();
    await db.from('participants').update({ choice: 'r1' }).eq('id', 'a');
    await new Promise((r) => setTimeout(r, 2600));
    await db.from('participants').update({ choice: 'r2' }).eq('id', 'b');
    await new Promise((r) => setTimeout(r, 2600));
    expect(arrivals).toHaveLength(2);
    expect(arrivals[1], '도착 시각이 역전됐다').toBeGreaterThanOrEqual(arrivals[0]);
  }, 20000);
});

describe('[C7] 중복/과잉 이벤트 내성', () => {
  it('같은 값으로 다시 갱신해도 행이 매치되면 이벤트는 발생한다 (프로덕션 동일 — 중복 재조회 허용)', async () => {
    const { db, events } = world();
    await db.from('participants').update({ is_ready: false }).eq('id', 'p1');
    await settle();
    const first = events.length;
    await db.from('participants').update({ is_ready: false }).eq('id', 'p1');
    await settle();
    expect(events.length, '중복 이벤트를 임의로 억제하면 프로덕션과 달라진다').toBeGreaterThan(first);
  }, 20000); // settle 2회(각 2.6s) — 기본 5s 타임아웃을 넘는다.
});

describe('[C7] 보류 재예약은 로컬 80ms 이지 네트워크 왕복이 아니다', () => {
  // 프로덕션 finishFetchParticipants(index.html:7111) 는 보류가 있으면
  // `scheduleFetchParticipants(roomCode)` 만 호출한다 — **로컬 80ms 타이머 하나**다.
  // 재조회를 다시 예약할 때 postgres_changes 전파지연(sampleRealtimeDelayMs)을 다시
  // 굴리면 pessimistic 레짐에서 ~80ms 여야 할 간격이 ~880ms 로 벌어진다.
  // 이 계약은 그 회귀를 막는다.
  function pessimisticWorld() {
    const roomStore = createRoomStore('R-P');
    const add = (id, extra = {}) => {
      roomStore.participants.set(id, {
        id, room_id: 'R-P', name: id, choice: null, is_ready: false,
        is_host: false, wins: 0, losses: 0, draws: 0, penalties: 0, created_at: id, ...extra,
      });
      roomStore.order.push(id);
    };
    add('p1', { is_host: true }); add('p2');

    const db = createDb({
      roomStore, deviceId: 'p1', isHost: true, rng: () => 0.5,
      clockRttFn: () => ({ rttBase: 1, upFrac: 0.5, jitterMs: 0 }),
      ackDelayFn: () => 0, strictFilters: true, realtimeDelayRegime: 'pessimistic',
    });

    const fires = [];
    roomStore.participantSubscribers.push({
      deviceId: 'sub1',
      onParticipantsChange: async (reschedule) => {
        fires.push(Date.now());
        // 첫 배달이 처리되는 동안 보류가 생긴 상황을 모사한다(프로덕션의 busy/pending).
        if (fires.length === 1 && typeof reschedule === 'function') reschedule();
      },
    });
    return { roomStore, db, fires };
  }

  it('보류 재예약 간격은 전파지연이 아니라 디바운스(80ms) 규모다', async () => {
    const { db, fires } = pessimisticWorld();
    await db.from('participants').update({ choice: 'rock' }).eq('id', 'p2');
    // pessimistic 최악 전파지연 + 여유.
    await new Promise((r) => setTimeout(r, 12000));

    expect(fires).toHaveLength(2);
    const gap = fires[1] - fires[0];
    // 프로덕션은 80ms. 전파지연을 다시 샘플링하면 수백 ms~수 초가 된다.
    expect(gap).toBeLessThan(400);
  }, 20000);
});
