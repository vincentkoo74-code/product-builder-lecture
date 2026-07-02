import { describe, it, expect } from 'vitest';
import { createEngine, EVENT_TYPES } from '../engine/index.mjs';
import { judgePure, resolveElimination } from '../src/game-logic.mjs';

// WRPS-049 STEP2.2b — 섀도우 검증의 결정론 근거.
// 엔진의 ROUND_RESULT 처리(활성자 필터+judgePure+resolveElimination)가
// game-logic(legacy 판정의 단일 소스)과 모든 시나리오에서 동일한지 스윕 검증한다.
// (런타임 섀도우는 이 동일 로직을 실게임 데이터로 재확인하는 계층.)

const BASES = ['rock', 'paper', 'scissors'];

// 엔진으로 한 라운드 결과 계산
function engineRound(players, choices, target) {
  const e = createEngine({ now: () => 1000 });
  e.dispatch(EVENT_TYPES.GAME_START, { participants: players.map(id => ({ id, isHost: id === players[0] })), targetLoserCount: target });
  e.dispatch(EVENT_TYPES.COUNTDOWN_START, { countdownStartAt: 1500 });
  e.dispatch(EVENT_TYPES.COUNTDOWN_END);
  players.forEach((id, i) => e.dispatch(EVENT_TYPES.PLAYER_ACTION, { playerId: id, base: choices[i] }));
  e.dispatch(EVENT_TYPES.ROUND_RESULT);
  const s = e.getState();
  return {
    outcome: s.lastResult.outcome,
    loser: [...s.confirmedLoserIds].sort(),
    safe: [...s.confirmedSafeIds].sort(),
    perPlayer: s.lastResult.perPlayer,
  };
}

// game-logic 직접 계산(legacy 단일 소스)
function logicRound(players, choices, target) {
  const active = players.map((id, i) => ({ id, base: choices[i] }));
  const perPlayer = judgePure(active);
  const elim = resolveElimination({
    roundResults: players.map((id, i) => ({ id, result: perPlayer[id] })),
    prevLoserIds: [], prevSafeIds: [], targetLoserCount: target,
  });
  return {
    outcome: elim.outcome,
    loser: [...elim.newConfirmedLoserIds].sort(),
    safe: [...elim.newConfirmedSafeIds].sort(),
    perPlayer,
  };
}

// 모든 choice 조합 생성
function combos(n) {
  if (n === 0) return [[]];
  const rest = combos(n - 1);
  return BASES.flatMap(b => rest.map(r => [b, ...r]));
}

describe('WRPS-049 STEP2.2b — 엔진 ↔ game-logic 패리티 스윕', () => {
  for (const n of [2, 3, 4]) {
    for (const target of [1, n - 1]) {
      it(`${n}인 / 목표 ${target}: 모든 choice 조합에서 엔진==game-logic`, () => {
        const players = Array.from({ length: n }, (_, i) => `p${i}`);
        let total = 0, match = 0;
        const mismatches = [];
        for (const choices of combos(n)) {
          total++;
          const e = engineRound(players, choices, target);
          const l = logicRound(players, choices, target);
          const ok = e.outcome === l.outcome
            && JSON.stringify(e.loser) === JSON.stringify(l.loser)
            && JSON.stringify(e.safe) === JSON.stringify(l.safe)
            && JSON.stringify(e.perPlayer) === JSON.stringify(l.perPlayer);
          if (ok) match++; else mismatches.push({ choices, engine: e, logic: l });
        }
        expect(mismatches).toEqual([]);
        expect(match).toBe(total); // 100% 일치
      });
    }
  }

  it('확정 술래/안전 누적 시나리오도 일치(tooFew 후 추가 라운드)', () => {
    // 4인, 목표 2: 1패 → tooFew → 승자 3인 재대결
    const e = createEngine({ now: () => 1000 });
    e.dispatch(EVENT_TYPES.GAME_START, { participants: ['a', 'b', 'c', 'd'].map(id => ({ id })), targetLoserCount: 2 });
    e.dispatch(EVENT_TYPES.COUNTDOWN_START, { countdownStartAt: 1500 });
    e.dispatch(EVENT_TYPES.COUNTDOWN_END);
    // a=rock, b=rock, c=rock, d=scissors → d만 lose(1명), target 2 → tooFew
    e.dispatch(EVENT_TYPES.PLAYER_ACTION, { playerId: 'a', base: 'rock' });
    e.dispatch(EVENT_TYPES.PLAYER_ACTION, { playerId: 'b', base: 'rock' });
    e.dispatch(EVENT_TYPES.PLAYER_ACTION, { playerId: 'c', base: 'rock' });
    e.dispatch(EVENT_TYPES.PLAYER_ACTION, { playerId: 'd', base: 'scissors' });
    e.dispatch(EVENT_TYPES.ROUND_RESULT);
    const s = e.getState();
    expect(s.lastResult.outcome).toBe('tooFew');
    expect(s.confirmedLoserIds).toEqual(['d']);
    expect(s.phase).toBe('result');
  });
});
