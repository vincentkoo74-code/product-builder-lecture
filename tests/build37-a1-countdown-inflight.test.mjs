import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

// ════════════════════════════════════════════════════════════════════════════
// A1 — 호스트 카운트다운 in-flight 중복 (Build36 실기기 필드 로그 기반 RED 재현)
//
// 필드 실측(QA-index/qa-report-…-15-33-03.json, deviceRole=host, room BYZ7):
//   17개 (game,round) 중 3건에서 같은 라운드에 세대가 2개 발급됐고,
//   두 번째 COUNTDOWN_START는 예외 없이 waitMs=0(대기 없는 즉시 카운트다운)이었다.
//   3건 중 2건의 직전 이벤트가 정확히 이것이다:
//     PENALTY_MERGE_PRESERVED { callSite:'publishChoiceWindowEnd',
//                               preservedField:'countdownStartAt', gameNo:7, round:1 }
//   → 호스트가 자기 choice window를 발행한 write가 에코로 되돌아와 재진입한다.
//   Build36이 추가한 두 가드는 이 창에서 **한 번도 발화하지 않았다**
//   (COUNTDOWN_ALREADY_RENDERED_BLOCKED 0, COUNTDOWN_COROUTINE_DUPLICATE_BLOCKED 0).
//
// 이 파일은 그 시퀀스를 REAL 소스로 재현하고, 재진입이 일어나는 순간의 가드 상태를
// 그대로 캡처해 근본원인을 코드가 아니라 관측으로 확정한다.
//
// ⚠️ 계약: 정상적인 다음 round/game 카운트다운은 절대 막히면 안 된다(대조군으로 고정).
// ════════════════════════════════════════════════════════════════════════════

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
function extractBlock(a, b) {
  const s = html.indexOf(a); if (s < 0) throw new Error('start marker: ' + a);
  const e = html.indexOf(b, s); if (e < 0) throw new Error('end marker: ' + b);
  return html.slice(s, e);
}
const noop = () => {};
const toPositiveInt = (v, d = 0) => { const n = parseInt(v, 10); return Number.isFinite(n) && n > 0 ? n : d; };
const clampLoserCount = (v) => Math.max(1, parseInt(v, 10) || 1);

const PENALTY_SRC   = extractBlock('function parsePenalty(raw) {', '// ── 서버 시각 동기화');
const CHOICE_SRC    = extractBlock('function buildPenaltyValue({', 'function getVisiblePenaltyText() {');
const SAFELOSER_SRC = extractBlock('function isSafeParticipant(id = state.currentUserId) {', 'const ROUND_CHOICES =');
const ROUNDPRED_SRC = extractBlock('function isWaitingForNextGame(id = state.currentUserId) {', 'function isCountdownActive() {');
const ENTRYKEY_SRC  = extractBlock('function isCountdownActive() {', 'async function enterPlayingStateFromRoomUpdate() {');
const ENTER_SRC     = extractBlock('async function enterPlayingStateFromRoomUpdate() {', 'async function cleanupDroppedParticipants() {');
const NONPLAY_SRC   = extractBlock('function showNonPlayingRoundScreen() {', 'function renderInlinePenaltyBox(el) {');
const GENHELP_SRC   = extractBlock('function isCountdownGenerationCurrent(myGen, checkpoint) {', 'async function runCountdown(myGen) {');
const RUNCD_SRC     = extractBlock('function startHostJudgeBackstop() {', '// Phase 1: 호스트용 playing 화면 렌더');
const HRU_PROLOG_SRC= extractBlock('const STALE_ROOM_UPDATE_SELF_HEAL_THRESHOLD = 5;', '// WRPS-083 2B: destroyed 조기 분기.');

const SCREEN_IDS = ['screenHome','screenHostRoom','screenParticipantWait','screenReady','screenGame',
  'screenHostPlaying','screenRoundResult','screenWinnerWait','screenLoserWait','countdownOverlay'];

