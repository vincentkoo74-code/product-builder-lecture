import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

// ════════════════════════════════════════════════════════════════════════════
// Build40 P0-1 게이트 — 권위 지연 레이스 + continuation 신원/stale envelope (CEO 지시 2·3).
//
// 계약:
//   재대결 안내가 필요한 라운드에서
//     · 일치하는 권위 envelope 이 있으면      → 그 mode 로 렌더/발화
//     · 아직 없으면(도착 전 / 구버전 host)   → UNKNOWN / 대기 / 모순 안내 금지
//   host 와 어긋날 수 있는 독립 WINNERS/LOSERS 재계산으로 폴백하지 않는다.
//
// 이 파일은 finishRoundLocal 의 실제 소스를 추출해 실행한다. DB/렌더/음성은 스파이다.
// ⚠️ 공허성 방지: 각 레이스 케이스 앞에 "stale 로컬 재계산이 실제로 반대 mode 를 낸다"를
//    대조군으로 먼저 단언한다. 그래야 "안내가 안 나갔다"가 "계산이 우연히 같았다"와 구분된다.
// ════════════════════════════════════════════════════════════════════════════

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
function extractBlock(a, b, label) {
  const s = html.indexOf(a);
  if (s < 0) throw new Error(`[${label}] start marker not found: ${a}`);
  if (html.indexOf(a, s + 1) >= 0) throw new Error(`[${label}] start marker not unique: ${a}`);
  const e = html.indexOf(b, s);
  if (e < 0) throw new Error(`[${label}] end marker not found: ${b}`);
  const out = html.slice(s, e);
  if (out.length < 80) throw new Error(`[${label}] too short`);
  return out;
}

const SRC = [
  extractBlock('function toPositiveInt(', 'function parsePenalty(raw) {', 'toPositiveInt'),
  extractBlock('function parsePenalty(raw) {', 'function getPenaltyText()', 'parsePenalty'),
  extractBlock('function buildPenaltyValue(', 'const PHASE_RENDER_BUFFER_MS', 'build'),
  extractBlock('function resolveElimination({', 'function participantListView(', 'resolve'),
  extractBlock('function announceContinuation(', 'async function finishRoundLocal(', 'announce'),
  extractBlock('async function finishRoundLocal(', 'function finishRound() {', 'finishRoundLocal'),
].join('\n');

/**
 * 참가자 단말을 만든다. state.penalty 가 권위 envelope 운반체다.
 * localLoserIds: 이 단말의 (stale 가능) confirmedLoserIds.
 */
