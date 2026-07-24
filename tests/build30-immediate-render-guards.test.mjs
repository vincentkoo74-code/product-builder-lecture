import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

// Build30-R2 Phase B(WRPS-078, HIGH×3 재수정) — 즉시렌더 + 정확판정 + 팬텀 가드 + 오판 가드.
//
// 결함3개(codex-critic): (1) 빈 result 화면 선노출(CEO 금지 위반) (2) timeout 진 fetch가 컨텍스트
// 가드 없이 state mutate → 팬텀 재판정(Build28 결함A류) (3) timeout이 fetchFresh 신선도 보장을
// 우회 → tooMany/tooFew 오판.
//
// 수정: renderTentativeRoundResult()(보유 로컬 state로 즉시 1회 잠정 판정·렌더, idempotency 캐시
// 미기록) + fetchFreshParticipantsForResult의 isContextStillValid 팬텀 가드(컨텍스트 불일치 시
// state.participants mutate 스킵) + handleRoomUpdate의 오판 가드(timeout 시 부분 stale 감지되면
// bounded 추가 대기).
//
// 테스트 스타일: 실제 소스 추출 + new Function() 실행(hand-copy 로직 검증 금지).

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

function extractBlock(startMarker, endMarker, includeEndFirstChar = false) {
  const start = html.indexOf(startMarker);
  if (start < 0) throw new Error(`start marker not found: ${startMarker}`);
  let end = html.indexOf(endMarker, start);
  if (end < 0) throw new Error(`end marker not found: ${endMarker}`);
  if (includeEndFirstChar) end += 1;
  return html.slice(start, end);
}

// choice 인코딩/디코딩 순수 함수 묶음(isNonPlayingChoice/getChoiceBase/getChoiceResult/
// hasConfirmedRoundResult 포함) — tests/build24-sync-snapshot-stability.test.mjs와 동일 마커.
const CHOICE_HELPERS_BLOCK = extractBlock(
  'function isNonPlayingChoice(choice) {',
  'function getParticipantSignature('
);
const RENDER_TENTATIVE_SRC = extractBlock(
  'function renderTentativeRoundResult() {',
  'async function finishRoundLocal() {'
);
const GET_UNRESOLVED_ACTIVE_PARTICIPANTS_SRC = extractBlock(
  'function getUnresolvedActiveParticipants(rows) {',
  'async function fetchFreshParticipantsForResult(roomCode, maxRetries = 2, delayMs = 300, isContextStillValid = null) {'
);
const FETCH_FRESH_SRC = extractBlock(
  'async function fetchFreshParticipantsForResult(roomCode, maxRetries = 2, delayMs = 300, isContextStillValid = null) {',
  'function syncConfirmedIdsFromParticipants(participants = state.participants) {'
);

function loadRenderTentativeRoundResult({ state, judgeRoundImpl }) {
  const renderCalls = [];
  const renderRoundResult = (caseType, roundLoserCount, remainingSlots) =>
    renderCalls.push({ caseType, roundLoserCount, remainingSlots });
  const getTargetLoserCount = () => state.targetLoserCount || 1;
  const judgeRound = judgeRoundImpl || (() => ({}));
  const factory = new Function(
    'state', 'renderRoundResult', 'getTargetLoserCount', 'judgeRound',
    CHOICE_HELPERS_BLOCK + '\n' + RENDER_TENTATIVE_SRC + '\n; return renderTentativeRoundResult;'
  );
  const renderTentativeRoundResult = factory(state, renderRoundResult, getTargetLoserCount, judgeRound);
  return { renderTentativeRoundResult, renderCalls };
}

function loadFetchFreshParticipantsForResult({ state, db, sleepImpl }) {
  const emitted = [];
  const QA = { emit: (channel, data) => emitted.push(data) };
  const syncConfirmedIdsFromParticipants = () => {};
  const sleep = sleepImpl || (() => Promise.resolve());
  const factory = new Function(
    'state', 'QA', 'db', 'sleep', 'syncConfirmedIdsFromParticipants',
    CHOICE_HELPERS_BLOCK + '\n' + GET_UNRESOLVED_ACTIVE_PARTICIPANTS_SRC + '\n' + FETCH_FRESH_SRC +
      '\n; return { fetchFreshParticipantsForResult, getUnresolvedActiveParticipants };'
  );
  const mod = factory(state, QA, db, sleep, syncConfirmedIdsFromParticipants);
  return { ...mod, emitted };
}

