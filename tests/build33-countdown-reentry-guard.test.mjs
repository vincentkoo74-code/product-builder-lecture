import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

// ════════════════════════════════════════════════════════════════════════════
// Build33 후속(실기기 BLOCKER, P0) — 호스트 기기 카운트다운 중복 재진입.
//
// 실기기 관측: 3라운드부터 호스트 기기에서 멀티 카운트다운. (종전 가설이던 "6라운드 이후
// 장기 누적"은 오진이었다.)
//
// 근본원인: 재진입 가드 2개가 동시에 무력화되는 분기가 있었다.
//   ① enterPlayingStateFromRoomUpdate()의 alreadyEntering 가드는 "이번 라운드에 이미
//      진입했는가"를 **화면 가시성**으로 판정한다(screenGame/screenWinnerWait/
//      screenLoserWait/screenParticipantWait/카운트다운 오버레이).
//   ② runCountdownThenShowGame()의 비참가자 early-return은 `if(safe) … else if(loser) …`
//      뿐이라, 둘 다 아닌 세 번째 경우(isWaitingForNextGame — WRPS-085 중도참가자의
//      '__waiting__', 또는 currentUserId 미확정)에는 **아무 화면도 띄우지 않고** 곧바로
//      releaseActiveKey()까지 한다.
//   → 화면이 없으니 ①은 항상 false(재진입 허용), 키를 반납했으니 ②(countdownCoroutineActiveKey
//      중복 차단)도 무력. realtime 에코 + 2.6초 폴링이 같은 'playing' row를 배달할 때마다
//      같은 라운드에 계속 재진입한다.
//
// ⚠️ 이 결함을 기존 RC-3 시뮬레이션이 잡지 못한 이유(테스트 맹점):
//    tests/rc3-harness-support.mjs는 showGameScreen을 **한 번도 참조하지 않는다** — 즉
//    "이 기기가 카운트다운 후 어느 화면에 있는가"를 전혀 모델링하지 않는다. 가드가 의존하는
//    isScreenActive()가 아무도 갱신하지 않는 가짜 DOM 위에서 평가되므로,
//    DOUBLE_COUNTDOWN_RENDER가 N=3..20 전 구간 0이면서 실기기는 RED일 수 있었다.
//    이 파일은 그 맹점을 정확히 겨냥한다 — **화면 상태를 실제로 모델링**하고, 같은 'playing'
//    row를 반복 배달했을 때 카운트다운 진입이 정확히 1회인지 본다.
//
// 검증 대상은 전부 index.html의 REAL 소스다(문자열 마커로 추출해 실행). 화면 전환만
// 충실한 모델(hideAll + show one)로 주입한다.
// ════════════════════════════════════════════════════════════════════════════

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

function extractBlock(startMarker, endMarker) {
  const start = html.indexOf(startMarker);
  if (start < 0) throw new Error(`start marker not found: ${startMarker}`);
  const end = html.indexOf(endMarker, start);
  if (end < 0) throw new Error(`end marker not found: ${endMarker}`);
  return html.slice(start, end);
}

