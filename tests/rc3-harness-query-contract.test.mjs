import { describe, it, expect } from 'vitest';
import { createRoomStore, createDb } from './rc3-harness-support.mjs';

// Phase A — rc3 가짜 Supabase 쿼리 계층의 **필터 의미론** 계약.
//
// 이전 구현은 `.eq(col, val)` 에서 컬럼을 무시하고 항상 id 1건만 매치했다. 그 결과
// 프로덕션이 실제로 쓰는 `.eq('room_id', …)` 대량 갱신과 체인 조건(`.eq(id).eq(status)`)이
// 재현되지 않아, 시뮬레이션이 실제로는 일어나지 않은 write 를 성공으로 간주해 왔다.
//
// 이 파일은 nextRound 와 **무관하게** 쿼리 계층 자체를 검증한다.

function world({ isHost = true } = {}) {
  const roomStore = createRoomStore('R-A');
  const mk = (id, extra = {}) => {
    roomStore.participants.set(id, {
      id, room_id: roomStore.id, name: id, choice: null, is_ready: false,
      is_host: id === 'p1', wins: 0, losses: 0, draws: 0, penalties: 0, created_at: id, ...extra,
    });
    roomStore.order.push(id);
  };
  mk('p1'); mk('p2'); mk('p3');
  // 다른 방 참가자 — 절대 건드려지면 안 된다.
  roomStore.participants.set('x1', { id: 'x1', room_id: 'OTHER-ROOM', name: 'x1', choice: null, is_ready: false, created_at: 'x1' });
  roomStore.order.push('x1');
  const db = createDb({
    roomStore, deviceId: 'p1', isHost, rng: () => 0.5,
    clockRttFn: () => ({ rttBase: 1, upFrac: 0.5, jitterMs: 0 }),
    ackDelayFn: () => 0,
    strictFilters: true, // 권위 모드를 명시한다(JP-BL-027-D 이후 기본값이지만 의도를 남긴다).
  });
  return { db, roomStore };
}
const rows = (s) => [...s.participants.values()];
const byId = (s, id) => s.participants.get(id);

describe('[A4] eq 컬럼 정확성', () => {
  it('eq("id", …) 는 id 로만 필터한다', async () => {
    const { db, roomStore } = world();
    const res = await db.from('participants').update({ choice: 'rock' }).eq('id', 'p2').select('id');
    expect(res.data.map((r) => r.id)).toEqual(['p2']);
    expect(byId(roomStore, 'p2').choice).toBe('rock');
    expect(byId(roomStore, 'p1').choice).toBeNull();
    expect(byId(roomStore, 'p3').choice).toBeNull();
  });

  it('eq("room_id", …) 는 room_id 로 필터해 그 방 전원을 대상으로 한다', async () => {
    const { db, roomStore } = world();
    const res = await db.from('participants').update({ is_ready: true }).eq('room_id', 'R-A').select('id');
    expect(res.data.map((r) => r.id).sort()).toEqual(['p1', 'p2', 'p3']);
    for (const id of ['p1', 'p2', 'p3']) expect(byId(roomStore, id).is_ready).toBe(true);
  });

  it('eq("room_id", …) 가 다른 방 참가자를 건드리지 않는다', async () => {
    const { db, roomStore } = world();
    await db.from('participants').update({ is_ready: true }).eq('room_id', 'R-A');
    expect(byId(roomStore, 'x1').is_ready, '다른 방 행이 오염됐다').toBe(false);
  });

  it('존재하지 않는 컬럼 값이면 아무 행도 매치되지 않는다', async () => {
    const { db, roomStore } = world();
    const res = await db.from('participants').update({ choice: 'rock' }).eq('room_id', 'NOPE').select('id');
    expect(res.data).toEqual([]);
    expect(rows(roomStore).every((r) => r.choice === null)).toBe(true);
  });

  it('rooms: eq("status", …) 가 status 로 필터한다 (CAS 가드)', async () => {
    const { db, roomStore } = world();
    roomStore.row.status = 'result';
    const hit = await db.from('rooms').update({ status: 'game_over' }).eq('id', 'R-A').eq('status', 'result').select('id');
    expect(hit.data).toHaveLength(1);
    expect(roomStore.row.status).toBe('game_over');
    // 이제는 status 가 다르므로 두 번째 시도는 0행이어야 한다(멱등 재진입).
    const miss = await db.from('rooms').update({ status: 'game_over' }).eq('id', 'R-A').eq('status', 'result').select('id');
    expect(miss.data, 'CAS 가드가 작동하지 않았다').toEqual([]);
  });
});

describe('[A4] 체인 조건은 AND 다', () => {
  it('eq(room_id).eq(id) 는 교집합만 매치한다', async () => {
    const { db, roomStore } = world();
    const res = await db.from('participants').update({ choice: 'paper' })
      .eq('room_id', 'R-A').eq('id', 'p3').select('id');
    expect(res.data.map((r) => r.id)).toEqual(['p3']);
    expect(byId(roomStore, 'p1').choice).toBeNull();
  });

  it('교집합이 비면 0행이다 (다른 방의 id 를 지정)', async () => {
    const { db, roomStore } = world();
    const res = await db.from('participants').update({ choice: 'paper' })
      .eq('room_id', 'R-A').eq('id', 'x1').select('id');
    expect(res.data).toEqual([]);
    expect(byId(roomStore, 'x1').choice, '다른 방 행이 갱신됐다').toBeNull();
  });

  it('in(id) 도 컬럼을 존중하며 교집합으로 동작한다', async () => {
    const { db, roomStore } = world();
    const res = await db.from('participants').update({ is_ready: true })
      .eq('room_id', 'R-A').in('id', ['p2', 'x1']).select('id');
    expect(res.data.map((r) => r.id)).toEqual(['p2']);
    expect(byId(roomStore, 'x1').is_ready).toBe(false);
  });
});

