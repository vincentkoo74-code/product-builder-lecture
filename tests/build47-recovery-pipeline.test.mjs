// Build47 recovery: execute the production composer, envelope builder and room CAS across
// serialized reload boundaries. This is intentionally behavioral, not a source-regex gate.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const html = readFileSync(join(ROOT, 'index.html'), 'utf8');

function sliceFn(name) {
  const starts = [`async function ${name}(`, `function ${name}(`];
  let start = -1;
  for (const marker of starts) { start = html.indexOf(marker); if (start >= 0) break; }
  if (start < 0) throw new Error(`missing ${name}`);
  const ends = ['\n    function ', '\n    async function ', '\n\t    function ', '\n\t    async function ']
    .map(marker => html.indexOf(marker, start + name.length + 12)).filter(i => i > start);
  return html.slice(start, Math.min(...ends));
}

function matchFns() {
  const start = html.indexOf('// ── Build43 게임룰(매치) 순수 함수 시작');
  const end = html.indexOf('// ── Build43 게임룰(매치) 순수 함수 끝');
  return new Function(html.slice(start, end) + `
    return { sanitizeMatchStats, deriveMatchLossTally, applyCompletedGameToMatchStats, computeMatchDecision };`)();
}
const positive = (v, fallback = 0) => { const n = parseInt(v, 10); return Number.isFinite(n) && n > 0 ? n : fallback; };
const parse = raw => { try { return raw && typeof raw === 'object' ? raw : JSON.parse(raw || '{}'); } catch { return {}; } };

function roomsDb(store, writes, beforeFirstUpdate = null) {
  let updateCount = 0;
  const matches = filters => filters.every(([key, value]) => store[key] === value);
  return { from(table) {
    if (table === 'participants') {
      return {
        update() {
          const q = { eq() { return q; }, in() { return Promise.resolve({ data: [], error: null }); }, then(resolve) { return Promise.resolve({ data: [], error: null }).then(resolve); } };
          return q;
        },
      };
    }
    if (table !== 'rooms') throw new Error(`unsupported ${table}`);
    return {
      update(payload) {
        const filters = [];
        const q = { eq(key, value) { filters.push([key, value]); return q; }, or(expr) {
          if (expr !== 'penalty.is.null,penalty.eq.') throw new Error(`unsupported or: ${expr}`);
          filters.push(['__emptyPenalty', true]); return q;
        }, async select() {
          if (updateCount++ === 0 && beforeFirstUpdate) beforeFirstUpdate(store);
          const ordinary = filters.filter(([key]) => key !== '__emptyPenalty');
          const emptyOk = !filters.some(([key]) => key === '__emptyPenalty') || store.penalty == null || store.penalty === '';
          if (!emptyOk || !matches(ordinary)) return { data: [], error: null };
          Object.assign(store, payload); writes.push({ ...payload });
          return { data: [{ id: store.id, status: store.status, round: store.round, penalty: store.penalty }], error: null };
        } };
        return q;
      },
      select() {
        const filters = [];
        const q = { eq(key, value) { filters.push([key, value]); return q; }, async limit() {
          return { data: matches(filters) ? [{ id: store.id, status: store.status, penalty: store.penalty }] : [], error: null };
        } };
        return q;
      },
    };
  } };
}

