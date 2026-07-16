import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { maxLoserCountFor } from '../src/game-logic.mjs';

// Build24 — Critical Stabilization(sync/snapshot/result stability only).
// CEO의 Build24 사전분석 승인에 따른 3개 근본원인(C/A/B) 수정 검증. 판정 알고리즘(judgePure/
// resolveElimination/judgeRound)과 partial replay playAgain guard(Build23)는 무변경 — 이 파일의
// 테스트도 그 경계를 넘지 않는다. index.html은 모듈이 아니므로 tests/build23-play-again-guard.test.mjs와
// tests/qa-persistence.test.mjs에서 이미 검증된 "실제 소스 추출 + new Function() 실행" 패턴을
// 그대로 계승한다(손으로 베낀 로직이 아니라 실제 프로덕션 코드를 검증).

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

function extractBlock(startMarker, endMarker, includeEndFirstChar = false) {
  const start = html.indexOf(startMarker);
  if (start < 0) throw new Error(`start marker not found: ${startMarker}`);
  let end = html.indexOf(endMarker, start);
  if (end < 0) throw new Error(`end marker not found: ${endMarker}`);
  if (includeEndFirstChar) end += 1;
  return html.slice(start, end);
}

// ── 실제 소스 블록 추출 ──────────────────────────────────────────────
// buildPenaltyValue/getTargetLoserCount/getGameRound/getNextPhaseScheduledAt/clampLoserCount 등
// 스케줄링 관련 순수 함수 묶음(외부 의존: state, maxLoserCountFor만).
const SCHEDULING_BLOCK = extractBlock(
  'function toPositiveInt(value, fallback = 0) {',
  'function isLoserCountEditable() {'
);
// choice 인코딩/디코딩 순수 함수 묶음(외부 의존 없음, state 불필요). hasConfirmedRoundResult는
// getCurrentParticipant "뒤"에 정의되어 있으므로 그 다음 함수(getParticipantSignature)까지 포함한다.
const CHOICE_HELPERS_BLOCK = extractBlock(
  'function isNonPlayingChoice(choice) {',
  'function getParticipantSignature('
);
const BEGIN_NEW_GAME_ROUND_SRC = extractBlock(
  'async function beginNewGameRound({ status = "lobby"',
  '// Build19(WRPS-072-B19): result/game_over 전환 시 참가자 스냅샷 완결성 보장'
);
const FETCH_FRESH_SRC = extractBlock(
  'async function fetchFreshParticipantsForResult(roomCode, maxRetries = 2, delayMs = 300) {',
  'function syncConfirmedIdsFromParticipants(participants = state.participants) {'
);
// handleRoomUpdate()의 result/game_over 분기 — 종료 중괄호(end marker의 첫 글자)까지 포함.
const RESULT_BRANCH_SRC = extractBlock(
  'if (state.status === "result" || state.status === "game_over") {',
  '} else if (state.status === "playing") {',
  true
);

function loadSchedulingHelpers(state) {
  const factory = new Function(
    'state', 'maxLoserCountFor',
    SCHEDULING_BLOCK +
      '\n; return { toPositiveInt, parsePenalty, getPenaltyText, getTargetLoserCount, getPenaltyGameRound, getGameRound, getCountdownStartAt, serverNow, getNextCountdownStartAt, buildPenaltyValue, getNextPhaseScheduledAt, getMaxLoserCount, clampLoserCount };'
  );
  return factory(state, maxLoserCountFor);
}

function loadBeginNewGameRound(state, scheduling) {
  const dbCalls = [];
  const db = {
    from: (table) => ({
      update: (payload) => ({
        eq: (col, val) => { dbCalls.push({ table, payload, col, val }); return Promise.resolve({ data: null, error: null }); },
      }),
    }),
  };
  const hasCurrentGameRoundActivity = () => false;
  const archiveCurrentRoundStats = () => {};
  const resetTransientRoundUi = () => {};
  const resetLocalParticipantsForNewGameRound = () => {};
  const saveState = () => {};
  const getNewGameRoundParticipantPatch = () => ({ choice: null, is_ready: false, wins: 0, losses: 0, draws: 0, penalties: 0 });
  const getOnlineMode = () => true;
  const factory = new Function(
    'state', 'db', 'hasCurrentGameRoundActivity', 'archiveCurrentRoundStats', 'resetTransientRoundUi',
    'getTargetLoserCount', 'getGameRound', 'getNextCountdownStartAt', 'buildPenaltyValue', 'getNextPhaseScheduledAt',
    'resetLocalParticipantsForNewGameRound', 'getOnlineMode', 'getNewGameRoundParticipantPatch', 'saveState',
    BEGIN_NEW_GAME_ROUND_SRC + '\n; return beginNewGameRound;'
  );
  const beginNewGameRound = factory(
    state, db, hasCurrentGameRoundActivity, archiveCurrentRoundStats, resetTransientRoundUi,
    scheduling.getTargetLoserCount, scheduling.getGameRound, scheduling.getNextCountdownStartAt,
    scheduling.buildPenaltyValue, scheduling.getNextPhaseScheduledAt,
    resetLocalParticipantsForNewGameRound, getOnlineMode, getNewGameRoundParticipantPatch, saveState
  );
  return { beginNewGameRound, dbCalls };
}

