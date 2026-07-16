import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { computePlayerStatuses, PLAYER_STATUS } from '../src/game-logic.mjs';

// Build27 — 두 가지 수정 + codex-critic HIGH 2건(H1/H2) 검증.
//
// [Task 1 / H1 / M1] handleRoomUpdate()의 round===1 무조건 리셋이 realtime 중복 에코에서
// confirmedSafeIds/LoserIds를 wipe하는 버그(필드 재현: room 1307/session 8ofwlcin/build26).
// 1차 수정(`room.status !== 'game_over'`)은 game_over 에코만 막았지만, 같은 duplicate-echo
// 메커니즘이 status:'result'에도 열려 있었다 — 라운드1 tooMany/tooFew 결과 후 nextRound()가
// scheduleRematchAutoAdvance()로 ~2.6초 지연 호출되는 창 안에 'result' 중복 에코가 도착하면
// confirmedLoserIds/SafeIds가 wipe되고 nextRound()가 그 빈 값을 읽어 아무도 safe/loser로
// 마킹하지 않은 채 다음 라운드를 써버린다(game_over보다 나쁜 조용한 판정 결과 손실).
// H1 수정: status를 하나씩 예외처리하는 대신 gameNo 기반 1회성 idempotency로 일반화 —
// `room.round === 1 && state.confirmedIdsResetGameNo !== state.gameRound`. gameRound는 새
// 게임마다 반드시 증가하므로, 같은 게임 안에서 round가 1로 유지되는 동안 이 리셋은 어떤 status
// 조합의 반복 호출에도 정확히 1회만 실행된다.
// M1(codex-critic 2차 검증): gameRound는 "방(room) 수명 안에서만" 단조증가한다 — 한 세션에서
// 방 A를 나가고 방 B에 들어가면 둘 다 gameRound===1에서 첫 게임이 끝나는 우연이 흔하다. 이때
// confirmedIdsResetGameNo를 gameRound 단독으로 비교하면 방 B의 진짜 새 게임 리셋이 "이미 했음"
// 으로 오판되어 스킵될 수 있었다(resetRoomLocalState/discardInProgressRoomSession/createRoom
// 중 어느 것도 이 필드를 gameRound의 형제 필드처럼 명시적으로 초기화하지 않았음). 최종 수정:
// 가드 키를 `${state.roomCode}:${state.gameRound}`로 합성해, room이 바뀌면 gameRound가 우연히
// 같아도 항상 다른 키가 되도록 구조적으로 고쳤다 — 세 리셋 함수 각각에 이 필드를 추가하는
// 대신, roomCode 자체가 room 전환마다 항상 달라진다는 사실에 기대는 자기교정적 해법이다.
//
// [Task 2 / H2] 호스트 전용 부분 재경기 강제 시작(WRPS-074, .force-start-replay-btn).
// state.round > 1 && status==='ready' && 활성 참가자 일부 미준비일 때만 호스트에게 노출
// (screenReady/screenWinnerWait/screenLoserWait 세 화면). WRPS-042(라운드1 호스트 시작 버튼 폐지)는
// 완전히 무변경 — round<=1에서는 어떤 조건에서도 노출/동작 금지.
// H2: screenHostRoom의 기존 startGameBtn(status==='ready'일 때 startGame()에 직접 바인딩)이
// forceStartReplay()/triggerReplayIfLastReady()와 startGame()을 공유하면서도 autoStartInFlight
// 뮤텍스에 참여하지 않아, host가 editPenaltyBtn을 거쳐 round>1 재경기 대기 중에도 이 화면에
// 도달할 수 있는 경로(savePenalty()가 round를 구분하지 않음)에서 이중 시작 레이스가 가능했다.
// 수정: 새 래퍼 startGameFromHostRoom()이 다른 가드된 경로와 동일한 뮤텍스 규율로 startGame()을
// 감싸고, startGameBtn.onclick이 이 래퍼로 재배선됐다 — startGame() 자체의 내부 타이밍(realtime
// 'playing' 감지를 위한 gameStarting 조기 리셋)은 무변경.
//
// 테스트 스타일: tests/build23-play-again-guard.test.mjs / build24-sync-snapshot-stability.test.mjs와
// 동일한 "실제 소스 추출 + new Function() 실행" 패턴(hand-copy 로직 검증 금지).

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
// handleRoomUpdate() 상단: round===1 리셋 블록 + round/status 할당(oldStatus 캡처 포함).
const ROOM_UPDATE_HEAD_SRC = extractBlock(
  "const confirmedIdsResetKey = `${state.roomCode || ''}:${state.gameRound}`;",
  'if (oldStatus !== state.status) {'
);
// choice 인코딩 순수 함수(isNonPlayingChoice 등, 외부 의존 없음) — build24 테스트와 동일 마커.
const CHOICE_HELPERS_BLOCK = extractBlock(
  'function isNonPlayingChoice(choice) {',
  'function getParticipantSignature('
);
// Build23 guard family(getActivePlayers/areAllActivePlayersReady/isTaggerSelectionComplete/…) —
// build23 테스트와 동일 마커. Build27에서 이 블록 자체는 무변경이어야 한다.
const GUARD_BLOCK = extractBlock(
  'function getActivePlayers() {',
  'function isJoinLocked('
);
// Build27 신규: 강제 시작 컨트롤 3종(canShow/update/forceStartReplay).
const FORCE_START_BLOCK = extractBlock(
  'function canShowForceStartReplayButton() {',
  'async function goToReadyScreen('
);
// 실제 startGame() — is_ready를 전혀 보지 않고 rooms.status='playing'으로 전이하는지 실행 검증용.
const START_GAME_SRC = extractBlock(
  'async function startGame(options = {}) {',
  'async function waitForValidCountdownStart('
);
// 자동 시작 트리거(무변경 회귀 확인용).
const TRIGGER_REPLAY_SRC = extractBlock(
  'async function triggerReplayIfLastReady() {',
  'async function markReady() {'
);
// WRPS-042 회귀 확인용: showReadyScreen의 hostStartBtn 무조건 숨김.
const SHOW_READY_SRC = extractBlock(
  'function showReadyScreen() {',
  'function renderReadyList() {'
);
// H2 신규: screenHostRoom의 startGameBtn을 startGame()과 동일한 autoStartInFlight 뮤텍스로 감싸는 래퍼.
const START_GAME_FROM_HOST_ROOM_SRC = extractBlock(
  'async function startGameFromHostRoom() {',
  'function showHostRoom() {'
);

