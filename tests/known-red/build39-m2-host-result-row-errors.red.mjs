import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

// ════════════════════════════════════════════════════════════════════════════
// Build39 M2 (RED, 수정 금지) — host 결과 발행의 per-row write 실패가 흐름에 드러나지 않는다.
//
// 배경: publishHostRoundResult 는 active 참가자마다 독립 UPDATE 를 Promise.all 로 병렬 실행한다.
//   원자성이 없고, 어느 행이 실패해도 그대로 status='result' 로 넘어간다.
//   실패한 행은 base 만 남아 다른 단말의 스냅샷에서 unresolved 로 잡힌다
//   (= gameNo 4 round 1 에서 관측된 2.6초 정체의 후보 M2).
//
// 이 파일이 고정하는 계약:
//   ① 행 write 실패는 QA 에 관측 가능해야 한다  ← Build39 계측으로 이미 충족(GREEN)
//   ② 전부 실패해도 결과 확정으로 넘어가는 현재 동작은 계약 위반이다 ← RED
//
// ⚠️ M1 과 M2 중 무엇이 실제로 일어났는지는 host 증거 없이 고를 수 없다(CEO 지시 2).
//    이 RED 는 M2 경로가 조용히 통과할 수 있음을 고정할 뿐 production 을 고치지 않는다.
// ⚠️ 공허성 방지: 전원 성공 대조군을 함께 둔다.
// ════════════════════════════════════════════════════════════════════════════

const html = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');

function extractBlock(a, b) {
  const s = html.indexOf(a);
  if (s < 0) throw new Error('start marker: ' + a);
  const e = html.indexOf(b, s);
  if (e < 0) throw new Error('end marker: ' + b);
  return html.slice(s, e);
}

const PUB_SRC = extractBlock('async function publishHostRoundResult(', 'function scheduleFetchParticipants');

/** publishHostRoundResult 를 실제 소스에서 실행한다. failIds 의 행 write 만 실패시킨다. */
async function runPublish({ failIds = [] } = {}) {
  const participants = [
    { id: 'h1', is_host: true, choice: 'rock', wins: 0, losses: 0, draws: 0, penalties: 0 },
    { id: 'p2', is_host: false, choice: 'scissors', wins: 0, losses: 0, draws: 0, penalties: 0 },
    { id: 'p3', is_host: false, choice: 'paper', wins: 0, losses: 0, draws: 0, penalties: 0 },
  ];
  const rows = Object.fromEntries(participants.map(p => [p.id, { ...p }]));
  const metrics = [];
  const calls = { statusScheduled: 0, renderAll: 0 };

  const db = {
    from: (table) => ({
      select: () => ({
        eq: () => ({ order: () => Promise.resolve({ data: participants.map(p => ({ ...p })) }) }),
      }),
      update: (patch) => {
        const chain = {
          eq: (col, id) => {
            const fail = failIds.includes(id);
            if (!fail) rows[id] = { ...rows[id], ...patch };
            return Promise.resolve({ error: fail ? { code: '42501', message: 'permission denied' } : null });
          },
        };
        return chain;
      },
    }),
  };

  const state = {
    role: 'host', status: 'playing', roomCode: 'BYZ7', round: 1, gameRound: 4,
    confirmedSafeIds: [], confirmedLoserIds: [], publishingRoundResult: false,
    participants: participants.map(p => ({ ...p })),
  };

  const factory = new Function(
    'db', 'state', 'QA', 'qaRoundCtx', 'qaNextTraceId', 'getGameRound', 'getOnlineMode',
    'isNonPlayingChoice', 'getChoiceBase', 'hasConfirmedRoundResult', 'isAutoChoice',
    'encodeRoundChoice', 'judgeRound', 'updateSelectedCount', 'renderAll', 'updateRoomStatusScheduled',
    PUB_SRC + '\nreturn { publishHostRoundResult };'
  );

  const mod = factory(
    db, state,
    { emit: (_ch, d) => metrics.push(d) },
    () => ({}), (k) => k + ':1', () => 4, () => true,
    (c) => c === '__safe__' || c === '__loser__' || c === '__waiting__',
    (c) => (c ? String(c).split('|')[0] : null),
    (c) => Boolean(c && String(c).split('|')[0] && String(c).split('|')[1]),
    () => false,
    (base, status) => `${base}|${status}`,
    () => ({ h1: 'win', p2: 'lose', p3: 'draw' }),
    () => { }, () => { calls.renderAll++; },
    async () => { calls.statusScheduled++; }
  );

  await mod.publishHostRoundResult();
  return { rows, metrics, calls };
}

const ev = (metrics, type) => metrics.filter(m => m.eventType === type);

describe('M2 — host 결과 발행 per-row write 실패', () => {
  it('전제(공허성 가드): 전원 성공하면 세 행 모두 인코딩된다', async () => {
    const { rows, metrics, calls } = await runPublish({ failIds: [] });
    expect(rows.h1.choice).toBe('rock|win');
    expect(rows.p2.choice).toBe('scissors|lose');
    expect(rows.p3.choice).toBe('paper|draw');
    expect(calls.statusScheduled).toBe(1);
    expect(ev(metrics, 'HOST_RESULT_PUBLISH_END')[0].failed).toBe(0);
  });

  it('[GREEN] 행 write 실패가 QA 에 관측된다 (Build39 계측)', async () => {
    const { metrics } = await runPublish({ failIds: ['p2'] });
    const ends = ev(metrics, 'HOST_RESULT_ROW_WRITE_END');
    expect(ends.length, 'per-row 종료 이벤트가 없다').toBe(3);
    const failed = ends.filter(e => e.success === false);
    expect(failed.length, '실패한 행이 성공으로 기록됐다').toBe(1);
    expect(failed[0].participantId).toBe('p2');
    expect(failed[0].errorCode).toBe('42501');
    const summary = ev(metrics, 'HOST_RESULT_PUBLISH_END')[0];
    expect(summary.failed).toBe(1);
    expect(summary.succeeded).toBe(2);
  });

  it('[RED-M2] 행 write 가 실패했는데도 결과 확정으로 그대로 넘어간다', async () => {
    const { rows, calls } = await runPublish({ failIds: ['p2'] });
    // p2 는 base 만 남는다 → 다른 단말 스냅샷에서 unresolved 로 잡혀 판정이 지연된다.
    expect(rows.p2.choice).toBe('scissors');
    expect(calls.statusScheduled,
      '일부 행의 결과 인코딩이 실패했는데도 status=result 로 전이했다 — ' +
      '다른 단말은 그 행을 unresolved 로 보고 재시도 예산을 소진한다')
      .toBe(0);
  });

  it('[RED-M2b] 전 행이 실패해도 결과 확정을 막지 않는다', async () => {
    const { rows, calls } = await runPublish({ failIds: ['h1', 'p2', 'p3'] });
    expect(rows.h1.choice).toBe('rock');
    expect(calls.statusScheduled,
      '결과 인코딩이 한 건도 성공하지 않았는데 status=result 로 전이했다').toBe(0);
  });
});
