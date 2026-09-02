import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { maxLoserCountFor } from '../src/game-logic.mjs';

// WRPS-081(STOP-SHIP, HIGH) — becomeNextHost() 호스트 이관 중 2-writer 레이스.
//
// critic 규명: 표준 "다음 호스트" 벌칙 흐름에서, 술래(패자)가 게임 종료를 로컬로 확정한 직후(자신의
// finishRoundLocal이 hasStoredResults/localJudge로 결과를 독립 계산 — old host의 DB write 도착과
// 무관) becomeNextHost()를 눌러 호스트를 승계하면, becomeNextHost()(index.html ~10730-10750)는
// room 상태를 재확인하지 않고 즉시 is_host write + beginNewGameRound({status:"waiting", round:1,
// 새 penalty})를 커밋한다. 한편 old host의 finishRoundLocal()이 커밋하는 game_over write
// (index.html ~8446/8469/8515)는 "blind" write였다 — status 컬럼만 조건 없이 덮어쓴다. old host의
// 이 write가 new host의 write보다 "늦게"(네트워크 지연 등으로) 커밋되면, round/penalty는 새 게임
// 값 그대로인 채 status만 다시 'game_over'로 되돌리는 모순 행이 만들어진다. 제3자 참가자의
// handleRoomUpdate는 `oldStatus !== state.status` 게이트(index.html ~5757)로 화면 재렌더를
// 트리거하는데, 이 제3자가 이미(이번 게임의 정당한 종료로) status='game_over'를 관측한 상태였다면
// oldStatus==='game_over'===새 status → 게이트가 무변화로 판단해 전혀 재발화하지 않는다.
// gameRound/round/confirmedIds는 게이트 "이전"(무조건 실행부, index.html ~5650-5719)에서 이미
// 갱신되므로 내부적으로는 새 게임이 시작됐지만, 화면은 정지한다("게임 진행 안 됨").
//
// 이 파일은 REAL 소스를 그대로 추출해 실행한다(hand-copy 로직 검증 금지):
//   - becomeNextHost/beginNewGameRound(및 그 의존 헬퍼: hasCurrentGameRoundActivity,
//     archiveCurrentRoundStats, resetLocalParticipantsForNewGameRound 등 — 4940~5281 연속 구간)
//   - handleRoomUpdate(제3자의 stale-row guard + phase dispatch 게이트)
//   - finishRoundLocal 전체(WRPS-080 테스트와 동일 마커) — 조건부 game_over write와 로컬 렌더
//     (태거 팝업/autoSave/SFX)의 상호작용 회귀 검증용
//   - game_over write 문장 자체(3곳, `await db.from('rooms').update({ status: 'game_over' })`
//     앵커로 추출 — Phase1 수정이 이 문장 뒤에 `.eq(...)`를 추가해도 앵커가 살아남는다)
//
// §7(확신 낮은 부분)은 파일 하단 참고.

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

function extractBlock(startMarker, endMarker, label) {
  const start = html.indexOf(startMarker);
  if (start < 0) throw new Error(`[wrps081] start marker not found (${label}): ${startMarker}`);
  const end = html.indexOf(endMarker, start + startMarker.length);
  if (end < 0) throw new Error(`[wrps081] end marker not found (${label}): ${endMarker}`);
  return html.slice(start, end);
}