// ── mock 헬퍼 ───────────────────────────────────────────────────────
function mockEl(initialClasses = ['hidden']) {
  const classes = new Set(initialClasses);
  return {
    classList: {
      add: (c) => classes.add(c),
      remove: (c) => classes.delete(c),
      contains: (c) => classes.has(c),
      toggle: (c, force) => {
        const want = force === undefined ? !classes.has(c) : Boolean(force);
        want ? classes.add(c) : classes.delete(c);
        return want;
      },
    },
    disabled: false,
    style: {},
    textContent: '',
    get hidden() { return classes.has('hidden'); },
  };
}

// handleRoomUpdate() 상단(리셋 블록~status 할당)을 실제 소스로 실행.
function runRoomUpdateHead(room, state) {
  const factory = new Function(
    'room', 'state', 'getTargetLoserCount', 'getGameRound',
    CHOICE_HELPERS_BLOCK + '\n(() => {\n' + ROOM_UPDATE_HEAD_SRC + '\nstate.status = room.status;\n})();'
  );
  factory(room, state, () => state.targetLoserCount || 1, () => state.gameRound || 1);
}

// Build23 guard family를 실제 소스로 로드(build23 테스트와 동일 방식, 의존성만 주입).
function loadGuard(state) {
  const emitted = [];
  const QA = { emit: (channel, data) => emitted.push(data) };
  const factory = new Function(
    'state', 'QA', 'computePlayerStatuses', 'PLAYER_STATUS', 'getTargetLoserCount', 'getGameRound',
    CHOICE_HELPERS_BLOCK + '\n' + GUARD_BLOCK +
      '\n; return { getActivePlayers, areAllActivePlayersReady, isTaggerSelectionComplete, canShowPlayAgainButton, blockPlayAgainIfPartialReplay };'
  );
  const guard = factory(state, QA, computePlayerStatuses, PLAYER_STATUS,
    () => state.targetLoserCount || 1, () => state.gameRound || 1);
  return { guard, emitted };
}

// Build27 강제 시작 컨트롤을 실제 소스로 로드. startGame은 주입(스파이 또는 실제 추출본).
function loadForceStart(state, { startGame } = {}) {
  const { guard } = loadGuard(state);
  const buttons = [mockEl(), mockEl(), mockEl()]; // screenReady/screenWinnerWait/screenLoserWait
  const documentMock = {
    querySelectorAll: (sel) => (sel === '.force-start-replay-btn' ? buttons : []),
  };
  const emitted = [];
  const QA = { emit: (channel, data) => emitted.push(data) };
  const startGameImpl = startGame || (async () => {});
  const factory = new Function(
    'state', 'QA', 'document', 'getActivePlayers', 'areAllActivePlayersReady', 'getGameRound', 'startGame',
    FORCE_START_BLOCK + '\n; return { canShowForceStartReplayButton, updateForceStartReplayButtons, forceStartReplay };'
  );
  const api = factory(state, QA, documentMock, guard.getActivePlayers, guard.areAllActivePlayersReady,
    () => state.gameRound || 1, startGameImpl);
  return { api, buttons, emitted, guard };
}

