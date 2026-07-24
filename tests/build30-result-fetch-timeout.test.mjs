import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';

// Build30(WRPS-078) [Phase1] — result 콘텐츠 즉시 렌더 + hard timeout.
//
// 진단: fetchFreshParticipantsForResult(약 5098)의 db.from('participants').select(...) await에
// 상한이 없어, 실기기 QA에서 최대 101,778ms 대기가 실측됨(화면은 이미 전환됐지만 내용이 채워지지
// 않는 상태로 방치). goToReadyScreen(9605-9618 부근)이 쓰는 Promise.race([쿼리, timeout(5000)])
// 패턴을 그대로 재사용해 이 호출 전체에 5초 hard cap을 추가한다.
//
// ⚠️ 무변경 대상: fetchFreshParticipantsForResult 내부 로직(재시도/재정렬/GAVE_UP), Build24-A
// 측정 순서(SYNC_RENDER/SNAPSHOT_RETRY_DURATION), Build19 idempotency(lastRoundResolution),
// Build28/29 retry(scheduleRoundJudgeDeferRetry 등) — 이 테스트는 그 경계를 넘지 않는다.
//
// 테스트 스타일: tests/build29-render-unblock.test.mjs와 동일한 "실제 소스 추출 + new Function()
// 실행" 패턴(hand-copy 로직 검증 금지).

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

function extractBlock(startMarker, endMarker, includeEndFirstChar = false) {
  const start = html.indexOf(startMarker);
  if (start < 0) throw new Error(`start marker not found: ${startMarker}`);
  let end = html.indexOf(endMarker, start);
  if (end < 0) throw new Error(`end marker not found: ${endMarker}`);
  if (includeEndFirstChar) end += 1;
  return html.slice(start, end);
}

// handleRoomUpdate()의 "oldStatus !== state.status" 블록 전체 — build29-render-unblock.test.mjs와
// 동일한 마커(이 안에 Phase1이 수정한 result/game_over 분기의 fetchFreshParticipantsForResult
// 호출부가 있다).
const TRANSITION_BLOCK_SRC = extractBlock(
  'if (oldStatus !== state.status) {',
  '} else if (state.status === "waiting") {',
  true
) + '\n}';

async function runTransitionBlock({
  room, state, waitForPhaseRender, fetchFreshParticipantsForResult, finishRoundLocal, db,
  isSafeParticipant, isConfirmedLoser, showScreen, $, syncConfirmedIdsFromParticipants,
  isWaitingForNextGame, showHostRoom, showReadyScreen, showLoserWaitScreen, enterPlayingStateFromRoomUpdate,
  parsePenalty, documentStub, renderTentativeRoundResult, getUnresolvedActiveParticipants,
}) {
  const emitted = [];
  const QA = { emit: (channel, data) => emitted.push(data) };
  const getGameRound = () => state.gameRound || 1;
  const calls = { showScreen: [], showHostRoom: 0, showReadyScreen: 0, showLoserWaitScreen: 0, $: [] };
  // Build30-R2 Phase B(WRPS-078): TRANSITION_BLOCK_SRC가 이제 즉시렌더(renderTentativeRoundResult)와
  // 오판 가드(getUnresolvedActiveParticipants, 부분 stale 감지 시 추가 대기)도 참조한다 — 이
  // 파일의 관심사(5초 hard timeout)와는 무관하므로 기본값은 no-op 스텁("잠정 렌더 성공"/"미해결
  // 없음" — 오판 가드 추가 대기가 발동하지 않아 기존 타임아웃 시나리오가 그대로 재현된다).
  const factory = new Function(
    'room', 'state', 'oldStatus', 'parsePenalty', 'waitForPhaseRender', 'fetchFreshParticipantsForResult',
    'finishRoundLocal', 'db', 'getGameRound', 'QA', 'isSafeParticipant', 'isConfirmedLoser', 'showScreen', '$',
    'syncConfirmedIdsFromParticipants', 'isWaitingForNextGame', 'showHostRoom', 'showReadyScreen',
    'showLoserWaitScreen', 'enterPlayingStateFromRoomUpdate', 'document', 'renderTentativeRoundResult',
    'getUnresolvedActiveParticipants',
    'return (async () => {\n' + TRANSITION_BLOCK_SRC + '\n})();'
  );
  const promise = factory(
    room, state, (state.__oldStatusForTest !== undefined ? state.__oldStatusForTest : '__PREV_STATUS_SENTINEL__'), parsePenalty || ((p) => {
      try { return JSON.parse(p) || {}; } catch (e) { return {}; }
    }),
    waitForPhaseRender, fetchFreshParticipantsForResult, finishRoundLocal, db, getGameRound, QA,
    isSafeParticipant || (() => false), isConfirmedLoser || (() => false),
    showScreen || ((id) => calls.showScreen.push(id)),
    $ || ((id) => { calls.$.push(id); return null; }),
    syncConfirmedIdsFromParticipants || (() => {}),
    isWaitingForNextGame || (() => false),
    showHostRoom || (() => { calls.showHostRoom++; }),
    showReadyScreen || (() => { calls.showReadyScreen++; }),
    showLoserWaitScreen || (() => { calls.showLoserWaitScreen++; }),
    enterPlayingStateFromRoomUpdate || (() => {}),
    documentStub || { visibilityState: 'visible' },
    renderTentativeRoundResult || (() => true),
    getUnresolvedActiveParticipants || (() => [])
  );
  return { promise, emitted, calls };
}