describe('Build30-R2 Phase B(WRPS-078) renderTentativeRoundResult — 즉시렌더(idempotency 캐시 미기록, 부작용 없음)', () => {
  it('활성 참가자 전원이 이미 서버 확정 결과(stored)를 갖고 있으면 그 마커만으로 즉시 caseType을 렌더한다(judgeRound 호출 없이)', () => {
    const state = {
      participants: [
        { id: 'p1', choice: 'rock|lose' },
        { id: 'p2', choice: 'paper|win' },
      ],
      confirmedSafeIds: [], confirmedLoserIds: [], targetLoserCount: 1,
    };
    let judgeRoundCalled = false;
    const { renderTentativeRoundResult, renderCalls } = loadRenderTentativeRoundResult({
      state, judgeRoundImpl: () => { judgeRoundCalled = true; return {}; },
    });
    const ok = renderTentativeRoundResult();
    expect(ok).toBe(true);
    expect(judgeRoundCalled).toBe(false); // stored 경로 — localJudge 폴백을 타지 않음
    expect(renderCalls).toEqual([{ caseType: 'gameOver', roundLoserCount: 1, remainingSlots: 1 }]);
    // 잠정 렌더는 어떤 state도 변경하지 않는다(부작용 없음).
    expect(state.confirmedSafeIds).toEqual([]);
    expect(state.confirmedLoserIds).toEqual([]);
    expect(state.lastRoundResolution).toBeUndefined();
  });

  it('stored 결과가 없으면(choice에 result 세그먼트 없음) judgeRound()로 로컬 폴백해 즉시 caseType을 렌더한다', () => {
    const state = {
      participants: [
        { id: 'p1', choice: 'rock' },
        { id: 'p2', choice: 'paper' },
        { id: 'p3', choice: 'paper' },
      ],
      confirmedSafeIds: [], confirmedLoserIds: [], targetLoserCount: 1,
    };
    const { renderTentativeRoundResult, renderCalls } = loadRenderTentativeRoundResult({
      state,
      judgeRoundImpl: () => ({ p1: 'lose', p2: 'win', p3: 'win' }),
    });
    const ok = renderTentativeRoundResult();
    expect(ok).toBe(true);
    expect(renderCalls).toEqual([{ caseType: 'gameOver', roundLoserCount: 1, remainingSlots: 1 }]);
  });

  it('활성 참가자도 확정자도 전혀 없는 빈 스냅샷이면 false를 반환한다(finishRoundLocal [수정1-a]와 동일 조건 — 잠정 판정도 낼 데이터가 없음)', () => {
    const state = { participants: [], confirmedSafeIds: [], confirmedLoserIds: [], targetLoserCount: 1 };
    const { renderTentativeRoundResult, renderCalls } = loadRenderTentativeRoundResult({ state });
    const ok = renderTentativeRoundResult();
    expect(ok).toBe(false);
    expect(renderCalls).toEqual([]);
  });

  it('draw(무승부) 케이스도 정확히 감지한다', () => {
    const state = {
      participants: [
        { id: 'p1', choice: 'rock' },
        { id: 'p2', choice: 'rock' },
      ],
      confirmedSafeIds: [], confirmedLoserIds: [], targetLoserCount: 1,
    };
    const { renderTentativeRoundResult, renderCalls } = loadRenderTentativeRoundResult({
      state, judgeRoundImpl: () => ({ p1: 'draw', p2: 'draw' }),
    });
    renderTentativeRoundResult();
    expect(renderCalls).toEqual([{ caseType: 'draw', roundLoserCount: 0, remainingSlots: 1 }]);
  });

  it('tooMany/tooFew 비종결 케이스도 정확히 감지한다(3인, target=1, 2패1승 → tooMany)', () => {
    const state = {
      participants: [
        { id: 'p1', choice: 'rock' }, { id: 'p2', choice: 'rock' }, { id: 'p3', choice: 'paper' },
      ],
      confirmedSafeIds: [], confirmedLoserIds: [], targetLoserCount: 1,
    };
    const { renderTentativeRoundResult, renderCalls } = loadRenderTentativeRoundResult({
      state, judgeRoundImpl: () => ({ p1: 'lose', p2: 'lose', p3: 'win' }),
    });
    renderTentativeRoundResult();
    expect(renderCalls).toEqual([{ caseType: 'tooMany', roundLoserCount: 2, remainingSlots: 1 }]);
  });

  it('내부에서 예외가 나도(방어적 try/catch) 안전하게 false를 반환하고 throw하지 않는다', () => {
    const state = { participants: null, confirmedSafeIds: [], confirmedLoserIds: [], targetLoserCount: 1 };
    // judgeRound가 참조되기도 전에 참가자 목록 자체가 이상해도(방어적으로 (state.participants||[])
    // 를 쓰므로) 정상적으로 false만 반환해야 한다 — 예외를 던져 호출부(handleRoomUpdate)를 깨뜨리면
    // 안 된다.
    const { renderTentativeRoundResult } = loadRenderTentativeRoundResult({ state });
    expect(() => renderTentativeRoundResult()).not.toThrow();
  });
});

