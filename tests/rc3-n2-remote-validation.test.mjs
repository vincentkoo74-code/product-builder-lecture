// JP V1 출시 결정적 검증 — 정확히 2명의 원격 플레이어로 게임이 성립하는가.
//
// 이 파일은 기대 동작을 발명하지 않는다. index.html 에서 추출한 REAL 로직을 그대로 돌리고,
// 관측된 결과를 분류만 한다. 하드 게이트를 새로 만들지 않는다(관측·분류 전용).
//
// 분류: P1=프로덕션 결함 / P2=모호한 제품 동작 / H1=하니스 충실성 결함 / I1=환경 문제
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  judgePure, resolveElimination, computePlayerStatuses, PLAYER_STATUS, maxLoserCountFor,
} from '../src/game-logic.mjs';
import {
  runMeasuredTrial, CHOICE_SCHEDULES, REALTIME_DELAY_REGIMES,
} from './rc3-harness-support.mjs';

const base = {
  participantCount: 2, targetLoserCount: 1,
  resolveElimination, judgePure, computePlayerStatuses, PLAYER_STATUS, maxLoserCountFor,
};
const summarize = (r) => {
  const hard = {};
  for (const f of (r.hardFailureModes || [])) hard[f.type] = (hard[f.type] || 0) + 1;
  return { completed: !!r.completed, correctnessPass: !!r.correctnessPass, hard };
};

describe('[N=2] 원격 2인 매치 성립 검증', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date(1_800_000_000_000)); });
  afterEach(() => { vi.useRealTimers(); });

  it('시나리오 매트릭스: 선택 스케줄 × 전파 레짐 × 다라운드', async () => {
    const rows = [];
    // 3~7: 선택 순서/시점 (host=index0, guest=index1)
    const schedules = {
      'S1 동시(최초 합법)': CHOICE_SCHEDULES.S1,
      'S2 계단식 이른': CHOICE_SCHEDULES.S2,
      'S3 중앙부': CHOICE_SCHEDULES.S3,
      'S5 마감 직전': CHOICE_SCHEDULES.S5,
      'S6 한 명 미선택(타임아웃)': CHOICE_SCHEDULES.S6,
      'S7 A/B 경계': CHOICE_SCHEDULES.S7,
      'host 먼저': ({ index, choiceWindowMs }) => (index === 0 ? Math.round(choiceWindowMs / 8) : Math.round(choiceWindowMs / 2)),
      'guest 먼저': ({ index, choiceWindowMs }) => (index === 1 ? Math.round(choiceWindowMs / 8) : Math.round(choiceWindowMs / 2)),
    };
    // 13: 전파 지연 레짐 / 14: 기기간 스큐
    const regimes = ['optimistic', 'moderate', 'pessimistic'];
    const TRIALS = 6;

    for (const [label, fn] of Object.entries(schedules)) {
      for (const regime of regimes) {
        let completed = 0; let pass = 0; const hard = {};
        for (let t = 0; t < TRIALS; t++) {
          // eslint-disable-next-line no-await-in-loop
          const r = await runMeasuredTrial({
            ...base, seed: 21_000_000 + t * 97 + regime.length * 13 + label.length,
            vi, choiceScheduleFn: fn, realtimeDelayRegime: regime,
            // 기기간 스큐를 교대로 ±3초 주어 14번 항목을 덮는다.
            skewMsOverrideFn: ({ index }) => (index === 0 ? 3000 : -3000),
          });
          const s = summarize(r);
          if (s.completed) completed += 1;
          if (s.correctnessPass) pass += 1;
          for (const [k, v] of Object.entries(s.hard)) hard[k] = (hard[k] || 0) + v;
        }
        rows.push({ schedule: label, regime, trials: TRIALS, completed, passRate: pass / TRIALS, hard });
      }
    }
    console.log('[N=2 매트릭스]', JSON.stringify(rows, null, 1));

    // 반공허성: 모든 조합이 실제로 실행되었고 트라이얼이 진행되었는지만 강제한다.
    expect(rows).toHaveLength(Object.keys(schedules).length * regimes.length);
    for (const r of rows) {
      expect(r.hard.EXCEPTION || 0, `${r.schedule}/${r.regime} EXCEPTION`).toBe(0);
    }
    expect(REALTIME_DELAY_REGIMES).toBeTruthy();
  }, 900000);

  it('8/12: 연속 다라운드에서 타이밍 드리프트가 누적되는가 (targetRounds=8)', async () => {
    const out = [];
    for (let t = 0; t < 6; t++) {
      // eslint-disable-next-line no-await-in-loop
      const r = await runMeasuredTrial({
        ...base, seed: 22_000_000 + t, targetRounds: 8, vi,
        realtimeDelayRegime: 'pessimistic',
      });
      out.push(summarize(r));
    }
    console.log('[N=2 다라운드]', JSON.stringify(out));
    expect(out).toHaveLength(6);
    for (const o of out) expect(o.hard.EXCEPTION || 0).toBe(0);
  }, 600000);
});