function runtime(rule, beforeFirstUpdate = null) {
  const M = matchFns();
  const initial = JSON.stringify({ text: '', loserCount: 1, gameRound: 1, matchRule: rule, matchNo: 1 });
  const store = { id: 'ROOM', status: 'playing', penalty: initial };
  const state = { roomCode: 'ROOM', status: 'playing', gameRound: 1, matchRule: rule, penalty: initial,
    participants: ['A', 'B', 'C'].map(id => ({ id, choice: 'rock' })) };
  const writes = [], events = [];
  const db = roomsDb(store, writes, beforeFirstUpdate);
  const updatePenaltyCas = new Function('db', 'state', 'QA', 'qaRoundCtx',
    `${sliceFn('updateRoomPenaltyCas')}\nreturn updateRoomPenaltyCas;`)(db, state,
      { emit: (_kind, payload) => events.push(payload) }, undefined);
  const envelope = () => {
    const p = parse(state.penalty), stats = M.sanitizeMatchStats(p.matchStats, p.matchTally);
    return { stale: false, matchNo: positive(p.matchNo, 1), rule: p.matchRule || rule, stats,
      tally: M.deriveMatchLossTally(stats), lockedIds: p.matchLockedIds || [], qualifiedIds: p.matchQualifiedIds || [],
      finalTaggerIds: p.matchFinalTaggerIds || [], talliedGameNo: positive(p.matchTalliedGameNo, 0),
      statsGameNo: positive(p.matchStatsGameNo, 0) };
  };
  const hostCompose = new Function('state', 'getMatchEnvelope', 'getConfiguredTaggerCount', 'QA', 'qaRoundCtx',
    'toPositiveInt', 'applyCompletedGameToMatchStats', 'deriveMatchLossTally', 'computeMatchDecision',
    `${sliceFn('hostComposeMatchUpdate')}\nreturn hostComposeMatchUpdate;`)(state, envelope, () => 1,
      { emit: (_kind, payload) => events.push(payload) }, undefined, positive,
      M.applyCompletedGameToMatchStats, M.deriveMatchLossTally, M.computeMatchDecision);
  const buildPenalty = new Function('state', 'getPenaltyText', 'clampLoserCount', 'toPositiveInt', 'parseContinuationEnvelope',
    `${sliceFn('buildPenaltyValue')}\nreturn buildPenaltyValue;`)(state, () => '', n => Math.max(1, Number(n) || 1), positive, x => x || null);
  const scheduled = new Function('db', 'state', 'isRoomClosingOrDestroyed', 'QA', 'qaRoundCtx',
    'hostComposeMatchUpdate', 'buildPenaltyValue', 'getGameRound', 'getNextPhaseScheduledAt', 'parsePenalty', 'sanitizeMatchStats',
    `${sliceFn('updateRoomStatusScheduled')}\nreturn updateRoomStatusScheduled;`)(db, state, () => false,
      { emit: (_kind, payload) => events.push(payload) }, undefined, hostCompose, buildPenalty,
      () => positive(parse(state.penalty).gameRound, 1), () => 123456, parse, M.sanitizeMatchStats);
  const card = new Function('state', 'parsePenalty', 'sanitizeMatchStats',
    `${sliceFn('getMatchCumulativeStats')}\nreturn getMatchCumulativeStats;`)(state, parse, M.sanitizeMatchStats);
  const beginNewGameRound = new Function(
    'state', 'isRoomClosingOrDestroyed', 'hasCurrentGameRoundActivity', 'archiveCurrentRoundStats',
    'resetTransientRoundUi', 'isMatchComplete', 'getMatchLockedIds', 'getConfiguredTaggerCount',
    'getTargetLoserCount', 'getGameRound', 'getNextCountdownStartAt', 'serverNow', 'serverClockOffsetMs',
    'QA', 'qaRoundCtx', 'getNextPhaseScheduledAt', 'buildPenaltyValue', 'resetLocalParticipantsForNewGameRound',
    'getOnlineMode', 'db', 'getNewGameRoundParticipantPatch', 'qaNextTraceId', 'updateRoomPenaltyCas', 'saveState',
    `${sliceFn('beginNewGameRound')}\nreturn beginNewGameRound;`,
  )(
    state, () => false, () => true, () => {}, () => {},
    () => Boolean(envelope().finalTaggerIds.length), () => envelope().lockedIds,
    () => 1, () => 1, () => positive(parse(state.penalty).gameRound, state.gameRound || 1),
    () => 123456, () => Date.now(), 0, { emit: (_kind, payload) => events.push(payload) }, undefined,
    () => 123456, buildPenalty, () => {
      state.participants = state.participants.map(p => ({ ...p, choice: null, wins: 0, losses: 0, draws: 0, is_ready: false }));
    }, () => true, db, () => ({ choice: null, wins: 0, losses: 0, draws: 0, penalties: 0, is_ready: false }),
    prefix => `${prefix}:test`, updatePenaltyCas, () => {},
  );

  async function commit(gameNo, loserId) {
    await scheduled('result', 'result', { mode: 'FINAL', gameNo, round: 1, confirmedLoserIds: [loserId] });
    // Reload exactly as a reconnect/poll does: serialize the room row and replace local identity.
    state.penalty = JSON.stringify(JSON.parse(store.penalty)); state.status = store.status;
    const p = parse(store.penalty);
    const threshold = M.computeMatchDecision({ rule, stats: p.matchStats, lockedIds: p.matchLockedIds || [],
      qualifiedIds: p.matchQualifiedIds || [], targetTaggerCount: 1, participantsCount: 3 }).cumulativeLosses;
    return { persisted: M.sanitizeMatchStats(p.matchStats, p.matchTally), threshold,
      cards: Object.fromEntries(state.participants.map(player => [player.id, card(player)])),
      locked: p.matchLockedIds || [], final: p.matchFinalTaggerIds || [], tallied: p.matchTalliedGameNo };
  }
  async function next(gameNo) {
    state.penalty = JSON.stringify(JSON.parse(store.penalty));
    state.status = store.status;
    state.gameRound = positive(parse(state.penalty).gameRound, gameNo - 1);
    await beginNewGameRound({ status: 'playing', increment: true, reason: 'behavioral-test-next-game' });
    // Authoritative reload, exactly as poll/reconnect replaces local room state.
    state.penalty = JSON.stringify(JSON.parse(store.penalty));
    state.status = store.status;
    state.gameRound = positive(parse(state.penalty).gameRound, gameNo);
    expect(state.gameRound).toBe(gameNo);
  }
  return { M, state, store, db, writes, events, hostCompose, buildPenaltyValue: buildPenalty, updatePenaltyCas, commit, next };
}