// 실제 startGame()을 mock db로 로드 — rooms/participants에 실제로 어떤 write가 나가는지 기록.
function loadRealStartGame(state) {
  const dbCalls = [];
  const db = {
    from: (table) => ({
      update: (payload) => ({
        eq: (col, val) => { dbCalls.push({ table, payload, col, val }); return Promise.resolve({ data: null, error: null }); },
        in: (col, vals) => { dbCalls.push({ table, payload, col, vals }); return Promise.resolve({ data: null, error: null }); },
      }),
    }),
  };
  let enteredPlaying = 0;
  const factory = new Function(
    'state', 'db', '$', 'setBtnText', 't', 'getOnlineMode', 'getNextCountdownStartAt', 'buildPenaltyValue',
    'getGameRound', 'enterPlayingStateFromRoomUpdate', 'showToast', 'runCountdownThenShowGame', 'saveState',
    'isCurrentRoundParticipant',
    START_GAME_SRC + '\n; return startGame;'
  );
  const startGame = factory(
    state, db, () => mockEl(), () => {}, (k) => k, () => true, () => Date.now() + 3000,
    (o) => JSON.stringify(o), () => state.gameRound || 1,
    async () => { enteredPlaying++; }, () => {}, async () => {}, () => {}, () => true
  );
  return { startGame, dbCalls, getEnteredPlaying: () => enteredPlaying };
}

// H2: 실제 startGameFromHostRoom() 래퍼 로드. startGame은 주입(스파이 또는 실제 추출본).
function loadStartGameFromHostRoom(state, { startGame } = {}) {
  const factory = new Function(
    'state', 'startGame',
    START_GAME_FROM_HOST_ROOM_SRC + '\n; return startGameFromHostRoom;'
  );
  return factory(state, startGame || (async () => {}));
}

// ── 공용 픽스처 ─────────────────────────────────────────────────────
// 3인, target=1: p1 술래 확정, p2/p3 안전 확정(gameOver 완료 상태).
function gameOverState() {
  return {
    role: 'host', status: 'result', round: 1, gameRound: 1, targetLoserCount: 1,
    roomCode: 'R1', renderedPhaseKeys: {}, renderedPhaseKeysGameNo: 1,
    // Build27(H1/M1): 실제 흐름에서는 finishRoundLocal()이 확정 배열을 쓰기 훨씬 전, 이 방(R1)의
    // 이 게임(gameRound=1) round===1 최초 진입(waiting/lobby/playing 등)에서 이미 리셋이 1회
    // 일어난 뒤다 — confirmedIdsResetGameNo를 room-scoped 키(`roomCode:gameRound`)로 미리 채워
    // 픽스처가 "게임 진행 중" 시점을 정확히 대표하게 한다.
    confirmedIdsResetGameNo: 'R1:1',
    confirmedLoserIds: ['p1'], confirmedSafeIds: ['p2', 'p3'],
    participants: [
      { id: 'p1', is_host: true, choice: 'rock|lose', is_ready: false },
      { id: 'p2', is_host: false, choice: 'paper|win', is_ready: false },
      { id: 'p3', is_host: false, choice: 'paper|win', is_ready: false },
    ],
  };
}

// 부분 재경기 대기(round 2, status ready): p1 술래 확정(마커), p2/p3 활성.
function partialReplayReadyState({ round = 2, status = 'ready', role = 'host', p2Ready = true, p3Ready = false } = {}) {
  return {
    role, status, round, gameRound: 1, targetLoserCount: 2,
    roomCode: 'R1', gameStarting: false, autoStartInFlight: false,
    confirmedLoserIds: ['p1'], confirmedSafeIds: [],
    participants: [
      { id: 'p1', is_host: true, choice: '__loser__', is_ready: true },
      { id: 'p2', is_host: false, choice: null, is_ready: p2Ready },
      { id: 'p3', is_host: false, choice: null, is_ready: p3Ready },
    ],
  };
}

