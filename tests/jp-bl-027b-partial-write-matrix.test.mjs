// JP-BL-027-B §2 — nextRound 의 순차 write W1~W4 부분 성공 매트릭스. (CORE)
//
// REAL nextRound 텍스트(index.html 에서 추출)를 격리 실행한다. 기대 동작을 발명하지 않는다.
// 각 단계에서 0행 / 부분행 / error 를 주입하고 다음을 확인한다:
//   - 로컬이 "다음 라운드 성공"으로 커밋되지 않는가
//   - 실패가 명시적으로 표면화되는가 (ZERO_ROW_WRITE metric + throw)
//   - 재시도가 변이를 누적시키지 않는가
//   - stale safe/loser 마커가 잘못된 승패 상태를 만들지 않는가
//   - 권위 재조회로 수렴 가능한가
import { describe, it, expect } from 'vitest';
import { EXTRACTED_SOURCE_BLOCKS } from './rc3-harness-support.mjs';

const SRC = EXTRACTED_SOURCE_BLOCKS.nextRound;

// ── 주입 가능한 결정적 fake DB ────────────────────────────────────────────────
// stage: 'preread' | 'reset' | 'markSafe' | 'markLoser' | 'advance'
// mode : 'ok' | 'zero' | 'partial' | 'error'
function makeDb({ participants, roomId, failAt = null, mode = 'ok' }) {
  const rows = participants.map((p) => ({ ...p }));
  const room = { id: roomId, round: 1, status: 'result', penalty: '' };
  const log = [];
  const hit = (stage) => (failAt === stage ? mode : 'ok');

  function builder(table, op, patch) {
    const filters = [];
    let selected = false;
    const b = {
      eq(c, v) { filters.push({ c, v }); return b; },
      in(c, v) { filters.push({ c, v, op: 'in' }); return b; },
      order() { return b; },
      select() { selected = true; return b; },
      then(res, rej) { return exec().then(res, rej); },
    };
    async function exec() {
      const match = (r) => filters.every((f) => (f.op === 'in' ? f.v.includes(r[f.c]) : r[f.c] === f.v));
      // 어느 단계인지 식별
      let stage = null;
      if (table === 'participants' && op === 'select') stage = 'preread';
      else if (table === 'participants' && op === 'update' && patch && patch.choice === null) stage = 'reset';
      else if (table === 'participants' && op === 'update' && patch && patch.choice === '__safe__') stage = 'markSafe';
      else if (table === 'participants' && op === 'update' && patch && patch.choice === '__loser__') stage = 'markLoser';
      else if (table === 'rooms' && op === 'update') stage = 'advance';
      const m = stage ? hit(stage) : 'ok';
      log.push({ stage, op, table, mode: m });

      if (m === 'error') return { data: null, error: { message: `[injected] ${stage} failed` } };

      const target = (table === 'rooms' ? [room] : rows).filter(match);
      if (op === 'select') {
        if (m === 'zero') return { data: [], error: null };
        if (m === 'partial') return { data: target.slice(0, 1).map((r) => ({ id: r.id })), error: null };
        return { data: target.map((r) => ({ id: r.id })), error: null };
      }
      // update
      if (m === 'zero') return { data: selected ? [] : null, error: null };
      if (m === 'partial') {
        const half = target.slice(0, Math.max(0, target.length - 1));
        half.forEach((r) => Object.assign(r, patch));
        return { data: selected ? half.map((r) => ({ id: r.id })) : null, error: null };
      }
      target.forEach((r) => Object.assign(r, patch));
      return { data: selected ? target.map((r) => ({ id: r.id })) : null, error: null };
    }
    return b;
  }
  return {
    rows, room, log,
    from(table) {
      return {
        update: (p) => builder(table, 'update', p),
        select: () => builder(table, 'select'),
      };
    },
  };
}