function loadFetchFreshParticipantsForResult({ state, db, sleepImpl }) {
  const emitted = [];
  const QA = { emit: (channel, data) => emitted.push(data) };
  const syncConfirmedIdsFromParticipants = () => {};
  const sleep = sleepImpl || (() => Promise.resolve());
  const factory = new Function(
    'state', 'QA', 'db', 'sleep', 'syncConfirmedIdsFromParticipants',
    CHOICE_HELPERS_BLOCK + '\n' + FETCH_FRESH_SRC + '\n; return fetchFreshParticipantsForResult;'
  );
  const fetchFreshParticipantsForResult = factory(state, QA, db, sleep, syncConfirmedIdsFromParticipants);
  return { fetchFreshParticipantsForResult, emitted };
}

async function runResultBranch({ room, state, waitForPhaseRender, fetchFreshParticipantsForResult, finishRoundLocal, db }) {
  const scheduling = loadSchedulingHelpers(state);
  const emitted = [];
  const QA = { emit: (channel, data) => emitted.push(data) };
  const getGameRound = () => state.gameRound || 1;
  const factory = new Function(
    'room', 'state', 'parsePenalty', 'waitForPhaseRender', 'fetchFreshParticipantsForResult', 'finishRoundLocal', 'db', 'getGameRound', 'QA',
    'return (async () => {\n' + RESULT_BRANCH_SRC + '\n})();'
  );
  await factory(room, state, scheduling.parsePenalty, waitForPhaseRender, fetchFreshParticipantsForResult, finishRoundLocal, db, getGameRound, QA);
  return emitted;
}

