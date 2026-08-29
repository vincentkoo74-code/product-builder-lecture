import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

// ════════════════════════════════════════════════════════════════════════════
// Build40 — QA 증거 보존 아키텍처.
//
// Build39 필드 증거가 증명한 결함:
//   Host        총 3,241 metric → recent 300건 → 77초만 보존 → 2,941건 유실
//   Participant 총 2,970 metric → recent 300건 → 83초만 보존 → 2,670건 유실
//   Build39 fetch/realtime 계측이 링버퍼의 76~81% 를 차지해 10판 중 마지막 1.5판만 남았다.
//   사용자가 관찰한 "3판 넘어가면" 구간과 R1 트리거(4.4초 null 창)가 통째로 사라졌다.
//
// 계약(CEO):
//   A. CRITICAL 타임라인 — 세션 전체 보존. 고빈도 fetch 텔레메트리가 이를 밀어내면 안 된다.
//   B. HIGH-FREQUENCY 진단 — 샘플링/집계/유계 2차 링. 상관 id 는 유지.
//   C. 유실 자체가 관측 가능해야 한다 (QA_METRIC_DROPPED / SAMPLED).
//
// RED: 수천 건의 노이즈 fetch/realtime metric 이 섞인 긴 세션에서도
//      gameNo 1 ~ 마지막 게임의 critical 이벤트가 전부 남아야 한다.
// ════════════════════════════════════════════════════════════════════════════

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

function extractBlock(a, b, label) {
  const s = html.indexOf(a);
  if (s < 0) throw new Error(`[${label}] start marker not found: ${a}`);
  if (html.indexOf(a, s + 1) >= 0) throw new Error(`[${label}] start marker not unique: ${a}`);
  const e = html.indexOf(b, s);
  if (e < 0) throw new Error(`[${label}] end marker not found: ${b}`);
  return html.slice(s, e);
}

// QA 모듈의 상태 객체 m 선언부 ~ exportMetrics 까지를 실제 소스에서 떼어 실행한다.
const QA_SRC = extractBlock('        const m = {\n          // Build17: sessionStorage', 'function copyText()', 'qaModule');

function buildQa() {
  const state = { roomCode: 'ZDWQ', currentUserId: 'h_1', role: 'host' };
  const logs = [];
  const factory = new Function(
    'state', 'QA_INSTRUMENTATION', 'window', 'navigator', 'sessionStorage', 'console', 'Date',
    'scheduleSave',
    QA_SRC + '\nreturn { m, emit, summary, exportMetrics, snapshot };'
  );
  const fakeConsole = { log: (...a) => logs.push(a), warn: () => {} };
  let now = 1_800_000_000_000;
  const FakeDate = { now: () => now };
  const qa = factory(
    state, true,
    { __rpsShadowMetrics: { total: 0, match: 0, mismatch: 0, mismatches: [] } },
    { userAgent: 'test' },
    { getItem: () => null, setItem: () => {} },
    fakeConsole, FakeDate,
    () => {}
  );
  return { ...qa, tick: (ms) => { now += ms; }, logs };
}

/**
 * Build39 필드 세션과 같은 비율로 노이즈를 만든다:
 *   초당 ~2건 fetch/realtime/poll  +  라운드당 critical 이벤트 묶음.
 * games × roundsPerGame 라운드, 라운드당 12초.
 */
