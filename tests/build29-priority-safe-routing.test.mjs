import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

// Build29(WRPS-076) [P2] — 실기기 필드 QA에서 확인된 결함: handleRoomUpdate의 result/game_over
// 비종결(draw/tooMany/tooFew) 전이에는 안전/술래 확정자 라우팅 가드가 전혀 없었다(ready/playing
// 분기에는 이미 있었음) — 그래서 우선안전(이미 confirmedSafe/confirmedLoser) 참가자가 재경기
// result 전이마다 winnerWait/loserWait 대기화면에서 결과화면으로 튕겼다.
//
// Fix-1: finishRoundLocal()의 비종결 렌더 지점(draw/tooMany/tooFew, idempotent 재렌더의
// outcome!=="gameOver" 경우)만 소형 라우터(showRoundResultOrWait)로 교체 — gameOver(종결)는
// 무변경(전원이 최종 결과를 봐야 함).
// Fix-2: allDraw 분기에도 scheduleRematchAutoAdvance() 추가(Fix-1 적용 시 우선안전 호스트가
// 결과화면에 못 가 수동 "다시해!" 버튼에 접근할 수 없으므로 필수).
// Fix-3: scheduleRematchAutoAdvance 기본 지연 2600 → 1500ms(CEO 승인).
//
// 실제 소스 추출 + new Function() 실행 패턴(tests/build28-round-judge-integrity.test.mjs와 동일).

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

function extractBlock(startMarker, endMarker, includeEndFirstChar = false) {
  const start = html.indexOf(startMarker);
  if (start < 0) throw new Error(`start marker not found: ${startMarker}`);
  let end = html.indexOf(endMarker, start);
  if (end < 0) throw new Error(`end marker not found: ${endMarker}`);
  if (includeEndFirstChar) end += 1;
  return html.slice(start, end);
}

// isSafeParticipant/isConfirmedLoser부터 isNonPlayingChoice/getChoiceBase/getChoiceResult/
// hasConfirmedRoundResult까지 — 전부 state만 참조하는 순수 헬퍼라 그대로 실행 가능.
const CHOICE_HELPERS_BLOCK = extractBlock(
  'function isSafeParticipant(id = state.currentUserId) {',
  'function getParticipantSignature('
);
const FINISH_ROUND_LOCAL_SRC = extractBlock(
  'async function finishRoundLocal() {',
  '// 오프라인/프로토타입용 원본 finishRound'
);