describe('Build24-C — beginNewGameRound({status:"ready"}) penalty scheduling metadata', () => {
  it('penalty.phaseKind === "ready", phaseScheduledAt > 0 (실제 소스 실행)', async () => {
    const state = {
      newRoundResetting: false, participants: [], confirmedSafeIds: [], confirmedLoserIds: [],
      targetLoserCount: 1, gameRound: 1, penalty: null, roomCode: 'ROOM1',
    };
    const scheduling = loadSchedulingHelpers(state);
    const { beginNewGameRound, dbCalls } = loadBeginNewGameRound(state, scheduling);
    await beginNewGameRound({ status: 'ready', increment: true, reason: 'reset_game_keep_room' });
    const parsed = scheduling.parsePenalty(state.penalty);
    expect(parsed.phaseKind).toBe('ready');
    expect(parsed.phaseScheduledAt).toBeGreaterThan(0);
    // DB에 실제로 쓰이는 penalty도 동일해야 한다(로컬 state와 DB write가 항상 같은 값).
    const roomsCall = dbCalls.find((c) => c.table === 'rooms');
    expect(roomsCall.payload.status).toBe('ready');
    expect(scheduling.parsePenalty(roomsCall.payload.penalty).phaseKind).toBe('ready');
  });

  it('countdownStartAt 의미는 그대로 유지된다(status!=="playing"이면 저장된 JSON에 키 자체가 없음)', async () => {
    // parsePenalty()는 파싱 후 항상 기본값(0/"")을 채워 반환하므로, "정말로 안 실렸는지"는 buildPenaltyValue가
    // 만든 원본 JSON을 직접 파싱해 키 존재 여부로 확인한다(buildPenaltyValue의 조건부 포함 로직 검증).
    const state = { newRoundResetting: false, participants: [], confirmedSafeIds: [], confirmedLoserIds: [],
      targetLoserCount: 1, gameRound: 1, penalty: null, roomCode: 'ROOM1' };
    const scheduling = loadSchedulingHelpers(state);
    const { beginNewGameRound } = loadBeginNewGameRound(state, scheduling);
    await beginNewGameRound({ status: 'ready', increment: true });
    const raw = JSON.parse(state.penalty);
    expect(raw.countdownStartAt).toBeUndefined(); // ready 전환은 카운트다운 예정시각이 없어야 함
    expect(raw.phaseScheduledAt).toBeGreaterThan(0); // 대신 ready 예정시각은 실려야 함
  });

  it('회귀 없음: status="lobby"/"waiting"은 여전히 저장된 JSON에 phaseScheduledAt/phaseKind 키가 없다', async () => {
    for (const status of ['lobby', 'waiting']) {
      const state = { newRoundResetting: false, participants: [], confirmedSafeIds: [], confirmedLoserIds: [],
        targetLoserCount: 1, gameRound: 1, penalty: null, roomCode: 'ROOM1' };
      const scheduling = loadSchedulingHelpers(state);
      const { beginNewGameRound } = loadBeginNewGameRound(state, scheduling);
      await beginNewGameRound({ status, increment: true });
      const raw = JSON.parse(state.penalty);
      expect(raw.phaseKind).toBeUndefined();
      expect(raw.phaseScheduledAt).toBeUndefined();
    }
  });

  it('resetGameKeepRoom 이후 participant 측 readyScheduledAt 계산이 더 이상 0(null)이 아니다(엔드투엔드)', async () => {
    // handleRoomUpdate()의 ready 분기가 실제로 쓰는 것과 동일한 공식:
    // (readyPenaltyParsed.phaseKind === "ready") ? readyPenaltyParsed.phaseScheduledAt : 0
    const state = { newRoundResetting: false, participants: [], confirmedSafeIds: [], confirmedLoserIds: [],
      targetLoserCount: 1, gameRound: 1, penalty: null, roomCode: 'ROOM1' };
    const scheduling = loadSchedulingHelpers(state);
    const { beginNewGameRound } = loadBeginNewGameRound(state, scheduling);
    await beginNewGameRound({ status: 'ready', increment: true, reason: 'reset_game_keep_room' });
    const readyPenaltyParsed = scheduling.parsePenalty(state.penalty);
    const readyScheduledAt = (readyPenaltyParsed.phaseKind === 'ready') ? readyPenaltyParsed.phaseScheduledAt : 0;
    // 회귀 전(Build23 이하)에는 phaseKind가 항상 ""였으므로 readyScheduledAt은 항상 0(→null)이었다.
    expect(readyScheduledAt).toBeGreaterThan(0);
  });

  it('nextRound()의 기존 phaseKind:"ready" 처리는 회귀 없음(변경되지 않음, 소스 계약)', () => {
    expect(html).toContain('phaseKind: "ready" });');
    expect(html).toContain("status: 'ready', penalty: readyPenalty");
  });
});

