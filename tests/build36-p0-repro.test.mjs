import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

// ════════════════════════════════════════════════════════════════════════════
// Build36 P0 재현 (RED 우선) — production code 수정 전에 결함을 먼저 증명한다.
//
// Build34의 커밋 1646009가 P0-1/P0-2를 이미 겨냥해 수정했고 자동 테스트도 전부 통과했는데
// 실기기는 여전히 RED였다. 그러므로 "수정 → 통과 → 실기기 재현"을 반복하지 않으려면
// 각 결함이 **먼저 RED로 재현되는 경로**를 고정해야 한다. 이 파일이 그 경로다.
//
// 두 재현은 서로 독립이다 — 공유 상태·공유 헬퍼 없이 각자 환경을 만든다.
// 검증 대상은 전부 index.html의 REAL 소스이며, 문자열 마커로 추출해 new Function으로 실행한다.
// ════════════════════════════════════════════════════════════════════════════

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

function extractBlock(startMarker, endMarker) {
  const start = html.indexOf(startMarker);
  if (start < 0) throw new Error(`start marker not found: ${startMarker}`);
  const end = html.indexOf(endMarker, start);
  if (end < 0) throw new Error(`end marker not found: ${endMarker}`);
  return html.slice(start, end);
}
const noop = () => {};
const toPositiveInt = (v, d = 0) => { const n = parseInt(v, 10); return Number.isFinite(n) && n > 0 ? n : d; };
const clampLoserCount = (v) => Math.max(1, parseInt(v, 10) || 1);

// ────────────────────────────────────────────────────────────────────────────
// P0-1 — 카운트다운 중복 (실기기: 3라운드부터 호스트 기기)
//
// 가설: handleRoomUpdate의 stale 게이트 두 축(isStaleRoundWithinGame /
// isStaleStatusWithinRound)은 **들어오는 row의 status가 진행 5단계
// (ready/playing/result/game_over/stats)일 때만** 적용된다. reset 계열
// (waiting/lobby/reinviting/penalty_setting)은 "정당한 리셋 전이"로 무조건 통과한다.
// 그래서 늦게 도착한 stale reset-family row 하나가
//   ① state.round = room.round 로 라운드를 되감고
//   ② state.status !== "playing" 조건을 참으로 만들어
//      playingEntryKey / countdownRenderedKey **원장 2개를 함께 지운다**
// → 뒤이어 같은 라운드의 playing row가 다시 오면 재진입이 열려 카운트다운이 2회 실행된다.
//
// 라운드3부터인 이유: reset 계열 status는 첫 게임/재대결 사이클을 한 번 돈 뒤에야
// 방 이력에 생긴다 — 라운드1~2에는 재배달될 reset row 자체가 존재하지 않는다.
// ────────────────────────────────────────────────────────────────────────────

const PENALTY_BLOCK_SRC = extractBlock('function parsePenalty(raw) {', '// ── 서버 시각 동기화');
const CHOICE_END_AT_BLOCK_SRC = extractBlock('function buildPenaltyValue({', 'function getVisiblePenaltyText() {');
const PREDICATES_SAFE_LOSER_SRC = extractBlock('function isSafeParticipant(id = state.currentUserId) {', 'const ROUND_CHOICES =');
const PREDICATES_ROUND_SRC = extractBlock('function isWaitingForNextGame(id = state.currentUserId) {', 'function isCountdownActive() {');
const ENTRY_KEY_SRC = extractBlock('function isCountdownActive() {', 'async function enterPlayingStateFromRoomUpdate() {');
const ENTER_PLAYING_SRC = extractBlock('async function enterPlayingStateFromRoomUpdate() {', 'async function cleanupDroppedParticipants() {');
const NON_PLAYING_SCREEN_SRC = extractBlock('function showNonPlayingRoundScreen() {', 'function renderInlinePenaltyBox(el) {');
const GENERATION_HELPER_SRC = extractBlock('function isCountdownGenerationCurrent(myGen, checkpoint) {', 'async function runCountdown(myGen) {');
const RUNCOUNTDOWN_SRC = extractBlock('function startHostJudgeBackstop() {', '// Phase 1: 호스트용 playing 화면 렌더');

