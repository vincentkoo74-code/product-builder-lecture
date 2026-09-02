import { readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const EXPECTED_REF = 'sannrfmhevebqgfdqcps';

function extract(startMarker, endMarker, label) {
  const start = html.indexOf(startMarker);
  const end = html.indexOf(endMarker, start + startMarker.length);
  if (start < 0 || end < 0) throw new Error(`production source extraction failed: ${label}`);
  return html.slice(start, end);
}

const url = /const SUPABASE_URL = "([^"]+)"/.exec(html)?.[1];
const anonKey = /const SUPABASE_ANON_KEY = "([^"]+)"/.exec(html)?.[1];
if (!url || !anonKey || new URL(url).hostname !== `${EXPECTED_REF}.supabase.co`) {
  throw new Error('refusing non-Seoul backend');
}

const continuationSource = extract(
  'const CONTINUATION_MODES = ',
  'function continuationModeFromOutcome(',
  'continuation parser',
);
const parseSource = extract(
  'function toPositiveInt(value, fallback = 0) {',
  '// ── Build40 P0-1: 권위 있는 재대결 안내',
  'penalty parser',
);
const buildSource = extract(
  'function buildPenaltyValue(',
  '// Build19: RESULT/GAME_OVER/NEXT_ROUND',
  'penalty builder',
);
const matchSource = extract(
  'const MATCH_RULES = ',
  'function hostDecideContinuation(',
  'match authority',
);
const casSource = extract(
  'async function updateRoomPenaltyCas(',
  '// Build19: RESULT/READY',
  'room penalty CAS',
);

const bootstrapPositiveInt = (value, fallback = 0) => {
  const n = parseInt(value, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};
const parseContinuationEnvelope = new Function(
  'toPositiveInt',
  `${continuationSource}\nreturn parseContinuationEnvelope;`,
)(bootstrapPositiveInt);
const { toPositiveInt, parsePenalty } = new Function(
  'parseContinuationEnvelope',
  `${parseSource}\nreturn { toPositiveInt, parsePenalty };`,
)(parseContinuationEnvelope);

const db = createClient(url, anonKey, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  realtime: { params: { eventsPerSecond: 2 } },
});

const createdRooms = [];
const output = { backend: { project: 'maru-rps-production-kr', ref: EXPECTED_REF, region: 'ap-northeast-2' }, scenarios: [], cleanup: [] };

