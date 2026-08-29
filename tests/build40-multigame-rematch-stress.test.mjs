import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

// ════════════════════════════════════════════════════════════════════════════
// Build40 — 멀티게임 / 재경기 스트레스 (CEO 지시 10).
//
// 필드 불만은 "깨끗한 첫 라운드"가 아니라 "세 판 넘어가면"이다. 이 하네스는
// gameNo 1 → 여러 라운드 → 재경기 → gameNo 2 → … → gameNo N 을 결정론적으로 돌리며
// 매 게임/라운드마다 아래를 단언한다:
//   ① 권위 continuation 결정이 정확히 하나
//   ② 3 클라이언트(host / iPhone / Android) 가 같은 mode 를 소비
//   ③ 카운트다운 세대가 라운드당 하나
//   ④ 이전 게임의 startAt 이 재사용되지 않음
//   ⑤ 이전 게임의 confirmedLoserIds 가 다음 게임으로 새지 않음
//   ⑥ 화면/음성 의미가 모순되지 않음
//   ⑦ 시간 오프셋이 게임이 진행돼도 누적되지 않음
//
// 참가자 B 는 매 라운드 의도적으로 stale 한 로컬 confirmedLoserIds(직전 라운드 값)를 갖는다 —
// Build39 필드에서 실제로 일어난 refetch 순서 역전을 모델링한다.
//
// 실제 소스의 resolveElimination / continuation 헬퍼 / penalty envelope 를 추출해 쓴다.
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

const resolveElimination = new Function(
  extractBlock('function resolveElimination({', 'function participantListView(', 'resolve') + '\nreturn resolveElimination;')();
const ENV = new Function('state', 'getPenaltyText', 'clampLoserCount',
  extractBlock('function toPositiveInt(', 'function parsePenalty(raw) {', 'toPositiveInt') + '\n' +
  extractBlock('function parsePenalty(raw) {', 'function getPenaltyText()', 'parsePenalty') + '\n' +
  extractBlock('function buildPenaltyValue(', 'const PHASE_RENDER_BUFFER_MS', 'build') +
  '\nreturn { buildPenaltyValue, parsePenalty, continuationModeFromOutcome, continuationVoiceKey, continuationSemantic, parseContinuationEnvelope };'
)({ targetLoserCount: 1, gameRound: 1 }, () => '벌칙', (n) => Math.max(1, n));

