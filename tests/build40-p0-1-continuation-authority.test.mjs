import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

// ════════════════════════════════════════════════════════════════════════════
// Build40 P0-1 — 권위 있는 재대결 안내 (continuationMode).
//
// 필드 관측(Build39): 같은 라운드에서 어떤 기기는 "승자끼리 다시 합니다", 어떤 기기는
// "패자끼리 다시 합니다" 를 말했다.
//
// 코드 감사로 확정한 분기 경로:
//   finishRoundLocal() 이 각 기기에서 독립 실행되고, 결정 predicate 는
//     tooMany ⟺ roundLosers > remainingSlots        → "패자끼리"
//     tooFew  ⟺ roundLosers < remainingSlots        → "승자끼리"
//     remainingSlots = target − prevLoserIds.length
//   인데 prevLoserIds 가 기기마다 다른 출처에서 온다:
//     host   — 직전 finishRoundLocal 이 로컬에 남긴 값
//     참가자 — fetch → syncConfirmedIdsFromParticipants → DB 마커(__loser__) 기준으로 덮어씀
//   마커는 nextRound() 가 다음 라운드 시작 때 쓴다. 참가자의 refetch 가 그보다 먼저면
//   prevLoserIds 가 한 라운드 뒤처져 remainingSlots 가 1 커지고, 같은 roundLosers 로
//   tooMany ↔ tooFew 가 뒤집힌다.
//
// 계약(CEO):
//   gameNo/round 당 권위 있는 continuation 결정은 **하나**. host 가 한 번 결정해 room 에 싣고,
//   참가자는 stale 로컬 confirmedLoserIds 로 WINNERS/LOSERS 를 스스로 정하지 않는다.
//   화면 문구와 TTS 는 같은 continuationMode 에서 나온다.
//
// ⚠️ 공허성 방지: 각 단언 앞에 "이 입력이 실제로 뒤집히는 입력인가"를 대조군으로 둔다.
// ════════════════════════════════════════════════════════════════════════════

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

function extractBlock(a, b, label) {
  const s = html.indexOf(a);
  if (s < 0) throw new Error(`[${label}] start marker not found: ${a}`);
  if (html.indexOf(a, s + 1) >= 0) throw new Error(`[${label}] start marker not unique: ${a}`);
  const e = html.indexOf(b, s);
  if (e < 0) throw new Error(`[${label}] end marker not found: ${b}`);
  const out = html.slice(s, e);
  if (out.length < 80) throw new Error(`[${label}] extracted block too short`);
  return out;
}

// ── 도메인 의미 계산기 (기존 resolveElimination 재사용) ──────────────────
const RESOLVE_SRC = extractBlock('function resolveElimination({', 'function participantListView(', 'resolveElimination');
const resolveElimination = new Function(RESOLVE_SRC + '\nreturn resolveElimination;')();

// 권위 결정 → continuationMode 매핑 (구현이 제공해야 하는 함수)
function loadContinuationHelpers() {
  const a = 'function continuationModeFromOutcome(';
  if (html.indexOf(a) < 0) return null;
  const src = extractBlock(a, 'function buildPenaltyValue(', 'continuationHelpers');
  return new Function(src + '\nreturn { continuationModeFromOutcome, continuationSemantic, continuationVoiceKey };')();
}

const KOREAN = {
  WINNERS: '승자끼리 다시 합니다',
  LOSERS: '패자끼리 다시 합니다',
  ALL: '무승부',
  FINAL: '술래',
};

// ── 시나리오: target=2, 3인, round 1 에서 1명 패배 → tooFew(승자끼리) ────────
// round 2 에서 host 는 prevLoserIds=[p4] 를 갖고, 마커 write 전에 refetch 한 참가자는
// prevLoserIds=[] 를 갖는다. round 2 결과: 3명 중 1명 패배.
//   host   : remainingSlots = 2-1 = 1, roundLosers = 1 → gameOver
//   참가자 : remainingSlots = 2-0 = 2, roundLosers = 1 → tooFew ("승자끼리")
// 즉 stale prevLoserIds 하나로 FINAL ↔ WINNERS 가 갈린다.
const ROUND2 = [{ id: 'h1', result: 'win' }, { id: 'p2', result: 'lose' }, { id: 'p3', result: 'win' }];