// ── REAL 추출: 공용 헬퍼 ──────────────────────────────────────────────────────
// WRPS-083 2B: 아래 REAL 블록이 destroyed 공통 가드(isRoomClosingOrDestroyed)를 호출한다.
// hand-copy/no-op stub 금지 — index.html 원문을 함께 추출한다.
const ROOM_GUARD_SRC = extractBlock(
  'function isRoomClosingOrDestroyed() {', 'function isJoinLocked(', 'roomGuard'
);
const PARSE_AND_SCHEDULE_SRC = extractBlock(
  'function toPositiveInt(value, fallback = 0) {', 'function $(id) {', 'parseAndSchedule'
);
const GET_ONLINE_MODE_SRC = extractBlock(
  'function getOnlineMode() {', 'function clearRealtime() {', 'getOnlineMode'
);
const UPDATE_ROOM_PENALTY_CAS_SRC = extractBlock(
  'async function updateRoomPenaltyCas(', '// Build19: RESULT/READY', 'updateRoomPenaltyCas'
);
// isSafeParticipant부터 waitForPhaseRender 직전까지: choice 헬퍼 + hasCurrentGameRoundActivity +
// shouldResetForParticipantChange + getNewGameRoundParticipantPatch + resetLocalParticipantsForNewGameRound +
// archiveCurrentRoundStats(+통계 조회 헬퍼들) + beginNewGameRound 전부를 단일 연속 구간으로 포함한다.
const ROUND_HELPERS_AND_BEGIN_NEW_GAME_ROUND_SRC = extractBlock(
  'function isSafeParticipant(id = state.currentUserId) {',
  'async function waitForPhaseRender(phase, scheduledAt, clientReceivedTs) {',
  'roundHelpersAndBeginNewGameRound'
);
const BECOME_NEXT_HOST_SRC = extractBlock(
  'async function becomeNextHost() {', 'function startGameOverCountdown(seconds) {', 'becomeNextHost'
);
// WRPS-083 1단계: becomeNextHost가 이제 promoteParticipantToHost/verifyExactlyOneHost(승격
// 성공 확인 + exactly-one 사후 검증, index.html의 REAL 헬퍼)를 호출하므로 그 블록도 그대로
// 추출해 함께 구동한다 — 스텁이 아니라 프로덕션 소스다.
const HOST_SAFETY_HELPERS_SRC = extractBlock(
  'function pickDeterministicHostCandidate(rows) {', 'async function leaveRoom() {', 'hostSafetyHelpers'
);
const HANDLE_ROOM_UPDATE_SRC = extractBlock(
  'async function handleRoomUpdate(room) {', 'function renderInlinePenaltyBox(el) {', 'handleRoomUpdate'
);

const COMBINED_FOR_HANDOVER = [
  PARSE_AND_SCHEDULE_SRC, GET_ONLINE_MODE_SRC, UPDATE_ROOM_PENALTY_CAS_SRC,
  ROUND_HELPERS_AND_BEGIN_NEW_GAME_ROUND_SRC,
  HOST_SAFETY_HELPERS_SRC, BECOME_NEXT_HOST_SRC, HANDLE_ROOM_UPDATE_SRC,
].join('\n');

// ── REAL 추출: finishRoundLocal 전체(WRPS-080 테스트와 동일 마커 — 이 파일과 완전히 독립적으로
// 소스가 바뀌어도 두 파일이 서로 다른 이유로 실패해 드리프트를 즉시 알 수 있다) ──────────────────
const CHOICE_HELPERS_BLOCK = extractBlock(
  'function isNonPlayingChoice(choice) {', 'function getParticipantSignature(', 'choiceHelpers'
);
const FINISH_ROUND_LOCAL_SRC = extractBlock(
  'async function finishRoundLocal() {', '// 오프라인/프로토타입용 원본 finishRound', 'finishRoundLocal'
);

// ── REAL 추출: game_over write 문장 자체(3곳) ─────────────────────────────────
// 앵커를 payload 프리픽스로 고정해, Phase1 수정이 뒤에 `.eq(...)`를 추가해도(또는 향후 더 추가해도)
// 계속 이 문장을 찾아낸다. 세미콜론까지 캡처해 문장 전체(모든 .eq() 체인 포함)를 가져온다.
function extractGameOverWriteStatements() {
  const anchor = "await db.from('rooms').update({ status: 'game_over' })";
  const out = [];
  let from = 0;
  for (;;) {
    const start = html.indexOf(anchor, from);
    if (start < 0) break;
    const semi = html.indexOf(';', start);
    if (semi < 0) throw new Error('[wrps081] game_over write statement not terminated');
    out.push(html.slice(start, semi + 1));
    from = semi + 1;
  }
  return out;
}
const GAME_OVER_WRITE_STATEMENTS = extractGameOverWriteStatements();

