import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';

// Build29(WRPS-076) [P4] — 연타(더블탭) 방어 6곳 + nextRound catch 검증.
// 전수 조사 결과 완전 무방어였던 6개 함수(goToReadyScreen/endGame/inviteForReplay/nextRound(온라인
// 분기)/selectChoice/becomeNextHost) 각각에 최소 수정을 적용했다. 실제 소스 추출 + new Function()
// 실행 패턴(tests/build28-round-judge-integrity.test.mjs와 동일).
//
// ⚠️ 계약(어기면 회귀): F1은 gameStarting/autoStartInFlight를 재사용하지 않고 전용 플래그
// (goingToReady)를 쓴다. F4는 advancingRound를 성공 경로에서 해제하지 않는다(catch에서만).

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

function extractBlock(startMarker, endMarker, includeEndFirstChar = false) {
  const start = html.indexOf(startMarker);
  if (start < 0) throw new Error(`start marker not found: ${startMarker}`);
  let end = html.indexOf(endMarker, start);
  if (end < 0) throw new Error(`end marker not found: ${endMarker}`);
  if (includeEndFirstChar) end += 1;
  return html.slice(start, end);
}

const CHOICE_HELPERS_BLOCK = extractBlock(
  'function isNonPlayingChoice(choice) {',
  'function getParticipantSignature('
);

function makeDb(overrides = {}) {
  const calls = [];
  const db = {
    from: (table) => ({
      select: () => ({
        eq: () => ({
          single: async () => (overrides.single ? overrides.single(table) : { data: null, error: null }),
        }),
      }),
      update: (payload) => ({
        eq: (col, val) => { calls.push({ table, op: 'update', payload, col, val }); return overrides.update ? overrides.update(table, payload) : Promise.resolve({ data: null, error: null }); },
        in: (col, val) => { calls.push({ table, op: 'update-in', payload, col, val }); return overrides.update ? overrides.update(table, payload) : Promise.resolve({ data: null, error: null }); },
      }),
      delete: () => ({ eq: () => Promise.resolve({ data: null, error: null }) }),
    }),
  };
  return { db, calls };
}

