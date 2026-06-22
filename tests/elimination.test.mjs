import { describe, it, expect } from 'vitest';
import {
  judgePure,
  getWinningChoice,
  computePlayerStatuses,
  getActiveIds,
  resolveElimination,
  maxLoserCountFor,
  PLAYER_STATUS,
} from '../src/game-logic.mjs';

// 라운드 단위 술래-소거 시뮬레이터.
// players: [{ id, isHost? }], choicesByRound(round, activeIds) → { [id]: 'scissors'|'rock'|'paper' }
// WRPS-042/043: 호스트도 일반 플레이어 → 활성 집합/선택/술래 대상에 포함된다(isHost는 게임 판정에 무영향).
function simulate({ players, targetLoserCount, choicesByRound, maxRounds = 50 }) {
  let confirmedLoserIds = [];
  let confirmedSafeIds = [];
  const transitions = [];
  for (let round = 1; round <= maxRounds; round++) {
    const activeIds = getActiveIds(players, confirmedSafeIds, confirmedLoserIds);

    if (activeIds.length === 0) {
      transitions.push({ round, outcome: 'noActive', activeIds });
      break;
    }

    const choiceMap = choicesByRound(round, activeIds);
    const active = activeIds.map((id) => ({ id, base: choiceMap[id] }));
    const judged = judgePure(active);
    const roundResults = activeIds.map((id) => ({ id, result: judged[id] }));

    const res = resolveElimination({
      roundResults,
      prevLoserIds: confirmedLoserIds,
      prevSafeIds: confirmedSafeIds,
      targetLoserCount,
    });

    // nextActiveIds 가 다음 라운드 실제 활성 집합과 일치하는지(자기일관성) 검증.
    const predictedNext = getActiveIds(players, res.newConfirmedSafeIds, res.newConfirmedLoserIds);
    expect([...res.nextActiveIds].sort()).toEqual([...predictedNext].sort());

    confirmedLoserIds = res.newConfirmedLoserIds;
    confirmedSafeIds = res.newConfirmedSafeIds;
    transitions.push({ round, outcome: res.outcome, activeIds: [...activeIds], confirmedLoserIds: [...confirmedLoserIds] });

    if (res.isComplete) break;
  }
  return { confirmedLoserIds, confirmedSafeIds, transitions };
}

// 라운드마다 정확히 한 명만 지게 만드는 헬퍼: loserId 만 scissors, 나머지 rock.
const oneLoser = (loserId) => (round, activeIds) => {
  const m = {};
  activeIds.forEach((id) => { m[id] = id === loserId ? 'scissors' : 'rock'; });
  return m;
};
// 지정한 여러 명이 지게: losers=scissors, 나머지 rock (단, 전원 동일/3종 방지).
const losersScissors = (loserIds) => (round, activeIds) => {
  const set = new Set(loserIds);
  const m = {};
  activeIds.forEach((id) => { m[id] = set.has(id) ? 'scissors' : 'rock'; });
  return m;
};

describe('judgePure', () => {
  it('2종류: rock vs scissors → rock 승', () => {
    const r = judgePure([{ id: 'a', base: 'rock' }, { id: 'b', base: 'scissors' }]);
    expect(r).toEqual({ a: 'win', b: 'lose' });
  });
  it('1종류(전원 동일) → 전원 무승부', () => {
    const r = judgePure([{ id: 'a', base: 'rock' }, { id: 'b', base: 'rock' }]);
    expect(r).toEqual({ a: 'draw', b: 'draw' });
  });
  it('3종류 전부 → 전원 무승부', () => {
    const r = judgePure([{ id: 'a', base: 'rock' }, { id: 'b', base: 'paper' }, { id: 'c', base: 'scissors' }]);
    expect(r).toEqual({ a: 'draw', b: 'draw', c: 'draw' });
  });
  it('base 없는 사람은 판정에서 제외된다', () => {
    const r = judgePure([{ id: 'a', base: 'rock' }, { id: 'b', base: '' }]);
    expect(r.b).toBeUndefined(); // 선택 안 한 b는 판정 대상 아님
    expect('a' in r).toBe(true); // 남은 활성자만 판정(단독이면 1종류 → draw)
  });
});

describe('getWinningChoice', () => {
  it('가위바위보 상성', () => {
    expect(getWinningChoice('scissors', 'paper')).toBe('scissors');
    expect(getWinningChoice('rock', 'scissors')).toBe('rock');
    expect(getWinningChoice('paper', 'rock')).toBe('paper');
  });
});