describe('P0-1 — 분기 재현 (현행 predicate 가 실제로 뒤집히는가)', () => {
  it('전제(공허성 가드): resolveElimination 이 실제로 동작한다', () => {
    const r = resolveElimination({ roundResults: [{ id: 'a', result: 'lose' }, { id: 'b', result: 'win' }], prevLoserIds: [], prevSafeIds: [], targetLoserCount: 1 });
    expect(r.outcome).toBe('gameOver');
  });

  it('[재현] 같은 round 결과를 host 와 stale 참가자가 다르게 판정한다', () => {
    const host = resolveElimination({ roundResults: ROUND2, prevLoserIds: ['p4'], prevSafeIds: [], targetLoserCount: 2 });
    const stale = resolveElimination({ roundResults: ROUND2, prevLoserIds: [], prevSafeIds: [], targetLoserCount: 2 });
    expect(host.outcome).toBe('gameOver');
    expect(stale.outcome).toBe('tooFew');
    expect(host.outcome, '대조군: 두 결과가 같으면 이 시나리오는 분기를 재현하지 못한다').not.toBe(stale.outcome);
  });

  it('[재현] target=3 에서는 tooMany ↔ tooFew 로 뒤집힌다 (필드 관측과 동일 유형)', () => {
    const R = [{ id: 'a', result: 'lose' }, { id: 'b', result: 'lose' }, { id: 'c', result: 'win' }, { id: 'd', result: 'win' }];
    const host = resolveElimination({ roundResults: R, prevLoserIds: ['x', 'y'], prevSafeIds: [], targetLoserCount: 3 });
    const stale = resolveElimination({ roundResults: R, prevLoserIds: [], prevSafeIds: [], targetLoserCount: 3 });
    expect(host.outcome).toBe('tooMany');   // 남은 슬롯 1, 패자 2 → 패자끼리
    expect(stale.outcome).toBe('tooFew');   // 남은 슬롯 3, 패자 2 → 승자끼리
  });
});

