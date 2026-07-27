import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

// Build30-R2 Phase2(WRPS-078) — STOP-SHIP 복구 RC-2 구현 검증.
//
// A) penalty merge — publishChoiceWindowEnd/republishCountdownStartAsHost의 targeted 2줄 수정이
//    실제로 상대 필드를 보존하는지(CONFIRMED ROOT CAUSE 수정) + PENALTY_MERGE_PRESERVED metric.
// B) countdown coroutine generation token — runCountdownThenShowGame이 발급하는 세대가 stale이면
//    이후 side effect(화면 전환/DB write)를 커밋하지 못함 + 3종 metric.
// C) getPlayingEntryKey — countdownStartAt 제거(republish가 새 진입으로 오판되지 않음).
// D) playVoiceClip eventId — roomCode:gameNo:round:audioKey(playingEntryKey 의존 제거).
// E) resultValue — 임의 win/lose/draw 생성 금지 + 렌더 게이트(RESULT_VALUE_UNRESOLVED/
//    RESULT_VALUE_FALLBACK_USED).
//
// 모든 테스트는 실제 소스를 new Function으로 추출·실행한다(hand-copy 로직 검증 금지).

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

function extractBlock(startMarker, endMarker) {
  const start = html.indexOf(startMarker);
  if (start < 0) throw new Error(`start marker not found: ${startMarker}`);
  const end = html.indexOf(endMarker, start);
  if (end < 0) throw new Error(`end marker not found: ${endMarker}`);
  return html.slice(start, end);
}