describe('WRPS-081 fidelity self-check — game_over write 문장 3곳', () => {
  it('3곳 모두 발견되고 서로 바이트 동일하다(다른 곳만 고쳐 편차 발생 금지)', () => {
    expect(GAME_OVER_WRITE_STATEMENTS.length).toBe(3);
    expect(GAME_OVER_WRITE_STATEMENTS[1]).toBe(GAME_OVER_WRITE_STATEMENTS[0]);
    expect(GAME_OVER_WRITE_STATEMENTS[2]).toBe(GAME_OVER_WRITE_STATEMENTS[0]);
  });

  it("현재 소스는 조건부 UPDATE(.eq('status', 'result'))를 포함한다(Phase1 수정 적용 확인)", () => {
    expect(GAME_OVER_WRITE_STATEMENTS[0]).toContain(".eq('status', 'result')");
  });
});

// ── 호스트 이관 2-writer 레이스: becomeNextHost/beginNewGameRound + handleRoomUpdate 통합 실행 ──

function buildHandoverImpl({ state, db }) {
  const calls = { showHostRoom: 0, showScreen: [], scheduleFetchParticipants: 0, renderAll: 0 };
  const QA = { emit: () => {} };
  const resetTransientRoundUi = () => {};
  const stopGameOverCountdown = () => {};
  const saveState = () => {};
  const showHostRoom = () => { calls.showHostRoom += 1; };
  const showScreen = (id) => { calls.showScreen.push(id); };
  const scheduleFetchParticipants = () => { calls.scheduleFetchParticipants += 1; };
  const renderAll = () => { calls.renderAll += 1; };

  // WRPS-083 1단계 대응: becomeNextHost 실패 경로가 showToast(t(...))를 호출하므로 렌더 표면
  // 스텁 2개를 추가 주입한다(성공 경로에서는 호출되지 않음 — 이 파일의 시나리오는 성공 경로).
  const showToast = () => {};
  const t = (key) => key;
  const factory = new Function(
    'state', 'db', 'QA', 'resetTransientRoundUi', 'stopGameOverCountdown', 'saveState',
    'showHostRoom', 'showScreen', 'scheduleFetchParticipants', 'renderAll', 'maxLoserCountFor',
    'showToast', 't',
    `${ROOM_GUARD_SRC}\n${COMBINED_FOR_HANDOVER}\n; return { beginNewGameRound, becomeNextHost, handleRoomUpdate, getGameRound, getPenaltyGameRound };`
  );
  const impl = factory(
    state, db, QA, resetTransientRoundUi, stopGameOverCountdown, saveState,
    showHostRoom, showScreen, scheduleFetchParticipants, renderAll, maxLoserCountFor,
    showToast, t
  );
  return { impl, calls };
}

