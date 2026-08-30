// R1b — 프로덕션의 **두** 자동 결과 발행 트리거와 그 상호작용을 rc3 가 충실히 모델링하는가.
//
//   Trigger A  index.html:7334  fetchParticipants — 활성 전원이 선택을 마친 즉시
//   Trigger B  index.html:9271  autoFillChoices  — 선택창이 끝났을 때
//   (index.html:10640 hostJudgeRound 는 수동 UI 버튼 전용, 자동 트리거 아님)
//
// 중복 방어는 프로덕션 자신의 기제만 쓴다(하니스 전용 "1회만" 지름길 금지):
//   publishHostRoundResult 내부의 host/status 가드 · publishingRoundResult 래치 ·
//   자체 권위 재조회 · hasConfirmedRoundResult 멱등 가드 · 전원 선택 가드.
//
// 목표는 "함수 호출이 정확히 1회"가 아니라 **권위 결과가 하나뿐이고 기기 간 모순이 없는 것**이다.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  judgePure, resolveElimination, computePlayerStatuses, PLAYER_STATUS, maxLoserCountFor,
} from '../src/game-logic.mjs';
import { createTrialWorld, refreshParticipantsAuthoritative } from './rc3-harness-support.mjs';

function makeWorld(participantCount = 3, seed = 9091) {
  return createTrialWorld({
    participantCount, seed, targetLoserCount: 1,
    resolveElimination, judgePure, computePlayerStatuses, PLAYER_STATUS, maxLoserCountFor,
  });
}
const rowOf = (w, id) => w.roomStore.participants.get(id);
const refresh = async (w, d, opts = {}) => {
  const p = refreshParticipantsAuthoritative({
    db: d.env.db, roomStore: w.roomStore, implRef: () => d.impl, ...opts,
  });
  await vi.advanceTimersByTimeAsync(3000);
  return p;
};
// host device 를 '전원 선택 완료 + playing' 상태로 만든다(DB 만 조작 — 결과는 주입하지 않는다).
function armAllChosen(w, choice = 'rock') {
  for (const id of ['p0', 'p1', 'p2']) rowOf(w, id).choice = choice;
}
function asHost(d, w) {
  d.impl.state.roomCode = w.roomStore.id;
  d.impl.state.role = 'host';
  d.impl.state.status = 'playing';
}

describe('[R1b] Trigger A — 일반 participant update 로 전원 선택이 모인 경우', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date(1_800_000_000_000)); });
  afterEach(() => { vi.useRealTimers(); });

  it('host 는 프로덕션과 동일한 조건에서 발행한다', async () => {
    const w = makeWorld(); const [a] = w.devices;
    asHost(a, w); armAllChosen(w);
    const calls = [];
    a.impl.publishHostRoundResult = async (rows) => { calls.push(rows.map((p) => p.id)); };
    await refresh(w, a);
    expect(calls).toHaveLength(1);
  });

  it('비호스트는 발행하지 않는다', async () => {
    const w = makeWorld(); const [, b] = w.devices;
    b.impl.state.roomCode = w.roomStore.id;
    b.impl.state.role = 'participant';
    b.impl.state.status = 'playing';
    armAllChosen(w);
    let n = 0; b.impl.publishHostRoundResult = async () => { n += 1; };
    await refresh(w, b);
    expect(n).toBe(0);
  });
});

describe('[R1b] 부분 선택 / 조기 발행 금지', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date(1_800_000_000_000)); });
  afterEach(() => { vi.useRealTimers(); });

  it('한 명이라도 선택 전이면 발행하지 않는다', async () => {
    const w = makeWorld(); const [a] = w.devices;
    asHost(a, w);
    rowOf(w, 'p0').choice = 'rock'; rowOf(w, 'p1').choice = 'rock';
    let n = 0; a.impl.publishHostRoundResult = async () => { n += 1; };
    await refresh(w, a);
    expect(n).toBe(0);
  });

  it('활성 참가자가 0명이면 발행하지 않는다', async () => {
    const w = makeWorld(); const [a] = w.devices;
    asHost(a, w);
    a.impl.state.confirmedSafeIds = ['p0', 'p1', 'p2'];
    armAllChosen(w);
    let n = 0; a.impl.publishHostRoundResult = async () => { n += 1; };
    await refresh(w, a);
    expect(n).toBe(0);
  });
});