// REAL nextRound 를 최소 env 로 실행한다.
function runNextRound({ failAt = null, mode = 'ok', participantIds = ['H', 'G'], safeIds = [], loserIds = [] }) {
  const db = makeDb({ participants: participantIds.map((id) => ({ id, room_id: 'R1', choice: 'rock', is_ready: true })), roomId: 'R1', failAt, mode });
  const metrics = [];
  const toasts = [];
  const state = {
    roomCode: 'R1', round: 1, status: 'result', role: 'host',
    confirmedSafeIds: [...safeIds], confirmedLoserIds: [...loserIds],
    advancingRound: false, rematchAdvanceTimer: null, rematchAdvanceRetryAttempts: {},
    penalty: 'p0', participants: participantIds.map((id) => ({ id })),
  };
  const env = {
    db, state,
    QA: { emit: (kind, payload) => metrics.push({ kind, ...payload }) },
    getOnlineMode: () => true,
    isRoomClosingOrDestroyed: () => false,
    getTargetLoserCount: () => 99,
    getGameRound: () => 1,
    getNextPhaseScheduledAt: () => 1_800_000_000_000,
    buildPenaltyValue: (o) => JSON.stringify(o),
    getRematchAdvanceRetryKey: () => 'R1:1:1',
    buildAutoAdvanceMetricPayload: (o) => ({ eventType: 'AUTO_ADVANCE_NEXTROUND_FAILED', ...o }),
    scheduleRematchAdvanceRetryAfterFailure: () => { env.__retryScheduled = (env.__retryScheduled || 0) + 1; },
    showToast: (m) => toasts.push(m),
    t: (k) => k,
    renderRoundResult: () => {}, showScreen: () => {}, showTaggerPopup: () => {},
    clearTimeout: () => {}, console: { warn: () => {} },
    __retryScheduled: 0,
  };
  const keys = Object.keys(env);
  // eslint-disable-next-line no-new-func
  const fn = new Function(...keys, `${SRC}; return nextRound;`)(...keys.map((k) => env[k]));
  return { run: fn, db, state, metrics, toasts, env };
}

const zeroRowMetrics = (metrics) => metrics.filter((m) => m.eventType === 'ZERO_ROW_WRITE');

describe('[JP-BL-027-B §2] 정상 경로', () => {
  it('전 단계 성공이면 방이 다음 라운드로 진행하고 0행 metric 이 없다', async () => {
    const h = runNextRound({});
    await h.run();
    expect(h.db.room.round).toBe(2);
    expect(h.db.room.status).toBe('ready');
    expect(zeroRowMetrics(h.metrics)).toHaveLength(0);
    // 참가자는 전원 리셋됐다.
    for (const r of h.db.rows) { expect(r.choice).toBeNull(); expect(r.is_ready).toBe(false); }
  });
});

describe('[JP-BL-027-B §2] W1 participants.reset — 0행 / 부분행', () => {
  for (const mode of ['zero', 'partial']) {
    it(`reset ${mode} 이면 방은 진행하지 않고 실패가 표면화된다`, async () => {
      const h = runNextRound({ failAt: 'reset', mode });
      await h.run();
      // 로컬이 다음 라운드 성공으로 커밋되지 않았다.
      expect(h.db.room.round, '방이 진행되면 안 된다').toBe(1);
      expect(h.db.room.status).toBe('result');
      // 실패가 명시적으로 표면화된다.
      expect(zeroRowMetrics(h.metrics).length, 'ZERO_ROW_WRITE 미발생').toBeGreaterThanOrEqual(1);
      expect(zeroRowMetrics(h.metrics)[0].context).toBe('nextRound.participants.reset');
      // 재시도가 가능하도록 advancingRound 가 풀렸다.
      expect(h.state.advancingRound).toBe(false);
    });
  }

  it('부분 reset(2명 중 1명)은 >=1 계약으로는 통과하지만 집합 대조로 탐지된다', async () => {
    const h = runNextRound({ failAt: 'reset', mode: 'partial', participantIds: ['H', 'G'] });
    await h.run();
    const m = zeroRowMetrics(h.metrics)[0];
    expect(m, '부분 write 가 탐지되지 않았다').toBeTruthy();
    expect(m.expectedRows).toBe(2);
    expect(m.affectedRows).toBe(1);
  });
});