describe('computePlayerStatuses', () => {
  it('LOSER_CONFIRMED > WINNER_CONFIRMED > ACTIVE 우선순위 (WRPS-042/043: 호스트도 플레이어 ACTIVE)', () => {
    const players = [
      { id: 'h', isHost: true },
      { id: 'a' },
      { id: 'b' },
      { id: 'c', choice: '__safe__' },
      { id: 'd', choice: '__loser__' },
    ];
    const s = computePlayerStatuses(players, ['a'], ['b']);
    expect(s).toEqual({
      h: 'ACTIVE', a: 'WINNER_CONFIRMED', b: 'LOSER_CONFIRMED', c: 'WINNER_CONFIRMED', d: 'LOSER_CONFIRMED',
    });
  });
});

describe('resolveElimination — 단일 전이', () => {
  const base = { prevLoserIds: [], prevSafeIds: [], targetLoserCount: 2 };
  it('tooFew: 패자 < 남은 슬롯 → 패자 확정, 승자 재대결', () => {
    const r = resolveElimination({ ...base, roundResults: [
      { id: 'a', result: 'win' }, { id: 'b', result: 'win' }, { id: 'c', result: 'lose' },
    ] });
    expect(r.outcome).toBe('tooFew');
    expect(r.newConfirmedLoserIds).toEqual(['c']);
    expect(r.nextActiveIds.sort()).toEqual(['a', 'b']);
    expect(r.isComplete).toBe(false);
  });
  it('gameOver: 패자 == 남은 슬롯 → 종료', () => {
    const r = resolveElimination({ ...base, targetLoserCount: 1, roundResults: [
      { id: 'a', result: 'win' }, { id: 'b', result: 'lose' },
    ] });
    expect(r.outcome).toBe('gameOver');
    expect(r.isComplete).toBe(true);
    expect(r.newConfirmedLoserIds).toEqual(['b']);
  });
  it('tooMany: 패자 > 남은 슬롯 → 패자끼리 재대결, 승자 안전', () => {
    const r = resolveElimination({ ...base, targetLoserCount: 1, roundResults: [
      { id: 'a', result: 'win' }, { id: 'b', result: 'win' }, { id: 'c', result: 'lose' }, { id: 'd', result: 'lose' },
    ] });
    expect(r.outcome).toBe('tooMany');
    expect(r.newConfirmedSafeIds.sort()).toEqual(['a', 'b']);
    expect(r.newConfirmedLoserIds).toEqual([]);
    expect(r.nextActiveIds.sort()).toEqual(['c', 'd']);
  });
  it('allDraw: 전원 무승부 + 활성 > 남은 슬롯 → 같은 후보 재대결', () => {
    // 3명 활성, 목표 1명: 무승부면 다시 가려야 함(아무도 확정 안 됨)
    const r = resolveElimination({ ...base, targetLoserCount: 1, roundResults: [
      { id: 'a', result: 'draw' }, { id: 'b', result: 'draw' }, { id: 'c', result: 'draw' },
    ] });
    expect(r.outcome).toBe('allDraw');
    expect(r.newConfirmedLoserIds).toEqual([]);
    expect(r.nextActiveIds.sort()).toEqual(['a', 'b', 'c']);
  });

  it('활성 <= 남은 슬롯: 전원 술래 확정·종료(중도 퇴장 deadlock 방지)', () => {
    // 남은 활성 1명, 남은 슬롯 1 → 그 1명이 마지막 술래로 확정되고 종료(무승부여도)
    const r = resolveElimination({ prevLoserIds: ['x'], prevSafeIds: [], targetLoserCount: 2,
      roundResults: [{ id: 'a', result: 'draw' }] });
    expect(r.outcome).toBe('gameOver');
    expect(r.isComplete).toBe(true);
    expect(r.newConfirmedLoserIds.sort()).toEqual(['a', 'x']);
  });

  it('활성 == 남은 슬롯(2명/2슬롯): 듀얼 결과와 무관하게 전원 술래·종료', () => {
    const r = resolveElimination({ ...base, targetLoserCount: 2, roundResults: [
      { id: 'a', result: 'win' }, { id: 'b', result: 'lose' },
    ] });
    expect(r.outcome).toBe('gameOver');
    expect(r.newConfirmedLoserIds.sort()).toEqual(['a', 'b']);
  });
});

