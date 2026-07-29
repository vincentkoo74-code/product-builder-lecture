import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

// WRPS-080(STOP-SHIP, MEDIUM) — finishRoundLocal() 내부 await(참가자 win/loss/draw 통계
// Promise.all) 재개 시점의 세대 재확인. WRPS-079(handleRoomUpdate 재진입/ready 분기 commit
// 게이트)가 닫힌 뒤에도, finishRoundLocal() 자신이 이미 실행을 시작한 뒤 "자신의" 내부 await
// 도중 이 클라이언트의 다음 handleRoomUpdate(realtime 콜백/2.6초 폴링)가 먼저 완주해 방을 다음
// 라운드로 옮기면(nextRound() 등), 이 stale 호출이 재개 후 confirmedSafeIds/LoserIds를 자신의
// (낡은) 스냅샷으로 덮어쓰고 rooms.update({status:'game_over'})로 이미 진행된 방을 되돌린다 —
// index.html:4306-4325(hruGen 계약 선언부)가 "finishRoundLocal() 커밋 직전에만 이 세대를
// 재확인한다"고 이미 설계 의도를 명시했으나 실제 구현이 finishRoundLocal() 안에는 없었다.
//
// 이 파일은 REAL finishRoundLocal 소스를 그대로 추출해 실행한다(hand-copy 로직 검증 금지 —
// tests/build28-round-judge-integrity.test.mjs 등과 동일 패턴). 그리고 WRPS-080 게이트
// 블록만 정확히 잘라낸 "gate-removed" 변형을 같은 소스에서 파생시켜(별도 하드코딩 없이) 이
// 가드가 없으면 동일 시나리오가 다시 RED로 재발함을 mutation 부하검증으로 증명한다.

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

