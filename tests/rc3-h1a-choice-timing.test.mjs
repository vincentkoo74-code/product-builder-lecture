// H1-a — 선택 제출 타이밍이 프로덕션이 정의한 합법 구간 안에서만 일어나는가.
//
// 프로덕션 경계(전부 index.html 에서 도출, 이 파일이 발명한 상수는 없다):
//   T_open     = beginRoundTimer() 가 선택 화면을 연 시각 (index.html:9017, 9096)
//   T_deadline = choiceEndAt = choiceStartAt + CHOICE_WINDOW_MS (index.html:5286, 8866)
//   T_autofill = remainingSeconds<=0 인 첫 1000ms tick → host 가 autoFillChoices() (index.html:9120-9130)
//
// 이 파일은 "사람이 몇 ms 만에 손을 낸다"를 주장하지 않는다. 합법 구간 안의
// **결정론적 동시성 스케줄**만 검증한다.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  judgePure, resolveElimination, computePlayerStatuses, PLAYER_STATUS, maxLoserCountFor,
} from '../src/game-logic.mjs';
import {
  createTrialWorld, CHOICE_SCHEDULES, defaultChoiceOffsetMs,
} from './rc3-harness-support.mjs';

const W = 5000; // index.html:5286 CHOICE_WINDOW_MS — 아래 §경계 테스트가 이 값을 실제 impl 과 대조한다.

function makeWorld(participantCount = 4, seed = 3131, choiceScheduleFn = null) {
  return createTrialWorld({
    participantCount, seed, targetLoserCount: 1,
    resolveElimination, judgePure, computePlayerStatuses, PLAYER_STATUS, maxLoserCountFor,
    choiceScheduleFn,
  });
}

describe('[H1-a] 프로덕션 경계가 하니스에 그대로 반영된다', () => {
  it('CHOICE_WINDOW_MS 는 프로덕션 상수(5000)이며 impl 에서 읽는다', () => {
    const w = makeWorld();
    for (const d of w.devices) expect(d.impl.CHOICE_WINDOW_MS).toBe(W);
  });

  it('기본 스케줄은 전원을 창 **내부**(0 < t < W)에 서로 다른 시점으로 배치한다', () => {
    for (const n of [2, 3, 5, 8, 20]) {
      const offs = Array.from({ length: n }, (_, i) => defaultChoiceOffsetMs(i, n, W));
      // 합법 구간 내부
      for (const o of offs) { expect(o).toBeGreaterThan(0); expect(o).toBeLessThan(W); }
      // 전원 동일 타임스탬프가 아니다(H1-a 의 핵심 — 동시성 인공물 제거)
      expect(new Set(offs).size).toBe(n);
      // 단조 증가(결정론적·재현 가능)
      expect([...offs].sort((a, b) => a - b)).toEqual(offs);
    }
  });

  it('모든 스케줄 클래스의 시점은 창 길이의 분수로만 정의되고 합법 구간을 벗어나지 않는다', () => {
    for (const [name, fn] of Object.entries(CHOICE_SCHEDULES)) {
      for (const n of [2, 4, 8]) {
        for (let i = 0; i < n; i++) {
          const o = fn({ index: i, participantCount: n, choiceWindowMs: W, round: 1 });
          if (o === null) continue;            // S6 의 timeout 참가자
          expect(o, `${name}[${i}/${n}]`).toBeGreaterThanOrEqual(0);
          expect(o, `${name}[${i}/${n}]`).toBeLessThan(W);   // T_deadline 이전
        }
      }
    }
  });

  it('S1 은 합법 최초 시점(0)이고, S5/S7 의 마지막 선택은 마감 직전이다', () => {
    expect(CHOICE_SCHEDULES.S1({ index: 0, participantCount: 4, choiceWindowMs: W })).toBe(0);
    expect(CHOICE_SCHEDULES.S5({ index: 3, participantCount: 4, choiceWindowMs: W })).toBe(W - 1);
    // S7 의 비마지막 참가자는 프로덕션 타이머 granularity(1000ms) 한 tick 앞이다.
    expect(CHOICE_SCHEDULES.S7({ index: 0, participantCount: 4, choiceWindowMs: W })).toBe(W - 1000);
  });

  it('S6 은 최소 1명이 수동 선택을 하지 않는다(Trigger B 경로)', () => {
    const n = 4;
    const offs = Array.from({ length: n }, (_, i) => CHOICE_SCHEDULES.S6({ index: i, participantCount: n, choiceWindowMs: W }));
    expect(offs.filter((o) => o === null)).toHaveLength(1);
  });
});