// 공유 room 행에 대해 Supabase 스타일 `.update(patch).eq(a,b).eq(c,d)...` 조건부 매치를 흉내낸다.
// 모든 조건이 현재 행과 일치해야 patch가 적용된다(하나라도 불일치면 0행 매치, no-op) — 정확히
// 우리가 검증하려는 조건부 UPDATE 시맨틱.
function makeConditionalRoomsDb(roomRow, { onWrite, participantRows } = {}) {
  // WRPS-083 1단계 대응: 시나리오(alice=old host, bob=loser, charlie=관찰자)와 동일한 참가자
  // row 스토어. created_at은 결정 규칙 검증과 무관하게 실제 스키마 형태만 갖춘다.
  const participantRowsStore = participantRows || [
    { id: 'alice', is_host: true, created_at: '2026-01-01T00:00:00.000Z' },
    { id: 'bob', is_host: false, created_at: '2026-01-01T00:00:05.000Z' },
    { id: 'charlie', is_host: false, created_at: '2026-01-01T00:00:10.000Z' },
  ];
  return {
    from(table) {
      if (table === 'rooms') {
        return {
          update(patch) {
            const conditions = [];
            const builder = {
              eq(col, val) { conditions.push([col, val]); return builder; },
              or(expression) {
                if (expression === 'penalty.is.null,penalty.eq.') conditions.push(['__emptyPenalty', true]);
                return builder;
              },
              select() { return exec(); },
              then(resolve, reject) { return exec().then(resolve, reject); },
            };
            async function exec() {
              const matched = conditions.every(([col, val]) =>
                col === '__emptyPenalty' ? (roomRow.penalty == null || roomRow.penalty === '') : roomRow[col] === val
              );
              if (matched) Object.assign(roomRow, patch);
              if (onWrite) onWrite({ patch, conditions, matched, rowAfter: { ...roomRow } });
              return { data: matched ? [{ ...roomRow }] : [], error: null };
            }
            return builder;
          },
          select() {
            return { eq: () => ({ single: async () => ({ data: { ...roomRow }, error: null }) }) };
          },
        };
      }
      if (table === 'participants') {
        // WRPS-083 1단계 대응: becomeNextHost가 promoteParticipantToHost(승격 write 후 대상 row
        // 재조회로 성공 확인)와 verifyExactlyOneHost(is_host row 목록 재조회 + 수렴)를 호출하므로,
        // 이전의 무조건 no-op ack 대신 실제 row 스토어에 대해 update/select(.single/.order) 체인을
        // 지원한다. write가 항상 성공하는 의미는 종전과 동일 — 이 파일의 관심사(rooms 2-writer
        // 레이스)는 그대로 보존된다.
        const makeBuilder = (op, patch) => {
          const filters = [];
          const b = {
            _single: false,
            eq(col, val) { filters.push([col, val]); return b; },
            order() { return b; },
            single() { b._single = true; return b; },
            then(resolve, reject) { return exec().then(resolve, reject); },
          };
          async function exec() {
            // 단일 방 하니스: room_id 필터는 항상 매치로 취급한다(row에 room_id 필드 없음).
            const rows = participantRowsStore.filter((r) => filters.every(([col, val]) => col === 'room_id' ? true : r[col] === val));
            if (op === 'update') { rows.forEach((r) => Object.assign(r, patch)); return { data: null, error: null }; }
            if (op === 'delete') { for (const r of rows) participantRowsStore.splice(participantRowsStore.indexOf(r), 1); return { data: null, error: null }; }
            const copies = rows.map((r) => ({ ...r }));
            if (b._single) {
              return copies.length === 1
                ? { data: copies[0], error: null }
                : { data: null, error: { code: 'PGRST116', message: '[wrps081] expected 1 row, got ' + copies.length } };
            }
            return { data: copies, error: null };
          }
          return b;
        };
        return {
          update: (patch) => makeBuilder('update', patch),
          delete: () => makeBuilder('delete'),
          select: () => makeBuilder('select'),
        };
      }
      throw new Error('[wrps081] unsupported table: ' + table);
    },
  };
}

// 순수 텍스트 치환으로 "gate-removed" mutation(조건 제거)을 파생시킨다 — 손으로 다시 짠 로직이
// 아니라 REAL 소스에서 해당 조건만 정확히 잘라낸 변형.
function stripStatusResultCondition(writeStatement) {
  const stripped = writeStatement.replace(".eq('status', 'result')", '');
  if (stripped === writeStatement) {
    throw new Error('[wrps081] status-result condition not found to strip — 소스가 바뀌었다');
  }
  return stripped;
}

function makeAliceGameOverWriteFn(writeStatementText) {
  return new Function(
    'db', 'state', 'getOnlineMode',
    '"use strict";\n' +
    'return (async function(){ if (getOnlineMode() && state.role === "host") {\n' +
    writeStatementText + '\n} })();'
  );
}

