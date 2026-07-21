import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

// Build29(WRPS-076) [P1] — 렌더 차단 해소(R1/R5) + 폴링 간격/sleep 캡(R6) 검증.
// R1(CRITICAL): result 첫 렌더를 2단계화 — resultIsFirstRender===true 분기 안에서 화면을 먼저
// 전환(우선안전/확정 술래 제외)하고, 내용은 기존 스냅샷 재조회 경로가 나중에 채운다.
// R5: "ready"+round>1 참가자 새로고침을 waitForPhaseRender와 Promise.all로 병렬화.
// R6: sleep 캡 4000→4800(lead 3600 + PHASE_RENDER_BUFFER_MS 900 = 4500 > 4000 이었던 불변식 위반 수정).
// 폴링: 5000→2600ms, room 조회를 fetchParticipants보다 먼저 실행하도록 순서 교환.
//
// 실제 소스 추출 + new Function() 실행 패턴(tests/build24-sync-snapshot-stability.test.mjs와 동일).

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

function extractBlock(startMarker, endMarker, includeEndFirstChar = false) {
  const start = html.indexOf(startMarker);
  if (start < 0) throw new Error(`start marker not found: ${startMarker}`);
  let end = html.indexOf(endMarker, start);
  if (end < 0) throw new Error(`end marker not found: ${endMarker}`);
  if (includeEndFirstChar) end += 1;
  return html.slice(start, end);
}

// handleRoomUpdate()의 "oldStatus !== state.status" 블록 전체(readyParticipantsRefreshPromise
// 시작 + iAmSafe/iAmConfirmedLoser 계산 + result/game_over 분기 + ready 분기) — "waiting" 분기
// 직전까지. end marker의 첫 글자(ready 분기를 닫는 "}")까지만 추출되므로, 바깥쪽
// "if (oldStatus !== state.status) {"를 닫는 "}"를 하나 더 붙여 자체 완결된(self-balanced) 조각으로
// 만든다.
const TRANSITION_BLOCK_SRC = extractBlock(
  'if (oldStatus !== state.status) {',
  '} else if (state.status === "waiting") {',
  true
) + '\n}';

async function runTransitionBlock({
  room, state, waitForPhaseRender, fetchFreshParticipantsForResult, finishRoundLocal, db,
  isSafeParticipant, isConfirmedLoser, showScreen, $, syncConfirmedIdsFromParticipants,
  isWaitingForNextGame, showHostRoom, showReadyScreen, showLoserWaitScreen, enterPlayingStateFromRoomUpdate,
  parsePenalty,
}) {
  const emitted = [];
  const QA = { emit: (channel, data) => emitted.push(data) };
  const getGameRound = () => state.gameRound || 1;
  const calls = { showScreen: [], showHostRoom: 0, showReadyScreen: 0, showLoserWaitScreen: 0, $: [] };
  const factory = new Function(
    'room', 'state', 'oldStatus', 'parsePenalty', 'waitForPhaseRender', 'fetchFreshParticipantsForResult',
    'finishRoundLocal', 'db', 'getGameRound', 'QA', 'isSafeParticipant', 'isConfirmedLoser', 'showScreen', '$',
    'syncConfirmedIdsFromParticipants', 'isWaitingForNextGame', 'showHostRoom', 'showReadyScreen',
    'showLoserWaitScreen', 'enterPlayingStateFromRoomUpdate',
    'return (async () => {\n' + TRANSITION_BLOCK_SRC + '\n})();'
  );
  await factory(
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
    enterPlayingStateFromRoomUpdate || (() => {})
  );
  return { emitted, calls };
}