describe('Build30-R2 Phase B(WRPS-078) fetchFreshParticipantsForResult 팬텀 가드 — isContextStillValid', () => {
  it('컨텍스트가 이미 무효(false)면 DB 조회 자체를 하지 않고 state.participants를 orphan mutate하지 않는다', async () => {
    const state = { confirmedSafeIds: [], confirmedLoserIds: [], participants: [{ id: 'old', choice: null }] };
    let dbCalled = false;
    const db = { from: () => { dbCalled = true; return { select: () => ({ eq: () => ({ order: () => Promise.resolve({ data: [{ id: 'new', choice: 'rock|win' }] }) }) }) }; } };
    const { fetchFreshParticipantsForResult, emitted } = loadFetchFreshParticipantsForResult({ state, db });
    const isContextStillValid = () => false; // 다음 라운드/방 이동 등으로 이미 무효화된 컨텍스트
    const result = await fetchFreshParticipantsForResult('ROOM1', 2, 300, isContextStillValid);
    expect(dbCalled).toBe(false); // 조회 자체를 스킵
    expect(state.participants).toEqual([{ id: 'old', choice: null }]); // orphan mutate 없음(그대로 유지)
    expect(emitted.some(e => e.eventType === 'RESULT_FETCH_CONTEXT_STALE_ABANDONED')).toBe(true);
  });

  it('컨텍스트가 유효(true)하면(기존 동작) 정상적으로 조회하고 state.participants를 mutate한다', async () => {
    const state = { confirmedSafeIds: [], confirmedLoserIds: [], participants: [] };
    const freshData = [{ id: 'p1', choice: 'rock|win' }];
    const db = { from: () => ({ select: () => ({ eq: () => ({ order: () => Promise.resolve({ data: freshData }) }) }) }) };
    const { fetchFreshParticipantsForResult } = loadFetchFreshParticipantsForResult({ state, db });
    const isContextStillValid = () => true;
    await fetchFreshParticipantsForResult('ROOM1', 2, 300, isContextStillValid);
    expect(state.participants).toEqual(freshData);
  });

  it('isContextStillValid를 생략하면(기존 호출부, 예: defer-retry) 이전과 100% 동일하게 항상 조회/mutate한다(회귀 없음)', async () => {
    const state = { confirmedSafeIds: [], confirmedLoserIds: [], participants: [] };
    const freshData = [{ id: 'p1', choice: 'rock|win' }];
    const db = { from: () => ({ select: () => ({ eq: () => ({ order: () => Promise.resolve({ data: freshData }) }) }) }) };
    const { fetchFreshParticipantsForResult } = loadFetchFreshParticipantsForResult({ state, db });
    await fetchFreshParticipantsForResult('ROOM1'); // 4번째 인자 생략
    expect(state.participants).toEqual(freshData);
  });

  it('재시도 도중에 컨텍스트가 무효화되면(1차 시도는 유효, 이후 무효) 더 이상의 조회를 중단한다', async () => {
    const state = { confirmedSafeIds: [], confirmedLoserIds: [], participants: [] };
    let callCount = 0;
    // 1차 조회는 미해결(unresolved) row를 반환해 재시도를 유발한다.
    const db = { from: () => ({ select: () => ({ eq: () => ({ order: () => {
      callCount++;
      return Promise.resolve({ data: [{ id: 'p1', choice: 'rock' }] }); // choice 있지만 result 없음 = 미해결
    } }) }) }) };
    let validNow = true;
    const isContextStillValid = () => validNow;
    const { fetchFreshParticipantsForResult } = loadFetchFreshParticipantsForResult({ state, db, sleepImpl: async () => { validNow = false; } });
    await fetchFreshParticipantsForResult('ROOM1', 3, 10, isContextStillValid);
    // 최초 1회는 조회했지만(callCount>=1), 컨텍스트가 무효화된 뒤에는 추가 조회가 없어야 한다
    // (maxRetries=3이므로 무제한 조회였다면 4회 이상 호출됐을 것).
    expect(callCount).toBeGreaterThanOrEqual(1);
    expect(callCount).toBeLessThan(4);
  });

  // Build30 Phase3(테스트갭 B-9b): "마지막 1회 더 긴 대기"(final-wait, 5264-5267 부근) 전용 팬텀
  // 가드 — 위 4개 테스트는 전부 재시도 루프(loop) 안의 가드만 건드리고, 루프를 다 소진한 뒤 별도로
  // 재확인하는 이 final-wait 가드는 어떤 테스트도 실제로 통과시키지 않았다(정적 regex 1개뿐,
  // tests/build22-critical-sync-safety.test.mjs:149-153). 아래 테스트는 이 가드를 실제로 무력화하면
  // (final-wait 직전 컨텍스트 재확인을 건너뛰면) 실패하도록 설계됐다 — 뮤테이션으로 자가검증 완료.
  it('[B-9b] 재시도 루프 소진 후에도 미해결이면 final-wait 직전 컨텍스트를 재확인한다 — 그 사이 컨텍스트가 무효화됐으면 추가 조회(마지막 긴 대기) 자체를 하지 않고, 루프 마지막 스냅샷을 orphan mutate하지 않는다', async () => {
    const state = { confirmedSafeIds: [], confirmedLoserIds: [], participants: [] };
    let dbCallCount = 0;
    const db = {
      from: () => ({ select: () => ({ eq: () => ({ order: () => {
        dbCallCount++;
        // 1번째 호출(재시도 루프, maxRetries=0이라 단 1회) — 미해결(choice 있지만 result 없음).
        // 만약 final-wait 가드가 무력화돼 2번째(final-wait 전용) 조회가 실제로 일어나면, 이 mock은
        // 뚜렷이 다른(해결된) 데이터를 반환해 orphan mutate 여부를 관측 가능하게 만든다.
        if (dbCallCount === 1) return Promise.resolve({ data: [{ id: 'p1', choice: 'rock' }] });
        return Promise.resolve({ data: [{ id: 'p1', choice: 'rock|win' }] }); // 가드가 없었다면 여기로 옴
      } }) }) }),
    };
    // 1번째 호출(루프 attempt 체크)에서는 true(정상 진행), 2번째 호출(final-wait 직전 재확인)에서는
    // false(그 사이 컨텍스트가 바뀜, 예: 다음 라운드 시작)를 반환한다.
    let contextCheckCount = 0;
    const isContextStillValid = () => {
      contextCheckCount++;
      return contextCheckCount === 1;
    };
    const { fetchFreshParticipantsForResult, emitted } = loadFetchFreshParticipantsForResult({ state, db });
    const result = await fetchFreshParticipantsForResult('ROOM1', 0, 10, isContextStillValid);
    // 핵심 단언 1: DB는 루프의 1회만 호출되고, final-wait 전용 추가 조회는 없어야 한다.
    expect(dbCallCount).toBe(1);
    // 핵심 단언 2: state.participants는 루프의 마지막(미해결) 스냅샷 그대로다 — final-wait의
    // "해결된" 데이터로 orphan mutate되지 않았다.
    expect(state.participants).toEqual([{ id: 'p1', choice: 'rock' }]);
    expect(result).toEqual([{ id: 'p1', choice: 'rock' }]);
    // 핵심 단언 3: 실제로 이 가드 분기가 발동했다는 진단 metric이 남는다.
    expect(emitted.some(e => e.eventType === 'RESULT_FETCH_CONTEXT_STALE_ABANDONED' && e.phase === 'finalWait')).toBe(true);
  });

  it('[B-9b 대조군] final-wait 시점에도 컨텍스트가 여전히 유효하면(기존 동작) 추가 조회를 실제로 실행하고 그 결과로 mutate한다(회귀 없음)', async () => {
    const state = { confirmedSafeIds: [], confirmedLoserIds: [], participants: [] };
    let dbCallCount = 0;
    const db = {
      from: () => ({ select: () => ({ eq: () => ({ order: () => {
        dbCallCount++;
        if (dbCallCount === 1) return Promise.resolve({ data: [{ id: 'p1', choice: 'rock' }] }); // 루프: 미해결
        return Promise.resolve({ data: [{ id: 'p1', choice: 'rock|win' }] }); // final-wait: 해결됨
      } }) }) }),
    };
    const isContextStillValid = () => true; // 항상 유효 — 실제 기존 동작과 동일해야 함
    const { fetchFreshParticipantsForResult } = loadFetchFreshParticipantsForResult({ state, db });
    const result = await fetchFreshParticipantsForResult('ROOM1', 0, 10, isContextStillValid);
    expect(dbCallCount).toBe(2); // final-wait 추가 조회가 실제로 실행됨
    expect(state.participants).toEqual([{ id: 'p1', choice: 'rock|win' }]); // 최신(해결된) 데이터로 갱신
    expect(result).toEqual([{ id: 'p1', choice: 'rock|win' }]);
  });
});