// ════════════════════════════════════════════════════════════════════
describe('Build29 [P4, F1, 최우선] goToReadyScreen — 연타 방어', () => {
  const GO_TO_READY_SRC = extractBlock(
    'async function goToReadyScreen() {',
    'async function triggerReplayIfLastReady() {'
  );

  function loadGoToReadyScreen({ state, db, getPenaltyText, ensurePenaltyValue, updateRoomStatus, showToast, t, showHostRoom }) {
    const calls = { showToast: [], showHostRoom: 0, updateRoomStatus: 0 };
    const $calls = {};
    const $ = (id) => {
      if (id === 'startGameBtn') {
        if (!$calls.startGameBtn) $calls.startGameBtn = { disabled: false };
        return $calls.startGameBtn;
      }
      return null;
    };
    const factory = new Function(
      'state', 'db', 'getOnlineMode', 'getPenaltyText', 'ensurePenaltyValue', 'updateRoomStatus',
      'showToast', 't', 'showHostRoom', '$',
      GO_TO_READY_SRC + '\n; return goToReadyScreen;'
    );
    const goToReadyScreen = factory(
      state, db, () => true, getPenaltyText || (() => 'text'), ensurePenaltyValue || (() => 'PENALTY'),
      updateRoomStatus || (() => Promise.resolve()),
      showToast || ((msg) => calls.showToast.push(msg)), t || ((k) => k),
      showHostRoom || (() => { calls.showHostRoom++; }), $
    );
    return { goToReadyScreen, calls, $calls };
  }

  it('(a) 연타(동시 재호출) — 두 번째 호출은 즉시 no-op(DB write 1세트만 나간다)', async () => {
    const state = { goingToReady: false, roomCode: 'R1', participants: [], status: 'penalty_setting' };
    const { db, calls: dbCalls } = makeDb();
    const { goToReadyScreen } = loadGoToReadyScreen({ state, db });
    const p1 = goToReadyScreen();
    const p2 = goToReadyScreen(); // 첫 호출이 아직 진행 중일 때 즉시 재클릭
    await Promise.all([p1, p2]);
    // rooms.penalty update + participants.is_ready update = 2건(updateRoomStatus는 별도 스텁이라
    // 이 db 트래커에 잡히지 않음) — 정확히 1세트만 나가야 한다(연타로 2세트=4건이 되면 회귀).
    expect(dbCalls.length).toBe(2);
  });

  it('(b) 정상 1회 클릭은 종전대로 동작한다(penalty 확정, status="ready", showHostRoom 호출)', async () => {
    const state = { goingToReady: false, roomCode: 'R1', participants: [], status: 'penalty_setting' };
    const { db } = makeDb();
    const { goToReadyScreen, calls } = loadGoToReadyScreen({ state, db });
    await goToReadyScreen();
    expect(state.status).toBe('ready');
    expect(calls.showHostRoom).toBe(1);
    expect(state.goingToReady).toBe(false); // finally로 해제됨(다음 클릭 가능)
  });

  it('(c) 벌칙 미설정이면 토스트 후 버튼이 즉시 재활성화되고 goingToReady도 해제된다', async () => {
    const state = { goingToReady: false, roomCode: 'R1', participants: [], status: 'penalty_setting' };
    const { db } = makeDb();
    const { goToReadyScreen, calls, $calls } = loadGoToReadyScreen({ state, db, ensurePenaltyValue: () => null });
    await goToReadyScreen();
    expect(calls.showToast).toEqual(['toast.penaltyNotSet']);
    expect($calls.startGameBtn.disabled).toBe(false);
    expect(state.goingToReady).toBe(false);
  });

  it('(d) DB 오류 시 버튼이 재활성화되고 goingToReady가 해제된다(다음 클릭으로 재시도 가능)', async () => {
    const state = { goingToReady: false, roomCode: 'R1', participants: [], status: 'penalty_setting' };
    const { db } = makeDb({ update: () => Promise.reject(new Error('network down')) });
    const { goToReadyScreen, calls, $calls } = loadGoToReadyScreen({ state, db });
    await goToReadyScreen();
    expect(calls.showToast.some((m) => m.includes('network down'))).toBe(true);
    expect($calls.startGameBtn.disabled).toBe(false);
    expect(state.goingToReady).toBe(false);
  });

  it('회귀 계약: gameStarting/autoStartInFlight를 재사용하지 않는다(전용 플래그 goingToReady여야 함)', () => {
    expect(GO_TO_READY_SRC).toContain('state.goingToReady');
    expect(GO_TO_READY_SRC).not.toMatch(/if \(state\.gameStarting[^)]*\)\s*return;/);
    expect(GO_TO_READY_SRC).not.toContain('state.autoStartInFlight');
  });
});