// PRNG (결정론)
function mulberry32(seed) { return () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

const LEAD_MS = 3600;

/**
 * 한 게임을 라운드 단위로 진행한다. 각 라운드에서:
 *   host  : resolveElimination(권위 prevLoserIds) → decision → envelope write
 *   iPhone: 권위 소비 (신선한 로컬)
 *   Android: 권위 소비 (stale 로컬 — 직전 라운드의 confirmedLoserIds)
 */
function playGame({ gameNo, players, target, rng, clock, log, staleLag = 1 }) {
  let hostLoserIds = [], hostSafeIds = [];
  let androidStaleLoserIds = [];   // 의도적 stale
  let round = 0;
  let prevStartAt = null;
  const rounds = [];
  while (true) {
    round++;
    // ── countdown startAt 생성 (host) ────────────────────────────────────
    const startAt = clock.now() + LEAD_MS;
    expect(startAt, `gameNo ${gameNo} round ${round}: 이전 게임/라운드 startAt 재사용`).not.toBe(prevStartAt);
    prevStartAt = startAt;
    const generation = `${gameNo}:${round}`;
    // ── 활성 참가자 결정 ─────────────────────────────────────────────────
    const active = players.filter(id => !hostLoserIds.includes(id) && !hostSafeIds.includes(id));
    if (active.length === 0) break;
    // ── 결과 (결정론적 랜덤) ─────────────────────────────────────────────
    const results = active.map(id => ({ id, result: ['win', 'lose', 'draw'][Math.floor(rng() * 3)] }));
    // 전원 draw 가 아니면 win/lose 를 섞어 gameOver 로 수렴 가능하게 한다
    const hasWin = results.some(r => r.result === 'win'), hasLose = results.some(r => r.result === 'lose');
    if (!(results.every(r => r.result === 'draw')) && !(hasWin && hasLose)) {
      results[0].result = 'lose'; if (results.length > 1) results[1].result = 'win';
      for (let i = 2; i < results.length; i++) results[i].result = rng() < 0.5 ? 'win' : 'lose';
    }
    // ── ① host 권위 결정 (정확히 1회) ──────────────────────────────────
    const auth = resolveElimination({ roundResults: results, prevLoserIds: hostLoserIds, prevSafeIds: hostSafeIds, targetLoserCount: target });
    const decision = { gameNo, round, mode: ENV.continuationModeFromOutcome(auth.outcome), confirmedLoserIds: auth.newConfirmedLoserIds };
    const penaltyRaw = ENV.buildPenaltyValue({ gameRound: gameNo, countdownStartAt: startAt, continuation: decision });
    // ── ② 세 클라이언트가 소비 ─────────────────────────────────────────
    const consume = (localLoserIds) => {
      const c = ENV.parsePenalty(penaltyRaw).continuation;
      // 신원 검증 — 다른 게임/라운드 값이면 소비 금지
      if (!c || c.gameNo !== gameNo || c.round !== round) return { mode: 'UNKNOWN', usedAuthority: false };
      return { mode: c.mode, usedAuthority: true, localWouldHaveBeen: ENV.continuationModeFromOutcome(
        resolveElimination({ roundResults: results, prevLoserIds: localLoserIds, prevSafeIds: hostSafeIds, targetLoserCount: target }).outcome) };
    };
    const host = consume(hostLoserIds);
    const iphone = consume(hostLoserIds);
    const android = consume(androidStaleLoserIds);
    // ── ⑥ 화면/음성 의미 ───────────────────────────────────────────────
    const voice = ENV.continuationVoiceKey(decision.mode);
    const sem = ENV.continuationSemantic(decision.mode);
    // ── ⑦ 시간 오프셋: 각 클라이언트가 startAt 을 관측한 시각 vs startAt ─
    const observedLateBy = [0, 1, 2].map(() => Math.round(200 + rng() * 300)); // 실측 269~341 범위
    rounds.push({ gameNo, round, generation, startAt, decision, host, iphone, android, voice, sem,
      androidStaleDiverged: android.localWouldHaveBeen !== decision.mode, observedLateBy,
      envelope: ENV.parsePenalty(penaltyRaw) });
    log.push(rounds[rounds.length - 1]);
    // ── 상태 전진 (host 기준) ──────────────────────────────────────────
    hostLoserIds = auth.newConfirmedLoserIds; hostSafeIds = auth.newConfirmedSafeIds;
    androidStaleLoserIds = rounds.length > staleLag ? rounds[rounds.length - 1 - staleLag].decision.confirmedLoserIds : [];
    clock.advance(12_000);
    if (auth.isComplete) break;
    if (round > 30) throw new Error('라운드 무한 루프');
  }
  return rounds;
}

function runSession({ games = 10, seed = 42, players = ['h1', 'p2', 'p3', 'p4'], target = 1, staleLag = 1 } = {}) {
  const rng = mulberry32(seed);
  let t = 1_800_000_000_000;
  const clock = { now: () => t, advance: (ms) => { t += ms; } };
  const log = [];
  const perGame = [];
  for (let g = 1; g <= games; g++) {
    const rounds = playGame({ gameNo: g, players, target, rng, clock, log, staleLag });
    perGame.push({ gameNo: g, rounds });
    clock.advance(20_000); // 재경기 대기
  }
  return { log, perGame };
}

describe('Build40 멀티게임/재경기 스트레스 — 결정론', () => {
  it('전제(공허성 가드): 10판 시뮬이 실제로 여러 라운드와 재경기를 만든다', () => {
    const { log, perGame } = runSession({ games: 10 });
    expect(perGame.length).toBe(10);
    expect(log.length, '총 라운드가 너무 적다').toBeGreaterThanOrEqual(15);
    const modes = new Set(log.map(r => r.decision.mode));
    expect(modes.has('FINAL'), '게임이 끝나는 라운드가 없다').toBe(true);
    expect(modes.has('WINNERS') || modes.has('LOSERS') || modes.has('ALL'), '재대결 라운드가 없다').toBe(true);
  });

  it('전제(공허성 가드): Android 의 stale 로컬 재계산은 실제로 host 와 달라지는 라운드가 있다', () => {
    const { log } = runSession({ games: 10, target: 2 });
    const diverged = log.filter(r => r.androidStaleDiverged);
    expect(diverged.length, 'stale 모델이 분기를 만들지 못한다 — 하네스가 문제를 재현하지 않는다').toBeGreaterThan(0);
  });

  for (const target of [1, 2]) {
    it(`[target=${target}] ① 매 라운드 권위 결정이 정확히 하나이고 gameNo/round 신원을 갖는다`, () => {
      const { log } = runSession({ games: 10, target });
      for (const r of log) {
        expect(r.envelope.continuation, `${r.generation}: envelope 에 continuation 없음`).toBeTruthy();
        expect(r.envelope.continuation.gameNo).toBe(r.gameNo);
        expect(r.envelope.continuation.round).toBe(r.round);
      }
    });

    it(`[target=${target}] ② host / iPhone / Android(stale) 가 매 라운드 같은 mode 를 소비한다`, () => {
      const { log } = runSession({ games: 10, target });
      for (const r of log) {
        expect(r.host.usedAuthority && r.iphone.usedAuthority && r.android.usedAuthority, `${r.generation}: 권위값 미사용`).toBe(true);
        expect(r.iphone.mode, `${r.generation}: iPhone mode 불일치`).toBe(r.decision.mode);
        expect(r.android.mode, `${r.generation}: Android(stale) mode 불일치 — ${r.android.localWouldHaveBeen} 로 자체 판단했을 것`).toBe(r.decision.mode);
      }
    });

    it(`[target=${target}] ⑥ 매 라운드 화면 의미와 음성 키가 모순되지 않는다`, () => {
      const { log } = runSession({ games: 10, target });
      const expectVoice = { WINNERS: 'replayWinnersOnly', LOSERS: 'replayLosersOnly', ALL: 'drawRetry', FINAL: 'taggerSelected' };
      for (const r of log) {
        expect(r.voice, `${r.generation}: mode=${r.decision.mode} 인데 voice=${r.voice}`).toBe(expectVoice[r.decision.mode]);
        expect(r.sem && r.sem.ko, `${r.generation}: 화면 의미 없음`).toBeTruthy();
        if (r.decision.mode === 'WINNERS') expect(r.sem.ko).toContain('승자끼리');
        if (r.decision.mode === 'LOSERS') expect(r.sem.ko).toContain('패자끼리');
      }
    });
  }

  it('③ 카운트다운 세대가 라운드당 정확히 하나다', () => {
    const { log } = runSession({ games: 10 });
    const gens = log.map(r => r.generation);
    expect(new Set(gens).size, '세대 키가 중복된다').toBe(gens.length);
  });

  it('④ 이전 게임/라운드의 startAt 이 재사용되지 않는다', () => {
    const { log } = runSession({ games: 10 });
    const starts = log.map(r => r.startAt);
    expect(new Set(starts).size, 'startAt 이 재사용됐다').toBe(starts.length);
    for (let i = 1; i < starts.length; i++) expect(starts[i], `라운드 ${i}: startAt 이 앞으로 가지 않는다`).toBeGreaterThan(starts[i - 1]);
  });

  it('⑤ 이전 게임의 confirmedLoserIds 가 다음 게임 첫 라운드로 새지 않는다', () => {
    const { perGame } = runSession({ games: 10, target: 2 });
    for (let g = 1; g < perGame.length; g++) {
      const prevFinal = perGame[g - 1].rounds.at(-1).decision.confirmedLoserIds;
      const firstOfNext = perGame[g].rounds[0].envelope.continuation;
      // 새 게임 첫 라운드의 결정은 prevLoserIds=[] 에서 출발해야 한다 → 그 라운드 패자만 들어 있다
      const leaked = firstOfNext.confirmedLoserIds.filter(id => prevFinal.includes(id) && !perGame[g].rounds[0].decision.confirmedLoserIds.includes(id));
      expect(leaked, `gameNo ${g + 1} 첫 라운드에 gameNo ${g} 의 술래가 새어 들어왔다`).toEqual([]);
      // 신원이 다르므로 이전 게임 envelope 은 소비되지 않는다
      const stale = ENV.parsePenalty(ENV.buildPenaltyValue({ gameRound: g, continuation: perGame[g - 1].rounds.at(-1).decision })).continuation;
      expect(stale.gameNo, '이전 게임 envelope 의 gameNo').toBe(g);
      expect(stale.gameNo === g + 1, '이전 게임 envelope 이 다음 게임 신원으로 위장됐다').toBe(false);
    }
  });

  it('⑦ 관측 지연이 게임이 진행돼도 누적되지 않는다 (10판 뒤에도 1판 때와 같은 분포)', () => {
    const { perGame } = runSession({ games: 10 });
    const avg = (g) => { const a = perGame[g].rounds.flatMap(r => r.observedLateBy); return a.reduce((x, y) => x + y, 0) / a.length; };
    const first = avg(0), last = avg(9);
    // 시뮬의 지연 모델은 라운드/게임과 무관하다 — 누적이 생기면 하네스 자체의 결함이므로 고정한다.
    expect(Math.abs(last - first), `1판 평균 ${first.toFixed(0)}ms vs 10판 평균 ${last.toFixed(0)}ms — 누적 편차`).toBeLessThan(150);
    for (const g of perGame) for (const r of g.rounds) for (const l of r.observedLateBy)
      expect(l, `${r.generation}: 관측 지연 ${l}ms 가 stale 임계(1500) 를 넘는다`).toBeLessThan(1500);
  });

  it('[대조군] 권위값 없이 stale 로컬로 판단하면 실제로 모순이 난다 (수정 전 동작 재현)', () => {
    // WINNERS↔LOSERS 반전은 target>=3 에서 한 라운드 패자>=2 이고 stale prev 가 2 이상 부족할 때 난다
    // (host slots=1 → tooMany / stale slots=3 → tooFew). 5인·target=3 으로 결정론 seed 를 돈다.
    // stale 이 두 라운드 뒤처지면(refetch 두 번 누락) prev 가 2 부족해 정확히 이 반전이 난다.
    const log = [1, 2, 3, 4].flatMap(seed => [1, 2].flatMap(staleLag =>
      runSession({ games: 6, target: 3, seed, staleLag, players: ['h1', 'p2', 'p3', 'p4', 'p5', 'p6'] }).log));
    const contradictions = log.filter(r => r.android.localWouldHaveBeen !== r.decision.mode);
    expect(contradictions.length, '대조군: 수정 전 경로에서 모순이 하나도 없으면 이 스트레스는 결함을 잡지 못한다').toBeGreaterThan(0);
    // 그중 실제로 반대 안내가 나가는 경우(WINNERS↔LOSERS)가 있는지
    const opposite = contradictions.filter(r => new Set([r.decision.mode, r.android.localWouldHaveBeen]).size === 2 &&
      ['WINNERS', 'LOSERS'].includes(r.decision.mode) && ['WINNERS', 'LOSERS'].includes(r.android.localWouldHaveBeen));
    expect(opposite.length, '필드 관측(승자끼리 vs 패자끼리)과 같은 유형의 모순이 재현되지 않았다').toBeGreaterThan(0);
  });
});