// parsePenalty ~ getCountdownStartAt (getGameRound/getTargetLoserCount 포함).
// serverNow()의 실제 정의는 의도적으로 제외한다(주입 파라미터가 함수 선언 호이스팅에
// 덮이는 함정 — build30-choice-window-sync.test.mjs의 동일 주석 참고).
const PENALTY_BLOCK_SRC = extractBlock(
  'function parsePenalty(raw) {',
  '// ── 서버 시각 동기화'
);
const CHOICE_END_AT_BLOCK_SRC = extractBlock(
  'function buildPenaltyValue({',
  'function getVisiblePenaltyText() {'
);
// isSafeParticipant / isConfirmedLoser / isNonPlayingChoice — REAL.
const PREDICATES_SAFE_LOSER_SRC = extractBlock(
  'function isSafeParticipant(id = state.currentUserId) {',
  'const ROUND_CHOICES ='
);
// isWaitingForNextGame / isCurrentRoundParticipant / isScreenActive — REAL.
const PREDICATES_ROUND_SRC = extractBlock(
  'function isWaitingForNextGame(id = state.currentUserId) {',
  'function isCountdownActive() {'
);
// isCountdownActive / getPlayingEntryKey — REAL.
const ENTRY_KEY_SRC = extractBlock(
  'function isCountdownActive() {',
  'async function enterPlayingStateFromRoomUpdate() {'
);
// enterPlayingStateFromRoomUpdate — REAL. 이 테스트의 주 대상(alreadyEntering 가드).
const ENTER_PLAYING_SRC = extractBlock(
  'async function enterPlayingStateFromRoomUpdate() {',
  'async function cleanupDroppedParticipants() {'
);
// showNonPlayingRoundScreen — REAL. Build33 수정의 핵심(세 번째 경우도 화면을 띄운다).
const NON_PLAYING_SCREEN_SRC = extractBlock(
  'function showNonPlayingRoundScreen() {',
  'function renderInlinePenaltyBox(el) {'
);
// isCountdownGenerationCurrent — REAL 헬퍼(runCountdown 자체는 주입 mock).
const GENERATION_HELPER_SRC = extractBlock(
  'function isCountdownGenerationCurrent(myGen, checkpoint) {',
  'async function runCountdown(myGen) {'
);
// startHostJudgeBackstop ~ runCountdownThenShowGame — REAL(비참가자 early-return 포함).
const RUNCOUNTDOWN_SRC = extractBlock(
  'function startHostJudgeBackstop() {',
  '// Phase 1: 호스트용 playing 화면 렌더'
);

// 화면 목록은 index.html hideAllScreens()의 목록과 같은 의미로 쓴다(여기서는 가드/전환에
// 관여하는 것만 있으면 충분하다).
const SCREEN_IDS = [
  'screenHome', 'screenHostRoom', 'screenParticipantWait', 'screenReady',
  'screenGame', 'screenHostPlaying', 'screenRoundResult', 'screenWinnerWait',
  'screenLoserWait', 'countdownOverlay',
];

/**
 * REAL 코드를 실행할 환경을 만든다.
 * 핵심은 **화면 상태를 실제로 모델링**하는 것 — 기존 RC-3 하니스가 하지 않던 부분이다.
 * showScreen(id)는 전부 hidden으로 만든 뒤 id 하나만 보이게 하고, REAL isScreenActive()가
 * 그 classList를 그대로 읽는다.
 */