function toPositiveInt(value, fallback = 0) {
  const n = parseInt(value, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

// ── Part A: penalty merge preserve ──────────────────────────────────────────
describe('Build30-R2 Phase2(WRPS-078) Part A — penalty merge preserve(CONFIRMED ROOT CAUSE 수정)', () => {
  const PENALTY_BLOCK_SRC = extractBlock('function parsePenalty(raw) {', '// ── 서버 시각 동기화');
  const CHOICE_END_AT_BLOCK_SRC = extractBlock('function buildPenaltyValue({', 'function getVisiblePenaltyText() {');
  const REPUBLISH_SRC = extractBlock(
    'async function republishCountdownStartAsHost() {',
    'function showCountdownSyncError(overlay, numEl, labelEl, onRetry) {'
  );
  const PUBLISH_CHOICE_END_SRC = extractBlock(
    'async function publishChoiceWindowEnd(choiceEndAt) {',
    'function captureAndPublishChoiceWindowNow() {'
  );

  function buildEnv({ state, dbUpdateImpl = () => ({ error: null }), getOnlineModeFn = () => true }) {
    const calls = { dbUpdate: [], qaMetrics: [] };
    const db = {
      from(table) {
        return {
          update(payload) {
            return {
              eq(col, val) {
                calls.dbUpdate.push({ table, payload, col, val });
                return Promise.resolve(dbUpdateImpl(payload));
              },
            };
          },
        };
      },
    };
    const QA = { emit: (kind, payload) => { calls.qaMetrics.push({ kind, payload }); } };
    const factory = new Function(
      'state', 'toPositiveInt', 'clampLoserCount', 'db', 'QA', 'getOnlineMode', 'getNextCountdownStartAt',
      PENALTY_BLOCK_SRC + '\n' + CHOICE_END_AT_BLOCK_SRC + '\n' + REPUBLISH_SRC + '\n' + PUBLISH_CHOICE_END_SRC +
      '\nreturn { buildPenaltyValue, getCountdownStartAt, getChoiceEndAt, republishCountdownStartAsHost, publishChoiceWindowEnd };'
    );
    const mod = factory(
      state, toPositiveInt, (v) => Math.max(1, parseInt(v, 10) || 1), db, QA, getOnlineModeFn,
      () => (state.countdownStartAt || 0) + 3600
    );
    return { mod, calls, state };
  }

  it('publishChoiceWindowEnd는 이미 발행된 countdownStartAt을 명시적으로 다시 실어 보존한다(회귀: 이전엔 유실됨)', async () => {
    const state = {
      role: 'host', roomCode: 'ROOM-A1', gameRound: 2, round: 1,
      // 이전 write(startGame 등)로 이미 countdownStartAt이 인코딩돼 있다.
      penalty: JSON.stringify({ text: '', loserCount: 1, gameRound: 2, countdownStartAt: 555000 }),
      countdownStartAt: 555000,
    };
    const { mod, calls } = buildEnv({ state });
    await mod.publishChoiceWindowEnd(999000);
    expect(calls.dbUpdate.length).toBe(1);
    const parsed = JSON.parse(calls.dbUpdate[0].payload.penalty);
    // 핵심 회귀 방지 지점: choiceEndAt을 새로 쓰면서도 countdownStartAt이 함께 실려 유실되지 않는다.
    expect(parsed.countdownStartAt).toBe(555000);
    expect(parsed.choiceEndAt).toBe(999000);
    expect(calls.qaMetrics.some(m =>
      m.payload?.eventType === 'PENALTY_MERGE_PRESERVED' &&
      m.payload?.callSite === 'publishChoiceWindowEnd' &&
      m.payload?.preservedField === 'countdownStartAt' &&
      m.payload?.preservedValue === 555000
    )).toBe(true);
  });

  it('publishChoiceWindowEnd 대조군: countdownStartAt이 애초에 없으면(0) 보존할 것도 없고 PENALTY_MERGE_PRESERVED도 찍지 않는다', async () => {
    const state = { role: 'host', roomCode: 'ROOM-A2', gameRound: 1, round: 1, penalty: '', countdownStartAt: 0 };
    const { mod, calls } = buildEnv({ state });
    await mod.publishChoiceWindowEnd(1000);
    const parsed = JSON.parse(calls.dbUpdate[0].payload.penalty);
    expect(parsed.countdownStartAt).toBeUndefined();
    expect(calls.qaMetrics.some(m => m.payload?.eventType === 'PENALTY_MERGE_PRESERVED')).toBe(false);
  });

  it('republishCountdownStartAsHost는 이미 발행된 choiceEndAt을 보존한 채 새 countdownStartAt만 갱신한다(회귀: 이전엔 유실됨)', async () => {
    const state = {
      role: 'host', roomCode: 'ROOM-A3', gameRound: 1, round: 2,
      penalty: JSON.stringify({ text: '', loserCount: 1, gameRound: 1, choiceEndAt: 123456 }),
      choiceEndAt: 123456,
    };
    const { mod, calls } = buildEnv({ state });
    const newStart = await mod.republishCountdownStartAsHost();
    expect(calls.dbUpdate.length).toBe(1);
    const parsed = JSON.parse(calls.dbUpdate[0].payload.penalty);
    expect(parsed.countdownStartAt).toBe(newStart);
    // 핵심 회귀 방지 지점: 새 countdownStartAt을 발행하면서도 choiceEndAt이 유실되지 않는다.
    expect(parsed.choiceEndAt).toBe(123456);
    expect(calls.qaMetrics.some(m =>
      m.payload?.eventType === 'PENALTY_MERGE_PRESERVED' &&
      m.payload?.callSite === 'republishCountdownStartAsHost' &&
      m.payload?.preservedField === 'choiceEndAt' &&
      m.payload?.preservedValue === 123456
    )).toBe(true);
  });

  it('mutation 확인: countdownStartAt 보존 인자를 제거하면(옛 결함 재현) choiceEndAt이 다시 유실된다', async () => {
    // 실제 소스에서 preservedCountdownStartAt 인자를 제거해 "고치기 전" 상태를 재현 — RED가 나야
    // 이 테스트가 실제로 그 수정을 검증하고 있다는 뜻이다.
    const brokenSrc = PUBLISH_CHOICE_END_SRC.replace(
      'buildPenaltyValue({ gameRound: getGameRound(), choiceEndAt, countdownStartAt: preservedCountdownStartAt })',
      'buildPenaltyValue({ gameRound: getGameRound(), choiceEndAt })'
    );
    expect(brokenSrc).not.toBe(PUBLISH_CHOICE_END_SRC); // 치환이 실제로 일어났는지 확인
    const state = {
      role: 'host', roomCode: 'ROOM-A4', gameRound: 1, round: 1,
      penalty: JSON.stringify({ text: '', loserCount: 1, gameRound: 1, countdownStartAt: 777000 }),
      countdownStartAt: 777000,
    };
    const calls = { dbUpdate: [] };
    const db = { from: () => ({ update: (payload) => ({ eq: () => { calls.dbUpdate.push({ payload }); return Promise.resolve({ error: null }); } }) }) };
    const QA = { emit: () => {} };
    const factory = new Function(
      'state', 'toPositiveInt', 'clampLoserCount', 'db', 'QA', 'getOnlineMode',
      PENALTY_BLOCK_SRC + '\n' + CHOICE_END_AT_BLOCK_SRC + '\n' + brokenSrc +
      '\nreturn { publishChoiceWindowEnd };'
    );
    const mod = factory(state, toPositiveInt, (v) => Math.max(1, parseInt(v, 10) || 1), db, QA, () => true);
    await mod.publishChoiceWindowEnd(999000);
    const parsed = JSON.parse(calls.dbUpdate[0].payload.penalty);
    expect(parsed.countdownStartAt).toBeUndefined(); // 옛 결함 재현: 유실됨(RED)
  });
});

// ── Part B: countdown coroutine generation token ────────────────────────────
describe('Build30-R2 Phase2(WRPS-078) Part B — countdown coroutine 세대 토큰', () => {
  const PENALTY_BLOCK_SRC = extractBlock('function parsePenalty(raw) {', '// ── 서버 시각 동기화');
  const CHOICE_END_AT_BLOCK_SRC = extractBlock('function buildPenaltyValue({', 'function getVisiblePenaltyText() {');
  const GENERATION_HELPER_BLOCK_SRC = extractBlock(
    'function isCountdownGenerationCurrent(myGen, checkpoint) {',
    'async function runCountdown(myGen) {'
  );
  const RUNCOUNTDOWN_BLOCK_SRC = extractBlock(
    'function startHostJudgeBackstop() {',
    '// Phase 1: 호스트용 playing 화면 렌더'
  );
  const TIMER_BLOCK_SRC = extractBlock('function setRoundTimerText(v) {', 'function stopRoundTimers() {');

  function buildEnv({ state, runCountdownImpl = async () => true, isCurrentRoundParticipantFn = () => true,
    isSafeParticipantFn = () => false, isConfirmedLoserFn = () => false } = {}) {
    const els = {};
    const $ = (id) => { if (!els[id]) els[id] = { textContent: '', className: '', style: {} }; return els[id]; };
    const calls = { showScreen: [], showLoserWaitScreen: 0, startHostJudgeBackstop: 0, dbUpdate: [], qaMetrics: [] };
    const db = {
      from(table) {
        return { update(payload) { return { eq(col, val) { calls.dbUpdate.push({ table, payload }); return Promise.resolve({ error: null }); } }; } };
      },
    };
    const QA = { emit: (kind, payload) => { calls.qaMetrics.push({ kind, payload }); } };
    const factory = new Function(
      'state', '$', 'serverNow', 'toPositiveInt', 'clampLoserCount', 't', 'db', 'QA',
      'getOnlineMode', 'isCurrentRoundParticipant', 'isSafeParticipant', 'isConfirmedLoser',
      'showScreen', 'showLoserWaitScreen', 'runCountdown', 'stopRoundTimers', 'autoFillChoices',
      'updateSelectedCount', 'updateHostSelectedCount', 'isScreenActive',
      PENALTY_BLOCK_SRC + '\n' + CHOICE_END_AT_BLOCK_SRC + '\n' + GENERATION_HELPER_BLOCK_SRC + '\n' + RUNCOUNTDOWN_BLOCK_SRC + '\n' + TIMER_BLOCK_SRC +
      '\nreturn { runCountdownThenShowGame, isCountdownGenerationCurrent, getGameRound };'
    );
    const mod = factory(
      state, $, () => Date.now(),
      toPositiveInt, (v) => Math.max(1, parseInt(v, 10) || 1), (key) => key, db, QA,
      () => true, isCurrentRoundParticipantFn, isSafeParticipantFn, isConfirmedLoserFn,
      (id) => { calls.showScreen.push(id); },
      () => { calls.showLoserWaitScreen++; },
      runCountdownImpl,
      () => {}, () => {}, () => {}, () => {},
      () => false
    );
    return { mod, calls, state };
  }

  function baseState(overrides = {}) {
    return {
      role: 'host', roomCode: 'GEN-ROOM', gameRound: 1, round: 1, penalty: '',
      status: 'playing', participants: [], confirmedSafeIds: [], confirmedLoserIds: [],
      ...overrides,
    };
  }

  it('정상 경로: 세대가 그대로 유지되면 runCountdown 반환 후 정상적으로 screenGame으로 전환된다', async () => {
    const state = baseState();
    const { mod, calls } = buildEnv({ state });
    await mod.runCountdownThenShowGame();
    expect(calls.showScreen).toContain('screenGame');
    expect(calls.qaMetrics.some(m => m.payload?.eventType === 'COUNTDOWN_GENERATION_STARTED')).toBe(true);
    expect(calls.qaMetrics.some(m => m.payload?.eventType === 'COUNTDOWN_STALE_GENERATION_ABORTED')).toBe(false);
  });

  it('CEO 계약 검증(checkpoint 5): runCountdown 실행 중 더 최신 세대가 끼어들면(예: host 강제 시작이 새 라운드로 대체), 오래된 실행은 runCountdown()이 true를 반환해도 화면 전환/DB write를 커밋하지 못하고 COUNTDOWN_STALE_GENERATION_ABORTED를 남긴다', async () => {
    const state = baseState();
    const { mod, calls } = buildEnv({
      state,
      // runCountdown() 진행 도중(await 유예 시뮬레이션) 다른(더 최신) 시도가 세대를 선점했다고 가정 —
      // 실제로는 host 강제 시작/중복 realtime 에코가 이 시점에 새 runCountdownThenShowGame()을 호출해
      // 세대를 bump하는 것과 동등하다.
      runCountdownImpl: async () => {
        state.countdownGeneration = (state.countdownGeneration || 0) + 1; // 다른 실행이 선점
        return true;
      },
    });
    await mod.runCountdownThenShowGame();
    // 오래된 실행은 checkpoint 5에서 stale로 걸려 화면 전환/DB write를 커밋하지 않는다.
    expect(calls.showScreen).not.toContain('screenGame');
    expect(calls.dbUpdate.length).toBe(0);
    expect(calls.qaMetrics.some(m =>
      m.payload?.eventType === 'COUNTDOWN_STALE_GENERATION_ABORTED' &&
      m.payload?.checkpoint === 'runCountdownReturned'
    )).toBe(true);
  });

  it('CEO 계약 검증(state.status 이탈): runCountdown 실행 중 status가 playing을 벗어나면(예: 다른 화면으로 전이) 역시 stale로 판정되어 커밋하지 않는다', async () => {
    const state = baseState();
    const { mod, calls } = buildEnv({
      state,
      runCountdownImpl: async () => { state.status = 'result'; return true; },
    });
    await mod.runCountdownThenShowGame();
    expect(calls.showScreen).not.toContain('screenGame');
    expect(calls.qaMetrics.some(m => m.payload?.eventType === 'COUNTDOWN_STALE_GENERATION_ABORTED')).toBe(true);
  });

  it('진짜 중복 호출(동일 라운드에 이미 실행 중인 coroutine)은 세대를 새로 발급하지 않고 COUNTDOWN_COROUTINE_DUPLICATE_BLOCKED로 즉시 막는다', async () => {
    const state = baseState();
    let resolveFirst;
    const firstRunCountdown = () => new Promise((resolve) => { resolveFirst = resolve; });
    const { mod, calls } = buildEnv({ state, runCountdownImpl: firstRunCountdown });

    // 첫 실행은 runCountdown()이 아직 resolve되지 않아 in-flight 상태로 남아 있다.
    const firstCall = mod.runCountdownThenShowGame();
    // 같은 라운드(roomCode:gameNo:round 동일)에 대한 두 번째 호출 — 진짜 중복(재시도 버튼 연타/
    // realtime 에코 등)을 재현한다.
    await mod.runCountdownThenShowGame();
    expect(calls.qaMetrics.some(m => m.payload?.eventType === 'COUNTDOWN_COROUTINE_DUPLICATE_BLOCKED')).toBe(true);
    // 세대가 중복 호출로 인해 추가로 발급되지 않았다(정확히 1번만 COUNTDOWN_GENERATION_STARTED).
    expect(calls.qaMetrics.filter(m => m.payload?.eventType === 'COUNTDOWN_GENERATION_STARTED').length).toBe(1);

    resolveFirst(true);
    await firstCall;
    expect(calls.showScreen).toContain('screenGame'); // 첫 실행은 정상적으로 완료된다
  });

  it('다른 라운드에 대한 호출은 막지 않는다(진짜 새 시도 — 예: host 강제 시작이 정체된 이전 실행을 대체)', async () => {
    const state = baseState({ round: 1 });
    let resolveFirst;
    let invocationCount = 0;
    // 1번째 호출(round1)만 pending 상태로 남겨 "아직 진행 중"을 재현하고, 2번째 호출(round2, 다른
    // entryKey — 중복 차단 대상이 아니므로 실제로 runCountdown까지 도달한다)은 즉시 완료시킨다.
    const runCountdownImpl = () => {
      invocationCount++;
      if (invocationCount === 1) return new Promise((resolve) => { resolveFirst = resolve; });
      return Promise.resolve(true);
    };
    const { mod, calls } = buildEnv({ state, runCountdownImpl });

    const firstCall = mod.runCountdownThenShowGame();
    state.round = 2; // 새 라운드로 진행 — entryKey가 달라진다.
    await mod.runCountdownThenShowGame();
    // 다른 라운드이므로 중복으로 막히지 않고 새 세대가 발급된다.
    expect(calls.qaMetrics.filter(m => m.payload?.eventType === 'COUNTDOWN_GENERATION_STARTED').length).toBe(2);
    expect(calls.qaMetrics.some(m => m.payload?.eventType === 'COUNTDOWN_COROUTINE_DUPLICATE_BLOCKED')).toBe(false);

    resolveFirst(true);
    await firstCall; // 이제 첫 실행이 재개되면 checkpoint 5에서 stale로 걸려야 한다(더 최신 세대가 이미 발급됨).
    expect(calls.qaMetrics.some(m =>
      m.payload?.eventType === 'COUNTDOWN_STALE_GENERATION_ABORTED' && m.payload?.checkpoint === 'runCountdownReturned'
    )).toBe(true);
  });

  it('mutation 확인: checkpoint 5(runCountdown 반환 후) 검사를 제거하면(옛 결함 재현) stale 세대도 화면 전환을 커밋해버린다', async () => {
    const brokenSrc = RUNCOUNTDOWN_BLOCK_SRC.replace(
      `      if (!isCountdownGenerationCurrent(myGen, "runCountdownReturned")) {
        state.gameStarting = false;
        releaseActiveKey();
        return;
      }
`,
      ''
    );
    expect(brokenSrc).not.toBe(RUNCOUNTDOWN_BLOCK_SRC); // 치환이 실제로 일어났는지 확인
    const state = baseState();
    const els = {};
    const $ = (id) => { if (!els[id]) els[id] = { textContent: '', className: '', style: {} }; return els[id]; };
    const calls = { showScreen: [] };
    const factory = new Function(
      'state', '$', 'serverNow', 'toPositiveInt', 'clampLoserCount', 't', 'db', 'QA',
      'getOnlineMode', 'isCurrentRoundParticipant', 'isSafeParticipant', 'isConfirmedLoser',
      'showScreen', 'showLoserWaitScreen', 'runCountdown', 'stopRoundTimers', 'autoFillChoices',
      'updateSelectedCount', 'updateHostSelectedCount', 'isScreenActive',
      PENALTY_BLOCK_SRC + '\n' + CHOICE_END_AT_BLOCK_SRC + '\n' + GENERATION_HELPER_BLOCK_SRC + '\n' + brokenSrc + '\n' + TIMER_BLOCK_SRC +
      '\nreturn { runCountdownThenShowGame };'
    );
    const mod = factory(
      state, $, () => Date.now(),
      toPositiveInt, (v) => Math.max(1, parseInt(v, 10) || 1), (key) => key,
      { from: () => ({ update: () => ({ eq: () => Promise.resolve({ error: null }) }) }) },
      { emit: () => {} },
      () => true, () => true, () => false, () => false,
      (id) => { calls.showScreen.push(id); },
      () => {},
      async () => { state.countdownGeneration = (state.countdownGeneration || 0) + 1; return true; },
      () => {}, () => {}, () => {}, () => {},
      () => false
    );
    await mod.runCountdownThenShowGame();
    expect(calls.showScreen).toContain('screenGame'); // 옛 결함 재현: stale인데도 커밋됨(RED)
  });
});

// ── Part C: getPlayingEntryKey — countdownStartAt 제거 ──────────────────────
describe('Build30-R2 Phase2(WRPS-078) Part C — getPlayingEntryKey는 countdownStartAt에 의존하지 않는다', () => {
  const SRC = extractBlock('function getPlayingEntryKey() {', 'async function enterPlayingStateFromRoomUpdate()');

  function buildKeyFn(state) {
    const factory = new Function('state', 'getGameRound', SRC + '\nreturn getPlayingEntryKey;');
    return factory(state, () => Math.max(1, state.gameRound || 1));
  }

  it('키는 roomCode:gameNo:round:playing 형식이고 countdownStartAt을 포함하지 않는다', () => {
    const state = { roomCode: 'ROOMK', gameRound: 3, round: 2, countdownStartAt: 555000 };
    const key = buildKeyFn(state)();
    expect(key).toBe('ROOMK:3:2:playing');
    expect(key).not.toContain('555000');
  });

  it('회귀 방지: countdownStartAt이 republish로 바뀌어도(같은 라운드) 키는 그대로다', () => {
    const state = { roomCode: 'ROOMK', gameRound: 3, round: 2, countdownStartAt: 555000 };
    const keyFn = buildKeyFn(state);
    const before = keyFn();
    state.countdownStartAt = 999999; // Build22 republish 자가복구 시나리오
    const after = keyFn();
    expect(before).toBe(after);
  });

  it('실제 새 라운드/새 게임/room 이동은 키가 달라진다', () => {
    const state = { roomCode: 'ROOMK', gameRound: 3, round: 2, countdownStartAt: 0 };
    const keyFn = buildKeyFn(state);
    const base = keyFn();
    state.round = 3;
    expect(keyFn()).not.toBe(base);
    state.round = 2; state.gameRound = 4;
    expect(keyFn()).not.toBe(base);
    state.gameRound = 3; state.roomCode = 'OTHERROOM';
    expect(keyFn()).not.toBe(base);
  });
});

// ── Part D: playVoiceClip eventId ───────────────────────────────────────────
describe('Build30-R2 Phase2(WRPS-078) Part D — playVoiceClip eventId(roomCode:gameNo:round:audioKey)', () => {
  const SRC = extractBlock('function playVoiceClip(eventKey) {', 'function unlockVoiceAudio()');

  function buildFn(state) {
    const calls = { playVoice: [] };
    const SoundManager = { playVoice: (eventKey, opts) => { calls.playVoice.push({ eventKey, opts }); } };
    const factory = new Function('state', 'getGameRound', 'SoundManager', SRC + '\nreturn playVoiceClip;');
    const playVoiceClip = factory(state, () => Math.max(1, state.gameRound || 1), SoundManager);
    return { playVoiceClip, calls };
  }

  it('eventId는 roomCode:gameNo:round:audioKey이고 state.playingEntryKey와 무관하다', () => {
    const state = { roomCode: 'ROOMV', gameRound: 5, round: 2, playingEntryKey: 'STALE:LEFTOVER:KEY' };
    const { playVoiceClip, calls } = buildFn(state);
    playVoiceClip('ready');
    expect(calls.playVoice[0].opts.eventId).toBe('ROOMV:5:2:ready');
    expect(calls.playVoice[0].opts.eventId).not.toContain('STALE');
  });

  it('playingEntryKey가 전혀 없어도(gameOver/retry처럼 countdown 흐름 밖) eventId는 항상 정의된다', () => {
    const state = { roomCode: 'ROOMV2', gameRound: 1, round: 1 };
    const { playVoiceClip, calls } = buildFn(state);
    playVoiceClip('gameOver');
    expect(calls.playVoice[0].opts.eventId).toBe('ROOMV2:1:1:gameOver');
  });

  it('offline(roomCode 없음)에서도 eventId가 안정적으로 생성된다', () => {
    const state = { roomCode: '', gameRound: 1, round: 1 };
    const { playVoiceClip, calls } = buildFn(state);
    playVoiceClip('countdownRps');
    expect(calls.playVoice[0].opts.eventId).toBe('offline:1:1:countdownRps');
  });
});

// ── Part D': AbortError vs asset-missing ────────────────────────────────────
describe('Build30-R2 Phase2(WRPS-078) Part D — AUDIO_ABORTED(AbortError는 asset-missing과 구분된다)', () => {
  it('el.play()가 AbortError로 reject하면 audioMissing:false + audioAborted:true + AUDIO_ABORTED metric', () => {
    expect(html).toMatch(/const isAbort = e && e\.name === 'AbortError';[\s\S]{0,300}audioMissing: !isAbort, audioAborted: isAbort/);
    expect(html).toContain("eventType: 'AUDIO_ABORTED'");
    // qa-analyze.mjs가 참조하는 audioMissing 필드명 자체는 그대로 유지된다(개명 금지).
    expect(html).toMatch(/audioMissing,/);
  });

  it('AUDIO_DUPLICATE_BLOCKED는 기존 audioDuplicated 관측을 재사용한다(새 필드 발명 없음)', () => {
    expect(html).toMatch(/audioDuplicated: true \}\); \} catch \(e\) \{\}[\s\S]{0,300}eventType: 'AUDIO_DUPLICATE_BLOCKED'[\s\S]{0,60}audioDuplicated: true/);
  });
});

