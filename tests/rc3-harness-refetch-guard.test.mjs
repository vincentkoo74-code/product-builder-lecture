// rc3 하니스 재조회 경합 가드 계약 테스트 (JP-BL-027-C)
//
// 대상: refreshParticipantsAuthoritative 가 프로덕션 fetchParticipants 의
// 재진입/최신성/방-동일성 가드를 동일하게 재현하는지 검증한다.
// 이 파일은 rc3 시나리오와 독립적으로 동작하며, rc3 가 어려워졌다는 이유로
// 완화되어서는 안 되는 계약을 고정한다.
import { describe, it, expect } from 'vitest';
import { refreshParticipantsAuthoritative } from './rc3-harness-support.mjs';

// 지연을 제어할 수 있는 최소 db 더블. select 응답이 resolve 되는 시점을 테스트가 정한다.
function makeDb({ snapshots }) {
  let call = 0;
  const resolvers = [];
  const db = {
    calls: () => call,
    releaseAll() { resolvers.splice(0).forEach((r) => r()); },
    from() {
      return {
        select() { return this; },
        eq() { return this; },
        order() {
          const i = call++;
          return new Promise((resolve) => {
            resolvers.push(() => resolve({ data: snapshots[i] ?? snapshots[snapshots.length - 1] }));
          });
        },
      };
    },
  };
  return db;
}

const P = (id, choice) => ({ id, room_id: 'R1', choice });
const world = (state) => ({ implRef: () => ({ state }), roomStore: { id: 'R1' } });

describe('재조회 가드 — 재진입(busy/pending)', () => {
  it('조회 진행 중 들어온 재조회는 중복 조회를 만들지 않고 재예약 1회로 합쳐진다', async () => {
    const state = { roomCode: 'R1', participants: [] };
    const snapshots = [[P('a', null)]];
    const db = makeDb({ snapshots });
    const w = world(state);
    let rescheduled = 0;
    const reschedule = () => { rescheduled += 1; };

    const first = refreshParticipantsAuthoritative({ db, ...w, reschedule });
    // 진행 중 3번 더 요청해도 즉시 추가 조회는 발생하지 않는다.
    await refreshParticipantsAuthoritative({ db, ...w, reschedule });
    await refreshParticipantsAuthoritative({ db, ...w, reschedule });
    await refreshParticipantsAuthoritative({ db, ...w, reschedule });
    expect(db.calls()).toBe(1);
    expect(rescheduled).toBe(0);

    db.releaseAll();
    await first;

    // 프로덕션 finishFetchParticipants 와 동일: 보류는 즉시 재조회가 아니라
    // 디바운스 재예약 **1회**로 합쳐진다(3회가 아니다).
    expect(db.calls()).toBe(1);
    expect(rescheduled).toBe(1);
    expect(state._fetchParticipantsBusy).toBe(false);
    expect(state._fetchParticipantsPending).toBe(false);
  });

  it('보류가 없으면 재예약도 추가 조회도 하지 않는다', async () => {
    const state = { roomCode: 'R1', participants: [] };
    const db = makeDb({ snapshots: [[P('a', null)]] });
    const w = world(state);
    let rescheduled = 0;
    const p = refreshParticipantsAuthoritative({ db, ...w, reschedule: () => { rescheduled += 1; } });
    db.releaseAll();
    await p;
    expect(db.calls()).toBe(1);
    expect(rescheduled).toBe(0);
  });

  it('reschedule 콜백이 없어도(폴링 경로) 보류 플래그는 정리된다', async () => {
    const state = { roomCode: 'R1', participants: [] };
    const db = makeDb({ snapshots: [[P('a', null)]] });
    const w = world(state);
    const first = refreshParticipantsAuthoritative({ db, ...w });
    await refreshParticipantsAuthoritative({ db, ...w });
    db.releaseAll();
    await first;
    expect(state._fetchParticipantsPending).toBe(false);
    expect(state._fetchParticipantsBusy).toBe(false);
  });
});