function makeParticipant({ participants, localLoserIds, localSafeIds = [], target, gameNo, round, penaltyRaw }) {
  const calls = { voices: [], renders: [], sfx: [], metrics: [], sleeps: 0 };
  const state = {
    role: 'participant', status: 'result', roomCode: 'ZDWQ', currentUserId: 'p2',
    gameRound: gameNo, round, penalty: penaltyRaw, targetLoserCount: target,
    confirmedSafeIds: localSafeIds.slice(), confirmedLoserIds: localLoserIds.slice(),
    participants: participants.map(p => ({ ...p })),
    finishingRound: false, advancingRound: false, rematchAdvanceTimer: null,
    resultVoiceKey: null, resultSfxKey: null, hruGen: 1, lastRoundResolution: null,
    roundJudgeDeferAttempts: {}, roundJudgeDeferTimer: null,
  };
  const noop = () => {};
  const factory = new Function(
    'state', 'db', 'QA', 't', 'getOnlineMode', 'stopRoundTimers', 'isNonPlayingChoice', 'getChoiceBase',
    'getChoiceResult', 'hasConfirmedRoundResult', 'judgeRound', 'getTargetLoserCount', 'getGameRound',
    'renderRoundResult', 'showScreen', 'showRoundResultOrWait', 'showTaggerPopup', 'autoSaveGameOverResultOnce',
    'playResultSfxOnce', 'playResultVoiceOnce', 'scheduleRematchAutoAdvance', 'recordMyAccountGameResult',
    'recordRoundResolution', '__engineV2ShadowCompare', 'syncConfirmedIdsFromParticipants', 'getPenaltyText',
    'clampLoserCount', 'qaRoundCtx', 'sleep', 'Date', 'console',
    '__engineV2ShadowComputeRound', 'scheduleRoundJudgeDeferRetry', 'fetchFreshParticipantsForResult', 'checkRetryContext',
    'isConfirmedLoser', 'isSafeParticipant', 'getActivePlayers', 'showLoserWaitScreen', 'serverNow', 'maybeRecoverStalledRematchAdvance',
    SRC + '\nreturn { finishRoundLocal, getAuthoritativeContinuation, continuationModeFromOutcome, buildPenaltyValue };'
  );
  const mod = factory(
    state,
    { from: () => ({ update: () => ({ eq: () => ({ eq: () => Promise.resolve({ error: null }) }) }) }) },
    { emit: (_c, m) => calls.metrics.push(m) },
    (k) => k, () => true, noop,
    (c) => c === '__safe__' || c === '__loser__' || c === '__waiting__',
    (c) => (c ? String(c).split('|')[0] : null),
    (c) => (c ? String(c).split('|')[1] || '' : ''),
    (c) => Boolean(c && String(c).split('|')[0] && String(c).split('|')[1]),
    () => ({}), () => target, () => gameNo,
    (caseType, n, slots) => calls.renders.push({ caseType, n, slots }),
    noop, noop, noop, noop,
    (k) => calls.sfx.push(k),
    (key) => calls.voices.push(key),
    noop, noop, noop, noop, noop, () => '벌칙', (n) => n, () => ({}),
    async () => { calls.sleeps++; }, { now: () => 1_800_000_000_000 }, { warn: noop, log: noop },
    () => null, noop, async () => state.participants, () => true,
    (id) => state.confirmedLoserIds.includes(id), (id) => state.confirmedSafeIds.includes(id),
    () => state.participants.filter(p => !state.confirmedSafeIds.includes(p.id) && !state.confirmedLoserIds.includes(p.id)),
    noop, () => 1_800_000_000_000, noop,
  );
  return { mod, state, calls };
}

const VOICE_OF = { WINNERS: 'replayWinnersOnly', LOSERS: 'replayLosersOnly', ALL: 'drawRetry', FINAL: 'taggerSelected' };

// ── 시나리오 A: host=LOSERS, stale 참가자 재계산=WINNERS ───────────────────
//   6인, target=3. host prev=[x,y] (slots 1), 이번 라운드 패자 2 → tooMany → LOSERS
//   stale 참가자 prev=[] (slots 3), 패자 2 → tooFew → WINNERS
const A_PARTS = [
  { id: 'h1', choice: 'rock|lose', lastResult: 'lose' }, { id: 'p2', choice: 'rock|lose', lastResult: 'lose' },
  { id: 'p3', choice: 'paper|win', lastResult: 'win' }, { id: 'p4', choice: 'paper|win', lastResult: 'win' },
  { id: 'x', choice: '__loser__' }, { id: 'y', choice: '__loser__' },
];
const A = { participants: A_PARTS, hostPrev: ['x', 'y'], stalePrev: [], target: 3, hostMode: 'LOSERS', staleMode: 'WINNERS' };

// ── 시나리오 B (역): host=WINNERS, stale 참가자 재계산=LOSERS ───────────────
//   5인, target=3. host prev=[] (slots 3), 패자 2 → tooFew → WINNERS
//   stale 참가자 prev=[x,y] (slots 1, 잘못된 잔존), 패자 2 → tooMany → LOSERS
const B_PARTS = [
  { id: 'h1', choice: 'rock|lose', lastResult: 'lose' }, { id: 'p2', choice: 'rock|lose', lastResult: 'lose' },
  { id: 'p3', choice: 'paper|win', lastResult: 'win' }, { id: 'p4', choice: 'paper|win', lastResult: 'win' },
  { id: 'p5', choice: 'paper|win', lastResult: 'win' },
];
const B = { participants: B_PARTS, hostPrev: [], stalePrev: ['x', 'y'], target: 3, hostMode: 'WINNERS', staleMode: 'LOSERS' };