describe('Build30(WRPS-078) [Phase1] result fetch hard timeout', () => {
  it('(a) fetchFreshParticipantsForResult가 5초 안에 끝나면 timeout 없이 정상 진행되고 finishRoundLocal이 호출된다', async () => {
    const room = { status: 'result', penalty: JSON.stringify({ text: '', phaseScheduledAt: Date.now(), phaseKind: 'result' }) };
    const state = { status: 'result', roomCode: 'R1', gameRound: 1, round: 1, renderedPhaseKeys: {}, currentUserId: 'p1' };
    const waitForPhaseRender = async () => true;
    let finishCalled = false;
    const finishRoundLocal = () => { finishCalled = true; };
    const fetchFreshParticipantsForResult = async () => { await new Promise((r) => setTimeout(r, 10)); };
    const { promise, emitted } = await (async () => {
      vi.useFakeTimers();
      try {
        const r = await runTransitionBlock({
          room, state, waitForPhaseRender, fetchFreshParticipantsForResult, finishRoundLocal, db: {},
          isSafeParticipant: () => false, isConfirmedLoser: () => false,
        });
        await vi.advanceTimersByTimeAsync(20);
        await r.promise;
        return r;
      } finally {
        vi.useRealTimers();
      }
    })();
    expect(finishCalled).toBe(true);
    expect(emitted.some((e) => e.eventType === 'RESULT_FETCH_TIMEOUT')).toBe(false);
  });

  it('(b) fetchFreshParticipantsForResult가 5초를 넘겨도 끝나지 않으면 timeout으로 진행이 멈추지 않고 finishRoundLocal이 호출된다(현재 보유 state로 진행)', async () => {
    const room = { status: 'result', penalty: JSON.stringify({ text: '', phaseScheduledAt: Date.now(), phaseKind: 'result' }) };
    const state = { status: 'result', roomCode: 'R1', gameRound: 3, round: 2, renderedPhaseKeys: {}, currentUserId: 'p1' };
    const waitForPhaseRender = async () => true;
    let finishCalled = false;
    const finishRoundLocal = () => { finishCalled = true; };
    // 절대 resolve되지 않는 네트워크 요청을 흉내낸다(실기기 101,778ms 대기 재현).
    const fetchFreshParticipantsForResult = () => new Promise(() => {});
    vi.useFakeTimers();
    try {
      const { promise, emitted } = await runTransitionBlock({
        room, state, waitForPhaseRender, fetchFreshParticipantsForResult, finishRoundLocal, db: {},
        isSafeParticipant: () => false, isConfirmedLoser: () => false,
        documentStub: { visibilityState: 'hidden' },
      });
      // 5초(hard cap) 전에는 아직 finishRoundLocal이 호출되지 않아야 한다(화면 전환은 됐지만
      // finishRoundLocal 호출로 이어지는 판정 대기가 여전히 진행 중).
      await vi.advanceTimersByTimeAsync(4900);
      expect(finishCalled).toBe(false);
      // 5초 시점에 timeout이 발화해 진행이 재개된다.
      await vi.advanceTimersByTimeAsync(200);
      await promise;
      expect(finishCalled).toBe(true);
      const timeoutMetric = emitted.find((e) => e.eventType === 'RESULT_FETCH_TIMEOUT');
      expect(timeoutMetric).toBeTruthy();
      expect(timeoutMetric.wrps).toBe('WRPS-078');
      expect(timeoutMetric.gameNo).toBe(3);
      expect(timeoutMetric.round).toBe(2);
      expect(timeoutMetric.roomCode).toBe('R1');
      expect(timeoutMetric.visibilityState).toBe('hidden');
      expect(Number.isFinite(timeoutMetric.elapsedMs)).toBe(true);
      expect(timeoutMetric.elapsedMs).toBeGreaterThanOrEqual(5000);
    } finally {
      vi.useRealTimers();
    }
  });

  it('(c) Build24-A 측정(SNAPSHOT_RETRY_DURATION)은 timeout 여부와 무관하게 여전히 기록된다(측정 순서 무변경)', async () => {
    const room = { status: 'result', penalty: JSON.stringify({ text: '', phaseScheduledAt: Date.now(), phaseKind: 'result' }) };
    const state = { status: 'result', roomCode: 'R1', gameRound: 1, round: 1, renderedPhaseKeys: {}, currentUserId: 'p1' };
    const waitForPhaseRender = async () => true;
    const finishRoundLocal = () => {};
    const fetchFreshParticipantsForResult = () => new Promise(() => {});
    vi.useFakeTimers();
    try {
      const { promise, emitted } = await runTransitionBlock({
        room, state, waitForPhaseRender, fetchFreshParticipantsForResult, finishRoundLocal, db: {},
        isSafeParticipant: () => false, isConfirmedLoser: () => false,
      });
      await vi.advanceTimersByTimeAsync(5100);
      await promise;
      expect(emitted.some((e) => e.eventType === 'SNAPSHOT_RETRY_DURATION')).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('Build30(WRPS-078) [Phase1] APP_VISIBILITY metric 리스너 — 1회 등록', () => {
  it('visibilitychange/pagehide 리스너가 각각 1회만 등록되고, 중복 등록을 방지하는 가드가 존재한다', () => {
    expect(html).toContain('if (!window.__maruAppVisibilityMetricReady) {');
    expect(html).toContain('window.__maruAppVisibilityMetricReady = true;');
    expect(html).toMatch(/document\.addEventListener\("visibilitychange", \(\) => \{\s*\n\s*try \{ QA\.emit\('metric', \{ wrps: 'WRPS-078', eventType: 'APP_VISIBILITY', state: document\.visibilityState/);
    expect(html).toMatch(/window\.addEventListener\("pagehide", \(\) => \{\s*\n\s*try \{ QA\.emit\('metric', \{ wrps: 'WRPS-078', eventType: 'APP_VISIBILITY', state: 'pagehide'/);
  });

  it('실제 등록 로직을 실행하면 emit이 정확한 payload로 발생하고, 재실행 시 가드가 재등록을 막는다', () => {
    const REG_BLOCK_SRC = extractBlock(
      '// Build30(WRPS-078) [Phase1]: app background/foreground 전환을 QA metric으로 남긴다',
      'function initNativeOAuthListener() {'
    );
    const listeners = { visibilitychange: [], pagehide: [] };
    const documentStub = {
      visibilityState: 'hidden',
      addEventListener: (type, cb) => { listeners[type] = listeners[type] || []; listeners[type].push(cb); },
    };
    const windowStub = {
      addEventListener: (type, cb) => { listeners[type] = listeners[type] || []; listeners[type].push(cb); },
    };
    const emitted = [];
    const QA = { emit: (channel, data) => emitted.push(data) };
    const state = { roomCode: 'ROOMX' };
    const runOnce = () => {
      const fn = new Function('window', 'document', 'QA', 'state', 'resyncRoomOnResume', REG_BLOCK_SRC);
      fn(windowStub, documentStub, QA, state, () => {});
    };
    runOnce();
    expect(listeners.visibilitychange.length).toBe(1);
    expect(listeners.pagehide.length).toBe(1);
    listeners.visibilitychange[0]();
    expect(emitted).toEqual([{ wrps: 'WRPS-078', eventType: 'APP_VISIBILITY', state: 'hidden', roomId: 'ROOMX' }]);
    listeners.pagehide[0]();
    expect(emitted[1]).toEqual({ wrps: 'WRPS-078', eventType: 'APP_VISIBILITY', state: 'pagehide', roomId: 'ROOMX' });
    // 중복 등록 방지: 같은 window 객체로 다시 실행하면(플래그가 이미 true) 리스너가 추가되지 않는다.
    runOnce();
    expect(listeners.visibilitychange.length).toBe(1);
    expect(listeners.pagehide.length).toBe(1);
  });
});