function loadFinishRoundLocal({ state, db, judgeRound, getOnlineMode, fetchFreshParticipantsForResult, maybeRecoverStalledRematchAdvance }) {
  const calls = {
    renderRoundResult: [], showScreen: [], showLoserWaitScreen: 0, playResultSfxOnce: [], playResultVoiceOnce: [],
    shadowCompute: [], shadowCompare: [], recordMyAccountGameResult: [], scheduleRematchAutoAdvance: 0,
    stopRoundTimers: 0, syncConfirmedIdsFromParticipants: 0, fetchFreshParticipantsForResult: 0,
    maybeRecoverStalledRematchAdvance: 0, showTaggerPopup: 0, autoSaveGameOverResultOnce: 0,
  };
  const emitted = [];
  const QA = { emit: (channel, data) => emitted.push(data) };
  const renderRoundResult = (caseType, roundLoserCount, remainingSlots) =>
    calls.renderRoundResult.push({ caseType, roundLoserCount, remainingSlots });
  const showScreen = (id) => calls.showScreen.push(id);
  // Build30 Phase1: 확정 gameOver 렌더 직후 호출되는 술래 팝업 — 이 파일의 관심사(우선안전/
  // 라우팅)와 무관하므로 호출 여부만 카운트하는 no-op 스텁을 주입한다.
  const showTaggerPopup = () => { calls.showTaggerPopup++; };
  // Build30 Phase2: 확정 gameOver 시 이번 게임 결과 자동 저장 — 이 파일의 관심사와 무관하므로
  // 호출 여부만 카운트하는 no-op 스텁을 주입한다.
  const autoSaveGameOverResultOnce = () => { calls.autoSaveGameOverResultOnce++; };
  const showLoserWaitScreen = () => { calls.showLoserWaitScreen++; };
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
  const isConfirmedLoser = undefined; // 실제 소스(CHOICE_HELPERS_BLOCK)가 제공 — 스텁 불필요
  const fetchFreshWrapped = (...args) => {
    calls.fetchFreshParticipantsForResult++;
    return (fetchFreshParticipantsForResult || (() => Promise.resolve([])))(...args);
  };
  const maybeRecoverStalledRematchAdvanceWrapped = (...args) => {
    calls.maybeRecoverStalledRematchAdvance++;
    return (maybeRecoverStalledRematchAdvance || (() => {}))(...args);
  };
  const factory = new Function(
    'state', 'QA', 'db', 'getGameRound', 'getTargetLoserCount', 'getOnlineMode', 'judgeRound',
    'syncConfirmedIdsFromParticipants', 'renderRoundResult', 'showScreen', 'showLoserWaitScreen',
    'playResultSfxOnce', 'playResultVoiceOnce', '__engineV2ShadowComputeRound', '__engineV2ShadowCompare',
    'recordMyAccountGameResult', 'scheduleRematchAutoAdvance', 'stopRoundTimers', 'fetchFreshParticipantsForResult',
    'maybeRecoverStalledRematchAdvance', 'showTaggerPopup', 'autoSaveGameOverResultOnce',
    CHOICE_HELPERS_BLOCK + '\n' + FINISH_ROUND_LOCAL_SRC + '\n; return finishRoundLocal;'
  );
  const finishRoundLocal = factory(
    state, QA, db, getGameRound, getTargetLoserCount, getOnlineMode || (() => true),
    judgeRound || (() => ({})), syncConfirmedIdsFromParticipants,
    renderRoundResult, showScreen, showLoserWaitScreen, playResultSfxOnce, playResultVoiceOnce,
    __engineV2ShadowComputeRound, __engineV2ShadowCompare, recordMyAccountGameResult,
    scheduleRematchAutoAdvance, stopRoundTimers, fetchFreshWrapped, maybeRecoverStalledRematchAdvanceWrapped,
    showTaggerPopup, autoSaveGameOverResultOnce
  );
  return { finishRoundLocal, calls, emitted };
}

function makeDb() {
  const calls = [];
  const db = {
    from: (table) => ({
      update: (payload) => ({
        // WRPS-081: rooms.update()가 이제 .eq('id',...).eq('status','result')로 체이닝된다(조건부
        // game_over write) — 반환값이 thenable이면서 .eq()로 계속 체이닝 가능해야 한다.
        eq: (col, val) => { calls.push({ table, payload, col, val }); const result = Promise.resolve({ data: null, error: null }); result.eq = () => result; return result; },
      }),
    }),
  };
  return { db, calls };
}

