import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

// ════════════════════════════════════════════════════════════════════════════
// Build39 R1 — 복구된 countdownStartAt 이 이미 과거일 때의 late-start 하한.
//
// 실기기 증거 (qa-report-build38-2026-08-29-00-03-07.json / 방 3VT6 / iPhone participant):
//   t=132.8  INVALID_COUNTDOWN_SERVER_TS attempt=0
//   t=134.0/134.7/135.9/136.8  attempt=1..4        ← 재시도 예산 4.4초 소진
//   t=137.2  COUNTDOWN_SYNC_FAILED
//   t=149.0  COUNTDOWN_START  countdownDriftMs=+6026  waitMs=0
//   t=149.0  SYNC_LATE_RENDER lateRenderMs=6026
//
// 즉 동기화 실패 후 복구된 scheduledStartAt 이 이미 6초 지난 값이었고, runCountdown() 은
//   const waitMs = scheduledStartAt ? Math.max(0, scheduledStartAt - serverNow()) : 0;
// 로 그 값을 그대로 받아들여 waitMs=0 으로 즉시 시작했다. 신선도 상한이 없어서
// "동기화된 것처럼" 카운트다운을 시작하지만 실제로는 다른 기기보다 6초 늦다.
//
// Build22 는 "동기화 없이 시작"(scheduledStartAt=0)은 하드블록했지만
// "낡은 동기화로 시작"(scheduledStartAt 이 과거)은 열어 두었다 — 이 파일이 그 구멍을 고정한다.
//
// ⚠️ 이 RED 는 **아직 미확정인 트리거 경로**(왜 4.4초간 null 이었나)를 다루지 않는다.
//    자기완결적인 stale-start 가드만 대상으로 한다(CEO 지시).
// ⚠️ 공허성 방지: 정상 lead(미래 startAt) 대조군을 함께 둔다 — 가드가 정상 경로까지
//    막아버리면 대조군이 깨진다.
// ════════════════════════════════════════════════════════════════════════════

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

function extractBlock(a, b) {
  const s = html.indexOf(a);
  if (s < 0) throw new Error('start marker not found: ' + a);
  const e = html.indexOf(b, s);
  if (e < 0) throw new Error('end marker not found: ' + b);
  return html.slice(s, e);
}

// runCountdown() 의 동기화 구간만 떼어낸다(오버레이 표시 직후 ~ 라운드 라벨 계산 직전).
// waitForValidCountdownStart 안의 동일 문장과 구분하기 위해 앞줄까지 포함한 마커를 쓴다.
const SYNC_BLOCK = extractBlock(
  'overlay.classList.remove("hidden");\n\n      let scheduledStartAt = getCountdownStartAt();',
  'const roundLabel = state.round > 1'
);
// Build40 R1: 동기화 구간이 참조하는 신선도 정책(임계 상수 / 분류 / host 안전조건)은
// runCountdown 밖에 정의돼 있다. 정책이 없으면 구간이 ReferenceError 로 죽으므로 함께 주입한다.
// 정책 블록은 serverNow / getChoiceEndAt / state / isNonPlayingChoice / getChoiceBase 만 참조한다.
const POLICY_BLOCK = (() => {
  const a = 'const STALE_COUNTDOWN_TOLERANCE_MS = ';
  if (html.indexOf(a) < 0) return '';   // RED 단계(미구현)에서는 빈 블록 → 종전 동작 그대로 측정
  return extractBlock(a, 'async function republishCountdownStartAsHost() {');
})();

const NOW = 1_700_000_000_000;

/**
 * 추출한 동기화 구간을 실제로 실행한다.
 * @param {number} recoveredStartAt  waitForValidCountdownStart 가 돌려주는 값(서버 시간 도메인)
 * @param {boolean} viaRecovery      재시도를 거친 복구 경로인지(=최초 조회는 실패)
 */