describe('Build47 recovery — persisted GAME result pipeline', () => {
  it('BEST3 A/B/A: persisted == score card == threshold after every reload; A locks/finalizes once; no G4', async () => {
    const r = runtime('best3');
    // Physical-device reproduction: this app process previously observed matchNo=2 in another
    // room. Room-local matchNo restarts at 1; the old global watermark used to erase the base
    // ledger on every FINAL composition in this new room.
    r.state.matchNoSeen = 2;
    r.state.matchNoSeenRoomCode = 'PREVIOUS_ROOM';
    const g1 = await r.commit(1, 'A');
    expect([g1.persisted.A.losses, g1.cards.A.loserCount, g1.threshold.A]).toEqual([1, 1, 1]);
    expect({ A: g1.persisted.A.wins, B: g1.persisted.B.wins, C: g1.persisted.C.wins }).toEqual({ A: 0, B: 1, C: 1 });
    await r.next(2);
    const g2 = await r.commit(2, 'B');
    expect({ A: g2.persisted.A.losses, B: g2.persisted.B.losses }).toEqual({ A: 1, B: 1 });
    expect({ A: g2.cards.A.loserCount, B: g2.cards.B.loserCount }).toEqual({ A: 1, B: 1 });
    expect(g2.threshold).toMatchObject({ A: 1, B: 1 });
    expect({ A: g2.persisted.A.wins, B: g2.persisted.B.wins, C: g2.persisted.C.wins }).toEqual({ A: 1, B: 1, C: 2 });
    expect({ A: g2.cards.A.safeCount, B: g2.cards.B.safeCount, C: g2.cards.C.safeCount }).toEqual({ A: 1, B: 1, C: 2 });
    await r.next(3);
    const g3 = await r.commit(3, 'A');
    expect({ A: g3.persisted.A.losses, B: g3.persisted.B.losses }).toEqual({ A: 2, B: 1 });
    expect({ A: g3.cards.A.loserCount, B: g3.cards.B.loserCount }).toEqual({ A: 2, B: 1 });
    expect(g3.threshold).toMatchObject({ A: 2, B: 1 });
    expect({ A: g3.persisted.A.wins, B: g3.persisted.B.wins, C: g3.persisted.C.wins }).toEqual({ A: 1, B: 2, C: 3 });
    expect({ A: g3.cards.A.safeCount, B: g3.cards.B.safeCount, C: g3.cards.C.safeCount }).toEqual({ A: 1, B: 2, C: 3 });
    expect(g3.locked).toEqual(['A']); expect(g3.final).toEqual(['A']); expect(g3.tallied).toBe(3);
    const timeline = [g1, g2, g3];
    expect(timeline.filter((x, i) => x.locked.includes('A') && (i === 0 || !timeline[i - 1].locked.includes('A')))).toHaveLength(1);
    expect(r.writes.filter(w => (parse(w.penalty).matchFinalTaggerIds || []).length)).toHaveLength(1);
    const needsNext = new Function('getMatchRule', 'isMatchComplete', `${sliceFn('matchNeedsNextGame')}\nreturn matchNeedsNextGame;`)(
      () => 'best3', () => true);
    expect(needsNext()).toBe(false);
    expect(r.hostCompose({ mode: 'FINAL', gameNo: 3, confirmedLoserIds: ['A'] })).toBeNull();
  });

  it('BEST5 A/A/A: cumulative 1→2→3 and confirmation/final occur exactly at 3', async () => {
    const r = runtime('best5'), trace = [];
    trace.push(await r.commit(1, 'A')); await r.next(2);
    trace.push(await r.commit(2, 'A')); await r.next(3);
    trace.push(await r.commit(3, 'A'));
    expect(trace.map(x => x.persisted.A.losses)).toEqual([1, 2, 3]);
    expect(trace.map(x => x.cards.A.loserCount)).toEqual([1, 2, 3]);
    expect(trace.map(x => x.threshold.A)).toEqual([1, 2, 3]);
    expect(trace.map(x => x.persisted.B.wins)).toEqual([1, 2, 3]);
    expect(trace.map(x => x.persisted.C.wins)).toEqual([1, 2, 3]);
    expect(trace.map(x => x.cards.B.safeCount)).toEqual([1, 2, 3]);
    expect(trace.map(x => x.final)).toEqual([[], [], ['A']]);
  });

  it('NEW MATCH resets canonical stats while NEXT GAME preserves them', async () => {
    const r = runtime('best5');
    const g1 = await r.commit(1, 'A');
    expect(g1.persisted.A.losses).toBe(1);
    await r.next(2);
    expect(parse(r.store.penalty).matchStats.A.losses).toBe(1);
    const reset = r.buildPenaltyValue({ gameRound: 3, matchReset: true });
    const p = parse(reset);
    expect(p.matchNo).toBe(2);
    expect(p.matchStats).toBeUndefined();
    expect(p.matchTally).toBeUndefined();
    expect(p.matchTalliedGameNo).toBeUndefined();
  });

  it('CAS conflict with a late playing writer rebases once and preserves the FINAL canonical increment', async () => {
    const r = runtime('best3', store => { const stale = parse(store.penalty); stale.choiceEndAt = 999; store.penalty = JSON.stringify(stale); });
    const g1 = await r.commit(1, 'A');
    expect(g1.persisted.A.losses).toBe(1); expect(r.events.some(e => e.eventType === 'FINAL_WRITE_RETRY')).toBe(true);
    expect(r.writes).toHaveLength(1);
  });

  it('old playing snapshot arriving after FINAL is a zero-row no-op and cannot roll back local/server stats', async () => {
    const r = runtime('best3');
    const oldSnapshot = r.store.penalty;
    await r.commit(1, 'A');
    const finalSnapshot = r.store.penalty;
    const publish = new Function('state', 'getOnlineMode', 'db', 'getCountdownStartAt', 'buildPenaltyValue',
      'getGameRound', 'updateRoomPenaltyCas', 'QA', 'console', `${sliceFn('publishChoiceWindowEnd')}\nreturn publishChoiceWindowEnd;`)(
        { role: 'host', roomCode: 'ROOM', round: 1, penalty: finalSnapshot }, () => true, r.db, () => 0,
        () => oldSnapshot, () => 1, r.updatePenaltyCas, { emit: (_kind, payload) => r.events.push(payload) }, { warn() {} });
    await publish(999);
    expect(r.store.penalty).toBe(finalSnapshot);
    expect(parse(r.store.penalty).matchStats.A.losses).toBe(1);
    expect(r.events.some(e => e.eventType === 'PENALTY_WRITE_SKIPPED_STALE')).toBe(true);
    expect(r.events.some(e => e.eventType === 'CHOICE_END_PUBLISH_SKIPPED_STALE')).toBe(true);
  });

  it('generic penalty CAS accepts the historical NULL/empty initial envelope, then rejects an old snapshot', async () => {
    const r = runtime('best3');
    r.store.penalty = null; r.state.penalty = '';
    const applied = await r.updatePenaltyCas({ penalty: 'P1' },
      { expectedStatus: 'playing', expectedPenalty: '', source: 'empty-envelope-test' });
    expect(applied.penalty).toBe('P1');
    await expect(r.updatePenaltyCas({ penalty: 'ROLLBACK' },
      { expectedStatus: 'playing', expectedPenalty: '', source: 'stale-envelope-test' })).rejects.toThrow('stale room compare-and-swap');
    expect(r.store.penalty).toBe('P1');
  });

  it('countdown republish commits local timing only after CAS success and rolls back on stale conflict', async () => {
    const r = runtime('best3', store => {
      const newer = parse(store.penalty); newer.choiceEndAt = 777; store.penalty = JSON.stringify(newer);
    });
    const oldPenalty = r.state.penalty;
    r.state.role = 'host'; r.state.round = 1; r.state.countdownStartAt = 111;
    const republish = new Function('state', 'getNextCountdownStartAt', 'getChoiceEndAt', 'buildPenaltyValue',
      'getOnlineMode', 'db', 'updateRoomPenaltyCas', 'getGameRound', 'QA',
      `${sliceFn('republishCountdownStartAsHost')}\nreturn republishCountdownStartAsHost;`)(
        r.state, () => 222, () => 0, () => 'P-CANDIDATE', () => true, r.db, r.updatePenaltyCas,
        () => 1, { emit: (_kind, payload) => r.events.push(payload) });
    await expect(republish()).rejects.toThrow('stale room compare-and-swap');
    expect(r.state.penalty).toBe(oldPenalty);
    expect(r.state.countdownStartAt).toBe(111);
    expect(r.store.penalty).not.toBe(oldPenalty);
  });

  it('matchTalliedGameNo is monotonic: duplicate/older FINAL are blocked, legitimate N+1 is allowed', () => {
    const r = runtime('best5');
    r.state.penalty = JSON.stringify({ matchRule: 'best5', matchNo: 1, matchTalliedGameNo: 2,
      matchStats: { A: { wins: 0, losses: 2 }, B: { wins: 2, losses: 0 } } });
    expect(r.hostCompose({ mode: 'FINAL', gameNo: 2, confirmedLoserIds: ['A'] })).toBeNull();
    expect(r.hostCompose({ mode: 'FINAL', gameNo: 1, confirmedLoserIds: ['A'] })).toBeNull();
    expect(r.hostCompose({ mode: 'FINAL', gameNo: 3, confirmedLoserIds: ['A'] }).matchStats.A.losses).toBe(3);
  });
});