function simulateSession(qa, { games = 10, roundsPerGame = 3, secondsPerRound = 12 } = {}) {
  const critical = [];
  let seq = 0;
  for (let g = 1; g <= games; g++) {
    for (let r = 1; r <= roundsPerGame; r++) {
      const ctx = { roomCode: 'ZDWQ', gameNo: g, round: r };
      // 라운드 시작: host 가 countdownStartAt 생성/write
      const startAt = 1_800_000_000_000 + seq * 1000;
      const crit = [
        { eventType: 'COUNTDOWN_STARTAT_GENERATED', value: startAt, ...ctx },
        { eventType: 'COUNTDOWN_STARTAT_WRITE_BEGIN', traceId: `cd:${g}:${r}`, ...ctx },
        { eventType: 'COUNTDOWN_STARTAT_WRITE_END', traceId: `cd:${g}:${r}`, success: true, ...ctx },
        { eventType: 'COUNTDOWN_STARTAT_OBSERVED', value: startAt, source: 'roomUpdate', ...ctx },
        { eventType: 'COUNTDOWN_START', countdownStartServerTs: startAt, countdownDriftMs: -2800, ...ctx },
      ];
      if (g === 3 && r === 1) {
        // Build38 실측 패턴: 새 게임 첫 라운드에서 4.4초 null → 실패 → stale 복구
        for (let a = 0; a < 5; a++) crit.push({ eventType: 'INVALID_COUNTDOWN_SERVER_TS', attempt: a, ...ctx });
        crit.push({ eventType: 'COUNTDOWN_SYNC_FAILED', ...ctx });
        crit.push({ eventType: 'SYNC_LATE_RENDER', phase: 'countdown', lateRenderMs: 6026, ...ctx });
      }
      crit.push(
        { eventType: 'CHOICE_WRITE_BEGIN', traceId: `cw:${g}:${r}`, payload: 'rock', ...ctx },
        { eventType: 'CHOICE_WRITE_END', traceId: `cw:${g}:${r}`, success: true, ...ctx },
        { eventType: 'HOST_RESULT_PUBLISH_BEGIN', traceId: `hp:${g}:${r}`, activeCount: 3, ...ctx },
        { eventType: 'HOST_RESULT_ROW_WRITE_END', traceId: `hp:${g}:${r}`, participantId: 'p_2', success: true, ...ctx },
        { eventType: 'HOST_RESULT_PUBLISH_END', traceId: `hp:${g}:${r}`, total: 3, succeeded: 3, failed: 0, ...ctx },
        { eventType: 'ROUND_RESULT', eventId: `${g}:${r}`, resultValue: 'win', legacyOutcome: r === roundsPerGame ? 'gameOver' : 'tooMany', ...ctx },
      );
      // 노이즈: 라운드 12초 동안 초당 ~2.2건 (Build39 실측 0.83 fetchEnd + 0.57 rt + 0.4 poll + begin ≈ 2.2/s)
      const noisePerRound = Math.round(secondsPerRound * 2.2);
      const mixed = [];
      for (let i = 0; i < noisePerRound; i++) {
        const kind = i % 4;
        const s = ++seq;
        if (kind === 0) mixed.push({ eventType: 'REALTIME_PARTICIPANTS_EVENT', dbEvent: 'UPDATE', reason: 'realtimeParticipants', ...ctx });
        else if (kind === 1) mixed.push({ eventType: 'FETCH_PARTICIPANTS_BEGIN', seq: s, reason: 'realtimeParticipants', busy: true, ...ctx });
        else if (kind === 2) mixed.push({ eventType: 'FETCH_PARTICIPANTS_END', seq: s, reason: 'realtimeParticipants', durationMs: 280 + (s % 7) * 20, participantCount: 3, ...ctx });
        else mixed.push({ eventType: 'POLL_ROOM_TRIGGER', intervalMs: 2600, ...ctx });
      }
      // critical 을 노이즈 사이에 흩뿌린다(실제처럼)
      const stride = Math.max(1, Math.floor(mixed.length / (crit.length + 1)));
      crit.forEach((c, i) => mixed.splice(Math.min(mixed.length, (i + 1) * stride), 0, c));
      for (const e of mixed) { qa.emit('metric', e); qa.tick(Math.round(secondsPerRound * 1000 / mixed.length)); }
      critical.push(...crit);
    }
  }
  return { critical };
}

const CRITICAL_TYPES = new Set([
  'COUNTDOWN_STARTAT_GENERATED', 'COUNTDOWN_STARTAT_WRITE_BEGIN', 'COUNTDOWN_STARTAT_WRITE_END',
  'COUNTDOWN_STARTAT_OBSERVED', 'COUNTDOWN_START', 'INVALID_COUNTDOWN_SERVER_TS', 'COUNTDOWN_SYNC_FAILED',
  'SYNC_LATE_RENDER', 'CHOICE_WRITE_BEGIN', 'CHOICE_WRITE_END', 'HOST_RESULT_PUBLISH_BEGIN',
  'HOST_RESULT_PUBLISH_END', 'HOST_RESULT_ROW_WRITE_END', 'ROUND_RESULT',
]);

describe('Build40 QA retention — 소스 계약', () => {
  it('전제(공허성 가드): QA 모듈을 실제로 추출·실행할 수 있다', () => {
    const qa = buildQa();
    qa.emit('metric', { eventType: 'ROUND_RESULT', gameNo: 1, round: 1 });
    expect(qa.exportMetrics().summary.metrics).toBe(1);
  });

  it('[RED-Q1] export 에 critical 타임라인이 별도로 존재한다', () => {
    const qa = buildQa();
    const ex = qa.exportMetrics();
    expect(ex, 'export 에 critical 배열이 없다 — 링버퍼 하나뿐').toHaveProperty('critical');
  });

  it('[RED-Q2] 유실/샘플링 카운터가 export 에 드러난다', () => {
    const qa = buildQa();
    const su = qa.exportMetrics().summary;
    expect(su, 'summary 에 dropped 카운터가 없다').toHaveProperty('metricsDropped');
    expect(su, 'summary 에 sampled 카운터가 없다').toHaveProperty('metricsSampled');
  });
});