describe('[H1-a] T_open 이전에는 어떤 선택도 제출되지 않는다', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date(1_800_000_000_000)); });
  afterEach(() => { vi.useRealTimers(); });

  it('선택창이 열리지 않은 라운드에서는 participants.choice 가 채워지지 않는다', async () => {
    const w = makeWorld(3);
    // status 만 playing 으로 바꾸고 선택창은 열지 않는다(beginRoundTimer 미발화).
    for (const d of w.devices) {
      d.impl.state.roomCode = w.roomStore.id;
      d.impl.state.status = 'playing';
      d.impl.state.round = 1;
      expect(d.rendered.choiceStartByRound[1]).toBeUndefined();
    }
    await vi.advanceTimersByTimeAsync(W * 2);
    for (const id of ['p0', 'p1', 'p2']) {
      expect(w.roomStore.participants.get(id).choice).toBeNull();
    }
  });
});

describe('[H1-a] 스케줄이 참가자 정체성과 방 격리를 보존한다', () => {
  it('서로 다른 참가자는 서로 다른 오프셋을 받는다(호스트 우선/후순 모두 표현 가능)', () => {
    const n = 5;
    const hostFirst = (i) => CHOICE_SCHEDULES.S2({ index: i, participantCount: n, choiceWindowMs: W });
    const hostLast = (i) => CHOICE_SCHEDULES.S2({ index: n - 1 - i, participantCount: n, choiceWindowMs: W });
    expect(hostFirst(0)).toBeLessThan(hostFirst(n - 1));   // host(index 0)가 가장 이르다
    expect(hostLast(0)).toBeGreaterThan(hostLast(n - 1));  // host 가 가장 늦다
  });

  it('두 방의 world 는 스케줄을 공유하지 않는다', () => {
    const a = makeWorld(3, 111);
    const b = makeWorld(3, 222);
    expect(a.roomStore.id).not.toBe(b.roomStore.id);
    for (const d of a.devices) expect(d.roomStore.id).toBe(a.roomStore.id);
    for (const d of b.devices) expect(d.roomStore.id).toBe(b.roomStore.id);
  });
});

describe('[H1-a] 스케줄은 결정론적이고 재현 가능하다', () => {
  it('같은 입력은 항상 같은 오프셋을 준다(무작위 없음)', () => {
    for (const [, fn] of Object.entries(CHOICE_SCHEDULES)) {
      for (let k = 0; k < 3; k++) {
        expect(fn({ index: 2, participantCount: 6, choiceWindowMs: W, round: 3 }))
          .toBe(fn({ index: 2, participantCount: 6, choiceWindowMs: W, round: 3 }));
      }
    }
  });

  it('오프셋은 창 길이에 비례한다(독립 wall-clock 상수가 아님)', () => {
    // 창 길이를 2배로 주면 모든 시점이 (반올림 오차 내에서) 2배가 되어야 한다.
    for (const [name, fn] of Object.entries(CHOICE_SCHEDULES)) {
      const a = fn({ index: 1, participantCount: 4, choiceWindowMs: 1000 });
      const b = fn({ index: 1, participantCount: 4, choiceWindowMs: 2000 });
      if (a === null || b === null) continue;
      if (name === 'S5' || name === 'S7') continue; // 마감-ε / tick 기준(절대 granularity 참조)
      expect(Math.abs(b - 2 * a), name).toBeLessThanOrEqual(2);
    }
  });
});