// ── Part E: resultValue — 임의 win/lose/draw 생성 금지 + 렌더 게이트 ─────────
describe('Build30-R2 Phase2(WRPS-078) Part E — resultValue 렌더 게이트(CEO 강화)', () => {
  const RENDER_ROUND_RESULT_SRC = extractBlock(
    'function renderRoundResult(caseType, roundLoserCount, remainingSlots) {',
    'async function autoStartDrawRematch() {'
  );

  // Build30-RC2 Phase2(WRPS-078) [HIGH-fix 재검증]: classList를 실제 Set 기반으로 추적해야
  // "title에 win/lose/draw 톤 클래스가 실제로 add되었는가", "penaltyBox의 hidden 클래스가 실제로
  // remove(노출)되었는가"를 no-op 없이 검증할 수 있다(이전 no-op mock으로는 이 회귀를 못 잡는다).
  function mockEl() {
    const classes = new Set();
    const el = {
      textContent: '', className: '', innerHTML: '', style: {}, disabled: false,
      // participant 목록(roundResultList) 검증(Part F)을 위해 appendChild가 자식의 innerHTML을
      // 실제로 누적하도록 최소 구현한다(이전 no-op로는 목록 렌더 결과를 관측할 수 없었다).
      appendChild(child) { el.innerHTML += (child && child.innerHTML) || ''; },
      classList: {
        add: (...cls) => cls.forEach(c => classes.add(c)),
        remove: (...cls) => cls.forEach(c => classes.delete(c)),
        contains: (c) => classes.has(c),
        toggle(c, v) {
          if (v === undefined) { classes.has(c) ? classes.delete(c) : classes.add(c); }
          else if (v) classes.add(c); else classes.delete(c);
        },
        _classes: classes,
      },
    };
    return el;
  }

  // parseRoundChoice의 result 접미사(choice|result|auto) 파싱을 최소 재현한 스텁 —
  // getChoiceResult(choice)가 신선한 이유(publishHostRoundResult가 result 전이 전에 choice 인코딩을
  // 먼저 커밋)를 실제로 검증하려면 이 인코딩 규칙을 따라야 한다.
  const getChoiceResult = (choice) => {
    const parts = String(choice || '').split('|');
    if (parts.includes('win')) return 'win';
    if (parts.includes('lose')) return 'lose';
    if (parts.includes('draw')) return 'draw';
    return '';
  };

  function runRenderRoundResult({ caseType, roundLoserCount = 0, remainingSlots = 0, state, src = RENDER_ROUND_RESULT_SRC }) {
    const els = {};
    const $ = (id) => { if (!els[id]) els[id] = mockEl(); return els[id]; };
    const t = (key) => key;
    const getChoiceBase = () => '';
    const isAutoChoice = () => false;
    const escapeHtml = (s) => s;
    const getTargetLoserCount = () => state.targetLoserCount || 1;
    const getActivePlayers = () => [];
    const calls = { qaMetrics: [] };
    const QA = { emit: (kind, payload) => { calls.qaMetrics.push({ kind, payload }); } };
    const canShowPlayAgainButton = () => true;
    const startGameOverCountdown = () => {};
    const renderRoundProgressCards = () => {};
    const updateActionGridLayouts = () => {};
    const setGuideText = () => {};
    const getPenaltyText = () => '';
    const documentStub = { createElement: () => ({ className: '', innerHTML: '' }) };
    const ROUND_CHOICES = ['scissors', 'rock', 'paper'];
    const currentLocale = 'ko';
    const getGameRound = () => Math.max(1, state.gameRound || 1);
    const factory = new Function(
      'state', '$', 't', 'getChoiceResult', 'getChoiceBase', 'isAutoChoice', 'escapeHtml',
      'getTargetLoserCount', 'getActivePlayers', 'QA', 'canShowPlayAgainButton', 'startGameOverCountdown',
      'renderRoundProgressCards', 'updateActionGridLayouts', 'setGuideText', 'getPenaltyText', 'document', 'ROUND_CHOICES', 'currentLocale',
      'getGameRound',
      src + '\n; return renderRoundResult;'
    );
    const renderRoundResult = factory(
      state, $, t, getChoiceResult, getChoiceBase, isAutoChoice, escapeHtml,
      getTargetLoserCount, getActivePlayers, QA, canShowPlayAgainButton, startGameOverCountdown,
      renderRoundProgressCards, updateActionGridLayouts, setGuideText, getPenaltyText, documentStub, ROUND_CHOICES, currentLocale,
      getGameRound
    );
    renderRoundResult(caseType, roundLoserCount, remainingSlots);
    return { els, calls };
  }

  function baseState(overrides = {}) {
    return {
      role: 'host', currentUserId: 'p1', targetLoserCount: 1, gameRound: 1, round: 1,
      confirmedSafeIds: [], confirmedLoserIds: [],
      participants: [{ id: 'p1', is_host: true, lastResult: null, choice: 'rock' }],
      ...overrides,
    };
  }

  it('lastResult가 있으면(정상 경로) 그대로 쓰고 RESULT_VALUE_FALLBACK_USED/UNRESOLVED 둘 다 남기지 않는다', () => {
    const state = baseState({ participants: [{ id: 'p1', is_host: true, lastResult: 'win', choice: 'rock' }] });
    const { calls } = runRenderRoundResult({ caseType: 'gameOver', state });
    expect(calls.qaMetrics.some(m => m.payload?.eventType === 'RESULT_VALUE_FALLBACK_USED')).toBe(false);
    expect(calls.qaMetrics.some(m => m.payload?.eventType === 'RESULT_VALUE_UNRESOLVED')).toBe(false);
  });

  it('lastResult가 없고 choice 인코딩(getChoiceResult)만 있으면 그 값을 신선한 소스로 쓰고 RESULT_VALUE_FALLBACK_USED(source: choiceEncoded)를 남긴다', () => {
    const state = baseState({ participants: [{ id: 'p1', is_host: true, lastResult: null, choice: 'rock|lose' }] });
    const { calls } = runRenderRoundResult({ caseType: 'tooMany', state });
    expect(calls.qaMetrics.some(m =>
      m.payload?.eventType === 'RESULT_VALUE_FALLBACK_USED' && m.payload?.source === 'choiceEncoded'
    )).toBe(true);
    expect(calls.qaMetrics.some(m => m.payload?.eventType === 'RESULT_VALUE_UNRESOLVED')).toBe(false);
  });

  it('CEO 강화 — 두 소스 모두 실패(극단 케이스: choice에 result 접미사가 없고 lastResult도 없음)하면 임의로 win/lose/draw를 만들지 않고 RESULT_VALUE_UNRESOLVED를 남긴다', () => {
    const state = baseState({ participants: [{ id: 'p1', is_host: true, lastResult: null, choice: 'rock' }] });
    const { calls } = runRenderRoundResult({ caseType: 'tooMany', state });
    expect(calls.qaMetrics.some(m => m.payload?.eventType === 'RESULT_VALUE_UNRESOLVED')).toBe(true);
    expect(calls.qaMetrics.some(m => m.payload?.eventType === 'RESULT_VALUE_FALLBACK_USED')).toBe(false);
  });

  it('자기 row가 스냅샷에서 아예 빠진 극단 케이스(participants가 다른 사람뿐)도 RESULT_VALUE_UNRESOLVED로 남기고 죽지 않는다(크래시 없음)', () => {
    const state = baseState({
      currentUserId: 'missing-user',
      participants: [{ id: 'other', is_host: true, lastResult: null, choice: 'rock' }],
    });
    expect(() => runRenderRoundResult({ caseType: 'tooFew', state })).not.toThrow();
  });

  it('mutation 확인: null 폴백을 "draw"로 되돌리면(옛 결함 재현) RESULT_VALUE_UNRESOLVED가 더 이상 찍히지 않는다(회귀 검출력 증명)', () => {
    const brokenSrc = RENDER_ROUND_RESULT_SRC.replace(
      'const myResult = lastResultValue || choiceEncodedValue || null;',
      'const myResult = lastResultValue || choiceEncodedValue || "draw";'
    );
    expect(brokenSrc).not.toBe(RENDER_ROUND_RESULT_SRC); // 치환이 실제로 일어났는지 확인
    const state = baseState({ participants: [{ id: 'p1', is_host: true, lastResult: null, choice: 'rock' }] });
    const { calls } = runRenderRoundResult({ caseType: 'tooMany', state, src: brokenSrc });
    // 옛 결함 재현: 두 소스 모두 실패했는데도 "draw"가 임의로 채워져 UNRESOLVED가 찍히지 않는다(RED).
    expect(calls.qaMetrics.some(m => m.payload?.eventType === 'RESULT_VALUE_UNRESOLVED')).toBe(false);
  });

  // ── Part F: CEO "확정 렌더 금지" — myResult null일 때 개인 승패 표시부 중립화 ──────
  // codex-critic 재검증 HIGH-fix: myResult가 최종 null인데도 tooMany else가 "안전!"(false win 톤),
  // tooFew else가 draw 톤을 렌더하던 회귀. gameOver도 동일 계열(false-safe "생존!")이라 함께 게이트.
  describe('Part F — myResult null 렌더 게이트 중립화(CEO 확정 렌더 금지, codex-critic HIGH-fix)', () => {
    function unresolvedState(caseTypeExtra = {}) {
      return baseState({
        // lastResult도 없고 choice에 result 접미사도 없어 두 소스 모두 실패 → myResult === null.
        participants: [{ id: 'p1', is_host: true, lastResult: null, choice: 'rock' }],
        ...caseTypeExtra,
      });
    }

    it('gameOver + myResult null(미확정 loser 아님) → false-safe "생존!"을 렌더하지 않고 중립 문구로 표시한다', () => {
      const { els } = runRenderRoundResult({ caseType: 'gameOver', state: unresolvedState() });
      expect(els.resultTitle.textContent).toBe('result.titleResolving');
      expect(els.resultCap.textContent).toBe('result.capResolving');
      expect(els.resultMessage.textContent).toBe('result.msgResolving');
      // false-safe였던 문구/톤이 남아있지 않아야 한다.
      expect(els.resultTitle.textContent).not.toBe('result.titleSurvived');
      expect(els.resultTitle.classList.contains('win')).toBe(false);
      expect(els.resultTitle.classList.contains('lose')).toBe(false);
      expect(els.resultTitle.classList.contains('draw')).toBe(false);
    });

    it('gameOver + myResult null → penaltyBox(벌칙)와 개인결과 기반 CTA(다음 호스트 버튼)를 노출하지 않는다', () => {
      const { els } = runRenderRoundResult({ caseType: 'gameOver', state: unresolvedState() });
      expect(els.resultPenaltyBox.classList.contains('hidden')).toBe(true);
      expect(els.finalResultBtns.innerHTML).not.toMatch(/becomeNextHostBtn/);
    });

    it('tooMany + myResult null → 옛 결함(false win "안전!" 렌더)을 재현하지 않고 중립 문구로 표시한다', () => {
      const { els } = runRenderRoundResult({ caseType: 'tooMany', state: unresolvedState() });
      expect(els.resultTitle.textContent).toBe('result.titleResolving');
      expect(els.resultTitle.textContent).not.toBe('result.titleSafeNow');
      expect(els.resultTitle.classList.contains('win')).toBe(false);
      expect(els.resultTitle.classList.contains('lose')).toBe(false);
    });

    it('tooFew + myResult null → CEO 명시 금지(draw 톤 재사용)를 위반하지 않고 중립 문구로 표시한다(capDraw 재사용 금지)', () => {
      const { els } = runRenderRoundResult({ caseType: 'tooFew', state: unresolvedState() });
      expect(els.resultTitle.textContent).toBe('result.titleResolving');
      expect(els.resultCap.textContent).toBe('result.capResolving');
      expect(els.resultCap.textContent).not.toBe('result.capDraw');
      expect(els.resultTitle.textContent).not.toBe('result.titleDraw');
      expect(els.resultTitle.classList.contains('draw')).toBe(false);
      expect(els.resultPenaltyBox.classList.contains('hidden')).toBe(true);
    });

    it('참가자 목록/caseType outcome은 myResult와 독립 — 중립화되어도 confirmedLoserIds 태그는 그대로 렌더된다', () => {
      const state = unresolvedState({
        confirmedLoserIds: ['other'],
        participants: [
          { id: 'p1', is_host: true, lastResult: null, choice: 'rock' },
          { id: 'other', is_host: false, lastResult: 'lose', choice: 'rock' },
        ],
      });
      const { els } = runRenderRoundResult({ caseType: 'gameOver', state });
      // "나"의 표시부는 중립화되지만, 목록의 다른 참가자 태그(loser 확정)는 그대로 렌더된다.
      expect(els.roundResultList.innerHTML).toMatch(/tag\.loserConfirmed/);
    });

    // ── 정상 케이스(myResult 있음) 무회귀 확인 ──────────────────────────────
    it('정상 케이스 무회귀 — gameOver + myResult=win(안전 확정)은 여전히 titleSurvived/win 톤으로 렌더된다', () => {
      const state = baseState({ participants: [{ id: 'p1', is_host: true, lastResult: 'win', choice: 'rock' }] });
      const { els } = runRenderRoundResult({ caseType: 'gameOver', state });
      expect(els.resultTitle.textContent).toBe('result.titleSurvived');
      expect(els.resultTitle.classList.contains('win')).toBe(true);
      expect(els.resultTitle.textContent).not.toBe('result.titleResolving');
    });

    it('정상 케이스 무회귀 — gameOver + myResult=lose(패배 확정)은 여전히 titleLoserConfirmedCount/lose 톤 + penaltyBox 노출로 렌더된다', () => {
      const state = baseState({ participants: [{ id: 'p1', is_host: true, lastResult: 'lose', choice: 'rock' }] });
      const { els } = runRenderRoundResult({ caseType: 'gameOver', state });
      expect(els.resultTitle.textContent).toBe('result.titleLoserConfirmedCount');
      expect(els.resultTitle.classList.contains('lose')).toBe(true);
      expect(els.resultPenaltyBox.classList.contains('hidden')).toBe(false);
    });

    it('정상 케이스 무회귀 — tooMany + myResult=lose/win 각각 기존 문구/톤 그대로', () => {
      const loseState = baseState({ participants: [{ id: 'p1', is_host: true, lastResult: 'lose', choice: 'rock' }] });
      const { els: loseEls } = runRenderRoundResult({ caseType: 'tooMany', state: loseState });
      expect(loseEls.resultTitle.textContent).toBe('result.titleLose');
      expect(loseEls.resultTitle.classList.contains('lose')).toBe(true);

      const winState = baseState({ participants: [{ id: 'p1', is_host: true, lastResult: 'win', choice: 'rock' }] });
      const { els: winEls } = runRenderRoundResult({ caseType: 'tooMany', state: winState });
      expect(winEls.resultTitle.textContent).toBe('result.titleSafeNow');
      expect(winEls.resultTitle.classList.contains('win')).toBe(true);
    });

    it('정상 케이스 무회귀 — tooFew + myResult=draw(무승부, 확정 아님)는 여전히 titleDraw/draw 톤 그대로 렌더된다(capDraw 정당 사용)', () => {
      const state = baseState({ participants: [{ id: 'p1', is_host: true, lastResult: null, choice: 'rock|draw' }] });
      const { els } = runRenderRoundResult({ caseType: 'tooFew', state });
      expect(els.resultTitle.textContent).toBe('result.titleDraw');
      expect(els.resultCap.textContent).toBe('result.capDraw');
      expect(els.resultTitle.classList.contains('draw')).toBe(true);
    });

    // ── mutation 검증: 중립화 게이트를 제거하면 옛 결함이 재현되어 RED가 되어야 한다 ──────
    it('mutation 확인(gameOver): isResultUnresolved 게이트를 제거하면 false-safe "생존!" 렌더가 되돌아온다(RED로 회귀 검출력 증명)', () => {
      const brokenSrc = RENDER_ROUND_RESULT_SRC.replace(
        'if (isResultUnresolved) {\n          renderPersonalResolving();\n        } else if (myResult === "lose" || iAmConfirmedLoser) {',
        'if (myResult === "lose" || iAmConfirmedLoser) {'
      );
      expect(brokenSrc).not.toBe(RENDER_ROUND_RESULT_SRC);
      const { els } = runRenderRoundResult({ caseType: 'gameOver', state: unresolvedState(), src: brokenSrc });
      // 게이트가 제거되면 옛 결함이 재현되어 중립 문구 대신 false-safe "생존!"이 다시 렌더된다.
      expect(els.resultTitle.textContent).toBe('result.titleSurvived');
    });

    it('mutation 확인(tooMany): isResultUnresolved 게이트를 제거하면 false-safe "안전!" 렌더가 되돌아온다(RED로 회귀 검출력 증명)', () => {
      const brokenSrc = RENDER_ROUND_RESULT_SRC.replace(
        'if (isResultUnresolved) {\n          renderPersonalResolving();\n        } else if (myResult === "lose") {',
        'if (myResult === "lose") {'
      );
      expect(brokenSrc).not.toBe(RENDER_ROUND_RESULT_SRC);
      const { els } = runRenderRoundResult({ caseType: 'tooMany', state: unresolvedState(), src: brokenSrc });
      expect(els.resultTitle.textContent).toBe('result.titleSafeNow');
    });

    it('mutation 확인(tooFew): isResultUnresolved 게이트를 제거하면 draw 톤 오인 렌더가 되돌아온다(RED로 회귀 검출력 증명)', () => {
      const brokenSrc = RENDER_ROUND_RESULT_SRC.replace(
        'if (isResultUnresolved) {\n          renderPersonalResolving();\n        } else if (iAmConfirmedLoser && myResult === "lose") {',
        'if (iAmConfirmedLoser && myResult === "lose") {'
      );
      expect(brokenSrc).not.toBe(RENDER_ROUND_RESULT_SRC);
      const { els } = runRenderRoundResult({ caseType: 'tooFew', state: unresolvedState(), src: brokenSrc });
      expect(els.resultTitle.textContent).toBe('result.titleDraw');
      expect(els.resultCap.textContent).toBe('result.capDraw');
    });
  });
});