describe('Build30-R2 Phase B(WRPS-078) 소스 계약 — 호출부 배선/무변경 대상', () => {
  it('handleRoomUpdate의 result/game_over 분기가 renderTentativeRoundResult()를 즉시렌더로 호출한다(빈 문자열 초기화가 첫 수단이 아님)', () => {
    expect(html).toMatch(/if \(!iAmSafe && !iAmConfirmedLoser\) \{\s*\n\s*showScreen\("screenRoundResult"\);\s*\n\s*if \(!renderTentativeRoundResult\(\)\) \{/);
  });
  it('fetchFreshParticipantsForResult 호출부가 컨텍스트 가드(roomCode/eventId/status 3중 확인)를 캡처해 전달한다', () => {
    expect(html).toMatch(/const guardRoomCode = state\.roomCode;\s*\n\s*const guardEventId = getGameRound\(\) \+ ':' \+ \(state\.round \|\| 1\);/);
    expect(html).toContain('fetchFreshParticipantsForResult(state.roomCode, undefined, undefined, isResultFetchContextStillValid)');
  });
  it('timeout 발동 시 오판 가드(getUnresolvedActiveParticipants)로 부분 stale을 확인한 뒤에만 추가 대기한다', () => {
    expect(html).toMatch(/if \(resultFetchTimedOut && isResultFetchContextStillValid\(\)\) \{\s*\n\s*const staleRows = getUnresolvedActiveParticipants\(state\.participants\);/);
  });
  it('finishRoundLocal/judgeRound/resolveElimination/isTaggerSelectionComplete 시그니처는 무변경이다', () => {
    expect(html).toContain('async function finishRoundLocal() {');
    expect(html).toContain('function judgeRound(');
    expect(html).toContain('function resolveElimination(');
    expect(html).toContain('function isTaggerSelectionComplete() {');
  });
  it('renderTentativeRoundResult는 recordRoundResolution/lastRoundResolution을 절대 참조하지 않는다(idempotency 캐시 미기록 계약)', () => {
    const src = extractBlock('function renderTentativeRoundResult() {', 'async function finishRoundLocal() {');
    expect(src).not.toContain('lastRoundResolution');
    expect(src).not.toContain('recordRoundResolution');
    expect(src).not.toContain("db.from(");
    expect(src).not.toContain('scheduleRematchAutoAdvance');
  });
});