describe('[R1b] A→B / B→A 순서 (권위 결과는 하나뿐)', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date(1_800_000_000_000)); });
  afterEach(() => { vi.useRealTimers(); });

  it('A 가 먼저 발행해 결과가 인코딩되면 이후 재조회는 재발행하지 않는다', async () => {
    const w = makeWorld(); const [a] = w.devices;
    asHost(a, w); armAllChosen(w);
    let n = 0;
    a.impl.publishHostRoundResult = async () => {
      n += 1;
      // REAL publishHostRoundResult 와 동일하게 결과를 참가자 행에 인코딩한다.
      for (const id of ['p0', 'p1', 'p2']) {
        rowOf(w, id).choice = a.impl.encodeRoundChoice('rock', 'draw', false);
      }
    };
    await refresh(w, a);
    expect(n).toBe(1);
    // 두 번째 재조회(= 늦게 도착한 Trigger B 상당)는 멱등 가드에 걸린다.
    await refresh(w, a);
    expect(n).toBe(1);
  });

  it('B 가 먼저 결과를 인코딩했으면 뒤늦은 A 재조회는 발행하지 않는다', async () => {
    const w = makeWorld(); const [a] = w.devices;
    asHost(a, w);
    for (const id of ['p0', 'p1', 'p2']) {
      rowOf(w, id).choice = a.impl.encodeRoundChoice('rock', 'draw', false);
    }
    let n = 0; a.impl.publishHostRoundResult = async () => { n += 1; };
    await refresh(w, a);
    expect(n).toBe(0);
  });

  it('거의 동시에 두 재조회가 겹쳐도 권위 결과는 하나다', async () => {
    const w = makeWorld(); const [a] = w.devices;
    asHost(a, w); armAllChosen(w);
    let n = 0;
    a.impl.publishHostRoundResult = async () => {
      n += 1;
      for (const id of ['p0', 'p1', 'p2']) {
        rowOf(w, id).choice = a.impl.encodeRoundChoice('rock', 'draw', false);
      }
    };
    // 두 번째 호출은 busy/pending 가드에 걸려 즉시 반환하고 재예약된다.
    const p1 = refreshParticipantsAuthoritative({ db: a.env.db, roomStore: w.roomStore, implRef: () => a.impl });
    const p2 = refreshParticipantsAuthoritative({ db: a.env.db, roomStore: w.roomStore, implRef: () => a.impl });
    await vi.advanceTimersByTimeAsync(3000);
    await p1; await p2;
    expect(n).toBe(1);
  });
});

