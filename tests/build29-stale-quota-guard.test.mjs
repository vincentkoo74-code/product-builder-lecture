import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';

// Build29(WRPS-076) [P3, CRITICAL] — 실기기 필드 QA(build27) 실측 결함: 게임7 라운드1인데
// conf=2/2(정원 만석)로 렌더된 사례가 확인됐다. 근본원인: fetchFreshParticipantsForResult()가 매
// 시도마다 무조건 syncConfirmedIdsFromParticipants(data)를 실행해, beginNewGameRound()가 로컬을
// 먼저 비우고 DB patch(choice:null)는 나중에 쓰는 그 창에서 이전 게임(gameNo 6)의 __safe__/
// __loser__ 마커 스냅샷이 fetch되면 confirmedSafeIds/LoserIds가 그 값으로 통째로 교체된다
// (마커에는 gameRound가 없어 세대 구분이 불가능한 구조적 약점).
//
// 이 파일은 finishRoundLocal() 1-b 분기 서두에 추가된 "정원 만석의 증거 부재" 가드를 실제 소스
// 추출 + new Function() 실행 패턴(tests/build28-round-judge-integrity.test.mjs와 동일)으로
// 검증한다. 판정 순수함수(judgePure/resolveElimination/judgeRound)는 무변경 — 이 테스트도 그
// 경계를 넘지 않는다.

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

function extractBlock(startMarker, endMarker, includeEndFirstChar = false) {
  const start = html.indexOf(startMarker);
  if (start < 0) throw new Error(`start marker not found: ${startMarker}`);
  let end = html.indexOf(endMarker, start);
  if (end < 0) throw new Error(`end marker not found: ${endMarker}`);
  if (includeEndFirstChar) end += 1;
  return html.slice(start, end);
}

const CHOICE_HELPERS_BLOCK = extractBlock(
  'function isNonPlayingChoice(choice) {',
  'function getParticipantSignature('
);
const FINISH_ROUND_LOCAL_SRC = extractBlock(
  'async function finishRoundLocal() {',
  '// 오프라인/프로토타입용 원본 finishRound'
);

function loadFinishRoundLocal({ state, db, judgeRound, getOnlineMode, isConfirmedLoser, fetchFreshParticipantsForResult }) {
  const calls = {
    renderRoundResult: [], showScreen: [], playResultSfxOnce: [], playResultVoiceOnce: [],
    shadowCompute: [], shadowCompare: [], recordMyAccountGameResult: [], scheduleRematchAutoAdvance: 0,
    stopRoundTimers: 0, syncConfirmedIdsFromParticipants: 0, fetchFreshParticipantsForResult: 0,
  };
  const emitted = [];
  const QA = { emit: (channel, data) => emitted.push(data) };
  const renderRoundResult = (caseType, roundLoserCount, remainingSlots) =>
    calls.renderRoundResult.push({ caseType, roundLoserCount, remainingSlots });
  const showScreen = (id) => calls.showScreen.push(id);
  const playResultSfxOnce = (kind, delayMs) => calls.playResultSfxOnce.push({ kind, delayMs });
  const playResultVoiceOnce = (...args) => calls.playResultVoiceOnce.push(args);
  const __engineV2ShadowComputeRound = (...args) => calls.shadowCompute.push(args);
  const __engineV2ShadowCompare = (label) => calls.shadowCompare.push(label);
  const recordMyAccountGameResult = (r) => calls.recordMyAccountGameResult.push(r);
  const scheduleRematchAutoAdvance = () => { calls.scheduleRematchAutoAdvance++; };
  const stopRoundTimers = () => { calls.stopRoundTimers++; };
  const syncConfirmedIdsFromParticipants = () => { calls.syncConfirmedIdsFromParticipants++; };
  const getGameRound = () => state.gameRound || 1;
  const getTargetLoserCount = () => state.targetLoserCount || 1;
  const fetchFreshWrapped = (...args) => {
    calls.fetchFreshParticipantsForResult++;
    return (fetchFreshParticipantsForResult || (() => Promise.resolve([])))(...args);
  };
  const factory = new Function(
    'state', 'QA', 'db', 'getGameRound', 'getTargetLoserCount', 'getOnlineMode', 'judgeRound',
    'isConfirmedLoser', 'syncConfirmedIdsFromParticipants', 'renderRoundResult', 'showScreen',
    'playResultSfxOnce', 'playResultVoiceOnce', '__engineV2ShadowComputeRound', '__engineV2ShadowCompare',
    'recordMyAccountGameResult', 'scheduleRematchAutoAdvance', 'stopRoundTimers', 'fetchFreshParticipantsForResult',
    CHOICE_HELPERS_BLOCK + '\n' + FINISH_ROUND_LOCAL_SRC + '\n; return finishRoundLocal;'
  );
  const finishRoundLocal = factory(
    state, QA, db, getGameRound, getTargetLoserCount, getOnlineMode || (() => true),
    judgeRound || (() => ({})), isConfirmedLoser || (() => false), syncConfirmedIdsFromParticipants,
    renderRoundResult, showScreen, playResultSfxOnce, playResultVoiceOnce,
    __engineV2ShadowComputeRound, __engineV2ShadowCompare, recordMyAccountGameResult,
    scheduleRematchAutoAdvance, stopRoundTimers, fetchFreshWrapped
  );
  return { finishRoundLocal, calls, emitted };
}