describe('Build40 QA retention — 장시간 세션 시뮬레이션', () => {
  it('전제: 시뮬레이션이 Build39 실측 규모를 만든다 (총 3,000+ metric)', () => {
    const qa = buildQa();
    simulateSession(qa, { games: 10, roundsPerGame: 3 });
    expect(qa.summary().metrics, '노이즈가 충분히 생성되지 않았다').toBeGreaterThan(1000);
  });

  it('[RED-Q3] 10판 × 3라운드 뒤에도 gameNo 1 의 critical 이벤트가 살아 있다', () => {
    const qa = buildQa();
    const { critical } = simulateSession(qa, { games: 10, roundsPerGame: 3 });
    const ex = qa.exportMetrics();
    const retained = [...(ex.critical || []), ...(ex.recent || [])];
    const g1 = retained.filter(e => e.gameNo === 1 && CRITICAL_TYPES.has(e.eventType));
    const expectedG1 = critical.filter(e => e.gameNo === 1).length;
    expect(g1.length, `gameNo 1 critical ${expectedG1}건 중 ${g1.length}건만 남았다 — 첫 게임이 밀려났다`)
      .toBe(expectedG1);
  });

  it('[RED-Q4] 모든 게임의 모든 critical 이벤트가 export 에 존재한다', () => {
    const qa = buildQa();
    const { critical } = simulateSession(qa, { games: 10, roundsPerGame: 3 });
    const ex = qa.exportMetrics();
    const retained = [...(ex.critical || []), ...(ex.recent || [])];
    const key = e => `${e.eventType}|${e.gameNo}|${e.round}|${e.traceId || e.attempt || ''}`;
    const have = new Set(retained.map(key));
    const missing = critical.filter(e => !have.has(key(e)));
    expect(missing.length, `critical ${missing.length}/${critical.length}건 유실. 예: ${missing.slice(0, 3).map(key).join(', ')}`)
      .toBe(0);
  });

  it('[RED-Q5] gameNo 3 round 1 의 R1 트리거 시퀀스(INVALID×5 → SYNC_FAILED → LATE_RENDER)가 순서대로 남는다', () => {
    const qa = buildQa();
    simulateSession(qa, { games: 10, roundsPerGame: 3 });
    const ex = qa.exportMetrics();
    const retained = [...(ex.critical || []), ...(ex.recent || [])].sort((a, b) => a.ts - b.ts);
    const seq = retained.filter(e => e.gameNo === 3 && e.round === 1 &&
      ['INVALID_COUNTDOWN_SERVER_TS', 'COUNTDOWN_SYNC_FAILED', 'SYNC_LATE_RENDER'].includes(e.eventType))
      .map(e => e.eventType);
    expect(seq, 'Build38 실측 R1 트리거 시퀀스가 보존되지 않았다').toEqual([
      'INVALID_COUNTDOWN_SERVER_TS', 'INVALID_COUNTDOWN_SERVER_TS', 'INVALID_COUNTDOWN_SERVER_TS',
      'INVALID_COUNTDOWN_SERVER_TS', 'INVALID_COUNTDOWN_SERVER_TS', 'COUNTDOWN_SYNC_FAILED', 'SYNC_LATE_RENDER',
    ]);
  });

  it('[RED-Q6] 노이즈 유실은 있을 수 있으나 그 수가 정확히 보고된다', () => {
    const qa = buildQa();
    simulateSession(qa, { games: 10, roundsPerGame: 3 });
    const ex = qa.exportMetrics();
    const total = ex.summary.metrics;
    const kept = (ex.critical || []).length + (ex.recent || []).length;
    const accounted = kept + (ex.summary.metricsDropped || 0) + (ex.summary.metricsSampled || 0);
    expect(accounted, `총 ${total}건 중 보존 ${kept} + dropped ${ex.summary.metricsDropped} + sampled ${ex.summary.metricsSampled} = ${accounted} — 회계가 맞지 않는다`)
      .toBe(total);
  });

  it('[RED-Q7] 고빈도 진단은 상관 id(seq/traceId) 를 잃지 않고 첫/끝/이상치를 남긴다', () => {
    const qa = buildQa();
    simulateSession(qa, { games: 10, roundsPerGame: 3 });
    const ex = qa.exportMetrics();
    const fetches = (ex.recent || []).filter(e => e.eventType === 'FETCH_PARTICIPANTS_END');
    expect(fetches.length, '고빈도 진단이 하나도 남지 않았다').toBeGreaterThan(0);
    expect(fetches.every(e => typeof e.seq === 'number'), 'seq 상관 id 가 사라졌다').toBe(true);
    // 가장 느린 fetch(이상치)는 반드시 남아야 한다
    const maxDur = Math.max(...fetches.map(e => e.durationMs || 0));
    expect(maxDur, '이상치 fetch 가 샘플링에 밀려났다').toBeGreaterThanOrEqual(380);
  });

  it('[대조군] critical 배열도 유계다 — 무한 성장하지 않는다', () => {
    const qa = buildQa();
    simulateSession(qa, { games: 40, roundsPerGame: 3 });
    const ex = qa.exportMetrics();
    expect((ex.critical || []).length, 'critical 이 무한히 자란다').toBeLessThan(5000);
  });
});