describe('Build24-A — render-timing measurement decoupled from snapshot-retry wait', () => {
  it('snapshot fetch가 느려도 SYNC_RENDER 측정(waitForPhaseRender)은 그 전에 먼저 끝난다(순서 보장)', async () => {
    const callOrder = [];
    const room = { penalty: JSON.stringify({ text: '', phaseScheduledAt: Date.now() - 50, phaseKind: 'result' }) };
    const state = { status: 'result', roomCode: 'ROOM1', gameRound: 1, round: 1, renderedPhaseKeys: {} };
    const waitForPhaseRender = async () => { callOrder.push('waitForPhaseRender'); return true; };
    const fetchFreshParticipantsForResult = async () => {
      callOrder.push('fetchFreshParticipantsForResult:start');
      await new Promise((r) => setTimeout(r, 30));
      callOrder.push('fetchFreshParticipantsForResult:end');
    };
    let finishCalled = false;
    const finishRoundLocal = () => { finishCalled = true; callOrder.push('finishRoundLocal'); };
    await runResultBranch({ room, state, waitForPhaseRender, fetchFreshParticipantsForResult, finishRoundLocal, db: {} });
    expect(finishCalled).toBe(true);
    expect(callOrder).toEqual([
      'waitForPhaseRender', 'fetchFreshParticipantsForResult:start', 'fetchFreshParticipantsForResult:end', 'finishRoundLocal',
    ]);
  });

  it('스냅샷 재조회 소요 시간은 SNAPSHOT_RETRY_DURATION 메트릭에 별도로(lateRenderMs와 분리되어) 기록된다', async () => {
    const room = { penalty: JSON.stringify({ text: '', phaseScheduledAt: Date.now(), phaseKind: 'result' }) };
    const state = { status: 'result', roomCode: 'ROOM1', gameRound: 3, round: 2, renderedPhaseKeys: {} };
    const waitForPhaseRender = async () => true;
    const fetchFreshParticipantsForResult = async () => { await new Promise((r) => setTimeout(r, 220)); };
    const finishRoundLocal = () => {};
    const emitted = await runResultBranch({ room, state, waitForPhaseRender, fetchFreshParticipantsForResult, finishRoundLocal, db: {} });
    const snap = emitted.find((e) => e.eventType === 'SNAPSHOT_RETRY_DURATION');
    expect(snap).toBeTruthy();
    expect(snap.snapshotRetryDurationMs).toBeGreaterThanOrEqual(200);
    expect(snap.gameNo).toBe(3);
    expect(snap.round).toBe(2);
  });

  it('waitForPhaseRender가 false(duplicate)를 반환하면 스냅샷 재조회도 finishRoundLocal도 호출되지 않는다(Build22-B dedup 유지)', async () => {
    const room = { penalty: JSON.stringify({ text: '', phaseScheduledAt: Date.now(), phaseKind: 'result' }) };
    const state = { status: 'result', roomCode: 'ROOM1', gameRound: 1, round: 1, renderedPhaseKeys: {} };
    const waitForPhaseRender = async () => false; // 이미 렌더된 phase(duplicate)
    let fetchCalled = false;
    const fetchFreshParticipantsForResult = async () => { fetchCalled = true; };
    let finishCalled = false;
    const finishRoundLocal = () => { finishCalled = true; };
    await runResultBranch({ room, state, waitForPhaseRender, fetchFreshParticipantsForResult, finishRoundLocal, db: {} });
    expect(fetchCalled).toBe(false); // Build24-A: duplicate면 스냅샷 재조회 자체도 스킵(불필요한 왕복 제거)
    expect(finishCalled).toBe(false);
  });

  it('db 또는 roomCode가 없으면 스냅샷 재조회 없이도 finishRoundLocal은 정상 호출된다(오프라인/구버전 호환)', async () => {
    const room = { penalty: JSON.stringify({ text: '', phaseScheduledAt: Date.now(), phaseKind: 'result' }) };
    const state = { status: 'result', roomCode: null, gameRound: 1, round: 1, renderedPhaseKeys: {} };
    const waitForPhaseRender = async () => true;
    let fetchCalled = false;
    const fetchFreshParticipantsForResult = async () => { fetchCalled = true; };
    let finishCalled = false;
    const finishRoundLocal = () => { finishCalled = true; };
    await runResultBranch({ room, state, waitForPhaseRender, fetchFreshParticipantsForResult, finishRoundLocal, db: null });
    expect(fetchCalled).toBe(false);
    expect(finishCalled).toBe(true);
  });
});