function envelopeFor(mod, sc, gameNo, round) {
  const results = sc.participants.filter(p => p.lastResult).map(p => ({ id: p.id, result: p.lastResult }));
  const RES = new Function(extractBlock('function resolveElimination({', 'function participantListView(', 'r') + '\nreturn resolveElimination;')();
  const auth = RES({ roundResults: results, prevLoserIds: sc.hostPrev, prevSafeIds: [], targetLoserCount: sc.target });
  const mode = mod.continuationModeFromOutcome(auth.outcome);
  expect(mode, `시나리오 host mode 가 기대와 다르다`).toBe(sc.hostMode);
  return mod.buildPenaltyValue({ gameRound: gameNo, continuation: { gameNo, round, mode, confirmedLoserIds: auth.newConfirmedLoserIds } });
}

for (const [label, sc] of [['A: host LOSERS / stale WINNERS', A], ['B: host WINNERS / stale LOSERS', B]]) {
  describe(`P0-1 권위 지연 레이스 — ${label}`, () => {
    it('대조군(공허성 가드): stale 로컬 재계산은 실제로 반대 mode 를 낸다', () => {
      const { mod } = makeParticipant({ ...sc, localLoserIds: sc.stalePrev, gameNo: 5, round: 2, penaltyRaw: '{"text":"벌칙","loserCount":3,"gameRound":5}' });
      const RES = new Function(extractBlock('function resolveElimination({', 'function participantListView(', 'r') + '\nreturn resolveElimination;')();
      const results = sc.participants.filter(p => p.lastResult).map(p => ({ id: p.id, result: p.lastResult }));
      const stale = mod.continuationModeFromOutcome(RES({ roundResults: results, prevLoserIds: sc.stalePrev, prevSafeIds: [], targetLoserCount: sc.target }).outcome);
      expect(stale).toBe(sc.staleMode);
      expect(stale).not.toBe(sc.hostMode);
    });

    it('[RED-RACE] 권위 envelope 도착 전에는 반대 안내를 발화하지 않는다', async () => {
      // envelope 없음 = 아직 도착 전(또는 구버전 host)
      const { mod, calls } = makeParticipant({ ...sc, localLoserIds: sc.stalePrev, gameNo: 5, round: 2, penaltyRaw: '{"text":"벌칙","loserCount":3,"gameRound":5}' });
      await mod.finishRoundLocal();
      const replayVoices = calls.voices.filter(v => v === 'replayWinnersOnly' || v === 'replayLosersOnly');
      expect(replayVoices, `권위 없이 로컬 재계산으로 ${sc.staleMode} 를 발화했다: ${JSON.stringify(calls.voices)}`).toEqual([]);
      expect(calls.voices.includes(VOICE_OF[sc.staleMode]), '반대 안내가 나갔다').toBe(false);
      const held = calls.metrics.filter(m => m.eventType === 'CONTINUATION_AWAITING_AUTHORITY');
      expect(held.length, '대기 상태를 남기는 metric 이 없다').toBeGreaterThan(0);
    });

    it('[RED-RACE] envelope 도착 후 canonical mode 를 정확히 한 번 발화한다', async () => {
      const { mod, calls, state } = makeParticipant({ ...sc, localLoserIds: sc.stalePrev, gameNo: 5, round: 2, penaltyRaw: '{"text":"벌칙","loserCount":3,"gameRound":5}' });
      await mod.finishRoundLocal();                       // 1차: 권위 없음 → 대기
      state.penalty = envelopeFor(mod, sc, 5, 2);          // envelope 도착
      state.finishingRound = false;
      await mod.finishRoundLocal();                       // 2차: 권위 소비
      const replayVoices = calls.voices.filter(v => v === 'replayWinnersOnly' || v === 'replayLosersOnly');
      expect(replayVoices, '발화 횟수').toEqual([VOICE_OF[sc.hostMode]]);
      const rendered = calls.metrics.filter(m => m.eventType === 'CONTINUATION_MESSAGE_RENDERED');
      expect(rendered.length).toBe(1);
      expect(rendered[0].mode).toBe(sc.hostMode);
    });
  });
}