function runHandoverScenario({ aliceWriteStatementText }) {
  // 초기 상태: 게임(gameRound=5)이 방금 라운드1에서 끝나 host(Alice)가 status='result'를 이미
  // 커밋해둔 상태(finishRoundLocal이 이제 막 game_over write를 시도하려는 시점).
  const roomRow = { id: 'ROOM1', status: 'result', round: 1, penalty: '' };
  const roomWrites = [];
  const db = makeConditionalRoomsDb(roomRow, { onWrite: (w) => roomWrites.push(w) });

  // Bob(패자, loser) — 자신의 로컬 finishRoundLocal이 이미 gameOver를 독립 계산해 "다음 호스트
  // 되기" 버튼을 렌더했다(old host의 DB write 도착과 무관 — 실제 앱과 동일하게 이 하니스도 그
  // 렌더 자체는 재현하지 않고 becomeNextHost() 클릭 효과만 직접 호출한다).
  const bobState = {
    role: 'participant', currentUserId: 'bob', roomCode: 'ROOM1',
    status: 'result', round: 1, gameRound: 5, penalty: '',
    targetLoserCount: 1, confirmedSafeIds: [], confirmedLoserIds: [],
    participants: [
      { id: 'alice', is_host: true, wins: 0, losses: 0, draws: 0, penalties: 0 },
      { id: 'bob', is_host: false, wins: 0, losses: 0, draws: 0, penalties: 0 },
    ],
  };
  const { impl: bobImpl } = buildHandoverImpl({ state: bobState, db });

  // Charlie(제3자 관찰자) — 이번 게임(gameRound=5)의 정당한 종료(status='game_over')를 이미
  // 관측한 상태(oldStatus 기준선). handleRoomUpdate를 다시 호출하지 않고 이 baseline을 state로
  // 직접 구성한다(그 관측 자체는 이 테스트의 관심사가 아니므로 재-실행하지 않음).
  const charlieState = {
    role: 'participant', currentUserId: 'charlie', roomCode: 'ROOM1',
    status: 'game_over', round: 1, gameRound: 5, penalty: '',
    targetLoserCount: 1, confirmedSafeIds: ['alice'], confirmedLoserIds: ['bob'],
    participants: [
      { id: 'alice', is_host: true }, { id: 'bob', is_host: false }, { id: 'charlie', is_host: false },
    ],
  };
  const { impl: charlieImpl, calls: charlieCalls } = buildHandoverImpl({ state: charlieState, db });

  const aliceState = { role: 'host', roomCode: 'ROOM1' };
  const getOnlineMode = () => Boolean(db);
  const aliceWriteFn = makeAliceGameOverWriteFn(aliceWriteStatementText);

  return { roomRow, roomWrites, bobImpl, bobState, charlieImpl, charlieCalls, charlieState, aliceWriteFn, aliceState, db, getOnlineMode };
}