async function runSyncBlock({ recoveredStartAt, viaRecovery = true, role = 'participant', choiceEndAt = 0 }) {
  const calls = { sleeps: [], metrics: [], syncErrorShown: 0, republished: 0, retriedWhole: 0 };
  const state = { round: 1, role, status: 'playing', roomCode: '3VT6', gameRound: 3, countdownGeneration: 1, choiceEndAt };
  const mkEl = () => ({ className: '', style: {}, textContent: '', classList: { add() {}, remove() {} } });
  const overlay = mkEl(), numEl = mkEl(), labelEl = mkEl();

  const fn = new Function(
    'overlay', 'numEl', 'labelEl', 'state', 'QA', 't', 'sleep', 'serverNow',
    'serverClockOffsetMs', 'getOnlineMode', 'getCountdownStartAt', 'waitForValidCountdownStart',
    'isCountdownGenerationCurrent', 'republishCountdownStartAsHost', 'showCountdownSyncError',
    'runCountdownThenShowGame', 'getGameRound', 'Date', 'getChoiceEndAt', 'isNonPlayingChoice', 'getChoiceBase',
    `${POLICY_BLOCK}\nreturn (async function(myGen){ ${SYNC_BLOCK} return { scheduledStartAt, waitMs }; })(1);`
  );

  const result = await fn(
    overlay, numEl, labelEl, state,
    { emit: (_k, m) => calls.metrics.push(m) },
    (k) => k,
    async (ms) => { calls.sleeps.push(ms); },
    () => NOW,
    0,
    () => true,
    // 최초 조회: 복구 경로면 0(무효) → waitForValidCountdownStart 로 진입한다.
    () => (viaRecovery ? 0 : recoveredStartAt),
    async () => recoveredStartAt,
    () => true,
    async () => { calls.republished++; return recoveredStartAt; },
    (_o, _n, _l, onRetry) => { calls.syncErrorShown++; if (onRetry) calls.retriedWhole++; },
    async () => {},
    () => 3,
    { now: () => NOW },
    () => state.choiceEndAt || 0,
    (c) => c === '__safe__' || c === '__loser__' || c === '__waiting__',
    (c) => (c ? String(c).split('|')[0] : null)
  );
  return { ...(result || {}), calls };
}