// ════════════════════════════════════════════════════════════════════
describe('Build27 Task1/H1 — round===1 리셋이 game_over/result 확정 데이터를 wipe하지 않는다', () => {
  it("room.status==='game_over'면 confirmedSafeIds/LoserIds가 보존된다(실제 handleRoomUpdate 상단 소스 실행)", () => {
    const state = gameOverState();
    runRoomUpdateHead({ round: 1, status: 'game_over' }, state);
    expect(state.confirmedLoserIds).toEqual(['p1']);
    expect(state.confirmedSafeIds).toEqual(['p2', 'p3']);
    expect(state.round).toBe(1);
    expect(state.status).toBe('game_over');
  });

  it("H1 — status가 'result'로 유지된 중복 에코에서도 wipe되지 않는다(game_over만 예외처리하던 1차 수정의 사각지대)", () => {
    const state = gameOverState();
    state.status = 'result'; // game_over로 전이하지 않고 result에 머문 채 중복 에코가 온 경우
    runRoomUpdateHead({ round: 1, status: 'result' }, state);
    expect(state.confirmedLoserIds).toEqual(['p1']);
    expect(state.confirmedSafeIds).toEqual(['p2', 'p3']);
  });

  it("H1 필드 재현 — 라운드1 tooFew(target=2, 1명만 패배) 결과 후 scheduleRematchAutoAdvance 대기창에서 도착한 'result' 중복 에코가 confirmedLoserIds를 wipe하지 않는다(수정 전에는 nextRound()가 아무도 술래로 못 쓰는 조용한 데이터 손상으로 이어졌음)", () => {
    const state = {
      role: 'host', status: 'result', round: 1, gameRound: 7, targetLoserCount: 2,
      roomCode: 'R2', renderedPhaseKeys: {}, renderedPhaseKeysGameNo: 7,
      confirmedIdsResetGameNo: 'R2:7', // 이 게임(gameRound=7)의 round===1 baseline은 이전 phase에서 이미 기록됨
      confirmedLoserIds: ['p1'], confirmedSafeIds: [], // finishRoundLocal()의 tooFew 분기 결과(승자 재대결 예약)
      participants: [
        { id: 'p1', is_host: false, choice: 'rock|lose', is_ready: false },
        { id: 'p2', is_host: true, choice: 'paper|win', is_ready: false },
        { id: 'p3', is_host: false, choice: 'paper|win', is_ready: false },
      ],
    };
    // host 자신의 publishHostRoundResult/updateRoomStatusScheduled 쓰기가 되돌아온 'result' 중복 에코
    // (round는 여전히 1, status도 그대로 'result' — nextRound()는 아직 실행 전).
    runRoomUpdateHead({ round: 1, status: 'result' }, state);
    expect(state.confirmedLoserIds).toEqual(['p1']); // wipe되지 않음 — nextRound()가 정확히 읽을 수 있다
    expect(state.confirmedSafeIds).toEqual([]);
    const { guard } = loadGuard(state);
    expect(guard.getActivePlayers().map((p) => p.id).sort()).toEqual(['p2', 'p3']); // p1은 여전히 확정 제외
  });

  it("진짜 새 게임(gameRound 증가 + round=1 + waiting/lobby/ready/playing)에서는 여전히 리셋된다(다른 status 동작 무변경)", () => {
    for (const status of ['waiting', 'lobby', 'ready', 'playing']) {
      const state = gameOverState(); // 직전 게임(gameRound=1) 종료 상태(baseline 기록됨)
      state.gameRound = 2; // 새 게임 진입(게임 번호는 beginNewGameRound 등에서 반드시 증가)
      state.participants[0].choice = '__loser__'; // 잔존 마커도 함께 정리되는지 확인
      runRoomUpdateHead({ round: 1, status }, state);
      expect(state.confirmedLoserIds, `status=${status}`).toEqual([]);
      expect(state.confirmedSafeIds, `status=${status}`).toEqual([]);
      expect(state.participants[0].choice, `status=${status}`).toBe(null); // __loser__ 마커 제거
      expect(state.confirmedIdsResetGameNo, `status=${status}`).toBe('R1:2'); // 같은 방의 새 게임 번호로 갱신됨
    }
  });

  it("M1(codex-critic 2차 검증) — 두 개의 서로 다른 방이 같은 세션에서 둘 다 gameRound===1로 게임을 끝내도 서로의 리셋을 오판하지 않는다", () => {
    // 시나리오: 방 A에서 게임이 gameRound=1에 끝남(confirmedIdsResetGameNo='ROOMA:1' 기록) → 방을
    // 나가고 방 B에 입장(createRoom/joinRoom 계열이 gameRound를 다시 1부터 시작 — 실제로 흔한 우연).
    // gameRound 단독 비교였다면 방 B의 진짜 새 게임 리셋이 "이미 했음(1)"으로 오판되어 스킵됐을 것.
    const stateA = {
      role: 'host', status: 'game_over', round: 1, gameRound: 1, targetLoserCount: 1,
      roomCode: 'ROOMA', renderedPhaseKeys: {}, renderedPhaseKeysGameNo: 1,
      confirmedIdsResetGameNo: 'ROOMA:1',
      confirmedLoserIds: ['pa1'], confirmedSafeIds: ['pa2'],
      participants: [
        { id: 'pa1', is_host: true, choice: 'rock|lose', is_ready: false },
        { id: 'pa2', is_host: false, choice: 'paper|win', is_ready: false },
      ],
    };
    // 방 A를 나간 뒤 방 B에 입장 — roomCode만 바뀌고(resetRoomLocalState/createRoom과 동일하게
    // confirmedSafeIds/LoserIds/gameRound/round는 이미 새로 초기화됐다고 가정), 낡은
    // confirmedIdsResetGameNo('ROOMA:1')는 실제 코드에서도 명시적으로 지워지지 않은 채 남는다
    // (M1이 지적한 정확한 상황 — 세 리셋 함수 중 어느 것도 이 필드를 초기화하지 않음).
    const stateB = {
      role: 'host', status: 'waiting', round: 1, gameRound: 1, targetLoserCount: 1,
      roomCode: 'ROOMB', renderedPhaseKeys: {}, renderedPhaseKeysGameNo: 1,
      confirmedIdsResetGameNo: stateA.confirmedIdsResetGameNo, // 낡은 값이 세션에 남아있다고 가정
      confirmedLoserIds: [], confirmedSafeIds: [],
      participants: [
        { id: 'pb1', is_host: true, choice: '__loser__', is_ready: false }, // 방 A의 잔존 마커라고 가정
        { id: 'pb2', is_host: false, choice: null, is_ready: false },
      ],
    };
    runRoomUpdateHead({ round: 1, status: 'waiting' }, stateB);
    // room-scoped 키('ROOMB:1' !== 'ROOMA:1')라서 리셋이 정상적으로 실행되어야 한다.
    expect(stateB.confirmedIdsResetGameNo).toBe('ROOMB:1');
    expect(stateB.confirmedLoserIds).toEqual([]);
    expect(stateB.confirmedSafeIds).toEqual([]);
    expect(stateB.participants[0].choice).toBe(null); // 잔존 __loser__ 마커도 정리됨
    // 방 A 쪽 상태는 이 호출과 무관하게 그대로(서로 다른 state 객체, 교차 오염 없음).
    expect(stateA.confirmedIdsResetGameNo).toBe('ROOMA:1');
    expect(stateA.confirmedLoserIds).toEqual(['pa1']);
  });

  it('필드 재현 시퀀스: finishRoundLocal 확정 → game_over 에코(duplicate, 재동기화 없음) → isTaggerSelectionComplete()가 여전히 true', () => {
    // 1) finishRoundLocal()이 확정 배열을 쓴 직후 상태(room 1307 시퀀스의 1단계).
    const state = gameOverState();
    const { guard: before } = loadGuard(state);
    expect(before.isTaggerSelectionComplete()).toBe(true); // 확정 직후: 완료(한번더 노출 가능)

    // 2) 같은 호스트로 되돌아온 realtime 에코: round는 여전히 1, status만 'game_over'.
    //    (실제 버그에서는 이 호출이 배열을 []로 wipe했고, waitForPhaseRender duplicate로
    //     finishRoundLocal 재실행이 없어 wipe가 영구화됐다 — 여기서는 재동기화를 일부러 안 한다.)
    runRoomUpdateHead({ round: 1, status: 'game_over' }, state);

    // 3) 수정 후: 배열이 보존되어 술래 선정 완료가 유지된다.
    const { guard: after, emitted } = loadGuard(state);
    expect(state.confirmedLoserIds).toEqual(['p1']);
    expect(state.confirmedSafeIds).toEqual(['p2', 'p3']);
    expect(after.isTaggerSelectionComplete()).toBe(true);
    expect(after.canShowPlayAgainButton()).toBe(true);
    expect(after.blockPlayAgainIfPartialReplay()).toBe(false); // "한번더" 차단 안 됨
    expect(emitted.some((e) => e.eventType === 'PLAY_AGAIN_BLOCKED_PARTIAL_REPLAY')).toBe(false);
  });

  it('폴링 반복(round 1 + game_over/result가 5초마다 계속 도착)에도 wipe되지 않는다(status 조합 무관)', () => {
    const state = gameOverState();
    for (let i = 0; i < 5; i++) {
      runRoomUpdateHead({ round: 1, status: i % 2 === 0 ? 'game_over' : 'result' }, state);
    }
    expect(state.confirmedLoserIds).toEqual(['p1']);
    expect(state.confirmedSafeIds).toEqual(['p2', 'p3']);
  });

  it('소스 계약: 수정된 조건이 정확히 존재하고, 리셋 블록 자체는 제거되지 않았다', () => {
    expect(html).toContain("const confirmedIdsResetKey = `${state.roomCode || ''}:${state.gameRound}`;");
    expect(html).toContain('if (room.round === 1 && state.confirmedIdsResetGameNo !== confirmedIdsResetKey) {');
    // status enumeration으로 되돌아가지 않았는지(H1 재발 방지 계약).
    expect(html).not.toContain("room.round === 1 && room.status !== 'game_over'");
    // gameNo 단독 비교로 되돌아가지 않았는지(M1 재발 방지 계약 — room-scope 없는 비교는 다시 금지).
    expect(html).not.toContain('state.confirmedIdsResetGameNo !== state.gameRound');
    // 리셋 본문(confirmedSafeIds/LoserIds 초기화 + room-scoped 키 기록)은 그대로 유지 — 새 게임 정리 기능 무변경.
    expect(html).toMatch(/if \(room\.round === 1 && state\.confirmedIdsResetGameNo !== confirmedIdsResetKey\) \{\s*\n\s*state\.confirmedSafeIds = \[\];\s*\n\s*state\.confirmedLoserIds = \[\];\s*\n\s*state\.targetLoserCount = getTargetLoserCount\(\);\s*\n\s*state\.confirmedIdsResetGameNo = confirmedIdsResetKey;/);
  });
});

// ════════════════════════════════════════════════════════════════════
describe('Build27 Task2 — 강제 시작 버튼 노출 조건(canShowForceStartReplayButton)', () => {
  it('round <= 1에서는 host라도 절대 노출되지 않는다(WRPS-042 보호)', () => {
    for (const round of [1, 0, undefined, null]) {
      const state = partialReplayReadyState();
      state.round = round; // 픽스처 기본값(2)을 우회해 undefined/null도 정확히 검증
      const { api, buttons } = loadForceStart(state);
      expect(api.canShowForceStartReplayButton(), `round=${String(round)}`).toBe(false);
      api.updateForceStartReplayButtons();
      buttons.forEach((b) => expect(b.hidden, `round=${String(round)}`).toBe(true));
    }
  });

  it('round > 1 + host + status=ready + 활성 일부 미준비 → 세 화면 버튼 모두 노출', () => {
    const state = partialReplayReadyState({ round: 2, p2Ready: true, p3Ready: false });
    const { api, buttons } = loadForceStart(state);
    expect(api.canShowForceStartReplayButton()).toBe(true);
    api.updateForceStartReplayButtons();
    buttons.forEach((b) => { expect(b.hidden).toBe(false); expect(b.disabled).toBe(false); });
  });

  it('비호스트에게는 어떤 조건에서도 노출되지 않는다', () => {
    const state = partialReplayReadyState({ role: 'participant', round: 3, p2Ready: false, p3Ready: false });
    const { api, buttons } = loadForceStart(state);
    expect(api.canShowForceStartReplayButton()).toBe(false);
    api.updateForceStartReplayButtons();
    buttons.forEach((b) => expect(b.hidden).toBe(true));
  });

  it('활성 전원이 이미 준비 완료면 노출되지 않는다(자동 시작 영역 침범 금지)', () => {
    const state = partialReplayReadyState({ round: 2, p2Ready: true, p3Ready: true });
    const { api } = loadForceStart(state);
    expect(api.canShowForceStartReplayButton()).toBe(false);
  });

  it("status가 'ready'가 아니면(playing/result/game_over/waiting) 노출되지 않는다", () => {
    for (const status of ['playing', 'result', 'game_over', 'waiting', 'lobby']) {
      const state = partialReplayReadyState({ round: 2, status });
      const { api } = loadForceStart(state);
      expect(api.canShowForceStartReplayButton(), `status=${status}`).toBe(false);
    }
  });

  it('HTML 계약: 세 화면(screenReady/screenWinnerWait/screenLoserWait) 모두에 .force-start-replay-btn이 있고 기본 hidden이다', () => {
    for (const id of ['forceStartReplayBtnReady', 'forceStartReplayBtnWinnerWait', 'forceStartReplayBtnLoserWait']) {
      const re = new RegExp(`<button id="${id}"[^>]*class="[^"]*\\bhidden\\b[^"]*\\bforce-start-replay-btn\\b[^"]*"[^>]*onclick="window\\.forceStartReplay\\(\\)"`);
      expect(html).toMatch(re);
    }
    // 세 화면 섹션 내부에 각각 위치하는지(대략적 순서 계약).
    const readyIdx = html.indexOf('id="screenReady"');
    const winnerIdx = html.indexOf('id="screenWinnerWait"');
    const loserIdx = html.indexOf('id="screenLoserWait"');
    expect(html.indexOf('forceStartReplayBtnReady')).toBeGreaterThan(readyIdx);
    expect(html.indexOf('forceStartReplayBtnWinnerWait')).toBeGreaterThan(winnerIdx);
    expect(html.indexOf('forceStartReplayBtnLoserWait')).toBeGreaterThan(loserIdx);
    // renderReadyList()가 세 화면 버튼을 일괄 갱신(모든 렌더 경로에 연결됨).
    expect(html).toMatch(/updateMyReadyButton\(\);\s*\n\s*updateHostStartButton\(\);[\s\S]{0,400}updateForceStartReplayButtons\(\);/);
  });

  it('i18n 계약: ko/en/ja 모두 ready.forceStartReplay 키가 있다', () => {
    expect(html.match(/"ready\.forceStartReplay":/g)?.length).toBe(3);
  });
});

// ════════════════════════════════════════════════════════════════════
describe('Build27 Task2 — forceStartReplay() 클릭 동작(실제 startGame 실행)', () => {
  it('활성 참가자 일부가 is_ready=false여도 rooms.status=playing으로 강제 전이된다', async () => {
    const state = partialReplayReadyState({ round: 2, p2Ready: true, p3Ready: false });
    const real = loadRealStartGame(state);
    const { api, emitted } = loadForceStart(state, { startGame: real.startGame });
    await api.forceStartReplay();
    const roomsCall = real.dbCalls.find((c) => c.table === 'rooms');
    expect(roomsCall).toBeTruthy();
    expect(roomsCall.payload.status).toBe('playing'); // is_ready 무시하고 강제 시작
    // 확정 술래 마커는 재기록된다(startGame 기존 로직 그대로).
    const loserMarkerCall = real.dbCalls.find((c) => c.table === 'participants' && c.payload.choice === '__loser__');
    expect(loserMarkerCall.vals).toEqual(['p1']);
    expect(real.getEnteredPlaying()).toBe(1);
    // QA metric: WRPS-074 / FORCE_START_REPLAY, 미준비자 집계 포함.
    const metric = emitted.find((e) => e.eventType === 'FORCE_START_REPLAY');
    expect(metric.wrps).toBe('WRPS-074');
    expect(metric.round).toBe(2);
    expect(metric.activeCount).toBe(2);
    expect(metric.notReadyCount).toBe(1);
    expect(metric.notReadyIds).toEqual(['p3']);
  });

  it('round <= 1이면 handler 자체가 하드블록(스타트 호출도 metric도 없음) — WRPS-042 이중 방어', async () => {
    const state = partialReplayReadyState({ round: 1 });
    let started = 0;
    const { api, emitted } = loadForceStart(state, { startGame: async () => { started++; } });
    await api.forceStartReplay();
    expect(started).toBe(0);
    expect(emitted.length).toBe(0);
  });

  it('비호스트/status!==ready/이미 시작 중(gameStarting·autoStartInFlight)에서는 실행되지 않는다', async () => {
    const cases = [
      partialReplayReadyState({ role: 'participant' }),
      partialReplayReadyState({ status: 'playing' }),
      Object.assign(partialReplayReadyState(), { gameStarting: true }),
      Object.assign(partialReplayReadyState(), { autoStartInFlight: true }),
    ];
    for (const state of cases) {
      let started = 0;
      const { api } = loadForceStart(state, { startGame: async () => { started++; } });
      await api.forceStartReplay();
      expect(started).toBe(0);
    }
  });

  it('레이스: 강제 시작 in-flight 중 마지막 준비자의 자동 시작이 도착해도 이중 시작되지 않는다', async () => {
    const state = partialReplayReadyState({ round: 2, p2Ready: true, p3Ready: false });
    let starts = 0;
    let releaseStart;
    const slowStartGame = async () => { starts++; await new Promise((r) => { releaseStart = r; }); };
    const { api, guard } = loadForceStart(state, { startGame: slowStartGame });

    const forcePromise = api.forceStartReplay(); // 동기 구간에서 autoStartInFlight=true 설정됨
    expect(state.autoStartInFlight).toBe(true);

    // 같은 순간 p3의 ready가 DB에 반영되어 실제 triggerReplayIfLastReady()가 실행되는 상황.
    state.participants[2].is_ready = true;
    const triggerFactory = new Function(
      'state', 'renderReadyList', 'areAllActivePlayersReady', 'startGame',
      TRIGGER_REPLAY_SRC + '\n; return triggerReplayIfLastReady;'
    );
    const triggerReplayIfLastReady = triggerFactory(state, () => {}, guard.areAllActivePlayersReady, slowStartGame);
    await triggerReplayIfLastReady(); // autoStartInFlight 가드로 skip되어야 함
    expect(starts).toBe(1);

    releaseStart();
    await forcePromise;
    expect(state.autoStartInFlight).toBe(false); // finally에서 해제
    expect(starts).toBe(1); // 단 한 번만 시작
  });
});

// ════════════════════════════════════════════════════════════════════
describe('Build27 H2 — startGameFromHostRoom()이 다른 시작 경로와 동일한 뮤텍스에 참여한다', () => {
  it('gameStarting 또는 autoStartInFlight가 true면 startGame을 호출하지 않는다', async () => {
    for (const flags of [{ gameStarting: true }, { autoStartInFlight: true }]) {
      const state = Object.assign(partialReplayReadyState(), flags);
      let started = 0;
      const startGameFromHostRoom = loadStartGameFromHostRoom(state, { startGame: async () => { started++; } });
      await startGameFromHostRoom();
      expect(started).toBe(0);
    }
  });

  it('정상 상태에서는 startGame을 1회 호출하고, 호출 동안 autoStartInFlight를 세팅했다가 완료 후 해제한다', async () => {
    const state = partialReplayReadyState({ round: 2 });
    let started = 0;
    let sawInFlightDuringCall = false;
    const startGameFromHostRoom = loadStartGameFromHostRoom(state, {
      startGame: async () => { started++; sawInFlightDuringCall = state.autoStartInFlight; },
    });
    await startGameFromHostRoom();
    expect(started).toBe(1);
    expect(sawInFlightDuringCall).toBe(true);
    expect(state.autoStartInFlight).toBe(false); // finally에서 해제
  });

  it('레이스: forceStartReplay()가 in-flight인 동안 screenHostRoom의 startGameBtn(startGameFromHostRoom)을 눌러도 이중 시작되지 않는다', async () => {
    const state = partialReplayReadyState({ round: 2, p2Ready: true, p3Ready: false });
    let starts = 0;
    let releaseStart;
    const slowStartGame = async () => { starts++; await new Promise((r) => { releaseStart = r; }); };
    const { api } = loadForceStart(state, { startGame: slowStartGame });
    const startGameFromHostRoom = loadStartGameFromHostRoom(state, { startGame: slowStartGame });

    const forcePromise = api.forceStartReplay(); // 동기 구간에서 autoStartInFlight=true 설정됨
    expect(state.autoStartInFlight).toBe(true);

    await startGameFromHostRoom(); // 같은 뮤텍스에 걸려 즉시 반환 — startGame 재호출 없음
    expect(starts).toBe(1); // forceStartReplay가 시작한 호출 1건뿐

    releaseStart();
    await forcePromise;
    expect(state.autoStartInFlight).toBe(false);
    expect(starts).toBe(1); // 단 한 번만 시작(서로 다른 countdownStartAt으로 이중 write 없음)
  });

  it('레이스(역방향): startGameFromHostRoom()이 먼저 in-flight를 잡으면 forceStartReplay()가 대기 없이 즉시 스킵된다', async () => {
    const state = partialReplayReadyState({ round: 2, p2Ready: true, p3Ready: false });
    let starts = 0;
    let releaseStart;
    const slowStartGame = async () => { starts++; await new Promise((r) => { releaseStart = r; }); };
    const startGameFromHostRoom = loadStartGameFromHostRoom(state, { startGame: slowStartGame });
    const { api } = loadForceStart(state, { startGame: slowStartGame });

    const hostRoomPromise = startGameFromHostRoom();
    expect(state.autoStartInFlight).toBe(true);

    await api.forceStartReplay(); // 뮤텍스에 걸려 즉시 반환
    expect(starts).toBe(1);

    releaseStart();
    await hostRoomPromise;
    expect(state.autoStartInFlight).toBe(false);
    expect(starts).toBe(1);
  });

  it('소스/HTML 계약: showHostRoom()의 startGameBtn은 startGameFromHostRoom()에 바인딩되고, startGame() 직접 바인딩은 더 이상 존재하지 않는다', () => {
    expect(html).toContain('startBtn.onclick = () => startGameFromHostRoom();');
    expect(html).not.toContain('startBtn.onclick = () => window.startGame();');
    // startGame() 자체의 내부 타이밍(realtime 'playing' 감지를 위한 gameStarting 조기 리셋)은 무변경 —
    // H2는 호출부만 뮤텍스로 감쌌을 뿐 startGame() 본체를 건드리지 않았다는 소스 계약.
    expect(html).toContain('state.gameStarting = false;');
    expect(html).toMatch(/\/\/ → Realtime이 'playing'을 감지할 때 gameStarting=false가 보장되어[\s\S]{0,80}state\.gameStarting = false;/);
  });
});

// ════════════════════════════════════════════════════════════════════
describe('Build27 회귀 — 기존 자동 시작/라운드1 흐름 무변경', () => {
  it('활성 전원 ready 시 triggerReplayIfLastReady()가 기존대로 자동 시작한다(실제 소스)', async () => {
    const state = partialReplayReadyState({ round: 2, p2Ready: true, p3Ready: true });
    const { guard } = loadGuard(state);
    let starts = 0;
    const triggerFactory = new Function(
      'state', 'renderReadyList', 'areAllActivePlayersReady', 'startGame',
      TRIGGER_REPLAY_SRC + '\n; return triggerReplayIfLastReady;'
    );
    const trigger = triggerFactory(state, () => {}, guard.areAllActivePlayersReady, async () => { starts++; });
    await trigger();
    expect(starts).toBe(1);
    // 일부 미준비면 자동 시작하지 않는다(기존 동작).
    const state2 = partialReplayReadyState({ round: 2, p2Ready: true, p3Ready: false });
    const { guard: guard2 } = loadGuard(state2);
    let starts2 = 0;
    const trigger2 = triggerFactory(state2, () => {}, guard2.areAllActivePlayersReady, async () => { starts2++; });
    await trigger2();
    expect(starts2).toBe(0);
  });

  it('WRPS-042 무변경: showReadyScreen()은 여전히 hostStartBtn을 무조건 숨긴다(실제 소스 실행)', () => {
    const els = { hostStartBtn: mockEl([]), myReadyBtn: mockEl(), editPenaltyBtn: mockEl(), readyPenaltyBox: mockEl() };
    const state = { role: 'host', round: 1, participants: [] };
    const factory = new Function(
      'state', '$', 'showScreen', 'renderInlinePenaltyBox', 'renderReadyList', 'updateActionGridLayouts', 'updateGuides',
      SHOW_READY_SRC + '\n; return showReadyScreen;'
    );
    const showReadyScreen = factory(state, (id) => els[id], () => {}, () => {}, () => {}, () => {}, () => {});
    showReadyScreen();
    expect(els.hostStartBtn.classList.contains('hidden')).toBe(true); // 무조건 숨김 유지
    expect(els.myReadyBtn.classList.contains('hidden')).toBe(false);
    // 소스 계약도 함께 고정.
    expect(html).toContain('$("hostStartBtn").classList.add("hidden");');
  });

  it('금지 영역 무변경: 판정 알고리즘/Build23 guard/nextRound/startGameBtn·showHostRoom 소스 계약', () => {
    expect(html).toContain('function judgeRound(');
    expect(html).toContain('function resolveElimination(');
    expect(html).toContain('function judgePure(');
    expect(html).toMatch(/function isTaggerSelectionComplete\(\) \{\s*\n\s*return \(state\.participants \|\| \[\]\)\.length > 0 && getActivePlayers\(\)\.length === 0;\s*\n\s*\}/);
    expect(html).toContain('function blockPlayAgainIfPartialReplay() {');
    // forceStartReplay는 nextRound()를 대체하지 않는다 — nextRound 소스 존재/시그니처 유지.
    expect(html).toContain('async function nextRound() {');
    // startGame()의 라운드1 게이트(비호스트 차단)도 무변경.
    expect(html).toContain('if (state.round <= 1 && state.role !== "host" && options.trigger !== "last-ready") return;');
  });
});