describe('필수 검증 시나리오 A~F (while currentLoser < target 반복)', () => {
  it('시나리오 A: 3명 / 목표 술래 2명', () => {
    const players = [{ id: 'A' }, { id: 'B' }, { id: 'C' }];
    // R1: C 패(tooFew) → R2: A,B 중 B 패(gameOver)
    const choicesByRound = (round, ids) => (round === 1 ? oneLoser('C')(round, ids) : oneLoser('B')(round, ids));
    const out = simulate({ players, targetLoserCount: 2, choicesByRound });
    expect(out.confirmedLoserIds.sort()).toEqual(['B', 'C']);
    expect(out.confirmedLoserIds).toHaveLength(2);
    expect(out.transitions.map((t) => t.outcome)).toEqual(['tooFew', 'gameOver']);
  });

  it('시나리오 B: 4명 / 목표 술래 2명 (확정자는 재대결 제외)', () => {
    const players = [{ id: 'A' }, { id: 'B' }, { id: 'C' }, { id: 'D' }];
    const choicesByRound = (round, ids) => (round === 1 ? oneLoser('A')(round, ids) : oneLoser('D')(round, ids));
    const out = simulate({ players, targetLoserCount: 2, choicesByRound });
    expect(out.confirmedLoserIds.sort()).toEqual(['A', 'D']);
    // 케이스2: 확정 술래 A 는 2라운드 활성 집합에 없어야 함
    expect(out.transitions[1].activeIds.sort()).toEqual(['B', 'C', 'D']);
  });

  it('시나리오 C: 5명 / 목표 술래 2명', () => {
    const players = ['A', 'B', 'C', 'D', 'E'].map((id) => ({ id }));
    const choicesByRound = (round, ids) => (round === 1 ? oneLoser('E')(round, ids) : oneLoser('D')(round, ids));
    const out = simulate({ players, targetLoserCount: 2, choicesByRound });
    expect(out.confirmedLoserIds.sort()).toEqual(['D', 'E']);
  });

  it('시나리오 D: 5명 / 목표 술래 3명', () => {
    const players = ['A', 'B', 'C', 'D', 'E'].map((id) => ({ id }));
    // R1: D,E 동시 패(tooFew, 2<3) → R2: 남은 A,B,C 중 C 패(gameOver)
    const choicesByRound = (round, ids) => (round === 1 ? losersScissors(['D', 'E'])(round, ids) : oneLoser('C')(round, ids));
    const out = simulate({ players, targetLoserCount: 3, choicesByRound });
    expect(out.confirmedLoserIds.sort()).toEqual(['C', 'D', 'E']);
    expect(out.confirmedLoserIds).toHaveLength(3);
  });

  it('시나리오 E (WRPS-043): 호스트도 플레이어 — 4명(호스트 포함)/술래 2명, 호스트도 술래가 될 수 있다', () => {
    const players = [{ id: 'H', isHost: true }, { id: 'A' }, { id: 'B' }, { id: 'C' }];
    // R1: 호스트 H 패(tooFew 1<2) → R2: 남은 A,B,C 중 C 패(gameOver)
    const choicesByRound = (round, ids) => (round === 1 ? oneLoser('H')(round, ids) : oneLoser('C')(round, ids));
    const out = simulate({ players, targetLoserCount: 2, choicesByRound });
    expect(out.confirmedLoserIds.sort()).toEqual(['C', 'H']);
    expect(out.confirmedLoserIds).toHaveLength(2);
  });

  it('시나리오 F (WRPS-043): 5명(호스트 포함)/술래 2명 — 호스트도 매 라운드 활성에 포함된다', () => {
    const players = [{ id: 'H', isHost: true }, { id: 'A' }, { id: 'B' }, { id: 'C' }, { id: 'D' }];
    const choicesByRound = (round, ids) => {
      expect(ids).toContain('H'); // 미확정 동안 호스트도 활성 플레이어
      return round === 1 ? oneLoser('A')(round, ids) : oneLoser('D')(round, ids);
    };
    const out = simulate({ players, targetLoserCount: 2, choicesByRound });
    expect(out.confirmedLoserIds.sort()).toEqual(['A', 'D']);
  });

  it('tooMany 경유: 4명 / 목표 1명 (패자 2 → 재대결 → 1 확정)', () => {
    const players = ['A', 'B', 'C', 'D'].map((id) => ({ id }));
    const choicesByRound = (round, ids) => (round === 1 ? losersScissors(['C', 'D'])(round, ids) : oneLoser('D')(round, ids));
    const out = simulate({ players, targetLoserCount: 1, choicesByRound });
    expect(out.confirmedLoserIds).toEqual(['D']);
    expect(out.transitions.map((t) => t.outcome)).toEqual(['tooMany', 'gameOver']);
  });

  it('수렴: 모든 시나리오가 목표 술래 수에 정확히 도달하고 멈추지 않는다', () => {
    const players = ['A', 'B', 'C', 'D', 'E'].map((id) => ({ id }));
    const choicesByRound = (round, ids) => oneLoser(ids[ids.length - 1])(round, ids);
    const out = simulate({ players, targetLoserCount: 3, choicesByRound });
    expect(out.confirmedLoserIds).toHaveLength(3);
    expect(out.transitions.at(-1).outcome).toBe('gameOver');
  });
});