describe('[R1b] 권위 이전 / 라운드·방 식별', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date(1_800_000_000_000)); });
  afterEach(() => { vi.useRealTimers(); });

  it('권위가 넘어간 뒤 옛 host 는 발행하지 않는다', async () => {
    const w = makeWorld(); const [a] = w.devices;
    asHost(a, w); armAllChosen(w);
    // DB 에서만 host 를 옮긴다.
    rowOf(w, 'p0').is_host = false; rowOf(w, 'p1').is_host = true;
    let n = 0; a.impl.publishHostRoundResult = async () => { n += 1; };
    await refresh(w, a);
    expect(a.impl.state.role).toBe('participant');
    expect(n).toBe(0);
  });

  it('새 host 는 같은 시점에 권위를 얻어 발행한다', async () => {
    const w = makeWorld(); const [, b] = w.devices;
    b.impl.state.roomCode = w.roomStore.id;
    b.impl.state.role = 'participant';
    b.impl.state.status = 'playing';
    armAllChosen(w);
    rowOf(w, 'p0').is_host = false; rowOf(w, 'p1').is_host = true;
    // §9: 목표는 "함수 호출 1회"가 아니라 **권위 결과가 하나**인 것이다.
    // 승계 직후에는 REAL rearmHostProgressionAuthority() 가 판정 백스톱을 다시 세우므로
    // 발행 경로가 둘 이상 열릴 수 있다 — 프로덕션은 그것을 호출 횟수가 아니라
    // publishingRoundResult 래치와 hasConfirmedRoundResult 멱등 가드로 수렴시킨다.
    // 그래서 스텁도 REAL 과 같이 결과를 참가자 행에 인코딩해야 그 가드가 작동한다.
    const outcomes = [];
    b.impl.publishHostRoundResult = async () => {
      const already = [...w.roomStore.participants.values()]
        .some((r) => b.impl.hasConfirmedRoundResult(r.choice));
      if (already) return;               // ④ 멱등 가드(index.html:7053)
      outcomes.push('published');
      for (const id of ['p0', 'p1', 'p2']) {
        rowOf(w, id).choice = b.impl.encodeRoundChoice('rock', 'draw', false);
      }
    };
    await refresh(w, b);
    expect(b.impl.state.role).toBe('host');
    expect(outcomes).toEqual(['published']);   // 권위 결과는 정확히 하나
  });

  it('다른 방(roomCode 불일치)의 재조회는 이 방 결과를 발행하지 않는다', async () => {
    const w = makeWorld(); const [a] = w.devices;
    asHost(a, w); a.impl.state.roomCode = 'OTHER-ROOM';
    armAllChosen(w);
    let n = 0; a.impl.publishHostRoundResult = async () => { n += 1; };
    await refresh(w, a);
    expect(n).toBe(0);
  });

  it('status 가 playing 이 아니면(라운드 경계) 발행하지 않는다', async () => {
    const w = makeWorld(); const [a] = w.devices;
    asHost(a, w); a.impl.state.status = 'result';
    armAllChosen(w);
    let n = 0; a.impl.publishHostRoundResult = async () => { n += 1; };
    await refresh(w, a);
    expect(n).toBe(0);
  });
});

describe('[R1b] 이벤트 계층 — 0행 / 중복 / 시퀀스 폐기', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date(1_800_000_000_000)); });
  afterEach(() => { vi.useRealTimers(); });

  it('중복 participants 이벤트가 와도 권위 결과는 하나다', async () => {
    const w = makeWorld(); const [a] = w.devices;
    asHost(a, w); armAllChosen(w);
    let n = 0;
    a.impl.publishHostRoundResult = async () => {
      n += 1;
      for (const id of ['p0', 'p1', 'p2']) {
        rowOf(w, id).choice = a.impl.encodeRoundChoice('rock', 'draw', false);
      }
    };
    await refresh(w, a); await refresh(w, a); await refresh(w, a);
    expect(n).toBe(1);
  });

  it('시퀀스 가드로 폐기된 재조회는 발행하지 않는다', async () => {
    const w = makeWorld(); const [a] = w.devices;
    asHost(a, w); armAllChosen(w);
    let n = 0; a.impl.publishHostRoundResult = async () => { n += 1; };
    const db = {
      from: () => ({
        select() { return this; }, eq() { return this; },
        async order() {
          a.impl.state._fetchParticipantsSeq += 5;
          return { data: [...w.roomStore.participants.values()] };
        },
      }),
    };
    await refreshParticipantsAuthoritative({ db, roomStore: w.roomStore, implRef: () => a.impl });
    expect(n).toBe(0);
  });
});