describe('[JP-BL-027-B §2] W2/W3 마커 write — 0행 / 부분행', () => {
  it('markSafe 0행이면 방이 진행하지 않는다', async () => {
    const h = runNextRound({ failAt: 'markSafe', mode: 'zero', participantIds: ['H', 'G', 'X'], safeIds: ['G'] });
    await h.run();
    expect(h.db.room.round).toBe(1);
    expect(zeroRowMetrics(h.metrics)[0].context).toBe('nextRound.participants.markSafe');
  });

  it('markLoser 부분행이면 방이 진행하지 않는다', async () => {
    const h = runNextRound({ failAt: 'markLoser', mode: 'partial', participantIds: ['H', 'G', 'X'], loserIds: ['G', 'X'] });
    await h.run();
    expect(h.db.room.round).toBe(1);
    const m = zeroRowMetrics(h.metrics)[0];
    expect(m.context).toBe('nextRound.participants.markLoser');
    expect(m.expectedRows).toBe(2);
    expect(m.affectedRows).toBe(1);
  });

  it('W1 성공 + W2 실패 시, 이미 리셋된 참가자가 잘못된 승패 상태로 남지 않는다', async () => {
    const h = runNextRound({ failAt: 'markSafe', mode: 'zero', participantIds: ['H', 'G'], safeIds: ['G'] });
    await h.run();
    // W1 이 적용됐으므로 전원 choice=null. 확정 마커가 없으니 "안전/술래"로 오인될 값이 없다.
    for (const r of h.db.rows) {
      expect(r.choice).toBeNull();
      expect(['__safe__', '__loser__']).not.toContain(r.choice);
    }
  });
});

describe('[JP-BL-027-B §2] W4 rooms.advance — 0행 (가장 치명적)', () => {
  it('advance 0행이면 라운드가 진행되지 않고 실패가 표면화된다', async () => {
    const h = runNextRound({ failAt: 'advance', mode: 'zero' });
    await h.run();
    expect(h.db.room.round, '방이 진행되면 안 된다').toBe(1);
    expect(h.db.room.status).toBe('result');
    const m = zeroRowMetrics(h.metrics)[0];
    expect(m.context).toBe('nextRound.rooms.advance');
    expect(m.expectedRows).toBe(1);
    expect(m.affectedRows).toBe(0);
  });

  it('advance 실패 시 재시도 카운터가 정리되지 않는다 (성공으로 오인 금지)', async () => {
    const h = runNextRound({ failAt: 'advance', mode: 'zero' });
    h.state.rematchAdvanceRetryAttempts['R1:1:1'] = 2;
    await h.run();
    expect(h.state.rematchAdvanceRetryAttempts['R1:1:1'], '실패했는데 카운터가 지워졌다').toBe(2);
  });
});

describe('[JP-BL-027-B §2] 재시도가 변이를 누적시키지 않는다', () => {
  it('W4 0행으로 실패한 뒤 재시도해도 라운드는 한 번만 올라간다', async () => {
    // 1회차: advance 0행 실패
    const h1 = runNextRound({ failAt: 'advance', mode: 'zero' });
    await h1.run();
    expect(h1.db.room.round).toBe(1);
    // 2회차: 주입 없이 재시도 → 정확히 한 번만 진행
    const h2 = runNextRound({});
    await h2.run();
    expect(h2.db.room.round).toBe(2);
    // 같은 인스턴스에서 한 번 더 부르면 advancingRound 가드가 막는다.
    const before = h2.db.room.round;
    await h2.run();
    expect(h2.db.room.round, '재호출로 라운드가 또 올라갔다').toBe(before);
  });
});

describe('[JP-BL-027-B §2] 권위 조회 계약', () => {
  it('기대 집합은 권위 조회에서 오고, 낡은 state.participants 에서 오지 않는다', async () => {
    // state.participants 는 3명이라고 주장하지만 DB 에는 2명뿐이다.
    const h = runNextRound({ participantIds: ['H', 'G'] });
    h.state.participants = [{ id: 'H' }, { id: 'G' }, { id: 'GHOST' }];
    await h.run();
    // 권위 조회 기준(2명)으로 판정되므로 정상 진행해야 한다.
    expect(h.db.room.round).toBe(2);
    expect(zeroRowMetrics(h.metrics)).toHaveLength(0);
  });

  it('권위 조회 자체가 0행이면 진행하지 않는다', async () => {
    const h = runNextRound({ failAt: 'preread', mode: 'zero' });
    await h.run();
    expect(h.db.room.round).toBe(1);
    expect(zeroRowMetrics(h.metrics)[0].context).toBe('nextRound.participants.preread');
  });
});