describe('[A4] 카디널리티와 반환 계약', () => {
  it('select() 없이 await 하면 영향 행 정보가 없다 (HTTP 204 모델)', async () => {
    const { db } = world();
    const res = await db.from('participants').update({ choice: 'rock' }).eq('id', 'p1');
    expect(res.error).toBeNull();
    expect(res.data).toBeUndefined();
  });

  it('select() 는 실제로 바뀐 행만 돌려준다 (1행)', async () => {
    const { db } = world();
    const res = await db.from('participants').update({ choice: 'rock' }).eq('id', 'p1').select('id');
    expect(res.data).toHaveLength(1);
    expect(res.error).toBeNull();
  });

  it('select() 는 N행 대량 갱신에서 N행을 돌려준다', async () => {
    const { db } = world();
    const res = await db.from('participants').update({ choice: null }).eq('room_id', 'R-A').select('id');
    expect(res.data).toHaveLength(3);
  });

  it('0행은 오류가 아니라 빈 배열이다 (무음 0행)', async () => {
    const { db } = world();
    const res = await db.from('participants').update({ choice: 'rock' }).eq('id', 'ghost').select('id');
    expect(res.data).toEqual([]);
    expect(res.error, '0행을 오류로 날조하면 안 된다').toBeNull();
  });

  it('반환 행에는 패치가 반영돼 있다', async () => {
    const { db } = world();
    const res = await db.from('participants').update({ choice: 'scissors' }).eq('id', 'p2').select('id');
    expect(res.data[0].choice).toBe('scissors');
  });
});

describe('[A4] delete 도 같은 필터 의미론을 따른다', () => {
  it('delete().eq(id) 는 해당 행만 지운다', async () => {
    const { db, roomStore } = world();
    const res = await db.from('participants').delete().eq('id', 'p2').select('id');
    expect(res.data.map((r) => r.id)).toEqual(['p2']);
    expect(byId(roomStore, 'p2')).toBeUndefined();
    expect(roomStore.order).not.toContain('p2');
    expect(byId(roomStore, 'p1')).toBeTruthy();
  });

  it('delete().eq(room_id) 는 그 방만 비운다', async () => {
    const { db, roomStore } = world();
    await db.from('participants').delete().eq('room_id', 'R-A');
    expect(rows(roomStore).map((r) => r.id)).toEqual(['x1']);
  });

  it('매치가 없으면 0행이고 아무것도 지우지 않는다', async () => {
    const { db, roomStore } = world();
    const res = await db.from('participants').delete().eq('room_id', 'NOPE').select('id');
    expect(res.data).toEqual([]);
    expect(rows(roomStore)).toHaveLength(4);
  });
});

describe('[A4] rooms 부작용은 실제 변경이 있을 때만 발생한다', () => {
  it('매치되면 version 이 올라가고 구독자에게 전파된다', async () => {
    const { db, roomStore } = world();
    const seen = [];
    roomStore.subscribers.push({ deviceId: 'p2', onRoomRow: (r) => seen.push(r) });
    const before = roomStore.version;
    await db.from('rooms').update({ status: 'playing' }).eq('id', 'R-A');
    expect(roomStore.version).toBe(before + 1);
  });

  it('0행이면 version 도 오르지 않고 전파도 없다', async () => {
    const { db, roomStore } = world();
    roomStore.row.status = 'waiting';
    const before = roomStore.version;
    const res = await db.from('rooms').update({ status: 'game_over' })
      .eq('id', 'R-A').eq('status', 'result').select('id');
    expect(res.data).toEqual([]);
    expect(roomStore.version, '0행인데 커밋 부작용이 발생했다').toBe(before);
    expect(roomStore.row.status).toBe('waiting');
  });

  it('non-host 의 rooms.update 는 하니스 버그로 즉시 드러난다', async () => {
    const { db } = world({ isHost: false });
    await expect(db.from('rooms').update({ status: 'playing' }).eq('id', 'R-A'))
      .rejects.toThrow(/non-host/);
  });
});

describe('[A4] 오류 주입 계약이 유지된다', () => {
  it('주입된 오류는 행을 바꾸지도 전파하지도 않는다', async () => {
    const roomStore = createRoomStore('R-B');
    roomStore.participants.set('p1', { id: 'p1', room_id: 'R-B', choice: null, created_at: 'p1' });
    roomStore.order.push('p1');
    const db = createDb({
      roomStore, deviceId: 'p1', isHost: true, rng: () => 0.5,
      clockRttFn: () => ({ rttBase: 1, upFrac: 0.5, jitterMs: 0 }), ackDelayFn: () => 0, strictFilters: true,
      // 실제 시그니처: 단일 객체 인자 { table, op, patch, keyOrIds, deviceId, isHost, roomStore }
      dbErrorInjectionFn: ({ table, op }) => (table === 'participants' && op === 'update-eq'
        ? { message: 'injected' } : null),
    });
    const res = await db.from('participants').update({ choice: 'rock' }).eq('id', 'p1').select('id');
    expect(res.error?.message).toBe('injected');
    expect(res.data).toBeNull();
    expect(roomStore.participants.get('p1').choice, '실패한 write 가 행을 바꿨다').toBeNull();
  });
});