// P0 매트릭스: 3/4/5명 × 모든 유효 술래 수(1..players-1)에서 deadlock/무한대기 없이 수렴.
describe('P0 다인전 매트릭스 — 모든 조합 수렴 + 정확성', () => {
  // 라운드마다 "마지막 활성자 1명만 패" → 한 명씩 확정되며 항상 수렴(무승부 없음).
  const stepLoser = (round, ids) => {
    const m = {};
    ids.forEach((id, i) => { m[id] = i === ids.length - 1 ? 'scissors' : 'rock'; });
    return m;
  };

  for (const n of [3, 4, 5]) {
    for (let target = 1; target <= n - 1; target++) {
      it(`${n}명 / 술래 ${target}명 → 정확히 ${target}명 확정, gameOver로 종료`, () => {
        const players = Array.from({ length: n }, (_, i) => ({ id: `P${i + 1}` }));
        const out = simulate({ players, targetLoserCount: target, choicesByRound: stepLoser, maxRounds: 30 });
        expect(out.confirmedLoserIds).toHaveLength(target);
        // 확정 술래는 중복 없음
        expect(new Set(out.confirmedLoserIds).size).toBe(target);
        expect(out.transitions.at(-1).outcome).toBe('gameOver');
        // 술래 + 안전이 전체 플레이어를 넘지 않음
        expect(out.confirmedLoserIds.length + out.confirmedSafeIds.length).toBeLessThanOrEqual(n);
      });
    }
  }

  it('WRPS-043 호스트 포함 매트릭스: 호스트도 플레이어로 카운트 — (n+1)명에서 술래 1..n 모두 수렴', () => {
    for (const n of [3, 4, 5]) {
      const total = n + 1; // 호스트 포함 전체 플레이어 수
      for (let target = 1; target <= total - 1; target++) {
        const players = [{ id: 'HOST', isHost: true },
          ...Array.from({ length: n }, (_, i) => ({ id: `P${i + 1}` }))];
        const out = simulate({ players, targetLoserCount: target, choicesByRound: stepLoser, maxRounds: 30 });
        expect(out.confirmedLoserIds).toHaveLength(target);
        expect(out.transitions.at(-1).outcome).toBe('gameOver');
      }
    }
  });
});

// WRPS-043: 다중 술래 선택 범위(호스트 포함) + 각 목표가 deadlock 없이 달성되는지.
describe('WRPS-043 — 다중 술래 선택 범위 (maxLoserCountFor, 호스트=플레이어)', () => {
  const stepLoser = (round, ids) => {
    const m = {};
    ids.forEach((id, i) => { m[id] = i === ids.length - 1 ? 'scissors' : 'rock'; });
    return m;
  };

  it('N명일 때 maxLosers = N-1', () => {
    expect(maxLoserCountFor(2)).toBe(1);
    expect(maxLoserCountFor(3)).toBe(2);
    expect(maxLoserCountFor(4)).toBe(3);
    expect(maxLoserCountFor(5)).toBe(4);
  });

  it('최소 1 보장(엣지 입력)', () => {
    expect(maxLoserCountFor(1)).toBe(1);
    expect(maxLoserCountFor(0)).toBe(1);
    expect(maxLoserCountFor(undefined)).toBe(1);
  });

  for (const [n, valid] of [[3, [1, 2]], [4, [1, 2, 3]], [5, [1, 2, 3, 4]]]) {
    it(`${n}명 게임(호스트 포함) → 술래 ${valid.join('/')} 선택 가능 + 각 목표 달성`, () => {
      // 선택 범위가 1..(N-1)
      expect(Array.from({ length: maxLoserCountFor(n) }, (_, i) => i + 1)).toEqual(valid);
      // 각 유효 목표가 실제 소거에서 정확히 달성(호스트 포함 N명, 1명 승자 남음)
      for (const target of valid) {
        const players = [{ id: 'HOST', isHost: true },
          ...Array.from({ length: n - 1 }, (_, i) => ({ id: `P${i + 1}` }))]; // 호스트 포함 N명
        const out = simulate({ players, targetLoserCount: target, choicesByRound: stepLoser, maxRounds: 30 });
        expect(out.confirmedLoserIds).toHaveLength(target);
        expect(out.transitions.at(-1).outcome).toBe('gameOver');
      }
    });
  }
});

