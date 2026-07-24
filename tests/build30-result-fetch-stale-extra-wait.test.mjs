import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';

// Build30 Phase3(테스트갭 B-10) — handleRoomUpdate() result/game_over 분기의 "timeout 이후
// 부분 stale 오판 가드"(RESULT_FETCH_HARD_TIMEOUT_MS 5000ms 이후, getUnresolvedActiveParticipants로
// 확인한 뒤 RESULT_FETCH_STALE_EXTRA_WAIT_MS 3000ms만 추가로 더 기다리는 로직, 약 5657-5694)에 대한
// 최초의 행동(behavioral) 테스트다. 지금까지는 tests/build19-critical-fixes.test.mjs와
// tests/build30-immediate-render-guards.test.mjs에 정적 regex 계약 테스트만 있었고, 실제로
// (a) resultFetchTimedOut + stale row일 때 추가 대기가 "실제로 발생"하는지 (b) 그 대기 도중
// 원래 fetch가 늦게 도착하면 반영되는지 (c) 3초를 다 써도 fetch가 안 끝나면(무한 대기가 아니라)
// 그대로 진행하는지는 어떤 테스트도 async 타이머로 구동해 검증하지 않았다 — 이 파일이 그 공백을 메운다.
//
// 판정 알고리즘(judgePure/resolveElimination/judgeRound)과 Build23 하드블록은 무변경 — 이 테스트는
// 그 경계를 넘지 않는다. 실제 소스 추출 + new Function() 실행(hand-copy 로직 검증 금지).

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

function extractBlock(startMarker, endMarker, includeEndFirstChar = false) {
  const start = html.indexOf(startMarker);
  if (start < 0) throw new Error(`start marker not found: ${startMarker}`);
  let end = html.indexOf(endMarker, start);
  if (end < 0) throw new Error(`end marker not found: ${endMarker}`);
  if (includeEndFirstChar) end += 1;
  return html.slice(start, end);
}

// choice 인코딩/디코딩 순수 함수 묶음 — getUnresolvedActiveParticipants의 실제 의존.
const CHOICE_HELPERS_BLOCK = extractBlock(
  'function isNonPlayingChoice(choice) {',
  'function getParticipantSignature('
);
const GET_UNRESOLVED_ACTIVE_PARTICIPANTS_SRC = extractBlock(
  'function getUnresolvedActiveParticipants(rows) {',
  'async function fetchFreshParticipantsForResult(roomCode, maxRetries = 2, delayMs = 300, isContextStillValid = null) {'
);
// handleRoomUpdate()의 result/game_over 분기 — 종료 중괄호(end marker의 첫 글자)까지 포함.
// tests/build24-sync-snapshot-stability.test.mjs의 RESULT_BRANCH_SRC와 동일한 마커.
const RESULT_BRANCH_SRC = extractBlock(
  'if (state.status === "result" || state.status === "game_over") {',
  '} else if (state.status === "playing") {',
  true
);

function loadGetUnresolvedActiveParticipants(state) {
  const factory = new Function(
    'state',
    CHOICE_HELPERS_BLOCK + '\n' + GET_UNRESOLVED_ACTIVE_PARTICIPANTS_SRC + '\n; return getUnresolvedActiveParticipants;'
  );
  return factory(state);
}

// 실제 소스(RESULT_BRANCH_SRC)를 new Function으로 실행 — tests/build24-sync-snapshot-stability.test.mjs의
// runResultBranch와 동일한 의존성 배선(이 파일의 관심사와 무관한 waitForPhaseRender/렌더 훅은 no-op
// 기본값), 단 fetchFreshParticipantsForResult/getUnresolvedActiveParticipants만 이 테스트가 직접
// 제어한다(fake timers로 RESULT_FETCH_HARD_TIMEOUT_MS/RESULT_FETCH_STALE_EXTRA_WAIT_MS를 실제로 구동).
function runResultBranch({
  room, state, waitForPhaseRender, fetchFreshParticipantsForResult, finishRoundLocal, db,
  iAmSafe = false, iAmConfirmedLoser = false, showScreen, $,
  renderTentativeRoundResult, getUnresolvedActiveParticipants,
}) {
  const emitted = [];
  const QA = { emit: (channel, data) => emitted.push(data) };
  const getGameRound = () => state.gameRound || 1;
  const parsePenalty = (raw) => {
    try { const p = JSON.parse(raw || '{}'); return p && typeof p === 'object' ? p : {}; } catch { return {}; }
  };
  const factory = new Function(
    'room', 'state', 'parsePenalty', 'waitForPhaseRender', 'fetchFreshParticipantsForResult', 'finishRoundLocal', 'db', 'getGameRound', 'QA',
    'iAmSafe', 'iAmConfirmedLoser', 'showScreen', '$', 'renderTentativeRoundResult', 'getUnresolvedActiveParticipants',
    'return (async () => {\n' + RESULT_BRANCH_SRC + '\n})();'
  );
  const promise = factory(
    room, state, parsePenalty, waitForPhaseRender || (async () => true), fetchFreshParticipantsForResult, finishRoundLocal || (() => {}), db, getGameRound, QA,
    iAmSafe, iAmConfirmedLoser, showScreen || (() => {}), $ || (() => null),
    renderTentativeRoundResult || (() => true), getUnresolvedActiveParticipants || (() => [])
  );
  return { promise, emitted };
}