// handleRoomUpdate의 prolog — stale 게이트부터 원장 소거까지. 결함 메커니즘 전체가 여기 있다.
const HRU_PROLOG_SRC = extractBlock(
  'const STALE_ROOM_UPDATE_SELF_HEAL_THRESHOLD = 5;',
  '// WRPS-083 2B: destroyed 조기 분기.'
);

const SCREEN_IDS = [
  'screenHome', 'screenHostRoom', 'screenParticipantWait', 'screenReady',
  'screenGame', 'screenHostPlaying', 'screenRoundResult', 'screenWinnerWait',
  'screenLoserWait', 'countdownOverlay',
];

function buildCountdownEnv({ myChoice = null, round = 3, mutateRevertFix = false } = {}) {
  const els = {};
  for (const id of SCREEN_IDS) {
    const classes = new Set(['hidden']);
    els[id] = {
      classList: { add: (c) => classes.add(c), remove: (c) => classes.delete(c), contains: (c) => classes.has(c) },
      textContent: '', innerHTML: '', style: {}, disabled: false,
    };
  }
  const $ = (id) => els[id] || null;
  const calls = { countdownRenders: [], ledgerWipes: [], staleSkipped: 0, screenShown: [] };
  const MY_ID = 'me';

  const penalty = (gameRound) => JSON.stringify({ text: '', loserCount: 1, gameRound, countdownStartAt: 1000 });

  const state = {
    currentUserId: MY_ID,
    role: 'host',
    status: 'playing',
    roomCode: 'ROOM1',
    round,
    gameRound: 1,
    penalty: penalty(1),
    targetLoserCount: 1,
    confirmedSafeIds: [],
    confirmedLoserIds: [],
    participants: [
      { id: MY_ID, name: 'host', is_host: true, choice: myChoice, is_ready: true },
      { id: 'p2', name: 'p2', is_host: false, choice: null, is_ready: true },
      { id: 'p3', name: 'p3', is_host: false, choice: null, is_ready: true },
    ],
    countdownGeneration: 0,
    countdownCoroutineActiveKey: null,
    countdownRenderedKey: null,
    playingEntryKey: null,
    gameStarting: false,
    staleRoomUpdateSkipStreak: 0,
    renderedPhaseKeys: {},
    renderedPhaseKeysGameNo: 1,
    confirmedIdsResetGameNo: null,
  };

  const showScreen = (id) => {
    calls.screenShown.push(id);
    for (const sid of SCREEN_IDS) els[sid].classList.add('hidden');
    if (els[id]) els[id].classList.remove('hidden');
  };
  const QA = {
    emit: (_k, p) => { if (p && p.eventType === 'STALE_ROOM_UPDATE_SKIPPED') calls.staleSkipped++; },
  };
  const db = { from: () => ({ update: () => ({ eq: () => Promise.resolve({ error: null }) }) }) };

  const factory = new Function(
    'state', '$', 'serverNow', 'toPositiveInt', 'clampLoserCount', 't', 'db', 'QA',
    'getOnlineMode', 'showScreen', 'showLoserWaitScreen', 'renderHostPlayingScreen',
    'runCountdown', 'stopRoundTimers', 'autoFillChoices', 'updateSelectedCount',
    'updateHostSelectedCount', 'beginRoundTimer', 'saveState', 'onCountdownRender',
    PENALTY_BLOCK_SRC + '\n' +
    CHOICE_END_AT_BLOCK_SRC + '\n' +
    PREDICATES_SAFE_LOSER_SRC + '\n' +
    PREDICATES_ROUND_SRC + '\n' +
    ENTRY_KEY_SRC + '\n' +
    ENTER_PLAYING_SRC + '\n' +
    NON_PLAYING_SCREEN_SRC + '\n' +
    GENERATION_HELPER_SRC + '\n' +
    RUNCOUNTDOWN_SRC + '\n' +
    // handleRoomUpdate prolog를 REAL 소스 그대로 함수 몸통으로 감싼다.
    // 여기서 끝나는 지점(destroyed 분기 직전)까지가 결함 메커니즘 전체다.
    'async function handleRoomUpdateProlog(room) {\n' +
    '  if (!state.roomCode) return { skipped: true };\n' +
    (mutateRevertFix ? HRU_PROLOG_SRC.replace(' && !room.__behindRoundReset', '') : HRU_PROLOG_SRC) + '\n' +
    '  return { skipped: false, oldStatus, newStatus: state.status };\n' +
    '}\n' +
    'return { enterPlayingStateFromRoomUpdate, handleRoomUpdateProlog, getPlayingEntryKey };'
  );

  const mod = factory(
    state, $, () => 5000, toPositiveInt, clampLoserCount, (k) => k, db, QA,
    () => true, showScreen,
    () => { showScreen('screenLoserWait'); },
    noop,
    // runCountdown: 사용자가 실제로 본 카운트다운 1회를 계측한다.
    async (myGen) => {
      calls.countdownRenders.push({ gen: myGen, round: state.round });
      els.countdownOverlay.classList.remove('hidden');
      els.countdownOverlay.classList.add('hidden');
      return true;
    },
    noop, noop, noop, noop, noop, noop, noop
  );

  // handleRoomUpdate 본체의 status 디스패치는 이 파일에서 모델링한다(그 분기 전체는 수백 줄이라
  // 통째 추출이 비현실적이다). 대신 아래 소스 계약 테스트가 실제 코드가 이 모양인지 고정한다.
  const deliverRow = async (room) => {
    // stale로 차단된 호출은 REAL 코드가 bare `return;` 하므로 undefined가 온다 — 그대로 스킵.
    const r = await mod.handleRoomUpdateProlog(room);
    if (!r || r.skipped) return r;
    const before = { entry: state.playingEntryKey, rendered: state.countdownRenderedKey };
    if (before.entry === null && before.rendered === null) calls.ledgerWipes.push(room.status);
    if (r.oldStatus !== r.newStatus && state.status === 'playing') {
      await mod.enterPlayingStateFromRoomUpdate();
    }
    return r;
  };

  return { mod, state, calls, els, deliverRow, penalty };
}