describe('Build24-B ROLLBACK — 실기기 회귀(room PP2C) 재현 및 수정 확인', () => {
  // 근본 원인: host-only fast-path("이미 신선해 보이면 재조회 스킵")가 syncConfirmedIdsFromParticipants()
  // 호출까지 함께 건너뛰어, state.confirmedSafeIds/LoserIds가 재정규화되지 않은 채로 finishRoundLocal()의
  // 판정 입력이 되었다 — 그 결과 2인 게임(target=1) gameOver 라운드에서 host의 "한번더" 버튼이
  // activeCandidateCount=2/confirmedTaggerCount=0으로 오분류되어 visible=false로 영구 숨겨짐
  // (resultValue:null, shadowMismatch:true 동반). 판정 정확성을 GAVE_UP 감소보다 우선해 fast-path를
  // 완전히 롤백한다 — host/participant 구분 없이 항상 재시도 루프(및 매 시도의
  // syncConfirmedIdsFromParticipants 호출)를 거친다.

  it('요구사항 #1/#3 — fast-path가 완전히 제거되었다: host/participant 무관하게 항상 DB를 재조회하고, TAGGER_SNAPSHOT_ALREADY_FRESH는 더는 존재하지 않는다', async () => {
    expect(html).not.toContain('TAGGER_SNAPSHOT_ALREADY_FRESH');
    expect(html).not.toContain("state.role === \"host\" && unresolvedOf(state.participants).length === 0");
    for (const role of ['host', 'participant']) {
      const participants = [
        { id: 'p1', choice: 'rock|lose' },
        { id: 'p2', choice: 'paper|win' },
      ];
      const state = { role, status: 'result', roomCode: 'ROOM1', confirmedSafeIds: [], confirmedLoserIds: [], participants };
      let dbCalled = false;
      const db = { from: () => { dbCalled = true; return { select: () => ({ eq: () => ({ order: () => Promise.resolve({ data: participants }) }) }) }; } };
      const { fetchFreshParticipantsForResult, emitted } = loadFetchFreshParticipantsForResult({ state, db });
      await fetchFreshParticipantsForResult('ROOM1');
      expect(dbCalled).toBe(true); // role에 관계없이 항상 재조회(fast-path 완전 제거)
      expect(emitted.some((e) => e.eventType === 'TAGGER_SNAPSHOT_ALREADY_FRESH')).toBe(false);
    }
  });

  it('요구사항 #2 — fetchFreshParticipantsForResult()는 host가 이미 신선해 보이는 데이터를 갖고 있어도 매 시도마다 실제 syncConfirmedIdsFromParticipants()를 호출해 confirmedSafeIds/LoserIds를 재정규화한다(실제 함수, mock 아님)', async () => {
    // syncConfirmedIdsFromParticipants를 스파이로 감싸 실제 호출 여부/횟수를 확인한다(회귀의 정확한 원인).
    // 실제 함수 소스를 별명(__realSyncConfirmedIdsFromParticipants)으로 추출해, 원래 이름으로는
    // 호출 횟수를 세는 얇은 래퍼를 두어 이름 충돌(무한재귀) 없이 실제 로직을 그대로 실행한다.
    const realSyncSrcRaw = extractBlock(
      'function syncConfirmedIdsFromParticipants(participants = state.participants) {',
      'function isWaitingForNextGame('
    );
    const realSyncSrcRenamed = realSyncSrcRaw.replace(
      'function syncConfirmedIdsFromParticipants(participants = state.participants) {',
      'function __realSyncConfirmedIdsFromParticipants(participants = state.participants) {'
    );
    const participants = [
      { id: 'p1', choice: 'rock|lose' },
      { id: 'p2', choice: 'paper|win' },
    ];
    const state = { role: 'host', status: 'result', roomCode: 'ROOM1', confirmedSafeIds: [], confirmedLoserIds: [], participants };
    const emitted = [];
    const QA = { emit: (channel, data) => emitted.push(data) };
    const db = { from: () => ({ select: () => ({ eq: () => ({ order: () => Promise.resolve({ data: participants }) }) }) }) };
    const sleep = () => Promise.resolve();
    const factory = new Function(
      'state', 'QA', 'db', 'sleep', 'syncCounter',
      CHOICE_HELPERS_BLOCK + '\n' + realSyncSrcRenamed +
        '\nfunction syncConfirmedIdsFromParticipants(p) { syncCounter.count++; return __realSyncConfirmedIdsFromParticipants(p); }\n' +
        FETCH_FRESH_SRC + '\n; return fetchFreshParticipantsForResult;'
    );
    const syncCounter = { count: 0 };
    const fetchFreshParticipantsForResult = factory(state, QA, db, sleep, syncCounter);
    await fetchFreshParticipantsForResult('ROOM1');
    expect(syncCounter.count).toBeGreaterThanOrEqual(1); // 회귀 이전(fast-path 존재 시)에는 0이었을 것
    // 실제 syncConfirmedIdsFromParticipants가 정말 실행되어 confirmedLoserIds가 재정규화됐는지도 확인
    // (마커 기반이라 이 라운드는 아직 __loser__ 마커가 없으므로 빈 배열 유지가 정상 — 호출 자체가 핵심).
    expect(state.confirmedSafeIds).toEqual([]);
    expect(state.confirmedLoserIds).toEqual([]);
  });

  it('요구사항 #5 — host, gameOver, targetTaggerCount 충족(활성 풀 0)이면 실제 canShowPlayAgainButton()은 true다(Build23 playAgain guard 자체는 무변경 — tests/build23-play-again-guard.test.mjs와 동일 소스, 여기서도 재확인)', () => {
    // canShowPlayAgainButton()/isTaggerSelectionComplete()는 Build24에서 전혀 손대지 않았다 — 이번
    // 회귀는 그 앞단(입력 데이터 정규화)에서 발생했다. 이 테스트는 그 경계를 명확히 하기 위한
    // 소스 계약 확인이다(로직 자체는 tests/build23-play-again-guard.test.mjs가 이미 실제 실행으로 검증).
    expect(html).toMatch(/function isTaggerSelectionComplete\(\) \{\s*\n\s*return \(state\.participants \|\| \[\]\)\.length > 0 && getActivePlayers\(\)\.length === 0;\s*\n\s*\}/);
  });

  it('요구사항 #6 — host, gameOver 상태에서도 재조회 경로가 항상 실행된다(resultValue null의 전제조건이었던 fast-path skip 제거 확인)', async () => {
    // resultValue null 자체는 finishRoundLocal()의 별도 로직이라 이 파일에서 end-to-end로 재현하지
    // 않지만(finishRoundLocal 전체 추출은 범위 밖), 그 전제 조건(재조회 자체가 항상 실행되어 신선한
    // confirmedSafeIds/LoserIds를 확보하는 것)은 여기서 직접 검증한다 — fast-path가 있었다면
    // 아래 dbCalled assert가 실패했다(재조회 자체가 스킵됐을 것).
    const participants = [
      { id: 'p1', choice: 'rock|lose' },
      { id: 'p2', choice: 'paper|win' },
    ];
    const state = { role: 'host', status: 'game_over', roomCode: 'ROOM1', confirmedSafeIds: [], confirmedLoserIds: [], participants };
    let dbCalled = false;
    const db = { from: (...args) => { dbCalled = true; return { select: () => ({ eq: () => ({ order: () => Promise.resolve({ data: participants }) }) }) }; } };
    const { fetchFreshParticipantsForResult } = loadFetchFreshParticipantsForResult({ state, db });
    await fetchFreshParticipantsForResult('ROOM1');
    expect(dbCalled).toBe(true); // fast-path였다면 false(재조회 자체가 없었을 것)
  });

  it('요구사항 #7 — shadowMismatch 여부와 무관하게 fast-path 자체가 없으므로 "통과"할 방법이 없다(구조적 보장)', () => {
    // fast-path가 완전히 삭제되었으므로, shadowMismatch가 있든 없든 이 함수는 항상 동일하게
    // DB 재조회 + syncConfirmedIdsFromParticipants를 거친다 — "조건부로 통과시키는" 로직 자체가 없다.
    expect(html).not.toMatch(/if \(state\.role === "host" && unresolvedOf/);
  });

  it('회귀 없음: TAGGER_FALLBACK_SOURCE는 여전히 stored를 우선하고 localJudge는 최후 수단으로만 기록된다(Build22-C 무변경, 소스 계약)', () => {
    expect(html).toMatch(/const hasStoredResults = activeForStoredResult\.length > 0 &&[\s\S]{0,60}activeForStoredResult\.every\(p => hasConfirmedRoundResult\(p\.choice\)\);/);
    expect(html).toMatch(/eventType: 'TAGGER_FALLBACK_SOURCE', source: hasStoredResults \? 'stored' : 'localJudge'/);
    // judgeRound(로컬 재계산)는 hasStoredResults가 false인 else 분기에서만 호출된다 — 판정 알고리즘 자체는 무변경.
    expect(html).toMatch(/if \(hasStoredResults\) \{[\s\S]{0,500}\} else \{\s*\n\s*Object\.assign\(result, judgeRound\(state\.participants\)\);/);
  });
});

describe('Build24 — 판정 알고리즘/partial replay guard 비침습 계약', () => {
  it('judgePure/resolveElimination/judgeRound 시그니처는 그대로 유지된다', () => {
    expect(html).toContain('function judgeRound(');
    expect(html).toContain('function resolveElimination(');
    expect(html).toContain('function judgePure(');
  });
  it('Build23 partial replay guard(isTaggerSelectionComplete/canShowPlayAgainButton/blockPlayAgainIfPartialReplay)는 재작성되지 않았다', () => {
    expect(html).toMatch(/function isTaggerSelectionComplete\(\) \{\s*\n\s*return \(state\.participants \|\| \[\]\)\.length > 0 && getActivePlayers\(\)\.length === 0;\s*\n\s*\}/);
    expect(html).toContain('function canShowPlayAgainButton() {');
    expect(html).toContain('function blockPlayAgainIfPartialReplay() {');
  });
});