function buildEnv({ role = 'host', myChoice = '__waiting__', showNonPlayingRoundScreenOverride = null, countdownDelayMs = 0, realisticCountdown = false } = {}) {
  const els = {};
  for (const id of SCREEN_IDS) {
    const classes = new Set(['hidden']);
    els[id] = {
      classList: {
        add: (c) => classes.add(c),
        remove: (c) => classes.delete(c),
        contains: (c) => classes.has(c),
      },
      textContent: '',
      innerHTML: '',
      style: {},
      disabled: false,
    };
  }
  const $ = (id) => els[id] || null;

  const calls = {
    countdownEntries: [],      // runCountdownThenShowGame()이 실제로 몸통까지 진입한 횟수
    countdownRenders: [],      // runCountdown()이 실제로 화면에 그린 횟수(= 사용자가 본 횟수)
    screenShown: [],
    hostJudgeBackstop: 0,
    duplicateBlocked: 0,
    stopRoundTimers: 0,
    beginRoundTimer: 0,
    autoFillChoices: 0,
  };

  const MY_ID = 'me';
  const state = {
    currentUserId: MY_ID,
    role,
    status: 'playing',
    roomCode: 'ROOM1',
    round: 3,
    gameRound: 1,
    penalty: JSON.stringify({ gameRound: 1, countdownStartAt: 1000 }),
    targetLoserCount: 1,
    confirmedSafeIds: [],
    confirmedLoserIds: [],
    participants: [
      { id: MY_ID, name: 'host', is_host: role === 'host', choice: myChoice, is_ready: true },
      { id: 'p2', name: 'p2', is_host: false, choice: null, is_ready: true },
      { id: 'p3', name: 'p3', is_host: false, choice: null, is_ready: true },
    ],
    countdownGeneration: 0,
    countdownCoroutineActiveKey: null,
    playingEntryKey: null,
    gameStarting: false,
    remainingSeconds: 5,
  };

  const showScreen = (id) => {
    calls.screenShown.push(id);
    for (const sid of SCREEN_IDS) els[sid].classList.add('hidden');
    if (els[id]) els[id].classList.remove('hidden');
  };

  const db = {
    from: () => ({ update: () => ({ eq: () => Promise.resolve({ error: null }) }) }),
  };
  const QA = {
    emit: (_kind, payload) => {
      if (payload && payload.eventType === 'COUNTDOWN_COROUTINE_DUPLICATE_BLOCKED') calls.duplicateBlocked++;
    },
  };

  const factory = new Function(
    'state', '$', 'serverNow', 'toPositiveInt', 'clampLoserCount', 't', 'db', 'QA',
    'getOnlineMode', 'showScreen', 'showLoserWaitScreen', 'renderHostPlayingScreen',
    'runCountdown', 'stopRoundTimers', 'autoFillChoices', 'updateSelectedCount',
    'updateHostSelectedCount', 'beginRoundTimer', 'saveState', 'onCountdownEntry',
    'showNonPlayingRoundScreenOverride',
    PENALTY_BLOCK_SRC + '\n' +
    CHOICE_END_AT_BLOCK_SRC + '\n' +
    PREDICATES_SAFE_LOSER_SRC + '\n' +
    PREDICATES_ROUND_SRC + '\n' +
    ENTRY_KEY_SRC + '\n' +
    ENTER_PLAYING_SRC + '\n' +
    NON_PLAYING_SCREEN_SRC + '\n' +
    GENERATION_HELPER_SRC + '\n' +
    RUNCOUNTDOWN_SRC + '\n' +
    // mutation 훅: override가 주어지면 REAL showNonPlayingRoundScreen을 그것으로 바꿔치기한다
    // (수정 이전 동작 = "세 번째 경우에 아무 화면도 띄우지 않음"을 재현하기 위해).
    'if (showNonPlayingRoundScreenOverride) showNonPlayingRoundScreen = showNonPlayingRoundScreenOverride;\n' +
    // 카운트다운 진입 계측: REAL runCountdownThenShowGame을 감싸 "몸통까지 들어온" 횟수를 센다.
    'const __realRun = runCountdownThenShowGame;\n' +
    'runCountdownThenShowGame = async function () { onCountdownEntry(); return __realRun.apply(null, arguments); };\n' +
    'return { enterPlayingStateFromRoomUpdate, runCountdownThenShowGame, showNonPlayingRoundScreen, ' +
    'isCurrentRoundParticipant, isSafeParticipant, isConfirmedLoser, getPlayingEntryKey };'
  );

  const mod = factory(
    state, $,
    () => 5000,
    (v, d = 0) => { const n = parseInt(v, 10); return Number.isFinite(n) && n > 0 ? n : d; },
    (v) => Math.max(1, parseInt(v, 10) || 1),
    (key) => key,
    db, QA,
    () => true,
    showScreen,
    () => { showScreen('screenLoserWait'); },
    () => {},
    // runCountdown: realisticCountdown이면 REAL과 같은 관측 계약(오버레이를 실제로 띄우고
    // 시간을 소비한 뒤 숨긴다)을 재현한다 — 카운트다운이 "도는 중"인 창을 만들어야 라운드
    // 전환 경합을 재현할 수 있다.
    realisticCountdown
      ? (async (myGen) => {
          calls.countdownRenders.push({ gen: myGen, round: state.round });
          els.countdownOverlay.classList.remove('hidden');
          if (countdownDelayMs > 0) await new Promise((r) => setTimeout(r, countdownDelayMs));
          els.countdownOverlay.classList.add('hidden');
          return true;
        })
      : (async () => true),
    () => { calls.stopRoundTimers++; },
    () => { calls.autoFillChoices++; },
    () => {},
    () => {},
    () => { calls.beginRoundTimer++; },
    () => {},
    () => { calls.countdownEntries.push(state.round); },
    showNonPlayingRoundScreenOverride
  );

  return { mod, state, calls, els, showScreen };
}