describe('Build29 [P1, R1, CRITICAL] result 첫 렌더 2단계화 — 화면 선-전환', () => {
  it('(a) resultIsFirstRender===true & 이번 라운드 미확정(우선안전 아님) → fetchFreshParticipantsForResult 완료 전에 이미 screenRoundResult로 전환된다', async () => {
    const room = { status: 'result', penalty: JSON.stringify({ text: '', phaseScheduledAt: Date.now(), phaseKind: 'result' }) };
    const state = { status: 'result', roomCode: 'R1', gameRound: 1, round: 1, renderedPhaseKeys: {}, currentUserId: 'p1' };
    const showScreenCalls = [];
    const showScreen = (id) => showScreenCalls.push(id);
    const waitForPhaseRender = async () => true;
    let fetchStarted = false;
    const fetchFreshParticipantsForResult = async () => {
      fetchStarted = true;
      // fetch가 시작되기 "전에" 이미 showScreen이 호출됐어야 한다(2단계화 검증 핵심).
      expect(showScreenCalls).toEqual(['screenRoundResult']);
      await new Promise((r) => setTimeout(r, 5));
    };
    const finishRoundLocal = () => {};
    const { calls } = await runTransitionBlock({
      room, state, waitForPhaseRender, fetchFreshParticipantsForResult, finishRoundLocal, db: {},
      isSafeParticipant: () => false, isConfirmedLoser: () => false, showScreen,
    });
    expect(fetchStarted).toBe(true);
    expect(showScreenCalls).toEqual(['screenRoundResult']);
  });

  it('(b) 우선안전(iAmSafe)/확정 술래(iAmConfirmedLoser)는 이 선-전환 대상이 아니다(결과화면으로 보내지 않음)', async () => {
    const room = { status: 'result', penalty: JSON.stringify({ text: '', phaseScheduledAt: Date.now(), phaseKind: 'result' }) };
    const state = { status: 'result', roomCode: 'R1', gameRound: 1, round: 1, renderedPhaseKeys: {}, currentUserId: 'p1' };
    const showScreenCalls = [];
    const showScreen = (id) => showScreenCalls.push(id);
    const waitForPhaseRender = async () => true;
    const fetchFreshParticipantsForResult = async () => {};
    const finishRoundLocal = () => {};
    await runTransitionBlock({
      room, state, waitForPhaseRender, fetchFreshParticipantsForResult, finishRoundLocal, db: {},
      isSafeParticipant: () => true, isConfirmedLoser: () => false, showScreen,
    });
    expect(showScreenCalls).toEqual([]); // finishRoundLocal이 나중에 자체적으로 라우팅(Phase2 Fix-1)
  });

  it('(c) resultIsFirstRender===false(duplicate)면 선-전환도 fetch도 일어나지 않는다(Build22-B dedup 유지)', async () => {
    const room = { status: 'result', penalty: JSON.stringify({ text: '', phaseScheduledAt: Date.now(), phaseKind: 'result' }) };
    const state = { status: 'result', roomCode: 'R1', gameRound: 1, round: 1, renderedPhaseKeys: {}, currentUserId: 'p1' };
    const showScreenCalls = [];
    const showScreen = (id) => showScreenCalls.push(id);
    const waitForPhaseRender = async () => false;
    let fetchCalled = false;
    const fetchFreshParticipantsForResult = async () => { fetchCalled = true; };
    let finishCalled = false;
    const finishRoundLocal = () => { finishCalled = true; };
    await runTransitionBlock({
      room, state, waitForPhaseRender, fetchFreshParticipantsForResult, finishRoundLocal, db: {},
      isSafeParticipant: () => false, isConfirmedLoser: () => false, showScreen,
    });
    expect(showScreenCalls).toEqual([]);
    expect(fetchCalled).toBe(false);
    expect(finishCalled).toBe(false);
  });
});