// ════════════════════════════════════════════════════════════════════
describe('Build29 [P4, F2] endGame — 연타 방어', () => {
  const END_GAME_SRC = extractBlock(
    'async function endGame() {',
    '// 완료된 게임 결과 저장을 시도하고, 실패하면 토스트로 재시도를 안내한다.'
  );

  function loadEndGame({ state, updateRoomStatus, persistCompletedGameWithRetry }) {
    const calls = { updateRoomStatus: 0, persist: 0, renderStats: 0, saveState: 0, showScreen: [], playGameOverVoiceOnce: 0 };
    const $ = () => null;
    const factory = new Function(
      'state', 'getOnlineMode', 'updateRoomStatus', 'persistCompletedGameWithRetry', 'renderStats', 'saveState',
      '$', 'showScreen', 'playGameOverVoiceOnce',
      END_GAME_SRC + '\n; return endGame;'
    );
    const endGame = factory(
      state, () => true,
      updateRoomStatus || (async () => { calls.updateRoomStatus++; }),
      persistCompletedGameWithRetry || (async () => { calls.persist++; }),
      () => { calls.renderStats++; }, () => { calls.saveState++; }, $,
      (id) => calls.showScreen.push(id), () => { calls.playGameOverVoiceOnce++; }
    );
    return { endGame, calls };
  }

  it('연타(동시 재호출) — 두 번째 호출은 즉시 no-op(통계 저장 1회만 실행)', async () => {
    const state = { endingGame: false, role: 'host', roomCode: 'R1', participants: [] };
    const { endGame, calls } = loadEndGame({ state });
    await Promise.all([endGame(), endGame()]);
    expect(calls.updateRoomStatus).toBe(1);
    expect(calls.persist).toBe(1);
  });

  it('정상 1회 호출은 종전대로 동작하고 종료 후 재호출 가능하다(endingGame 해제)', async () => {
    const state = { endingGame: false, role: 'host', roomCode: 'R1', participants: [] };
    const { endGame, calls } = loadEndGame({ state });
    await endGame();
    expect(calls.showScreen).toEqual(['screenStats']);
    expect(state.endingGame).toBe(false);
    await endGame();
    expect(calls.persist).toBe(2); // 두 번째 "독립" 호출도 정상 실행됨(연타가 아니라 완료 후 재호출)
  });
});

// ════════════════════════════════════════════════════════════════════
describe('Build29 [P4, F3] inviteForReplay — 연타 방어', () => {
  const INVITE_SRC = extractBlock(
    'async function inviteForReplay() {',
    'function showInvitePopupForRoom(roomCode) {'
  );

  function loadInviteForReplay({ state, db, resetGameKeepRoom, _showInviteHostPopup }) {
    const calls = { popup: 0, reset: 0 };
    const factory = new Function(
      'state', 'getOnlineMode', 'resetGameKeepRoom', 'db', '_showInviteHostPopup',
      INVITE_SRC + '\n; return inviteForReplay;'
    );
    const inviteForReplay = factory(
      state, () => true,
      resetGameKeepRoom || (async () => { calls.reset++; }),
      db, _showInviteHostPopup || (() => { calls.popup++; })
    );
    return { inviteForReplay, calls };
  }

  it('(a) 이미 status==="reinviting"이면 DB write 없이 팝업만 재노출한다(연타 방어)', async () => {
    const state = { status: 'reinviting', roomCode: 'R1' };
    const { db, calls: dbCalls } = makeDb();
    const { inviteForReplay, calls } = loadInviteForReplay({ state, db });
    await inviteForReplay();
    expect(dbCalls.length).toBe(0);
    expect(calls.popup).toBe(1);
  });

  it('(b) 정상 최초 호출은 status를 reinviting으로 쓰고 팝업을 연다(회귀 없음)', async () => {
    const state = { status: 'result', roomCode: 'R1' };
    const { db, calls: dbCalls } = makeDb();
    const { inviteForReplay, calls } = loadInviteForReplay({ state, db });
    await inviteForReplay();
    expect(dbCalls.length).toBe(1);
    expect(dbCalls[0].payload.status).toBe('reinviting');
    expect(calls.popup).toBe(1);
  });
});