describe('Build29 [P2, Fix-1] finishRoundLocal — 비종결 분기 우선안전/술래 라우팅', () => {
  it('(a) draw 재경기: 우선안전 참가자(iPlayedThisRound=false, confirmedSafe)는 결과화면 대신 winnerWait 유지', async () => {
    const state = {
      role: 'host', status: 'playing', round: 2, gameRound: 1, roomCode: 'R1', currentUserId: 'p1',
      confirmedSafeIds: ['p1'], confirmedLoserIds: [], targetLoserCount: 1, finishingRound: false,
      lastRoundResolution: null,
      participants: [
        { id: 'p1', is_host: true, choice: '__safe__' }, // 이미 안전 확정, 이번 라운드 미참여
        { id: 'p2', is_host: false, choice: 'rock' },
        { id: 'p3', is_host: false, choice: 'rock' }, // p2/p3 draw
      ],
    };
    const { db } = makeDb();
    const judgeRound = () => ({ p2: 'draw', p3: 'draw' });
    const { finishRoundLocal, calls } = loadFinishRoundLocal({ state, db, judgeRound });
    await finishRoundLocal();
    expect(calls.renderRoundResult).toEqual([{ caseType: 'draw', roundLoserCount: 0, remainingSlots: 1 }]);
    expect(calls.showScreen).toEqual(['screenWinnerWait']); // screenRoundResult로 튕기지 않음
    expect(calls.showLoserWaitScreen).toBe(0);
    // Fix-2: allDraw도 auto-advance가 예약된다(우선안전 호스트가 결과화면에 못 가므로 필수).
    expect(calls.scheduleRematchAutoAdvance).toBe(1);
  });

  it('(b) draw 재경기: 우선안전 "호스트"도 결과화면으로 튕기지 않는다(host라고 예외 없음)', async () => {
    const state = {
      role: 'host', status: 'playing', round: 2, gameRound: 1, roomCode: 'R1', currentUserId: 'hostP',
      confirmedSafeIds: ['hostP'], confirmedLoserIds: [], targetLoserCount: 1, finishingRound: false,
      lastRoundResolution: null,
      participants: [
        { id: 'hostP', is_host: true, choice: '__safe__' },
        { id: 'p2', is_host: false, choice: 'rock' },
        { id: 'p3', is_host: false, choice: 'rock' },
      ],
    };
    const { db } = makeDb();
    const judgeRound = () => ({ p2: 'draw', p3: 'draw' });
    const { finishRoundLocal, calls } = loadFinishRoundLocal({ state, db, judgeRound });
    await finishRoundLocal();
    expect(calls.showScreen).toEqual(['screenWinnerWait']);
  });

  it('(c) tooMany 재경기: 확정 술래(loser)는 결과화면 대신 loserWait 유지', async () => {
    const state = {
      role: 'host', status: 'playing', round: 2, gameRound: 1, roomCode: 'R1', currentUserId: 'p1',
      confirmedSafeIds: [], confirmedLoserIds: ['p1'], targetLoserCount: 2, finishingRound: false,
      lastRoundResolution: null,
      participants: [
        { id: 'p1', is_host: true, choice: '__loser__' }, // 이미 술래 확정, 이번 라운드 미참여
        // p2/p3/p4: 이번 라운드 활성자, 2패1승(target=2, remainingSlots=1이라 tooMany: 2 > 1)
        { id: 'p2', is_host: false, choice: 'rock' },
        { id: 'p3', is_host: false, choice: 'rock' },
        { id: 'p4', is_host: false, choice: 'paper' },
      ],
    };
    const { db } = makeDb();
    const judgeRound = () => ({ p2: 'lose', p3: 'lose', p4: 'win' });
    const { finishRoundLocal, calls } = loadFinishRoundLocal({ state, db, judgeRound });
    await finishRoundLocal();
    expect(calls.renderRoundResult).toEqual([{ caseType: 'tooMany', roundLoserCount: 2, remainingSlots: 1 }]);
    // showLoserWaitScreen 스텁은 (production과 달리) showScreen을 대신 호출하지 않으므로,
    // showScreen 자체는 호출되지 않고(대기화면 유지) showLoserWaitScreen만 호출됐는지로 검증한다.
    expect(calls.showScreen).toEqual([]);
    expect(calls.showLoserWaitScreen).toBe(1);
  });

  it('(d) tooFew 재경기: 이번 라운드 실제 참여자(iPlayedThisRound=true)는 종전대로 결과화면을 본다', async () => {
    // target=3, remainingSlots=3, 활성자 4명 > remainingSlots(3)이어야 "잔여 활성자<=remainingSlots
    // deadlock 즉시종료" 분기(7622 부근)를 타지 않는다. roundLosers(1: p1) < remainingSlots(3) → tooFew.
    const state = {
      role: 'host', status: 'playing', round: 1, gameRound: 1, roomCode: 'R1', currentUserId: 'p2',
      confirmedSafeIds: [], confirmedLoserIds: [], targetLoserCount: 3, finishingRound: false,
      lastRoundResolution: null,
      participants: [
        { id: 'p1', is_host: true, choice: 'rock' },
        { id: 'p2', is_host: false, choice: 'paper' },
        { id: 'p3', is_host: false, choice: 'paper' },
        { id: 'p4', is_host: false, choice: 'paper' },
      ],
    };
    const { db } = makeDb();
    const judgeRound = () => ({ p1: 'lose', p2: 'win', p3: 'win', p4: 'win' });
    const { finishRoundLocal, calls } = loadFinishRoundLocal({ state, db, judgeRound });
    await finishRoundLocal();
    expect(calls.renderRoundResult).toEqual([{ caseType: 'tooFew', roundLoserCount: 1, remainingSlots: 3 }]);
    expect(calls.showScreen).toEqual(['screenRoundResult']); // 참여자는 결과화면
    expect(calls.showLoserWaitScreen).toBe(0);
  });

  it('(e) 방금 안전(safe)이 된 사람(tooMany에서 막 승자 편입)은 결과화면을 1회 본다 — iPlayedThisRound 기준 우선 적용', async () => {
    // p4가 이번 라운드에 win해서 방금 confirmedSafeIds에 편입됐다 — "지금은 안전!"이라는 결과를
    // 반드시 봐야 한다(이전 대기화면으로 되돌아가면 안 됨).
    const state = {
      role: 'host', status: 'playing', round: 2, gameRound: 1, roomCode: 'R1', currentUserId: 'p4',
      confirmedSafeIds: [], confirmedLoserIds: [], targetLoserCount: 1, finishingRound: false,
      lastRoundResolution: null,
      participants: [
        { id: 'p1', is_host: true, choice: 'rock' },
        { id: 'p2', is_host: false, choice: 'rock' },
        { id: 'p3', is_host: false, choice: 'rock' },
        { id: 'p4', is_host: false, choice: 'paper' },
      ],
    };
    const { db } = makeDb();
    // target=1, remainingSlots=1, roundLosers(3: p1,p2,p3) > remainingSlots(1) → tooMany.
    const judgeRound = () => ({ p1: 'lose', p2: 'lose', p3: 'lose', p4: 'win' });
    const { finishRoundLocal, calls } = loadFinishRoundLocal({ state, db, judgeRound });
    await finishRoundLocal();
    expect(calls.renderRoundResult).toEqual([{ caseType: 'tooMany', roundLoserCount: 3, remainingSlots: 1 }]);
    expect(calls.showScreen).toEqual(['screenRoundResult']); // p4는 이번 라운드 참여자라 결과화면을 봄
  });

  it('(f) gameOver(종결) 분기는 이 라우터를 쓰지 않는다 — 우선안전이었던 사람도 최종 결과는 본다', async () => {
    const state = {
      role: 'host', status: 'playing', round: 2, gameRound: 1, roomCode: 'R1', currentUserId: 'hostP',
      confirmedSafeIds: ['hostP'], confirmedLoserIds: [], targetLoserCount: 1, finishingRound: false,
      lastRoundResolution: null,
      participants: [
        { id: 'hostP', is_host: true, choice: '__safe__' },
        { id: 'p2', is_host: false, choice: 'rock' },
        { id: 'p3', is_host: false, choice: 'paper' },
      ],
    };
    const { db } = makeDb();
    const judgeRound = () => ({ p2: 'lose', p3: 'win' });
    const { finishRoundLocal, calls } = loadFinishRoundLocal({ state, db, judgeRound });
    await finishRoundLocal();
    expect(calls.renderRoundResult).toEqual([{ caseType: 'gameOver', roundLoserCount: 1, remainingSlots: 1 }]);
    expect(calls.showScreen).toEqual(['screenRoundResult']); // 무변경 — 전원 결과화면
  });

  it('(g) idempotent 재렌더(비종결 outcome): 우선안전 참가자는 재생 시에도 결과화면으로 튕기지 않는다', async () => {
    const state = {
      role: 'participant', status: 'result', round: 1, gameRound: 1, roomCode: 'R1', currentUserId: 'p1',
      confirmedSafeIds: ['p1', 'p2'], confirmedLoserIds: [], targetLoserCount: 2, finishingRound: false,
      lastRoundResolution: {
        eventId: '1:1', confirmedSafeIds: ['p1', 'p2'], confirmedLoserIds: [],
        outcome: 'tooMany', roundLoserCount: 2, remainingSlots: 1,
      },
      participants: [
        { id: 'p1', is_host: false, choice: '__safe__' }, // 이번 라운드 미참여(이미 마커)
        { id: 'p2', is_host: false, choice: '__safe__' },
      ],
    };
    const { db } = makeDb();
    const { finishRoundLocal, calls, emitted } = loadFinishRoundLocal({ state, db });
    await finishRoundLocal();
    expect(emitted.some((e) => e.eventType === 'TAGGER_REPLAY_IDEMPOTENT')).toBe(true);
    expect(calls.renderRoundResult).toEqual([{ caseType: 'tooMany', roundLoserCount: 2, remainingSlots: 1 }]);
    expect(calls.showScreen).toEqual(['screenWinnerWait']); // 결과화면이 아니라 대기화면 유지
  });

  it('(h) idempotent 재렌더(gameOver): 무변경 — 항상 결과화면', async () => {
    const state = {
      role: 'participant', status: 'game_over', round: 1, gameRound: 1, roomCode: 'R1', currentUserId: 'p1',
      confirmedSafeIds: ['p1'], confirmedLoserIds: ['p2'], targetLoserCount: 1, finishingRound: false,
      lastRoundResolution: {
        eventId: '1:1', confirmedSafeIds: ['p1'], confirmedLoserIds: ['p2'],
        outcome: 'gameOver', roundLoserCount: 1, remainingSlots: 0,
      },
      participants: [
        { id: 'p1', is_host: false, choice: '__safe__' },
        { id: 'p2', is_host: false, choice: '__loser__' },
      ],
    };
    const { db } = makeDb();
    const { finishRoundLocal, calls } = loadFinishRoundLocal({ state, db });
    await finishRoundLocal();
    expect(calls.showScreen).toEqual(['screenRoundResult']);
  });
});