function makeDb() {
  const calls = [];
  const db = {
    from: (table) => ({
      update: (payload) => ({
        eq: (col, val) => { calls.push({ table, payload, col, val }); return Promise.resolve({ data: null, error: null }); },
      }),
    }),
  };
  return { db, calls };
}

// ════════════════════════════════════════════════════════════════════
describe('Build29 [P3] finishRoundLocal 1-b — stale 마커 오염 정원충족 판정 보류', () => {
  it('(a) 순수 마커로만 구성된 정원충족 + activePlayers=0 → 렌더/DB쓰기 없이 보류(STALE_QUOTA_JUDGE_DEFERRED)', async () => {
    vi.useFakeTimers();
    try {
      // 실측 재현: 게임7 라운드1인데 게임6의 __safe__/__loser__ 마커가 되살아나 conf=2/2(target=2).
      const state = {
        role: 'host', status: 'result', round: 1, gameRound: 7, roomCode: 'R1', currentUserId: 'p3',
        confirmedSafeIds: [], confirmedLoserIds: ['p1', 'p2'], targetLoserCount: 2, finishingRound: false,
        lastRoundResolution: null,
        participants: [
          { id: 'p1', is_host: true, choice: '__loser__' },
          { id: 'p2', is_host: false, choice: '__loser__' },
          { id: 'p3', is_host: false, choice: '__safe__' }, // p3도 이미 이전 게임의 안전 마커로 오염
        ],
      };
      const { db, calls: dbCalls } = makeDb();
      const { finishRoundLocal, calls, emitted } = loadFinishRoundLocal({ state, db });
      await finishRoundLocal();

      expect(calls.renderRoundResult).toEqual([]); // 판정/렌더 없음
      expect(calls.showScreen).toEqual([]);
      expect(dbCalls).toEqual([]); // rooms.status='game_over' write도 나가지 않음
      expect(state.finishingRound).toBe(false); // 다음 재시도를 위해 해제됨
      expect(state.lastRoundResolution).toBe(null); // 캐시 기록 없음(오판 고착 방지)

      const deferred = emitted.find((e) => e.eventType === 'STALE_QUOTA_JUDGE_DEFERRED');
      expect(deferred).toBeTruthy();
      expect(deferred.wrps).toBe('WRPS-076');
      expect(deferred.eventId).toBe('7:1');
      expect(deferred.confirmedLoserCount).toBe(2);
      expect(deferred.targetCount).toBe(2);

      // Build28의 bounded 재시도 인프라를 재사용했는지 확인(새 타이머 메커니즘이 아님) — 재시도가
      // 실제로 1개 예약됐다.
      expect(vi.getTimerCount()).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('(b) 회귀 없음: activePlayers>0인 정당한 1-b 케이스(결함C)는 이 가드를 통과하지 못해 기존대로 gameOver로 처리된다', async () => {
    // tests/build28-round-judge-integrity.test.mjs 회귀 테스트 #3(결함C)과 동일한 시나리오 —
    // 술래 정원이 이미 찬 상태에서 잔여 활성 1명(draw)이 있는 케이스. activePlayers.length===1
    // 이므로 P3 가드의 activePlayers.length===0 조건이 거짓 → 가드가 발동하지 않아야 한다.
    const state = {
      role: 'host', status: 'playing', round: 1, gameRound: 7, roomCode: 'R1', currentUserId: 'p3',
      confirmedSafeIds: [], confirmedLoserIds: ['p1', 'p2'], targetLoserCount: 2, finishingRound: false,
      lastRoundResolution: null,
      participants: [
        { id: 'p1', is_host: true, choice: '__loser__' },
        { id: 'p2', is_host: false, choice: '__loser__' },
        { id: 'p3', is_host: false, choice: 'rock|draw' }, // 유일한 활성 참가자, draw
      ],
    };
    const { db } = makeDb();
    const { finishRoundLocal, calls, emitted } = loadFinishRoundLocal({ state, db });
    await finishRoundLocal();
    expect(calls.renderRoundResult).toEqual([{ caseType: 'gameOver', roundLoserCount: 0, remainingSlots: 0 }]);
    expect(emitted.some((e) => e.eventType === 'STALE_QUOTA_JUDGE_DEFERRED')).toBe(false);
    expect(emitted.some((e) => e.eventType === 'ROUND_GAMEOVER_SLOTS_FILLED')).toBe(true);
    expect(state.confirmedSafeIds).toEqual(['p3']);
  });

  it('(c) 회귀 없음: 실제 라운드 결과가 인코딩된 정당한 정원충족 재진입(activePlayers=0)은 P3 가드를 통과하지 못해 gameOver로 처리된다', async () => {
    // publishHostRoundResult()가 이미 "base|result"로 커밋한 뒤의 재진입(예: result→game_over
    // 2차 호출) — hasConfirmedRoundResult(p.choice)가 true인 row가 존재하므로 "정원이 순수
    // 마커로만 구성"이 아니다. P3 가드가 이 정당한 케이스까지 막으면 안 된다(HIGH 회귀 방지).
    const state = {
      role: 'host', status: 'result', round: 1, gameRound: 1, roomCode: 'R1', currentUserId: 'p1',
      confirmedSafeIds: ['p2', 'p3'], confirmedLoserIds: ['p1'], targetLoserCount: 1, finishingRound: false,
      lastRoundResolution: null,
      participants: [
        { id: 'p1', is_host: true, choice: 'rock|lose' },
        { id: 'p2', is_host: false, choice: 'paper|win' },
        { id: 'p3', is_host: false, choice: 'paper|win' },
      ],
    };
    const { db, calls: dbCalls } = makeDb();
    const { finishRoundLocal, calls, emitted } = loadFinishRoundLocal({ state, db });
    await finishRoundLocal();
    expect(calls.renderRoundResult).toEqual([{ caseType: 'gameOver', roundLoserCount: 0, remainingSlots: 0 }]);
    expect(calls.showScreen).toEqual(['screenRoundResult']);
    expect(emitted.some((e) => e.eventType === 'STALE_QUOTA_JUDGE_DEFERRED')).toBe(false);
    const roomsCall = dbCalls.find((c) => c.table === 'rooms');
    expect(roomsCall.payload.status).toBe('game_over');
  });

  it('(d) 재시도 후 신선한 데이터가 도착하면 정상 판정으로 이어진다(defer-retry 재사용 확인)', async () => {
    vi.useFakeTimers();
    try {
      const state = {
        role: 'host', status: 'result', round: 1, gameRound: 7, roomCode: 'R1', currentUserId: 'p3',
        confirmedSafeIds: [], confirmedLoserIds: ['p1', 'p2'], targetLoserCount: 2, finishingRound: false,
        lastRoundResolution: null,
        participants: [
          { id: 'p1', is_host: true, choice: '__loser__' },
          { id: 'p2', is_host: false, choice: '__loser__' },
          { id: 'p3', is_host: false, choice: '__safe__' },
        ],
      };
      const { db } = makeDb();
      // 재시도 시 fetchFreshParticipantsForResult가 게임7의 실제 신선 데이터(confirmedIds가 새로
      // 리셋된 상태에서 진짜 라운드1 결과)를 반환한다고 가정.
      const fetchFreshParticipantsForResult = async () => {
        state.confirmedSafeIds = [];
        state.confirmedLoserIds = [];
        state.participants = [
          { id: 'p1', is_host: true, choice: 'rock|lose' },
          { id: 'p2', is_host: false, choice: 'rock|lose' },
          { id: 'p3', is_host: false, choice: 'scissors|win' },
        ];
        return state.participants;
      };
      const { finishRoundLocal, calls, emitted } = loadFinishRoundLocal({ state, db, fetchFreshParticipantsForResult });
      await finishRoundLocal();
      expect(emitted.filter((e) => e.eventType === 'STALE_QUOTA_JUDGE_DEFERRED').length).toBe(1);

      await vi.advanceTimersByTimeAsync(400);

      expect(calls.renderRoundResult.length).toBe(1);
      expect(calls.renderRoundResult[0].caseType).toBe('gameOver');
      expect(state.confirmedLoserIds.sort()).toEqual(['p1', 'p2']);
      expect(state.confirmedSafeIds).toEqual(['p3']);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('Build29 비침습 계약(금지사항) — 판정 알고리즘/Build19~28 가드 무변경', () => {
  it('판정 순수함수 시그니처는 그대로 유지된다', () => {
    expect(html).toContain('function judgeRound(');
    expect(html).toContain('function resolveElimination(');
    expect(html).toContain('function judgePure(');
  });
  it('Build28 [수정1-a]/[수정1-b] 가드는 재작성되지 않았다(조건식 유지)', () => {
    expect(html).toMatch(/if \(activePlayers\.length === 0 && prevSafeIds\.length === 0 && prevLoserIds\.length === 0\)/);
    expect(html).toMatch(/if \(remainingSlots <= 0 && prevLoserIds\.length >= targetCount\)/);
  });
  it('defer 재시도 인프라(scheduleRoundJudgeDeferRetry)가 1-a/1-b 양쪽에서 공유된다(중복 타이머 금지)', () => {
    const occurrences = html.split('scheduleRoundJudgeDeferRetry()').length - 1;
    // 정의 1회 + 호출 2회(1-a, P3) = 최소 2회 호출
    expect(occurrences).toBeGreaterThanOrEqual(2);
    expect(html).toContain('const scheduleRoundJudgeDeferRetry = () => {');
  });
});