function roomCode() {
  return `Z${randomBytes(3).toString('hex').slice(0, 3)}`.toUpperCase();
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function sameJson(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

function makeRuntime({ roomId, participantIds, rule, requiredTaggers, initialPenalty }) {
  const state = {
    roomCode: roomId,
    role: 'host',
    status: 'playing',
    penalty: initialPenalty,
    targetLoserCount: requiredTaggers,
    matchRule: rule,
    gameRound: parsePenalty(initialPenalty).gameRound || 1,
    participants: participantIds.map((id, index) => ({ id, name: id, is_host: index === 0, choice: null })),
  };
  const QA = { emit() {} };
  const qaRoundCtx = () => ({});
  const getConfiguredTaggerCount = () => parsePenalty(state.penalty).loserCount || state.targetLoserCount || 1;
  const match = new Function(
    'state', 'parsePenalty', 'toPositiveInt', 'getConfiguredTaggerCount', 'QA', 'qaRoundCtx',
    `${matchSource}\nreturn { hostComposeMatchUpdate, computeMatchDecision, getMatchEnvelope, getMatchCumulativeStats, matchQualificationThreshold, deriveMatchLossTally, sanitizeMatchStats };`,
  )(state, parsePenalty, toPositiveInt, getConfiguredTaggerCount, QA, qaRoundCtx);
  const getPenaltyText = () => parsePenalty(state.penalty).text || '';
  const clampLoserCount = value => Math.max(1, Math.min(Number(value) || 1, Math.max(1, state.participants.length - 1)));
  const buildPenaltyValue = new Function(
    'state', 'getPenaltyText', 'clampLoserCount', 'toPositiveInt', 'parseContinuationEnvelope',
    `${buildSource}\nreturn buildPenaltyValue;`,
  )(state, getPenaltyText, clampLoserCount, toPositiveInt, parseContinuationEnvelope);
  const updateRoomPenaltyCas = new Function(
    'db', 'state', 'QA', 'qaRoundCtx',
    `${casSource}\nreturn updateRoomPenaltyCas;`,
  )(db, state, QA, qaRoundCtx);
  return { state, match, buildPenaltyValue, updateRoomPenaltyCas };
}

async function insertFreshRoom({ label, rule, requiredTaggers, seeded = {} }) {
  let id;
  let insertError;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    id = roomCode();
    const penalty = JSON.stringify({
      text: `CODEX_${label}`,
      loserCount: requiredTaggers,
      gameRound: seeded.gameRound || 1,
      matchRule: rule,
      matchNo: 1,
      ...(seeded.matchStats ? { matchStats: seeded.matchStats } : {}),
      ...(seeded.matchTally ? { matchTally: seeded.matchTally } : {}),
      ...(seeded.matchTalliedGameNo ? { matchTalliedGameNo: seeded.matchTalliedGameNo, matchStatsGameNo: seeded.matchTalliedGameNo } : {}),
      ...(seeded.matchLockedIds?.length ? { matchLockedIds: seeded.matchLockedIds, matchQualifiedIds: seeded.matchLockedIds } : {}),
    });
    const result = await db.from('rooms').insert([{ id, status: 'playing', round: 1, penalty }]);
    insertError = result.error;
    if (!insertError) {
      createdRooms.push(id);
      const ids = [`${id}_A`, `${id}_B`, `${id}_C`];
      const rows = ids.map((pid, index) => ({ id: pid, room_id: id, name: pid.slice(-1), is_host: index === 0, choice: null, is_ready: true }));
      const participantResult = await db.from('participants').insert(rows);
      if (participantResult.error) throw new Error(`participant insert failed: ${participantResult.error.message}`);
      return { id, ids, penalty };
    }
    if (insertError.code !== '23505') break;
  }
  throw new Error(`room insert failed: ${insertError?.message || 'unknown'}`);
}

async function rereadRoom(id) {
  const { data, error } = await db.from('rooms').select('id,status,round,penalty').eq('id', id).single();
  if (error || !data) throw new Error(`authoritative reread failed: ${error?.message || 'missing room'}`);
  return data;
}

function snapshotFor({ runtime, row, gameNo, winnerIds, loserIds, previousLockedIds, label }) {
  const p = parsePenalty(row.penalty);
  runtime.state.penalty = row.penalty;
  runtime.state.status = row.status;
  runtime.state.gameRound = p.gameRound || gameNo;
  const stats = runtime.match.sanitizeMatchStats(p.matchStats, p.matchTally);
  const tally = runtime.match.deriveMatchLossTally(stats);
  const decision = runtime.match.computeMatchDecision({
    rule: p.matchRule,
    stats,
    lockedIds: p.matchLockedIds,
    qualifiedIds: p.matchQualifiedIds,
    targetTaggerCount: p.loserCount,
    participantsCount: runtime.state.participants.length,
  });
  const card = {};
  for (const player of runtime.state.participants) card[player.id] = runtime.match.getMatchCumulativeStats(player);
  const thresholdLosses = runtime.match.deriveMatchLossTally(decision.stats);
  const newlyConfirmedTaggerIds = decision.lockedIds.filter(id => !previousLockedIds.includes(id));
  assert(sameJson(tally, p.matchTally), `${label}: derived matchTally diverged`);
  for (const [id, stat] of Object.entries(stats)) {
    assert(card[id]?.loserCount === stat.losses, `${label}: card losses diverged for ${id}`);
    assert((thresholdLosses[id] || 0) === stat.losses, `${label}: threshold losses diverged for ${id}`);
  }
  return {
    roomCode: row.id,
    roomId: row.id,
    gameRound: p.gameRound,
    matchNo: p.matchNo,
    winnerIds,
    loserIds,
    matchStats: stats,
    matchTally: tally,
    scoreCard: card,
    thresholdLosses,
    matchTalliedGameNo: p.matchTalliedGameNo,
    configuredLossThreshold: runtime.match.matchQualificationThreshold(p.matchRule),
    requiredTaggerCount: p.loserCount,
    newlyConfirmedTaggerIds,
    matchLockedIds: p.matchLockedIds,
    matchDecisionComplete: decision.complete,
  };
}

async function runMatchScenario({ label, rule, requiredTaggers, losers }) {
  const room = await insertFreshRoom({ label, rule, requiredTaggers });
  const runtime = makeRuntime({ roomId: room.id, participantIds: room.ids, rule, requiredTaggers, initialPenalty: room.penalty });
  const steps = [];
  let finalWrites = 0;
  let game4Attempted = false;
  for (let index = 0; index < losers.length; index += 1) {
    const gameNo = index + 1;
    const before = parsePenalty(runtime.state.penalty);
    const lockedBefore = before.matchLockedIds || [];
    runtime.state.participants = runtime.state.participants.map(p => ({ ...p, choice: lockedBefore.includes(p.id) ? '__loser__' : null }));
    const loserId = room.ids[losers[index]];
    const eligibleIds = runtime.state.participants.filter(p => p.choice !== '__loser__').map(p => p.id);
    const winnerIds = eligibleIds.filter(id => id !== loserId);
    const continuation = { gameNo, round: 1, roomCode: room.id, mode: 'FINAL', confirmedLoserIds: [loserId] };
    const update = runtime.match.hostComposeMatchUpdate(continuation);
    assert(update, `${label} G${gameNo}: production hostCompose returned null`);
    const nextPenalty = runtime.buildPenaltyValue({ gameRound: gameNo, continuation, phaseKind: 'result', ...update });
    const committed = await runtime.updateRoomPenaltyCas(
      { status: 'result', penalty: nextPenalty },
      { expectedStatus: 'playing', expectedPenalty: runtime.state.penalty, source: `${label}:GAME${gameNo}:FINAL` },
    );
    runtime.state.penalty = committed.penalty;
    runtime.state.status = committed.status;
    const authoritative = await rereadRoom(room.id);
    const snap = snapshotFor({ runtime, row: authoritative, gameNo, winnerIds, loserIds: [loserId], previousLockedIds: lockedBefore, label: `${label} G${gameNo}` });
    steps.push(snap);
    if (snap.matchDecisionComplete) {
      const { data, error } = await db.from('rooms').update({ status: 'game_over' })
        .eq('id', room.id).eq('status', 'result').select('id,status');
      if (error) throw new Error(`${label}: MATCH_FINAL write failed: ${error.message}`);
      finalWrites += Array.isArray(data) ? data.length : 0;
      if (index + 1 < losers.length) game4Attempted = true;
      break;
    }
    const nextGameNo = gameNo + 1;
    const playingPenalty = runtime.buildPenaltyValue({ gameRound: nextGameNo });
    const advanced = await runtime.updateRoomPenaltyCas(
      { status: 'playing', round: 1, penalty: playingPenalty },
      { expectedStatus: 'result', expectedPenalty: authoritative.penalty, source: `${label}:NEXT_GAME` },
    );
    // Explicit reload between GAMEs: discard the local envelope and reload server truth.
    const reloaded = await rereadRoom(room.id);
    assert(reloaded.penalty === advanced.penalty, `${label}: reload diverged after G${gameNo}`);
    runtime.state.penalty = reloaded.penalty;
    runtime.state.status = reloaded.status;
    runtime.state.gameRound = parsePenalty(reloaded.penalty).gameRound;
  }
  assert(finalWrites === 1, `${label}: MATCH_FINAL count ${finalWrites}`);
  assert(!game4Attempted, `${label}: unexpected game after MATCH_FINAL`);
  return { label, result: 'PASS', finalWrites, noExtraGame: true, steps };
}

async function runStaleWriterScenario() {
  const label = 'STALE_WRITER';
  const room = await insertFreshRoom({
    label,
    rule: 'best3',
    requiredTaggers: 1,
    seeded: {
      gameRound: 2,
      matchStats: {},
      matchTally: {},
      matchTalliedGameNo: 1,
    },
  });
  // Seed canonical GAME1 through an exact live CAS so GAME2 can cross the BEST3 threshold.
  const seededObject = JSON.parse(room.penalty);
  seededObject.matchStats = { [room.ids[0]]: { wins: 0, losses: 1 }, [room.ids[1]]: { wins: 1, losses: 0 }, [room.ids[2]]: { wins: 1, losses: 0 } };
  seededObject.matchTally = { [room.ids[0]]: 1 };
  const seededPenalty = JSON.stringify(seededObject);
  const seededWrite = await db.from('rooms').update({ penalty: seededPenalty }).eq('id', room.id).eq('penalty', room.penalty).select('id,penalty');
  if (seededWrite.error || !seededWrite.data?.length) throw new Error('stale scenario seed CAS failed');
  const runtime = makeRuntime({ roomId: room.id, participantIds: room.ids, rule: 'best3', requiredTaggers: 1, initialPenalty: seededPenalty });
  const oldPlaying = await rereadRoom(room.id);
  const continuation = { gameNo: 2, round: 1, roomCode: room.id, mode: 'FINAL', confirmedLoserIds: [room.ids[0]] };
  const update = runtime.match.hostComposeMatchUpdate(continuation);
  const finalPenalty = runtime.buildPenaltyValue({ gameRound: 2, continuation, phaseKind: 'result', ...update });
  const committed = await runtime.updateRoomPenaltyCas(
    { status: 'result', penalty: finalPenalty },
    { expectedStatus: oldPlaying.status, expectedPenalty: oldPlaying.penalty, source: 'STALE_WRITER:FINAL' },
  );
  runtime.state.penalty = committed.penalty;
  runtime.state.status = committed.status;
  let staleBlocked = false;
  try {
    await runtime.updateRoomPenaltyCas(
      { penalty: oldPlaying.penalty },
      { expectedStatus: oldPlaying.status, expectedPenalty: oldPlaying.penalty, source: 'STALE_WRITER:DELAYED_PLAYING' },
    );
  } catch (error) {
    staleBlocked = /stale room compare-and-swap/.test(String(error?.message || error));
  }
  const authoritative = await rereadRoom(room.id);
  runtime.state.penalty = authoritative.penalty;
  runtime.state.status = authoritative.status;
  const p = parsePenalty(authoritative.penalty);
  assert(staleBlocked, 'delayed playing writer was not rejected');
  assert(p.matchStats[room.ids[0]].losses === 2, 'canonical losses rolled back');
  assert(p.matchTalliedGameNo === 2, 'matchTalliedGameNo rolled back');
  assert(p.matchLockedIds.includes(room.ids[0]), 'locked/tagger state rolled back');
  return {
    label,
    result: 'PASS',
    delayedWriterRowsUpdated: 0,
    hostConvergedByAuthoritativeReread: true,
    authoritative: {
      roomCode: room.id,
      status: authoritative.status,
      matchStats: p.matchStats,
      matchTally: p.matchTally,
      matchTalliedGameNo: p.matchTalliedGameNo,
      matchLockedIds: p.matchLockedIds,
      matchFinalTaggerIds: p.matchFinalTaggerIds,
    },
  };
}

async function cleanup() {
  for (const id of createdRooms) {
    const participantsDeleted = await db.from('participants').delete().eq('room_id', id);
    const deleted = await db.from('rooms').delete().eq('id', id);
    if (deleted.error) await db.from('rooms').update({ status: 'destroyed' }).eq('id', id);
    const remaining = await db.from('rooms').select('id,status').eq('id', id).limit(1);
    output.cleanup.push({
      roomCode: id,
      participantsRemoved: !participantsDeleted.error,
      roomDisposition: !remaining.error && !(remaining.data || []).length
        ? 'deleted'
        : ((remaining.data || [])[0]?.status === 'destroyed' ? 'destroyed' : 'cleanup-unverified'),
    });
  }
}

try {
  output.scenarios.push(await runMatchScenario({ label: 'BEST3_TAGGER1', rule: 'best3', requiredTaggers: 1, losers: [0, 1, 0] }));
  output.scenarios.push(await runMatchScenario({ label: 'BEST5_TAGGER1', rule: 'best5', requiredTaggers: 1, losers: [0, 0, 0] }));
  output.scenarios.push(await runMatchScenario({ label: 'BEST3_TAGGER2', rule: 'best3', requiredTaggers: 2, losers: [0, 0, 1, 1] }));
  output.scenarios.push(await runStaleWriterScenario());
  output.result = 'PASS';
} finally {
  await cleanup();
}

process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