describe('Build39 R1 — 복구된 stale countdownStartAt', () => {
  it('전제(공허성 가드): 동기화 구간을 실제로 추출했다', () => {
    expect(SYNC_BLOCK.length).toBeGreaterThan(400);
    expect(SYNC_BLOCK).toContain('waitForValidCountdownStart');
    expect(SYNC_BLOCK).toContain('waitMs');
    expect(SYNC_BLOCK).toContain('COUNTDOWN_START');
  });

  it('[대조군] 정상 lead(미래 startAt)는 종전대로 대기 후 시작한다', async () => {
    const r = await runSyncBlock({ recoveredStartAt: NOW + 3000, viaRecovery: false });
    expect(r.waitMs, '정상 경로에서 lead 대기가 사라지면 안 된다').toBeGreaterThan(2000);
    const started = r.calls.metrics.filter(m => m.eventType === 'COUNTDOWN_START');
    expect(started.length, '정상 경로에서 COUNTDOWN_START 가 나지 않았다').toBe(1);
    expect(started[0].countdownDriftMs).toBeLessThanOrEqual(0);
  });

  it('[대조군] 복구값이 살짝 늦은 정도(≤1s)면 그대로 진행한다', async () => {
    const r = await runSyncBlock({ recoveredStartAt: NOW - 400 });
    const started = r.calls.metrics.filter(m => m.eventType === 'COUNTDOWN_START');
    expect(started.length, '경미한 지연까지 막으면 과잉 차단이다').toBe(1);
  });

  // ── CEO 지시 5: SLIGHTLY_LATE 는 절대 타임라인에 정렬한다 ────────────────
  for (const lateBy of [400, 1450]) {
    it(`[R1 정렬] ${lateBy}ms late — 로컬 시각으로 새 카운트다운을 시작하지 않고 절대 startAt 에 정렬한다`, async () => {
      const r = await runSyncBlock({ recoveredStartAt: NOW - lateBy });
      const started = r.calls.metrics.filter(m => m.eventType === 'COUNTDOWN_START');
      expect(started.length).toBe(1);
      // waitMs=0 (더 기다리지 않음) 이지만 drift 는 정확히 lateBy — 즉 "startAt 은 그대로, 나만 늦게 합류"
      expect(r.waitMs).toBe(0);
      expect(started[0].countdownDriftMs, 'drift 가 serverNow-startAt 로 계산되지 않았다').toBeGreaterThanOrEqual(lateBy - 5);
      expect(started[0].countdownStartServerTs, 'startAt 이 로컬 시각으로 교체됐다').toBe(NOW - lateBy);
      const sl = r.calls.metrics.filter(m => m.eventType === 'SLIGHTLY_LATE_COUNTDOWN_STARTAT');
      expect(sl.length, 'SLIGHTLY_LATE 정렬 신호가 없다').toBe(1);
      expect(sl[0].lateByMs).toBeGreaterThanOrEqual(lateBy - 5);
      // 세대는 새로 발급되지 않는다(같은 epoch 에 합류)
      expect(r.calls.metrics.filter(m => m.eventType === 'COUNTDOWN_GENERATION_STARTED').length).toBe(0);
    });
  }
  it('[R1 경계] 1550ms late 는 stale 로 거부된다', async () => {
    const r = await runSyncBlock({ recoveredStartAt: NOW - 1550 });
    expect(r.calls.metrics.filter(m => m.eventType === 'COUNTDOWN_START').length).toBe(0);
    expect(r.calls.metrics.filter(m => m.eventType === 'STALE_COUNTDOWN_STARTAT').length).toBe(1);
  });

  it('[RED-R1a] 6초 지난 복구값으로 카운트다운을 그대로 시작하면 안 된다', async () => {
    // 실측 재현: drift +6026ms
    const r = await runSyncBlock({ recoveredStartAt: NOW - 6026 });
    const started = r.calls.metrics.filter(m => m.eventType === 'COUNTDOWN_START');
    expect(started.length,
      `이미 6026ms 지난 startAt 으로 COUNTDOWN_START 를 발행했다(waitMs=${r.waitMs}) — ` +
      '다른 기기보다 6초 늦게 시작하는 것이 보장된다').toBe(0);
  });

  it('[RED-R1b] 심하게 지난 복구값은 stale 로 관측 가능해야 한다', async () => {
    const r = await runSyncBlock({ recoveredStartAt: NOW - 6026 });
    const staleEvents = r.calls.metrics.filter(m =>
      /STALE/i.test(String(m.eventType || '')) && /COUNTDOWN/i.test(String(m.eventType || '')));
    expect(staleEvents.length,
      'stale 복구를 구분해 남기는 metric 이 없다 — 필드에서 재현/추적이 불가능하다')
      .toBeGreaterThan(0);
  });

  it('[RED-R1c] participant 는 stale 복구 시 동기화 오류 안내로 빠져야 한다', async () => {
    const r = await runSyncBlock({ recoveredStartAt: NOW - 6026, role: 'participant' });
    expect(r.calls.syncErrorShown,
      'stale 복구인데도 참가자에게 아무 안내 없이 늦은 카운트다운이 시작된다')
      .toBeGreaterThan(0);
  });

  // [R1d 정정 — CEO 지시 4] 종전 이 케이스는 "host 는 stale 시 재발행해야 한다"였다. split-start
  // 분석 결과 host 는 다른 기기의 old-startAt 수락 여부를 증명할 수 없으므로 STALE 재발행은
  // 금지된다. 계약을 뒤집는다: host 도 재발행 없이 권위 복구로 간다(R1h2 와 동일 계약).
  it('[R1d] host 는 stale 복구값을 그대로 쓰지도, 새 startAt 으로 대체하지도 않는다', async () => {
    const r = await runSyncBlock({ recoveredStartAt: NOW - 6026, role: 'host' });
    expect(r.calls.metrics.filter(m => m.eventType === 'COUNTDOWN_START').length, 'stale 값으로 시작했다').toBe(0);
    expect(r.calls.republished, 'STALE 에서 host 가 재발행했다(split-start)').toBe(0);
    expect(r.calls.syncErrorShown + r.calls.retriedWhole, '권위 복구 경로가 아니다').toBeGreaterThan(0);
  });

  // ── Build40 확장 (CEO 지시 9): 실측값 3종 + 경계 + 중복/세대/수렴 ─────────────
  for (const [label, lateBy] of [['3.5s (Build39 participant max)', 3510], ['5.75s (Build39 host max)', 5755], ['6.026s (Build38 실측)', 6026]]) {
    it(`[RED-R1e] ${label} stale 복구값으로 정상 카운트다운을 시작하지 않는다`, async () => {
      const r = await runSyncBlock({ recoveredStartAt: NOW - lateBy });
      const started = r.calls.metrics.filter(m => m.eventType === 'COUNTDOWN_START');
      expect(started.length, `lateBy=${lateBy}ms 인데 COUNTDOWN_START 가 발행됐다`).toBe(0);
      const stale = r.calls.metrics.filter(m => m.eventType === 'STALE_COUNTDOWN_STARTAT');
      expect(stale.length, 'STALE_COUNTDOWN_STARTAT metric 이 없다').toBeGreaterThan(0);
      expect(stale[0].lateByMs, 'lateByMs 필드가 실측값을 담지 않는다').toBeGreaterThanOrEqual(lateBy - 5);
    });
  }

  it('[RED-R1f] 경계: 허용 한계 바로 아래는 통과, 바로 위는 거부 (임계가 실제로 존재한다)', async () => {
    // 구현이 STALE_COUNTDOWN_TOLERANCE_MS 를 노출해야 경계를 검증할 수 있다.
    const m = /const STALE_COUNTDOWN_TOLERANCE_MS = (\d+);/.exec(html);
    expect(m, 'STALE_COUNTDOWN_TOLERANCE_MS 상수가 소스에 없다').toBeTruthy();
    const tol = Number(m[1]);
    expect(tol, '임계가 lead(3600) 이상이면 "늦게 시작할 권한"이 된다 — 지터 허용치여야 한다').toBeLessThan(3600);
    expect(tol, '임계가 실측 fetch p99(931ms) 보다 작으면 정상 지연을 stale 로 오탐한다').toBeGreaterThanOrEqual(931);
    const under = await runSyncBlock({ recoveredStartAt: NOW - (tol - 50) });
    const over  = await runSyncBlock({ recoveredStartAt: NOW - (tol + 50) });
    expect(under.calls.metrics.filter(m => m.eventType === 'COUNTDOWN_START').length, `tol-50ms 는 통과해야 한다`).toBe(1);
    expect(over.calls.metrics.filter(m => m.eventType === 'COUNTDOWN_START').length, `tol+50ms 는 거부해야 한다`).toBe(0);
  });

  it('[RED-R1g] stale 거부 시 카운트다운 세대를 새로 발급하지 않는다 (중복 카운트다운 금지)', async () => {
    const r = await runSyncBlock({ recoveredStartAt: NOW - 6026, role: 'participant' });
    const gens = r.calls.metrics.filter(m => m.eventType === 'COUNTDOWN_GENERATION_STARTED');
    expect(gens.length, 'stale 거부 경로가 새 세대를 시작했다').toBe(0);
    expect(r.calls.metrics.filter(m => m.eventType === 'COUNTDOWN_START').length).toBe(0);
  });

  // ── CEO 지시 4 (split-start 방지) ──────────────────────────────────────────
  // host 는 다른 기기가 old startAt 을 이미 수락했는지 원격으로 알 수 없다. STALE 은 정의상
  // startAt 이 과거이므로 "아무도 아직 시작하지 않았다"를 host 가 증명할 방법이 없다.
  // → STALE 에서 host 재발행은 어떤 로컬 신호로도 정당화되지 않는다. 권위 상태 복구로 간다.
  it('[RED-R1h] STALE 에서 host 는 선택 창이 열렸으면 재발행하지 않는다', async () => {
    const r = await runSyncBlock({ recoveredStartAt: NOW - 6026, role: 'host', choiceEndAt: NOW + 5000 });
    expect(r.calls.republished, '선택 창이 열린 뒤 host 가 startAt 을 재발행했다').toBe(0);
    expect(r.calls.metrics.filter(m => m.eventType === 'COUNTDOWN_START').length).toBe(0);
  });

  it('[RED-R1h2] STALE 에서 host 는 로컬 신호가 "안전"해 보여도 재발행하지 않는다 (split-start 방지)', async () => {
    // choiceEndAt=0, 로컬 참가자 선택 없음 — 그래도 다른 기기가 old startAt 으로 이미 카운트다운을
    // 시작했을 수 있다. 같은 세대에 두 개의 startAt epoch 이 생기면 안 된다.
    const r = await runSyncBlock({ recoveredStartAt: NOW - 6026, role: 'host', choiceEndAt: 0 });
    expect(r.calls.republished, 'host 가 STALE 복구값을 새 startAt 으로 대체했다 — 이미 old startAt 을 수락한 기기와 epoch 이 갈라진다').toBe(0);
    expect(r.calls.metrics.filter(m => m.eventType === 'COUNTDOWN_START').length, '두 번째 epoch 으로 카운트다운을 시작했다').toBe(0);
    expect(r.calls.metrics.filter(m => m.eventType === 'COUNTDOWN_GENERATION_STARTED').length, '새 세대 발급').toBe(0);
    expect(r.calls.syncErrorShown + r.calls.retriedWhole, '권위 상태 복구 경로로 가지 않았다').toBeGreaterThan(0);
    const stale = r.calls.metrics.find(m => m.eventType === 'STALE_COUNTDOWN_STARTAT');
    expect(stale && stale.role, 'host 의 stale 관측이 기록되지 않았다').toBe('host');
  });

  it('[R1 split-start 대조군] FRESH(미래 startAt) 에서는 host 도 종전대로 정상 시작한다', async () => {
    const r = await runSyncBlock({ recoveredStartAt: NOW + 3000, viaRecovery: false, role: 'host' });
    expect(r.calls.metrics.filter(m => m.eventType === 'COUNTDOWN_START').length).toBe(1);
    expect(r.calls.republished).toBe(0);
  });

  it('[RED-R1i] participant 는 stale 시 새 startAt 을 만들지 않고 권위 재조회로 수렴한다', async () => {
    const r = await runSyncBlock({ recoveredStartAt: NOW - 6026, role: 'participant' });
    expect(r.calls.republished, 'participant 가 startAt 을 발행했다').toBe(0);
    expect(r.calls.syncErrorShown + r.calls.retriedWhole, '재조회/복구 경로로 가지 않았다').toBeGreaterThan(0);
  });

  // ── Build40 R1 정정 (rc3 sim STALL 5건으로 발견): 거부 범위는 복구값뿐이다 ─────────
  // room row 가 처음부터 실어 온 startAt 이 전송 지연(pessimistic 꼬리 ~9s)으로 늦게 도착하면
  // 절대 타임라인에 그만큼 뒤에서 합류한다. 오류 화면으로 막으면 재시도 탭이 없는 단말은 STALL.
  for (const lateBy of [3510, 5755, 6026]) {
    it(`[R1 전송지연 합류] room row 가 실어 온 startAt 이 ${lateBy}ms 늦게 도착 → 거부하지 않고 합류한다`, async () => {
      const r = await runSyncBlock({ recoveredStartAt: NOW - lateBy, viaRecovery: false });
      const started = r.calls.metrics.filter(m => m.eventType === 'COUNTDOWN_START');
      expect(started.length, '늦게 도착한 정상값을 거부해 카운트다운이 없다(STALL 경로)').toBe(1);
      expect(started[0].countdownStartServerTs, 'startAt 을 교체했다').toBe(NOW - lateBy);
      expect(r.waitMs).toBe(0);
      expect(r.calls.syncErrorShown, '오류 화면으로 막았다').toBe(0);
      expect(r.calls.metrics.filter(m => m.eventType === 'LATE_DELIVERED_COUNTDOWN_STARTAT').length, '합류 관측 metric 없음').toBe(1);
      expect(r.calls.metrics.filter(m => m.eventType === 'STALE_COUNTDOWN_STARTAT').length, '정상 지연 도착을 stale 로 오분류').toBe(0);
    });
  }
  it('[R1 구분] 같은 6026ms 라도 복구값이면 거부, 전송지연이면 합류 — 두 경로가 실제로 갈린다', async () => {
    const rec = await runSyncBlock({ recoveredStartAt: NOW - 6026, viaRecovery: true });
    const del = await runSyncBlock({ recoveredStartAt: NOW - 6026, viaRecovery: false });
    expect(rec.calls.metrics.filter(m => m.eventType === 'COUNTDOWN_START').length).toBe(0);
    expect(del.calls.metrics.filter(m => m.eventType === 'COUNTDOWN_START').length).toBe(1);
  });

  it('[불변식] 어떤 경우에도 waitMs 는 음수가 아니다', async () => {
    for (const off of [-6026, -400, 0, 3000]) {
      const r = await runSyncBlock({ recoveredStartAt: NOW + off, viaRecovery: off <= 0 });
      if (r.waitMs !== undefined) expect(r.waitMs).toBeGreaterThanOrEqual(0);
    }
  });
});