describe('P0-1 [RED 재현] stale reset-family row가 카운트다운 원장을 지운다', () => {
  it('소스 계약: handleRoomUpdate는 status 전이 시 playing이면 enterPlayingStateFromRoomUpdate를 호출한다', () => {
    // deliverRow의 모델이 실제 코드와 어긋나면 이 재현 전체가 무의미해지므로 소스로 고정한다.
    expect(html).toContain('} else if (state.status === "playing") {\n          await enterPlayingStateFromRoomUpdate();');
    expect(html).toContain('const oldStatus = state.status;');
    expect(html).toContain('state.status = room.status;');
  });

  it('전제: stale 게이트는 reset-family status를 통과시킨다 (설계상 의도된 pass-through)', () => {
    expect(HRU_PROLOG_SRC).toContain('const ACTIVE_ROUND_PHASE_ORDER = { ready: 0, playing: 1, result: 2, game_over: 3, stats: 4 };');
    expect(HRU_PROLOG_SRC).toContain('isActiveRoundPhaseStatus(room.status)');
    // reset 계열은 이 목록에 없다 → 두 stale 축 모두 적용되지 않는다.
    for (const s of ['waiting', 'lobby', 'reinviting', 'penalty_setting']) {
      expect(HRU_PROLOG_SRC.includes(`${s}: `)).toBe(false);
    }
  });

  it('전제: 원장 소거는 playing을 벗어날 때 일어나되, 뒤처진 reset row는 예외다', () => {
    expect(HRU_PROLOG_SRC).toContain('if (state.status !== "playing" && !room.__behindRoundReset) {');
    expect(HRU_PROLOG_SRC).toContain('state.playingEntryKey = null;');
    expect(HRU_PROLOG_SRC).toContain('state.countdownRenderedKey = null;');
    // 판정은 "같은 게임 + 뒤처진 round + 진행 5단계 밖"일 때만 참이다.
    expect(HRU_PROLOG_SRC).toContain('room.__behindRoundReset = incomingGameRound > 0 && incomingRound > 0 &&');
    expect(HRU_PROLOG_SRC).toContain('!isActiveRoundPhaseStatus(room.status);');
  });

  it('기준선: reset row 없이 같은 playing row가 5회 반복 배달되면 카운트다운은 1회다', async () => {
    const { calls, deliverRow, penalty, state } = buildCountdownEnv({ round: 3 });
    const playingRow = { id: 'ROOM1', status: 'playing', round: 3, penalty: penalty(1) };
    state.status = 'ready'; // 라운드 진행의 실제 직전 phase (ready → playing)
    for (let i = 0; i < 5; i++) await deliverRow(playingRow);
    expect(calls.countdownRenders.length).toBe(1);
  });

  // ★ 핵심 RED — polling 경로
  it.each(['waiting', 'lobby', 'reinviting', 'penalty_setting'])(
    '[RED] playing(round3) → stale %s row → 같은 playing row: 카운트다운이 1회여야 하는데 2회 실행된다',
    async (resetStatus) => {
      const { calls, deliverRow, penalty, state } = buildCountdownEnv({ round: 3 });
      const playingRow = { id: 'ROOM1', status: 'playing', round: 3, penalty: penalty(1) };

      state.status = 'ready';
      await deliverRow(playingRow);                 // 정상 진입 — 카운트다운 1회
      expect(calls.countdownRenders.length).toBe(1);

      // 늦게 도착한 stale reset-family row (같은 게임, 과거 round)
      await deliverRow({ id: 'ROOM1', status: resetStatus, round: 1, penalty: penalty(1) });
      // 중간 관측점: 뒤처진 round를 든 reset row는 원장을 지우면 안 된다(이게 결함의 핵심 지점).
      expect(state.countdownRenderedKey, `${resetStatus} row가 원장을 지웠다`).not.toBe(null);
      expect(state.playingEntryKey, `${resetStatus} row가 진입키를 지웠다`).not.toBe(null);

      // 폴링이 같은 playing row를 다시 배달
      await deliverRow(playingRow);

      // 사용자가 본 카운트다운은 1회여야 한다.
      expect(calls.countdownRenders.length,
        `${resetStatus} 삽입 후 카운트다운 렌더 횟수`).toBe(1);
    }
  );

  it('[RED] realtime 경로(전이 이벤트만 배달)에서도 동일하게 재현된다', async () => {
    const { calls, deliverRow, penalty, state } = buildCountdownEnv({ round: 3 });
    state.status = 'ready';
    await deliverRow({ id: 'ROOM1', status: 'playing', round: 3, penalty: penalty(1) });
    expect(calls.countdownRenders.length).toBe(1);
    // realtime은 같은 row를 반복하지 않고 "전이"만 보낸다 — reset 전이 후 새 playing 전이.
    await deliverRow({ id: 'ROOM1', status: 'lobby', round: 1, penalty: penalty(1) });
    await deliverRow({ id: 'ROOM1', status: 'playing', round: 3, penalty: penalty(1) });
    expect(calls.countdownRenders.length, 'realtime 전이 경로').toBe(1);
  });

  it('[mutation, 반공허성] 수정(!isBehindRoundResetRow)을 되돌리면 결함이 그대로 재현된다', async () => {
    const { calls, deliverRow, penalty, state } = buildCountdownEnv({ round: 3, mutateRevertFix: true });
    const playingRow = { id: 'ROOM1', status: 'playing', round: 3, penalty: penalty(1) };
    state.status = 'ready';
    await deliverRow(playingRow);
    expect(calls.countdownRenders.length).toBe(1);
    await deliverRow({ id: 'ROOM1', status: 'waiting', round: 1, penalty: penalty(1) });
    expect(state.countdownRenderedKey, '수정 제거 시 원장이 지워진다').toBe(null);
    await deliverRow(playingRow);
    expect(calls.countdownRenders.length, '수정 제거 시 카운트다운 2회').toBe(2);
  });

  it('경로 구분: reset row가 진행 5단계(result)였다면 stale 게이트가 막아 재현되지 않는다 (대조군)', async () => {
    const { calls, deliverRow, penalty, state } = buildCountdownEnv({ round: 3 });
    state.status = 'ready';
    await deliverRow({ id: 'ROOM1', status: 'playing', round: 3, penalty: penalty(1) });
    // round 1짜리 result row — 진행 5단계라 round-축 stale 게이트에 걸린다.
    await deliverRow({ id: 'ROOM1', status: 'result', round: 1, penalty: penalty(1) });
    expect(calls.staleSkipped, 'result row는 stale로 차단되어야 한다').toBeGreaterThan(0);
    expect(state.countdownRenderedKey, '원장이 보존된다').not.toBe(null);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// P0-2 — 게임 진행 중 host가 실제 나가기를 실행하면 남은 참가자의 게임/방이 멈춘다
//
// 실기기 정정(사용자): 앱 강제종료/네트워크 소실이 아니라 **명시적 나가기 동작**이다.
// 실제 UI 경로: playing + 비host 1명 이상 → leaveRoom()이 showNextHostPopup()으로 분기 →
//   (a) 후보 선택  → transferHostAndLeave(newHostId)
//   (b) 그냥 나가기 → leaveRoomForce()
// 두 경로 모두 Build34에서 "떠나는 host가 방을 리셋하지 않도록" 고쳐졌다(preserveRoomForSuccessor /
// HOST_TRANSFER_PRESERVED_GAME). 그런데 실기기는 여전히 RED다.
//
// 가설: 리셋이 일어나는 곳은 **떠나는 host가 아니라 승계받은 client**다.
// fetchParticipants()는 같은 블록 안에서 순서대로
//   ① me.is_host && state.role !== "host" → state.role = "host"   (권한 인식)
//   ② if (state.role === "host" && shouldResetForParticipantChange(...) && !isPureWaitingJoinDelta(...))
//        → beginNewGameRound({ status: "lobby", increment: true })
// 를 실행한다. host 이탈 delta는 서명이 바뀌고 활동이 있으므로 ①이 방금 세운 role 때문에
// ②가 **첫 fetch에서 바로** 발화한다 → 진행 중이던 라운드가 lobby로 리셋되고 게임 번호가 오른다.
// 이 블록에는 status 가드가 없다(playing/result에서도 리셋한다).
// ────────────────────────────────────────────────────────────────────────────

const PARTICIPANT_DELTA_SRC = extractBlock(
  'function getParticipantSignature(participants = state.participants) {',
  'function getNewGameRoundParticipantPatch(extra = {}) {'
);
const FETCH_ROLE_BLOCK_SRC = extractBlock(
  '// 호스트 역할 전환 감지 (transferHostAndLeave / becomeNextHost)',
  '// 입장/퇴장 사운드: 참가자 ID diff'
);
// 수정이 사용하는 REAL 술어 — 진행 중 판정. 하드코딩하지 않고 소스에서 그대로 가져온다.
const ROUND_IN_PROGRESS_SRC = extractBlock(
  'function isRoundInProgressForLeave() {',
  '// WRPS-083 2A: ready 잠금 계산에서'
);

function buildSuccessorEnv({ mutateRevertFix = false } = {}) {
  const calls = { beginNewGameRound: [], destroyRoom: 0 };
  const OLD_HOST = 'h1', ME = 'p2', OTHER = 'p3';

  // 승계자(p2) 단말의 상태 — 라운드 3 playing 진행 중.
  const state = {
    currentUserId: ME,
    role: 'participant',
    status: 'playing',
    roomCode: 'ROOM1',
    round: 3,
    gameRound: 1,
    penalty: JSON.stringify({ text: '', loserCount: 1, gameRound: 1 }),
    targetLoserCount: 1,
    confirmedSafeIds: [],
    confirmedLoserIds: [],
    newRoundResetting: false,
    myReadyLocallySetAt: 0,
    participants: [
      { id: OLD_HOST, name: 'host', is_host: true, choice: null, is_ready: true },
      { id: ME, name: 'p2', is_host: false, choice: 'rock', is_ready: true },
      { id: OTHER, name: 'p3', is_host: false, choice: null, is_ready: true },
    ],
  };

  const factory = new Function(
    'state', 'QA', 'beginNewGameRound', 'renderAll', 'destroyRoomAndGoHome',
    'cleanupDuplicateRoomProfiles', 'fetchParticipants', 'playSound', 't', 'getGameRound',
    PARTICIPANT_DELTA_SRC + '\n' +
    ROUND_IN_PROGRESS_SRC + '\n' +
    // fetchParticipants의 역할전환+리셋 블록을 REAL 그대로 감싼다.
    'async function applyParticipantSnapshot(roomCode, data) {\n' +
    '  if (!state.roomCode || roomCode !== state.roomCode) return;\n' +
    (mutateRevertFix ? FETCH_ROLE_BLOCK_SRC.replace('skipResetForHostSuccession = justBecameHostThisSnapshot &&', 'skipResetForHostSuccession = false && justBecameHostThisSnapshot &&') : FETCH_ROLE_BLOCK_SRC) + '\n' +
    '  state.participants = data;\n' +
    '}\n' +
    'return { applyParticipantSnapshot, shouldResetForParticipantChange, isPureWaitingJoinDelta, hasCurrentGameRoundActivity, isRoundInProgressForLeave };'
  );

  const mod = factory(
    state,
    { emit: noop },
    async (opts) => { calls.beginNewGameRound.push(opts); state.status = opts.status; state.round = 1; },
    noop,
    async () => { calls.destroyRoom++; },
    async () => {}, async () => {}, noop, (k) => k, () => state.gameRound
  );

  return { mod, state, calls, OLD_HOST, ME, OTHER };
}

describe('P0-2 [RED 재현] 승계받은 client가 진행 중이던 게임을 lobby로 리셋한다', () => {
  it('소스 계약: leaveRoom은 playing + 비host 1명 이상이면 showNextHostPopup으로 분기한다', () => {
    const leave = extractBlock('async function leaveRoom() {', 'async function leaveRoomForce() {');
    expect(leave).toContain('if (!isRoundInProgressForLeave()) {');
    expect(leave).toContain('showHostLeavePopup();');
    expect(leave).toContain('const nonHosts = state.participants.filter(p => !p.is_host);');
    expect(leave).toContain('showNextHostPopup();');
  });

  it('전제: 떠나는 host 쪽은 Build34에서 이미 게임을 보존한다 (여기는 원인이 아니다)', () => {
    const transfer = extractBlock('async function transferHostAndLeave(newHostId) {', 'async function becomeNextHost() {');
    expect(transfer).toContain('if (!(isRoundInProgressForLeave() || state.status === "ready")) {');
    expect(transfer).toContain('HOST_TRANSFER_PRESERVED_GAME');
    const doLeave = extractBlock('async function _doLeaveRoom() {', 'async function destroyRoomAndGoHome(');
    expect(doLeave).toContain('const preserveRoomForSuccessor = Boolean(successorHostId) && gameInProgress;');
  });

  it('전제: host 이탈 delta는 reset 판정에 걸리고 WAITING 예외에도 해당하지 않는다', () => {
    const { mod, state, OLD_HOST, ME, OTHER } = buildSuccessorEnv();
    const before = state.participants;
    const after = [
      { id: ME, name: 'p2', is_host: true, choice: 'rock', is_ready: true },
      { id: OTHER, name: 'p3', is_host: false, choice: null, is_ready: true },
    ];
    expect(mod.hasCurrentGameRoundActivity(before)).toBe(true);
    expect(mod.shouldResetForParticipantChange(before, after)).toBe(true);
    expect(mod.isPureWaitingJoinDelta(before, after)).toBe(false);
    expect(OLD_HOST).toBe('h1');
  });

  // ★ 핵심 RED
  it('[RED] host 이전 직후 첫 스냅샷에서 승계자가 게임을 리셋하지 않아야 한다', async () => {
    const { mod, state, calls, ME, OTHER } = buildSuccessorEnv();
    // DB 상태: 떠난 host row 삭제 + p2가 is_host=true (transferHostAndLeave/leaveRoomForce 결과)
    const afterTransfer = [
      { id: ME, name: 'p2', is_host: true, choice: 'rock', is_ready: true },
      { id: OTHER, name: 'p3', is_host: false, choice: null, is_ready: true },
    ];

    await mod.applyParticipantSnapshot('ROOM1', afterTransfer);

    // 기대조건(사용자 지정)
    expect(state.role, '승계자가 host 권한을 인식한다').toBe('host');
    expect(afterTransfer.filter(p => p.is_host).length, 'host는 정확히 1명').toBe(1);
    expect(calls.destroyRoom, '방은 유지된다').toBe(0);
    expect(calls.beginNewGameRound, '진행 중이던 게임을 리셋하면 안 된다').toEqual([]);
    expect(state.status, 'status 되감기 없음').toBe('playing');
    expect(state.round, 'round 되감기 없음').toBe(3);
  });

  it('[RED] 리셋은 status와 무관하게 발화한다 — result 진행 중에도 동일하다', async () => {
    const { mod, state, calls, ME, OTHER } = buildSuccessorEnv();
    state.status = 'result';
    await mod.applyParticipantSnapshot('ROOM1', [
      { id: ME, name: 'p2', is_host: true, choice: 'rock', is_ready: true },
      { id: OTHER, name: 'p3', is_host: false, choice: null, is_ready: true },
    ]);
    expect(calls.beginNewGameRound, 'result 중에도 리셋하면 안 된다').toEqual([]);
  });

  it('[mutation, 반공허성] 수정(!skipResetForHostSuccession)을 되돌리면 결함이 그대로 재현된다', async () => {
    const { mod, state, calls, ME, OTHER } = buildSuccessorEnv({ mutateRevertFix: true });
    await mod.applyParticipantSnapshot('ROOM1', [
      { id: ME, name: 'p2', is_host: true, choice: 'rock', is_ready: true },
      { id: OTHER, name: 'p3', is_host: false, choice: null, is_ready: true },
    ]);
    expect(calls.beginNewGameRound.length, '수정 제거 시 승계자가 리셋한다').toBe(1);
    expect(calls.beginNewGameRound[0].status).toBe('lobby');
    expect(state.status, '수정 제거 시 playing이 lobby로 되감긴다').toBe('lobby');
  });

  it('대조군: 승계가 없는 단순 참가자 이탈은 종전대로 리셋한다 (이 동작은 유지되어야 한다)', async () => {
    const { mod, state, calls, OLD_HOST, ME } = buildSuccessorEnv();
    state.currentUserId = OLD_HOST;
    state.role = 'host';
    state.participants = [
      { id: OLD_HOST, name: 'host', is_host: true, choice: null, is_ready: true },
      { id: ME, name: 'p2', is_host: false, choice: 'rock', is_ready: true },
      { id: 'p3', name: 'p3', is_host: false, choice: null, is_ready: true },
    ];
    await mod.applyParticipantSnapshot('ROOM1', [
      { id: OLD_HOST, name: 'host', is_host: true, choice: null, is_ready: true },
      { id: ME, name: 'p2', is_host: false, choice: 'rock', is_ready: true },
    ]);
    expect(calls.beginNewGameRound.length, '호스트 유임 + 참가자 이탈은 기존 정책대로').toBe(1);
  });
});