describe('재조회 가드 — 최신성(seq)', () => {
  it('늦게 도착한 오래된 응답이 최신 상태를 덮어쓰지 않는다', async () => {
    const state = { roomCode: 'R1', participants: [] };
    const stale = [P('a', null)];
    const fresh = [P('a', 'rock')];
    const db = makeDb({ snapshots: [stale, fresh] });
    const w = world(state);

    // 첫 조회 진행 중 → 보류 예약 → 첫 응답은 폐기 대상이 아니지만,
    // 두 번째(더 새로운) 조회 결과가 최종 상태여야 한다.
    // 첫 조회가 진행 중일 때 들어온 요청은 보류 → 재예약된다.
    let queued = null;
    const first = refreshParticipantsAuthoritative({ db, ...w, reschedule: () => { queued = true; } });
    await refreshParticipantsAuthoritative({ db, ...w, reschedule: () => { queued = true; } });
    db.releaseAll();
    await first;
    expect(state.participants).toEqual(stale);
    expect(queued).toBe(true);

    // 재예약된 조회가 실행되면 최신 스냅샷이 최종 상태가 된다.
    const second = refreshParticipantsAuthoritative({ db, ...w });
    db.releaseAll();
    await second;
    expect(state.participants).toEqual(fresh);
  });

  it('seq 가 앞서간 경우 응답을 반영하지 않는다', async () => {
    const state = { roomCode: 'R1', participants: [P('a', 'rock')], _fetchParticipantsSeq: 0 };
    const db = {
      from: () => ({
        select() { return this; },
        eq() { return this; },
        async order() {
          // 응답 도착 직전에 더 새로운 요청이 발생한 상황을 모사한다.
          state._fetchParticipantsSeq += 5;
          return { data: [P('a', null)] };
        },
      }),
    };
    await refreshParticipantsAuthoritative({ db, ...world(state) });
    expect(state.participants).toEqual([P('a', 'rock')]);
  });

  it('data 가 없으면 기존 상태를 지우지 않는다', async () => {
    const state = { roomCode: 'R1', participants: [P('a', 'rock')] };
    const db = { from: () => ({ select() { return this; }, eq() { return this; }, async order() { return { data: null }; } }) };
    await refreshParticipantsAuthoritative({ db, ...world(state) });
    expect(state.participants).toEqual([P('a', 'rock')]);
  });
});

describe('재조회 가드 — 방-동일성(roomCode)', () => {
  it('다른 방으로 옮긴 뒤 도착한 응답은 폐기된다', async () => {
    const state = { roomCode: 'R2', participants: [] };
    const db = { from: () => ({ select() { return this; }, eq() { return this; }, async order() { return { data: [P('a', 'rock')] }; } }) };
    await refreshParticipantsAuthoritative({ db, ...world(state) });
    expect(state.participants).toEqual([]);
  });

  it('roomCode 가 일치하면 정상 반영된다', async () => {
    const state = { roomCode: 'R1', participants: [] };
    const db = { from: () => ({ select() { return this; }, eq() { return this; }, async order() { return { data: [P('a', 'rock')] }; } }) };
    await refreshParticipantsAuthoritative({ db, ...world(state) });
    expect(state.participants).toEqual([P('a', 'rock')]);
  });

  // 프로덕션 index.html:7137 은 `if (!state.roomCode || roomCode !== state.roomCode) return;` 이다.
  // roomCode 가 비어 있는 경우(goHome() 으로 방을 떠난 뒤)도 **폐기 대상**이며, 이는
  // WRPS-083 후속으로 명시적으로 추가된 실기기 BLOCKER 방어다. 하니스도 동일해야 한다.
  it('roomCode 가 비어 있으면(방을 떠난 뒤) 늦게 도착한 응답을 폐기한다', async () => {
    const state = { participants: [] };
    const db = { from: () => ({ select() { return this; }, eq() { return this; }, async order() { return { data: [P('a', 'rock')] }; } }) };
    await refreshParticipantsAuthoritative({ db, ...world(state) });
    expect(state.participants).toEqual([]);
  });

  it('방을 떠나 roomCode 가 지워지면 이미 진행 중이던 응답도 상태를 되채우지 않는다', async () => {
    const state = { roomCode: 'R1', participants: [] };
    const db = {
      from: () => ({
        select() { return this; },
        eq() { return this; },
        async order() { state.roomCode = null; return { data: [P('a', 'rock')] }; },
      }),
    };
    await refreshParticipantsAuthoritative({ db, ...world(state) });
    expect(state.participants).toEqual([]);
  });
});

describe('재조회 가드 — 예외 안전성', () => {
  it('조회가 throw 해도 busy 플래그가 남지 않는다', async () => {
    const state = { roomCode: 'R1', participants: [] };
    const db = { from: () => ({ select() { return this; }, eq() { return this; }, async order() { throw new Error('net'); } }) };
    await expect(refreshParticipantsAuthoritative({ db, ...world(state) })).rejects.toThrow('net');
    expect(state._fetchParticipantsBusy).toBe(false);
  });
});