describe('WRPS-081 host-handover 2-writer race(STOP-SHIP): becomeNextHost 커밋 이후 old host의 늦은 game_over write', () => {
  it('Phase0 재현(gate-removed mutation): 조건 없는 blind write는 모순 행을 만들고 제3자 디스패치가 정지한다(RED)', async () => {
    const brokenWriteText = stripStatusResultCondition(GAME_OVER_WRITE_STATEMENTS[0]);
    const s = runHandoverScenario({ aliceWriteStatementText: brokenWriteText });

    // 순서: Bob이 먼저 완전히 커밋(새 게임: round=1/status=waiting/새 penalty) → 그 다음(원인:
    // "늦게" 커밋) Alice의 game_over write가 status만 되돌린다. await 순서 자체가 결정론적 훅이다
    // (확률적 지연에 기대지 않음 — 두 write의 시작이 아니라 "완료 순서"를 프로그램 순서로 강제).
    await s.bobImpl.becomeNextHost();
    expect(s.roomRow).toEqual(expect.objectContaining({ status: 'waiting', round: 1 }));
    await s.aliceWriteFn(s.db, s.aliceState, s.getOnlineMode);

    // 모순 행: status='game_over'인데 round/penalty는 새 게임(gameRound=6) 그대로.
    expect(s.roomRow.status).toBe('game_over');
    expect(s.roomRow.round).toBe(1);
    const { getPenaltyGameRound } = buildHandoverImpl({ state: {}, db: s.db }).impl;
    expect(getPenaltyGameRound(s.roomRow.penalty)).toBe(6); // 새 게임(이전 5에서 증가)

    await s.charlieImpl.handleRoomUpdate({ ...s.roomRow });
    // 내부 값은 갱신되지만(불변식 위반 그 자체 — 화면과 내부 상태가 어긋남)...
    expect(s.charlieState.gameRound).toBe(6);
    expect(s.charlieState.round).toBe(1);
    // ...oldStatus(game_over) === 새 status(game_over)라 디스패치가 전혀 재발화하지 않는다(정지).
    expect(s.charlieState.status).toBe('game_over');
    expect(s.charlieCalls.showScreen).toEqual([]);
    expect(s.charlieCalls.scheduleFetchParticipants).toBe(0);
  });

  it('Phase1 수정 후(현재 소스): old host의 write가 조건부라 이미 새 게임으로 넘어간 방을 덮어쓰지 못한다 — 모순 없음, 제3자 디스패치 정상 재발화(GREEN)', async () => {
    const s = runHandoverScenario({ aliceWriteStatementText: GAME_OVER_WRITE_STATEMENTS[0] });

    await s.bobImpl.becomeNextHost();
    expect(s.roomRow).toEqual(expect.objectContaining({ status: 'waiting', round: 1 }));
    await s.aliceWriteFn(s.db, s.aliceState, s.getOnlineMode);

    // Alice의 write는 0행 매치(현재 status가 'result'가 아니라 'waiting') → no-op.
    expect(s.roomWrites.at(-1).matched).toBe(false);
    expect(s.roomRow.status).toBe('waiting'); // 되돌려지지 않음 — 모순 없음
    expect(s.roomRow.round).toBe(1);

    await s.charlieImpl.handleRoomUpdate({ ...s.roomRow });
    expect(s.charlieState.status).toBe('waiting'); // 진짜 전이(game_over → waiting)
    expect(s.charlieState.gameRound).toBe(6);
    // 디스패치가 정상적으로 재발화해 참가자 대기화면으로 라우팅한다 — 정지 없음.
    expect(s.charlieCalls.showScreen).toEqual(['screenParticipantWait']);
    expect(s.charlieCalls.scheduleFetchParticipants).toBe(1);
  });

  it('mutation 부하검증: 현재 소스에서 조건만 다시 제거하면(수동 회귀) 동일 시나리오가 RED로 재발한다', async () => {
    const revertedWriteText = stripStatusResultCondition(GAME_OVER_WRITE_STATEMENTS[0]);
    const s = runHandoverScenario({ aliceWriteStatementText: revertedWriteText });
    await s.bobImpl.becomeNextHost();
    await s.aliceWriteFn(s.db, s.aliceState, s.getOnlineMode);
    expect(s.roomRow.status).toBe('game_over'); // 다시 덮어씀 — 조건이 실제로 load-bearing임을 증명
    await s.charlieImpl.handleRoomUpdate({ ...s.roomRow });
    expect(s.charlieCalls.showScreen).toEqual([]); // 다시 정지
  });
});

// ── finishRoundLocal 레벨 회귀: 조건부 UPDATE가 정상 확정/idempotent 재진입/로컬 렌더를 깨지 않는지 ──