describe('Build30 Phase3(테스트갭 B-10) result/game_over 오판 가드 — timeout 이후 부분 stale 추가 대기(실제 async 타이머 구동)', () => {
  it('(a) resultFetchTimedOut(5000ms 하드 타임아웃) + stale row가 있으면 실제로 추가 대기(3000ms)가 시작된다(RESULT_FETCH_TIMEOUT_PARTIAL_STALE_EXTRA_WAIT metric 실측)', async () => {
    vi.useFakeTimers();
    try {
      const state = {
        role: 'participant', status: 'result', roomCode: 'ROOM1', gameRound: 1, round: 1,
        confirmedSafeIds: [], confirmedLoserIds: [],
        // stale row: choice 있지만 result 세그먼트 없음 = 아직 이번 라운드 결과 미반영(미해결).
        participants: [{ id: 'p1', choice: 'rock' }, { id: 'p2', choice: 'paper|win' }],
      };
      const room = { penalty: '' };
      const db = {}; // truthy만 필요 — 이 경로에서 db.from()을 직접 쓰지 않음(fetch는 주입된 mock이 담당)
      const getUnresolvedActiveParticipants = loadGetUnresolvedActiveParticipants(state);
      // 원본 fetch는 절대 끝나지 않는 "행(hang)" 상황을 흉내(실측 101초급 네트워크 정체 재현) —
      // 5000ms 하드 타임아웃이 실제로 발동해야만 이 테스트가 다음 단계로 진행된다.
      const hangingFetch = new Promise(() => {}); // 의도적으로 영원히 pending
      const fetchFreshParticipantsForResult = () => hangingFetch;
      let finishCalled = false;
      const finishRoundLocal = () => { finishCalled = true; };

      const { promise, emitted } = runResultBranch({
        room, state, fetchFreshParticipantsForResult, finishRoundLocal, db, getUnresolvedActiveParticipants,
      });

      // 5000ms 하드 타임아웃 발동 직전까지는 아직 추가 대기 metric이 없어야 한다(순서 보증).
      await vi.advanceTimersByTimeAsync(4999);
      expect(emitted.some(e => e.eventType === 'RESULT_FETCH_TIMEOUT_PARTIAL_STALE_EXTRA_WAIT')).toBe(false);
      expect(finishCalled).toBe(false);

      // 5000ms 도달 — 하드 타임아웃 발동, stale row 존재 확인 후 추가 대기(3000ms) 시작.
      await vi.advanceTimersByTimeAsync(1);
      expect(emitted.some(e => e.eventType === 'RESULT_FETCH_TIMEOUT_PARTIAL_STALE_EXTRA_WAIT')).toBe(true);
      expect(finishCalled).toBe(false); // 아직 추가 대기 중이므로 진행하지 않는다

      // 남은 3000ms를 마저 흘려보내 (c) 시나리오로 이어지는 것을 다음 테스트에서 별도로 검증한다.
      await vi.advanceTimersByTimeAsync(3000);
      await promise;
      expect(finishCalled).toBe(true); // 소진 후에는 반드시 진행한다(무한 대기 아님)
    } finally {
      vi.useRealTimers();
    }
  });

  it('(b) 추가 대기 도중 원래 fetch가 늦게 도착하면(3000ms 소진 전) 그 시점에 즉시 반영되어 진행한다 — 3초를 끝까지 기다리지 않는다', async () => {
    vi.useFakeTimers();
    try {
      const state = {
        role: 'participant', status: 'result', roomCode: 'ROOM2', gameRound: 1, round: 1,
        confirmedSafeIds: [], confirmedLoserIds: [],
        participants: [{ id: 'p1', choice: 'rock' }],
      };
      const room = { penalty: '' };
      const db = {};
      const getUnresolvedActiveParticipants = loadGetUnresolvedActiveParticipants(state);

      let resolveFetch;
      const fetchPromise = new Promise((resolve) => { resolveFetch = resolve; });
      // 실제 fetchFreshParticipantsForResult처럼, "도착"하면 state.participants를 최신(해결된)
      // 데이터로 직접 mutate한다(실 구현과 동일한 부작용 재현).
      const fetchFreshParticipantsForResult = () => fetchPromise.then(() => {
        state.participants = [{ id: 'p1', choice: 'rock|win' }];
        return state.participants;
      });
      let finishCalled = false;
      const finishRoundLocal = () => { finishCalled = true; };

      const { promise } = runResultBranch({
        room, state, fetchFreshParticipantsForResult, finishRoundLocal, db, getUnresolvedActiveParticipants,
      });

      // 하드 타임아웃(5000ms)까지 흘려보내 추가 대기 단계로 진입.
      await vi.advanceTimersByTimeAsync(5000);
      expect(finishCalled).toBe(false);
      expect(state.participants).toEqual([{ id: 'p1', choice: 'rock' }]); // 아직 미반영

      // 추가 대기(3000ms) 중간에(1500ms) 원래 fetch가 도착한다.
      await vi.advanceTimersByTimeAsync(1500);
      resolveFetch();
      await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); // 마이크로태스크 플러시
      await promise;

      // 도착한 데이터가 실제로 반영됐고, 그 즉시(3000ms를 다 기다리지 않고) 진행되었다.
      expect(state.participants).toEqual([{ id: 'p1', choice: 'rock|win' }]);
      expect(finishCalled).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('(c) 추가 대기(3000ms)를 전부 소진해도 원래 fetch가 끝나지 않으면 무한 대기하지 않고 그대로 진행한다(bounded, 실측 101초급 정체 방어)', async () => {
    vi.useFakeTimers();
    try {
      const state = {
        role: 'host', status: 'result', roomCode: 'ROOM3', gameRound: 1, round: 1,
        confirmedSafeIds: [], confirmedLoserIds: [],
        participants: [{ id: 'p1', choice: 'rock' }],
      };
      const room = { penalty: '' };
      const db = {};
      const getUnresolvedActiveParticipants = loadGetUnresolvedActiveParticipants(state);
      const hangingFetch = new Promise(() => {}); // 3초를 넘겨서도 절대 끝나지 않음
      const fetchFreshParticipantsForResult = () => hangingFetch;
      let finishCalled = false;
      const finishRoundLocal = () => { finishCalled = true; };

      const { promise } = runResultBranch({
        room, state, fetchFreshParticipantsForResult, finishRoundLocal, db, getUnresolvedActiveParticipants,
      });

      await vi.advanceTimersByTimeAsync(5000); // 하드 타임아웃
      await vi.advanceTimersByTimeAsync(2999); // 추가 대기 거의 소진(아직 1ms 남음)
      expect(finishCalled).toBe(false); // 아직 진행하지 않음(무한 대기는 아니지만 상한 전)
      await vi.advanceTimersByTimeAsync(1); // 추가 대기 완전 소진
      await promise;
      expect(finishCalled).toBe(true); // 상한 소진 후 원래 fetch 미완료 상태로도 진행됨(무한 대기 아님)
      expect(state.participants).toEqual([{ id: 'p1', choice: 'rock' }]); // stale 데이터 그대로(부작용 없음)
    } finally {
      vi.useRealTimers();
    }
  });

  it('stale row가 없으면(전원 이미 해결) 하드 타임아웃이 나도 추가 대기 자체를 시작하지 않는다(회귀 없음, 기존 동작 유지)', async () => {
    vi.useFakeTimers();
    try {
      const state = {
        role: 'participant', status: 'result', roomCode: 'ROOM4', gameRound: 1, round: 1,
        confirmedSafeIds: [], confirmedLoserIds: [],
        participants: [{ id: 'p1', choice: 'rock|win' }, { id: 'p2', choice: 'paper|lose' }], // 전원 해결됨
      };
      const room = { penalty: '' };
      const db = {};
      const getUnresolvedActiveParticipants = loadGetUnresolvedActiveParticipants(state);
      const hangingFetch = new Promise(() => {});
      const fetchFreshParticipantsForResult = () => hangingFetch;
      let finishCalled = false;
      const finishRoundLocal = () => { finishCalled = true; };

      const { promise, emitted } = runResultBranch({
        room, state, fetchFreshParticipantsForResult, finishRoundLocal, db, getUnresolvedActiveParticipants,
      });

      await vi.advanceTimersByTimeAsync(5000); // 하드 타임아웃 발동
      await promise; // stale row가 없으므로 추가 대기 없이 즉시 진행되어야 함
      expect(emitted.some(e => e.eventType === 'RESULT_FETCH_TIMEOUT_PARTIAL_STALE_EXTRA_WAIT')).toBe(false);
      expect(finishCalled).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});