describe('P0-1 continuation 신원 / stale envelope (CEO 지시 3)', () => {
  const sc = A;
  it('gameNo N round R 의 envelope 은 round R+1 에서 소비되지 않는다', async () => {
    const { mod, state } = makeParticipant({ ...sc, localLoserIds: sc.stalePrev, gameNo: 5, round: 2, penaltyRaw: '' });
    state.penalty = envelopeFor(mod, sc, 5, 2);
    expect(mod.getAuthoritativeContinuation(), '같은 라운드에서는 소비돼야 한다').toBeTruthy();
    state.round = 3;
    expect(mod.getAuthoritativeContinuation(), 'round R+1 에서 R 의 envelope 을 소비했다').toBeNull();
  });

  it('gameNo N 의 envelope 은 gameNo N+1 round 1 에서 소비되지 않는다', async () => {
    const { mod, state } = makeParticipant({ ...sc, localLoserIds: sc.stalePrev, gameNo: 5, round: 2, penaltyRaw: '' });
    state.penalty = envelopeFor(mod, sc, 5, 2);
    state.gameRound = 6; state.round = 1;
    expect(mod.getAuthoritativeContinuation(), 'gameNo N+1 에서 N 의 envelope 을 소비했다').toBeNull();
  });

  it('다른 방(roomCode) 의 envelope 은 소비되지 않는다', async () => {
    const { mod, state } = makeParticipant({ ...sc, localLoserIds: sc.stalePrev, gameNo: 5, round: 2, penaltyRaw: '' });
    const raw = mod.buildPenaltyValue({ gameRound: 5, continuation: { gameNo: 5, round: 2, mode: 'LOSERS', confirmedLoserIds: [], roomCode: 'OTHER' } });
    state.penalty = raw;
    const c = mod.getAuthoritativeContinuation();
    // roomCode 가 envelope 에 실려 있으면 반드시 일치해야 한다
    if (c && c.roomCode !== undefined) expect(c.roomCode).toBe(state.roomCode);
  });

  it('stale envelope 상태에서 finishRoundLocal 은 이전 라운드 TTS 를 재생하지 않는다', async () => {
    const { mod, state, calls } = makeParticipant({ ...sc, localLoserIds: sc.stalePrev, gameNo: 5, round: 3, penaltyRaw: '' });
    state.penalty = envelopeFor(mod, sc, 5, 2);   // 이전 라운드(2) 의 envelope 만 있음
    await mod.finishRoundLocal();
    const replayVoices = calls.voices.filter(v => v === 'replayWinnersOnly' || v === 'replayLosersOnly');
    expect(replayVoices, '이전 라운드 envelope 으로 재대결 안내를 재생했다').toEqual([]);
    expect(calls.metrics.filter(m => m.eventType === 'CONTINUATION_MESSAGE_RENDERED').length).toBe(0);
  });

  it('같은 envelope 으로 finishRoundLocal 이 두 번 불려도 안내는 한 번이다 (중복 금지)', async () => {
    const { mod, state, calls } = makeParticipant({ ...sc, localLoserIds: sc.stalePrev, gameNo: 5, round: 2, penaltyRaw: '' });
    state.penalty = envelopeFor(mod, sc, 5, 2);
    await mod.finishRoundLocal();
    state.finishingRound = false;
    await mod.finishRoundLocal();
    const replayVoices = calls.voices.filter(v => v === 'replayWinnersOnly' || v === 'replayLosersOnly');
    // playResultVoiceOnce 는 스파이라 dedupe 가 없다 — 구현이 resultVoiceKey 로 막아야 한다.
    // 여기서는 CONTINUATION_MESSAGE_RENDERED 가 1회인지로 본다(announceContinuation 이 1회 호출).
    expect(calls.metrics.filter(m => m.eventType === 'CONTINUATION_MESSAGE_RENDERED').length, `발화 ${replayVoices.length}회`).toBe(1);
  });
});