// 중도 퇴장(leave) 시 재계산되어 게임이 멈추지 않고 종료되는지.
describe('P0 중도 퇴장 — 세션 유지 + 수렴', () => {
  function simulateWithLeaves({ players, targetLoserCount, choicesByRound, leaveBeforeRound = () => [], maxRounds = 40 }) {
    let confirmedLoserIds = [];
    let confirmedSafeIds = [];
    let roster = [...players];
    const transitions = [];
    for (let round = 1; round <= maxRounds; round++) {
      // 라운드 시작 전 퇴장 처리(로스터에서 제거 + 확정 집합에서도 제거)
      const leaving = leaveBeforeRound(round) || [];
      if (leaving.length) {
        const gone = new Set(leaving);
        roster = roster.filter((p) => !gone.has(p.id));
        confirmedLoserIds = confirmedLoserIds.filter((id) => !gone.has(id));
        confirmedSafeIds = confirmedSafeIds.filter((id) => !gone.has(id));
      }
      const activeIds = getActiveIds(roster, confirmedSafeIds, confirmedLoserIds);
      if (activeIds.length === 0) { transitions.push({ round, outcome: 'noActive' }); break; }
      const choiceMap = choicesByRound(round, activeIds);
      const judged = judgePure(activeIds.map((id) => ({ id, base: choiceMap[id] })));
      const roundResults = activeIds.map((id) => ({ id, result: judged[id] }));
      const res = resolveElimination({ roundResults, prevLoserIds: confirmedLoserIds, prevSafeIds: confirmedSafeIds, targetLoserCount });
      confirmedLoserIds = res.newConfirmedLoserIds;
      confirmedSafeIds = res.newConfirmedSafeIds;
      transitions.push({ round, outcome: res.outcome });
      if (res.isComplete) break;
    }
    return { confirmedLoserIds, confirmedSafeIds, transitions, roster };
  }

  const stepLoser = (round, ids) => {
    const m = {};
    ids.forEach((id, i) => { m[id] = i === ids.length - 1 ? 'scissors' : 'rock'; });
    return m;
  };

  it('3명/술래2: 1라운드 후 승자 1명이 퇴장해도 멈추지 않고 종료', () => {
    const players = ['A', 'B', 'C'].map((id) => ({ id }));
    // R1: C 패(tooFew). R2 시작 전 승자 B 퇴장 → 활성 1명(A), 남은 슬롯 1 → A 술래 확정·종료.
    const out = simulateWithLeaves({
      players, targetLoserCount: 2,
      choicesByRound: (round, ids) => (round === 1 ? { A: 'rock', B: 'rock', C: 'scissors' } : stepLoser(round, ids)),
      leaveBeforeRound: (round) => (round === 2 ? ['B'] : []),
    });
    expect(out.transitions.at(-1).outcome).toBe('gameOver');
    expect(out.transitions.some((t) => t.outcome === 'noActive')).toBe(false);
    expect(out.confirmedLoserIds.sort()).toEqual(['A', 'C']);
  });

  it('5명/술래3: 라운드마다 1명씩 퇴장해도 deadlock 없이 종료', () => {
    const players = ['A', 'B', 'C', 'D', 'E'].map((id) => ({ id }));
    const out = simulateWithLeaves({
      players, targetLoserCount: 3, choicesByRound: stepLoser,
      leaveBeforeRound: (round) => (round === 3 ? ['A'] : []),
    });
    expect(out.transitions.at(-1).outcome).toBe('gameOver');
    expect(out.confirmedLoserIds.length).toBeGreaterThanOrEqual(1);
    expect(out.confirmedLoserIds.length).toBeLessThanOrEqual(3);
  });
});