describe('[R1b] REAL publishHostRoundResult 자체 방어 (스텁 없음)', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date(1_800_000_000_000)); });
  afterEach(() => { vi.useRealTimers(); });

  // codex-critic 지적: 위 테스트들은 publishHostRoundResult 를 스텁으로 갈아끼우므로
  // REAL 함수 자신의 5가지 방어(가드/래치/자체 재조회/멱등/전원선택)는 실행되지 않는다.
  // 여기서는 **언스텁 상태의 REAL 함수**를 직접 호출해 그 방어가 실제로 동작함을 확인한다.
  const runReal = async (d, arg) => {
    const p = d.impl.publishHostRoundResult(arg);
    await vi.advanceTimersByTimeAsync(3000);
    return p;
  };

  it('① 비호스트는 아무것도 쓰지 않는다', async () => {
    const w = makeWorld(); const [, b] = w.devices;
    b.impl.state.roomCode = w.roomStore.id;
    b.impl.state.role = 'participant';
    b.impl.state.status = 'playing';
    armAllChosen(w);
    await runReal(b);
    for (const id of ['p0', 'p1', 'p2']) {
      expect(b.impl.hasConfirmedRoundResult(rowOf(w, id).choice)).toBe(false);
    }
  });

  it('① status 가 playing 이 아니면 아무것도 쓰지 않는다', async () => {
    const w = makeWorld(); const [a] = w.devices;
    asHost(a, w); a.impl.state.status = 'ready';
    armAllChosen(w);
    await runReal(a);
    for (const id of ['p0', 'p1', 'p2']) {
      expect(a.impl.hasConfirmedRoundResult(rowOf(w, id).choice)).toBe(false);
    }
  });

  it('⑤ 전원이 선택하지 않았으면 결과를 쓰지 않는다', async () => {
    const w = makeWorld(); const [a] = w.devices;
    asHost(a, w);
    rowOf(w, 'p0').choice = 'rock'; rowOf(w, 'p1').choice = 'rock';
    await runReal(a);
    expect(a.impl.hasConfirmedRoundResult(rowOf(w, 'p0').choice)).toBe(false);
  });

  it('전원 선택 완료면 REAL 함수가 참가자 행에 결과를 인코딩한다', async () => {
    const w = makeWorld(); const [a] = w.devices;
    asHost(a, w); armAllChosen(w);
    await runReal(a);
    for (const id of ['p0', 'p1', 'p2']) {
      expect(a.impl.hasConfirmedRoundResult(rowOf(w, id).choice)).toBe(true);
    }
  });

  it('④ 멱등: 이미 인코딩된 라운드를 다시 호출해도 승패 카운트가 증가하지 않는다', async () => {
    const w = makeWorld(); const [a] = w.devices;
    asHost(a, w); armAllChosen(w);
    await runReal(a);
    const snap = ['p0', 'p1', 'p2'].map((id) => {
      const r = rowOf(w, id);
      return { id, wins: r.wins, losses: r.losses, draws: r.draws };
    });
    // 두 번째 호출 — REAL 멱등 가드(index.html:7053)가 재판정을 막아야 한다.
    await runReal(a);
    // 검증 대상은 **승패 통계의 멱등성**이다. `choice` 는 여기 포함하지 않는다 —
    // JP-BL-027-D(strict 권위 모드) 이후에는 결과 발행 뒤 room→'result' 전파가 실제로
    // 일어나 라운드가 정상 진행하고, 그 과정에서 choice 가 다음 라운드용으로 리셋된다.
    // 그것은 이중 집계가 아니라 **정상적인 라운드 진행**이므로 멱등성 판정에 섞지 않는다.
    for (const s of snap) {
      const r = rowOf(w, s.id);
      expect({ wins: r.wins, losses: r.losses, draws: r.draws })
        .toEqual({ wins: s.wins, losses: s.losses, draws: s.draws });
    }
  });

  it('② in-flight 래치: 겹쳐 호출해도 통계가 이중 집계되지 않는다', async () => {
    const w = makeWorld(); const [a] = w.devices;
    asHost(a, w); armAllChosen(w);
    const p1 = a.impl.publishHostRoundResult();
    const p2 = a.impl.publishHostRoundResult();
    await vi.advanceTimersByTimeAsync(3000);
    await p1; await p2;
    for (const id of ['p0', 'p1', 'p2']) {
      const r = rowOf(w, id);
      expect((r.wins || 0) + (r.losses || 0) + (r.draws || 0)).toBe(1);
    }
  });

  it('③ 자체 권위 재조회: 낡은 스냅샷을 넘겨도 신선한 DB 행을 기준으로 판정한다', async () => {
    const w = makeWorld(); const [a] = w.devices;
    asHost(a, w); armAllChosen(w, 'rock');
    // 인자로는 "아직 아무도 선택하지 않은" 낡은 스냅샷을 준다.
    const staleSnapshot = ['p0', 'p1', 'p2'].map((id) => ({ ...rowOf(w, id), choice: null }));
    await runReal(a, staleSnapshot);
    // 자체 재조회(7041-7043)가 낡은 스냅샷을 덮어쓰므로 정상 판정된다.
    for (const id of ['p0', 'p1', 'p2']) {
      expect(a.impl.hasConfirmedRoundResult(rowOf(w, id).choice)).toBe(true);
    }
  });
});