// ── Part G: runCountdown 내부 checkpoint 1~4 강제(MEDIUM-1, codex-critic mutation 발견) ──────
// codex-critic 재검증: checkpoint 1~4(waitForValidCountdownStart/leadSleep/readyVoiceSleep/
// rpsVoiceSleep) 중 어느 것도 어느 테스트로도 강제되지 않았다(checkpoint 3 제거 mutation이 GREEN
// 생존). 이 Part는 실제 runCountdown() 소스를 new Function으로 추출·실행해, 각 checkpoint가 해당
// side effect(DB write/오디오 재생/오버레이 닫기) 직전에 실제로 존재하고, stale 세대일 때 그 side
// effect가 실행되지 않음을 검증한다. checkpoint 1~5는 checkpoint 5(runCountdownReturned)만 Part B에서
// 이미 강제되어 있었다 — 여기서는 나머지 4곳(runCountdown 내부)을 보강한다.
describe('Build30-R2 Phase2(WRPS-078) Part G — runCountdown checkpoint 1~4(CEO "최소 4곳" 계약 강제)', () => {
  const RUN_COUNTDOWN_SRC = extractBlock(
    'function isCountdownGenerationCurrent(myGen, checkpoint) {',
    'function startHostJudgeBackstop() {'
  );

  function buildRunCountdown({
    state,
    sleepImpl = async () => {},
    waitForValidCountdownStartImpl = async () => 0,
    republishCountdownStartAsHostImpl = async () => 0,
    playVoiceClipImpl = async () => {},
    getCountdownStartAtImpl = () => 0,
    getOnlineModeImpl = () => true,
    serverNowImpl = () => 0,
    src = RUN_COUNTDOWN_SRC,
  }) {
    const overlayCalls = [];
    const els = {
      countdownOverlay: {
        classList: {
          add: (c) => overlayCalls.push(['add', c]),
          remove: (c) => overlayCalls.push(['remove', c]),
        },
      },
      countdownNumber: { className: '', style: {}, textContent: '', innerHTML: '', offsetWidth: 0 },
      countdownLabel: { textContent: '' },
    };
    const $ = (id) => els[id];
    const calls = { qaMetrics: [], showCountdownSyncError: 0, runCountdownThenShowGame: 0, playVoiceClip: [], republish: 0 };
    const QA = { emit: (kind, payload) => calls.qaMetrics.push({ kind, payload }) };
    const SoundManager = { unlock() {} };
    const t = (key) => key;
    const currentLocale = 'ko';
    const getGameRound = () => Math.max(1, state.gameRound || 1);
    const showCountdownSyncError = () => { calls.showCountdownSyncError++; };
    const runCountdownThenShowGame = async () => { calls.runCountdownThenShowGame++; };
    const serverClockOffsetMs = 0;
    const republishCountdownStartAsHost = async (...args) => { calls.republish++; return republishCountdownStartAsHostImpl(...args); };
    const playVoiceClip = async (key) => { calls.playVoiceClip.push(key); return playVoiceClipImpl(key); };
    const factory = new Function(
      'QA', 'state', 'getGameRound', 'SoundManager', '$', 'getCountdownStartAt', 'getOnlineMode',
      'waitForValidCountdownStart', 'republishCountdownStartAsHost', 'showCountdownSyncError',
      'runCountdownThenShowGame', 'serverNow', 'serverClockOffsetMs', 'sleep', 't', 'currentLocale',
      'playVoiceClip',
      src + '\n; return runCountdown;'
    );
    const runCountdown = factory(
      QA, state, getGameRound, SoundManager, $, getCountdownStartAtImpl, getOnlineModeImpl,
      waitForValidCountdownStartImpl, republishCountdownStartAsHost, showCountdownSyncError,
      runCountdownThenShowGame, serverNowImpl, serverClockOffsetMs, sleepImpl, t, currentLocale,
      playVoiceClip
    );
    return { runCountdown, els, calls, overlayCalls };
  }

  function baseCountdownState(overrides = {}) {
    return { role: 'host', round: 1, gameRound: 1, countdownGeneration: 7, status: 'playing', roomCode: 'ABCD', ...overrides };
  }

  it('checkpoint 1(waitForValidCountdownStart) — 반환 직후 세대가 stale이면 republish/화면전환(DB write·screen transition)을 커밋하지 않고 false를 반환한다', async () => {
    const state = baseCountdownState();
    const myGen = state.countdownGeneration;
    const { runCountdown, calls } = buildRunCountdown({
      state,
      getCountdownStartAtImpl: () => 0, // scheduledStartAt 없음 → waitForValidCountdownStart 경로 진입
      getOnlineModeImpl: () => true,
      // 실제로는 이 await 도중 더 최신 세대가 끼어드는 상황(host 강제 시작 등)을 재현 —
      // 이 async 함수가 resolve되는 시점에 세대가 바뀐다.
      waitForValidCountdownStartImpl: async () => { state.countdownGeneration = myGen + 1; return 0; },
    });
    const result = await runCountdown(myGen);
    expect(result).toBe(false);
    expect(calls.republish).toBe(0);
    expect(calls.showCountdownSyncError).toBe(0);
    expect(calls.qaMetrics.some(m => m.payload?.eventType === 'COUNTDOWN_STALE_GENERATION_ABORTED' && m.payload?.checkpoint === 'waitForValidCountdownStart')).toBe(true);
  });

  it('checkpoint 2(leadSleep) — lead sleep 반환 직후 세대가 stale이면 이어지는 "ready" 음성 재생을 요청하지 않고 false를 반환한다', async () => {
    const state = baseCountdownState();
    const myGen = state.countdownGeneration;
    const { runCountdown, calls } = buildRunCountdown({
      state,
      getCountdownStartAtImpl: () => 100000, // waitMs > 40 강제(leadSleep 진입)
      serverNowImpl: () => 0,
      sleepImpl: async () => { state.countdownGeneration = myGen + 1; }, // leadSleep 도중 세대 선점
    });
    const result = await runCountdown(myGen);
    expect(result).toBe(false);
    expect(calls.playVoiceClip).not.toContain('ready');
    expect(calls.qaMetrics.some(m => m.payload?.eventType === 'COUNTDOWN_STALE_GENERATION_ABORTED' && m.payload?.checkpoint === 'leadSleep')).toBe(true);
  });

  it('checkpoint 3(readyVoiceSleep) — ready 음성 sleep 반환 직후 세대가 stale이면 이어지는 "countdownRps" 음성 재생을 요청하지 않고 false를 반환한다', async () => {
    const state = baseCountdownState();
    const myGen = state.countdownGeneration;
    const { runCountdown, calls } = buildRunCountdown({
      state,
      getCountdownStartAtImpl: () => 0,
      getOnlineModeImpl: () => false, // checkpoint1 경로 회피(waitMs=0으로 leadSleep도 스킵)
      sleepImpl: async () => { state.countdownGeneration = myGen + 1; }, // 첫 sleep(=readyVoiceSleep) 도중 선점
    });
    const result = await runCountdown(myGen);
    expect(result).toBe(false);
    expect(calls.playVoiceClip).toEqual(['ready']); // ready는 이미 재생 요청됐지만 countdownRps는 막힘
    expect(calls.qaMetrics.some(m => m.payload?.eventType === 'COUNTDOWN_STALE_GENERATION_ABORTED' && m.payload?.checkpoint === 'readyVoiceSleep')).toBe(true);
  });

  it('checkpoint 4(rpsVoiceSleep) — countdownRps 음성 sleep 반환 직후 세대가 stale이면 오버레이를 닫지(완료 처리) 않고 false를 반환한다', async () => {
    const state = baseCountdownState();
    const myGen = state.countdownGeneration;
    let sleepCallCount = 0;
    const { runCountdown, calls, overlayCalls } = buildRunCountdown({
      state,
      getCountdownStartAtImpl: () => 0,
      getOnlineModeImpl: () => false,
      sleepImpl: async () => {
        sleepCallCount++;
        if (sleepCallCount === 2) state.countdownGeneration = myGen + 1; // 2번째 sleep(rpsVoiceSleep) 도중 선점
      },
    });
    const result = await runCountdown(myGen);
    expect(result).toBe(false);
    expect(calls.playVoiceClip).toEqual(['ready', 'countdownRps']); // 둘 다 이미 재생 요청된 뒤 완료 처리만 막힘
    expect(overlayCalls).not.toContainEqual(['add', 'hidden']); // "카운트다운 완료 처리"(오버레이 닫기)가 커밋되지 않음
    expect(calls.qaMetrics.some(m => m.payload?.eventType === 'COUNTDOWN_STALE_GENERATION_ABORTED' && m.payload?.checkpoint === 'rpsVoiceSleep')).toBe(true);
  });

  it('정상 경로 무회귀 — 세대가 계속 최신이면 checkpoint 1~4 모두 통과하고 true를 반환하며 오버레이가 닫힌다', async () => {
    const state = baseCountdownState();
    const myGen = state.countdownGeneration;
    const { runCountdown, calls, overlayCalls } = buildRunCountdown({
      state,
      getCountdownStartAtImpl: () => 0,
      getOnlineModeImpl: () => false,
      sleepImpl: async () => {}, // 세대 불변
    });
    const result = await runCountdown(myGen);
    expect(result).toBe(true);
    expect(calls.playVoiceClip).toEqual(['ready', 'countdownRps']);
    expect(overlayCalls).toContainEqual(['add', 'hidden']);
  });

  // ── mutation 확인: checkpoint 1~4 각각을 제거하면 옛 결함(stale 세대의 side effect 커밋)이
  // 재현되어 위 테스트들이 RED가 되어야 한다(CEO mutation 요구 — checkpoint 3 우선 확인) ──────
  it('mutation 확인(checkpoint 3): readyVoiceSleep 가드를 제거하면 stale 세대인데도 countdownRps 음성 재생이 커밋된다(RED로 회귀 검출력 증명)', async () => {
    const brokenSrc = RUN_COUNTDOWN_SRC.replace(
      'if (!isCountdownGenerationCurrent(myGen, "readyVoiceSleep")) return false;',
      ''
    );
    expect(brokenSrc).not.toBe(RUN_COUNTDOWN_SRC);
    const state = baseCountdownState();
    const myGen = state.countdownGeneration;
    const { runCountdown, calls } = buildRunCountdown({
      state,
      getCountdownStartAtImpl: () => 0,
      getOnlineModeImpl: () => false,
      sleepImpl: async () => { state.countdownGeneration = myGen + 1; },
      src: brokenSrc,
    });
    await runCountdown(myGen);
    // checkpoint 3 가드가 제거되면, 정상 경로라면 절대 재생되지 않아야 할 countdownRps 음성이
    // stale 세대인데도 재생 요청된다(옛 결함 재현) — checkpoint 4는 그대로 남아있어 최종 반환값은
    // 여전히 false일 수 있지만, 이 mutation이 노린 "checkpoint 3의 존재"는 이 audio 커밋 여부로
    // 직접 검증된다(원본 소스로는 이 assertion이 실패해야 GREEN).
    expect(calls.playVoiceClip).toContain('countdownRps');
  });

  it('mutation 확인(checkpoint 1): waitForValidCountdownStart 가드를 제거하면 stale 세대인데도 republish(DB write)가 커밋된다(RED로 회귀 검출력 증명)', async () => {
    const brokenSrc = RUN_COUNTDOWN_SRC.replace(
      'if (!isCountdownGenerationCurrent(myGen, "waitForValidCountdownStart")) return false;',
      ''
    );
    expect(brokenSrc).not.toBe(RUN_COUNTDOWN_SRC);
    const state = baseCountdownState();
    const myGen = state.countdownGeneration;
    const { runCountdown, calls } = buildRunCountdown({
      state,
      getCountdownStartAtImpl: () => 0,
      getOnlineModeImpl: () => true,
      waitForValidCountdownStartImpl: async () => { state.countdownGeneration = myGen + 1; return 0; },
      src: brokenSrc,
    });
    await runCountdown(myGen);
    expect(calls.republish).toBeGreaterThan(0);
  });

  it('mutation 확인(checkpoint 2): leadSleep 가드를 제거하면 stale 세대인데도 ready 음성 재생이 커밋된다(RED로 회귀 검출력 증명)', async () => {
    const brokenSrc = RUN_COUNTDOWN_SRC.replace(
      'if (!isCountdownGenerationCurrent(myGen, "leadSleep")) return false;',
      ''
    );
    expect(brokenSrc).not.toBe(RUN_COUNTDOWN_SRC);
    const state = baseCountdownState();
    const myGen = state.countdownGeneration;
    const { runCountdown, calls } = buildRunCountdown({
      state,
      getCountdownStartAtImpl: () => 100000,
      serverNowImpl: () => 0,
      sleepImpl: async () => { state.countdownGeneration = myGen + 1; },
      src: brokenSrc,
    });
    await runCountdown(myGen);
    expect(calls.playVoiceClip).toContain('ready');
  });

  it('mutation 확인(checkpoint 4): rpsVoiceSleep 가드를 제거하면 stale 세대인데도 오버레이가 닫힌다(완료 처리 커밋, RED로 회귀 검출력 증명)', async () => {
    const brokenSrc = RUN_COUNTDOWN_SRC.replace(
      'if (!isCountdownGenerationCurrent(myGen, "rpsVoiceSleep")) return false;',
      ''
    );
    expect(brokenSrc).not.toBe(RUN_COUNTDOWN_SRC);
    const state = baseCountdownState();
    const myGen = state.countdownGeneration;
    let sleepCallCount = 0;
    const { runCountdown, overlayCalls } = buildRunCountdown({
      state,
      getCountdownStartAtImpl: () => 0,
      getOnlineModeImpl: () => false,
      sleepImpl: async () => {
        sleepCallCount++;
        if (sleepCallCount === 2) state.countdownGeneration = myGen + 1;
      },
      src: brokenSrc,
    });
    await runCountdown(myGen);
    expect(overlayCalls).toContainEqual(['add', 'hidden']);
  });
});