function buildEnv({ round = 1, gameRound = 7, startScreen = 'screenReady', mutateRevertFix = false } = {}) {
  const els = {};
  for (const id of SCREEN_IDS) {
    const cls = new Set(['hidden']);
    els[id] = { classList: { add: c => cls.add(c), remove: c => cls.delete(c), contains: c => cls.has(c) },
      textContent: '', innerHTML: '', style: {}, disabled: false };
  }
  els[startScreen].classList.remove('hidden');
  const $ = id => els[id] || null;

  let clock = 1_000_000;
  const serverNow = () => clock;
  const advance = ms => { clock += ms; };

  const calls = { generations: [], countdownStarts: [], blocked: [], entries: [], guardProbe: [] };
  const MY = 'host1';

  const pen = ({ gr = gameRound, startAt = 0, choiceEndAt = 0 } = {}) => {
    const v = { text: '오늘 커피 사기', loserCount: 1, gameRound: gr };
    if (startAt) v.countdownStartAt = startAt;
    if (choiceEndAt) v.choiceEndAt = choiceEndAt;
    return JSON.stringify(v);
  };

  const state = {
    currentUserId: MY, role: 'host', status: 'ready', roomCode: 'BYZ7',
    round, gameRound, penalty: pen(), targetLoserCount: 1,
    confirmedSafeIds: [], confirmedLoserIds: [],
    participants: [
      { id: MY, name: 'host', is_host: true, choice: null, is_ready: true },
      { id: 'p2', name: 'p2', is_host: false, choice: null, is_ready: true },
      { id: 'p3', name: 'p3', is_host: false, choice: null, is_ready: true },
    ],
    countdownGeneration: 0, countdownCoroutineActiveKey: null, countdownRenderedKey: null,
    playingEntryKey: null, gameStarting: false, staleRoomUpdateSkipStreak: 0,
    renderedPhaseKeys: {}, renderedPhaseKeysGameNo: gameRound, confirmedIdsResetGameNo: null,
    countdownStartAt: 0, choiceEndAt: 0,
  };

  const showScreen = id => { for (const s of SCREEN_IDS) els[s].classList.add('hidden'); if (els[id]) els[id].classList.remove('hidden'); };
  const QA = { emit: (_c, p) => {
    if (!p) return;
    if (p.eventType === 'COUNTDOWN_GENERATION_STARTED') calls.generations.push({ gen: p.generation, gameNo: p.gameNo, round: p.round });
    if (p.eventType === 'COUNTDOWN_ALREADY_RENDERED_BLOCKED') calls.blocked.push('rendered');
    if (p.eventType === 'COUNTDOWN_COROUTINE_DUPLICATE_BLOCKED') calls.blocked.push('coroutine');
  } };
  const db = { from: () => ({ update: () => ({ eq: () => Promise.resolve({ error: null }) }) }) };

  // runCountdown 충실 모델: REAL과 동일한 관측 계약 —
  //   ① 오버레이를 **대기 전에** 먼저 띄운다(REAL 8486행 부근)
  //   ② COUNTDOWN_START(waitMs) 방출  ③ waitMs 대기  ④ 세대 checkpoint  ⑤ 오버레이 숨김
  const makeRunCountdown = (isCurrent) => async (myGen) => {
    els.countdownOverlay.classList.remove('hidden');
    const scheduled = toPositiveInt(JSON.parse(state.penalty).countdownStartAt, 0);
    const waitMs = scheduled ? Math.max(0, scheduled - serverNow()) : 0;
    calls.countdownStarts.push({ gen: myGen, waitMs, gameNo: state.gameRound, round: state.round });
    if (waitMs > 0) await new Promise(r => setTimeout(r, 60)); // 실시간은 압축, 순서만 보존
    if (!isCurrent(myGen, 'leadSleep')) { els.countdownOverlay.classList.add('hidden'); return false; }
    els.countdownOverlay.classList.add('hidden');
    return true;
  };

  const factory = new Function(
    'state','$','serverNow','toPositiveInt','clampLoserCount','t','db','QA','getOnlineMode',
    'showScreen','showLoserWaitScreen','renderHostPlayingScreen','__mkRun','stopRoundTimers',
    'autoFillChoices','updateSelectedCount','updateHostSelectedCount','beginRoundTimer','saveState','onEntry',
    PENALTY_SRC + '\n' + CHOICE_SRC + '\n' + SAFELOSER_SRC + '\n' + ROUNDPRED_SRC + '\n' +
    ENTRYKEY_SRC + '\n' + ENTER_SRC + '\n' + NONPLAY_SRC + '\n' + GENHELP_SRC + '\n' + RUNCD_SRC + '\n' +
    'const runCountdown = __mkRun(isCountdownGenerationCurrent);\n' +
    'const __realRun = runCountdownThenShowGame;\n' +
    'runCountdownThenShowGame = async function () { onEntry(); return __realRun.apply(null, arguments); };\n' +
    'async function handleRoomUpdateProlog(room) {\n' +
    '  if (!state.roomCode) return { skipped: true };\n' +
    (mutateRevertFix ? HRU_PROLOG_SRC.replace(' && !room.__unidentifiedGameRoundRow', '') : HRU_PROLOG_SRC) + '\n' +
    '  return { skipped: false, oldStatus, newStatus: state.status };\n}\n' +
    'return { enterPlayingStateFromRoomUpdate, runCountdownThenShowGame, handleRoomUpdateProlog, getPlayingEntryKey, isCountdownActive };'
  );

  const mod = factory(
    state, $, serverNow, toPositiveInt, clampLoserCount, k => k, db, QA, () => true,
    showScreen, () => showScreen('screenLoserWait'), noop, makeRunCountdown, noop, noop, noop, noop, noop, noop,
    () => {
      calls.entries.push(state.round);
      calls.guardProbe.push({
        at: 'runCountdownThenShowGame 진입',
        entryKey: mod && mod.getPlayingEntryKey ? mod.getPlayingEntryKey() : null,
        playingEntryKey: state.playingEntryKey,
        countdownRenderedKey: state.countdownRenderedKey,
        coroutineActiveKey: state.countdownCoroutineActiveKey,
        countdownOverlayVisible: !els.countdownOverlay.classList.contains('hidden'),
        screenGameVisible: !els.screenGame.classList.contains('hidden'),
      });
    }
  );

  const deliver = async (room) => {
    const r = await mod.handleRoomUpdateProlog(room);
    if (!r || r.skipped) return r;
    if (r.oldStatus !== r.newStatus && state.status === 'playing') await mod.enterPlayingStateFromRoomUpdate();
    return r;
  };
  // 같은 status가 다시 와도 폴링은 handleRoomUpdate를 호출한다. 전이가 아니면 dispatch하지 않는
  // REAL 구조를 그대로 따르되, 자기-write 에코가 만드는 재진입 경로를 별도로 제공한다.
  const deliverEchoDuringFlight = async (room) => {
    const r = await mod.handleRoomUpdateProlog(room);
    if (!r || r.skipped) return r;
    // publishChoiceWindowEnd 에코는 status가 playing 그대로다 → REAL에서는 oldStatus===newStatus.
    // 재진입이 일어나는 실제 경로(폴링 재동기화 / ready-branch resume)를 모델링해 직접 호출한다.
    await mod.enterPlayingStateFromRoomUpdate();
    return r;
  };

  return { mod, state, calls, els, deliver, deliverEchoDuringFlight, pen, advance, serverNow };
}