function loadFinishRoundLocal(src, { state, db, judgeRound, getOnlineMode }) {
  const emitted = [];
  const QA = { emit: (channel, data) => emitted.push(data) };
  const calls = {
    renderRoundResult: [], showScreen: [], showTaggerPopup: 0, autoSaveGameOverResultOnce: 0,
    playResultSfxOnce: [], playResultVoiceOnce: [],
  };
  const renderRoundResult = (caseType, roundLoserCount, remainingSlots) =>
    calls.renderRoundResult.push({ caseType, roundLoserCount, remainingSlots });
  const showScreen = (id) => calls.showScreen.push(id);
  const showTaggerPopup = () => { calls.showTaggerPopup += 1; };
  const autoSaveGameOverResultOnce = () => { calls.autoSaveGameOverResultOnce += 1; };
  const playResultSfxOnce = (...args) => calls.playResultSfxOnce.push(args);
  const playResultVoiceOnce = (...args) => calls.playResultVoiceOnce.push(args);
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

// WRPS-080 테스트와 동일한 시나리오(host, hasStoredResults=false, p1 rock vs p2 scissors,
// targetLoserCount=1) — roundLosers.length===remainingSlots 분기(3번째 game_over write 지점,
// index.html ~8511-8516)를 결정론적으로 태운다.
function buildFinishRoundScenario(initialRoomStatus) {
  const state = {
    role: 'host', status: 'playing', round: 1, gameRound: 6, roomCode: 'R1', currentUserId: 'p1',
    confirmedSafeIds: [], confirmedLoserIds: [], targetLoserCount: 1, finishingRound: false,
    lastRoundResolution: null,
    participants: [
      { id: 'p1', is_host: true, choice: 'rock', wins: 0, losses: 0, draws: 0, penalties: 0 },
      { id: 'p2', is_host: false, choice: 'scissors', wins: 0, losses: 0, draws: 0, penalties: 0 },
    ],
  };
  const roomRow = { id: 'R1', status: initialRoomStatus };
  const roomWrites = [];
  const participantWrites = [];
  const db = {
    from(table) {
      if (table === 'rooms') {
        return {
          update(patch) {
            const conditions = [];
            const builder = {
              eq(col, val) { conditions.push([col, val]); return builder; },
              then(resolve, reject) { return exec().then(resolve, reject); },
            };
            async function exec() {
              const matched = conditions.every(([col, val]) => roomRow[col] === val);
              if (matched) Object.assign(roomRow, patch);
              roomWrites.push({ patch, conditions, matched });
              return { data: matched ? [{ ...roomRow }] : [], error: null };
            }
            return builder;
          },
        };
      }
      if (table === 'participants') {
        return { update: (patch) => ({ eq: async (col, val) => { participantWrites.push({ patch, col, val }); return { data: null, error: null }; } }) };
      }
      throw new Error('[wrps081] unsupported table: ' + table);
    },
  };
  const judgeRound = () => ({ p1: 'win', p2: 'lose' });
  const getOnlineMode = () => true;
  return { state, db, roomRow, roomWrites, participantWrites, judgeRound, getOnlineMode };
}

describe('WRPS-081 회귀: finishRoundLocal 레벨 — 정상 확정 / idempotent 재진입 / 로컬 렌더 지속', () => {
  it('정상 gameOver 확정(room이 아직 result): write가 정상 적용되고 로컬 렌더 전부 실행된다(회귀 없음)', async () => {
    const s = buildFinishRoundScenario('result');
    const { finishRoundLocal, calls } = loadFinishRoundLocal(FINISH_ROUND_LOCAL_SRC, s);
    await finishRoundLocal();

    expect(s.roomWrites.length).toBe(1);
    expect(s.roomWrites[0].matched).toBe(true);
    expect(s.roomRow.status).toBe('game_over');
    expect(s.state.confirmedLoserIds).toEqual(['p2']);
    expect(s.state.confirmedSafeIds).toEqual(['p1']);
    expect(calls.renderRoundResult).toEqual([{ caseType: 'gameOver', roundLoserCount: 1, remainingSlots: 1 }]);
    expect(calls.showScreen).toEqual(['screenRoundResult']);
    expect(calls.showTaggerPopup).toBe(1);
    expect(calls.autoSaveGameOverResultOnce).toBe(1);
    expect(calls.playResultSfxOnce.length).toBe(1);
    expect(calls.playResultVoiceOnce.length).toBe(1);
    expect(s.state.finishingRound).toBe(false);
  });

  it('레이스로 이미 해소된 상태(room이 다음 게임 waiting으로 넘어감): write는 조건부로 skip되지만 로컬 렌더는 그대로 진행된다(불변식: old host UX 지속)', async () => {
    const s = buildFinishRoundScenario('waiting'); // 다음 호스트가 이미 새 게임을 시작해둔 상황을 흉내
    const { finishRoundLocal, calls } = loadFinishRoundLocal(FINISH_ROUND_LOCAL_SRC, s);
    await finishRoundLocal();

    expect(s.roomWrites.length).toBe(1);
    expect(s.roomWrites[0].matched).toBe(false); // 0행 매치 — 이미 'result'가 아님
    expect(s.roomRow.status).toBe('waiting'); // 되돌려지지 않음(모순 방지)

    // 로컬 렌더는 write 성공 여부를 검사하지 않으므로 그대로 실행된다(8446/8469/8515는 원래도
    // write 결과를 검사하지 않았다 — 이 불변식 자체는 이번 수정으로 새로 생긴 게 아니라 유지됨).
    expect(calls.renderRoundResult).toEqual([{ caseType: 'gameOver', roundLoserCount: 1, remainingSlots: 1 }]);
    expect(calls.showScreen).toEqual(['screenRoundResult']);
    expect(calls.showTaggerPopup).toBe(1);
    expect(calls.autoSaveGameOverResultOnce).toBe(1);
    expect(calls.playResultSfxOnce.length).toBe(1);
    expect(calls.playResultVoiceOnce.length).toBe(1);
    expect(s.state.confirmedLoserIds).toEqual(['p2']);
    expect(s.state.finishingRound).toBe(false); // 재진입 가드가 풀려 다음 정당한 호출을 막지 않는다
  });

  it('idempotent 재진입(room이 이미 game_over — 2차 호출, WRPS-046/072-B19): write는 조건부로 skip되지만(이미 확정된 값이라 무해) 로컬 렌더는 정상 진행된다', async () => {
    const s = buildFinishRoundScenario('game_over'); // 이 host 자신이 이미 한 번 확정 커밋한 뒤 재호출
    const { finishRoundLocal, calls } = loadFinishRoundLocal(FINISH_ROUND_LOCAL_SRC, s);
    await finishRoundLocal();

    expect(s.roomWrites.length).toBe(1);
    expect(s.roomWrites[0].matched).toBe(false); // 0행 매치지만 값이 이미 game_over라 무해
    expect(s.roomRow.status).toBe('game_over');
    expect(calls.renderRoundResult).toEqual([{ caseType: 'gameOver', roundLoserCount: 1, remainingSlots: 1 }]);
    expect(calls.showTaggerPopup).toBe(1);
    expect(calls.autoSaveGameOverResultOnce).toBe(1);
    expect(s.state.finishingRound).toBe(false);
  });

  it("mutation 부하검증(finishRoundLocal 레벨): 조건을 제거하면 '이미 해소된 방'을 다시 덮어쓴다(RED 재발)", async () => {
    const GATE_REMOVED_SRC = FINISH_ROUND_LOCAL_SRC.split(".eq('status', 'result')").join('');
    if (GATE_REMOVED_SRC === FINISH_ROUND_LOCAL_SRC) {
      throw new Error('[wrps081] mutation ineffective — status-result condition not found in FINISH_ROUND_LOCAL_SRC');
    }
    const s = buildFinishRoundScenario('waiting');
    const { finishRoundLocal } = loadFinishRoundLocal(GATE_REMOVED_SRC, s);
    await finishRoundLocal();
    expect(s.roomWrites[0].matched).toBe(true); // 조건이 없으니 무조건 매치
    expect(s.roomRow.status).toBe('game_over'); // 이미 새 게임으로 넘어간 방을 다시 덮어씀 — 회귀 재현
  });
});
