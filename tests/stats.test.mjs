import { describe, it, expect } from 'vitest';
import { summarizeGameStats } from '../src/game-logic.mjs';

describe('summarizeGameStats — 전적 집계 정확성 (항목 3)', () => {
  it('승/패/무/승률을 행 그대로 정확히 산출 (승률은 무승부 제외)', () => {
    const rows = [
      { id: 'a', name: 'Ann', wins: 3, losses: 1, draws: 2, penalties: 1 },
      { id: 'b', name: 'Bob', wins: 1, losses: 3, draws: 0, penalties: 3 },
    ];
    const out = summarizeGameStats(rows);
    expect(out[0]).toMatchObject({ id: 'a', wins: 3, losses: 1, draws: 2, games: 6, winRate: 75 });
    expect(out[1]).toMatchObject({ id: 'b', wins: 1, losses: 3, draws: 0, games: 4, winRate: 25 });
  });

  it('승+패가 0이면 승률 0 (0으로 나눔 방지)', () => {
    const out = summarizeGameStats([{ id: 'a', wins: 0, losses: 0, draws: 5 }]);
    expect(out[0].winRate).toBe(0);
    expect(out[0].games).toBe(5);
  });

  it('승률 반올림이 일관적이다 (2승 1패 → 67%)', () => {
    const out = summarizeGameStats([{ id: 'a', wins: 2, losses: 1, draws: 0 }]);
    expect(out[0].winRate).toBe(67);
  });

  it('is_host / isHost 양쪽 키를 모두 인식한다', () => {
    const out = summarizeGameStats([
      { id: 'h', is_host: true, wins: 0, losses: 0, draws: 0 },
      { id: 'a', isHost: false, wins: 1, losses: 0, draws: 0 },
    ]);
    expect(out[0].isHost).toBe(true);
    expect(out[1].isHost).toBe(false);
  });

  it('중간 이탈자의 부분 기록도 보존된다 (행이 있으면 그대로 집계)', () => {
    // 이탈 전 2승 1패만 기록된 참가자
    const out = summarizeGameStats([{ id: 'left', name: 'Lee', wins: 2, losses: 1, draws: 0, penalties: 1 }]);
    expect(out[0]).toMatchObject({ wins: 2, losses: 1, penalties: 1, winRate: 67 });
  });

  it('멱등: 권위 행 기반이라 재호출해도 누적/이중집계가 없다', () => {
    const rows = [{ id: 'a', wins: 2, losses: 2, draws: 1 }];
    const a = summarizeGameStats(rows);
    const b = summarizeGameStats(rows);
    expect(a).toEqual(b);
    expect(a[0].wins).toBe(2); // 입력 그대로, 증폭 없음
  });

  it('빈 입력은 빈 배열', () => {
    expect(summarizeGameStats([])).toEqual([]);
    expect(summarizeGameStats(undefined)).toEqual([]);
  });
});