function extractBlock(startMarker, endMarker) {
  const start = html.indexOf(startMarker);
  if (start < 0) throw new Error(`start marker not found: ${startMarker}`);
  const end = html.indexOf(endMarker, start);
  if (end < 0) throw new Error(`end marker not found: ${endMarker}`);
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

// WRPS-080 가드 블록의 시작/끝 마커 — 이 커밋에서 finishRoundLocal에 추가한 코드 그대로다.
// 마커가 더 이상 발견되지 않으면(향후 리팩터로 문구가 바뀌면) 이 파일이 무엇을 검증하는지
// 스스로 알 수 없으므로 조용히 통과시키지 않고 즉시 실패한다.
const GUARD_START_MARKER = '// WRPS-080(STOP-SHIP, MEDIUM): 위 내부 await 재개 직후,';
const GUARD_END_MARKER = 'const prevSafeIds = [...(state.confirmedSafeIds || [])];';

function stripGuard(src) {
  const s = src.indexOf(GUARD_START_MARKER);
  if (s < 0) throw new Error('WRPS-080 guard start marker not found — finishRoundLocal 소스가 바뀌었다');
  const e = src.indexOf(GUARD_END_MARKER, s);
  if (e < 0) throw new Error('WRPS-080 guard end marker not found — finishRoundLocal 소스가 바뀌었다');
  return src.slice(0, s) + src.slice(e);
}

// "gate-removed" 변형: WRPS-080 재확인 블록만 제거하고 나머지는 100% 동일한 소스(mutation test).
const FINISH_ROUND_LOCAL_SRC_GATE_REMOVED = stripGuard(FINISH_ROUND_LOCAL_SRC);

function loadFinishRoundLocal(src, { state, db, judgeRound, getOnlineMode }) {
  const emitted = [];
  const QA = { emit: (channel, data) => emitted.push(data) };
  const calls = { renderRoundResult: [], showScreen: [] };
  const renderRoundResult = (caseType, roundLoserCount, remainingSlots) =>
    calls.renderRoundResult.push({ caseType, roundLoserCount, remainingSlots });
  const showScreen = (id) => calls.showScreen.push(id);
  const showTaggerPopup = () => {};
  const autoSaveGameOverResultOnce = () => {};
  const playResultSfxOnce = () => {};
  const playResultVoiceOnce = () => {};
  const __engineV2ShadowComputeRound = () => {};
  const __engineV2ShadowCompare = () => {};
  const recordMyAccountGameResult = () => {};
  const scheduleRematchAutoAdvance = () => {};
  const stopRoundTimers = () => {};
  const syncConfirmedIdsFromParticipants = () => {};
  const isConfirmedLoser = () => false;
  const getGameRound = () => state.gameRound || 1;
  const getTargetLoserCount = () => state.targetLoserCount || 1;
  const fetchFreshParticipantsForResult = () => Promise.resolve([]);
  const factory = new Function(
    'state', 'QA', 'db', 'getGameRound', 'getTargetLoserCount', 'getOnlineMode', 'judgeRound',
    'isConfirmedLoser', 'syncConfirmedIdsFromParticipants', 'renderRoundResult', 'showScreen',
    'playResultSfxOnce', 'playResultVoiceOnce', '__engineV2ShadowComputeRound', '__engineV2ShadowCompare',
    'recordMyAccountGameResult', 'scheduleRematchAutoAdvance', 'stopRoundTimers', 'fetchFreshParticipantsForResult',
    'showTaggerPopup', 'autoSaveGameOverResultOnce',
    CHOICE_HELPERS_BLOCK + '\n' + src + '\n; return finishRoundLocal;'
  );
  const finishRoundLocal = factory(
    state, QA, db, getGameRound, getTargetLoserCount, getOnlineMode, judgeRound,
    isConfirmedLoser, syncConfirmedIdsFromParticipants, renderRoundResult, showScreen,
    playResultSfxOnce, playResultVoiceOnce, __engineV2ShadowComputeRound, __engineV2ShadowCompare,
    recordMyAccountGameResult, scheduleRematchAutoAdvance, stopRoundTimers, fetchFreshParticipantsForResult,
    showTaggerPopup, autoSaveGameOverResultOnce
  );
  return { finishRoundLocal, calls, emitted };
}

// 시나리오: host, online, hasStoredResults=false(참가자 choice가 "base|result"로 인코딩되지
// 않음) & status==='playing' — finishRoundLocal 내부에서 유일하게 실행되는 await(참가자 통계
// Promise.all)가 실제로 발화하는 조건. p1 rock vs p2 scissors(judgeRound 스텁으로 고정), 술래
// 정원 1명 — 정상적으로는 이 라운드가 그대로 gameOver로 확정되어야 한다.
//
// raceFn: 참가자 통계 write(db.from('participants').update) 콜백이 실제로 실행되는 바로 그
// 시점(=내부 await 도중)에 호출된다 — "이 클라이언트의 다음 handleRoomUpdate가 먼저 완주해
// 방을 이미 다음 라운드로 옮겼다"를 흉내낸다(nextRound()가 round+1과 status:'ready'를 반영한
// 것과 동치).
function buildScenario(raceFn) {
  const state = {
    role: 'host', status: 'playing', round: 1, gameRound: 6, roomCode: 'R1', currentUserId: 'p1',
    confirmedSafeIds: [], confirmedLoserIds: [], targetLoserCount: 1, finishingRound: false,
    lastRoundResolution: null,
    participants: [
      { id: 'p1', is_host: true, choice: 'rock', wins: 0, losses: 0, draws: 0, penalties: 0 },
      { id: 'p2', is_host: false, choice: 'scissors', wins: 0, losses: 0, draws: 0, penalties: 0 },
    ],
  };
  const calls = [];
  let raced = false;
  const db = {
    from: (table) => ({
      update: (payload) => ({
        // WRPS-081: rooms.update()가 이제 .eq('id',...).eq('status','result')로 체이닝된다(조건부
        // game_over write) — 반환값이 thenable이면서 .eq()로 계속 체이닝 가능해야 한다.
        eq: (col, val) => {
          calls.push({ table, payload, col, val });
          if (table === 'participants' && !raced) {
            raced = true;
            raceFn(state);
          }
          const result = Promise.resolve({ data: null, error: null });
          result.eq = () => result;
          return result;
        },
      }),
    }),
  };
  const judgeRound = () => ({ p1: 'win', p2: 'lose' });
  const getOnlineMode = () => true;
  return { state, db, calls, judgeRound, getOnlineMode };
}

const RACE_TO_NEXT_ROUND = (state) => {
  state.round = 2;
  state.status = 'ready';
};

describe('WRPS-080 finishRoundLocal 내부 await 재개 시점 세대 재확인(STOP-SHIP)', () => {
  it('수정 전 재현(gate-removed mutation): 내부 await 도중 컨텍스트가 바뀌어도 stale 커밋이 그대로 game_over를 덮어쓴다(RED)', async () => {
    const { state, db, calls, judgeRound, getOnlineMode } = buildScenario(RACE_TO_NEXT_ROUND);
    const { finishRoundLocal } = loadFinishRoundLocal(FINISH_ROUND_LOCAL_SRC_GATE_REMOVED, { state, db, judgeRound, getOnlineMode });
    await finishRoundLocal();
    const roomWrites = calls.filter((c) => c.table === 'rooms');
    // 결함 재현: 방은 이미 round=2/status='ready'로 넘어갔는데(raceFn), 이 stale 호출이 그걸
    // 무시하고 game_over를 덮어쓴다.
    expect(roomWrites.length).toBeGreaterThan(0);
    expect(roomWrites[0].payload).toEqual({ status: 'game_over' });
    expect(state.confirmedLoserIds).toEqual(['p2']);
  });

  it('수정 후(현재 소스): 내부 await 도중 컨텍스트가 바뀌면 stale 커밋을 포기한다 — gameOver DB write 0, 게임 진행 정지 없음', async () => {
    const { state, db, calls, judgeRound, getOnlineMode } = buildScenario(RACE_TO_NEXT_ROUND);
    const { finishRoundLocal, emitted } = loadFinishRoundLocal(FINISH_ROUND_LOCAL_SRC, { state, db, judgeRound, getOnlineMode });
    await finishRoundLocal();
    const roomWrites = calls.filter((c) => c.table === 'rooms');
    expect(roomWrites).toEqual([]); // stale 컨텍스트로 rooms.game_over를 쓰지 않는다
    expect(state.finishingRound).toBe(false); // 재진입 가드가 풀려 다음 정당한 호출을 막지 않는다(불변식: 게임 진행 정지 금지)
    // 새 컨텍스트(더 최신 handleRoomUpdate가 이미 확정한 round=2/status='ready')는 이 stale
    // 호출이 건드리지 않았어야 한다 — 정당한 최신 경로의 결과를 stale 호출이 덮어쓰지 않음.
    expect(state.round).toBe(2);
    expect(state.status).toBe('ready');
    const aborted = emitted.find((e) => e.eventType === 'FINISH_ROUND_LOCAL_STALE_GENERATION_ABORTED');
    expect(aborted).toBeTruthy();
    expect(aborted.wrps).toBe('WRPS-080');
  });

  it('회귀 없음: 컨텍스트가 바뀌지 않으면(레이스 없음) 종전과 동일하게 정상적으로 gameOver를 커밋한다', async () => {
    const { state, db, calls, judgeRound, getOnlineMode } = buildScenario(() => {}); // raceFn no-op
    const { finishRoundLocal, calls: renderCalls, emitted } = loadFinishRoundLocal(FINISH_ROUND_LOCAL_SRC, { state, db, judgeRound, getOnlineMode });
    await finishRoundLocal();
    const roomWrites = calls.filter((c) => c.table === 'rooms');
    expect(roomWrites.length).toBe(1);
    expect(roomWrites[0].payload).toEqual({ status: 'game_over' });
    expect(state.confirmedLoserIds).toEqual(['p2']);
    expect(state.confirmedSafeIds).toEqual(['p1']);
    expect(renderCalls.renderRoundResult).toEqual([{ caseType: 'gameOver', roundLoserCount: 1, remainingSlots: 1 }]);
    expect(state.finishingRound).toBe(false);
    expect(emitted.some((e) => e.eventType === 'FINISH_ROUND_LOCAL_STALE_GENERATION_ABORTED')).toBe(false);
  });
});