describe('A1 — 필드 시퀀스 재현: publishChoiceWindowEnd 에코가 같은 라운드에 두 번째 카운트다운을 만든다', () => {
  it('전제: runCountdown은 대기 전에 오버레이를 먼저 띄운다 (가드가 의존하는 관측 계약)', () => {
    const src = extractBlock('async function runCountdown(myGen) {', 'function beginRoundTimer(');
    // 오버레이는 scheduledStartAt 조회/대기 계산보다 앞에서 이미 노출된다 →
    // 대기 구간 내내 isCountdownActive()가 true여야 한다는 것이 가드의 전제다.
    expect(src.indexOf('overlay.classList.remove("hidden")'))
      .toBeLessThan(src.indexOf('const waitMs ='));
  });

  it('기준선: ready → playing 전이 하나로 카운트다운은 정확히 1회', async () => {
    const env = buildEnv();
    const startAt = env.serverNow() + 3400;
    await env.deliver({ id: 'BYZ7', status: 'playing', round: 1, penalty: env.pen({ startAt }) });
    await new Promise(r => setTimeout(r, 120));
    expect(env.calls.countdownStarts.length).toBe(1);
    expect(env.calls.generations.length).toBe(1);
  });

  // ★ 핵심 RED — 필드 로그와 동일한 순서
  it('[RED] 카운트다운 진행 중 publishChoiceWindowEnd 에코가 오면 세대가 2개 발급되고 두 번째는 waitMs=0이다', async () => {
    const env = buildEnv();
    const startAt = env.serverNow() + 3400;

    // ① COUNTDOWN_GENERATION_STARTED N — ready→playing 전이 (완료를 기다리지 않는다)
    const inflight = env.deliver({ id: 'BYZ7', status: 'playing', round: 1, penalty: env.pen({ startAt }) });
    await new Promise(r => setTimeout(r, 10));
    expect(env.calls.countdownStarts.length, '첫 카운트다운 시작').toBe(1);
    expect(env.calls.countdownStarts[0].waitMs, '첫 카운트다운은 대기가 있다').toBeGreaterThan(0);

    // ② 카운트다운이 아직 도는 중(오버레이 노출 상태)에
    expect(env.els.countdownOverlay.classList.contains('hidden'), '오버레이가 떠 있어야 한다').toBe(false);

    // ③ 호스트 자신의 publishChoiceWindowEnd write가 에코로 돌아온다
    //    (PENALTY_MERGE_PRESERVED: countdownStartAt 보존 + choiceEndAt 추가, 같은 game/round)
    env.advance(1200);
    await env.deliverEchoDuringFlight({
      id: 'BYZ7', status: 'playing', round: 1,
      penalty: env.pen({ startAt, choiceEndAt: startAt + 8000 }),
    });
    await inflight;
    await new Promise(r => setTimeout(r, 120));

    // 관측: 재진입 시점의 가드 상태 (근본원인 확정용)
    // eslint-disable-next-line no-console
    if (env.calls.guardProbe.length > 1) console.log('GUARD PROBE @2nd entry:', JSON.stringify(env.calls.guardProbe[1]));

    const key = k => `${k.gameNo}:${k.round}`;
    const perRound = env.calls.generations.reduce((m, g) => (m[key(g)] = (m[key(g)] || 0) + 1, m), {});
    expect(perRound, '동일 room/game/round에 세대는 정확히 1개').toEqual({ '7:1': 1 });
    expect(env.calls.countdownStarts.length, '사용자가 본 카운트다운 횟수').toBe(1);
    expect(env.calls.countdownStarts.some(c => c.waitMs === 0), 'waitMs=0 즉시 카운트다운이 있으면 안 된다').toBe(false);
  });

  // 반증 기록: 최초 가설(in-flight 에코 재진입)은 재현되지 않았다. runCountdown이 대기 전에
  // 오버레이를 띄우므로 isCountdownActive()가 true가 되어 alreadyEntering 가드가 정상 작동한다.
  // 이 테스트는 그 음성 결과를 회귀로 고정한다 — 가드가 나중에 약해지면 여기서 잡힌다.
  it('[반증/회귀] in-flight 에코는 재진입을 만들지 않는다 (alreadyEntering 가드 정상)', async () => {
    const env = buildEnv();
    const startAt = env.serverNow() + 3400;
    const inflight = env.deliver({ id: 'BYZ7', status: 'playing', round: 1, penalty: env.pen({ startAt }) });
    await new Promise(r => setTimeout(r, 10));
    env.advance(1200);
    await env.deliverEchoDuringFlight({
      id: 'BYZ7', status: 'playing', round: 1,
      penalty: env.pen({ startAt, choiceEndAt: startAt + 8000 }),
    });
    await inflight;
    await new Promise(r => setTimeout(r, 120));
    const perRound = env.calls.generations.reduce((m, g) => (m[`${g.gameNo}:${g.round}`] = (m[`${g.gameNo}:${g.round}`] || 0) + 1, m), {});
    expect(perRound, 'in-flight 에코로는 중복 세대가 생기지 않는다').toEqual({ '7:1': 1 });
  });

  // ── 후보 시퀀스 탐색: 원장이 "조용히" 지워지는 경로 ─────────────────────────
  // gen N이 완주해 countdownRenderedKey를 기록한 뒤에도 gen N+1이 차단되지 않았다는 것은
  // 그 사이에 원장이 지워졌다는 뜻이다. 지우는 유일한 코드는
  //   if (state.status !== "playing" && !room.__behindRoundReset) { ...= null }
  // 이고, 여기 도달하려면 stale 게이트를 통과해야 한다. 게이트 3축은 모두
  // incomingGameRound > 0 을 요구하므로, **penalty에 gameRound가 없는 row(=0)** 는
  // 세 축 모두 무력화된 채 통과한다. 그 row 하나가 원장을 지운다.
  it('[후보] penalty에 gameRound가 없는 row가 오면 stale 게이트 3축이 모두 무력화된다', async () => {
    const env = buildEnv();
    const startAt = env.serverNow() + 3400;
    await env.deliver({ id: 'BYZ7', status: 'playing', round: 1, penalty: env.pen({ startAt }) });
    await new Promise(r => setTimeout(r, 120));
    expect(env.state.countdownRenderedKey, '완주 후 원장 기록').toBe('BYZ7:7:1');

    // gameRound 인코딩이 없는 ready row (과거 round) — 세 축 모두 통과한다
    await env.deliver({ id: 'BYZ7', status: 'ready', round: 1, penalty: JSON.stringify({ text: '', loserCount: 1 }) });
    expect(env.state.countdownRenderedKey, '원장이 지워지면 안 된다').toBe('BYZ7:7:1');
  });

  it('[후보] 원장이 지워진 뒤 같은 라운드 playing이 재배달되면 두 번째 카운트다운이 돈다', async () => {
    const env = buildEnv();
    const startAt = env.serverNow() + 3400;
    await env.deliver({ id: 'BYZ7', status: 'playing', round: 1, penalty: env.pen({ startAt }) });
    await new Promise(r => setTimeout(r, 120));
    expect(env.calls.countdownStarts.length).toBe(1);

    await env.deliver({ id: 'BYZ7', status: 'ready', round: 1, penalty: JSON.stringify({ text: '', loserCount: 1 }) });
    env.advance(5000);
    await env.deliver({ id: 'BYZ7', status: 'playing', round: 1, penalty: env.pen({ startAt }) });
    await new Promise(r => setTimeout(r, 120));

    const perRound = env.calls.generations.reduce((m, g) => (m[`${g.gameNo}:${g.round}`] = (m[`${g.gameNo}:${g.round}`] || 0) + 1, m), {});
    expect(perRound, '동일 game/round에 세대는 1개').toEqual({ '7:1': 1 });
    expect(env.calls.countdownStarts.some(c => c.waitMs === 0), 'waitMs=0 즉시 카운트다운 금지').toBe(false);
  });

  it('[mutation, 반공허성] 수정(!room.__unidentifiedGameRoundRow)을 되돌리면 결함이 그대로 재현된다', async () => {
    const env = buildEnv({ mutateRevertFix: true });
    const startAt = env.serverNow() + 3400;
    await env.deliver({ id: 'BYZ7', status: 'playing', round: 1, penalty: env.pen({ startAt }) });
    await new Promise(r => setTimeout(r, 120));
    expect(env.state.countdownRenderedKey).toBe('BYZ7:7:1');
    await env.deliver({ id: 'BYZ7', status: 'ready', round: 1, penalty: JSON.stringify({ text: '', loserCount: 1 }) });
    expect(env.state.countdownRenderedKey, '수정 제거 시 원장이 지워진다').toBe(null);
    env.advance(5000);
    await env.deliver({ id: 'BYZ7', status: 'playing', round: 1, penalty: env.pen({ startAt }) });
    await new Promise(r => setTimeout(r, 120));
    const per = env.calls.generations.reduce((m, g) => (m[`${g.gameNo}:${g.round}`] = (m[`${g.gameNo}:${g.round}`] || 0) + 1, m), {});
    expect(per, '수정 제거 시 세대 2개').toEqual({ '7:1': 2 });
    expect(env.calls.countdownStarts.some(c => c.waitMs === 0), '수정 제거 시 waitMs=0 재현').toBe(true);
  });

  it('대조군: 정상적인 다음 라운드 카운트다운은 막히지 않는다', async () => {
    const env = buildEnv();
    const s1 = env.serverNow() + 3400;
    await env.deliver({ id: 'BYZ7', status: 'playing', round: 1, penalty: env.pen({ startAt: s1 }) });
    await new Promise(r => setTimeout(r, 120));
    // 라운드 종료 → 다음 라운드 ready → playing
    await env.deliver({ id: 'BYZ7', status: 'result', round: 1, penalty: env.pen() });
    await env.deliver({ id: 'BYZ7', status: 'ready', round: 2, penalty: env.pen() });
    env.advance(9000);
    const s2 = env.serverNow() + 3400;
    await env.deliver({ id: 'BYZ7', status: 'playing', round: 2, penalty: env.pen({ startAt: s2 }) });
    await new Promise(r => setTimeout(r, 120));
    expect(env.calls.countdownStarts.length, '라운드1 + 라운드2 = 2회').toBe(2);
    expect(env.calls.countdownStarts[1].round).toBe(2);
  });

  it('대조군: 다음 게임(gameNo 증가)의 라운드1도 막히지 않는다', async () => {
    const env = buildEnv();
    const s1 = env.serverNow() + 3400;
    await env.deliver({ id: 'BYZ7', status: 'playing', round: 1, penalty: env.pen({ startAt: s1 }) });
    await new Promise(r => setTimeout(r, 120));
    await env.deliver({ id: 'BYZ7', status: 'game_over', round: 1, penalty: env.pen() });
    await env.deliver({ id: 'BYZ7', status: 'lobby', round: 1, penalty: env.pen({ gr: 8 }) });
    await env.deliver({ id: 'BYZ7', status: 'ready', round: 1, penalty: env.pen({ gr: 8 }) });
    env.advance(9000);
    const s2 = env.serverNow() + 3400;
    await env.deliver({ id: 'BYZ7', status: 'playing', round: 1, penalty: env.pen({ gr: 8, startAt: s2 }) });
    await new Promise(r => setTimeout(r, 120));
    expect(env.calls.countdownStarts.length, '게임7 라운드1 + 게임8 라운드1 = 2회').toBe(2);
    expect(env.calls.countdownStarts[1].gameNo).toBe(8);
  });
});