describe('Build29 [P1, R5] ready 분기 — 참가자 새로고침과 waitForPhaseRender 병렬화', () => {
  it('(a) 두 작업이 실제로 병렬(동시)로 시작된다 — 순차 실행이면 나올 수 없는 호출 순서', async () => {
    const room = { status: 'ready', penalty: JSON.stringify({ text: '', phaseScheduledAt: Date.now(), phaseKind: 'ready' }) };
    const state = { status: 'ready', round: 2, roomCode: 'R1', gameRound: 1, renderedPhaseKeys: {}, currentUserId: 'p1', role: 'host' };
    const callOrder = [];
    const db = {
      from: () => ({
        select: () => ({
          eq: () => ({
            order: async () => {
              callOrder.push('participantsFetch:start');
              await new Promise((r) => setTimeout(r, 20));
              callOrder.push('participantsFetch:end');
              return { data: [{ id: 'p1', choice: null }] };
            },
          }),
        }),
      }),
    };
    const waitForPhaseRender = async () => {
      callOrder.push('waitForPhaseRender:start');
      await new Promise((r) => setTimeout(r, 5));
      callOrder.push('waitForPhaseRender:end');
      return true;
    };
    await runTransitionBlock({
      room, state, waitForPhaseRender, fetchFreshParticipantsForResult: async () => {}, finishRoundLocal: () => {}, db,
      isSafeParticipant: () => false, isConfirmedLoser: () => false, showReadyScreen: () => {},
    });
    // 순차 실행(fetch 완료 후 waitForPhaseRender 시작)이었다면 'waitForPhaseRender:start'가
    // 'participantsFetch:end' 뒤에 와야 한다. 병렬이면 waitForPhaseRender가 fetch 완료 전에
    // 이미 시작(및 완료)된다 — fetch(20ms)가 waitForPhaseRender(5ms)보다 오래 걸리므로 검증 가능.
    const fetchEndIdx = callOrder.indexOf('participantsFetch:end');
    const waitStartIdx = callOrder.indexOf('waitForPhaseRender:start');
    expect(waitStartIdx).toBeLessThan(fetchEndIdx); // 병렬 실행 증거
  });

  it('(b) 새로고침된 참가자 데이터가 있으면 그 마커 기준으로 최종 라우팅이 결정된다(정확성 유지)', async () => {
    const room = { status: 'ready', penalty: JSON.stringify({ text: '', phaseScheduledAt: Date.now(), phaseKind: 'ready' }) };
    const state = { status: 'ready', round: 2, roomCode: 'R1', gameRound: 1, renderedPhaseKeys: {}, currentUserId: 'p1', role: 'participant' };
    const freshRows = [{ id: 'p1', choice: '__safe__' }];
    const db = {
      from: () => ({ select: () => ({ eq: () => ({ order: async () => ({ data: freshRows }) }) }) }),
    };
    let syncedWith = null;
    const syncConfirmedIdsFromParticipants = (rows) => { syncedWith = rows; };
    const showScreenCalls = [];
    await runTransitionBlock({
      room, state, waitForPhaseRender: async () => true, fetchFreshParticipantsForResult: async () => {}, finishRoundLocal: () => {}, db,
      // 최초(구식) isSafeParticipant는 false를 반환하지만, 새로고침 후 재계산에서는 true를
      // 반환하도록 해 "새로고침된 데이터 기준으로 재판정"이 실제로 일어나는지 검증한다.
      isSafeParticipant: (id) => syncedWith !== null, isConfirmedLoser: () => false,
      showScreen: (id) => showScreenCalls.push(id),
      syncConfirmedIdsFromParticipants,
    });
    expect(syncedWith).toEqual(freshRows);
    expect(showScreenCalls).toEqual(['screenWinnerWait']); // 새로고침 후 재계산된 iAmSafe=true 반영
  });

  it('(c) round<=1(참가자 새로고침 스킵 대상)이면 여전히 정상 동작한다(회귀 없음)', async () => {
    const room = { status: 'ready', penalty: JSON.stringify({ text: '', phaseScheduledAt: Date.now(), phaseKind: 'ready' }) };
    const state = { status: 'ready', round: 1, roomCode: 'R1', gameRound: 1, renderedPhaseKeys: {}, currentUserId: 'p1', role: 'host' };
    let dbCalled = false;
    const db = { from: () => { dbCalled = true; return { select: () => ({ eq: () => ({ order: async () => ({ data: [] }) }) }) }; } };
    const calls = { showHostRoom: 0 };
    await runTransitionBlock({
      room, state, waitForPhaseRender: async () => true, fetchFreshParticipantsForResult: async () => {}, finishRoundLocal: () => {}, db,
      isSafeParticipant: () => false, isConfirmedLoser: () => false,
      showHostRoom: () => { calls.showHostRoom++; },
    });
    expect(dbCalled).toBe(false); // round<=1이면 readyParticipantsRefreshPromise가 애초에 null
    expect(calls.showHostRoom).toBe(1); // host + round===1 → showHostRoom 정상 호출
  });
});

describe('Build29 [P1, R6] sleep 캡 4000 → 4800 (불변식: 캡 > lead(3600)+buffer(900)=4500)', () => {
  it('waitForPhaseRender/countdown 두 지점 모두 캡이 4800으로 상향됐다(4000 잔존 없음)', () => {
    expect(html).toMatch(/if \(waitMs > 0\) await sleep\(Math\.min\(waitMs, 4800\)\);/);
    expect(html).toMatch(/await sleep\(Math\.min\(waitMs, 4800\)\);/);
    expect(html).not.toContain('Math.min(waitMs, 4000)');
  });
  it('PHASE_RENDER_BUFFER_MS(900)는 변경되지 않았다(CEO 결정 범위 — 폴링만 조정)', () => {
    expect(html).toContain('const PHASE_RENDER_BUFFER_MS = 900;');
  });
});

describe('Build29 [P1, 폴링 간격] 5000 → 2600ms + 순서 교환', () => {
  it('폴링 setInterval 간격이 2600으로 변경됐다(5000 잔존 없음)', () => {
    expect(html).toMatch(/\}, 2600\);\s*\n\s*\n\s*\/\/ 초기 데이터 로드/);
  });
  it('폴링 콜백에서 rooms 조회가 fetchParticipants보다 먼저 실행된다(순서 교환)', () => {
    expect(html).toMatch(
      /state\.pollInterval = setInterval\(async \(\) => \{\s*\n\s*const \{ data: room \} = await db\.from\('rooms'\)\.select\('\*'\)\.eq\('id', roomCode\)\.single\(\);\s*\n\s*await fetchParticipants\(roomCode\);/
    );
  });
});

describe('Build29 비침습 계약 — Build19~28 가드/판정 무변경', () => {
  it('판정 순수함수 시그니처는 그대로 유지된다', () => {
    expect(html).toContain('function judgeRound(');
    expect(html).toContain('function resolveElimination(');
    expect(html).toContain('function judgePure(');
  });
  it('Build22-B duplicate-skip 게이트(waitForPhaseRender)는 재작성되지 않았다', () => {
    expect(html).toContain("if (state.renderedPhaseKeys[renderKey]) {");
    expect(html).toContain('state.renderedPhaseKeys[renderKey] = true;');
  });
});