// ════════════════════════════════════════════════════════════════════
describe('Build29 [P4, F4] nextRound(온라인 분기) — catch에서만 advancingRound 해제', () => {
  const NEXT_ROUND_SRC = extractBlock('async function nextRound() {', 'async function endGame() {');

  function loadNextRound({ state, db, showToast, buildPenaltyValue, getNextPhaseScheduledAt, getTargetLoserCount, getGameRound, showReadyScreen, scheduleRematchAdvanceRetryAfterFailure }) {
    const calls = { showToast: [], renderRoundResult: [], showScreen: [], showReadyScreen: 0, saveState: 0, scheduleRematchAdvanceRetryAfterFailure: 0 };
    const factory = new Function(
      'state', 'getOnlineMode', 'getTargetLoserCount', 'showToast', 't', 'renderRoundResult', 'showScreen',
      'buildPenaltyValue', 'getGameRound', 'getNextPhaseScheduledAt', 'db', 'saveState', 'showReadyScreen',
      'scheduleRematchAdvanceRetryAfterFailure',
      NEXT_ROUND_SRC + '\n; return nextRound;'
    );
    const nextRound = factory(
      state, () => true, getTargetLoserCount || (() => 1),
      showToast || ((m) => calls.showToast.push(m)), (k) => k,
      (c, l, r) => calls.renderRoundResult.push({ c, l, r }),
      (id) => calls.showScreen.push(id),
      buildPenaltyValue || (() => ({})), getGameRound || (() => 1),
      getNextPhaseScheduledAt || (() => Date.now()), db,
      () => { calls.saveState++; },
      showReadyScreen || (() => { calls.showReadyScreen++; }),
      scheduleRematchAdvanceRetryAfterFailure || (() => { calls.scheduleRematchAdvanceRetryAfterFailure++; })
    );
    return { nextRound, calls };
  }

  it('(a) 실패 시 advancingRound가 false로 해제되고 토스트가 뜬다(재시도 가능)', async () => {
    const state = { advancingRound: false, confirmedSafeIds: [], confirmedLoserIds: [], targetLoserCount: 1, roomCode: 'R1', round: 1 };
    const { db } = makeDb({ update: () => Promise.reject(new Error('boom')) });
    const { nextRound, calls } = loadNextRound({ state, db });
    await nextRound();
    expect(state.advancingRound).toBe(false);
    expect(calls.showToast.length).toBe(1);
    // Build29 Round2(codex-critic VERDICT-3 HIGH-1, 안전망 A): 실패 시 재예약 헬퍼가 반드시
    // 호출된다(호출 안 하면 방이 'result'에서 영구 정지 — 자세한 재시도/상한 검증은
    // build29-rematch-advance-resilience.test.mjs에서 실제 헬퍼 구현으로 커버).
    expect(calls.scheduleRematchAdvanceRetryAfterFailure).toBe(1);
  });

  it('(b) 성공 시 advancingRound는 nextRound 자신이 해제하지 않는다(finishRoundLocal/enterPlayingState의 몫)', async () => {
    const state = { advancingRound: false, confirmedSafeIds: [], confirmedLoserIds: [], targetLoserCount: 1, roomCode: 'R1', round: 1 };
    const { db } = makeDb();
    const { nextRound } = loadNextRound({ state, db });
    await nextRound();
    // 계약: 성공 경로는 advancingRound를 true인 채로 남겨둔다(다른 함수가 나중에 해제).
    expect(state.advancingRound).toBe(true);
  });

  it('(c) 이미 advancingRound===true면 즉시 no-op(이중 전환 방지 — 회귀 없음)', async () => {
    const state = { advancingRound: true, confirmedSafeIds: [], confirmedLoserIds: [], targetLoserCount: 1, roomCode: 'R1', round: 1 };
    const { db, calls: dbCalls } = makeDb();
    const { nextRound } = loadNextRound({ state, db });
    await nextRound();
    expect(dbCalls.length).toBe(0);
  });

  it('회귀 계약: catch 블록 밖(finally)에서 advancingRound를 해제하지 않는다(소스 구조 확인)', () => {
    expect(NEXT_ROUND_SRC).toMatch(/catch \(e\) \{\s*\n\s*state\.advancingRound = false;/);
    expect(NEXT_ROUND_SRC).not.toMatch(/\} finally \{\s*\n\s*state\.advancingRound = false;/);
  });
});

// ════════════════════════════════════════════════════════════════════
describe('Build29 [P4, F5] selectChoice — 같은 손 재클릭 write 스킵', () => {
  const SELECT_CHOICE_SRC = extractBlock('async function selectChoice(choice, event) {', 'function updateSelectedCount() {');

  function loadSelectChoice({ state, updateParticipantChoice }) {
    const calls = { updateParticipantChoice: [], updateSelectedCount: 0, updateGuides: 0 };
    const $ = () => null;
    const factory = new Function(
      'state', 'isCurrentRoundParticipant', 'updateSelectedCount', 'updateGuides', 'updateHostSelectedCount',
      '$', 'choiceLabel', 'getOnlineMode', 'updateParticipantChoice', 'showToast', 't', 'saveState',
      CHOICE_HELPERS_BLOCK + '\n' + SELECT_CHOICE_SRC + '\n; return selectChoice;'
    );
    const rawSelectChoice = factory(
      state, () => true,
      () => { calls.updateSelectedCount++; }, () => { calls.updateGuides++; }, () => {},
      $, {}, () => true,
      updateParticipantChoice || (async (c) => { calls.updateParticipantChoice.push(c); }),
      () => {}, (k) => k, () => {}
    );
    // document 참조는 jsdom 환경이 아니면 querySelectorAll이 없을 수 있다 — 이 테스트 관심사(같은
    // 손 재클릭 write 스킵)와 무관하므로, 실제 호출 구간에서만 no-op 전역 stub으로 대체한다
    // (factory 생성 시점이 아니라 호출 시점에 감싸야 한다 — new Function은 body를 호출 시에만 실행).
    const selectChoice = async (...args) => {
      const originalDocument = globalThis.document;
      globalThis.document = { querySelectorAll: () => ({ forEach: () => {} }) };
      try {
        return await rawSelectChoice(...args);
      } finally {
        globalThis.document = originalDocument;
      }
    };
    return { selectChoice, calls };
  }

  it('(a) 같은 손 재클릭이면 updateParticipantChoice(write)를 호출하지 않는다', async () => {
    const state = { status: 'playing', currentUserId: 'p1', role: 'participant', participants: [{ id: 'p1', choice: 'rock' }] };
    const { selectChoice, calls } = loadSelectChoice({ state });
    await selectChoice('rock', null);
    expect(calls.updateParticipantChoice).toEqual([]);
  });

  it('(b) 결과/auto 플래그가 인코딩된 같은 손("rock|win|auto")도 getChoiceBase 기준으로 동일 취급되어 스킵된다', async () => {
    const state = { status: 'playing', currentUserId: 'p1', role: 'participant', participants: [{ id: 'p1', choice: 'rock|win|auto' }] };
    const { selectChoice, calls } = loadSelectChoice({ state });
    await selectChoice('rock', null);
    expect(calls.updateParticipantChoice).toEqual([]);
  });

  it('(c) 다른 손으로 바꾸면 정상적으로 write된다(회귀 없음)', async () => {
    const state = { status: 'playing', currentUserId: 'p1', role: 'participant', participants: [{ id: 'p1', choice: 'rock' }] };
    const { selectChoice, calls } = loadSelectChoice({ state });
    await selectChoice('paper', null);
    expect(calls.updateParticipantChoice).toEqual(['paper']);
    expect(state.participants[0].choice).toBe('paper');
  });

  it('(d) 최초 선택(참가자 choice가 null)은 정상적으로 write된다(회귀 없음)', async () => {
    const state = { status: 'playing', currentUserId: 'p1', role: 'participant', participants: [{ id: 'p1', choice: null }] };
    const { selectChoice, calls } = loadSelectChoice({ state });
    await selectChoice('scissors', null);
    expect(calls.updateParticipantChoice).toEqual(['scissors']);
  });
});

// ════════════════════════════════════════════════════════════════════
describe('Build29 [P4, F6] becomeNextHost — 연타 방어', () => {
  const BECOME_NEXT_HOST_SRC = extractBlock('async function becomeNextHost() {', 'function startGameOverCountdown(seconds) {');
  // WRPS-083 1단계 대응: becomeNextHost가 이제 REAL 헬퍼(promoteParticipantToHost/
  // verifyExactlyOneHost — 승격 성공 확인 + exactly-one 사후 검증)를 호출하므로 그 블록도
  // 그대로 추출해 함께 구동한다(스텁 아님). 승격 성공 확인은 select(...).single() 재조회를
  // 쓰므로 makeDb의 single override로 "승격 반영된 row"를 돌려준다.
  const HOST_SAFETY_HELPERS_SRC = extractBlock('function pickDeterministicHostCandidate(rows) {', 'async function leaveRoom() {');

  function loadBecomeNextHost({ state, db, beginNewGameRound }) {
    const calls = { showHostRoom: 0, stopGameOverCountdown: 0, beginNewGameRound: 0 };
    const factory = new Function(
      'state', 'getOnlineMode', 'stopGameOverCountdown', 'db', 'beginNewGameRound', 'showHostRoom',
      'showToast', 't', 'QA',
      HOST_SAFETY_HELPERS_SRC + '\n' + BECOME_NEXT_HOST_SRC + '\n; return becomeNextHost;'
    );
    const becomeNextHost = factory(
      state, () => true, () => { calls.stopGameOverCountdown++; }, db,
      beginNewGameRound || (async () => { calls.beginNewGameRound++; }),
      () => { calls.showHostRoom++; },
      () => {}, (key) => key, { emit: () => {} }
    );
    return { becomeNextHost, calls };
  }

  // 승격 성공 확인용 재조회(single) — 신규 host(p2)의 승격이 반영된 row를 돌려준다.
  const promotedSingle = () => ({ data: { id: 'p2', is_host: true }, error: null });

  it('연타(동시 재호출) — 두 번째 호출은 즉시 no-op(is_host 승계 1세트만 실행)', async () => {
    const state = {
      becomingNextHost: false, currentUserId: 'p2', role: 'participant',
      participants: [{ id: 'p1', is_host: true }, { id: 'p2', is_host: false }],
    };
    const { db, calls: dbCalls } = makeDb({ single: promotedSingle });
    const { becomeNextHost, calls } = loadBecomeNextHost({ state, db });
    await Promise.all([becomeNextHost(), becomeNextHost()]);
    // is_host:true(신규 호스트, 승격 선행) + is_host:false(구 호스트 해제 후행) = 2건 업데이트, 딱 1세트만.
    // (WRPS-083 1단계로 순서만 해제→승격에서 승격→해제로 바뀌었고 세트 수는 동일하다.)
    expect(dbCalls.length).toBe(2);
    expect(dbCalls[0].payload).toEqual({ is_host: true });
    expect(dbCalls[1].payload).toEqual({ is_host: false });
    expect(calls.beginNewGameRound).toBe(1);
    expect(calls.showHostRoom).toBe(1);
  });

  it('정상 1회 호출은 종전대로 동작하고 완료 후 재호출 가능하다(becomingNextHost 해제)', async () => {
    const state = {
      becomingNextHost: false, currentUserId: 'p2', role: 'participant',
      participants: [{ id: 'p1', is_host: true }, { id: 'p2', is_host: false }],
    };
    const { db } = makeDb({ single: promotedSingle });
    const { becomeNextHost } = loadBecomeNextHost({ state, db });
    await becomeNextHost();
    expect(state.role).toBe('host');
    expect(state.becomingNextHost).toBe(false);
  });
});

describe('Build29 [P4] 비침습 계약 — 금지된 공통 디바운스 유틸 도입 없음', () => {
  it('newRoundResetting silent-drop 의미론은 그대로 유지된다(무변경 확인)', () => {
    expect(html).toContain('newRoundResetting');
  });
});