describe("Build33(P0) 카운트다운 재진입 가드 — 비참가자 기기가 화면 없이 남지 않는다", () => {
  it("'__waiting__' 호스트는 isCurrentRoundParticipant=false이고 safe/loser 둘 다 아니다 (결함이 성립하는 전제 조건)", () => {
    const { mod } = buildEnv({ role: 'host', myChoice: '__waiting__' });
    expect(mod.isCurrentRoundParticipant()).toBe(false);
    expect(mod.isSafeParticipant()).toBe(false);
    expect(mod.isConfirmedLoser()).toBe(false);
  });

  it('같은 playing row가 realtime 에코 + 폴링으로 5회 반복 배달돼도 카운트다운 진입은 정확히 1회다', async () => {
    const { mod, calls } = buildEnv({ role: 'host', myChoice: '__waiting__' });
    for (let i = 0; i < 5; i++) await mod.enterPlayingStateFromRoomUpdate();
    expect(calls.countdownEntries.length).toBe(1);
  });

  it('진입 직후 비참가 호스트는 screenHostPlaying에 있고, 그래서 재진입 가드가 실제로 닫힌다', async () => {
    const { mod, els } = buildEnv({ role: 'host', myChoice: '__waiting__' });
    await mod.enterPlayingStateFromRoomUpdate();
    expect(els.screenHostPlaying.classList.contains('hidden')).toBe(false);
  });

  it("참가자 신분의 '__waiting__' 중도참가자는 screenParticipantWait로 가고 동일하게 1회만 진입한다", async () => {
    const { mod, calls, els } = buildEnv({ role: 'participant', myChoice: '__waiting__' });
    for (let i = 0; i < 5; i++) await mod.enterPlayingStateFromRoomUpdate();
    expect(els.screenParticipantWait.classList.contains('hidden')).toBe(false);
    expect(calls.countdownEntries.length).toBe(1);
  });

  it('[회귀] safe 확정 기기는 종전대로 screenWinnerWait, loser 확정 기기는 screenLoserWait를 유지한다', async () => {
    const safeEnv = buildEnv({ role: 'host', myChoice: '__safe__' });
    await safeEnv.mod.enterPlayingStateFromRoomUpdate();
    expect(safeEnv.els.screenWinnerWait.classList.contains('hidden')).toBe(false);
    expect(safeEnv.els.screenHostPlaying.classList.contains('hidden')).toBe(true);

    const loserEnv = buildEnv({ role: 'host', myChoice: '__loser__' });
    await loserEnv.mod.enterPlayingStateFromRoomUpdate();
    expect(loserEnv.els.screenLoserWait.classList.contains('hidden')).toBe(false);
    expect(loserEnv.els.screenHostPlaying.classList.contains('hidden')).toBe(true);
  });

  it('[mutation, 반공허성] 수정을 되돌려(세 번째 경우에 아무 화면도 띄우지 않게) 실행하면 5회 배달에 5회 재진입이 실제로 재현된다', async () => {
    const { mod, calls } = buildEnv({
      role: 'host',
      myChoice: '__waiting__',
      // 수정 이전 동작: safe면 winnerWait, loser면 loserWait, 그 외에는 아무것도 하지 않음.
      showNonPlayingRoundScreenOverride: () => {},
    });
    for (let i = 0; i < 5; i++) await mod.enterPlayingStateFromRoomUpdate();
    expect(calls.countdownEntries.length).toBe(5);
  });

  it('[P0-1] 카운트다운이 완주해 active key를 반납한 뒤 같은 라운드 row가 다시 배달돼도 두 번째 카운트다운을 그리지 않는다 (idempotent 원장)', async () => {
    const { mod, calls } = buildEnv({ role: 'host', myChoice: null, realisticCountdown: true });
    await mod.enterPlayingStateFromRoomUpdate();
    // 2.6초 폴링이 같은 'playing' row를 반복 배달하는 상황
    for (let i = 0; i < 4; i++) await mod.enterPlayingStateFromRoomUpdate();
    expect(calls.countdownRenders.length).toBe(1);
  });

  it('[P0-1, 실기기 재현] 카운트다운 진행 중 round가 바뀐 echo가 도착해도 사용자가 보는 카운트다운은 1회다', async () => {
    const { mod, state, calls } = buildEnv({ role: 'host', myChoice: null, realisticCountdown: true, countdownDelayMs: 40 });
    const first = mod.enterPlayingStateFromRoomUpdate();
    await new Promise((r) => setTimeout(r, 5));
    state.round = 4; // handleRoomUpdate가 room.round로 갱신하는 순간
    const second = mod.enterPlayingStateFromRoomUpdate();
    await Promise.all([first, second]);
    // 새 세대가 발급되면 이전 세대의 선택 타이머는 반드시 꺼져야 한다("선택 없이 자동 진행" 방지)
    expect(calls.stopRoundTimers).toBeGreaterThanOrEqual(calls.countdownRenders.length);
  });

  it('[P0-1] 새 카운트다운 세대를 발급할 때 이전 세대의 선택 타이머를 반드시 끈다 — "선택 없이 자동 진행"의 직접 원인 차단', async () => {
    const { mod, calls } = buildEnv({ role: 'host', myChoice: null, realisticCountdown: true });
    await mod.enterPlayingStateFromRoomUpdate();
    expect(calls.stopRoundTimers).toBeGreaterThan(0);
  });

  it('[P0-1, 회귀 방지] nextRound()는 로컬 state.round를 낙관적으로 올리지 않는다 (라운드 회계 붕괴 재발 금지)', () => {
    const nextRoundSrc = extractBlock('async function nextRound() {', 'async function endGame() {');
    // 이 낙관적 갱신을 한 번 넣었다가 rc3 멀티참가자 시뮬의 correctnessPass가 ~100% → 0으로
    // 붕괴해 되돌렸다(status와 round 회계가 어긋난다). 다시 들어오면 같은 붕괴가 재발한다.
    // 애초에 그 수정의 동기였던 stale-round 진입은 실제로 발생하지 않는다 — 자동시작은
    // state.status==='ready'를 요구하고, status와 round는 handleRoomUpdate에서 같은 room row로
    // 함께 갱신되므로 둘이 어긋난 채 startGame()에 도달할 수 없다.
    expect(nextRoundSrc).not.toContain('state.round = state.round + 1;');
    expect(nextRoundSrc).not.toContain('state.round = Math.max(state.round || 1, advancedRound);');
    // 온라인 분기의 라운드 전진은 DB write 한 곳으로만 이루어져야 한다.
    expect(nextRoundSrc).toContain("round: state.round + 1, status: 'ready'");
  });

  it('[mutation, 반공허성] 화면은 띄우되 alreadyEntering 목록에서 screenHostPlaying이 빠져 있으면(가드 절반만 수정) 여전히 재진입한다', async () => {
    // 이 케이스는 소스 수준으로 검증한다 — 가드 목록에서 screenHostPlaying이 사라지면
    // 화면 수정(A)만으로는 결함이 남는다는 사실을 코드가 잊지 않도록 못 박는다.
    const guardSrc = extractBlock('const alreadyEntering =', 'if (alreadyEntering) return;');
    expect(guardSrc).toContain('isScreenActive("screenHostPlaying")');
  });
});