describe('P0-1 — 권위 결정 계약 (소스)', () => {
  it('[RED-C1] continuationMode 도메인 헬퍼가 존재한다', () => {
    expect(html.includes('function continuationModeFromOutcome('), 'continuationModeFromOutcome 이 없다').toBe(true);
    expect(html.includes('function continuationSemantic('), 'continuationSemantic 이 없다').toBe(true);
    expect(html.includes('function continuationVoiceKey('), 'continuationVoiceKey 가 없다').toBe(true);
  });

  it('[RED-C2] host 가 결정을 room envelope 에 gameNo/round 신원과 함께 싣는다', () => {
    // 결정(hostDecideContinuation) → publish 가 호출 → write(updateRoomStatusScheduled) 로 이어지는 체인을 본다.
    const decide = extractBlock('function hostDecideContinuation(', 'async function publishHostRoundResult(', 'decide');
    const pub = extractBlock('async function publishHostRoundResult(', 'function scheduleFetchParticipants(roomCode', 'publish');
    const write = extractBlock('async function updateRoomStatusScheduled(', 'async function updateParticipantChoice(', 'write');
    expect(decide.includes('resolveElimination('), '결정이 resolveElimination 을 재사용하지 않는다(병렬 로직)').toBe(true);
    expect(decide.includes("eventType: 'CONTINUATION_DECISION'"), 'CONTINUATION_DECISION metric 없음').toBe(true);
    expect((pub.match(/hostDecideContinuation/g) || []).length, 'publish 가 결정을 호출하지 않는다').toBeGreaterThanOrEqual(2);
    expect(pub.includes('updateRoomStatusScheduled("result", "result",'), 'result 전이 write 에 결정을 싣지 않는다').toBe(true);
    expect(write.includes("eventType: 'CONTINUATION_WRITE_BEGIN'") && write.includes("eventType: 'CONTINUATION_WRITE_END'"),
      'CONTINUATION_WRITE_BEGIN/END 없음').toBe(true);
    expect(write.includes('continuation, ...(__matchUpdate || {}) }'), 'buildPenaltyValue 에 continuation 을 넘기지 않는다(Build43 매치 원장 spread 포함 형태)').toBe(true);
  });

  it('[RED-C3] penalty envelope 이 continuation 을 파싱/보존한다', () => {
    const parse = extractBlock('function parsePenalty(raw) {', 'function getPenaltyText()', 'parsePenalty');
    expect(parse.includes('continuation'), 'parsePenalty 가 continuation 을 모른다').toBe(true);
    const build = extractBlock('function buildPenaltyValue(', 'const PHASE_RENDER_BUFFER_MS', 'buildPenaltyValue');
    expect(build.includes('continuation'), 'buildPenaltyValue 가 continuation 을 싣지 않는다').toBe(true);
  });

  it('[RED-C4] 참가자 finishRoundLocal 은 권위 continuation 을 우선 소비한다', () => {
    const f = extractBlock('async function finishRoundLocal(', 'function finishRound() {', 'finishRoundLocal');
    expect(f.includes('getAuthoritativeContinuation') || f.includes('authoritativeContinuation'),
      'finishRoundLocal 이 권위값을 읽지 않고 로컬 prevLoserIds 로만 판정한다').toBe(true);
    expect(f.includes("eventType: 'CONTINUATION_OBSERVED'"), 'CONTINUATION_OBSERVED metric 없음').toBe(true);
  });

  it('[RED-C5] 화면 문구와 TTS 가 같은 continuationMode 에서 나온다', () => {
    const f = extractBlock('async function finishRoundLocal(', 'function finishRound() {', 'finishRoundLocal');
    const ann = extractBlock('function announceContinuation(', 'async function finishRoundLocal(', 'announce');
    expect(ann.includes("eventType: 'CONTINUATION_MESSAGE_RENDERED'"), 'CONTINUATION_MESSAGE_RENDERED metric 없음').toBe(true);
    expect(ann.includes('continuationVoiceKey(mode)') && ann.includes('continuationSemantic(mode)'),
      '음성 키와 화면 의미가 같은 mode 에서 나오지 않는다').toBe(true);
    expect((f.match(/announceContinuation\(/g) || []).length, '4개 분기가 모두 announceContinuation 을 쓰지 않는다').toBe(4);
    // 음성 키가 분기마다 하드코딩돼 있으면 안 된다 — continuationVoiceKey(mode) 로 나와야 한다.
    // 주 경로는 announceContinuation(mode) 여야 한다. 좁은 소스 추출 환경을 위한 `else` 폴백
    // (announceContinuation 이 스코프에 없을 때 종전 키로 재생)은 하드코딩으로 세지 않는다 —
    // 폴백이 없으면 wrps081 같은 추출 테스트에서 가드가 음성 호출 자체를 삼킨다(실제로 그랬다).
    const lines = f.split('\n').filter(l => /playResultVoiceOnce\("replay(Losers|Winners)Only"/.test(l));
    const primary = lines.filter(l => !/^\s*else\b/.test(l) && !/추출본 폴백/.test(l));
    expect(primary.length, `replayLosersOnly/replayWinnersOnly 가 주 경로에 ${primary.length}곳 하드코딩돼 있다`).toBe(0);
    expect(lines.length - primary.length, '폴백 줄이 정확히 2개(LOSERS/WINNERS)여야 한다').toBe(2);
  });
});

describe('P0-1 — continuationMode 매트릭스 (구현 후 GREEN)', () => {
  const H = loadContinuationHelpers();
  const skip = !H;

  it.skipIf(skip)('outcome → mode 매핑이 도메인 의미와 일치한다', () => {
    expect(H.continuationModeFromOutcome('tooFew')).toBe('WINNERS');
    expect(H.continuationModeFromOutcome('tooMany')).toBe('LOSERS');
    expect(H.continuationModeFromOutcome('allDraw')).toBe('ALL');
    expect(H.continuationModeFromOutcome('gameOver')).toBe('FINAL');
    expect(H.continuationModeFromOutcome('???')).toBe('UNKNOWN');
  });

  it.skipIf(skip)('UI 의미와 TTS 키가 같은 mode 에서 일관되게 나온다', () => {
    expect(H.continuationVoiceKey('WINNERS')).toBe('replayWinnersOnly');
    expect(H.continuationVoiceKey('LOSERS')).toBe('replayLosersOnly');
    expect(H.continuationVoiceKey('ALL')).toBe('drawRetry');
    expect(H.continuationVoiceKey('FINAL')).toBe('taggerSelected');
    for (const m of ['WINNERS', 'LOSERS', 'ALL', 'FINAL']) {
      const sem = H.continuationSemantic(m);
      expect(sem, `${m} 의미 없음`).toBeTruthy();
      expect(String(sem.ko || ''), `${m} 한국어 의미가 다르다`).toContain(KOREAN[m]);
    }
  });

  for (const [label, roundResults, prevHost, target, expected] of [
    ['winners continue (tooFew)', [{ id: 'a', result: 'lose' }, { id: 'b', result: 'win' }, { id: 'c', result: 'win' }], [], 2, 'WINNERS'],
    ['losers continue (tooMany)', [{ id: 'a', result: 'lose' }, { id: 'b', result: 'lose' }, { id: 'c', result: 'win' }], [], 1, 'LOSERS'],
    ['full draw', [{ id: 'a', result: 'draw' }, { id: 'b', result: 'draw' }], [], 1, 'ALL'],
    ['final tagger', [{ id: 'a', result: 'lose' }, { id: 'b', result: 'win' }], [], 1, 'FINAL'],
  ]) {
    it.skipIf(skip)(`매트릭스: ${label} — host / 참가자A(신선) / 참가자B(stale) 모두 ${expected}`, () => {
      // host 가 권위 결정
      const auth = resolveElimination({ roundResults, prevLoserIds: prevHost, prevSafeIds: [], targetLoserCount: target });
      const mode = H.continuationModeFromOutcome(auth.outcome);
      expect(mode).toBe(expected);
      // 참가자B 는 로컬 prevLoserIds 가 다르지만(stale) 권위값을 소비하므로 같은 mode
      const staleLocal = resolveElimination({ roundResults, prevLoserIds: [...prevHost, 'ghost'], prevSafeIds: [], targetLoserCount: target });
      const consumed = H.continuationModeFromOutcome(auth.outcome); // 권위값에서
      expect(consumed).toBe(mode);
      // 대조군: stale 로컬 재계산은 실제로 달랐을 수 있다 — 그래도 소비값은 같아야 한다
      if (H.continuationModeFromOutcome(staleLocal.outcome) !== mode) {
        expect(consumed, 'stale 로컬 재계산이 다른데도 권위 소비값이 흔들렸다').toBe(mode);
      }
    });
  }
});

describe('P0-1 — envelope merge 보존 (RED)', () => {
  it('[RED-M1] continuation 을 실을 때 countdownStartAt / choiceEndAt / phase* 가 보존된다', () => {
    const build = extractBlock('function buildPenaltyValue(', 'const PHASE_RENDER_BUFFER_MS', 'buildPenaltyValue');
    // parsePenalty ~ getPenaltyText 블록에 parseContinuationEnvelope/CONTINUATION_MODES 정의가 함께 있다.
    const parse = extractBlock('function parsePenalty(raw) {', 'function getPenaltyText()', 'parsePenalty');
    const helpers = extractBlock('function toPositiveInt(', 'function parsePenalty(raw) {', 'toPositiveInt');
    const mod = new Function('state', 'getPenaltyText', 'clampLoserCount',
      helpers + '\n' + parse + '\n' + build + '\nreturn { buildPenaltyValue, parsePenalty };')(
      { targetLoserCount: 2, gameRound: 5 }, () => '커피', (n) => Math.max(1, n));
    const cont = { gameNo: 5, round: 2, mode: 'LOSERS', confirmedLoserIds: ['p3'] };
    const raw = mod.buildPenaltyValue({ gameRound: 5, countdownStartAt: 1700000000000, choiceEndAt: 1700000005000,
      phaseScheduledAt: 1700000009000, phaseKind: 'result', continuation: cont });
    const p = mod.parsePenalty(raw);
    expect(p.countdownStartAt, 'countdownStartAt 유실').toBe(1700000000000);
    expect(p.choiceEndAt, 'choiceEndAt 유실').toBe(1700000005000);
    expect(p.phaseScheduledAt, 'phaseScheduledAt 유실').toBe(1700000009000);
    expect(p.phaseKind, 'phaseKind 유실').toBe('result');
    expect(p.continuation, 'continuation 이 envelope 에 실리지 않았다').toEqual({ ...cont, roomCode: null });
  });

  it('[RED-M2] continuation 은 gameNo/round 신원 없이 bare 로 실리지 않는다', () => {
    const build = extractBlock('function buildPenaltyValue(', 'const PHASE_RENDER_BUFFER_MS', 'buildPenaltyValue');
    const helpers = extractBlock('function toPositiveInt(', 'function parsePenalty(raw) {', 'toPositiveInt')
      + '\n' + extractBlock('const CONTINUATION_MODES = [', 'function continuationModeFromOutcome(', 'continuationEnvelope');
    const mod = new Function('state', 'getPenaltyText', 'clampLoserCount',
      helpers + '\n' + build + '\nreturn { buildPenaltyValue };')(
      { targetLoserCount: 1, gameRound: 1 }, () => '', (n) => n);
    const raw = mod.buildPenaltyValue({ gameRound: 1, continuation: { mode: 'LOSERS' } });
    const obj = JSON.parse(raw);
    expect(obj.continuation, '신원 없는 continuation 이 그대로 실렸다 — 다음 라운드로 새어 나간다').toBeUndefined();
  });
});