describe('Build29 [P2, Fix-3] scheduleRematchAutoAdvance 기본 지연', () => {
  it('기본 delayMs가 1500으로 변경됐다(2600 아님)', () => {
    expect(html).toMatch(/function scheduleRematchAutoAdvance\(delayMs = 1500\)/);
    expect(html).not.toMatch(/function scheduleRematchAutoAdvance\(delayMs = 2600\)/);
  });
});

describe('Build29 비침습 계약 — confirmedSafeIds/LoserIds는 라우팅에서 건드리지 않는다', () => {
  it('draw 비종결 라우팅 후에도 confirmedSafeIds/LoserIds 값은 그대로다(화면 전환만)', async () => {
    const state = {
      role: 'host', status: 'playing', round: 2, gameRound: 1, roomCode: 'R1', currentUserId: 'p1',
      confirmedSafeIds: ['p1'], confirmedLoserIds: [], targetLoserCount: 1, finishingRound: false,
      lastRoundResolution: null,
      participants: [
        { id: 'p1', is_host: true, choice: '__safe__' },
        { id: 'p2', is_host: false, choice: 'rock' },
        { id: 'p3', is_host: false, choice: 'rock' },
      ],
    };
    const { db } = makeDb();
    const { finishRoundLocal } = loadFinishRoundLocal({ state, db });
    await finishRoundLocal();
    expect(state.confirmedSafeIds).toEqual(['p1']);
    expect(state.confirmedLoserIds).toEqual([]);
  });
});
