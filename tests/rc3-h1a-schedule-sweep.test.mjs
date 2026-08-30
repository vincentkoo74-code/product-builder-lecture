// H1-a §12 — strict 결과를 **스케줄 클래스별로 분리 측정**한다.
//
// 단일 집계 수치("41건") 대신 S1~S7 각각의 하드게이트/CROSS/타임아웃을 따로 본다.
// 특정 클래스에서만 실패한다면 그 사실 자체가 집계 수치보다 훨씬 유용한 정보다(§12).
//
// 이 파일은 하드 게이트를 새로 만들지 않는다 — 관측/분류 전용이며, 기존 rc3 하드 게이트는
// tests/rc3-multiparticipant-sim.test.mjs 가 그대로 유지한다.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  judgePure, resolveElimination, computePlayerStatuses, PLAYER_STATUS, maxLoserCountFor,
} from '../src/game-logic.mjs';
import {
  runMeasuredTrial, CHOICE_SCHEDULES, HARD_FAILURE_TYPES,
} from './rc3-harness-support.mjs';

const NS = [3, 6, 10, 14, 20];
const TRIALS = 20;
const SCHEDULES = ['S1', 'S2', 'S3', 'S4', 'S5', 'S6', 'S7'];

describe('[H1-a §12] 스케줄 클래스별 strict 측정', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date(1_800_000_000_000)); });
  afterEach(() => { vi.useRealTimers(); });

  it('S1~S7 × N × trial: 클래스별 하드 실패/CROSS 분포를 legacy/strict 각각으로 남긴다', async () => {
    const table = [];
    for (const strictFilters of [false, true]) {
    for (const name of SCHEDULES) {
      for (const n of NS) {
        let completed = 0; let correctnessPass = 0; let rounds = 0;
        const hard = {};
        for (let t = 0; t < TRIALS; t++) {
          const seed = 77_000_000 + SCHEDULES.indexOf(name) * 100000 + n * 1000 + t;
          // eslint-disable-next-line no-await-in-loop
          const res = await runMeasuredTrial({
            participantCount: n, seed, targetLoserCount: 1,
            resolveElimination, judgePure, computePlayerStatuses, PLAYER_STATUS, maxLoserCountFor,
            vi, choiceScheduleFn: CHOICE_SCHEDULES[name],
            // 파일 편집이 아니라 **인자**로 전환한다(동시 실행 오염 불가).
            strictFilters,
          });
          if (!res) continue;
          // 반공허성: runMeasuredTrial 의 실제 반환 필드를 쓴다.
          //   completed          — 전 기기가 targetRounds 까지 결과를 렌더했는가
          //   hardFailureModes   — [범주1] correctness 하드 실패 목록
          //   correctnessPass    — 하드 실패 0 + 정상 완주
          if (res.completed) completed += 1;
          rounds += Object.keys(res.perRoundMaxDiff || {}).length;
          for (const f of (res.hardFailureModes || [])) {
            hard[f.type] = (hard[f.type] || 0) + 1;
          }
          if (res.correctnessPass) correctnessPass += 1;
        }
        table.push({
          mode: strictFilters ? 'strict' : 'legacy',
          schedule: name, n, trials: TRIALS, completed, rounds,
          correctnessPassRate: correctnessPass / TRIALS,
          cross: hard.CROSS_DEVICE_OUTCOME_MISMATCH || 0,
          hard,
        });
      }
    }
    }
    // 관측치를 그대로 남긴다 — 이 표가 §12 보고의 원자료다.
    console.log('[H1-a §12] 스케줄 클래스별 결과:', JSON.stringify(table, null, 2));

    // 반공허성: 표가 실제로 채워졌고 모든 trial 이 완주했는지만 강제한다.
    expect(table).toHaveLength(2 * SCHEDULES.length * NS.length);
    // JP-BL-027-D: strict = 권위 모드(릴리스 게이팅), legacy = 과거 참조 전용(비권위).
    // JP-BL-027-B 이후 nextRound 의 `participants.reset`(.eq('room_id', …))이 영향 행을
    // 검증하게 되면서, **legacy 근사 필터는 게임을 더 이상 진행시키지 못한다** —
    // legacy 는 그 write 를 0행으로 만들고, 프로덕션은 (올바르게) 실패로 승격한다.
    // 이것은 완화가 아니라 **측정된 사실을 계약으로 고정**하는 것이다:
    //   strict = 정확한 시뮬레이터 → 전 trial 완주
    //   legacy = 알려진 부정확 근사 → 완주 0
    // legacy 에서 완주가 다시 발생하면 그것이야말로 회귀 신호다(부정확 경로가 되살아났다는 뜻).
    for (const row of table) {
      expect(row.rounds, `${row.mode}/${row.schedule}/N=${row.n} 라운드`).toBeGreaterThan(0);
      if (row.mode === 'strict') {
        expect(row.completed, `strict/${row.schedule}/N=${row.n} 완주`).toBe(TRIALS);
      } else {
        // legacy 는 비권위 참조 모드다 — 이 값은 릴리스 판단에 쓰지 않는다(JP-BL-027-D).
        expect(row.completed, `legacy/${row.schedule}/N=${row.n} 는 nextRound reset 0행으로 완주 불가`).toBe(0);
      }
    }
    // 하니스 자체 결함(EXCEPTION류)은 어떤 스케줄에서도 0이어야 한다 — 있으면 측정 무효.
    for (const row of table) {
      expect(row.hard.EXCEPTION || 0, `${row.mode}/${row.schedule}/N=${row.n} EXCEPTION`).toBe(0);
      expect(row.hard.CLOCK_SYNC_NOT_SETTLED || 0, `${row.mode}/${row.schedule}/N=${row.n}`).toBe(0);
    }
    expect(Array.isArray(HARD_FAILURE_TYPES)).toBe(true);
  }, 900000);
});
