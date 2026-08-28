// STOP-SHIP RC-3: N-참가자(3..20) 동시 렌더 시뮬레이션 하니스 — 지원 모듈(테스트 파일 아님).
//
// index.html 무수정 원칙: 이 파일은 index.html을 오직 readFileSync + 문자열 마커 슬라이싱으로만
// 읽는다. 추출한 소스는 new Function(...)으로 그대로 실행한다(로직을 손으로 재작성하지 않음).
// DOM/오디오/i18n/토스트처럼 브라우저 전용이라 헤드리스로 실행 불가능한 표면만 최소 스텁으로
// 대체한다(스텁은 "렌더 표면"이지 "판정/스케줄링 로직"이 아니다 — 그 경계는 README 하단 및
// 시뮬레이션 리포트에 정직하게 문서화한다).
//
// 실추출 vs 하니스 대체 경계(요약, 상세는 tests/rc3-multiparticipant-sim.test.mjs 상단 참고):
//   실추출(EXTRACTED, index.html 실소스 그대로 new Function 구동):
//     serverNow/syncServerClock/selectClockSyncOffset, parsePenalty/buildPenaltyValue,
//     getCountdownStartAt/getChoiceEndAt/getGameRound, getNextCountdownStartAt/getNextPhaseScheduledAt,
//     waitForPhaseRender(★ 4-phase 동기화 측정의 핵심 게이트), isCountdownGenerationCurrent,
//     waitForValidCountdownStart/republishCountdownStartAsHost, runCountdown/runCountdownThenShowGame,
//     captureAndPublishChoiceWindowNow/publishChoiceWindowEnd/publishChoiceWindowEstimateIfHost,
//     computeChoiceRemainingSeconds/beginRoundTimer, enterPlayingStateFromRoomUpdate,
//     handleRoomUpdate(★ stale-row guard + phase dispatch), updateRoomStatus/updateRoomStatusScheduled,
//     startGame, updateParticipantChoice, publishHostRoundResult/judgeRound(judgePure 주입),
//     scheduleRematchAutoAdvance류(scheduleRematchAdvanceRetryAfterFailure=안전망 A /
//     maybeRecoverStalledRematchAdvance=안전망 B / getRematchAdvanceRetryAttempts 포함 — 이 5개
//     함수는 index.html:9658-9760의 한 블록(rematchAdvance)으로 통째 추출돼 그대로 구동된다),
//     nextRound, isSafeParticipant/isConfirmedLoser/isCurrentRoundParticipant,
//     getPlayingEntryKey, syncConfirmedIdsFromParticipants, showScreen/hideAllScreens(가짜 DOM 위에서 실행).
//   하니스 대체(SUBSTITUTED, 정직하게 공개):
//     finishRoundLocal(460줄, DOM+음성+통계 강결합) 전체는 추출하지 않는다.
//     RC-3 Phase1(codex-critic HIGH 충실성 수정) 이후: 판정 입력을 어느 소스에서 가져올지 가르는
//     핵심 분기(hasStoredResults 판정 + 미충족 시 judgeRound(raw) 폴백, index.html ~8036-8043)는
//     REAL 텍스트를 그대로(바이트 동일) 추출해 new Function으로 실행한다(hasStoredResultsCheckFactory
//     참고) — 더 이상 "항상 인코딩값을 신뢰"하지 않는다. hasStoredResults가 참이면 REAL
//     publishHostRoundResult가 이미 participant row에 인코딩해둔 값(getChoiceResult)을 읽고,
//     거짓이면 REAL judgeRound(judgePure 주입)로 raw base choice에서 재계산한다 — 이 갈림길
//     이후의 술래-소거 상태 전이(allDraw/tooMany/tooFew/gameOver) 자체는 여전히
//     src/game-logic.mjs의 resolveElimination()(REAL, engine-parity.test.mjs가 이미 교차검증한
//     단일 소스 판정 함수)에 위임한다 — 손으로 짠 tooMany/tooFew 판정이 아니다.
//     H-1(rematch auto-advance 5경로 모델링) 이후: finishRoundLocal의 idempotency 캐시
//     (state.lastRoundResolution / roundEventId = getGameRound()+':'+(state.round||1),
//     index.html:8169/8188-8215/8498-8505)와 그 조기반환 안의 안전망 B 호출
//     (maybeRecoverStalledRematchAdvance, index.html:8212)도 REAL과 동일 의미로 재현한다 —
//     이게 없으면 duplicate 'result' 호출이 매번 재판정돼(재분류 phantom) REAL에는 없는
//     오분류/오복구가 하니스에서만 생긴다(§makeFinishRoundLocalSubstitute 주석 참고).
//     ⚠️ 위상 정정(codex-critic P1 독립검증): 안전망 B(:8212)를 "REAL 5경로 중 #5"라고 다른
//     4경로와 동등한 위상으로 읽으면 과장이다. 온라인 REAL에서 이 경로는 구조적으로 도달하기
//     어려운 defense-in-depth다 — waitForPhaseRender의 dedup(키 phase:gameNo:round:scheduledAt,
//     index.html:5284-5292)이 result→game_over 재진입을 먼저 막아 finishRoundLocal 자체가 같은
//     roundEventId로 두 번 불리지 않는다. 그래서 idempotency 캐시의 주된 값은 "duplicate를
//     자주 처리하는 것"이 아니라 "혹시 duplicate가 들어와도 하니스가 REAL에 없는 재판정을
//     발명하지 않게 막는 것"이다(정상 sweep 실측: 3 profile × N=3..20 × 20 trial = 1080 trial에서
//     FINISH_ROUND_SUBSTITUTE_IDEMPOTENT 0건 — 캐시는 정상 판정에 전혀 개입하지 않는다).
//     나머지(DOM 렌더 분기/음성/SFX/통계 DB쓰기/defer 재시도 스케줄러/state.finishingRound
//     재진입 가드)는 여전히 하니스가 대체하거나 모델하지 않는다 — 그 부분은 렌더/부작용
//     표면이지 판정 로직이 아니라고 판단했기 때문이다.
//     ready 화면 "모두 준비 완료 → 다음 라운드 시작" 트리거(markReady 등 DOM 버튼 클릭 체인)는
//     추출하지 않고, 하니스가 각 기기의 "ready 화면 렌더 완료"를 감지해 host의 실제 startGame()을
//     직접 호출한다(마지막 준비 참가자가 버튼을 누른 효과와 동일 — 클릭 자체만 생략).

import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

function extractBlock(startMarker, endMarker, { label } = {}) {
  const start = html.indexOf(startMarker);
  if (start < 0) throw new Error(`[rc3-harness] start marker not found (${label || ''}): ${startMarker}`);
  const end = html.indexOf(endMarker, start + startMarker.length);
  if (end < 0) throw new Error(`[rc3-harness] end marker not found (${label || ''}): ${endMarker}`);
  return html.slice(start, end);
}

// ── 마커 목록(파일 순서) — 각 항목은 "블록 시작"이자 동시에 "이전 블록의 끝"으로 재사용된다 ──
const M = {
  parseStart: 'function toPositiveInt(value, fallback = 0) {',
  domHelperStart: 'function $(id) {',
  onlineModeStart: 'function getOnlineMode() {',
  recentRoomsStart: 'function getRecentRoomCodes() {',
  roomPlayersStart: 'function getRoomPlayers() {',
  taggerCompleteStart: 'function isTaggerSelectionComplete() {',
  // WRPS-083 2B: destroyed 공통 가드. 이 하니스가 추출하는 REAL 블록(startGame/nextRound/
  // updateRoomStatus/beginNewGameRound/cleanupDroppedParticipants 등)이 이 helper를 호출한다.
  // 손으로 재작성하거나 no-op stub을 주입하지 않고 index.html 원문을 함께 추출한다.
  roomGuardStart: 'function isRoomClosingOrDestroyed() {',
  joinLockedStart: 'function isJoinLocked(',
  safeParticipantStart: 'function isSafeParticipant(id = state.currentUserId) {',
  currentParticipantStart: 'function getCurrentParticipant() {',
  hasConfirmedResultStart: 'function hasConfirmedRoundResult(choice) {',
  shouldResetStart: 'function shouldResetForParticipantChange(prevParticipants = [], nextParticipants = []) {',
  waitPhaseRenderStart: 'async function waitForPhaseRender(phase, scheduledAt, clientReceivedTs) {',
  enterPlayingStart: 'async function enterPlayingStateFromRoomUpdate() {',
  cleanupDroppedStart: 'async function cleanupDroppedParticipants() {',
  handleRoomUpdateStart: 'async function handleRoomUpdate(room) {',
  renderInlinePenaltyStart: 'function renderInlinePenaltyBox(el) {',
  updateRoomStatusStart: 'async function updateRoomStatus(status) {',
  hideAllScreensStart: 'function hideAllScreens() {',
  updateRoomBadgeStart: 'function updateRoomBadge() {',
  startGameStart: 'async function startGame(options = {}) {',
  selectChoiceStart: 'async function selectChoice(choice, event) {',
  updateSelectedCountStart: 'function updateSelectedCount() {',
  playResultVoiceStart: 'function playResultVoiceOnce(eventKey, ttsText, pitch, rate, delayMs) {',
  publishHostResultStart: 'async function publishHostRoundResult(participantsFromDb = null) {',
  scheduleFetchParticipantsStart: "function scheduleFetchParticipants(roomCode, delayMs = 80) {",
  judgeRoundStart: 'function judgeRound(participants) {',
  renderRoundResultStart: 'function renderRoundResult(caseType, roundLoserCount, remainingSlots) {',
  scheduleRematchStart: 'function scheduleRematchAutoAdvance(delayMs = 1500) {',
  nextRoundStart: 'async function nextRound() {',
  endGameStart: 'async function endGame() {',
  withTimeoutStart: 'function withTimeout(promise, ms, label = "요청") {',
  withAuthTimeoutStart: 'function withAuthTimeout(promise, ms, label) {',
  // RC-3 Phase1(codex-critic HIGH 충실성 수정): finishRoundLocal(~7969) 내부의 hasStoredResults
  // 판정 + 미충족 시 judgeRound(raw) 폴백 분기를 그대로(바이트 동일) 추출한다. finishRoundLocal
  // 전체(460줄, DOM/음성/통계 강결합)는 여전히 추출하지 않지만(H-1 이후 idempotency 캐시만은
  // §makeFinishRoundLocalSubstitute가 REAL과 동일 의미로 재현한다), "무엇을 신뢰하고
  // 무엇을 raw 재계산하는지"를 가르는 핵심 결정 지점만큼은 손으로 재작성하지 않는다 — 이전
  // finishRoundLocalSubstitute는 이 분기 자체가 아예 없어 getChoiceResult()가 항상 신뢰된다고
  // 가정했고, 그게 PHANTOM_OR_CORRUPTED_OUTCOME의 원인이었다(§1 보고 참고).
  finishRoundLocalHasStoredResultsStart: '\t      // 재연결/경쟁 조건으로 로컬 배열이 비어있을 경우 DB 마커에서 복원',
  finishRoundLocalHasStoredResultsEnd: '\t      // Build22-C: TAGGER_SNAPSHOT_GAVE_UP 이후 실제로 어느 데이터 소스로 판정했는지 QA에서',
};

for (const [k, v] of Object.entries(M)) {
  if (html.indexOf(v) < 0) throw new Error(`[rc3-harness] marker missing at load time: ${k} -> ${v}`);
}

// 블록별 real-source 추출(파일 등장 순서). 각 블록은 index.html 그대로의 텍스트다.
const BLOCKS = {
  parseAndSchedule: extractBlock(M.parseStart, M.domHelperStart, { label: 'parseAndSchedule' }),
  onlineMode: extractBlock(M.onlineModeStart, M.recentRoomsStart, { label: 'onlineMode' }),
  activePlayers: extractBlock(M.roomPlayersStart, M.taggerCompleteStart, { label: 'activePlayers' }),
  roomGuard: extractBlock(M.roomGuardStart, M.joinLockedStart, { label: 'roomGuard' }),
  choiceHelpers: extractBlock(M.safeParticipantStart, M.currentParticipantStart, { label: 'choiceHelpers' }),
  confirmedResultHelpers: extractBlock(M.hasConfirmedResultStart, M.shouldResetStart, { label: 'confirmedResultHelpers' }),
  waitPhaseRenderAndRoundState: extractBlock(M.waitPhaseRenderStart, M.enterPlayingStart, { label: 'waitPhaseRenderAndRoundState' }),
  enterPlaying: extractBlock(M.enterPlayingStart, M.cleanupDroppedStart, { label: 'enterPlaying' }),
  handleRoomUpdate: extractBlock(M.handleRoomUpdateStart, M.renderInlinePenaltyStart, { label: 'handleRoomUpdate' }),
  updateRoomStatusScheduled: extractBlock(M.updateRoomStatusStart, M.hideAllScreensStart, { label: 'updateRoomStatusScheduled' }),
  showScreen: extractBlock(M.hideAllScreensStart, M.updateRoomBadgeStart, { label: 'showScreen' }),
  countdownFull: extractBlock(M.startGameStart, M.selectChoiceStart, { label: 'countdownFull' }),
  autoFillChoices: extractBlock(M.updateSelectedCountStart, M.playResultVoiceStart, { label: 'autoFillChoices' }),
  publishHostRoundResult: extractBlock(M.publishHostResultStart, M.scheduleFetchParticipantsStart, { label: 'publishHostRoundResult' }),
  judgeRound: extractBlock(M.judgeRoundStart, M.renderRoundResultStart, { label: 'judgeRound' }),
  rematchAdvance: extractBlock(M.scheduleRematchStart, M.nextRoundStart, { label: 'rematchAdvance' }),
  nextRound: extractBlock(M.nextRoundStart, M.endGameStart, { label: 'nextRound' }),
  withTimeout: extractBlock(M.withTimeoutStart, M.withAuthTimeoutStart, { label: 'withTimeout' }),
};

const COMBINED_SOURCE = Object.values(BLOCKS).join('\n');

// finishRoundLocal의 hasStoredResults 판정 블록은 COMBINED_SOURCE(거대한 env factory 본문)에는
// 넣지 않는다 — 이 블록은 그 자체로 독립 실행 가능한 문장열(`const hasAnyMarkers = ...` 등)이라
// COMBINED_SOURCE에 합쳐 넣으면 이름 충돌/부작용 위험을 새로 만들 뿐 얻는 게 없다. 대신 별도의
// 작은 factory로 컴파일해 makeFinishRoundLocalSubstitute가 매 호출마다 실행한다(§1 아래 참고).
const FINISH_ROUND_LOCAL_BLOCKS = {
  finishRoundLocalHasStoredResultsCheck: extractBlock(
    M.finishRoundLocalHasStoredResultsStart, M.finishRoundLocalHasStoredResultsEnd,
    { label: 'finishRoundLocalHasStoredResultsCheck' }
  ),
};

// ── 충실성 체크용 export: 추출 마커가 index.html 실제 텍스트와 정확히 일치한다는 것을 다른
// 테스트(fidelity)에서도 재확인할 수 있게 원문 슬라이스 자체를 노출한다.
export const EXTRACTED_SOURCE_BLOCKS = { ...BLOCKS, ...FINISH_ROUND_LOCAL_BLOCKS };
export const EXTRACTED_COMBINED_SOURCE = COMBINED_SOURCE;

// REAL finishRoundLocal(index.html ~8036-8043, 위 마커로 그대로 추출)을 new Function으로 그대로
// 구동하는 체커 — hasAnyMarkers 복원 + hasStoredResults 판정을 실 소스와 바이트 동일하게
// 재현한다(손으로 다시 짠 tooMany/tooFew류 판정이 아니라 원문 슬라이스를 실행할 뿐). 자유변수
// (state/isNonPlayingChoice/getChoiceBase/hasConfirmedRoundResult/syncConfirmedIdsFromParticipants)는
// 전부 이미 REAL 추출 함수(impl.*)이며, 매 라운드 호출 시점의 최신 state를 그대로 넘겨받는다.
const hasStoredResultsCheckFactory = new Function(
  'state', 'isNonPlayingChoice', 'getChoiceBase', 'hasConfirmedRoundResult', 'syncConfirmedIdsFromParticipants',
  `"use strict";\n${FINISH_ROUND_LOCAL_BLOCKS.finishRoundLocalHasStoredResultsCheck}\nreturn { hasStoredResults, activeForStoredResult };`
);

// ── 결정론적 PRNG(Math.random 미사용) ────────────────────────────────────────
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function rng() {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ── 가짜 DOM: 렌더 표면만 흉내낸다(화면 hidden/visible 상태만 진짜 로직이 읽고 쓸 수 있게). ──
function createFakeDom() {
  const els = new Map();
  function makeEl(id) {
    const el = {
      id,
      _hiddenClasses: new Set(['hidden']),
      style: {},
      textContent: '',
      innerHTML: '',
      className: '',
      disabled: false,
      children: [],
      classList: {
        contains: (c) => el._hiddenClasses.has(c),
        add: (c) => { el._hiddenClasses.add(c); },
        remove: (c) => { el._hiddenClasses.delete(c); },
        toggle: (c, force) => {
          const shouldHave = force === undefined ? !el._hiddenClasses.has(c) : Boolean(force);
          if (shouldHave) el._hiddenClasses.add(c); else el._hiddenClasses.delete(c);
        },
      },
      appendChild: (child) => { el.children.push(child); },
      querySelectorAll: () => [],
      get offsetWidth() { return 0; },
    };
    return el;
  }
  function $(id) {
    if (!els.has(id)) els.set(id, makeEl(id));
    return els.get(id);
  }
  const documentStub = {
    getElementById: (id) => els.has(id) ? els.get(id) : null,
    createElement: () => makeEl('__created__'),
    visibilityState: 'visible',
    addEventListener() {},
    removeEventListener() {},
  };
  return { $, documentStub, els };
}

// ── 시뮬레이션 룸(공유 상태) ─────────────────────────────────────────────────
// host 단일 writer 원칙: rooms.update는 오직 host 디바이스만 호출한다(실제 앱과 동일하게
// 하니스도 host 이외 디바이스에서 rooms.update를 호출하지 않는다 — participants.update만 호출).
//
// ⚠️ initialPenalty 기본값('')은 REAL 앱과의 불일치를 그대로 물려받는다는 뜻이 아니다 — REAL
// 앱에서는 host가 로비에서 savePenalty()를 먼저 커밋해야만(index.html ~7280-7310,
// db.from('rooms').update({ penalty: buildPenaltyValue({loserCount,...}), status: nextStatus })
// 만) screenHostRoom의 startGameBtn이 활성화되므로(showHostRoom의 state.status==='ready' 분기,
// index.html ~6599), room.penalty가 ''(빈 문자열)인 채로 startGame()이 호출되는 경우는 REAL
// 앱에는 **존재하지 않는다**. 이 기본값을 계속 ''로 두는 이유는 오직 하위호환(§createRoomStore를
// 직접 호출해 판정 단위 테스트에만 쓰는 rc3-multiparticipant-sim.test.mjs 등 — 이 테스트들은
// handleRoomUpdate/room row 동기화 경로를 아예 타지 않고 device.impl.state를 직접 조작하므로
// room.penalty 초기값과 무관)이다. targetLoserCount를 실제로 주입해 라운드를 굴리는
// createTrialWorld는 아래에서 REAL savePenalty 상당 단계로 이 기본값을 반드시 덮어쓴다 —
// PHANTOM_OR_CORRUPTED_OUTCOME 원인 규명 참고(§STOP-SHIP 보고).
export function createRoomStore(roomId = 'ROOM-SIM', { initialPenalty = '' } = {}) {
  return {
    id: roomId,
    row: { id: roomId, penalty: initialPenalty, round: 1, status: 'waiting' },
    participants: new Map(), // id -> row
    order: [], // insertion order (created_at asc 흉내)
    subscribers: [], // { deviceId, onRoomRow(rowSnapshot) }
    subscriberLastScheduledAbsMs: new Map(), // 구독자별 마지막 예정 도착 절대시각(순서 보장용)
    version: 0,
  };
}

// ── 네트워크/지연 모델(시드 기반, 문서화된 파라미터) ────────────────────────────
// RC-3 Phase3(codex-critic B 출처 소명): 이전 버전 이 주석은 "필드QA 실측(참가자 스냅샷 지연
// median 0.9~1.0s / max 6.4s, SYNC_LATE_RENDER max 11.9s)"을 근거로 들었으나, 저장소/문서/로그
// 전체를 grep해도 "0.9~1.0s"/"11.9s"/"11900" 문자열은 이 주석 자신 말고는 어디에도 없다 —
// **출처 불명**. 유일하게 저장소에 실제로 남아있는 근거값은 index.html:5732("host 중앙값 179ms
// vs participant 최악 6432ms")인데, 이건 realtime 채널 전파 지연이 아니라
// fetchFreshParticipantsForResult()(REST select 재시도 루프, Build24-A/Build30 주석 참고,
// RESULT_FETCH_HARD_TIMEOUT_MS=5000으로 상한)의 **왕복 소요 시간**이다 — "6432ms"가 옛 주석의
// "max 6.4s"와 수상하리만치 가깝다는 것 자체가, 이전 작성자가 이 앱-레벨 재시도 시간을 realtime
// 전파 지연으로 착각해 재인용했을 가능성을 시사한다(§7 "확신 낮은 부분"에 기록, 확정은 아님).
// 이 REST 재시도 시간은 realtime 전파와 무관한 별도 채널이며, 하니스에서는 ackDelayFn(아래
// createDb, 60~280ms/op)이 이미 그 역할을 맡고 fetchFreshParticipantsForResult 자체도 REAL로
// 추출돼(waitPhaseRenderAndRoundState 블록에 포함) 그 지연을 "알아서 소비"한다 — 이 함수
// (sampleRealtimeDelayMs)는 오직 rooms.update의 postgres_changes 브로드캐스트 전파에만 쓰인다
// (아래 createDb의 opRoomsUpdate 참고). 네트워크 전파 vs 앱 스케줄링 대기가 이미 구조적으로
// 분리돼 있다는 것이 이번 Phase3 재검토의 핵심 확인 사항이다.
//
// 실측 근거가 없으므로, CEO/critic 지시대로 "현재값"을 pessimistic 레짐으로 유지하고(기존
// Phase1/Phase2 테스트 전부가 이 레짐으로 이미 검증됐으므로 기본값은 그대로 pessimistic —
// 회귀 없음), optimistic/moderate 레짐을 공학적 가정(Supabase 문서상 일반적인 realtime 지연은
// sub-second가 흔하고 percentile 꼬리가 짧다는 통념 — 이것도 실측이 아니라 가정, §7에 재확인)
// 으로 추가한다. 세 레짐 모두 크라우딩 보정(N이 클수록 꼬리 확률 소폭 증가)은 동일 비율로 적용한다.
// ⚠️ regime 미지정(기본값 'pessimistic') 시의 분기/rng() 호출 횟수는 §1/§2 검증에 쓰인 원본과
// 바이트 동일하게 유지한다 — 분포 모양뿐 아니라 rng() 소비 횟수까지 바뀌면 시드 기반 결정론이
// 깨져(공유 rng가 이후 모든 난수 도출에 영향) 기존 시드로 검증된 §1 N=16/§4 mutation 테스트
// 결과가 조용히 달라질 수 있다. 그래서 pessimistic 분기는 리팩터링하지 않고 원본 코드를 그대로
// 보존했다(optimistic/moderate는 새 코드 경로라 원본과 rng 소비 패턴이 달라도 무방 — 그 경로는
// 이번 Phase3 민감도 스윕에서만 쓰인다).
export function sampleRealtimeDelayMs(rng, participantCount, regime = 'pessimistic') {
  const crowding = Math.min(0.05, (participantCount - 3) * 0.0025); // N=3→0, N=20→0.0425
  const u = rng();
  if (regime === 'optimistic') {
    if (u < 0.94 - crowding) return 50 + rng() * 300; // ~50..350
    if (u < 0.99) return 350 + rng() * 550; // ~350..900
    return 900 + rng() * 1100; // ~900..2000
  }
  if (regime === 'moderate') {
    if (u < 0.90 - crowding) return 120 + rng() * 680; // ~120..800
    if (u < 0.98) return 800 + rng() * 1400; // ~800..2200
    return 2200 + rng() * 2300; // ~2200..4500
  }
  // pessimistic(기본값) — §1/§2 검증 당시부터 쓰인 "현재값", 원본과 완전히 동일(회귀 없음).
  // 절대 실측치가 아니라 "이 정도까지 늦어도 하니스가 stall을 검출하는지" 확인하려던 스트레스
  // 값이었다는 점을 §7에 명시한다.
  if (u < 0.90 - crowding) return 200 + rng() * 900 + rng() * 300; // ~200..1400
  if (u < 0.97) return 1500 + rng() * 2500; // 1.5..4s
  return 4000 + rng() * 5000; // 4..9s
}

// 위 세 분기의 대략적인 몸통/꼬리 상한을 순수 소개용(introspection/테스트용)으로 노출한다 —
// sampleRealtimeDelayMs의 실제 분기 로직(위)이 단일 진실 소스이고, 이 객체는 그 값을 손으로
// 다시 옮겨 적은 요약표에 불과하다(값이 어긋나면 §5 sanity 테스트가 잡는다).
export const REALTIME_DELAY_REGIMES = {
  optimistic: { bodyHi: 350, midHi: 900, tailHi: 2000 },
  moderate: { bodyHi: 800, midHi: 2200, tailHi: 4500 },
  pessimistic: { bodyHi: 1400, midHi: 4000, tailHi: 9000 },
};

// REAL index.html:5586-5590의 `state.pollInterval = setInterval(..., 2600)` 주기와 바이트 동일한
// 값 — 아래 startDevicePolling/createTrialWorld/runMeasuredTrial/runEliminationTrial의
// pollIntervalMs 기본값도 이 상수와 일치한다(새 숫자 발명 아님, §STOP-SHIP Phase0 재측정 테스트가
// 이 값을 그대로 재사용해 fidelity를 주장한다).
export const REAL_POLL_INTERVAL_MS = 2600;

// db.rpc('server_now') RTT 분포(RC-1 skew simulator와 동일 계열: rttBase + 비대칭 + jitter).
export function sampleClockRtt(rng, deviceIndex) {
  const rttBase = 120 + rng() * 380; // 120..500ms 기본 RTT
  const asymmetrySwing = (rng() - 0.5) * 0.6; // -0.3..0.3
  const upFrac = Math.min(0.95, Math.max(0.05, 0.5 + asymmetrySwing));
  const jitterMs = rng() * rttBase * 0.4;
  return { rttBase, upFrac, jitterMs };
}

// ── STOP-SHIP §Step1(clockRtt 정직화): sampleClockRtt는 realtimeDelayRegime/deliveryOrderMode와
// 무관하게 항상 동일 분포(120~500ms 기본 RTT)를 쓴다 — Degraded/Extreme profile이 realtime 전파
// 지연은 늘려도 "server_now RPC(clock sync) 자체의 RTT"는 늘리지 않는다는 뜻이라, 이 두 profile의
// clock skew 보정 오차를 과소측정한다(§STOP-SHIP 보고 §1). clockRttOverrideFn이 주어지면(예: 아래
// makeClockRttOverrideFn) 그것으로 RTT 분포를 대체한다 — 기본값(null)은 기존 sampleClockRtt 그대로라
// 회귀 없음(§skewMsOverrideFn과 완전히 동형 패턴).
export function makeClockRttOverrideFn({ rttBaseMin, rttBaseMax, jitterFrac = 0.4 }) {
  return ({ rng }) => {
    const span = Math.max(0, rttBaseMax - rttBaseMin);
    const rttBase = rttBaseMin + rng() * span;
    const asymmetrySwing = (rng() - 0.5) * 0.6; // -0.3..0.3(기존 sampleClockRtt와 동일 비대칭 폭)
    const upFrac = Math.min(0.95, Math.max(0.05, 0.5 + asymmetrySwing));
    const jitterMs = rng() * rttBase * jitterFrac;
    return { rttBase, upFrac, jitterMs };
  };
}

function sampleSkewMs(rng) {
  // 기기 wall-clock skew: -3000..+3000ms 대칭 분포(실기기 시계 오차 현실적 범위).
  return Math.round((rng() - 0.5) * 6000);
}

// ── STOP-SHIP Part B(기기별 비대칭 clock skew 주입) ──────────────────────────
// 기존 sampleSkewMs는 기기마다 독립적으로 무작위 skew를 뽑긴 하지만("비대칭"이라는 표현 자체는
// 이미 성립), critic B의 지적은 그 skew 자체가 아니라 "mutation이 전 기기 동일 소스를 바꾸는
// 방식이라(combinedSourceOverride) 스케줄링이 깨져도 on-time 코호트 구성원끼리는 여전히 같은
// (깨진) 공식으로 같은 목표시각에 수렴해 스프레드가 벌어지지 않는다"는 것이었다. 그래서 진짜
// 필요한 건 "skew 분포를 더 넓히는 것"이 아니라 "mutation이 clock-sync 보정 자체를 우회하게
// 만들었을 때, 그 우회된 결과가 기기마다 실제로 다르게 나오도록 skew 자체를 결정론적으로
// 이분화(절반은 +스프레드, 절반은 -스프레드)해 신호를 명확히 분리하는 것"이다 — 아래
// createAlternatingSkewFn이 그 역할을 한다(순수 skew 함수 교체일 뿐, 판정/스케줄링 로직은
// 손대지 않는다). 기본값(undefined)은 기존 sampleSkewMs 그대로라 회귀가 없다.
export function createAlternatingSkewFn(spreadMs = 5000) {
  return ({ index, isHost, rng }) => {
    if (isHost) return 0; // 대조군 단순화 유지(기존 정책과 동일).
    const sign = index % 2 === 0 ? 1 : -1;
    return Math.round(sign * spreadMs * (0.7 + rng() * 0.3));
  };
}

// ── STOP-SHIP Part A(폴링-realtime out-of-order 주입) ────────────────────────
// 기존(§충실성 보정) 로직은 구독자별 배달을 단조증가하도록 강제해 "단일 순서보장 realtime
// 스트림"만 재현했다. 그러나 실제 앱은 이 realtime 채널과 별도로 2.6초 참가자 폴링
// (fetchParticipants, index.html ~6066 — 이 하니스에는 여전히 추출되지 않음, §7 한계 명시)이
// 독립적으로 경쟁한다. 그 폴링 채널 자체를 전부 추출하지 않고도, "이 구독자에게 커밋 순서와
// 다르게 스냅샷이 도착할 수 있다"는 그 핵심 위협 모델만은 이 realtime 전송 계층에서도 일반화해
// 재현할 수 있다 — deliveryOrderMode:'outOfOrder'는 구독자별 단조증가 강제를 끄고 각 커밋마다
// 독립적으로 지연을 샘플링한다(이게 바로 위 §충실성 보정 주석이 "하니스 자체 결함"이라 부르며
// 되돌렸던 그 원래 동작 — 여기서는 버그가 아니라 "실제로 이런 재정렬이 생기면 REAL
// isStaleRoomRow/WRPS-079 hruGen/WRPS-081 가드가 버티는지" 확인하려는 의도적 스트레스 모드다).
// 기본값('monotonic')은 기존 동작 그대로라 회귀가 없다.
function scheduleReorderableDelivery({ roomStore, sub, snapshot, rng, participantCount, realtimeDelayRegime, deliveryOrderMode, delay }) {
  const propDelay = sampleRealtimeDelayMs(rng, participantCount, realtimeDelayRegime);
  const rawTargetAbsMs = Date.now() + propDelay;
  let targetAbsMs;
  if (deliveryOrderMode === 'outOfOrder') {
    // 의도적으로 단조증가 강제를 생략한다 — 뒤에 커밋된 이벤트가 앞선 이벤트를 추월해 도착할 수
    // 있다(폴링 스냅샷이 더 새 realtime 이벤트보다 늦게 도착하는 상황의 일반화).
    targetAbsMs = rawTargetAbsMs;
  } else {
    const prevAbsMs = roomStore.subscriberLastScheduledAbsMs.get(sub.deviceId) || -Infinity;
    targetAbsMs = Math.max(rawTargetAbsMs, prevAbsMs + 1);
  }
  roomStore.subscriberLastScheduledAbsMs.set(sub.deviceId, targetAbsMs);
  const waitMs = Math.max(0, targetAbsMs - Date.now());
  delay(waitMs).then(() => sub.onRoomRow({ ...snapshot }));
}

// ── 가짜 db 팩토리: 하나의 roomStore를 여러 device가 공유한다. ────────────────
// ── H-1(안전망 A 도달성): dbErrorInjectionFn(기본값 null = opt-in) ─────────────
// 이 fake db는 지금까지 모든 write에 대해 무조건 `{ error: null }`만 반환했다 — 그래서 REAL
// nextRound()가 각 write의 error를 직접 검사해 throw로 승격하는 구간
// (index.html:9789/9793/9797/9803)이 구조적으로 절대 발화하지 못했고, 그 catch(:9809-9826)가
// 트리거하는 안전망 A(scheduleRematchAdvanceRetryAfterFailure → scheduleRematchAutoAdvance,
// index.html:9733 = REAL 5개 호출부 중 #4)가 이 하니스에서 dead code였다. dbErrorInjectionFn이
// 주어지면 그 함수가 반환한 error 객체를 vendored supabase-js v2의 실전 실패 모델 그대로
// ({ error } 로 resolve — reject 아님, §tests/build29-rematch-advance-resilience.mjs makeResolveDb
// 주석과 동일 근거) 돌려준다.
// ⚠️ 기본값(null)일 때의 실행 경로는 수정 전과 바이트 동일하다(추가 분기 1개는 함수 진입 즉시
// falsy 체크로 끝나고 rng()를 단 한 번도 더 소비하지 않는다) — 기존 고정 seed 측정치 전부가
// 그대로 재현되어야 한다는 회귀 방지 계약(§본문 H-1 요구사항 "기본 경로 rng 소비 불변").
// 주입이 실제로 켜진 경우에도 ackDelayFn()은 정상 경로와 동일하게 1회 소비한다 — 실패한 write도
// 네트워크 왕복 시간은 쓰이며, 이래야 주입 on/off가 rng 스트림 자체를 어긋내지 않는다.
export function createDb({ roomStore, deviceId, isHost, rng, clockRttFn, ackDelayFn, realtimeDelayRegime = 'pessimistic', deliveryOrderMode = 'monotonic', dbErrorInjectionFn = null,
  // Phase A: 컬럼 인식 필터링. 기본은 false(legacy) 다 — 자세한 근거는 아래 selectRows 주석.
  strictFilters = false }) {
  function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, Math.max(0, Math.round(ms))));
  }
  // table/op/patch/keyOrIds만 넘긴다(객체 리터럴 할당조차 기본 경로에서는 발생하지 않도록
  // 위치 인자 사용) — 반환값이 truthy면 그것을 그대로 { error }로 쓴다.
  function injectedError(table, op, patch, keyOrIds) {
    if (!dbErrorInjectionFn) return null;
    try {
      return dbErrorInjectionFn({ table, op, patch, keyOrIds, deviceId, isHost, roomStore }) || null;
    } catch (e) {
      return { message: '[rc3-harness] dbErrorInjectionFn threw: ' + String(e && e.message || e) };
    }
  }
  async function opRoomsUpdate(patch, withRows = false) {
    if (!isHost) {
      // 실제 앱도 host만 rooms.update를 호출한다 — 방어적으로 하니스 버그를 조기 발견.
      throw new Error('[rc3-harness] non-host device attempted rooms.update — harness bug');
    }
    // H-1: 실패 주입은 커밋/브로드캐스트 "이전"에 판정한다 — 실패한 write는 row를 바꾸지도,
    // 구독자에게 전파되지도 않는다(실제 DB 실패와 동일 의미).
    const roomsUpdateError = injectedError('rooms', 'update', patch, roomStore.id);
    if (roomsUpdateError) {
      await delay(ackDelayFn());
      return withRows ? { data: null, error: roomsUpdateError } : { error: roomsUpdateError };
    }
    const ackDelay = ackDelayFn();
    Object.assign(roomStore.row, patch);
    roomStore.version += 1;
    const snapshot = { ...roomStore.row };
    // 충실성 보정(중요): Supabase realtime(postgres_changes)은 구독자 1명당 "단일 순서보장
    // 스트림"이다(TCP/웹소켓 한 연결 위에서 커밋 순서대로 전달 — 지연은 변동해도 재정렬은
    // 없음). 초기 구현은 커밋마다 구독자별로 독립적으로 지연을 샘플링해 delay(...).then(...)으로
    // "따로" 스케줄했는데, 그러면 뒤에 커밋된 이벤트가 앞서 커밋된 이벤트보다 더 짧은 지연을
    // 뽑을 경우 "역전 도착"이 생겨 handleRoomUpdate가 최신 상태를 구버전으로 덮어써 버리는
    // stall을 만들어냈다(하니스 자체 결함으로 실측 — 실제 프로덕션 결함이 아님, 아래 report의
    // "확신 낮은 부분"에 별도로 기록). 구독자별 도착 시각을 단조증가하도록 강제해(직전 예정
    // 도착시각 이후로만 배달) 실제 단일 순서보장 채널을 충실히 재현한다. deliveryOrderMode가
    // 'outOfOrder'면(위 §STOP-SHIP Part A) 이 강제를 의도적으로 끈다.
    for (const sub of roomStore.subscribers) {
      scheduleReorderableDelivery({
        roomStore, sub, snapshot, rng, participantCount: roomStore.subscribers.length,
        realtimeDelayRegime, deliveryOrderMode, delay,
      });
    }
    await delay(ackDelay);
    // rooms.update 는 항상 이 방 1행을 대상으로 한다(하니스 계약). 영향 행 1건을 돌려준다.
    return withRows ? { data: [{ ...roomStore.row }], error: null } : { error: null };
  }
  async function opRoomsSelectSingle() {
    await delay(ackDelayFn());
    return { data: { ...roomStore.row }, error: null };
  }
  function getParticipantRows() {
    return roomStore.order.map((id) => roomStore.participants.get(id)).filter(Boolean);
  }
  async function opParticipantsSelect() {
    await delay(ackDelayFn());
    return { data: getParticipantRows().map((r) => ({ ...r })), error: null };
  }
  // ── 범용 쿼리 계층 (Phase A) ────────────────────────────────────────────────
  // 이전 구현은 `.eq(col, val)` 에서 **컬럼을 무시**하고 항상 id 1건만 매치했다. 그래서
  // 프로덕션이 실제로 쓰는 다음 형태들이 재현되지 않았다:
  //   participants.update().eq('room_id', …)          ← 전원 대상 대량 갱신이 무음 누락
  //   participants.update().eq('room_id',…).eq('id',…) ← 체인 조건 미지원
  //   rooms.update().eq('id',…).eq('status','result')  ← CAS 가드가 항상 통과
  // 이제 컬럼을 존중하고 체인 조건을 AND 로 평가한다.
  const rowsOf = (table) => (table === 'rooms' ? [roomStore.row] : getParticipantRows());
  const matches = (row, filters) => filters.every((f) =>
    f.op === 'in' ? f.val.includes(row[f.col]) : row[f.col] === f.val);
  // ⚠️ strictFilters 기본값이 false 인 이유 (Phase A 검증 결과, JP-BL-027-B 로 추적)
  //
  // 교정본(strictFilters=true)은 프로덕션 쿼리 계약을 정확히 재현한다. 그런데 이를 rc3
  // 시뮬레이션 기본값으로 켜면 CROSS_DEVICE_OUTCOME_MISMATCH 88건이 드러나며 하드 게이트가
  // 깨진다. 원인 분리 실험 결과 rooms 컬럼 인식은 무해했고, **participants 대량 갱신
  // (`.eq('room_id', …)`)이 실제로 적용되기 시작한 것**이 유일한 원인이었다.
  //
  // 이 발산이 실제 프로덕션 결함인지는 **아직 단정할 수 없다.** 이 하니스는 participants
  // 변경에 realtime 전파가 없고(구독/브로드캐스트가 rooms 에만 있다) 기기들이 fetch 로만
  // 알게 되므로, 대량 리셋이 적용되는 순간 기기 간 관측 격차를 실제보다 과대평가할 수 있다.
  // 프로덕션은 participants 도 postgres_changes 로 전파된다.
  //
  // 따라서 "교정 = 즉시 켜기" 로 가지 않는다. 켜려면 participants realtime 전파까지 함께
  // 모델링해야 하며, 그건 별도 슬라이스다. 기존 하드 게이트 단언은 **약화하지 않았다**.
  const selectRows = (table, filters) => {
    if (strictFilters) return rowsOf(table).filter((r) => matches(r, filters));
    // legacy: rooms 는 단일 방 행, participants 는 마지막 필터를 id 로 간주(기존 동역학 보존).
    if (table === 'rooms') return rowsOf(table);
    const last = filters[filters.length - 1];
    if (!last) return [];
    const ids = last.op === 'in' ? last.val : [last.val];
    return ids.map((id) => roomStore.participants.get(id)).filter(Boolean);
  };

  // 오류 주입 키는 기존 계약을 유지한다(마지막 필터가 in 이면 'update-in', 아니면 'update-eq').
  const injectionKey = (filters) => (filters.some((f) => f.op === 'in') ? 'update-in' : 'update-eq');
  const injectionArg = (filters) => {
    const last = filters[filters.length - 1];
    return last ? last.val : null;
  };

  async function runMutation(table, op, patch, filters, withRows) {
    if (table === 'rooms' && op === 'update' && !isHost) {
      // 실제 앱도 host만 rooms.update를 호출한다 — 방어적으로 하니스 버그를 조기 발견.
      throw new Error('[rc3-harness] non-host device attempted rooms.update — harness bug');
    }
    const errKey = table === 'rooms' ? 'update' : injectionKey(filters);
    const errArg = table === 'rooms' ? roomStore.id : injectionArg(filters);
    // H-1: 실패 주입은 커밋/브로드캐스트 "이전"에 판정한다 — 실패한 write는 row를 바꾸지도,
    // 구독자에게 전파되지도 않는다(실제 DB 실패와 동일 의미).
    const injected = injectedError(table, errKey, patch, errArg);
    if (injected) {
      await delay(ackDelayFn());
      return withRows ? { data: null, error: injected } : { error: injected };
    }

    const ackDelay = ackDelayFn();
    const target = selectRows(table, filters);

    if (op === 'delete') {
      for (const row of target) {
        roomStore.participants.delete(row.id);
        const i = roomStore.order.indexOf(row.id);
        if (i >= 0) roomStore.order.splice(i, 1);
      }
      await delay(ackDelay);
      return withRows ? { data: target.map((r) => ({ ...r })), error: null } : { error: null };
    }

    for (const row of target) Object.assign(row, patch);

    // rooms 는 실제로 바뀐 경우에만 버전을 올리고 구독자에게 전파한다.
    // 0행(예: CAS 가드 `.eq('status','result')` 불일치)은 커밋도 브로드캐스트도 아니다.
    if (table === 'rooms' && target.length > 0) {
      roomStore.version += 1;
      const snapshot = { ...roomStore.row };
      // 충실성 보정: Supabase realtime 은 구독자 1명당 단일 순서보장 스트림이다.
      // 구독자별 도착 시각을 단조증가로 강제해 역전 도착을 만들지 않는다
      // (deliveryOrderMode 가 'outOfOrder' 면 의도적으로 끈다 — STOP-SHIP Part A).
      for (const sub of roomStore.subscribers) {
        scheduleReorderableDelivery({
          roomStore, sub, snapshot, rng, participantCount: roomStore.subscribers.length,
          realtimeDelayRegime, deliveryOrderMode, delay,
        });
      }
    }
    await delay(ackDelay);
    // 실제 PostgREST: .select() 를 붙이면 **영향받은 행만** 돌아온다.
    // 대상이 없으면 오류가 아니라 빈 배열이다(= 무음 0행).
    return withRows ? { data: target.map((r) => ({ ...r })), error: null } : { error: null };
  }

  async function opRoomsSelectSingle() {
    await delay(ackDelayFn());
    return { data: { ...roomStore.row }, error: null };
  }
  function getParticipantRows() {
    return roomStore.order.map((id) => roomStore.participants.get(id)).filter(Boolean);
  }
  async function opParticipantsSelect() {
    await delay(ackDelayFn());
    return { data: getParticipantRows().map((r) => ({ ...r })), error: null };
  }

  // 실제 supabase-js/PostgREST 계약:
  //   await update(...).eq(...)          → { error }              (HTTP 204, 영향 행 정보 없음)
  //   await update(...).eq(...).select() → { data: [영향 행], error }
  // 0행이어도 error 는 null 이다 — 이 구분이 JP-BL-027 의 전부다.
  function mutationBuilder(table, op, patch) {
    const filters = [];
    const run = (withRows) => runMutation(table, op, patch, filters, withRows);
    const b = {
      eq: (col, val) => { filters.push({ op: 'eq', col, val }); return b; },
      in: (col, val) => { filters.push({ op: 'in', col, val }); return b; },
      select: () => run(true),
      then: (res, rej) => run(false).then(res, rej),
      catch: (rej) => run(false).catch(rej),
      finally: (fn) => run(false).finally(fn),
    };
    return b;
  }

  function from(table) {
    if (table !== 'rooms' && table !== 'participants') {
      throw new Error(`[rc3-harness] unsupported table: ${table}`);
    }
    return {
      update: (patch) => mutationBuilder(table, 'update', patch),
      delete: () => mutationBuilder(table, 'delete', null),
      select: () => (table === 'rooms'
        ? { eq: () => ({ single: () => opRoomsSelectSingle() }) }
        : { eq: () => ({ order: () => opParticipantsSelect(), single: () => opParticipantsSelect() }) }),
    };
  }
  async function rpc(name) {
    if (name !== 'server_now') throw new Error(`[rc3-harness] unsupported rpc: ${name}`);
    const { rttBase, upFrac, jitterMs } = clockRttFn();
    const jitter = (rng() - 0.5) * 2 * jitterMs;
    const rtt = Math.max(1, Math.round(rttBase + jitter));
    const trueAtCallStart = Date.now(); // 이 시점의 REAL(페이크타이머) 전역 시각 — device skew 미포함.
    await delay(rtt);
    const serverMs = Math.round(trueAtCallStart + rtt * upFrac);
    return { data: serverMs, error: null };
  }
  return { from, rpc };
}

// ── 텔레메트리: QA.emit 이벤트를 device별로 수집한다(실제 QA 모듈 대체 — 관측 전용, 판정 무영향). ──
function createTelemetry() {
  const events = [];
  return {
    emit(kind, payload) { events.push({ kind, ...payload, __t: Date.now() }); },
    events,
  };
}

// ── finishRoundLocal 대체(하니스, 정직하게 공개) ───────────────────────────────
// 실제 finishRoundLocal(460줄, DOM/음성/통계 강결합)은 여전히 추출하지 않는다(H-1 이후
// idempotency 캐시/안전망 B 호출만은 아래에서 REAL과 동일 의미로 재현한다).
// 그러나 RC-3 Phase1(codex-critic HIGH 충실성 결함 수정) 이전 버전은 활성 참가자 전원이
// hasConfirmedRoundResult(choice)를 만족하는지(hasStoredResults) 전혀 확인하지 않고 항상
// getChoiceResult(choice)를 신뢰했다 — REAL finishRoundLocal(index.html ~8042-8056)은 그 조건이
// 깨지면 인코딩값을 버리고 judgeRound(state.participants)(REAL, raw base choice 재계산)로
// 폴백한다. 이 폴백 분기를 타지 않으면(예: 호스트가 아직 judge 결과를 커밋하기 전 이 단말의
// state.participants 스냅샷이 갱신되지 않은 채로 finishRoundLocal이 불렸을 때) getChoiceResult가
// 빈 문자열을 반환해 resolveElimination에 무효 result가 들어가고, 그 결과가 팬텀
// tooMany/tooFew/gameOver로 오분류될 수 있다(§1 재측정 참고).
// 그래서 hasStoredResults 판정 자체는 REAL 텍스트를 그대로 추출해(위 hasStoredResultsCheckFactory,
// index.html finishRoundLocal의 해당 구간과 바이트 동일) 실행하고, 폴백 시에는 REAL judgeRound
// (judgePure 주입, impl.judgeRound)를 호출한다 — 손으로 다시 짠 판정 로직이 아니다.
// 술래-소거 상태 전이(allDraw/tooMany/tooFew/gameOver) 자체는 여전히 src/game-logic.mjs의
// resolveElimination()(REAL, 프로덕션 코드와 별개 검증된 단일 소스 — engine-parity.test.mjs가
// engine과 교차검증)에 위임한다.
// EG(Elimination-extended) 확장 실측으로 발견(하니스 자체 결함, §7 기록): allDraw baseline은
// gameOver에 절대 도달하지 않으므로, 이 대체 함수가 REAL finishRoundLocal의 gameOver 분기가
// 수행하는 `db.from('rooms').update({ status: 'game_over' })`(index.html ~8318/8341, host
// 전용) 부작용을 아예 흉내내지 않아도 그 누락이 드러날 방법이 없었다. 실제 rock/paper/scissors
// 혼합 선택으로 gameOver까지 도달시켜 보니 이 누락이 곧바로 "room이 영원히 status:'result'에
// 머물러 game_over로 전이되지 않는" 영구 STALL로 나타났다 — REAL 앱의 결함이 아니라 이 하니스
// 대체 함수가 처음부터 이 부작용을 재현하지 않았던 것뿐이다(원래 finishRoundLocal은 여전히
// 추출하지 않으므로, 이 한 줄의 DB 부작용만 REAL과 동일하게 재현한다 — 판정 로직 자체는 여전히
// 위 resolveElimination REAL 호출에만 위임, 손으로 새 판정을 짜지 않는다).
// ── H-1(REAL 5경로 모델링): idempotency 캐시 + 안전망 B ───────────────────────
// REAL finishRoundLocal의 scheduleRematchAutoAdvance() 도달 경로는 정확히 5개이고, 그 중 3개는
// 이 대체 함수의 onOutcome 콜백(§createDevice, resolveElimination 반환 직후)이 이미 재현한다:
//   #1 index.html:8636 allDraw 분기 / #2 :8670 tooMany 분기 / #3 :8682 tooFew 분기.
// 나머지 2개는 finishRoundLocal 본문 "밖"의 REAL 함수(추출 블록 rematchAdvance에 이미 포함)를
// 통해서만 도달한다:
//   #4 :9733 scheduleRematchAdvanceRetryAfterFailure(안전망 A) ← nextRound() catch(:9825).
//      → fake db가 항상 { error: null }이라 구조적으로 도달 불가였다 → §createDb의
//        dbErrorInjectionFn(기본 off)로 도달 가능해짐(하니스는 REAL 함수를 호출만 한다).
//   #5 :9759 maybeRecoverStalledRematchAdvance(안전망 B) ← finishRoundLocal 본문 :8212, 즉
//      "idempotent 조기반환(:8188)" 안에서만 호출된다. 이 대체 함수에 idempotency 캐시가 없어
//      :8188 조건(state.lastRoundResolution.eventId === roundEventId)이 영원히 거짓이었고,
//      그래서 duplicate 호출은 매번 전량 재판정됐다 — REAL에는 없는 재분류(phantom outcome)와
//      "REAL 예산(MAX_REMATCH_ADVANCE_RETRIES)을 무시한 무제한 재예약"이 하니스에서만
//      발생했다(onOutcome이 조건 없이 예약하므로). 아래에서 REAL과 동일 의미로 재현한다.
//      ⚠️ 위상 정정(codex-critic P1 독립검증) — #5는 위 #1~#3(정상 판정 분기)이나 #4(write 실패
//      catch)와 동등한 위상의 "정상 경로"가 아니라, 온라인 REAL에서는 구조적으로 도달하기 어려운
//      defense-in-depth다:
//        (a) waitForPhaseRender의 dedup(키 phase:gameNo:round:scheduledAt, index.html:5284-5292)이
//            result→game_over 재진입을 먼저 차단해, 같은 roundEventId로 finishRoundLocal이 두 번
//            호출되는 상황 자체가 온라인에서는 잘 만들어지지 않는다.
//        (b) finishRoundLocal()의 또 다른 직접 호출부인 hostJudgeRound(:9360)는 오프라인 전용이다 —
//            :9345 `if (getOnlineMode()) { await publishHostRoundResult(...) } else { ... :9360 }`.
//            즉 온라인 경로에서 이 호출은 애초에 일어나지 않는다.
//      실측도 이 판정과 일치한다: 정상 sweep(3 profile × N=3..20 × 20 trial = 1080 trial)에서
//      FINISH_ROUND_SUBSTITUTE_IDEMPOTENT 0건 — 캐시/안전망 B는 정상 판정에 개입하지 않는다.
//      따라서 이 재현의 목적은 "자주 쓰이는 경로를 모델링"이 아니라 "duplicate가 들어오는
//      표적 시나리오(§runRematchSafetyNetB* 류)에서 하니스가 REAL에 없는 재판정을 발명하지 않게
//      하는 것"이다.
// roundEventId 산식과 캐시 기록 조건은 추측이 아니라 index.html 원문 그대로다:
//   - roundEventId: `getGameRound() + ':' + (state.round || 1)`(index.html:8169)
//   - 조기반환 조건: `state.lastRoundResolution && state.lastRoundResolution.eventId === roundEventId`(:8188)
//   - 조기반환 시: prev.confirmedSafeIds/LoserIds 복원(:8190-8191) → 비-gameOver면
//     maybeRecoverStalledRematchAdvance()(:8212, gameOver면 호출하지 않음 :8194-8197)
//   - 기록 조건: recordRoundResolution(:8498-8505) — judgeQuality==='localJudge' && activePlayers
//     .length===0이면 기록하지 않는다(ROUND_RESOLUTION_CACHE_SKIPPED). 이 대체 함수의
//     activeForStoredResult는 REAL activePlayers(:8324-8327)와 필터 술어가 동일하고(같은
//     prevSafe/prevLoser 기준) 그 사이에 await가 없으므로 그대로 대응된다.
// 안전망 A/B의 공유 예산 계약(REAL: B는 카운터를 "확인만" 하고 증가시키지 않는다,
// index.html:9740-9746)은 하니스가 재구현하지 않는다 — REAL maybeRecoverStalledRematchAdvance를
// 그대로 호출하므로 계약이 자동으로 보존된다.
function makeFinishRoundLocalSubstitute({
  stateRef, resolveElimination, getChoiceBase, getChoiceResult, isNonPlayingChoice,
  hasConfirmedRoundResult, syncConfirmedIdsFromParticipants, judgeRound,
  getTargetLoserCount, showScreen, telemetry, onOutcome, db, getOnlineMode,
  getGameRound, maybeRecoverStalledRematchAdvance, idempotencyCacheEnabled = true,
}) {
  return async function finishRoundLocalSubstitute() {
    const state = stateRef();
    // H-1: REAL index.html:8169/8188-8215 — 재판정 금지(idempotency) 조기반환. REAL은 이 검사를
    // hasAnyMarkers 복원(:8222 이후)보다 "앞"에서 수행하므로 순서도 그대로 따른다.
    // idempotencyCacheEnabled=false는 H-1 이전 동작(캐시 없음)으로 되돌리는 mutation 토글이다.
    const roundEventId = getGameRound ? (getGameRound() + ':' + (state.round || 1)) : null;
    if (idempotencyCacheEnabled && roundEventId != null
      && state.lastRoundResolution && state.lastRoundResolution.eventId === roundEventId) {
      const prev = state.lastRoundResolution;
      state.confirmedSafeIds = [...prev.confirmedSafeIds];
      state.confirmedLoserIds = [...prev.confirmedLoserIds];
      try {
        // REAL의 TAGGER_REPLAY_IDEMPOTENT(:8192)에 대응하는 하니스 관측 이벤트. 판정 이벤트
        // (FINISH_ROUND_SUBSTITUTE)를 다시 emit하지 않는 것이 핵심이다 — REAL도 이 경로에서는
        // 판정을 다시 하지 않으므로, 여기서 emit하면 "재분류"를 하니스가 스스로 만들어낸다.
        telemetry.emit('metric', {
          wrps: 'RC3-HARNESS', eventType: 'FINISH_ROUND_SUBSTITUTE_IDEMPOTENT',
          eventId: roundEventId, outcome: prev.outcome, round: state.round,
        });
      } catch (e) {}
      // REAL은 gameOver면 showScreen("screenRoundResult")+showTaggerPopup, 아니면
      // showRoundResultOrWait(...)로 분기한다 — 이 하니스의 가짜 DOM에는 대기화면 라우팅이 없어
      // 정상 경로와 동일하게 결과화면 표시로만 대체한다(렌더 표면, 판정/스케줄링 무관).
      try { showScreen('screenRoundResult'); } catch (e) {}
      if (prev.outcome !== 'gameOver' && maybeRecoverStalledRematchAdvance) {
        // 경로 #5(안전망 B) — REAL 함수를 그대로 호출한다(host/online/status==='result'/
        // 타이머·advancingRound 없음/상한 검사 4+1 가드 전부 REAL 소스가 수행).
        try { maybeRecoverStalledRematchAdvance(); } catch (e) {}
      }
      return {
        outcome: prev.outcome,
        newConfirmedSafeIds: [...prev.confirmedSafeIds],
        newConfirmedLoserIds: [...prev.confirmedLoserIds],
        idempotentReplay: true,
      };
    }
    // REAL(추출) — hasAnyMarkers 복원(잔존 __safe__/__loser__ 마커에서 confirmedSafeIds/LoserIds
    // 재구성) + hasStoredResults/activeForStoredResult 판정. state.confirmedSafeIds/LoserIds를
    // 이 호출이 바꿀 수 있으므로(REAL도 동일), 아래 prevSafeIds/prevLoserIds는 이 호출 "이후"에
    // state에서 다시 읽는다 — REAL도 정확히 이 순서다(hasAnyMarkers 복원 → hasStoredResults 판정
    // → 그 다음에야 prevSafeIds/prevLoserIds를 캡처, index.html 8028-8082).
    const { hasStoredResults, activeForStoredResult } = hasStoredResultsCheckFactory(
      state, isNonPlayingChoice, getChoiceBase, hasConfirmedRoundResult, syncConfirmedIdsFromParticipants
    );
    const prevSafeIds = [...(state.confirmedSafeIds || [])];
    const prevLoserIds = [...(state.confirmedLoserIds || [])];
    let roundResults;
    if (hasStoredResults) {
      roundResults = activeForStoredResult.map((p) => ({ id: p.id, result: getChoiceResult(p.choice) }));
    } else {
      const judged = judgeRound(state.participants || []); // REAL judgeRound(judgePure 주입) raw 재계산
      roundResults = activeForStoredResult.map((p) => ({ id: p.id, result: judged[p.id] }));
    }
    try {
      telemetry.emit('metric', {
        wrps: 'RC3-HARNESS', eventType: 'FINISH_ROUND_SUBSTITUTE_SOURCE',
        source: hasStoredResults ? 'stored' : 'localJudge', round: state.round, activeCount: activeForStoredResult.length,
      });
    } catch (e) {}
    const res = resolveElimination({
      roundResults,
      prevLoserIds,
      prevSafeIds,
      targetLoserCount: getTargetLoserCount(),
    });
    state.confirmedSafeIds = res.newConfirmedSafeIds;
    state.confirmedLoserIds = res.newConfirmedLoserIds;
    // H-1: REAL recordRoundResolution(index.html:8498-8505)과 동일 계약으로 idempotency 캐시에
    // 기록한다 — localJudge이면서 활성자가 0명인 "판정 불가" 결과는 캐시에 고착시키지 않는다
    // (WRPS-075 실측 결함B 재발 방지 조항 그대로). roundLoserCount/remainingSlots는 REAL이
    // renderRoundResult 재렌더에만 쓰는 필드인데 이 대체 함수는 렌더를 하지 않으므로 값을
    // 발명하지 않고 생략한다(조기반환 경로도 이 두 필드를 읽지 않는다).
    // ── codex-critic LOW-1: outcome 라벨 차이(무해함을 명시) ────────────────────
    // REAL recordRoundResolution이 캐시에 쓰는 라벨과 이 하니스가 쓰는 resolveElimination 라벨의
    // 대응은 다음과 같다 — 4개 중 3개는 문자열까지 동일하고, allDraw 하나만 다르다:
    //     REAL(index.html)                        하니스(resolveElimination)
    //     :8591/:8616/:8685 "gameOver"       ==   'gameOver'
    //     :8685             "tooMany"        ==   'tooMany'
    //     :8685             "tooFew"         ==   'tooFew'
    //     :8630             "draw"           !=   'allDraw'   ← 유일한 차이
    // 이 차이가 무해한 이유(전수 확인):
    //   (1) 로직 분기는 조기반환의 `prev.outcome !== 'gameOver'`(:8194 대응) 단 한 곳뿐이고,
    //       'allDraw'/'draw' 어느 쪽이든 이 술어의 값이 동일하다.
    //   (2) REAL에서 이 값을 읽는 나머지 두 곳은 전부 관측/렌더 전용이다 —
    //       buildAutoAdvanceMetricPayload의 caseType(:9697, QA metric payload)과
    //       renderRoundResult(prev.outcome, ...)(:8193, 이 하니스는 렌더를 대체하지 않음).
    //       즉 caseType 문자열이 'allDraw'로 찍히는 것은 하니스 텔레메트리 라벨링 차이일 뿐
    //       판정/스케줄링 어디에도 영향을 주지 않는다.
    //   (3) 하니스 자신의 판정 코드도 'allDraw' 쪽 라벨에 맞춰져 있다
    //       (§runMeasuredTrial PHANTOM_OR_CORRUPTED_OUTCOME의 `e.outcome !== 'allDraw'`).
    // 그래서 라벨을 REAL 문자열로 바꾸지 않고 그대로 보존한다(바꾸면 로직 이득 0인데 하니스
    // 전반의 라벨 규약과 tests/h1-rematch-recovery-model.test.mjs의 기대치만 흔들린다).
    if (idempotencyCacheEnabled && roundEventId != null
      && !(!hasStoredResults && activeForStoredResult.length === 0)) {
      state.lastRoundResolution = {
        eventId: roundEventId,
        confirmedSafeIds: [...res.newConfirmedSafeIds],
        confirmedLoserIds: [...res.newConfirmedLoserIds],
        outcome: res.outcome,
      };
    }
    // REAL finishRoundLocal의 gameOver 분기(index.html ~8317-8318/8340-8341, host 전용)와 동일한
    // 부작용 재현: room.status를 'game_over'로 커밋한다 — 위 함수 주석 참고, 이게 없으면 room이
    // 영원히 'result'에 머물러 어떤 device도 gameOver로 전이하지 못한다(EG 실측 발견).
    if (res.outcome === 'gameOver' && getOnlineMode && getOnlineMode() && state.role === 'host' && db) {
      try { await db.from('rooms').update({ status: 'game_over' }).eq('id', state.roomCode); } catch (e) {
        try { telemetry.emit('metric', { wrps: 'RC3-HARNESS', eventType: 'FINISH_ROUND_SUBSTITUTE_GAMEOVER_WRITE_THREW', message: String(e && e.message || e) }); } catch (_) {}
      }
    }
    try { showScreen('screenRoundResult'); } catch (e) {}
    try {
      // STOP-SHIP 술래-소거 확장(EG, Elimination-extended): 기존 allDraw baseline은 outcome/round만
      // 기록해도 충분했다("항상 allDraw"라는 외부 지식만으로 오분류를 잡을 수 있었으므로). 실제
      // rock/paper/scissors 혼합 선택으로 tooMany/tooFew/gameOver까지 검증하려면 "이 라운드에
      // 실제로 무엇이 입력됐고 그 결과 무엇이 나왔는가"의 전체 감사 기록이 필요하다 — 그래서
      // roundResults(입력, id+result)/prevSafeIds·prevLoserIds(직전 확정 집합)/
      // newConfirmedSafeIds·newConfirmedLoserIds(REAL resolveElimination이 실제로 반환한 새 집합)를
      // 함께 남긴다. 이 필드들은 판정 로직에 전혀 영향을 주지 않는 관측 전용 확장이며(resolveElimination
      // 호출/반환값을 그대로 옮겨 적을 뿐), EG-Phase0/EG-§2 오라클(§rc3-harness-support.mjs 하단
      // runEliminationTrial 참고)이 "REAL 파이프라인이 실제로 계산한 값"과 "독립적으로 재계산한
      // 기대값"을 나중에(사후) 대조하는 데 쓰인다.
      telemetry.emit('metric', {
        wrps: 'RC3-HARNESS', eventType: 'FINISH_ROUND_SUBSTITUTE', outcome: res.outcome, round: state.round,
        roundResults: roundResults.map((r) => ({ id: r.id, result: r.result })),
        prevSafeIds: [...prevSafeIds], prevLoserIds: [...prevLoserIds],
        newConfirmedSafeIds: [...res.newConfirmedSafeIds], newConfirmedLoserIds: [...res.newConfirmedLoserIds],
        targetLoserCount: getTargetLoserCount(),
      });
    } catch (e) {}
    if (onOutcome) onOutcome(res);
    return res;
  };
}

// ── STOP-SHIP Phase0(2.6초 REST 폴링 채널 충실 모델링) ────────────────────────
// REAL subscribeToRoom(index.html 5578-5590)의 폴링 백업:
//   state.pollInterval = setInterval(async () => {
//     const { data: room } = await db.from('rooms').select('*').eq('id', roomCode).single();
//     await fetchParticipants(roomCode);
//     if (room) await handleRoomUpdate(room);
//   }, 2600);
// 이 폴링은 realtime 채널(postgres_changes 구독)과 완전히 독립된 별도 REST 경로다 — 방에 연결된
// "모든" 클라이언트(host 포함)에서 2.6초마다 무조건 돈다. 지금까지(§Part A/D §7 한계) 이 채널
// 자체는 이 하니스에 전혀 존재하지 않았다 — realtime 배달 순서만 재정렬하는 deliveryOrderMode:
// 'outOfOrder'는 "폴링이 있으면 이런 재정렬이 생길 수 있다"는 위협 모델의 일반화된 프록시였을 뿐,
// 실제 2.6초 주기·실제 독립 REST 지연·실제 fetchParticipants 동반 호출을 재현하지 않았다.
//
// 아래 createDevice의 poll 타이머는 REAL과 동일한 3단계 순서(room select → participants →
// handleRoomUpdate(room))를 그대로 재현한다:
//   (1) db.from('rooms').select('*').eq(...).single() — createDb의 opRoomsSelectSingle을 그대로
//       호출한다. 이 select는 realtime 브로드캐스트 큐(scheduleReorderableDelivery)를 전혀 거치지
//       않고 db의 ackDelayFn(60~280ms, sampleRealtimeDelayMs와 완전히 독립된 분포)만 거쳐
//       roomStore.row의 "그 시점 현재값"을 직접 읽는다 — 그래서 이 스냅샷이 realtime 배달과
//       완료 순서가 무보장으로 인터리빙된다(§본문 Phase0 요구사항의 핵심).
//   (2) fetchParticipants(roomCode) 자체(index.html ~6066, cleanupDuplicateRoomProfiles/host 승계/
//       중복 프로필 정리 등과 강결합)는 여전히 추출하지 않는다 — 이미 §Part A/D에 문서화된 동일한
//       gap이다(그 함수 전체를 새로 추출하지 않고는 host 승계 부작용까지 충실히 재현할 수 없다).
//       그러나 이 폴링 자체가 존재한다는 것의 "가시 효과"(participants 테이블을 REST로 재조회해
//       state.participants를 새로고침)는 no-op으로 건너뛰지 않고 pollFetchParticipants()가 실제로
//       db.from('participants').select(...)(REAL db 경유, 독립 ackDelay)를 호출해 재현한다.
//   (3) room이 truthy면 REAL handleRoomUpdate(room)을 그대로 호출한다(추출 코드, 손대지 않음) —
//       isStaleRoomRow 가드/WRPS-079 hruGen 재진입 가드 등 REAL 방어 로직이 이 폴링 경로에도 동일하게
//       적용된다.
// pollingEnabled 기본값(false)은 기존 회귀 스윕 전부(717 baseline)에 영향이 없다 — 타이머 자체가
// 생성되지 않는다. 켜졌을 때도 REAL과 동일하게 "이전 tick의 async 본문이 아직 안 끝났어도 다음
// tick은 그냥 또 발화한다"(setInterval은 콜백 완료를 기다리지 않는다) — 손으로 재진입 가드를
// 추가하지 않는다(REAL도 안 하므로 이게 충실성이다).
//
// ⚠️ 충실성 수정(1차 구현 실측으로 발견): 처음 구현은 poll tick의 3단계 중 (3)을
// `implRef().handleRoomUpdate(room)`으로 device impl을 직접 호출했다 — 그런데 createTrialWorld의
// realtime 배달 경로(roomStore.subscribers[i].onRoomRow)는 REAL handleRoomUpdate 호출을
// begin/finishStaleRowRegressionCheck·begin/finishReadyBranchClobberCheck로 감싸고, 그 직후 접합부
// ②(현재 라운드 참가자면 즉시 선택 제출)까지 수행한다(§createTrialWorld 상단 주석). ⚠️ H-1 정정:
// 이 주석이 함께 열거하던 "접합부 ③(result 상태면 REAL scheduleRematchAutoAdvance 호출)"은 이미
// STOP-SHIP happens-before 수정 때 이 위치에서 제거됐고(§createTrialWorld의 접합부 ③ 제거 주석),
// 그 예약은 finishRoundLocal 대체의 onOutcome 콜백으로 옮겨졌다 — poll 경로에도 동일하게 적용되는
// 것은 그 onOutcome(=finishRoundLocal 호출 자체)이지 이 wrapper의 별도 트리거가 아니다.
// poll이 이 wrapper를 건너뛰고 impl.handleRoomUpdate를 직접
// 부르면: (a) REAL isStaleRoomRow 가드가 뚫려도 이 detector가 관측하지 못해
// STALE_ROW_REGRESSION이 구조적으로 0으로만 나오고(측정 자체가 무효), (b) poll이 유일하게 이번
// 라운드 'playing' 전환을 알려준 경우에도 참가자가 선택을 제출하지 않는 시나리오가 생겨 실제
// 앱에서는 안 일어날 STALL/desync를 하니스가 인위적으로 만들어낼 수 있다. 그래서 poll은 반드시
// realtime과 "동일한" onRoomRow 래퍼를 통해서만 room row를 전달해야 한다 — 이 함수는 그 래퍼
// 자체를 인자로 받는다(createTrialWorld가 subscriber 등록 직후 넘겨준다).
function startDevicePolling({ pollingEnabled, pollIntervalMs, db, roomStore, implRef, telemetry, onRoomRow }) {
  let handle = null;
  async function pollFetchParticipants() {
    const { data: rows } = await db.from('participants').select('*')
      .eq('room_id', roomStore.id).order('created_at', { ascending: true });
    if (rows) implRef().state.participants = rows;
  }
  function start() {
    if (!pollingEnabled || handle) return;
    handle = setInterval(async () => {
      try {
        const { data: room } = await db.from('rooms').select('*').eq('id', roomStore.id).single();
        await pollFetchParticipants();
        if (room) await onRoomRow(room);
      } catch (e) {
        try { telemetry.emit('metric', { wrps: 'RC3-HARNESS', eventType: 'POLL_TICK_THREW', message: String(e && e.message || e) }); } catch (_) {}
      }
    }, pollIntervalMs);
  }
  function stop() {
    if (handle) { clearInterval(handle); handle = null; }
  }
  return { start, stop };
}

// ── device(= 앱 인스턴스 1개) 생성 ───────────────────────────────────────────
export function createDevice({ id, isHost, roomStore, rng, participantCount, resolveElimination, judgePure, computePlayerStatuses, PLAYER_STATUS, maxLoserCountFor, targetLoserCount = 1, combinedSourceOverride = null, realtimeDelayRegime = 'pessimistic', deliveryOrderMode = 'monotonic', index = 0, skewMsOverrideFn = null, clockRttOverrideFn = null,
  // H-1: 기본값(null/true)은 기존 동작과 완전히 동일하다 — dbErrorInjectionFn=null이면 fake db는
  // 수정 전과 바이트 동일 경로로 동작하고(§createDb), idempotencyCacheEnabled=false는 H-1 이전
  // (캐시 없음) 동작으로 되돌리는 mutation 토글이다(§makeFinishRoundLocalSubstitute).
  dbErrorInjectionFn = null, idempotencyCacheEnabled = true }) {
  const dom = createFakeDom();
  const telemetry = createTelemetry();
  // §STOP-SHIP Part B: skewMsOverrideFn이 주어지면(예: createAlternatingSkewFn) 그것으로 skew를
  // 결정한다 — 기본값(null)은 기존 sampleSkewMs 그대로라 회귀 없음.
  const skewMs = skewMsOverrideFn
    ? skewMsOverrideFn({ index, isHost, rng })
    : (isHost ? 0 : sampleSkewMs(rng)); // host도 skew를 가질 수 있으나 대조군 단순화를 위해 0 고정(보고서에 명시)
  // §STOP-SHIP §Step1: clockRttOverrideFn이 주어지면(예: makeClockRttOverrideFn) 그것으로 clock
  // sync RPC RTT 분포를 대체한다 — 기본값(null)은 기존 sampleClockRtt(rng, id) 그대로라 회귀 없음.
  const clockRtt = clockRttOverrideFn ? clockRttOverrideFn({ index, isHost, rng }) : sampleClockRtt(rng, id);
  const RealDate = Date;
  const FakeDate = { now: () => RealDate.now() + skewMs };

  const state = {
    roomCode: roomStore.id,
    role: isHost ? 'host' : 'participant',
    currentUserId: id,
    nickname: id,
    penalty: '',
    round: 1,
    status: 'waiting',
    participants: [],
    timer: null,
    animationTimer: null,
    remainingSeconds: 5,
    onlineParticipantIds: [],
    presenceReady: true,
    confirmedSafeIds: [],
    confirmedLoserIds: [],
    targetLoserCount,
    gameRound: 1,
    lastStartedGameRound: 0,
    countdownStartAt: 0,
    choiceEndAt: 0,
    countdownGeneration: 0,
    countdownCoroutineActiveKey: null,
    gameStarting: false,
    finishingRound: false,
    advancingRound: false,
    rematchAdvanceTimer: null,
    rematchAdvanceRetryAttempts: {},
    roundJudgeDeferAttempts: {},
    roundJudgeDeferTimer: null,
    renderedPhaseKeys: {},
    renderedPhaseKeysGameNo: null,
    confirmedIdsResetGameNo: null,
    playingEntryKey: null,
    lastRoundResolution: null,
    publishingRoundResult: false,
  };

  const db = createDb({
    roomStore,
    deviceId: id,
    isHost,
    rng,
    clockRttFn: () => clockRtt,
    ackDelayFn: () => 60 + rng() * 220,
    realtimeDelayRegime,
    deliveryOrderMode,
    dbErrorInjectionFn,
  });

  // 하니스 관측용 기록(측정 전용 — 판정 로직에 영향 없음).
  const rendered = {
    countdownStartByRound: {},
    choiceStartByRound: {},
    choiceEndByRound: {},
    resultByRound: {},
    readyByRound: {},
    screenGameEnteredByRound: {},
    duplicateCountdownAttempts: 0,
    // RC-3 Phase4(반공허성 B): STALE_ROW_REGRESSION 검출용 고수위표(high-water mark) — 이 기기가
    // 지금까지 처리한 row들 중 가장 큰 gameRound(§beginStaleRowRegressionCheck/
    // finishStaleRowRegressionCheck 참고).
    maxGameRoundSeen: null,
  };

  // computeChoiceRemainingSeconds도 factory 완성 후에야 얻을 수 있다(위 finishRoundLocal과
  // 동일한 지연 바인딩 필요 — env.setInterval 훅이 이걸 다시 호출해 0 도달 시각을 관측한다).
  const computeChoiceRemainingSecondsHolder = { fn: () => null };

  const env = {
    state, db, QA: telemetry, sleep: (ms) => new Promise((r) => setTimeout(r, ms)), Date: FakeDate,
    // beginRoundTimer()가 등록하는 1초 tick — 실제 코드가 이 이름을 자유변수로 참조하므로 여기서
    // 가로채면 "언제 선택화면 타이머가 시작되는지(choice-start)"와 "언제 남은시간이 처음 0 이하가
    // 되는지(choice-end)"를 관측할 수 있다(콜백 자체는 원본 그대로 실행 — 부가 관측만 추가).
    setInterval: (fn, ms) => {
      const round = state.round;
      if (!rendered.choiceStartByRound[round]) {
        rendered.choiceStartByRound[round] = { ts: RealDate.now(), localTs: FakeDate.now() };
      }
      return setInterval(() => {
        fn();
        try {
          // state.remainingSeconds는 beginRoundTimer의 tick이 방금(fn() 안에서) 갱신한 "실제
          // 화면에 표시되는 값"이다 — computeChoiceRemainingSeconds()가 앵커 없이(오프라인/
          // mutation) null을 반환해 로컬 감산 폴백(state.remainingSeconds - 1)만 쓰는 경우에도
          // 이 필드 자체는 항상 갱신되므로, 이 값을 직접 관측해야 "그 경로가 어떻든 화면이 실제로
          // 0을 찍은 시각"을 놓치지 않는다(computeChoiceRemainingSeconds()를 다시 호출해 null 여부만
          // 보면 mutation 시나리오에서 관측 자체가 무력화된다 — RC-3 실측으로 발견/수정).
          if (state.remainingSeconds <= 0 && !rendered.choiceEndByRound[round]) {
            rendered.choiceEndByRound[round] = { ts: RealDate.now(), localTs: FakeDate.now() };
          }
        } catch (e) {}
      }, ms);
    },
    clearInterval: (h) => clearInterval(h),
    t: (key) => key, currentLocale: 'ko',
    SoundManager: { unlock() {}, playButton() {}, isSilent() { return true; }, clipPath() { return ''; } },
    playVoiceClip: () => {}, saveState: () => {}, showToast: () => {}, clearToast: () => {},
    $: dom.$, document: dom.documentStub, window: {}, navigator: {}, location: { hostname: 'localhost' },
    judgePure, computePlayerStatuses, PLAYER_STATUS, maxLoserCountFor,
    showReadyScreen: () => { rendered.readyByRound[state.round] = { ...(rendered.readyByRound[state.round] || {}), rendered: true, ts: RealDate.now() }; try { impl.showScreen('screenReady'); } catch (e) {} },
    showHostRoom: () => { rendered.readyByRound[state.round] = { ...(rendered.readyByRound[state.round] || {}), rendered: true, ts: RealDate.now() }; try { impl.showScreen('screenHostRoom'); } catch (e) {} },
    showStats: async () => {},
    renderLobby: () => {},
    showInvitePopupForRoom: () => {},
    renderTentativeRoundResult: () => false,
    scheduleFetchParticipants: () => {},
    renderAll: () => {},
    updateRoomBadge: () => {},
    hideTaggerPopup: () => {},
    showTaggerPopup: () => {},
    renderRoundResult: () => {},
    setBtnText: () => {},
    // finishRoundLocal은 impl(getChoiceBase 등 REAL 함수) 완성 후에야 만들 수 있는데, new Function
    // 내부의 `const { ..., finishRoundLocal } = env;`는 factory(env) 호출 "그 순간"의 env.finishRoundLocal
    // 값을 한 번만 읽어 고정한다 — 나중에 env.finishRoundLocal을 재할당해도 factory 내부 바인딩에는
    // 반영되지 않는다(const destructure는 스냅샷이지 참조가 아님). 그래서 여기서는 항상 이 래퍼
    // 함수 자체를 넘기고, 실제 구현은 holder.fn에 지연 바인딩한다 — 래퍼는 "호출되는 시점"에
    // holder.fn을 조회하므로 나중에 채워도 정상 동작한다.
    finishRoundLocal: (...args) => {
      const p = finishRoundLocalHolder.fn(...args);
      // 프로덕션 코드도 finishRoundLocal()을 await 없이 호출한다(handleRoomUpdate 내부) — 우리
      // 대체 구현이 던지면 unhandled rejection으로 조용히 사라져 디버깅이 어려우므로 텔레메트리에
      // 남긴다(판정 로직에는 영향 없음 — 관측 전용 안전망).
      if (p && typeof p.catch === 'function') {
        p.catch((e) => { try { telemetry.emit('metric', { wrps: 'RC3-HARNESS', eventType: 'FINISH_ROUND_SUBSTITUTE_THREW', message: String(e && e.message || e) }); } catch (_) {} });
      }
      return p;
    },
  };
  const finishRoundLocalHolder = { fn: () => { throw new Error('[rc3-harness] finishRoundLocal called before substitute was wired'); } };

  const factoryBody = `
    "use strict";
    const { state, db, QA, sleep, Date, setInterval, clearInterval, t, currentLocale, SoundManager, playVoiceClip, saveState,
      showToast, clearToast, $, document, window, navigator, location,
      judgePure, computePlayerStatuses, PLAYER_STATUS, maxLoserCountFor,
      showReadyScreen, showHostRoom, showStats, renderLobby, showInvitePopupForRoom,
      renderTentativeRoundResult, scheduleFetchParticipants, renderAll, updateRoomBadge,
      hideTaggerPopup, showTaggerPopup, renderRoundResult, setBtnText, finishRoundLocal } = env;
    ${combinedSourceOverride || COMBINED_SOURCE}
    return {
      state,
      syncServerClock, serverNow, selectClockSyncOffset,
      getServerClockSynced: () => serverClockSynced,
      getServerClockOffsetMs: () => serverClockOffsetMs,
      parsePenalty, buildPenaltyValue, getGameRound, getPenaltyGameRound, getCountdownStartAt,
      getChoiceEndAt, getNextCountdownStartAt, getNextPhaseScheduledAt, getTargetLoserCount,
      getOnlineMode,
      isSafeParticipant, isConfirmedLoser, isNonPlayingChoice, getChoiceBase, getChoiceResult,
      isAutoChoice, encodeRoundChoice, hasConfirmedRoundResult,
      getActivePlayers,
      waitForPhaseRender, isCurrentRoundParticipant, isWaitingForNextGame, isScreenActive,
      isCountdownActive, getPlayingEntryKey, syncConfirmedIdsFromParticipants,
      enterPlayingStateFromRoomUpdate,
      handleRoomUpdate,
      updateRoomStatus, updateRoomStatusScheduled, updateParticipantChoice,
      hideAllScreens, showScreen,
      startGame, waitForValidCountdownStart, republishCountdownStartAsHost,
      isCountdownGenerationCurrent, runCountdown, runCountdownThenShowGame, beginRoundTimer,
      computeChoiceRemainingSeconds, stopRoundTimers,
      updateSelectedCount, autoFillChoices,
      publishHostRoundResult,
      judgeRound,
      scheduleRematchAutoAdvance, nextRound,
      // H-1: REAL rematchAdvance 블록(index.html:9658-9760)에 이미 통째로 들어있는 나머지
      // 함수들을 그대로 노출한다(재구현 금지 원칙 — 하니스는 호출만 한다).
      //   scheduleRematchAdvanceRetryAfterFailure = 안전망 A(:9717, 카운터를 증가시키는 유일한 곳)
      //   maybeRecoverStalledRematchAdvance      = 안전망 B(:9747, 카운터를 확인만 함)
      //   getRematchAdvanceRetryKey/Attempts     = A/B가 공유하는 라운드별 예산(:9682/9685)
      scheduleRematchAdvanceRetryAfterFailure, maybeRecoverStalledRematchAdvance,
      getRematchAdvanceRetryKey, getRematchAdvanceRetryAttempts,
      getMaxRematchAdvanceRetries: () => MAX_REMATCH_ADVANCE_RETRIES,
      withTimeout,
    };
  `;
  // eslint-disable-next-line no-new-func
  const factory = new Function('env', factoryBody);
  const impl = factory(env);
  computeChoiceRemainingSecondsHolder.fn = () => impl.computeChoiceRemainingSeconds();

  // ── 관측 훅(측정 전용, 판정 로직 무변경) ──────────────────────────────────
  // choice-start/choice-end는 index.html에 전용 SYNC_RENDER 텔레메트리가 없다(countdown/result/
  // nextRound 3개 phase만 QA.emit됨). impl.beginRoundTimer를 construction 이후 바꿔치기하는
  // 방식은 효과가 없다 — runCountdownThenShowGame() 내부는 이 이름을 factory 안의 클로저
  // 바인딩(자유변수)으로 직접 호출하므로, 나중에 반환 객체의 프로퍼티를 바꿔도 그 내부 호출은
  // 영향을 받지 않는다(위 finishRoundLocal과 동일한 종류의 함정). 대신 env가 제공하는
  // setInterval(원본 코드가 실제로 이 이름을 자유변수로 참조 — beginRoundTimer가 state.timer를
  // 등록하는 바로 그 호출)을 가로챈다 — "호출 자체"는 실제 코드가 하는 것이고, 우리는 그 호출의
  // 발생 시각과 매 tick마다 REAL computeChoiceRemainingSeconds()를 한 번 더(부작용 없는 순수
  // 조회) 불러 0 도달 시각만 관측한다.

  // finishRoundLocal 대체 구현을 이제 impl(getChoiceBase 등 REAL 함수)에 연결한다 — 위 holder를 통해
  // factory 내부에서 이미 캡처된 래퍼가 이 시점 이후 이 실제 구현을 호출하게 된다.
  finishRoundLocalHolder.fn = makeFinishRoundLocalSubstitute({
    stateRef: () => impl.state,
    resolveElimination,
    getChoiceBase: impl.getChoiceBase,
    getChoiceResult: impl.getChoiceResult,
    isNonPlayingChoice: impl.isNonPlayingChoice,
    hasConfirmedRoundResult: impl.hasConfirmedRoundResult,
    syncConfirmedIdsFromParticipants: impl.syncConfirmedIdsFromParticipants,
    judgeRound: impl.judgeRound,
    getTargetLoserCount: impl.getTargetLoserCount,
    showScreen: impl.showScreen,
    telemetry,
    db, getOnlineMode: impl.getOnlineMode,
    // H-1: roundEventId 산식(index.html:8169)과 안전망 B(:9747)는 둘 다 REAL 함수를 그대로 쓴다.
    getGameRound: impl.getGameRound,
    maybeRecoverStalledRematchAdvance: impl.maybeRecoverStalledRematchAdvance,
    idempotencyCacheEnabled,
    onOutcome: (res) => {
      rendered.resultByRound[impl.state.round] = { ...(rendered.resultByRound[impl.state.round] || {}), outcome: res.outcome, ts: RealDate.now() };
      // STOP-SHIP(happens-before 수정, critic A/B 검증): REAL finishRoundLocal은
      // scheduleRematchAutoAdvance()를 이번 라운드 확정 집합이 이미 정해진 그 지점에서, 같은 동기
      // tick 안에서 호출한다 — index.html allDraw:8636 / tooMany:8670 / tooFew:8682.
      // ⚠️ H-1 정정(이전 서술 "셋 다 confirmedSafeIds/LoserIds 대입 직후"는 부정확했다):
      //   - tooMany(:8663-8670)는 `state.confirmedSafeIds = [...prevSafeIds, ...roundWinners]`
      //     (:8664) 직후가 맞고, tooFew(:8671-8682)도 `state.confirmedLoserIds = [...prevLoserIds,
      //     ...roundLosers]`(:8672) 직후가 맞다.
      //   - 그러나 allDraw 분기(:8621-8637)에는 그 대입 자체가 아예 없다(allDraw는 아무도 새로
      //     확정하지 않으므로 REAL도 state.confirmedSafeIds/LoserIds를 건드리지 않는다 —
      //     resolveElimination의 allDraw 반환도 prevSafes/prevLosers를 그대로 돌려준다). 그래도
      //     "이번 라운드 확정 집합이 최종적으로 정해진 시점"이라는 happens-before 성질은 동일하므로
      //     onOutcome(=resolveElimination 반환 직후) 시점 재현은 세 분기 모두에 대해 유효하다.
      //   - gameOver 분기(:8531-8593, :8598-8618, :8645-8662)는 scheduleRematchAutoAdvance를 전혀
      //     호출하지 않는다(nextRound 없이 게임 종료) — 아래 res.outcome!=='gameOver' 가드와 일치.
      //   - 이 3곳 외의 REAL 호출부 2곳(안전망 A :9733 / 안전망 B :9759)은 finishRoundLocal 본문
      //     밖이라 이 콜백이 아니라 §makeFinishRoundLocalSubstitute의 idempotency 조기반환과
      //     §createDb dbErrorInjectionFn 경로로 재현된다(H-1).
      // 반면 REAL handleRoomUpdate(index.html:6001)는 finishRoundLocal()을 await 없이
      // fire-and-forget 호출하므로, "result 상태를 봤다"는 handleRoomUpdate의 리턴 시점은
      // finishRoundLocal의 async 본문(waitForPhaseRender/fetchFreshParticipantsForResult 등 버퍼
      // 비례 지연 포함)이 confirmedSafeIds/LoserIds를 확정하기 훨씬 전일 수 있다. 이전 버전의 이
      // 하니스는 handleRoomUpdate 리턴 직후(옛 접합부 ③, 아래 createTrialWorld 참고)
      // scheduleRematchAutoAdvance를 별도로 호출해 이 happens-before를 깨고 있었다 — 그 결과
      // 고정 1500ms 예약 vs 실제 버퍼 지연 경합에서 nextRound가 아직 []인 confirmedLoserIds를 읽어
      // loser 마커를 유실하는 PHANTOM_OR_CORRUPTED_OUTCOME을 하니스 스스로 만들어냈다(REAL 결함이
      // 아니라 하니스 측정도구 결함). 이제는 onOutcome이 resolveElimination 반환 직후(=REAL이
      // state.confirmedSafeIds/LoserIds를 대입한 바로 그 지점과 동일한 동기 시점) 호출되므로, 여기서
      // res.outcome!=='gameOver'일 때만 REAL scheduleRematchAutoAdvance()를 호출하면 REAL의
      // happens-before(확정 이후에만 예약)를 정확히 재현한다(gameOver는 REAL도 예약하지 않으므로
      // 제외 — 더 이르지도 늦지도 않게).
      if (res.outcome !== 'gameOver') {
        try { impl.scheduleRematchAutoAdvance(); } catch (e) {}
      }
    },
  });

  // §STOP-SHIP Phase0: 2.6초 REST 폴링 채널은 이 device 생성 시점이 아니라 createTrialWorld에서
  // roomStore.subscribers에 onRoomRow 래퍼를 등록한 "직후"에 시작된다(위 startDevicePolling의
  // 충실성 수정 주석 참고 — poll이 realtime과 동일한 onRoomRow 래퍼를 거쳐야 stale-row-regression/
  // ready-branch-clobber 검출기와 접합부 ②/③ 글루가 poll 경로에도 동일하게 적용된다. 이 시점엔
  // 그 래퍼가 아직 없으므로 여기서는 폴링을 시작하지 않는다 — stopPolling은 createTrialWorld가
  // device 객체에 사후 부착한다(기본값 미부착 시 아래 optional chaining으로 안전하게 no-op).

  return { id, isHost, impl, dom, telemetry, rendered, roomStore, skewMs, clockRtt, env };
}

// ── RC-3 Phase4(반공허성 B): 객관적-stale-row 기반 regression 검출기 ────────────
// 처음 시도(§git 이력 참고)는 "state.gameRound가 감소했는가"만 봤는데, 실측(§반공허성 B 실집행)
// 으로 이게 공허하다는 걸 발견했다: REAL getGameRound()가 이미 `Math.max(1, incomingGameRound,
// state.gameRound)`로 gameRound 자체의 감소를 방어하고 있어서(§index.html Build28 Round2 주석),
// isStaleRoomRow 가드를 mutation으로 완전히 무력화해도 state.gameRound는 여전히 안 줄어든다 —
// 그런데도 그 STALE row의 round/countdownStartAt/penalty는 Math.max 보호 없이 그대로 덮어써진다
// (이게 바로 실제 프로덕션 결함 "게임=6, 라운드=2라는 존재하지 않는 조합"의 정체다). 그래서 진짜
// 검출 대상은 "gameRound 감소"가 아니라 "객관적으로 과거(incomingGameRound < 지금까지 본 최댓값)인
// row가 적용된 후 round/countdownStartAt이 실제로 바뀌었는가"다.
//
// beginStaleRowRegressionCheck(row 처리 "전")가 그 row 자신의 gameRound를 REAL
// getPenaltyGameRound로 추출해(판정에 영향 없는 순수 관측 — REAL 가드가 이 row를 어떻게
// 처리하든 이 판단 자체는 바뀌지 않는다) "이 row가 객관적으로 stale인가"를 독립적으로 판정하고,
// finishStaleRowRegressionCheck(처리 "후")가 그 경우에만 round/countdownStartAt/gameRound가
// 실제로 바뀌었는지 확인해 STALE_ROW_REGRESSION을 기록한다.
export function beginStaleRowRegressionCheck(device, row) {
  let incomingGameRound = 0;
  try { incomingGameRound = device.impl.getPenaltyGameRound(row && row.penalty); } catch (e) {}
  const priorMaxGameRound = device.rendered.maxGameRoundSeen;
  const isObjectivelyStale = incomingGameRound > 0 && priorMaxGameRound != null && incomingGameRound < priorMaxGameRound;
  return {
    isObjectivelyStale, incomingGameRound, priorMaxGameRound,
    before: {
      gameRound: device.impl.state.gameRound, round: device.impl.state.round,
      countdownStartAt: device.impl.state.countdownStartAt,
    },
  };
}

export function finishStaleRowRegressionCheck(device, checkCtx) {
  const gameRound = device.impl.state.gameRound;
  if (gameRound != null && (device.rendered.maxGameRoundSeen == null || gameRound > device.rendered.maxGameRoundSeen)) {
    device.rendered.maxGameRoundSeen = gameRound;
  }
  if (!checkCtx || !checkCtx.isObjectivelyStale) return;
  const after = {
    gameRound: device.impl.state.gameRound, round: device.impl.state.round,
    countdownStartAt: device.impl.state.countdownStartAt,
  };
  const changed = after.round !== checkCtx.before.round
    || after.countdownStartAt !== checkCtx.before.countdownStartAt
    || after.gameRound < checkCtx.before.gameRound;
  if (!changed) return;
  try {
    device.telemetry.emit('metric', {
      wrps: 'RC3-HARNESS', eventType: 'STALE_ROW_REGRESSION', device: device.id,
      detail: `objectively-stale row(incomingGameRound=${checkCtx.incomingGameRound} < priorMax=${checkCtx.priorMaxGameRound}) applied: round ${checkCtx.before.round}->${after.round}, gameRound ${checkCtx.before.gameRound}->${after.gameRound}`,
      before: checkCtx.before, after,
    });
  } catch (e) {}
}

// ── WRPS-079 Round2(STOP-SHIP, HIGH 잔존 수정) 전용 탐지기: ready 분기 commit 게이트 검증 ──
// 위 finishRoundLocal 세대 가드(§WRPS-079 describe 참고, index.html ~5888)와 대칭인 두 번째
// commit 재개 지점(ready 분기, index.html ~5928 `if (!readyBranchStaleGeneration)`)이 실제로
// 낡은 컨텍스트의 커밋을 막고 있는지, 그 if/else 게이트 로직 자체에 기대지 않고 독립적으로
// 확인한다(§STOP-SHIP 지시: "탐지기가 게이트 자체의 산출물에 의존하면 안 된다"는 순환논증 회피).
//
// beginReadyBranchClobberCheck(handleRoomUpdate 호출 "전")는 이 기기의 confirmedSafeIds/
// LoserIds 서명과, 지금까지 이 기기의 telemetry에 쌓인 이벤트 개수(이번 호출 동안 새로 emit된
// 이벤트만 골라내기 위한 커서)를 기록해둔다.
//
// finishReadyBranchClobberCheck(호출 "후")는 이번 호출 동안 REAL 코드(index.html handleRoomUpdate
// ready 분기)가 실제로 emit한 HANDLE_ROOM_UPDATE_READY_BRANCH_RESUMED 계측을 살핀다 — 이
// staleGeneration 필드는 게이트(if/else)가 있든 없든 항상 REAL하게(state.hruGen!==room.__hruGen)
// 계산·기록되므로(위 index.html 주석 참고), 게이트를 나중에 실수로 제거·완화해도 이 신호 자체는
// 계속 정확하다. staleGeneration:true인 이벤트가 하나라도 있었는데 그런데도 confirmedSafeIds/
// LoserIds 서명이 호출 전후로 실제로 바뀌었다면, 낡은(superseded) 컨텍스트의 ready 분기 커밋이
// 게이트를 뚫고 실제로 state를 훼손했다는 직접 증거다(READY_BRANCH_STATE_CLOBBER) — 게이트가
// 정상이면(현재 코드) 이 조합은 구조적으로 불가능하다: staleGeneration:true는 오직 else 분기로만
// 이어지고, 그 else 분기는 confirmedSafeIds/LoserIds에 전혀 손을 대지 않는다. 이 조합은 오직
// 게이트가 없거나(수정 전) mutation으로 무력화됐을 때만 관측되어야 한다 — 아래 mutation
// 부하검증(WRPS-079 describe)이 그것을 확인한다.
export function beginReadyBranchClobberCheck(device) {
  return {
    eventsBeforeLen: device.telemetry.events.length,
    before: {
      confirmedSafeIds: [...(device.impl.state.confirmedSafeIds || [])].sort(),
      confirmedLoserIds: [...(device.impl.state.confirmedLoserIds || [])].sort(),
    },
  };
}

export function finishReadyBranchClobberCheck(device, checkCtx) {
  if (!checkCtx) return;
  const newEvents = device.telemetry.events.slice(checkCtx.eventsBeforeLen);
  const staleResumeEvents = newEvents.filter((e) =>
    e.kind === 'metric' && e.eventType === 'HANDLE_ROOM_UPDATE_READY_BRANCH_RESUMED' && e.staleGeneration === true);
  if (staleResumeEvents.length === 0) return;
  const after = {
    confirmedSafeIds: [...(device.impl.state.confirmedSafeIds || [])].sort(),
    confirmedLoserIds: [...(device.impl.state.confirmedLoserIds || [])].sort(),
  };
  const changed = JSON.stringify(after.confirmedSafeIds) !== JSON.stringify(checkCtx.before.confirmedSafeIds)
    || JSON.stringify(after.confirmedLoserIds) !== JSON.stringify(checkCtx.before.confirmedLoserIds);
  if (!changed) return;
  try {
    device.telemetry.emit('metric', {
      wrps: 'RC3-HARNESS', eventType: 'READY_BRANCH_STATE_CLOBBER', device: device.id,
      detail: `stale-generation ready-branch resume(staleResumeCount=${staleResumeEvents.length}) actually mutated confirmedSafeIds/LoserIds: safe ${JSON.stringify(checkCtx.before.confirmedSafeIds)}->${JSON.stringify(after.confirmedSafeIds)}, loser ${JSON.stringify(checkCtx.before.confirmedLoserIds)}->${JSON.stringify(after.confirmedLoserIds)}`,
      before: checkCtx.before, after,
    });
  } catch (e) {}
}

// ── 트라이얼 세계 구성 + 라운드 진행 드라이버 ─────────────────────────────────
// 이 함수들은 "하니스 조율 접합부"다(README 상단 경계 선언 참고) — index.html에서 추출한 REAL
// 함수를 어떤 순서로 호출하는지에 대한 글루 코드이며, 판정/스케줄링 수치 자체는 전부 위 REAL 함수
// 호출 결과를 그대로 쓴다. 3곳만 하니스가 대신한다: ①1라운드 시작 트리거 ②참가자 선택 제출
// 트리거(실제 UI 클릭 대신) ③"전원 ready 렌더 완료" 감지 후 다음 라운드 시작 트리거(실제 UI의
// markReady 버튼 클릭 체인 대신, host의 실제 startGame()을 직접 호출).
export function createTrialWorld({ participantCount, seed, targetLoserCount = 1, resolveElimination, judgePure, computePlayerStatuses, PLAYER_STATUS, maxLoserCountFor, combinedSourceOverride = null, realtimeDelayRegime = 'pessimistic', choiceDriverFn = null, deliveryOrderMode = 'monotonic', skewMsOverrideFn = null, clockRttOverrideFn = null, pollingEnabled = false, pollIntervalMs = 2600,
  // H-1: 기본값(null/true)은 기존 동작과 동일 — §createDevice/§createDb 주석 참고.
  dbErrorInjectionFn = null, idempotencyCacheEnabled = true }) {
  const rng = mulberry32(seed);
  const roomStore = createRoomStore(`ROOM-${seed}-${participantCount}`);
  const devices = [];
  for (let i = 0; i < participantCount; i++) {
    const id = `p${i}`;
    const isHost = i === 0;
    const device = createDevice({
      id, isHost, roomStore, rng, participantCount, resolveElimination, judgePure,
      computePlayerStatuses, PLAYER_STATUS, maxLoserCountFor, targetLoserCount, combinedSourceOverride,
      realtimeDelayRegime, deliveryOrderMode, index: i, skewMsOverrideFn, clockRttOverrideFn,
      dbErrorInjectionFn, idempotencyCacheEnabled,
    });
    devices.push(device);
  }
  for (const d of devices) {
    roomStore.participants.set(d.id, {
      id: d.id, room_id: roomStore.id, choice: null, is_ready: false,
      wins: 0, losses: 0, draws: 0, penalties: 0, is_host: d.isHost, created_at: d.id, name: d.id,
    });
    roomStore.order.push(d.id);
  }
  for (const d of devices) d.impl.state.participants = roomStore.order.map((id) => ({ ...roomStore.participants.get(id) }));

  // 접합부 ⓪-pre(STOP-SHIP, PHANTOM_OR_CORRUPTED_OUTCOME 원인 수정): REAL savePenalty() 상당 단계.
  // REAL 앱에서는 host가 로비에서 savePenalty()를 커밋해야만(index.html ~7280-7310,
  // db.from('rooms').update({ penalty: buildPenaltyValue({loserCount,...}), status: nextStatus }))
  // screenHostRoom의 startGameBtn이 활성화된다(showHostRoom의 state.status==='ready' 분기) — 즉
  // REAL startGame()이 호출되는 시점에는 room.penalty가 이미 항상 유효한(올바른 loserCount를
  // 인코딩한) JSON이고, 절대 ''(빈 문자열)일 수 없다. 이 하니스는 로비/방입장 시퀀스 자체를
  // 모델링하지 않으므로(위 참가자 시딩도 동일하게 handleRoomUpdate를 거치지 않고 직접 대입한다),
  // savePenalty의 "실제 효과"만 동일하게 재현한다: REAL buildPenaltyValue(REAL 추출)로
  // targetLoserCount를 인코딩한 값을 room row에 커밋한다.
  //   수정 전 결함: createRoomStore의 기본 row.penalty(='')가 게임 시작 전까지 그대로 남아있었고,
  //   REAL getTargetLoserCount() = parsePenalty(state.penalty).loserCount || state.targetLoserCount || 1
  //   는 parsePenalty('')의 JSON.parse 실패 폴백이 loserCount:1을 반환하므로(파싱 실패 시 fallback,
  //   위 parsePenalty 참고) `1 || state.targetLoserCount || 1`가 `||` 단락평가로 항상 1로
  //   클로버되어(주입한 targetLoserCount가 2 이상이어도 무시) 활성 참가자 수와 무관하게 loserCount=1
  //   기준으로 조기 gameOver 판정이 나 오라클(§EG runEliminationTrial)과 불일치하는
  //   PHANTOM_OR_CORRUPTED_OUTCOME을 만들었다 — REAL 앱은 room.penalty가 이 시점에 이미 올바르므로
  //   무해했다(하니스 전용 아티팩트). host 디바이스(devices[0])의 REAL buildPenaltyValue를 그대로
  //   호출할 뿐 손으로 인코딩을 재작성하지 않는다.
  const initialPenalty = devices[0].impl.buildPenaltyValue({ text: '', loserCount: targetLoserCount, gameRound: 1 });
  roomStore.row.penalty = initialPenalty;

  // 접합부 ⓪(중요, 앞서 실측 버그로 발견): 실제 앱은 방 입장 직후 syncServerClock()을 1회 호출해
  // serverClockOffsetMs를 채운다(subscribeToRoom 계열 초기화 — DOM/채널 강결합이라 이 함수 자체는
  // 추출하지 않았다). 이 호출을 생략하면 serverNow()가 매 기기의 원시 skew를 전혀 보정하지 못해
  // (serverClockOffsetMs가 기본값 0으로 고착) 모든 phase의 기기간 격차가 "실제 스케줄링 오차"가
  // 아니라 "그냥 보정 안 된 시계 오차"로 오염된다 — RC-3 하니스 개발 중 choiceEnd tolerance가
  // 항상 정확히 한 skew값만큼 실패하는 것으로 이 누락을 실측 발견했다(§5 충실성 증명 참고).
  // vitest 가짜 타이머 교착을 피하기 위해 fire-and-forget으로 시작하고, 드라이버가 전원 동기화
  // 완료를 확인한 뒤에만 라운드1을 시작한다(아래 runMeasuredTrial의 사전 대기 단계).
  const clockSyncPromises = devices.map((d) => d.impl.syncServerClock().catch((e) => {
    d.telemetry.emit('metric', { wrps: 'RC3-HARNESS', eventType: 'CLOCK_SYNC_THREW', message: String(e && e.message || e) });
  }));

  const submittedChoiceRound = new Map(); // deviceId -> round already submitted
  const readyTriggeredForRound = new Set();
  // EG 확장: round -> Map<deviceId, base>. 실제로 "제출된" 선택의 그라운드 트루스 원장(테스트
  // 전용 부기, 판정에 관여하지 않음) — runEliminationTrial의 오라클 재계산이 사용한다.
  const roundChoicesByRound = new Map();

  for (const d of devices) {
    roomStore.subscribers.push({
      deviceId: d.id,
      onRoomRow: async (row) => {
        // RC-3 Phase4(반공허성 B): 이 row가 "객관적으로 stale"인지(REAL getPenaltyGameRound로
        // 추출한 row 자신의 gameRound < 지금까지 이 기기가 본 최댓값) 처리 전에 관측해 두고, 처리
        // 후 round/countdownStartAt/gameRound가 실제로 바뀌었는지 비교한다(아래
        // beginStaleRowRegressionCheck/finishStaleRowRegressionCheck). isStaleRoomRow 가드가
        // 정상이라면 이 호출은 절대 STALE_ROW_REGRESSION을 만들지 않는다 — 정상 스윕(§3/§4)에서는
        // 사실상 0건이어야 하고, 전용 stale-row 역주입 시나리오(runStaleRowGuardScenario)에서
        // 가드를 mutation으로 무력화했을 때만 실제로 관측되어야 한다.
        const staleCheckCtx = beginStaleRowRegressionCheck(d, row);
        // WRPS-079 Round2(STOP-SHIP, HIGH 잔존 수정): ready 분기 commit 게이트 검증용 커서(위
        // beginReadyBranchClobberCheck/finishReadyBranchClobberCheck 참고) — 이 호출 동안 REAL
        // ready 분기가 실제로 낡은(superseded) 컨텍스트를 커밋했는지 게이트 로직 자체에 기대지
        // 않고 독립적으로 확인한다.
        const readyClobberCheckCtx = beginReadyBranchClobberCheck(d);
        try {
          await d.impl.handleRoomUpdate(row);
        } catch (e) {
          d.telemetry.emit('metric', { wrps: 'RC3-HARNESS', eventType: 'HANDLE_ROOM_UPDATE_THREW', message: String(e && e.message || e) });
          return;
        }
        finishStaleRowRegressionCheck(d, staleCheckCtx);
        finishReadyBranchClobberCheck(d, readyClobberCheckCtx);
        // 접합부 ②: 이번 라운드 참가자면 자기 선택을 즉시 제출한다(실제 UI 클릭 생략).
        // choiceDriverFn이 없으면(§allDraw baseline, 기존 회귀 스윕 전부) 기존 그대로 전원
        // 'scissors' 고정 — 하위호환, 회귀 없음. choiceDriverFn이 있으면(EG 확장, 아래 참고) 그
        // 드라이버가 라운드/기기별로 rock/paper/scissors를 고른다 — REAL isCurrentRoundParticipant()
        // (REAL 추출)가 "이번 라운드에 실제로 참여하는가"를 가리므로, 이미 확정된(safe/loser)
        // 기기는 이 분기 자체에 들어오지 않는다(선택 제출 없음 — 실제 UI와 동일).
        if (d.impl.state.status === 'playing' && d.impl.isCurrentRoundParticipant()) {
          const round = d.impl.state.round;
          if (submittedChoiceRound.get(d.id) !== round) {
            submittedChoiceRound.set(d.id, round);
            const choiceBase = choiceDriverFn ? choiceDriverFn({ device: d, round }) : 'scissors';
            // EG 오라클 원장(§runEliminationTrial): "이 라운드에 실제로 무엇을 냈는가"의 그라운드
            // 트루스를 REAL 파이프라인과 완전히 독립적으로 별도 보관한다(테스트 전용 부기 —
            // 판정에는 전혀 관여하지 않음).
            if (!roundChoicesByRound.has(round)) roundChoicesByRound.set(round, new Map());
            roundChoicesByRound.get(round).set(d.id, choiceBase);
            try { await d.impl.updateParticipantChoice(choiceBase); } catch (e) {}
          }
        }
        // 접합부 ③ 제거됨(STOP-SHIP happens-before 수정, critic A/B 검증): 이 위치(handleRoomUpdate
        // 리턴 "직후")에서 status==='result'를 보고 scheduleRematchAutoAdvance()를 발화하던 예전
        // 트리거는 REAL의 happens-before를 위반했다 — REAL handleRoomUpdate(index.html:6001)는
        // finishRoundLocal()을 await 없이 fire-and-forget 호출하므로, 이 지점에서 handleRoomUpdate가
        // 이미 리턴했다는 것이 finishRoundLocal의 async 본문(waitForPhaseRender/
        // fetchFreshParticipantsForResult, 버퍼 비례 지연)이 confirmedSafeIds/LoserIds를 확정했다는
        // 것을 전혀 보장하지 않는다. 그 결과 고정 1500ms 예약 vs 실제 버퍼 지연 경합에서 nextRound가
        // 아직 빈 confirmedLoserIds를 읽어 loser 마커를 유실하는 PHANTOM_OR_CORRUPTED_OUTCOME을
        // 하니스가 스스로 만들어냈다(REAL 앱 결함이 아니라 하니스 측정도구 결함, §A/B 재현 확인).
        // ⚠️ H-1 정정(이전 서술 "REAL 호출부는 3곳뿐"은 사실이 아니었다): REAL
        // scheduleRematchAutoAdvance() 호출부는 정확히 5곳이다 —
        //   #1 index.html:8636 finishRoundLocal allDraw 분기
        //   #2 index.html:8670 finishRoundLocal tooMany 분기(confirmedSafeIds 대입 :8664 직후)
        //   #3 index.html:8682 finishRoundLocal tooFew 분기(confirmedLoserIds 대입 :8672 직후)
        //   #4 index.html:9733 scheduleRematchAdvanceRetryAfterFailure(안전망 A) ← nextRound() catch(:9825)
        //   #5 index.html:9759 maybeRecoverStalledRematchAdvance(안전망 B) ← finishRoundLocal:8212
        //      (idempotent 조기반환 :8188 안, 비-gameOver일 때만)
        // 이 접합부에서 재현해야 하는 것은 그 중 #1~#3(본문 내부, 정상 예약)이고, 그 정확한 지점을
        // 재현하려면 하니스도 resolveElimination이 반환하는 바로 그 순간(=REAL이 이번 라운드
        // 확정 집합을 최종 결정하는 지점과 동일한 동기 시점)에 예약해야 한다. 그래서 그 예약은
        // makeFinishRoundLocalSubstitute의 onOutcome 콜백(위 §onOutcome 주석, resolveElimination
        // 반환 직후·gameOver 제외)에서 수행한다. #4/#5는 이 접합부가 아니라 각각 §createDb의
        // dbErrorInjectionFn(기본 off)과 §makeFinishRoundLocalSubstitute의 idempotency 조기반환이
        // 도달 가능하게 만든다(둘 다 REAL 함수를 호출만 하고 재구현하지 않는다).
      },
    });
  }

  // §STOP-SHIP Phase0: 2.6초 REST 폴링 채널은 위 subscriber 등록이 끝난 "직후" 시작한다 — 각
  // device의 poll tick이 이제 막 등록된 그 device 자신의 onRoomRow 래퍼(바로 위 §충실성 보정)를
  // 그대로 재사용하므로, stale-row-regression/ready-branch-clobber 검출 + 접합부 ②/③ 글루가
  // realtime 배달과 poll 배달 양쪽에 동일하게 적용된다(poll이 realtime과 다른 코드 경로를 타지
  // 않는다). pollingEnabled=false(기본값)이면 startDevicePolling 내부에서 타이머가 아예 생성되지
  // 않는다(회귀 없음).
  for (let i = 0; i < devices.length; i++) {
    const d = devices[i];
    const sub = roomStore.subscribers[i];
    const polling = startDevicePolling({
      pollingEnabled, pollIntervalMs, db: d.env.db, roomStore, implRef: () => d.impl,
      telemetry: d.telemetry, onRoomRow: sub.onRoomRow,
    });
    polling.start();
    d.stopPolling = polling.stop;
  }

  return { devices, roomStore, rng, submittedChoiceRound, readyTriggeredForRound, clockSyncPromises, roundChoicesByRound };
}

// ════════════════════════════════════════════════════════════════════════════
// EG(Elimination-extended) — STOP-SHIP 술래-소거 경로 확장.
//
// 위 allDraw baseline(runMeasuredTrial)은 전원이 항상 'scissors'만 내므로 resolveElimination의
// allDraw 분기만 exercise한다(§이미 100% 클린 확인). 이 구간은 그 확장이다: 참가자별로 seeded
// rock/paper/scissors를 섞어(pickMixedChoiceBase) 실제 승/패를 발생시키고, tooMany/tooFew/
// gameOver까지 다라운드에 걸쳐 실제로 트리거되게 한다. REAL 추출 파이프라인 자체(handleRoomUpdate/
// finishRoundLocal 대체/resolveElimination/nextRound/scheduleRematchAutoAdvance/startGame)는 위
// allDraw 경로와 완전히 동일한 코드를 그대로 재사용한다(중복 구현 없음 — choiceDriverFn 주입과
// 종료 조건("5라운드 완주" 대신 "gameOver 도달")만 다르다).
// ════════════════════════════════════════════════════════════════════════════

// 결정론적 rock/paper/scissors 균등 선택 — 앱 내부 randomRoundChoice()와 동일한 배열 순서를
// 재사용해(["scissors","rock","paper"]) 우연히 이 하니스가 발명한 새 인코딩이 아님을 명시한다.
// 판정 자체(judgePure)는 어떤 순서로 인코딩되든 base 문자열만 보므로 순서 자체는 무관하다.
export function pickMixedChoiceBase(rng) {
  const bases = ['scissors', 'rock', 'paper'];
  return bases[Math.floor(rng() * 3)];
}

// choiceDriverFn 팩토리 — 트라이얼 시드와 완전히 독립된 자체 rng 스트림을 쓴다(네트워크 지연
// 샘플링에 쓰이는 world.rng와 절대 공유하지 않는다 — 공유하면 선택 제출 타이밍이 기기 간 배달
// 순서에 따라 rng 소비 순서를 바꿔 네트워크 지연 샘플링까지 흔들리는 교차오염이 생긴다).
export function createMixedChoiceDriver(seed) {
  const choiceRng = mulberry32(seed);
  return () => pickMixedChoiceBase(choiceRng);
}

// ── STOP-SHIP Part D: "결정적" choice 모델(균등 3종 랜덤 대신) ────────────────
// pickMixedChoiceBase(균등 3종 랜덤)는 judgePure의 "selectedTypes.length===3이면 draw" 규칙
// 때문에 N이 클수록 3종류가 다 나올 확률이 급격히 올라가 allDraw로 수렴한다(§EG Phase1/2
// COVERAGE 실측으로 이미 확인) — 그 결과 큰 N에서는 결정적 라운드 자체가 희소해져 유한 라운드
// 예산 안에서 gameOver에 못 닿는 STALL이 "진짜 멈춤"이 아니라 "그냥 안 끝남"이라는 측정 아티팩트로
// 섞여든다(§EG Phase3 SWEEP 로그의 N=20 STALL 샘플들이 실제로 이 현상이다 — 실패 유형이 전부
// status:'playing'/'ready'에서 멈춰 있고 EXCEPTION/오판정류는 없다). 이 아티팩트를 없애려면 매
// 라운드가 "실제로 결판나게" 만들어야 한다.
// 설계: 두 종류(rock/scissors)만 사용하고 세 번째(paper)는 아예 후보에서 뺀다 — judgePure는
// selectedTypes.length가 정확히 2일 때만 승/패를 내므로, 이 두 종류만 쓰면 "3종류가 다 나와
// draw"라는 경로 자체가 구조적으로 불가능해진다(paper가 후보에 없으므로). 남은 유일한 draw
// 경로는 "활성자 전원이 우연히 같은 종류를 냄"뿐인데, 이 확률은 독립 베르누이(p=0.5)로 각
// 라운드 active count가 m명일 때 2×0.5^m이라 m이 클수록 오히려 exponentially 작아진다(균등
// 3종 모델과 정반대 방향 — N이 클수록 이 모델은 더 빨리 결판난다). 이건 하니스가 새로 발명한
// 편향이 아니라 "실제 왜 draw가 나는지"(judgePure의 selectedTypes.length 규칙, REAL 소스)를
// 근거로 고른 최소 개입이다 — 어느 두 종류를 골라도(rock/scissors, scissors/paper, paper/rock)
// getWinningChoice가 대칭적으로 처리하므로 결과 분포에 실질적 차이는 없다(§7에 명시).
export function pickDecisiveChoiceBase(rng) {
  const bases = ['rock', 'scissors'];
  return bases[Math.floor(rng() * 2)];
}

export function createDecisiveChoiceDriver(seed) {
  const choiceRng = mulberry32(seed);
  return () => pickDecisiveChoiceBase(choiceRng);
}

// 이 세계가 "게임오버로 완전히 정착"했는가 — REAL room.status broadcast가 전원에게 도달해
// 전 기기의 state.status가 'game_over'가 됐는지로만 판단한다(호스트가 유일한 rooms.update
// writer이므로, 이 값이 전원에게 퍼졌다는 것 자체가 REAL handleRoomUpdate가 정상 처리됐다는 뜻).
export function isGameOverSettled(world) {
  return world.devices.every((d) => d.impl.state.status === 'game_over');
}

export function allDevicesRenderedReadyFor(world, round) {
  return world.devices.every((d) => d.rendered.readyByRound[round] && d.rendered.readyByRound[round].rendered);
}

// ── 텔레메트리 기반 phase 타임스탬프 추출(측정의 단일 진실 소스) ───────────────
// ⚠️ d.rendered.resultByRound(우리 finishRoundLocal 대체의 onOutcome 콜백)는 "호출되는 순간의
// state.round"를 키로 쓰는데, 연속된 두 room-row 이벤트가 한 device에서 겹쳐 처리되면(동시
// handleRoomUpdate 인터리빙 — RC-3 하니스로 실측 발견, report 4절 실패모드 참고) 그 라운드 번호가
// 이미 다음 라운드로 넘어가 있는 채로 기록될 수 있다(= 관측 훅 자체의 오귀속, 판정 로직 오류
// 아님). 그래서 "이 phase를 렌더했는가"의 권위 있는 판단은 REAL waitForPhaseRender/runCountdown이
// 직접 emit한 QA 텔레메트리(SYNC_RENDER, 이벤트 발생 시점에 이미 올바른 round로 기록됨 — append만
// 되고 나중에 덮어써지지 않음)로 한다.
export function getPhaseSyncRenderEvent(device, phase, round) {
  return device.telemetry.events.find((e) => e.kind === 'metric' && e.eventType === 'SYNC_RENDER' && e.phase === phase && e.round === round);
}

// SYNC_RENDER의 clientRenderedTs는 추출 코드 내부의 Date.now()(기기별 skew가 더해진 로컬시각)이므로,
// 기기 간 비교를 위해 skewMs를 빼 "참(true) 시각"으로 환산한다.
export function getPhaseTrueTs(device, phase, round) {
  const ev = getPhaseSyncRenderEvent(device, phase, round);
  if (!ev || ev.clientRenderedTs == null) return null;
  return ev.clientRenderedTs - device.skewMs;
}

// ── RC-3 Phase2(codex-critic C 지표 정교화) ──────────────────────────────────
// REAL waitForPhaseRender(index.html ~5259-5291)는 이미 "이 기기가 앵커(scheduledAt) 대비 얼마나
// 늦게 렌더했는가"를 lateRenderMs로 직접 계산해 SYNC_RENDER 메트릭에 싣고, lateRenderMs>1000이면
// 별도로 SYNC_LATE_RENDER를 emit한다(위 5286 "if (lateRenderMs > 1000)"). 이건 하니스가 새로
// 만든 프록시가 아니라 앱 자신의 "이 정도면 늦게 도착한 것"이라는 판단 기준이므로, 하니스도 같은
// 임계값을 그대로 재사용한다(하니스가 별도 숫자를 발명하지 않음) — on-time/late-render 분류의
// 단일 진실 소스.
export const LATE_RENDER_THRESHOLD_MS = 1000;

// choiceStart/choiceEnd는 REAL SYNC_RENDER 텔레메트리가 없다(위 주석, index.html에 전용 계측이
// 없음). 그러나 설계상 choiceStart = countdownStart + 로케일 고정 애니메이션 상수이고(§5
// 충실성 테스트가 이미 증명), choiceEnd는 choiceStart 앵커에서 5초 후이므로, 그 라운드의
// countdown SYNC_RENDER의 late 여부를 그대로 물려받는다(둘 다 같은 원인 지연을 상속) — 이건
// 근사(§7 "확신 낮은 부분"에 기록)이지 REAL 계측이 아니다.
export function getPhaseLateRenderMs(device, phase, round) {
  const lookupPhase = (phase === 'choiceStart' || phase === 'choiceEnd') ? 'countdown' : phase;
  const ev = getPhaseSyncRenderEvent(device, lookupPhase, round);
  if (!ev || ev.lateRenderMs == null) return null;
  return ev.lateRenderMs;
}

export function isPhaseOnTime(device, phase, round) {
  const lateMs = getPhaseLateRenderMs(device, phase, round);
  if (lateMs == null) return null; // 렌더 자체가 없음(별도 MISSING_*_RENDER 하드실패로 잡힘) — on-time 여부 미정
  return lateMs <= LATE_RENDER_THRESHOLD_MS;
}

// ════════════════════════════════════════════════════════════════════════════
// RC-3 taxonomy 수렴(Review Correction Loop 3/3, 최종): on-time 코호트 재정의 + 3범주 분리.
//
// 이 하니스는 지금까지 같은 지표를 두고 두 번 반대 방향으로 실패했다:
//   v2(과공허): TOLERANCE_EXCEEDED/ON_TIME_CONCURRENCY_EXCEEDED를 처음부터 non-HARD로 두거나,
//     on-time 코호트를 "렌더 지각도"로 정의해 스프레드 게이트가 mutation에도 반응하지 못했다
//     (아래 "문제의 뿌리" 참고 — 구조적으로 tolerance를 못 넘는 이중 필터).
//   v3(과민): 그 구멍을 메운다며 ON_TIME_CONCURRENCY_EXCEEDED/ON_TIME_RECEIPT_COLLAPSED/
//     LATE_COHORT_EXCESSIVE_DELAY를 전부 HARD_FAILURE_TYPES(=STOP-SHIP topline)에 승격했는데,
//     codex-critic이 baseline ~4860 trial을 실집행해 모든 hard failure가 이 두 timing 게이트뿐이고
//     (ON_TIME_RECEIPT_COLLAPSED/LATE_COHORT_EXCESSIVE_DELAY), 실제 결함 채널(STALL/EXCEPTION/
//     오판정/desync/렌더누락/이중카운트다운/stale-row)은 0건, 전부 completed:true임을 확인했다 —
//     즉 이 지표들은 "네트워크 지터 아티팩트"에 반응한 것이지 실결함이 아니었다(과민, 늑대외침).
//
// 근본 원인: 네트워크 지연만으로는 "스케줄링 코드 버그"와 "네트워크가 그냥 느림"을 렌더 타이밍
// **하나만**으로 구분할 수 없다(둘 다 "앵커에 못 모임"으로 관측된다). 그래서 이 세 지표(스프레드/
// 수신율/과지각)를 절대 pass/fail 게이트로 쓰면 baseline에서도 지터가 몰리는 trial마다 늑대를
// 외친다. 지연 독립적(delay-independent) 신호만 STOP-SHIP 게이트가 될 수 있다.
//
// 최종 수렴 taxonomy(3범주, 이 라운드부터 고정):
//   [범주1] CORRECTNESS HARD FAILURE(지연 독립, 유일한 STOP-SHIP 게이트) — 아래
//     HARD_FAILURE_TYPES 배열 그대로: STALL/EXCEPTION/CLOCK_SYNC_NOT_SETTLED/
//     PHANTOM_OR_CORRUPTED_OUTCOME/ROUND_NOT_MONOTONIC/MISSING_*_RENDER/
//     DOUBLE_COUNTDOWN_RENDER/STALE_ROW_REGRESSION. `pass`(=completed && hardFailureModes.length
//     ===0)가 곧 이 범주의 trial 단위 합격 여부이고, 이 비율이 "correctnessPassRate"다.
//   [범주2] NETWORK-STRESS QUALITY(지연 종속, informational, 합격 게이트 아님) —
//     ON_TIME_RECEIPT_COLLAPSED/LATE_COHORT_EXCESSIVE_DELAY/FULL_COHORT_TIMING_SPREAD/
//     lateRenderRatio(그리고 구조적으로 트립 불가한 ON_TIME_CONCURRENCY_EXCEEDED, 아래 별도
//     문서화). 여전히 failureModes 배열에는 기록되지만(관측/리포트 목적) HARD_FAILURE_TYPES에서
//     빠졌으므로 hardFailureModes/pass에는 전혀 반영되지 않는다 — "결함"이나 "진짜 성공률"이
//     아니라 레짐(optimistic/moderate/pessimistic)에 따라 정상적으로 달라지는 네트워크 스트레스
//     하의 렌더 동시성 품질로만 읽는다.
//   [범주3] 차등 mutation 회귀 테스트(반공허성 보존) — 범주2를 게이트에서 빼면 v2처럼 다시
//     공허해질 위험이 있으므로, 아래 §5 mutation 테스트는 "고정 optimistic 레짐 하에서 mutation
//     이 baseline 대비 이 범주2 지표를 상대적으로(절대 임계 아님) 악화시키는가"를 별도로 단언한다
//     — 이게 "하니스가 스케줄링 회귀를 여전히 검출할 수 있다"는 증거이고, 동시에 같은 trial들의
//     correctnessPassRate가 baseline과 거의 같게 유지되는지도 같이 확인해 "타이밍 회귀가 correctness
//     게이트를 오염시키지 않는다"(과민 재발 금지)까지 한 번에 증명한다.
//
// 재정의(on-time 코호트, 범주2 계산에 여전히 쓰임): membership을 "렌더가 얼마나 늦었는가"가 아니라
// "이 기기가 앵커(phaseScheduledAt) 이전에 그 정보를 수신했는가"로만 정한다. 이러면 membership
// 자체는 렌더 스프레드에 대해 아무 정보도 주지 않는다(수신은 제때 했어도 스케줄링 로직이 고장나면
// 렌더는 얼마든지 벌어질 수 있다) — 그래서 mutation이 스케줄링 로직 자체를 깨면(예: choiceEndAt
// 앵커 제거, lead 축소) 이 코호트의 렌더 스프레드가 실제로 커질 수 있다(§범주3 mutation 테스트로
// 실집행 검증, 이제 optimistic 레짐 고정 + baseline 대비 상대 델타로 재확인한다).
//
// 수신 시각 산출:
//   - countdown: REAL COUNTDOWN_START 메트릭(WRPS-036)의 countdownClientStartTs(=이 코드가
//     waitMs를 계산하던 바로 그 순간의 serverNow())를 "수신 시각"으로 쓴다. waitMs = max(0,
//     scheduledStartAt - countdownClientStartTs)이므로 waitMs>0 ⟺ 수신이 앵커 이전이다 — 그래서
//     그냥 ev.waitMs > 0을 멤버십 조건으로 쓴다(REAL 필드 재해석일 뿐, 새 계산 발명 아님).
//   - result/nextRound(ready): REAL SYNC_RENDER 메트릭의 clientReceivedTs(핸들러가 이 phase 분기
//     진입 직후 찍는 Date.now(), index.html 5716/5840)에 같은 이벤트의 clockOffsetMs를 더해
//     "이 기기 기준 서버시각으로 환산한 수신시각"을 만들고, serverScheduledTs와 비교한다.
//   - choiceStart/choiceEnd: REAL 계측이 없어(위 getPhaseLateRenderMs와 동일한 사정) countdown의
//     판정을 상속한다(근사, §7에 한계 명시 — index.html 무수정 원칙상 개선 불가).
export function getCountdownStartEvent(device, round) {
  return device.telemetry.events.find((e) => e.kind === 'metric' && e.eventType === 'COUNTDOWN_START' && e.round === round);
}

export function isPhaseReceivedBeforeAnchor(device, phase, round) {
  const lookupPhase = (phase === 'choiceStart' || phase === 'choiceEnd') ? 'countdown' : phase;
  if (lookupPhase === 'countdown') {
    const ev = getCountdownStartEvent(device, round);
    if (!ev || ev.countdownStartServerTs == null) return null; // 앵커 자체가 없음(구버전 호환 경로) — 판정 불가
    return ev.waitMs > 0;
  }
  const ev = getPhaseSyncRenderEvent(device, lookupPhase, round); // 'result' | 'nextRound'
  if (!ev || ev.clientReceivedTs == null || ev.serverScheduledTs == null) return null;
  const receivedServerTs = ev.clientReceivedTs + (ev.clockOffsetMs || 0);
  return receivedServerTs <= ev.serverScheduledTs;
}

// 이 phase의 "앵커"(서버시각 도메인) 값 — 위 isPhaseReceivedBeforeAnchor와 동일한 이벤트에서 뽑는다.
// 과지각(late-cohort excessive delay) 계산에 재사용(아래 getLateCohortExcessiveDelayThresholdMs).
export function getPhaseAnchorServerTs(device, phase, round) {
  const lookupPhase = (phase === 'choiceStart' || phase === 'choiceEnd') ? 'countdown' : phase;
  if (lookupPhase === 'countdown') {
    const ev = getCountdownStartEvent(device, round);
    return ev ? ev.countdownStartServerTs : null;
  }
  const ev = getPhaseSyncRenderEvent(device, lookupPhase, round);
  return ev ? ev.serverScheduledTs : null;
}

// ── [범주2] network-stress quality 상수/헬퍼 (informational, 합격 게이트 아님) ──
// 아래 세 값(ON_TIME_CONCURRENCY_CEILING_MS/MIN_ON_TIME_RECEIPT_RATIO/
// getLateCohortExcessiveDelayThresholdMs)은 더 이상 "STOP-SHIP hard failure 임계값"이 아니다 —
// v3에서는 이 값을 넘으면 HARD_FAILURE_TYPES에 들어가 pass를 깎았지만, baseline ~4860 trial
// 실집행 결과 이 세 채널만 트립되고 실제 결함 채널은 0건이었다(과민 확정, §본문 참고). 이번
// 수렴부터는 이 값들이 오직 "네트워크-스트레스 렌더 동시성 품질을 얼마나 엄격하게 볼 것인가"라는
// 리포팅 임계값일 뿐이며, HARD_FAILURE_TYPES에는 들어가지 않는다(아래 참고) — 근거 서술 자체는
// 여전히 유효하므로 그대로 보존한다(레짐별 informational 표에서 이 임계값 기준으로 위반 유무를
// 표시하는 용도로만 쓰인다).
//
// ON_TIME_CONCURRENCY_CEILING_MS 근거: RC-3 §5 충실성 테스트(위 "syncServerClock()으로 얻은
// offsetMs가...")가 실집행으로 보장하는 값은 "|deviceServerNow - trueNow| < 1500ms"(RC-1
// clock-sync 잔차 상한, 시도별 실측 상한이 아니라 테스트가 강제하는 보수적 worst-case 경계). 두
// 기기가 각각 이 잔차의 반대 극단(+1500/-1500)에 있으면, 같은 "진짜" 순간을 각자의 serverNow()로
// 완벽히 동시에 관측했다고 믿어도 실제 관측(true wall-clock) 시각 차이는 최대 2×1500=3000ms까지
// 날 수 있다 — 이게 "코드가 완벽해도 clock-sync 잔차만으로 생기는" 구조적 하한이다. 그 외
// 스케줄링 잡음(sleep(waitMs) 이후 즉시 동기 실행, setTimeout 큐잉 지터)은 이 하니스에서 스텝
// 단위가 아니라 실제 타이머 콜백이라 수 ms~수십 ms 수준으로, 1500ms 스케일 대비 무시 가능하다고
// 보고 별도 slack을 더하지 않는다(제안 범위 2000~3000ms 중 상단값 채택 — 보수적 선택, §7 기록).
export const ON_TIME_CONCURRENCY_CEILING_MS = 3000;

// on-time "수신율" 리포팅 임계값(§범주3 mutation B 실측으로 결정된 값 — 근거는 아래
// runMeasuredTrial의 ON_TIME_RECEIPT_COLLAPSED 주석 참고: baseline 평균 97%, broken(lead=100ms)
// 평균 2% — 0.5는 그 사이 넉넉한 여유를 둔 값, 근거 강도: 중간).
export const MIN_ON_TIME_RECEIPT_RATIO = 0.5;

// late(앵커 이후 수신) 코호트의 "과도한 지각" 리포팅 임계값 — graceful late-render(설계상 정상)와
// "앵커 보정이 사실상 무력화된 것으로 보이는 스프레드"를 가르는 선(정보용 표시일 뿐, STOP-SHIP
// 게이트는 아님). 플랫(phase 무관) 상수 하나로는 choiceEnd처럼 이미 촘촘한 설계 tolerance
// (PHASE_TOLERANCE_MS.choiceEnd=1250ms)를 가진 phase의 진짜 회귀(수 초 단위로만 벌어짐)를
// 놓친다. 그래서 phase마다 "이미 확립된 설계 tolerance"(PHASE_TOLERANCE_MS, §근거는 그 정의부
// 주석 참고)를 그대로 재사용한다 — 새 숫자를 발명하지 않는다는 점에서
// ON_TIME_CONCURRENCY_CEILING_MS(clock-sync 잔차 기반)와는 근거 계통이 다르다(§7에 명시).
export function getLateCohortExcessiveDelayThresholdMs(phase) {
  return PHASE_TOLERANCE_MS[phase];
}

// ── ON_TIME_CONCURRENCY_EXCEEDED — 구조적으로 트립 불가(critic B 지적, 정직하게 문서화) ──
// 이 지표(수신-기준 on-time 코호트 "내부" 렌더 스프레드가 ON_TIME_CONCURRENCY_CEILING_MS를
// 초과)는 §범주2 informational 목록에 들어있지만, 현재 하니스 구조로는 사실상 트립할 수 없다 —
// createDb()의 sampleRealtimeDelayMs(및 clock skew/RTT)가 "같은 트라이얼의 모든 구독자에게
// 동일한 분포"에서 독립 샘플링될 뿐, 특정 기기 하나만 골라 비대칭적으로 스케줄링 결함을 주입할
// 방법이 없다(모든 mutation은 combinedSourceOverride로 "전 기기 동일 소스"를 바꾸는 방식이라,
// on-time으로 분류된 기기들 사이의 상대적 스프레드 자체를 벌리지는 못한다 — mutation A/B가
// 실제로 반응하는 채널은 이 지표가 아니라 ON_TIME_RECEIPT_COLLAPSED/LATE_COHORT_EXCESSIVE_DELAY다,
// §범주3 실집행 결과 참고). 죽은 코드가 아니라 "이 하니스 구조에서 검출 불가능한 결함 클래스가
// 있다"는 한계를 계측 자체는 계속 남겨 관측만 하도록 남겨둔다(정보용, §7에 한계 기록).
// 확장(선택, stretch): 기기별 비대칭 clock skew/스케줄링 지연을 주입할 수 있게 createDevice/
// createDb를 확장하면(예: 특정 deviceId만 스케줄링 오프셋을 추가로 왜곡) 이 채널도 트립 가능해질
// 수 있다 — 이번 라운드 범위 밖이라 구현하지 않고 다음 위임으로 남긴다.
//
// ── HARD FAILURE 분류([범주1] correctness, 지연 독립, 유일한 STOP-SHIP 게이트) ─────────────
// "성공률에서 감점"되는 실결함만 포함한다. 네트워크 지연 강도(레짐)와 무관하게 발생하거나 발생하지
// 않아야 하는 채널만 여기 있다 — 그래서 이 목록의 채널이 0건인 비율(correctnessPassRate)은
// allDraw baseline 전 N × 전 레짐에서 ~100%여야 한다(그렇지 않으면 실결함이거나 분류 오류).
// graceful late-render(설계상 허용된 늦은 렌더)와 네트워크-스트레스 품질 저하는 여기 포함하지
// 않는다 — FULL_COHORT_TIMING_SPREAD/ON_TIME_CONCURRENCY_EXCEEDED/ON_TIME_RECEIPT_COLLAPSED/
// LATE_COHORT_EXCESSIVE_DELAY는 전부 [범주2](informational, 위 참고)로, HARD_FAILURE_TYPES에서
// 빠졌다(v3에서는 뒤 세 개가 HARD였으나, baseline 실집행으로 과민임이 확인돼 이번에 강등한다).
// STALE_ROW_REGRESSION(gameRound 고수위표 역행 — isStaleRoomRow 가드가 뚫렸다는 직접 증거)만은
// 지연과 무관하게 "적용되면 안 되는 stale row가 적용됐는가"라는 순수 correctness 질문이므로
// [범주1]에 남는다.
// ⚠️ 아래 목록에 없는 critic 요청 카테고리(에러화면/hard-block)는 이 하니스가 애초에 그런 화면/
// 상태를 모델링하지 않아(가짜 DOM에 에러화면 자체가 없음, canShowPlayAgainButton류 하드블록
// 로직은 REAL handleRoomUpdate/startGame 안에 있지만 이 시뮬레이션 시나리오(정상 5라운드
// 진행, 중도 이탈 없음)에서는 그 경로를 타지 않는다) 측정 불가 — §7에 명시.
export const HARD_FAILURE_TYPES = [
  'STALL',
  'EXCEPTION',
  'CLOCK_SYNC_NOT_SETTLED',
  'PHANTOM_OR_CORRUPTED_OUTCOME', // 오판정(misjudge) 포함 — 전원 scissors인데 allDraw가 아니면 오판정.
  'ROUND_NOT_MONOTONIC', // desync: 라운드 번호가 되돌아가거나 멈춤 — 복구 불가 분기 신호.
  'MISSING_COUNTDOWN_RENDER', // 해당 라운드에 렌더 자체가 전혀 없음(늦은 게 아니라 없음) — stall과 동종.
  'MISSING_RESULT_RENDER',
  'DOUBLE_COUNTDOWN_RENDER', // 이중 카운트다운: 같은 라운드에 REAL(중복-skip 아닌) SYNC_RENDER countdown이 2회 이상.
  'STALE_ROW_REGRESSION', // gameRound 고수위표 역행 — isStaleRoomRow 가드가 뚫렸다는 직접 증거(지연 무관).
];

// [범주2] network-stress quality(informational) 채널 목록 — HARD_FAILURE_TYPES에는 없지만
// failureModes에는 여전히 기록되는 지연-종속 채널. 레짐별로 별도 집계해 리포트한다(§보고 4절).
// "결함"이나 "진짜 실패율"이 아니라 네트워크 스트레스 강도에 따라 정상적으로 달라지는 렌더 동시성
// 품질 신호다.
export const NETWORK_STRESS_QUALITY_TYPES = [
  'FULL_COHORT_TIMING_SPREAD',
  'ON_TIME_CONCURRENCY_EXCEEDED', // 위 문서화 참고: 이 하니스 구조로는 사실상 트립 불가.
  'ON_TIME_RECEIPT_COLLAPSED',
  'LATE_COHORT_EXCESSIVE_DELAY',
];

export function allDevicesRenderedResultFor(world, round) {
  return world.devices.every((d) => getPhaseSyncRenderEvent(d, 'result', round));
}

export function allDevicesRenderedCountdownFor(world, round) {
  return world.devices.every((d) => getPhaseSyncRenderEvent(d, 'countdown', round));
}

// handleRoomUpdate는 ready 전이 SYNC_RENDER를 phase:'nextRound'로 기록하지만 round는 "새로
// 시작되는 라운드 번호"를 쓴다(readyScheduledAt 시점 기준) — 우리 success 기준의 "라운드 R의
// ready phase"와 동일 의미.
export function allDevicesRenderedReadyViaTelemetryFor(world, round) {
  return world.devices.every((d) => getPhaseSyncRenderEvent(d, 'nextRound', round));
}

// ── RC-3 Phase4(반공허성 B) 전용 시나리오: stale-row 역주입 ──────────────────
// "2.6초 폴링 폴백이 realtime 채널과 순서보장 없이 경쟁하는" 실제 상황을 모사한다: 한 기기가
// 이미 REAL(정상) 브로드캐스트 경로로 gameRound=2 row를 받아 처리한 뒤(state.gameRound===2),
// 방금 전 실제로 존재했던 gameRound=1 room row 스냅샷이 방 스토어의 정상(단조 도착 강제) 구독
// 큐를 우회해 그 기기의 REAL handleRoomUpdate에 직접 재도착한다. 두 단계 모두 손으로 state를
// 대입하지 않는다 — gameRound=1→2 전이 자체도 REAL buildPenaltyValue + REAL db.from('rooms').
// update(...)(host 전용, 정상 구독자 전파 경로)로 만들고, "과거" row 역시 그 세계에서 실제로
// 커밋됐던 진짜 스냅샷이다. 유일한 하니스 개입은 "그 진짜 과거 스냅샷을 정상 큐 대신 직접
// 재전달한다"는 배달 순서 자체뿐(§본문 반공허성 B 계약과 동일 성격의 접합부).
//
// 기대 동작(REAL, 무수정): isStaleRoomRow 가드가 incomingGameRound(1) < state.gameRound(2)를
// 감지해 이 재주입을 skip한다 → victim.state.gameRound/round 모두 그대로 유지되고
// finishStaleRowRegressionCheck()이 STALE_ROW_REGRESSION을 만들지 않는다. mutation(가드 무력화)
// 시: REAL getGameRound()의 Math.max(1, incomingGameRound, state.gameRound) 보호 때문에
// state.gameRound 자체는 여전히 2로 유지되지만(§아래 beginStaleRowRegressionCheck 주석 참고 —
// 이게 바로 "gameRound 감소"만 보면 공허한 이유다), state.round/countdownStartAt은 Math.max
// 보호 없이 그대로 stale row의 값으로 덮어써진다 — 그게 실제 검출 대상이다. victim.state.round가
// staleRow.round로 되돌아가면 finishStaleRowRegressionCheck()이 STALE_ROW_REGRESSION을 기록한다.
//
// §7 한계: gameRound=2로의 전이는 REAL beginNewGameRound()(게임오버+재대결 전체 흐름과 강결합,
// 이번 범위 밖 — "술래-소거 확장은 이번 아님")를 거치지 않고, REAL buildPenaltyValue로 gameRound
// 필드만 직접 올린 penalty를 REAL 방 브로드캐스트 채널로 발행해 만든다. isStaleRoomRow 가드
// 자체(incomingGameRound/state.gameRound 비교, handleRoomUpdate 처리 순서)는 100% REAL·무수정
// 실행이지만, "gameRound가 실제 게임에서 어떻게 2가 되는가"라는 상위 트리거는 하니스가 대신한다.
export async function runStaleRowGuardScenario({
  seed = 424242, resolveElimination, judgePure, computePlayerStatuses, PLAYER_STATUS, maxLoserCountFor,
  combinedSourceOverride = null, vi, settleBudgetMs = 8000, stepMs = 250,
}) {
  const world = createTrialWorld({
    participantCount: 3, seed, targetLoserCount: 1,
    resolveElimination, judgePure, computePlayerStatuses, PLAYER_STATUS, maxLoserCountFor, combinedSourceOverride,
  });
  const host = world.devices[0];
  const victim = world.devices[1];

  // ⚠️ vitest 가짜 타이머 환경에서는 setTimeout 기반 promise(db ack delay, handleRoomUpdate 내부
  // sleep 등)를 직접 await하면 안 된다 — 아무도 vi.advanceTimersByTimeAsync를 호출하지 못해 교착
  // 상태가 된다(§runMeasuredTrial의 tickTrialWorld/clock-sync 대기와 동일한 함정). 그래서 항상
  // "fire(별도 await 없이 시작) → 시간을 흘려보내며 조건을 폴링" 패턴을 쓴다.
  async function advanceUntil(predicate, budgetMs) {
    let elapsed = 0;
    while (elapsed < budgetMs && !predicate()) {
      // eslint-disable-next-line no-await-in-loop
      await vi.advanceTimersByTimeAsync(stepMs);
      elapsed += stepMs;
    }
    return predicate();
  }
  // ⚠️ host.env.db.from('rooms').update(...)이 반환하는 promise는 "host 자신의 ack 지연"만
  // 끝나면 resolve된다 — 다른 기기로의 realtime 브로드캐스트 전파(구독자별 propDelay, 최악
  // 수 초)는 완전히 별도 스케줄이라 이 promise의 settle 여부로 "다른 기기가 받았는지"를 판단할 수
  // 없다(실측으로 발견 — 이 promise가 먼저 resolve돼 predicate이 아직 false인데도 루프가 조기
  // 종료되는 버그가 있었다). 그래서 브로드캐스트 전파를 기다릴 때는 promise settle과 무관하게
  // predicate/budget만으로 판단한다.
  async function fireAndAdvanceUntil(promiseFactory, predicate, budgetMs) {
    const p = promiseFactory();
    p.catch(() => {}); // unhandled rejection 방지(판정에는 영향 없음)
    let elapsed = 0;
    while (elapsed < budgetMs && !predicate()) {
      // eslint-disable-next-line no-await-in-loop
      await vi.advanceTimersByTimeAsync(stepMs);
      elapsed += stepMs;
    }
    return predicate();
  }
  // stale-row 직접 재주입(브로드캐스트 아님, victim의 handleRoomUpdate를 직접 1회 호출)은 다른
  // 기기로 전파될 일이 없으므로 이 호출 자체의 settle을 기다리면 충분하다.
  async function fireDirectCallAndDrain(promiseFactory, budgetMs) {
    let settled = false;
    const p = promiseFactory();
    p.then(() => { settled = true; }, () => { settled = true; });
    let elapsed = 0;
    while (elapsed < budgetMs && !settled) {
      // eslint-disable-next-line no-await-in-loop
      await vi.advanceTimersByTimeAsync(stepMs);
      elapsed += stepMs;
    }
    return settled;
  }

  // 0) 전원 clock-sync settle 대기(다른 드라이버와 동일 패턴, §runMeasuredTrial 참고).
  const clockSyncSettled = await advanceUntil(
    () => world.devices.every((d) => d.impl.getServerClockSynced()), settleBudgetMs
  );

  // 1) REAL 채널로 gameRound=1을 "정식으로" 한 번 발행한다(진짜 gameRound=1 row를 만들기 위함 —
  //    빈 penalty는 getPenaltyGameRound가 0(=알 수 없음, 가드 예외 대상)을 반환해 stale 판정
  //    자체가 성립하지 않는다).
  const penaltyG1 = host.impl.buildPenaltyValue({ gameRound: 1, phaseScheduledAt: 0 });
  const g1Settled = await fireAndAdvanceUntil(
    () => host.env.db.from('rooms').update({ penalty: penaltyG1, round: 3, status: 'playing' }).eq(),
    () => victim.impl.state.gameRound === 1, settleBudgetMs
  );

  // 2) 방금 커밋된(진짜) gameRound=1 row를 스냅샷해 둔다 — 이게 나중에 재주입할 "과거" row다.
  const staleRow = { ...world.roomStore.row };

  // 3) REAL 채널로 gameRound=2로 정상 전이(host가 새 게임을 시작한 상황 모사).
  const penaltyG2 = host.impl.buildPenaltyValue({ gameRound: 2, phaseScheduledAt: 0 });
  const g2Settled = await fireAndAdvanceUntil(
    () => host.env.db.from('rooms').update({ penalty: penaltyG2, round: 1, status: 'lobby' }).eq(),
    () => victim.impl.state.gameRound === 2, settleBudgetMs
  );
  const victimGameRoundAfterBump = victim.impl.state.gameRound;
  const victimRoundAfterBump = victim.impl.state.round;

  // 4) stale-row 역주입: 정상 구독 큐를 우회해 victim의 REAL handleRoomUpdate에 직접 전달.
  // (victim.rendered.maxGameRoundSeen은 위 1)/3) 단계의 정상 배달 경로가 이미 최신값(2)으로
  // 갱신해 뒀다 — 정상 구독 큐도 동일한 begin/finishStaleRowRegressionCheck를 거치기 때문.)
  const injectionCheckCtx = beginStaleRowRegressionCheck(victim, staleRow);
  await fireDirectCallAndDrain(() => victim.impl.handleRoomUpdate(staleRow), settleBudgetMs);
  finishStaleRowRegressionCheck(victim, injectionCheckCtx);

  const regressionEvent = victim.telemetry.events.find((e) => e.eventType === 'STALE_ROW_REGRESSION');

  return {
    clockSyncSettled, g1Settled, g2Settled,
    staleRowGameRound: getPenaltyGameRoundForTest(host, staleRow.penalty),
    victimGameRoundAfterBump, victimRoundAfterBump,
    victimGameRoundAfterInjection: victim.impl.state.gameRound,
    victimRoundAfterInjection: victim.impl.state.round,
    regressionDetected: Boolean(regressionEvent),
    regressionEvent,
    world,
  };
}

// getPenaltyGameRound는 REAL 추출 함수(impl.getPenaltyGameRound)를 그대로 재사용한다 — 리포트용
// 소소한 헬퍼(손으로 판정하지 않음, 그냥 결과 확인용 조회).
function getPenaltyGameRoundForTest(device, penaltyRaw) {
  try { return device.impl.getPenaltyGameRound(penaltyRaw); } catch (e) { return null; }
}

// ════════════════════════════════════════════════════════════════════════════
// STOP-SHIP 재수정(Review Correction Loop) 게이팅 시나리오 2종.
//
// codex-critic 지적: 기존 isGameOverSettled(위)는 "전 기기 status==='game_over'"에서 멈춰,
// endGame()의 game_over→stats 전이(§CRITICAL-1)와 requestReplayFromJoinedRoom()의
// {status:'reinviting', round:1} 전이(§MEDIUM)를 이 하니스가 전혀 관측하지 못했다 — 그래서 이 두
// 실제 프로덕션 전이를 REAL 채널로 재현하는 시나리오를 추가한다.
//
// §설계(§runStaleRowGuardScenario와 동일 성격의 "직접 구성" 기법 재사용): 라운드 진행 로직 자체
// (finishRoundLocal/resolveElimination 등)는 이 두 시나리오의 관심사가 아니므로, "게임이 이미 이
// (gameRound, round, status) 조합에 도달해 있다"는 선행 상태를 REAL buildPenaltyValue + REAL
// db.from('rooms').update(...)(host 전용, 정상 구독자 전파 경로)로 직접 커밋한다. 그 다음 전이만이
// 이 시나리오의 진짜 관심사이고, 그 전이는 REAL endGame()/requestReplayFromJoinedRoom()이 실제로
// 쓰는 것과 정확히 동일한 payload로 커밋한다(손으로 다시 짠 로직 아님 — endGame()은
// updateRoomStatus("stats")만 호출하므로 REAL 추출 함수 impl.updateRoomStatus를 그대로 호출하고,
// reinviting 전이는 index.html 7146의 실제 payload `{status:'reinviting', round:1}`을 그대로
// db.update에 넣는다).
//
// pollingEnabled:true(REAL_POLL_INTERVAL_MS)로 2.6초 REST 폴링 백업도 함께 구동한다 — self-heal이
// 이 폴링 채널로 뚫리는 실제 메커니즘(§CRITICAL-1 보고 근거)까지 재현하기 위함이다.
export async function runGameOverToStatsScenario({
  seed = 5252525, resolveElimination, judgePure, computePlayerStatuses, PLAYER_STATUS, maxLoserCountFor,
  combinedSourceOverride = null, vi, settleBudgetMs = 45000, stepMs = 250, pollIntervalMs = REAL_POLL_INTERVAL_MS,
}) {
  const world = createTrialWorld({
    participantCount: 3, seed, targetLoserCount: 1,
    resolveElimination, judgePure, computePlayerStatuses, PLAYER_STATUS, maxLoserCountFor, combinedSourceOverride,
    pollingEnabled: true, pollIntervalMs,
  });
  const host = world.devices[0];
  const victim = world.devices[1];

  async function advanceUntil(predicate, budgetMs) {
    let elapsed = 0;
    while (elapsed < budgetMs && !predicate()) {
      // eslint-disable-next-line no-await-in-loop
      await vi.advanceTimersByTimeAsync(stepMs);
      elapsed += stepMs;
    }
    return predicate();
  }
  async function fireAndAdvanceUntil(promiseFactory, predicate, budgetMs) {
    const p = promiseFactory();
    p.catch(() => {}); // §runStaleRowGuardScenario와 동일 이유(브로드캐스트 전파는 별도 스케줄).
    return advanceUntil(predicate, budgetMs);
  }

  const clockSyncSettled = await advanceUntil(
    () => world.devices.every((d) => d.impl.getServerClockSynced()), settleBudgetMs
  );

  // 1) 정당한 game_over 도달을 직접 구성(gameRound=1, round=1 그대로 — endGame() 진입 직전 상태).
  const penaltyG1 = host.impl.buildPenaltyValue({ gameRound: 1, phaseScheduledAt: 0 });
  const gameOverSettled = await fireAndAdvanceUntil(
    () => host.env.db.from('rooms').update({ penalty: penaltyG1, round: 1, status: 'game_over' }).eq(),
    () => victim.impl.state.status === 'game_over' && victim.impl.state.gameRound === 1 && victim.impl.state.round === 1,
    settleBudgetMs
  );

  // 관측 커서: 위 1) 단계까지의 telemetry는 이 시나리오의 관심사가 아니다(그 회귀는 이미 §Phase2/
  // 다른 게이팅 테스트가 감시) — 여기 "이후" 이벤트만 stats 전이 판정에 쓴다.
  const cursor = victim.telemetry.events.length;

  // 2) REAL endGame()이 실제로 하는 것과 정확히 동일: round/gameRound/penalty 변경 없이
  //    updateRoomStatus("stats")만 호출한다(REAL 추출 함수, 손으로 payload를 짜지 않음).
  const statsSettled = await fireAndAdvanceUntil(
    () => host.impl.updateRoomStatus('stats'),
    () => victim.impl.state.status === 'stats',
    settleBudgetMs
  );

  const eventsSinceCursor = victim.telemetry.events.slice(cursor);
  const staleSkipEventsForStats = eventsSinceCursor.filter(
    (e) => e.eventType === 'STALE_ROOM_UPDATE_SKIPPED' && e.roomStatus === 'stats'
  );
  const selfHealEvents = eventsSinceCursor.filter((e) => e.eventType === 'STALE_ROOM_UPDATE_SELF_HEAL');

  return {
    clockSyncSettled, gameOverSettled, statsSettled,
    victimStatusAfterStats: victim.impl.state.status,
    staleSkipCountForStats: staleSkipEventsForStats.length,
    selfHealCount: selfHealEvents.length,
    world,
  };
}

// §MEDIUM 재현: requestReplayFromJoinedRoom()의 {status:'reinviting', round:1} 전이 — 직전 게임이
// round>1(단일 gameRound 안에서 여러 라운드 진행)에서 끝난 뒤 재대결 초대가 오는 경우, round-축이
// "round가 감소했다"는 이유만으로(전이의 status가 reset 상태인지 무관하게) 정당한 리셋을 stale로
// 오판하는지를 검증한다.
export async function runReinvitingRoundResetScenario({
  seed = 6363636, resolveElimination, judgePure, computePlayerStatuses, PLAYER_STATUS, maxLoserCountFor,
  combinedSourceOverride = null, vi, settleBudgetMs = 45000, stepMs = 250, pollIntervalMs = REAL_POLL_INTERVAL_MS,
}) {
  const world = createTrialWorld({
    participantCount: 3, seed, targetLoserCount: 1,
    resolveElimination, judgePure, computePlayerStatuses, PLAYER_STATUS, maxLoserCountFor, combinedSourceOverride,
    pollingEnabled: true, pollIntervalMs,
  });
  const host = world.devices[0];
  const victim = world.devices[1];

  async function advanceUntil(predicate, budgetMs) {
    let elapsed = 0;
    while (elapsed < budgetMs && !predicate()) {
      // eslint-disable-next-line no-await-in-loop
      await vi.advanceTimersByTimeAsync(stepMs);
      elapsed += stepMs;
    }
    return predicate();
  }
  async function fireAndAdvanceUntil(promiseFactory, predicate, budgetMs) {
    const p = promiseFactory();
    p.catch(() => {});
    return advanceUntil(predicate, budgetMs);
  }

  const clockSyncSettled = await advanceUntil(
    () => world.devices.every((d) => d.impl.getServerClockSynced()), settleBudgetMs
  );

  // 1) 직전 게임이 round=3까지 진행된 뒤 끝난 상황을 직접 구성(gameRound=1 그대로, round만 3).
  const penaltyG1 = host.impl.buildPenaltyValue({ gameRound: 1, phaseScheduledAt: 0 });
  const round3Settled = await fireAndAdvanceUntil(
    () => host.env.db.from('rooms').update({ penalty: penaltyG1, round: 3, status: 'game_over' }).eq(),
    () => victim.impl.state.status === 'game_over' && victim.impl.state.gameRound === 1 && victim.impl.state.round === 3,
    settleBudgetMs
  );

  const cursor = victim.telemetry.events.length;

  // 2) REAL requestReplayFromJoinedRoom()이 실제로 쓰는 것과 정확히 동일한 payload(index.html
  //    ~7146) — penalty 필드는 손대지 않는다(그대로 유지되어 incomingGameRound===state.gameRound).
  const reinvitingSettled = await fireAndAdvanceUntil(
    () => host.env.db.from('rooms').update({ status: 'reinviting', round: 1 }).eq(),
    () => victim.impl.state.status === 'reinviting',
    settleBudgetMs
  );

  const eventsSinceCursor = victim.telemetry.events.slice(cursor);
  const staleSkipEventsForReinviting = eventsSinceCursor.filter(
    (e) => e.eventType === 'STALE_ROOM_UPDATE_SKIPPED' && e.roomStatus === 'reinviting'
  );
  const selfHealEvents = eventsSinceCursor.filter((e) => e.eventType === 'STALE_ROOM_UPDATE_SELF_HEAL');

  return {
    clockSyncSettled, round3Settled, reinvitingSettled,
    victimStatusAfterReinviting: victim.impl.state.status,
    victimRoundAfterReinviting: victim.impl.state.round,
    staleSkipCountForReinviting: staleSkipEventsForReinviting.length,
    selfHealCount: selfHealEvents.length,
    world,
  };
}

// §STOP-SHIP 3차 재현: inviteForReplay()의 round-불변 `{status:'reinviting'}` 전이(CRITICAL-2) —
// 위 runReinvitingRoundResetScenario는 requestReplayFromJoinedRoom()의 `{status:'reinviting',
// round:1}`(round를 명시적으로 1로 "쓰는" 경로)만 재현한다. 그러나 index.html ~9899의
// inviteForReplay()(같은 방에서 "다시 하기" 버튼 → statsReplayBtn의 주 재대결 경로)는 round 필드를
// 전혀 쓰지 않는다(`db.from('rooms').update({ status: 'reinviting' }).eq(...)`) — 그래서 round
// column은 직전 게임이 끝난 값 그대로 남는다(round-"불변" 리셋, round=1로 "쓰는" 리셋이 아님). 이
// 차이가 중요한 이유: incomingRound === state.round(불변이므로 round-축은 애초에 적용 안 됨)가 되고,
// 그 결과 CRITICAL-2는 순수하게 phase-축(isStaleStatusWithinRound)만의 문제였다 — 재수정 2차(차단
// 목록) 코드는 round-축에서만 'reinviting'을 예외 처리했을 뿐 phase-축에는 그 예외가 전혀 없어서
// (phase-축은 `|| 0` 기본값만 썼다), reinviting=0 < stats(4)/game_over(3)로 오판해 그대로 막았다.
// fromStatus 파라미터로 game_over 뒤(round 필드 없이 재초대) / stats 뒤(round 필드 없이 재초대) 두
// 경로를 모두 재현한다(보고서 "critic 확정 잔존 결함" CRITICAL-2 원문의 "stats(4)/game_over(3) 뒤
// same-round로 옴" 그대로).
export async function runInviteForReplayReinvitingScenario({
  seed = 7474747, resolveElimination, judgePure, computePlayerStatuses, PLAYER_STATUS, maxLoserCountFor,
  combinedSourceOverride = null, vi, settleBudgetMs = 45000, stepMs = 250, pollIntervalMs = REAL_POLL_INTERVAL_MS,
  fromStatus = 'stats',
}) {
  const world = createTrialWorld({
    participantCount: 3, seed, targetLoserCount: 1,
    resolveElimination, judgePure, computePlayerStatuses, PLAYER_STATUS, maxLoserCountFor, combinedSourceOverride,
    pollingEnabled: true, pollIntervalMs,
  });
  const host = world.devices[0];
  const victim = world.devices[1];

  async function advanceUntil(predicate, budgetMs) {
    let elapsed = 0;
    while (elapsed < budgetMs && !predicate()) {
      // eslint-disable-next-line no-await-in-loop
      await vi.advanceTimersByTimeAsync(stepMs);
      elapsed += stepMs;
    }
    return predicate();
  }
  async function fireAndAdvanceUntil(promiseFactory, predicate, budgetMs) {
    const p = promiseFactory();
    p.catch(() => {});
    return advanceUntil(predicate, budgetMs);
  }

  const clockSyncSettled = await advanceUntil(
    () => world.devices.every((d) => d.impl.getServerClockSynced()), settleBudgetMs
  );

  // 1) 직전 게임이 round=3까지 진행된 뒤 game_over에 도달한 상황을 직접 구성(gameRound=1 그대로).
  const penaltyG1 = host.impl.buildPenaltyValue({ gameRound: 1, phaseScheduledAt: 0 });
  const gameOverSettled = await fireAndAdvanceUntil(
    () => host.env.db.from('rooms').update({ penalty: penaltyG1, round: 3, status: 'game_over' }).eq(),
    () => victim.impl.state.status === 'game_over' && victim.impl.state.gameRound === 1 && victim.impl.state.round === 3,
    settleBudgetMs
  );

  // 2) fromStatus==='stats'면 REAL endGame()과 정확히 동일하게 updateRoomStatus("stats")만 호출해
  //    game_over→stats로 한 단계 더 전진시킨다(round/gameRound는 여전히 그대로).
  let statsSettled = true;
  if (fromStatus === 'stats') {
    statsSettled = await fireAndAdvanceUntil(
      () => host.impl.updateRoomStatus('stats'),
      () => victim.impl.state.status === 'stats',
      settleBudgetMs
    );
  }

  const cursor = victim.telemetry.events.length;

  // 3) REAL inviteForReplay()가 실제로 쓰는 것과 정확히 동일한 payload(index.html ~9899) —
  //    round/penalty 필드를 전혀 건드리지 않는다(그래서 round=3 그대로 victim에 남아야 정상).
  const reinvitingSettled = await fireAndAdvanceUntil(
    () => host.env.db.from('rooms').update({ status: 'reinviting' }).eq(),
    () => victim.impl.state.status === 'reinviting',
    settleBudgetMs
  );

  const eventsSinceCursor = victim.telemetry.events.slice(cursor);
  const staleSkipEventsForReinviting = eventsSinceCursor.filter(
    (e) => e.eventType === 'STALE_ROOM_UPDATE_SKIPPED' && e.roomStatus === 'reinviting'
  );
  const selfHealEvents = eventsSinceCursor.filter((e) => e.eventType === 'STALE_ROOM_UPDATE_SELF_HEAL');

  return {
    clockSyncSettled, gameOverSettled, statsSettled, reinvitingSettled,
    victimStatusAfterReinviting: victim.impl.state.status,
    victimRoundAfterReinviting: victim.impl.state.round, // round-불변 리셋이므로 3 그대로여야 정상
    staleSkipCountForReinviting: staleSkipEventsForReinviting.length,
    selfHealCount: selfHealEvents.length,
    world,
  };
}

// §STOP-SHIP 3차 재현: goToReadyScreen()의 round-불변 `{status:'ready'}` 전이(LOW, 재현 가능성
// 원 보고에서 미확정) — index.html ~10603의 goToReadyScreen()은 updateRoomStatus('ready')만
// 호출한다(round 필드 없음, inviteForReplay와 동일하게 round-불변). 다만 실제 도달 경로상 이
// 함수는 항상 beginNewGameRound({status:'lobby'|'waiting', increment:true, ...})가 이미 round를
// 1로 리셋해 둔 "새 gameRound의 lobby/waiting" 화면(screenHostRoom)에서만 호출되므로(§index.html
// grep: startGameBtn은 screenHostRoom에만 존재), 이 시나리오에서 game_over/stats에 도달해 있던
// round=3인 채로 goToReadyScreen()이 곧바로 불릴 수 있는지는 이 하니스만으로 확정할 수 없다(DOM
// 네비게이션 자체를 재현하지 않으므로) — 그래서 이 함수는 "만약 그 상태에서 불린다면 어떻게
// 처리되는가"만 격리해서 보여준다(도달 가능성 자체를 증명하지 않음, 원 보고의 "미확정" 그대로
// 유지). 'ready'는 §회복-보존 실증 근거로 ACTIVE_ROUND_PHASE_ORDER에 여전히 남아있으므로(0), 이
// 경로는 CRITICAL-2/MEDIUM과 달리 여전히 stale로 막힌다 — 이는 회귀가 아니라 재설계 이전과 동일한
// 기존 동작이 그대로 유지된 것이다(트레이드오프, 아래 게이팅 테스트가 이 사실 자체를 감시한다).
export async function runGoToReadyScreenRoundInvariantScenario({
  seed = 8484848, resolveElimination, judgePure, computePlayerStatuses, PLAYER_STATUS, maxLoserCountFor,
  combinedSourceOverride = null, vi, settleBudgetMs = 45000, stepMs = 250, pollIntervalMs = REAL_POLL_INTERVAL_MS,
  fromStatus = 'stats',
}) {
  const world = createTrialWorld({
    participantCount: 3, seed, targetLoserCount: 1,
    resolveElimination, judgePure, computePlayerStatuses, PLAYER_STATUS, maxLoserCountFor, combinedSourceOverride,
    pollingEnabled: true, pollIntervalMs,
  });
  const host = world.devices[0];
  const victim = world.devices[1];

  async function advanceUntil(predicate, budgetMs) {
    let elapsed = 0;
    while (elapsed < budgetMs && !predicate()) {
      // eslint-disable-next-line no-await-in-loop
      await vi.advanceTimersByTimeAsync(stepMs);
      elapsed += stepMs;
    }
    return predicate();
  }
  async function fireAndAdvanceUntil(promiseFactory, predicate, budgetMs) {
    const p = promiseFactory();
    p.catch(() => {});
    return advanceUntil(predicate, budgetMs);
  }

  const clockSyncSettled = await advanceUntil(
    () => world.devices.every((d) => d.impl.getServerClockSynced()), settleBudgetMs
  );

  const penaltyG1 = host.impl.buildPenaltyValue({ gameRound: 1, phaseScheduledAt: 0 });
  const gameOverSettled = await fireAndAdvanceUntil(
    () => host.env.db.from('rooms').update({ penalty: penaltyG1, round: 3, status: 'game_over' }).eq(),
    () => victim.impl.state.status === 'game_over' && victim.impl.state.gameRound === 1 && victim.impl.state.round === 3,
    settleBudgetMs
  );

  let statsSettled = true;
  if (fromStatus === 'stats') {
    statsSettled = await fireAndAdvanceUntil(
      () => host.impl.updateRoomStatus('stats'),
      () => victim.impl.state.status === 'stats',
      settleBudgetMs
    );
  }

  const cursor = victim.telemetry.events.length;

  // REAL goToReadyScreen()이 실제로 쓰는 것과 정확히 동일한 payload(index.html ~10603) — round
  // 필드를 전혀 건드리지 않는다.
  const readySettled = await fireAndAdvanceUntil(
    () => host.env.db.from('rooms').update({ status: 'ready' }).eq(),
    () => victim.impl.state.status === 'ready',
    settleBudgetMs
  );

  const eventsSinceCursor = victim.telemetry.events.slice(cursor);
  const staleSkipEventsForReady = eventsSinceCursor.filter(
    (e) => e.eventType === 'STALE_ROOM_UPDATE_SKIPPED' && e.roomStatus === 'ready'
  );
  const selfHealEvents = eventsSinceCursor.filter((e) => e.eventType === 'STALE_ROOM_UPDATE_SELF_HEAL');

  return {
    clockSyncSettled, gameOverSettled, statsSettled, readySettled,
    victimStatusAfterReady: victim.impl.state.status,
    staleSkipCountForReady: staleSkipEventsForReady.length,
    selfHealCount: selfHealEvents.length,
    world,
  };
}

// ── countdown SYNC_RENDER 시퀀스 검출기(추출 헬퍼) ──────────────────────────────
// runMeasuredTrial/runEliminationTrial이 각자 인라인으로 들고 있던 것과 동일한 판정 규칙이다
// (SYNC_RENDER phase:'countdown'의 round 수열이 순증하는가 / 같은 round가 2회 이상 렌더됐는가).
// 두 인라인 블록은 §STOP-SHIP §1~§4 전 구간이 이미 검증한 코드라 이번 작업에서 건드리지 않았고
// (회귀 위험 회피), 여기서는 표적 시나리오가 world 없이 device 배열만으로 같은 규칙을 재사용할 수
// 있도록 동일 규칙을 함수로 노출한다. 필터의 `kind === 'metric'`은 runEliminationTrial 쪽 표현을
// 따랐다 — 두 인라인 표현의 유일한 차이지만 SYNC_RENDER는 QA.emit('metric', ...)으로만 발행되므로
// 결과는 항상 동일하다(§createTelemetry: 모든 이벤트가 kind를 갖는다).
export function collectCountdownRenderFailureModes(devices) {
  const failureModes = [];
  for (const d of devices) {
    const countdownEvents = d.telemetry.events.filter((e) => e.kind === 'metric' && e.eventType === 'SYNC_RENDER' && e.phase === 'countdown');
    const seq = countdownEvents.map((e) => e.round);
    for (let i = 1; i < seq.length; i++) {
      if (seq[i] <= seq[i - 1]) failureModes.push({ type: 'ROUND_NOT_MONOTONIC', device: d.id, seq });
    }
    const byRound = {};
    for (const e of countdownEvents) { byRound[e.round] = (byRound[e.round] || 0) + 1; }
    for (const [round, count] of Object.entries(byRound)) {
      if (count > 1) failureModes.push({ type: 'DOUBLE_COUNTDOWN_RENDER', device: d.id, round: Number(round), count });
    }
  }
  return failureModes;
}

// ── STOP-SHIP 4차(CEO 지시): ACTIVE_ROUND_PHASE_ORDER의 'ready' 순서 위반 결정론적 표적 재현 ──
//
// 배경(왜 재설계했나): 종전 mutation-3b는 `ACTIVE_ROUND_PHASE_ORDER`에서 `ready: 0`을 지운
// mutant를 N=5/10/16 × 150 trial(총 450) 무작위 스윕으로 "언젠가 걸리기를 기대"하는 확률적
// 검출이었다(실측 8 이벤트 / 4 trial = 0.9%). 이 시나리오는 같은 결함을 무작위 없이 손으로 구성한
// 최소 이벤트열로 직접 발현시킨다 — 정상 코드는 항상 통과하고 mutant는 항상 실패한다.
//
// ── 결함 메커니즘(index.html 실코드 기준) ──
//   isActiveRoundPhaseStatus(s) = ACTIVE_ROUND_PHASE_ORDER에 s가 있는가(:5726).
//   round-축 (:5734) : 같은 gameRound 안에서 incomingRound < state.round 이고, 들어오는 status가
//                      진행 phase일 때만 stale로 본다.
//   phase-축 (:5746) : 같은 (gameRound, round) 안에서 양쪽 status가 모두 진행 phase이고 들어오는
//                      쪽 순번이 더 작을 때만 stale로 본다.
//   `ready: 0`을 지우면 isActiveRoundPhaseStatus('ready')가 false가 되어 들어오는 'ready' row가
//   두 축을 모두 무조건 통과한다 → :5832 `state.round = room.round`(Math.max 보호 없음)와
//   :5867 `state.status = room.status`가 과거 값으로 되돌아간다.
//
// ── 최소 이벤트열(무작위 스윕/2.6초 폴링/재정렬 추첨 전부 불필요) ──
//   E1  playing(round=1)  : REAL startGame()이 커밋하는 payload와 동일
//                           ({status:'playing', penalty:buildPenaltyValue({gameRound, countdownStartAt:
//                           getNextCountdownStartAt()})}, index.html:7364-7375).
//                           → victim이 라운드1 카운트다운을 실제로 렌더한다(SYNC_RENDER countdown round=1).
//   E2  playing(round=2)  : REAL autoStartDrawRematch()가 커밋하는 payload와 동일
//                           ({round:nextRoundNo, status:'playing', penalty:...countdownStartAt:
//                           getNextCountdownStartAt()}, index.html:9629-9636).
//                           → victim의 라운드2 카운트다운 coroutine이 시작되어 lead sleep
//                             (runCountdown :7551, `await sleep(min(waitMs,4800))`)에서 suspend된다.
//   E3  stale ready 주입   : REAL nextRound()가 커밋하는 ready payload와 동일
//                           ({round:N, status:'ready', penalty:buildPenaltyValue({gameRound,
//                           phaseScheduledAt:getNextPhaseScheduledAt(), phaseKind:'ready'})},
//                           index.html:9798-9801)를 정상 구독 큐를 우회해 victim의 REAL
//                           handleRoomUpdate에 직접 1회 전달한다(§runStaleRowGuardScenario/
//                           §runReadyBranchClobberScenario와 동일한 "직접 배달" 접합부).
//                             axis='round' → N=1 (지난 라운드의 ready row가 라운드2 진행 중 늦게 도착)
//                             axis='phase' → N=2 (같은 라운드의 ready row가 playing 뒤에 재정렬 도착)
//   E4  시간 진행          : suspend돼 있던 라운드2 coroutine이 lead sleep에서 깨어나 SYNC_RENDER
//                           countdown을 발행한다 — 그 이벤트의 round는 `state.round || 1`(:7562)이라
//                           E3가 state.round를 되돌렸으면 그대로 과거 라운드 번호로 찍힌다.
//
//   왜 이게 최소인가: (a) 되돌아갈 "과거 라운드"가 있어야 하므로 라운드가 최소 2개 필요하고,
//   (b) ROUND_NOT_MONOTONIC/DOUBLE_COUNTDOWN_RENDER는 countdown 렌더가 2회 이상이어야 정의되므로
//   라운드1 렌더 1회 + 라운드2 렌더 1회가 최소이며, (c) 되돌림이 두 렌더 "사이"에 끼어들어야 하므로
//   라운드2 렌더가 아직 안 끝난 지점(lead sleep) 1곳에 주입이 필요하다. E1/E2/E3 중 하나라도 빼면
//   위 세 조건 중 하나가 무너진다. 라운드1↔2 사이의 'ready'/'result' 전이는 이 결함과 무관하므로
//   넣지 않았다(REAL autoStartDrawRematch가 실제로 playing→playing으로 바로 넘어가는 경로다).
//
// ── P2(PHASE_RENDER_BUFFER_MS) 내성 ──
//   이 시나리오의 suspend 창은 `getNextCountdownStartAt()`의 lead(:4546, 기본 3600ms)로 만들어진다 —
//   PHASE_RENDER_BUFFER_MS(:4567)는 getNextPhaseScheduledAt()에만 쓰이고, 그 값은 stale 게이트가
//   판정을 끝낸 "뒤"의 waitForPhaseRender('nextRound', ...) 대기에만 관여한다. 게다가 E3의 판정
//   결과(state.round/state.status 되돌림 여부)는 handleRoomUpdate 최상단~:5867 구간이 await를 전혀
//   거치지 않는 완전 동기 구간이라(index.html:5837 주석), 아래에서 "fire 직후" 그 자리에서 바로
//   관측한다 — 어떤 타이머/버퍼 값과도 무관하다. 버퍼가 바뀌어 이 전제가 깨지는 경우를 대비해
//   injectedWhileCountdownSuspended(주입 시점에 라운드2 COUNTDOWN_START는 이미 찍혔고 SYNC_RENDER는
//   아직 안 찍혔는가)를 함께 반환해, 조용히 검출력을 잃는 대신 테스트가 큰 소리로 깨지게 한다.
export async function runStaleReadyPhaseOrderScenario({
  axis = 'round', seed = 313131, echoStalePlayingAfterInjection = false,
  resolveElimination, judgePure, computePlayerStatuses, PLAYER_STATUS, maxLoserCountFor,
  combinedSourceOverride = null, vi, settleBudgetMs = 30000, stepMs = 250, injectionStepMs = 50,
}) {
  if (axis !== 'round' && axis !== 'phase') throw new Error(`[rc3-harness] unsupported axis: ${axis}`);
  // 폴링 OFF: 2.6초 REST 채널이 같은 row를 임의 시점에 재배달하면 "언제 무엇이 도착했는가"가
  // 다시 확률적이 된다 — 이 시나리오의 목적은 그 확률성을 제거하는 것이므로 의도적으로 끈다
  // (폴링/이중경로 자체의 회귀 감시는 §Phase2 게이팅 테스트가 이미 상시로 담당한다).
  const world = createTrialWorld({
    participantCount: 2, seed, targetLoserCount: 1,
    resolveElimination, judgePure, computePlayerStatuses, PLAYER_STATUS, maxLoserCountFor, combinedSourceOverride,
  });
  const host = world.devices[0];
  const victim = world.devices[1];
  const roomId = world.roomStore.id;

  async function advanceUntil(predicate, budgetMs, step = stepMs) {
    let elapsed = 0;
    while (elapsed < budgetMs && !predicate()) {
      // eslint-disable-next-line no-await-in-loop
      await vi.advanceTimersByTimeAsync(step);
      elapsed += step;
    }
    return predicate();
  }

  const countdownRenders = () => victim.telemetry.events.filter(
    (e) => e.kind === 'metric' && e.eventType === 'SYNC_RENDER' && e.phase === 'countdown');
  const countdownStarts = () => victim.telemetry.events.filter(
    (e) => e.kind === 'metric' && e.eventType === 'COUNTDOWN_START');

  const clockSyncSettled = await advanceUntil(
    () => world.devices.every((d) => d.impl.getServerClockSynced()), settleBudgetMs
  );

  // ── E1: 라운드1 playing (REAL startGame() payload) ──────────────────────────
  const rowPlayingRound1 = {
    id: roomId, round: 1, status: 'playing',
    penalty: victim.impl.buildPenaltyValue({
      gameRound: 1, countdownStartAt: victim.impl.getNextCountdownStartAt(),
    }),
  };
  const p1 = victim.impl.handleRoomUpdate(rowPlayingRound1);
  p1.catch(() => {});
  const round1CountdownRendered = await advanceUntil(
    () => countdownRenders().some((e) => e.round === 1), settleBudgetMs
  );
  // 라운드1 coroutine이 완주해 자신의 active key를 반납할 때까지 기다린다 — 두 coroutine이 겹친
  // 상태에서 라운드2를 시작하면 세대 토큰 경합(중복 차단/stale abort)이 섞여 관측이 흐려진다.
  const round1CountdownFinished = await advanceUntil(
    () => victim.impl.state.countdownCoroutineActiveKey == null, settleBudgetMs
  );

  // ── E3용 stale 'ready' row(REAL nextRound() payload)를 "지금" 만들어 둔다 ──────
  // 이 시점에 만든다는 것 자체가 충실하다: 실제로도 이 row는 라운드2 playing보다 먼저 커밋된 뒤
  // 배달만 늦어져 도착하는 과거 스냅샷이다(phaseScheduledAt도 그래서 과거 시각이 된다).
  const staleReadyRow = {
    id: roomId,
    round: axis === 'round' ? 1 : 2,
    status: 'ready',
    penalty: victim.impl.buildPenaltyValue({
      gameRound: 1, phaseScheduledAt: victim.impl.getNextPhaseScheduledAt(), phaseKind: 'ready',
    }),
  };

  // ── E2: 라운드2 playing (REAL autoStartDrawRematch() payload) ────────────────
  const rowPlayingRound2 = {
    id: roomId, round: 2, status: 'playing',
    penalty: victim.impl.buildPenaltyValue({
      gameRound: 1, countdownStartAt: victim.impl.getNextCountdownStartAt(),
    }),
  };
  const p2 = victim.impl.handleRoomUpdate(rowPlayingRound2);
  p2.catch(() => {});
  // 라운드2 coroutine이 lead sleep 직전까지(COUNTDOWN_START 발행, index.html:7538) 도달할 때까지만
  // 진행시킨다 — 이 지점부터 SYNC_RENDER(:7561)까지 사이가 곧 주입 창(lead ≈ 3600ms)이다.
  const round2CountdownStarted = await advanceUntil(
    () => countdownStarts().some((e) => e.round === 2), settleBudgetMs, injectionStepMs
  );

  // ── E3: stale 'ready' row 직접 주입 ─────────────────────────────────────────
  const cursor = victim.telemetry.events.length;
  const injectedWhileCountdownSuspended =
    countdownStarts().some((e) => e.round === 2) && !countdownRenders().some((e) => e.round === 2);
  const roundBeforeInjection = victim.impl.state.round;
  const statusBeforeInjection = victim.impl.state.status;
  const pInject = victim.impl.handleRoomUpdate(staleReadyRow);
  pInject.catch(() => {});
  // ⚠️ 바로 이 자리가 관측의 핵심이다 — REAL handleRoomUpdate는 함수 최상단부터 stale 게이트
  //    (:5751)와 `state.round = room.round`(:5832) / `state.status = room.status`(:5867)까지 await를
  //    전혀 거치지 않는다(index.html:5837 주석이 명시하는 계약). 따라서 "fire 직후, 아직 어떤
  //    fake timer도 흘려보내지 않은" 이 동기 시점의 값이 곧 게이트의 판정 결과 그 자체다.
  const roundAfterInjectionSync = victim.impl.state.round;
  const statusAfterInjectionSync = victim.impl.state.status;

  // ── E3b(옵션): 같은 과거 세대의 playing row 1회 재에코 ───────────────────────
  // WRPS-078의 카운트다운 세대 가드(isCountdownGenerationCurrent :7478)는 `state.status !==
  // "playing"`도 stale 조건으로 본다 — 그래서 E3만으로 status가 'ready'로 되돌아가면, suspend돼
  // 있던 라운드2 coroutine은 SYNC_RENDER를 "찍고 어긋나는" 대신 checkpoint 2에서 조용히
  // abort된다(COUNTDOWN_STALE_GENERATION_ABORTED). 즉 이 세대 가드가 되돌림 피해를
  // "이중/역행 카운트다운"이 아니라 "카운트다운 실종"으로 흡수한다 — 종전 mutation-3b의 무작위
  // 스윕이 ROUND_NOT_MONOTONIC/DOUBLE_COUNTDOWN_RENDER를 0.9%밖에 못 본 이유가 이것이다(대부분의
  // 경우 피해가 다른 실패모드로 바뀐다).
  // 이 옵션은 그 흡수를 뚫고 종전 실패모드 자체를 결정론적으로 재현한다: 되돌아간 (round=1,
  // status='ready') 위로 "그 시점에 실제로 존재했던" 라운드1 playing row(E1과 동일 스냅샷)가 한 번
  // 더 도착하면(realtime 재정렬/폴링 이중경로에서 흔한 중복 에코), status가 다시 'playing'이 되어
  // 라운드1 카운트다운이 통째로 다시 렌더된다 → SYNC_RENDER countdown round 수열이 [1, 1]이 되어
  // ROUND_NOT_MONOTONIC + DOUBLE_COUNTDOWN_RENDER가 동시에 성립한다.
  // 정상 코드에서는 이 에코 자체가 round-축(incomingRound 1 < state.round 2, 'playing'은 진행
  // phase)에서 그대로 stale로 막히므로 아무 일도 일어나지 않는다.
  let stalePlayingEchoSettled = null;
  if (echoStalePlayingAfterInjection) {
    const pEcho = victim.impl.handleRoomUpdate(rowPlayingRound1);
    pEcho.catch(() => {});
    stalePlayingEchoSettled = false;
    pEcho.then(() => { stalePlayingEchoSettled = true; }, () => { stalePlayingEchoSettled = true; });
  }

  // ── E4: suspend돼 있던 라운드2 coroutine을 깨워 SYNC_RENDER를 발행시킨다 ──────
  const countdownRenderCountBeforeResume = countdownRenders().length;
  await advanceUntil(
    () => countdownRenders().length > countdownRenderCountBeforeResume, settleBudgetMs
  );
  // 주입/에코 호출의 async 잔여분(ready 분기 Promise.all, 카운트다운 coroutine 등)도 정리한다 —
  // 관측값에는 영향이 없지만 미해결 promise를 남기지 않는다.
  let injectSettled = false;
  pInject.then(() => { injectSettled = true; }, () => { injectSettled = true; });
  await advanceUntil(
    () => injectSettled && (stalePlayingEchoSettled !== false) && victim.impl.state.countdownCoroutineActiveKey == null,
    settleBudgetMs
  );

  const eventsSinceCursor = victim.telemetry.events.slice(cursor);
  const staleSkipEventsForReady = eventsSinceCursor.filter(
    (e) => e.eventType === 'STALE_ROOM_UPDATE_SKIPPED' && e.roomStatus === 'ready');
  const selfHealEvents = eventsSinceCursor.filter((e) => e.eventType === 'STALE_ROOM_UPDATE_SELF_HEAL');
  const countdownRoundSeq = countdownRenders().map((e) => e.round);
  const failureModes = collectCountdownRenderFailureModes([victim]);
  // WRPS-078 세대 가드가 "되돌림 피해를 카운트다운 실종으로 흡수"한 흔적(§E3b 주석) — 어느 실패
  // 모드로 나타났는지를 테스트가 구분해 단언할 수 있게 함께 노출한다.
  const countdownAbortEventsSinceInjection = eventsSinceCursor.filter(
    (e) => e.eventType === 'COUNTDOWN_STALE_GENERATION_ABORTED');

  return {
    axis, echoStalePlayingAfterInjection, clockSyncSettled,
    round1CountdownRendered, round1CountdownFinished, round2CountdownStarted,
    injectedWhileCountdownSuspended,
    roundBeforeInjection, statusBeforeInjection,
    roundAfterInjectionSync, statusAfterInjectionSync,
    staleSkipCountForReady: staleSkipEventsForReady.length,
    selfHealCount: selfHealEvents.length,
    countdownRoundSeq,
    round2CountdownRendered: countdownRenders().some((e) => e.round === 2),
    countdownAbortCheckpointsSinceInjection: countdownAbortEventsSinceInjection.map((e) => e.checkpoint),
    failureModes,
    roundNotMonotonicCount: failureModes.filter((f) => f.type === 'ROUND_NOT_MONOTONIC').length,
    doubleCountdownRenderCount: failureModes.filter((f) => f.type === 'DOUBLE_COUNTDOWN_RENDER').length,
    hostId: host.id, victimId: victim.id,
    world,
  };
}

// ── WRPS-079 Round2(STOP-SHIP, HIGH 잔존 수정) 전용 시나리오: ready 분기 재진입 직접 재현 ──
// §Phase3/EG 넓은 시드 스윕(N=3..20, 각 40 seed, 총 360 trial, pessimistic 레짐 + 위 REPRO_SEEDS
// 2종 포함)으로는 이 하니스의 타이밍 모델(참가자 select ackDelay 60~280ms, 고정 상한) 안에서
// ready 분기 재개 지점이 실제로 stale 세대를 관측하는 사례를 한 건도 재현하지 못했다(§보고 정직
// 기록) — result 분기(finishRoundLocal 채널)는 waitForPhaseRender + fetchFreshParticipantsForResult
// (최대 5000ms 하드 타임아웃 + 최대 3000ms 추가 대기, 도합 최대 8초급) await 체인이 있어 라운드
// 전체가 그 사이에 지나갈 여지가 크지만, ready 분기의 Promise.all은 waitForPhaseRender(스케줄
// 시각 기준, 보통 이미 지난 시각) + 참가자 재조회(하니스에서 ackDelay 상한 280ms) 뿐이라 이
// 하니스의 타이밍 분포에서는 "그 사이 라운드 전체가 한 바퀴 더 돈다"는 경합이 사실상 발생하지
// 않는다(§7에 한계로 명시). 그러나 REAL 프로덕션에서는 이 참가자 재조회에 하드 타임아웃이 전혀
// 없다(§index.html 5905 부근 주석 — result 분기만 Build30에서 5000ms 상한을 받았고 ready 분기는
// 받지 않음) — 느리거나 불안정한 네트워크(이 저장소 자신의 기록에 실측 최대 101,778ms 대기가
// 남아있다, Build30/WRPS-078 주석 참고)에서는 이 suspend 구간이 원리적으로 임의로 길어질 수 있어
// 여러 라운드가 그 사이 지나가는 이 경합이 발생할 수 있다.
//
// 그래서 `runStaleRowGuardScenario`(위)와 동일한 성격의 "직접 구성" 재현으로 그 메커니즘 자체를
// 결정론적으로 증명한다 — REAL handleRoomUpdate를 두 번(오래된 ready(round2) 1회 + 이미 더
// 새로워진 컨텍스트를 나타내는 waiting(round3) 1회) 그대로 호출한다(로직을 손으로 다시 짜지
// 않음). JS는 await 지점에서만 다른 실행에 양보하므로(§index.html hruGen 캡처 지점 주석과 동일
// 원리), 오래된 호출을 먼저 fire(await 없이 시작)하면 그 호출은 반드시 자신의 Promise.all에서
// suspend된 채로 멈추고, 그 직후(아직 어떤 fake timer도 흘려보내기 전) 새 컨텍스트 호출을
// 완결시키면(status:'waiting' 분기는 await가 전혀 없어 즉시 완결된다) 세대가 결정론적으로
// bump된다 — 임의의 ackDelay 타이밍 추첨에 기대지 않는다. 그 다음 "실제로 더 새로운 컨텍스트가
// 이미 확정해 둔" confirmedSafeIds/LoserIds를 대입해 두고(§4 참고 — REAL finishRoundLocal 전체를
// 다시 구동하지 않고 그 결과만 나타냄, 이 시나리오의 유일한 하니스 대체), REAL nextRound()의 다단계
// write 시퀀스(참가자 reset이 safe/loser 마커 재기록보다 먼저 커밋되는 실제 순서, index.html
// nextRound() 9579 부근) 중간 상태(전원 choice:null)를 참가자 스토어에 반영한 뒤에야 오래된 호출을
// 재개시킨다. 게이트가 있으면(현재 코드) staleGeneration:true를 감지해 스킵하고
// confirmedSafeIds/LoserIds는 그대로 유지된다 — 게이트를 mutation으로 제거하면 오래된 호출이 이
// "전환 중간" 스냅샷으로 syncConfirmedIdsFromParticipants를 실행해 방금 확정된 값을 지워버린다.
export async function runReadyBranchClobberScenario({
  seed = 434343, resolveElimination, judgePure, computePlayerStatuses, PLAYER_STATUS, maxLoserCountFor,
  combinedSourceOverride = null, vi, settleBudgetMs = 8000, stepMs = 250,
}) {
  const world = createTrialWorld({
    participantCount: 2, seed, targetLoserCount: 1,
    resolveElimination, judgePure, computePlayerStatuses, PLAYER_STATUS, maxLoserCountFor, combinedSourceOverride,
  });
  const host = world.devices[0];
  const victim = world.devices[1];
  const roomId = world.roomStore.id;

  async function advanceUntil(predicate, budgetMs) {
    let elapsed = 0;
    while (elapsed < budgetMs && !predicate()) {
      // eslint-disable-next-line no-await-in-loop
      await vi.advanceTimersByTimeAsync(stepMs);
      elapsed += stepMs;
    }
    return predicate();
  }

  // 0) 전원 clock-sync settle(다른 시나리오와 동일 패턴).
  const clockSyncSettled = await advanceUntil(
    () => world.devices.every((d) => d.impl.getServerClockSynced()), settleBudgetMs
  );

  // 준비: victim이 이미 round=1을 마치고(host=진행중, victim=confirmed-safe) round=2 ready
  // 진입 직전이라고 직접 구성한다(§runStaleRowGuardScenario와 동일 성격의 "직접 구성").
  victim.impl.state.round = 1;
  victim.impl.state.gameRound = 1;
  world.roomStore.participants.get(victim.id).choice = '__safe__';

  const rowReadyRound2 = {
    id: roomId, round: 2, status: 'ready',
    penalty: victim.impl.buildPenaltyValue({ gameRound: 1, phaseScheduledAt: 0, phaseKind: 'ready' }),
  };

  // 1) round=2 ready row 처리를 fire(await 없이 시작) — round>1이라
  //    readyParticipantsRefreshPromise가 생성되고, 그 select는 실제 setTimeout(ackDelay) 기반이라
  //    아직 fake timer를 흘려보내지 않은 지금은 반드시 그 Promise.all await에서 suspend된다
  //    (함수 최상단부터 여기까지는 REAL 코드가 항상 동기 실행됨 — index.html hruGen 캡처 주석 참고).
  const p1 = victim.impl.handleRoomUpdate(rowReadyRound2);
  p1.catch(() => {});
  const genAfterP1Fired = victim.impl.state.hruGen;
  const activeKeyAfterP1Fired = victim.impl.state.hruActiveKey;

  // 2) p1이 아직 suspend된 그 사이, "이미 완전히 처리된 더 새로운 컨텍스트"를 결정론적으로
  //    만든다 — status:'waiting' 분기는 어떤 await도 없이 완전히 동기 실행되므로(index.html
  //    handleRoomUpdate 'waiting' 분기 참고) 이 호출은 시간 흐름 없이 즉시 완결되고, 그 완결이
  //    "실제로 더 새로운 컨텍스트가 이미 완전히 처리됨"을 임의의 ackDelay 추첨 없이 보장한다.
  const rowWaitingRound3 = {
    id: roomId, round: 3, status: 'waiting',
    penalty: victim.impl.buildPenaltyValue({ gameRound: 1, phaseScheduledAt: 0 }),
  };
  await victim.impl.handleRoomUpdate(rowWaitingRound3);
  const genAfterBump = victim.impl.state.hruGen;
  const activeKeyAfterBump = victim.impl.state.hruActiveKey;

  // 3) "방금 그 새로운 컨텍스트가 실제로 확정해 둔" confirmedSafeIds/LoserIds를 나타낸다(REAL
  //    finishRoundLocal 전체를 다시 구동하지 않고 그 결과만 대입 — 이 시나리오의 유일한 하니스
  //    대체, §runStaleRowGuardScenario의 gameRound=1→2 전이 하니스 대체와 동일 성격/한계).
  //    동시에 참가자 스토어를 REAL nextRound()의 다단계 write 시퀀스 중간 상태(전원 choice:null,
  //    safe/loser 마커 재기록 직전)로 만든다.
  victim.impl.state.confirmedSafeIds = [host.id];
  victim.impl.state.confirmedLoserIds = [victim.id];
  world.roomStore.participants.get(host.id).choice = null;
  world.roomStore.participants.get(victim.id).choice = null;

  const readyClobberCheckCtx = beginReadyBranchClobberCheck(victim);

  // 4) p1의 suspend된 await 체인을 재개시킨다 — readyParticipantsRefreshPromise가 위 "전환 중간"
  //    (전원 choice:null) 스냅샷을 들고 resolve된다. p1은 여전히 자신이 처음 캡처한 세대
  //    (roomCode:1:2)로 커밋을 시도한다 — 게이트가 있으면(현재 코드) staleGeneration:true를
  //    감지해 스킵하고, 게이트를 mutation으로 무력화하면 이 스냅샷으로
  //    syncConfirmedIdsFromParticipants를 실행해 confirmedSafeIds/LoserIds를 둘 다 []로
  //    되돌려버린다(방금 3)에서 확정한 host=safe/victim=loser를 지워버림).
  let p1Settled = false;
  p1.then(() => { p1Settled = true; }, () => { p1Settled = true; });
  let elapsed = 0;
  while (elapsed < settleBudgetMs && !p1Settled) {
    // eslint-disable-next-line no-await-in-loop
    await vi.advanceTimersByTimeAsync(stepMs);
    elapsed += stepMs;
  }
  finishReadyBranchClobberCheck(victim, readyClobberCheckCtx);

  const resumeEvents = victim.telemetry.events.filter((e) => e.eventType === 'HANDLE_ROOM_UPDATE_READY_BRANCH_RESUMED');
  const abortedReadyEvents = victim.telemetry.events.filter((e) =>
    e.eventType === 'HANDLE_ROOM_UPDATE_STALE_GENERATION_ABORTED' && e.branch === 'ready');
  const clobberEvent = victim.telemetry.events.find((e) => e.eventType === 'READY_BRANCH_STATE_CLOBBER');

  return {
    clockSyncSettled, p1Settled,
    genAfterP1Fired, activeKeyAfterP1Fired, genAfterBump, activeKeyAfterBump,
    resumeEvents, abortedReadyEvents,
    clobberDetected: Boolean(clobberEvent), clobberEvent,
    confirmedSafeIdsBeforeResume: readyClobberCheckCtx.before.confirmedSafeIds,
    confirmedLoserIdsBeforeResume: readyClobberCheckCtx.before.confirmedLoserIds,
    finalConfirmedSafeIds: [...(victim.impl.state.confirmedSafeIds || [])],
    finalConfirmedLoserIds: [...(victim.impl.state.confirmedLoserIds || [])],
    hostId: host.id, victimId: victim.id,
    world,
  };
}

// ── H-1 전용 시나리오: rematch auto-advance 5경로(#1~#5) 실집행 재현 ─────────────
// 이 시나리오는 "REAL이 실제로 어떻게 result에서 빠져나오는가"를 5개 호출부 기준으로 한 번에
// 실집행한다(§makeFinishRoundLocalSubstitute 상단 5경로 표 참고):
//   #1~#3 정상 예약  : 라운드1 결과가 확정되는 순간 host가 scheduleRematchAutoAdvance()를 건다
//                      (여기서는 tooMany 분기 = index.html:8670에 대응하는 onOutcome 예약).
//   #4 안전망 A      : dbErrorInjectionFn으로 nextRound()의 rooms.update를 실패시키면 REAL
//                      catch(:9825) → scheduleRematchAdvanceRetryAfterFailure(:9717) →
//                      scheduleRematchAutoAdvance(backoff, :9733)가 실제로 발화한다.
//   #5 안전망 B      : duplicate 'result' 호출이 도착하면 REAL idempotent 조기반환(:8188) →
//                      maybeRecoverStalledRematchAdvance(:8212 → :9759)가 재예약한다.
//
// 하니스 개입(정직 공개, 이 3가지뿐 — 전부 §runStaleRowGuardScenario/§runReadyBranchClobberScenario와
// 동일 성격의 "직접 구성"이다):
//   (가) 라운드1의 결과 스냅샷(각 참가자 row의 "base|result")을 REAL encodeRoundChoice로 직접
//        만들어 넣는다 — 카운트다운/선택창을 5초씩 굴리지 않고 결과 전이 자체만 격리하기 위함.
//        판정은 여전히 REAL 경로(handleRoomUpdate result 분기 → fetchFreshParticipantsForResult →
//        finishRoundLocal 대체 → REAL resolveElimination)가 수행한다.
//   (나) simulateLostTimer: REAL 안전망 B의 전제 조건("(A)의 재예약이 유실됐거나 최초 스케줄
//        자체가 안 걸린 경우", index.html:9736-9739)을 그대로 만들기 위해 예약된 타이머 1개를
//        clearTimeout으로 없앤다. 이 전제 자체를 만들어내는 상위 원인(WRPS-079 hruGen 게이트가
//        그 호출을 통째로 차단하는 경우 등)은 이 하니스가 재현하지 않는다(§한계).
//   (다) applyNextRoundMarkerWrites: REAL nextRound()가 duplicate echo 이전에 이미 커밋해 둘 수
//        있는 중간 상태(확정자 __safe__/__loser__ 마커 + 나머지 choice:null 리셋,
//        index.html:9788-9797)를 참가자 스토어에 반영한다 — §runReadyBranchClobberScenario 3)과
//        동일한 기법. ⚠️ 이 하니스의 fake db는 `.eq('room_id', roomCode)` 대량 업데이트를
//        지원하지 않아(§createDb opParticipantsUpdateEq는 id 1건만 매치) REAL nextRound의 1단계
//        (전원 choice 리셋)가 무음으로 누락된다 — 이 시나리오는 그 누락된 REAL 부작용만 명시적으로
//        재현한다(하니스 기존 한계이며, 기본 스윕 동작은 이번 H-1에서 바꾸지 않았다).
//
// duplicate echo 전달 방식: REAL handleRoomUpdate는 `oldStatus !== state.status`일 때만 result
// 분기로 들어가므로(index.html:5870), status가 이미 'result'인 상태에서 같은 row를 다시 브로드캐스트해도
// finishRoundLocal에 도달하지 못한다. 그래서 이 시나리오는 REAL:6001이 실제로 하는 호출
// (`finishRoundLocal()`)만 1회 그대로 재현한다 — 그 호출이 다시 일어나게 만드는 상위 조건
// (out-of-order 재전달로 status가 잠시 다른 값으로 갔다 돌아오는 등)은 재현 대상이 아니다(§한계).
export async function runRematchAdvanceRecoveryScenario({
  seed = 919191, participantCount = 3, targetLoserCount = 1,
  resolveElimination, judgePure, computePlayerStatuses, PLAYER_STATUS, maxLoserCountFor,
  combinedSourceOverride = null, dbErrorInjectionFn = null, idempotencyCacheEnabled = true,
  simulateLostTimer = true, applyNextRoundMarkerWrites = true, deliverDuplicateEcho = true,
  preEchoDrainMs = 0, vi, settleBudgetMs = 30000, stepMs = 250,
}) {
  const world = createTrialWorld({
    participantCount, seed, targetLoserCount,
    resolveElimination, judgePure, computePlayerStatuses, PLAYER_STATUS, maxLoserCountFor,
    combinedSourceOverride, dbErrorInjectionFn, idempotencyCacheEnabled,
  });
  const host = world.devices[0];

  async function advanceUntil(predicate, budgetMs) {
    let elapsed = 0;
    while (elapsed < budgetMs && !predicate()) {
      // eslint-disable-next-line no-await-in-loop
      await vi.advanceTimersByTimeAsync(stepMs);
      elapsed += stepMs;
    }
    return predicate();
  }
  async function advanceFor(budgetMs) {
    let elapsed = 0;
    while (elapsed < budgetMs) {
      // eslint-disable-next-line no-await-in-loop
      await vi.advanceTimersByTimeAsync(stepMs);
      elapsed += stepMs;
    }
  }
  async function fireAndAdvanceUntil(promiseFactory, predicate, budgetMs) {
    const p = promiseFactory();
    p.catch(() => {}); // 브로드캐스트 전파는 별도 스케줄(§runStaleRowGuardScenario 주석과 동일 이유)
    return advanceUntil(predicate, budgetMs);
  }
  const substituteEvents = () => host.telemetry.events.filter((e) => e.eventType === 'FINISH_ROUND_SUBSTITUTE');
  const idempotentEvents = () => host.telemetry.events.filter((e) => e.eventType === 'FINISH_ROUND_SUBSTITUTE_IDEMPOTENT');
  const autoAdvanceEvents = (type) => host.telemetry.events.filter((e) => e.eventType === type);

  const clockSyncSettled = await advanceUntil(
    () => world.devices.every((d) => d.impl.getServerClockSynced()), settleBudgetMs
  );

  // (가) 라운드1 결과 스냅샷 직접 구성 — REAL encodeRoundChoice로 인코딩한다(손으로 "rock|win"
  //      문자열을 짜지 않는다). N=3/targetLoserCount=1이면 win 1 + lose 2 → REAL tooMany 분기
  //      (index.html:8663-8670, 하니스에서는 resolveElimination의 'tooMany')에 대응한다.
  const scriptedResults = world.devices.map((d, i) => (
    i === 0 ? { id: d.id, base: 'rock', result: 'win' } : { id: d.id, base: 'scissors', result: 'lose' }
  ));
  for (const s of scriptedResults) {
    world.roomStore.participants.get(s.id).choice = host.impl.encodeRoundChoice(s.base, s.result);
  }

  // 라운드1 'result' 전이를 REAL 채널(host rooms.update → realtime 전파 → 전 기기
  // handleRoomUpdate result 분기)로 발행한다.
  const resultPenalty = host.impl.buildPenaltyValue({ gameRound: 1, phaseScheduledAt: 0, phaseKind: 'result' });
  const firstResolutionReached = await fireAndAdvanceUntil(
    () => host.env.db.from('rooms').update({ penalty: resultPenalty, round: 1, status: 'result' }).eq(),
    () => substituteEvents().length > 0,
    settleBudgetMs
  );
  const firstOutcome = substituteEvents().length ? substituteEvents()[0].outcome : null;
  const timerAfterFirstResolution = Boolean(host.impl.state.rematchAdvanceTimer);
  const retryAttemptsAfterFirstResolution = host.impl.getRematchAdvanceRetryAttempts();

  // (나) 예약 타이머 유실 모사(REAL 안전망 B의 전제 — 위 주석 참고).
  if (simulateLostTimer && host.impl.state.rematchAdvanceTimer) {
    clearTimeout(host.impl.state.rematchAdvanceTimer);
    host.impl.state.rematchAdvanceTimer = null;
  }

  // 안전망 A를 관측하려면(타이머 유실 없이) 예약된 타이머가 실제로 발화해 nextRound()가 실패할
  // 때까지 시간을 흘려보내야 한다 — preEchoDrainMs가 그 구간이다(기본 0 = 즉시 다음 단계).
  if (preEchoDrainMs > 0) await advanceFor(preEchoDrainMs);

  const retryAttemptsBeforeEcho = host.impl.getRematchAdvanceRetryAttempts();
  const timerBeforeEcho = Boolean(host.impl.state.rematchAdvanceTimer);

  // (다) REAL nextRound()의 다단계 write 중간 상태 반영(선택).
  if (applyNextRoundMarkerWrites) {
    const safeIds = [...(host.impl.state.confirmedSafeIds || [])];
    const loserIds = [...(host.impl.state.confirmedLoserIds || [])];
    for (const d of world.devices) {
      const row = world.roomStore.participants.get(d.id);
      if (safeIds.includes(d.id)) { row.choice = '__safe__'; row.is_ready = true; }
      else if (loserIds.includes(d.id)) { row.choice = '__loser__'; row.is_ready = true; }
      else { row.choice = null; row.is_ready = false; }
    }
    for (const d of world.devices) {
      d.impl.state.participants = world.roomStore.order.map((id) => ({ ...world.roomStore.participants.get(id) }));
    }
  }

  // duplicate 'result' 호출 재현(REAL index.html:6001의 `finishRoundLocal()` 그 자체).
  if (deliverDuplicateEcho) {
    try { await host.env.finishRoundLocal(); } catch (e) {}
  }
  const timerAfterEcho = Boolean(host.impl.state.rematchAdvanceTimer);
  const retryAttemptsAfterEcho = host.impl.getRematchAdvanceRetryAttempts();

  // 실제로 다음 라운드로 진행했는가 — REAL nextRound()가 성공했을 때만 room row가
  // { round: 2, status: 'ready' }로 커밋된다(index.html:9802). 이 하니스가 별도로 만들어내는
  // 신호가 아니라 REAL write 그 자체를 본다.
  const advancedToNextRound = await advanceUntil(
    () => world.roomStore.row.round >= 2 && world.roomStore.row.status === 'ready',
    settleBudgetMs
  );

  for (const d of world.devices) { try { d.stopPolling && d.stopPolling(); } catch (e) {} }

  return {
    clockSyncSettled, firstResolutionReached, firstOutcome,
    timerAfterFirstResolution, retryAttemptsAfterFirstResolution,
    timerBeforeEcho, retryAttemptsBeforeEcho,
    timerAfterEcho, retryAttemptsAfterEcho,
    advancedToNextRound,
    finalRoomStatus: world.roomStore.row.status,
    finalRoomRound: world.roomStore.row.round,
    finalHostStatus: host.impl.state.status,
    substituteOutcomes: substituteEvents().map((e) => e.outcome),
    idempotentReplayCount: idempotentEvents().length,
    nextRoundFailedEvents: autoAdvanceEvents('AUTO_ADVANCE_NEXTROUND_FAILED'),
    retryScheduledEvents: autoAdvanceEvents('AUTO_ADVANCE_RETRY_SCHEDULED'),
    retryExhaustedEvents: autoAdvanceEvents('AUTO_ADVANCE_RETRY_EXHAUSTED'),
    hostId: host.id, world,
  };
}

// 라운드 진행 드라이버: vitest fake timers 환경에서 호출한다(vi.advanceTimersByTimeAsync로
// 시간을 흘려보내는 것은 호출자 책임 — 이 함수는 그 사이사이 "다음 라운드를 시작해도 되는가"만
// REAL 함수 호출로 판단한다).
export function tickTrialWorld(world, host, targetRounds) {
  // ⚠️ vitest 가짜 타이머 환경에서는 여기서 startGame() 등을 await하면 안 된다 — startGame()
  // 내부는 sleep/db-ack(둘 다 실제 setTimeout 기반, 가짜 타이머가 가로챔)를 await하므로, 이
  // 함수를 호출하는 driver 루프가 그 완료를 동기적으로 기다리면 아무도 vi.advanceTimersByTimeAsync를
  // 호출하지 못해 교착 상태가 된다. 그래서 fire-and-forget으로 실행만 시작하고(실제 진행은 driver
  // 루프가 시간을 흘려보내는 동안 비동기로 이어진다), 에러만 텔레메트리로 남긴다.
  if (host.impl.state.round === 1 && host.impl.state.status === 'waiting' && !world.__round1Started) {
    world.__round1Started = true;
    host.impl.startGame().catch((e) => host.telemetry.emit('metric', { wrps: 'RC3-HARNESS', eventType: 'START_GAME_ROUND1_THREW', message: String(e && e.message || e) }));
  }
  // "전원 ready 렌더 완료" → 다음 라운드 시작(접합부 ③).
  //
  // EG(Elimination-extended) 확장으로 실측 발견(하니스 자체 결함, §7 기록): allDraw baseline에서는
  // 아무도 confirmedSafe/Loser가 되지 않으므로 REAL handleRoomUpdate의 ready 분기는 항상
  // showReadyScreen()/showHostRoom() 쪽만 탄다(index.html ~5860-5871) — env가 그 두 함수만
  // rendered.readyByRound에 훅했으므로 allDraw에서는 우연히 항상 맞았다. 그러나 실제 술래-소거가
  // 일어나면 이미 confirmedSafe인 기기는 showScreen("screenWinnerWait")를, confirmedLoser인
  // 기기는 showLoserWaitScreen()을 대신 호출한다(둘 다 rendered.readyByRound 훅이 없는 함수) —
  // 그 결과 그 라운드의 이 두 신호(allDevicesRenderedReadyFor, showReadyScreen/showHostRoom 훅
  // 기반)는 그 기기에서 영원히 set되지 않아 "전원 ready 렌더 완료"가 결코 참이 될 수 없고, 다음
  // 라운드가 시작되지 않는 영구 STALL을 만들었다(EG 실집행으로 실측 발견 — N=8 seed=710000
  // targetLoserCount=2, round11 tooMany 이후 round12에서 8대 전원이 'ready' 상태로 무한 대기).
  // 이건 REAL 코드의 결함이 아니라 하니스 관측 훅의 사각지대였다 — REAL waitForPhaseRender 자체는
  // 이 4가지 분기 전부에 대해 동일하게 SYNC_RENDER(phase:'nextRound') 텔레메트리를 먼저 emit한
  // 뒤(index.html 5849 waitForPhaseRender 호출, 그 반환값 readyIsFirstRender로 이후 분기) 그
  // 결과에 따라 4갈래 중 하나로 분기하므로, "이 라운드의 ready phase를 렌더했는가"의 권위 있는
  // 신호는 분기 결과가 아니라 이 텔레메트리 자체다(위 §RC-3 taxonomy 수렴 섹션의
  // getPhaseSyncRenderEvent와 동일한 원칙 — REAL 계측이 이미 있으면 그것을 쓰고 새 관측을
  // 발명하지 않는다). 그래서 allDevicesRenderedReadyViaTelemetryFor(REAL SYNC_RENDER 기반, 기존에
  // RC-3 taxonomy 섹션에서 이미 export돼 있었으나 이 트리거 루프에는 아직 연결되지 않았던 함수)로
  // 교체한다 — allDraw baseline에서는 두 신호가 항상 동시에 참이 되므로(위 설명) 이 교체로 기존
  // 686개 회귀 스윕의 결과가 달라지지 않는다(§6 무회귀 재확인, npm test로 재검증).
  for (let r = 2; r <= targetRounds + 1; r++) {
    if (world.readyTriggeredForRound.has(r)) continue;
    if (allDevicesRenderedReadyViaTelemetryFor(world, r)) {
      world.readyTriggeredForRound.add(r);
      host.impl.startGame({ trigger: 'last-ready' }).catch((e) => host.telemetry.emit('metric', { wrps: 'RC3-HARNESS', eventType: 'START_GAME_NEXT_ROUND_THREW', round: r, message: String(e && e.message || e) }));
    }
  }
}

// ── tolerance(2단계 보고 3/6절 근거) ─────────────────────────────────────────
// countdownStart/choiceStart: runCountdown()의 실제 캡 상수(Math.min(waitMs, 4800)) — 코드 자체가
// "이 앙커는 최대 4.8초까지 어긋나도 설계상 허용한다"고 명시한 값(WRPS-047 주석)에 소폭 여유(200ms,
// 반올림/스케줄링 지터)를 더한다. choiceStart는 countdownStart + 로케일 고정 상수(COUNTDOWN_ANIM_MAX_MS,
// 이 시뮬은 전 기기 'ko' 고정이라 로케일 편차 없음)로 파생되므로 동일 tolerance를 쓴다.
// result/ready: waitForPhaseRender()의 동일 캡(4800) + PHASE_RENDER_BUFFER_MS(900) + 여유(100ms).
// choiceEnd: CEO 기존 게이트는 250ms(RC-1 clock-skew simulator 채택값)이지만, 이 하니스의 choiceEnd
// 관측 방법 자체가 REAL beginRoundTimer()가 등록하는 "1초 tick"에 편승해 state.remainingSeconds가
// 처음 0 이하가 되는 tick 시각을 잡는 방식이라(계측이 index.html 내부 표시 로직과 동일한 해상도로
// 동작해야 mutation 시나리오­ — computeChoiceRemainingSeconds가 앵커를 무시하는 경우 — 에서도
// 유효하다, 위 rc3-harness-support.mjs setInterval 훅 주석 참고) 관측 자체에 최대 1000ms의 정량화
// 잡음이 실린다(진짜 tick이 어디서 왔든 "다음 tick이 돌 때까지"는 관측되지 않음). 그래서 CEO
// 게이트(250ms)에 이 하니스 고유의 관측 해상도(1000ms)를 더한 1250ms를 "이 하니스로 측정 가능한
// choiceEnd tolerance"로 쓴다 — 진짜 알고리즘 오차 상한이 250ms→1250ms로 완화된 것이 아니라,
// 이 프록시 측정 방법의 해상도 한계를 정직하게 반영한 것이다(§6/§7에서 재차 명시).
//
// RC-3 Phase2(codex-critic C) 이후 이 tolerance는 두 가지 서로 다른 계산에 재사용된다(값 자체는
// 변경 없음 — 위 근거가 여전히 유효하기 때문):
//   (1) FULL_COHORT_TIMING_SPREAD: 참여 전원(늦게 도착한 참가자 포함) 기준 — 정보용, HARD FAILURE
//       아님. 위 근거(runCountdown 캡+버퍼)는 원래 "설계가 몇 초까지 허용하는가"를 뜻했으므로,
//       이 값을 늦게 도착한 기기까지 포함한 전체 격차에 적용하면 "설계상 허용된 지연"과
//       "진짜 결함"이 뒤섞인다 — 그래서 이 채널은 성공률 게이트에서 빠졌다(아래 (2) 참고).
//   (2) ON_TIME_CONCURRENCY_EXCEEDED: REAL lateRenderMs(위 LATE_RENDER_THRESHOLD_MS)로 "제때
//       받았다"고 판정된 기기끼리만의 격차 — 이 근거(캡+버퍼)가 원래 의도한 대상과 정확히
//       일치한다(같은 앙커를 정상적으로 받은 기기들이 실제로 그 캡 안에서 동시에 렌더하는가).
export const PHASE_TOLERANCE_MS = {
  countdownStart: 5000,
  choiceStart: 5000,
  choiceEnd: 1250,
  result: 5800,
  ready: 5800,
};

export const DEFAULT_TARGET_ROUNDS = 5;

// ── clock-sync settle 예산: REAL 계약에서 유도 ────────────────────────────────
// codex-critic CRITICAL-1(P1 독립검증): 이 예산은 원래 `const clockSyncBudgetMs = 8000;`이라는
// 하드코딩 매직넘버였고, REAL에는 대응하는 데드라인이 아예 없다. 그 결과 Extreme profile에서
// "REAL이라면 그냥 (느리게) 성공했을" 트라이얼이 CLOCK_SYNC_NOT_SETTLED(EG_HARD_FAILURE_TYPES)로
// 실패 처리돼 correctness 게이트를 단독으로 막았다(실측 재현: 3 profile × N=3..20 × 20 trial =
// profile당 360 trial에서 Normal 0/360, Degraded 0/360, Extreme 9/360 — 순수 하니스 아티팩트).
//
// REAL 계약(index.html:4461-4542 syncServerClock)에서 그대로 유도한다:
//   - :4464  for (let i = 0; i < 5; i++)                      → 시도당 샘플 5개
//   - :4470  withTimeout(db.rpc("server_now"), 4000, ...)     → 샘플당 상한 4000ms
//   - :4528-4532 !samples.length && retry → await sleep(1500); await syncServerClock(false)
//                                                             → 전량 실패 시 1500ms 후 재시도 1회
//   - 재시도(retry=false)는 다시 재귀하지 않으므로 총 시도는 2회(:4534 주석 "총 최대 10회 RPC 시도")
// 따라서 "최초 1회 clock sync가 REAL에서 소요할 수 있는 최악 시간"은 아래 산식으로 닫힌다.
export const REAL_CLOCK_SYNC_SAMPLE_TIMEOUT_MS = 4000;   // index.html:4470
export const REAL_CLOCK_SYNC_SAMPLES_PER_ATTEMPT = 5;    // index.html:4464
export const REAL_CLOCK_SYNC_RETRY_SLEEP_MS = 1500;      // index.html:4530
export const REAL_CLOCK_SYNC_ATTEMPTS = 2;               // 최초 1회 + :4531 syncServerClock(false) 1회
export const REAL_CLOCK_SYNC_WORST_CASE_MS =
  REAL_CLOCK_SYNC_ATTEMPTS * REAL_CLOCK_SYNC_SAMPLES_PER_ATTEMPT * REAL_CLOCK_SYNC_SAMPLE_TIMEOUT_MS
  + REAL_CLOCK_SYNC_RETRY_SLEEP_MS; // = 41500ms
// 관측 슬랙: 이 하니스는 stepMs(기본 250ms) 단위로만 시간을 전진시키고 settle 판정도 그 경계에서만
// 하므로 최악값에 딱 맞추면 양자화 경계에서 오탐이 난다. 5 stepMs 상당(1250ms) + 타이머 스케줄링
// 여유를 합쳐 3500ms를 더한다(= 45000ms). 이 숫자는 "느슨하게 잡은 관용치"가 아니라 REAL 상한 위의
// 관측 여유이며, 예산 초과는 여전히 CLOCK_SYNC_NOT_SETTLED 하드실패로 기록된다(무한 대기 안전망
// 유지 — 아래 runMeasuredTrial/runEliminationTrial 사용처 주석 참고).
export const CLOCK_SYNC_OBSERVATION_SLACK_MS = 3500;
export const CLOCK_SYNC_SETTLE_BUDGET_MS = REAL_CLOCK_SYNC_WORST_CASE_MS + CLOCK_SYNC_OBSERVATION_SLACK_MS;

// ── 트라이얼 1회 실행 + 측정(성공률 집계의 단일 진입점) ───────────────────────
export async function runMeasuredTrial({
  participantCount, seed, targetRounds = DEFAULT_TARGET_ROUNDS, targetLoserCount,
  resolveElimination, judgePure, computePlayerStatuses, PLAYER_STATUS, maxLoserCountFor,
  stepMs = 250, budgetMsPerRound = 40000, choiceBase = 'scissors', vi, combinedSourceOverride = null,
  realtimeDelayRegime = 'pessimistic', deliveryOrderMode = 'monotonic', skewMsOverrideFn = null,
  clockRttOverrideFn = null,
  // §STOP-SHIP Phase0: 2.6초 REST 폴링 채널(위 startDevicePolling). 기본값(false)은 회귀 없음.
  pollingEnabled = false, pollIntervalMs = 2600,
  // H-1: 기본값(null/true)은 기존 측정치와 동일 경로 — §createDb/§makeFinishRoundLocalSubstitute.
  dbErrorInjectionFn = null, idempotencyCacheEnabled = true,
}) {
  const world = createTrialWorld({
    participantCount, seed, targetLoserCount: targetLoserCount ?? Math.max(1, Math.floor(participantCount / 2)),
    resolveElimination, judgePure, computePlayerStatuses, PLAYER_STATUS, maxLoserCountFor, combinedSourceOverride,
    realtimeDelayRegime, deliveryOrderMode, skewMsOverrideFn, clockRttOverrideFn, pollingEnabled, pollIntervalMs,
    dbErrorInjectionFn, idempotencyCacheEnabled,
  });
  const host = world.devices[0];
  const realRandom = Math.random;
  // choiceBase='scissors'는 Math.random()===0일 때 randomRoundChoice()가 고르는 값과 일치해야
  // autoFillChoices()의 안전망 자동선택까지도 allDraw 불변식을 지킨다(randomRoundChoice가
  // ["scissors","rock","paper"][Math.floor(Math.random()*3)]이므로 0→"scissors").
  Math.random = () => 0;
  let elapsed = 0;
  const budget = budgetMsPerRound * targetRounds;
  try {
    // 접합부 ⓪ 대기: 전원 syncServerClock()이 settle될 때까지 시간을 흘려보낸다 — 이래야
    // serverNow()가 실제로 skew를 보정한 뒤 라운드1이 시작된다(위 createTrialWorld 주석 참고).
    // ⚠️ 용어 정정(codex-critic P1 독립검증): 여기서 "settle"의 실제 술어는
    // getServerClockSynced()(= index.html serverClockSynced, "유효 샘플을 하나라도 얻어 offset을
    // 갱신했다")이므로 "성공/실패 무관, 시도 완료"가 아니라 엄밀히 "동기화 성공"이다. 이 하니스의
    // 가짜 rpc('server_now')는 항상 성공 resolve하므로(§createDb rpc) 현재는 두 정의가 일치하지만,
    // 향후 RPC 실패를 주입하면 갈라진다 — 그때는 REAL 재시도 경로(sleep 1500 + 5샘플)까지
    // 소요되며, 아래 예산은 그 최악값까지 이미 포괄한다.
    // 예산 안에서 settle 안 되면 CLOCK_SYNC_NOT_SETTLED를 기록하고 그냥 진행한다.
    // codex-critic CRITICAL-1: 예산은 REAL syncServerClock 계약에서 유도한다(위
    // CLOCK_SYNC_SETTLE_BUDGET_MS 주석 — 8000ms 매직넘버는 REAL에 없는 데드라인이었다).
    // ⚠️ STALL 안전망 관점: 이 루프는 settle되는 즉시 빠져나오므로 정상 경로의 소요시간은 변하지
    // 않고, 예산을 다 쓰는 경우에도 그 시간은 아래 메인 루프와 공유하는 `elapsed`에 누적되며
    // (budget = budgetMsPerRound × targetRounds = 40000×5 = 200000ms) 초과 시 여전히
    // CLOCK_SYNC_NOT_SETTLED 하드실패로 기록된다 — 즉 "clock이 영원히 안 맞는" 무한 대기는
    // 45000ms 시점에 확정 검출되고, 그 이후의 진짜 진행 불가는 trial 총예산이 STALL로 잡는다.
    const clockSyncBudgetMs = CLOCK_SYNC_SETTLE_BUDGET_MS;
    let clockSyncElapsed = 0;
    let clockSyncSettled = false;
    while (clockSyncElapsed < clockSyncBudgetMs && !clockSyncSettled) {
      // eslint-disable-next-line no-await-in-loop
      await vi.advanceTimersByTimeAsync(stepMs);
      clockSyncElapsed += stepMs;
      elapsed += stepMs;
      clockSyncSettled = world.devices.every((d) => d.impl.getServerClockSynced());
    }
    world.__clockSyncSettled = clockSyncSettled;
    while (elapsed < budget) {
      tickTrialWorld(world, host, targetRounds);
      if (allDevicesRenderedResultFor(world, targetRounds)) break;
      // eslint-disable-next-line no-await-in-loop
      await vi.advanceTimersByTimeAsync(stepMs);
      elapsed += stepMs;
    }
  } finally {
    Math.random = realRandom;
    // §STOP-SHIP Phase0: 트라이얼 종료 시 폴링 타이머를 반드시 정리한다 — 정리하지 않으면 같은
    // vi.useFakeTimers() 세션 안에서 반복 호출되는(§헤드라인 스윕 수백~수천 trial) 다음 트라이얼들
    // 동안에도 이전 트라이얼의 poll setInterval이 계속 살아남아 무한히 누적된다(REAL 앱은
    // destroyRoomAndGoHome()류에서 clearInterval하지만, 이 하니스는 그 이탈 경로를 추출하지
    // 않았으므로 트라이얼 드라이버가 대신 정리해야 한다 — 판정 로직과 무관한 하니스 자원 정리).
    for (const d of world.devices) { try { d.stopPolling && d.stopPolling(); } catch (e) {} }
  }

  const completed = allDevicesRenderedResultFor(world, targetRounds);
  const failureModes = [];

  if (!completed) {
    failureModes.push({ type: 'STALL', detail: world.devices.map((d) => `${d.id}:${d.impl.state.status}/${d.impl.state.round}`).join(' ') });
  }
  if (!world.__clockSyncSettled) {
    failureModes.push({ type: 'CLOCK_SYNC_NOT_SETTLED' });
  }

  // 에러 텔레메트리(핸들러 예외/불의의 throw) 수집 + STALE_ROW_REGRESSION([범주1] correctness)
  // 자동 반영 — 정상 스윕(§3/§4)에서는 gameRound가 애초에 바뀌지 않아 사실상 0건이어야 하지만,
  // 이 스캔 자체는 어떤 트라이얼에서도 동작하는 일반 게이트다(전용 시나리오 밖에서도 회귀 없음을
  // 증명하는 역할).
  for (const d of world.devices) {
    for (const e of d.telemetry.events) {
      if (typeof e.eventType === 'string' && e.eventType.endsWith('_THREW')) {
        failureModes.push({ type: 'EXCEPTION', device: d.id, detail: e.eventType + ': ' + e.message });
      }
      if (e.eventType === 'STALE_ROW_REGRESSION') {
        failureModes.push({ type: 'STALE_ROW_REGRESSION', device: d.id, detail: e.detail });
      }
    }
  }

  // phase별 최대 격차(라운드마다) — 완료된 라운드만 계산(완료 못한 라운드는 STALL로 이미 기록됨).
  //
  // [범주2] network-stress quality(informational, HARD FAILURE 아님, correctnessPassRate 감점
  // 없음): 이 하니스는 설계가 의도적으로 허용하는 "늦게 받은 참가자의 graceful late-render"를
  // 실결함과 섞지 않는다. 아래 두 갈래 모두 이제 정보용이다(v3에서는 (2)가 HARD였으나 baseline
  // 실집행으로 과민임이 확인돼 강등됨, §본문 taxonomy 수렴 참고).
  //   (1) FULL_COHORT_TIMING_SPREAD: 참여 전원 기준 최대격차 — 늦게 도착한 참가자까지 포함하므로
  //       tolerance 초과가 "설계상 허용된 late-render"때문인지 "진짜 스케줄링 결함"때문인지 이
  //       값만으로는 구분되지 않는다. mutation 테스트가 실제 스케줄링 결함을 여전히 검출할 수
  //       있도록(§범주3 참고) 보존한다.
  //   (2) ON_TIME_CONCURRENCY_EXCEEDED: "수신 기준" 코호트(위 isPhaseReceivedBeforeAnchor — 앵커
  //       이전에 수신했는가, 렌더 지각도 아님)끼리만 최대 격차를 계산해
  //       ON_TIME_CONCURRENCY_CEILING_MS(clock-sync 잔차 기반)와 비교한다. 이 코호트 재정의로
  //       membership 자체는 더 이상 렌더 스프레드를 구조적으로 제한하지 않지만, 이 하니스의 균등
  //       지연 주입 구조상 사실상 트립되지 않는다(위 HARD_FAILURE_TYPES 앞 문서 참고). late-render
  //       집계(정보용, LATE_RENDER_THRESHOLD_MS 기반)는 기존 그대로 별도 보존한다(§유지 항목,
  //       이중 계상 방지 위해 on-time 코호트 판정과 완전히 분리된 카운터로 집계).
  const perRoundMaxDiff = {};
  const onTimeConcurrency = {};
  const lateRenderTally = { total: 0, late: 0 };
  const roundsToCheck = completed ? targetRounds : Math.max(0, ...world.devices.flatMap((d) =>
    d.telemetry.events.filter((e) => e.eventType === 'SYNC_RENDER' && e.phase === 'result').map((e) => e.round)));
  const diff = (arr) => (arr.length ? Math.max(...arr) - Math.min(...arr) : null);
  for (let r = 1; r <= roundsToCheck; r++) {
    const countdownTs = world.devices.map((d) => getPhaseTrueTs(d, 'countdown', r)).filter((v) => v != null);
    const resultTs = world.devices.map((d) => getPhaseTrueTs(d, 'result', r)).filter((v) => v != null);
    const readyTs = world.devices.map((d) => getPhaseTrueTs(d, 'nextRound', r)).filter((v) => v != null);
    const choiceStartTs = world.devices.map((d) => d.rendered.choiceStartByRound[r] && d.rendered.choiceStartByRound[r].ts).filter((v) => v != null);
    const choiceEndTs = world.devices.map((d) => d.rendered.choiceEndByRound[r] && d.rendered.choiceEndByRound[r].ts).filter((v) => v != null);
    const countdownCoverage = countdownTs.length;
    const resultCoverage = resultTs.length;
    perRoundMaxDiff[r] = {
      countdownStart: diff(countdownTs), countdownCoverage,
      choiceStart: diff(choiceStartTs), choiceStartCoverage: choiceStartTs.length,
      choiceEnd: diff(choiceEndTs), choiceEndCoverage: choiceEndTs.length,
      result: diff(resultTs), resultCoverage,
      // ── codex-critic MEDIUM-3: ready(nextRound) 인덱싱 정정 ────────────────────
      // nextRound SYNC_RENDER의 round 필드는 "떠나는 라운드"가 아니라 "새로 진입하는 라운드"다:
      //   index.html:9802  host write `{ round: state.round + 1, status: 'ready', penalty }`
      //   index.html:5832  handleRoomUpdate가 `state.round = room.round`를 먼저 반영하고
      //   index.html:6017  그 뒤에 waitForPhaseRender("nextRound", readyScheduledAt, ...)를 호출
      //   index.html:5283  waitForPhaseRender 내부 `const round = state.round || 1`이 그 값을 기록
      // 따라서 r=1에는 nextRound 이벤트가 아예 없고(자연히 빈 배열 → diff=null), "마지막 라운드로
      // 진입하는 ready"(r === targetRounds)는 반드시 존재한다. 종전 `(r < targetRounds) ? ... : null`
      // 가드는 "round = 떠나는 라운드"라는 틀린 전제에서만 정당했고, 실제로는 매 trial마다 마지막
      // 라운드 진입 ready 측정을 통째로 버리고 있었다(측정 누락 = false negative).
      // tests/ceo-official-measurement.test.mjs §M-1이 이미 같은 정정을 했고, 이제 두 측정 경로가
      // 같은 인덱싱 전제를 공유한다.
      ready: diff(readyTs),
      readyCoverage: readyTs.length,
    };
    if (countdownCoverage < participantCount) failureModes.push({ type: 'MISSING_COUNTDOWN_RENDER', round: r, coverage: countdownCoverage, of: participantCount });
    if (resultCoverage < participantCount) failureModes.push({ type: 'MISSING_RESULT_RENDER', round: r, coverage: resultCoverage, of: participantCount });
    for (const phase of ['countdownStart', 'choiceStart', 'choiceEnd', 'result', 'ready']) {
      const spread = perRoundMaxDiff[r][phase];
      if (spread != null && spread > PHASE_TOLERANCE_MS[phase]) {
        failureModes.push({ type: 'FULL_COHORT_TIMING_SPREAD', phase, round: r, diffMs: Math.round(spread) });
      }
    }

    // late-render 집계(정보용, REAL lateRenderMs 기반 — 기존 그대로, §유지 항목). countdown/
    // result/ready 3개 phase만 REAL 계측이 있다(위 getPhaseLateRenderMs 주석) — choiceStart/
    // choiceEnd는 countdown의 late 여부를 상속하되 별도 SYNC_RENDER가 없으므로 이 집계 모수에는
    // 넣지 않는다(이중 계상 방지).
    // codex-critic MEDIUM-3: 여기서도 `r >= targetRounds` 스킵을 제거한다(위 ready 인덱싱 정정과
    // 동일 근거). r=1은 nextRound 이벤트 자체가 없어 getPhaseLateRenderMs가 null을 돌려주므로
    // 별도 가드가 필요 없고, 마지막 라운드 진입 ready의 late-render는 실제로 존재하는 측정이다.
    for (const phase of ['countdown', 'result', 'nextRound']) {
      for (const d of world.devices) {
        const lateMs = getPhaseLateRenderMs(d, phase, r);
        if (lateMs == null) continue; // 렌더 자체가 없음 — MISSING_*_RENDER가 이미 별도로 잡음
        lateRenderTally.total += 1;
        if (lateMs > LATE_RENDER_THRESHOLD_MS) lateRenderTally.late += 1;
      }
    }

    // on-time(수신 기준) 코호트 격차 + late(앵커 이후 수신) 코호트 과지각 집계 — 둘 다 [범주2]
    // network-stress quality(informational, HARD FAILURE 아님, §본문 taxonomy 수렴 참고). 5개
    // phase 모두 다룬다 — choiceStart/choiceEnd는 countdown의 수신-기준 판정을 상속(근사, §7
    // 한계 명시)한다.
    // codex-critic MEDIUM-3: `phase === 'ready' && r >= targetRounds` 스킵 제거(위와 동일 근거 —
    // "ready는 마지막 라운드엔 없다"는 종전 주석 자체가 틀린 인덱싱 전제였다. 마지막 라운드로
    // 진입하는 ready는 존재하고, 없는 쪽은 r=1이며 그건 isPhaseReceivedBeforeAnchor가 null을
    // 돌려줘 자연히 코호트가 비므로 별도 가드가 필요 없다).
    for (const phase of ['countdownStart', 'result', 'ready', 'choiceStart', 'choiceEnd']) {
      const measurePhase = phase === 'countdownStart' ? 'countdown' : (phase === 'ready' ? 'nextRound' : phase);
      const onTimeTrue = [];
      const lateReceived = [];
      for (const d of world.devices) {
        const receivedOnTime = isPhaseReceivedBeforeAnchor(d, measurePhase, r);
        if (receivedOnTime == null) continue; // 수신/렌더 계측 자체가 없음 — MISSING_*_RENDER가 별도 처리
        const trueTs = (measurePhase === 'choiceStart') ? (d.rendered.choiceStartByRound[r] && d.rendered.choiceStartByRound[r].ts)
          : (measurePhase === 'choiceEnd') ? (d.rendered.choiceEndByRound[r] && d.rendered.choiceEndByRound[r].ts)
          : getPhaseTrueTs(d, measurePhase, r);
        if (trueTs == null) continue;
        if (receivedOnTime) onTimeTrue.push(trueTs);
        else lateReceived.push({ device: d, trueTs });
      }
      const onTimeDiff = diff(onTimeTrue);
      const totalMeasured = onTimeTrue.length + lateReceived.length;
      const onTimeReceiptRatio = totalMeasured > 0 ? onTimeTrue.length / totalMeasured : null;
      onTimeConcurrency[`${phase}:${r}`] = { onTimeCount: onTimeTrue.length, diffMs: onTimeDiff, totalMeasured, onTimeReceiptRatio };
      if (onTimeTrue.length >= 2 && onTimeDiff != null && onTimeDiff > ON_TIME_CONCURRENCY_CEILING_MS) {
        failureModes.push({ type: 'ON_TIME_CONCURRENCY_EXCEEDED', phase, round: r, diffMs: Math.round(onTimeDiff), onTimeCount: onTimeTrue.length });
      }
      // on-time "수신율" 붕괴(informational, HARD 아님) — on-time 코호트 스프레드 지표는 코호트
      // 구성원이 2명 미만이면 애초에 계산 자체가 스킵돼(위 `onTimeTrue.length >= 2` 가드) 조용히
      // 통과한다. lead를 3600ms→100ms로 줄이면 "거의 아무도" 앵커 이전에 수신하지 못해(실측: N=10
      // baseline 평균 9.7/10명 on-time → broken 평균 0.2/10명, §범주3 mutation B 참고) on-time
      // 코호트 자체가 사실상 사라지고, 스프레드 지표는 "구성원 부족"으로 침묵한다 — 그래서 "이
      // phase를 measure할 수 있었던 기기 중 몇 %가 실제로 앵커 이전에 수신했는가" 자체를 별도
      // 채널로 집계한다(리포팅 전용 — HARD_FAILURE_TYPES에는 없음). MIN_ON_TIME_RECEIPT_RATIO(0.5)는
      // 위 실측 격차(0.97 vs 0.02)에서 넉넉한 여유를 두고 잡은 값이다(근거 강도: 중간 — 정상 네트워크
      // 조건에서 "과반 미만"이 on-time으로 수신되는 것 자체가 이미 설계 의도(대부분 lead 안에
      // 들어오게 함)와 어긋난다는 정성적 판단).
      if (totalMeasured >= 2 && onTimeReceiptRatio != null && onTimeReceiptRatio < MIN_ON_TIME_RECEIPT_RATIO) {
        failureModes.push({ type: 'ON_TIME_RECEIPT_COLLAPSED', phase, round: r, onTimeCount: onTimeTrue.length, totalMeasured, ratio: Number(onTimeReceiptRatio.toFixed(3)) });
      }
      // late(앵커 이후 수신) 코호트의 과도지각(informational, HARD 아님) — graceful late-render
      // (설계상 정상)와 "앵커 보정이 아예 무력화돼 무한정 벌어지는 것으로 보이는 스프레드"를 가르는
      // 선(리포팅 전용). 기준점은 가능하면 이 라운드의 on-time 코호트 클러스터(min(onTimeTrue) —
      // "정상적으로 동기화된 기기들이 실제로 렌더한 가장 이른 시각", 즉 이 phase가 "실제로 일어난"
      // 순간의 하한 근사)로 삼는다 — choiceStart/choiceEnd는 countdown 앵커와 다른 offset(로케일
      // 고정 애니메이션/5초 카운트다운)을 가지므로 countdown의 원시 anchorServerTs를 그대로 기준으로
      // 쓰면 상시 수천ms 오프셋이 끼어 오탐/누락이 생긴다(on-time 클러스터 기준으로 교체해 5개
      // phase 전부 동일한 방식으로 다룰 수 있다). on-time 코호트가 아예 없으면(이 라운드 전원이
      // late) countdown/result/ready처럼 REAL 앵커가 그 phase 자체의 것인 경우에만 anchorServerTs로
      // 폴백하고, choiceStart/choiceEnd는 기준점이 없으므로 스킵한다(§7 한계).
      const referenceTs = onTimeTrue.length ? Math.min(...onTimeTrue) : null;
      for (const { device: d, trueTs } of lateReceived) {
        let ref = referenceTs;
        if (ref == null && (measurePhase === 'countdown' || measurePhase === 'result' || measurePhase === 'nextRound')) {
          ref = getPhaseAnchorServerTs(d, measurePhase, r);
        }
        if (ref == null) continue;
        const delayMs = trueTs - ref;
        const excessiveThresholdMs = getLateCohortExcessiveDelayThresholdMs(phase);
        if (excessiveThresholdMs != null && delayMs > excessiveThresholdMs) {
          failureModes.push({ type: 'LATE_COHORT_EXCESSIVE_DELAY', phase, round: r, device: d.id, delayMs: Math.round(delayMs), thresholdMs: excessiveThresholdMs });
        }
      }
    }
  }

  // 팬텀 결과(모든 참가자가 'scissors'를 냈으므로 항상 allDraw여야 함 — 그 외 값은 판정 입력 오염
  // 신호, 예: 동시 handleRoomUpdate 인터리빙으로 다음 라운드가 참가자 choice를 이미 리셋한 뒤
  // 판정이 이뤄진 경우). 텔레메트리(append-only)를 스캔한다 — d.rendered.resultByRound는 그
  // 인터리빙 자체 때문에 키가 잘못 붙을 수 있어(§4) 권위 있는 소스가 아니다.
  const outcomeCounts = {};
  for (const d of world.devices) {
    for (const e of d.telemetry.events) {
      if (e.eventType === 'FINISH_ROUND_SUBSTITUTE') {
        outcomeCounts[e.outcome] = (outcomeCounts[e.outcome] || 0) + 1;
        if (e.outcome !== 'allDraw') {
          failureModes.push({ type: 'PHANTOM_OR_CORRUPTED_OUTCOME', device: d.id, round: e.round, outcome: e.outcome });
        }
      }
    }
  }

  // 라운드 단조 증가 확인(각 device의 round 값 이력) + 이중 카운트다운(같은 라운드에 REAL
  // SYNC_RENDER countdown이 2회 이상 — SYNC_RENDER_DUPLICATE_SKIPPED로 걸러지지 않은 진짜 중복).
  for (const d of world.devices) {
    const countdownEvents = d.telemetry.events.filter((e) => e.eventType === 'SYNC_RENDER' && e.phase === 'countdown');
    const seq = countdownEvents.map((e) => e.round);
    for (let i = 1; i < seq.length; i++) {
      if (seq[i] <= seq[i - 1]) failureModes.push({ type: 'ROUND_NOT_MONOTONIC', device: d.id, seq });
    }
    const byRound = {};
    for (const e of countdownEvents) { byRound[e.round] = (byRound[e.round] || 0) + 1; }
    for (const [round, count] of Object.entries(byRound)) {
      if (count > 1) failureModes.push({ type: 'DOUBLE_COUNTDOWN_RENDER', device: d.id, round: Number(round), count });
    }
  }

  const hardFailureModes = failureModes.filter((f) => HARD_FAILURE_TYPES.includes(f.type));
  const onTimeConcurrencyViolations = failureModes.filter((f) => f.type === 'ON_TIME_CONCURRENCY_EXCEEDED');
  const onTimeReceiptCollapsedViolations = failureModes.filter((f) => f.type === 'ON_TIME_RECEIPT_COLLAPSED');
  const lateCohortExcessiveDelays = failureModes.filter((f) => f.type === 'LATE_COHORT_EXCESSIVE_DELAY');
  const fullCohortTimingSpreadViolations = failureModes.filter((f) => f.type === 'FULL_COHORT_TIMING_SPREAD');
  const networkStressQualityFailures = failureModes.filter((f) => NETWORK_STRESS_QUALITY_TYPES.includes(f.type));
  const lateRenderRatio = lateRenderTally.total > 0 ? lateRenderTally.late / lateRenderTally.total : null;
  const correctnessPass = completed && hardFailureModes.length === 0;

  return {
    participantCount, seed, realtimeDelayRegime, completed, elapsed, perRoundMaxDiff, outcomeCounts,
    onTimeConcurrency, lateRenderStats: { ...lateRenderTally, ratio: lateRenderRatio },
    failureModes, hardFailureModes,
    onTimeConcurrencyViolations, onTimeConcurrencyPass: onTimeConcurrencyViolations.length === 0,
    onTimeReceiptCollapsedViolations, lateCohortExcessiveDelays, fullCohortTimingSpreadViolations,
    // [범주2] network-stress quality(informational) 채널 전부를 모은 편의 필드 — 리포팅/테스트에서
    // "이 trial이 네트워크 스트레스 신호를 냈는가"를 correctness와 분리해서 보고 싶을 때 쓴다.
    // 이 필드가 비어있지 않아도 correctnessPass/pass에는 전혀 영향을 주지 않는다.
    networkStressQualityFailures,
    // 최종 수렴(Review Correction Loop 3/3): trial의 STOP-SHIP 합격 여부는 [범주1](지연 독립
    // correctness) HARD FAILURE가 0건이고 5라운드가 정상 완주됐는가로만 정의한다 —
    // HARD_FAILURE_TYPES가 이번 라운드부터 [범주1]만 담고 있으므로 hardFailureModes는 곧
    // correctness 위반 목록이다. `correctnessPass`가 이 정의를 명시적으로 드러내는 이름이고,
    // `pass`는 하위호환을 위해 동일한 값을 그대로 유지한다(값 동일 — 기존 호출자가 r.pass를 계속
    // 쓸 수 있게). [범주2] network-stress quality(FULL_COHORT_TIMING_SPREAD/
    // ON_TIME_CONCURRENCY_EXCEEDED/ON_TIME_RECEIPT_COLLAPSED/LATE_COHORT_EXCESSIVE_DELAY/
    // lateRenderRatio)는 어느 쪽에도 감점하지 않는다 — 레짐에 따라 달라지는 정보용 지표일 뿐이다.
    correctnessPass,
    pass: correctnessPass,
    world,
  };
}

// ── EG §Phase2 오라클: REAL resolveElimination/judgePure를 그대로 재사용해 "실제로 제출된 선택"
// (roundChoicesByRound, 그라운드 트루스 — 테스트가 직접 기록, 앱과 무관)만으로 라운드별 기대
// outcome/확정집합을 독립 재계산한다. 이건 resolveElimination의 산수를 다시 검증하는 게
// 아니다(engine-parity.test.mjs가 이미 별도로 함) — REAL 파이프라인(handleRoomUpdate가 그 순간
// 읽은 state.participants가 실제로 제출된 값과 일치하는가, hasStoredResults/judgeRound 폴백이
// 올바른 입력을 골랐는가, 라운드 시퀀싱이 실제로 REAL resolveElimination의 nextActiveIds를
// 따라가는가)의 무결성을 검증한다. resolveEliminationOracle/judgePureOracle을 디바이스에 주입되는
// 것과 별도로 받는 이유: EG-Phase0 mutation 민감도 테스트가 디바이스 쪽만 깨고 오라클은 항상
// 정답을 유지해야 "정답 대비 실제 파이프라인이 이탈했다"를 검출할 수 있다.
function computeEliminationOracle({ participantIds, roundChoicesByRound, targetLoserCount, resolveEliminationOracle, judgePureOracle, maxRounds }) {
  let activeIds = [...participantIds];
  let safeIds = [];
  let loserIds = [];
  const perRound = [];
  for (let round = 1; round <= maxRounds; round++) {
    const choices = roundChoicesByRound.get(round);
    if (!choices || activeIds.length === 0) break;
    const missingIds = activeIds.filter((id) => !choices.get(id));
    if (missingIds.length > 0) {
      // 이번 라운드에 activeIds 중 일부가 선택을 제출하지 못함(예: 예산 소진/STALL 도중 종료) —
      // 오라클이 이 이후를 계속 계산할 근거 데이터가 없다. 판정 불가로 표시하고 재계산을 중단한다
      // (오라클 자신의 한계이지 correctness 판정이 아니다 — 상위 호출자가 STALL로 별도 처리).
      perRound.push({ round, oracleIncomplete: true, missingIds });
      break;
    }
    const players = activeIds.map((id) => ({ id, base: choices.get(id) }));
    const judged = judgePureOracle(players);
    const roundResults = activeIds.map((id) => ({ id, result: judged[id] }));
    const res = resolveEliminationOracle({ roundResults, prevLoserIds: loserIds, prevSafeIds: safeIds, targetLoserCount });
    perRound.push({
      round, outcome: res.outcome,
      newConfirmedSafeIds: [...res.newConfirmedSafeIds].sort(),
      newConfirmedLoserIds: [...res.newConfirmedLoserIds].sort(),
      activeIds: [...activeIds],
    });
    safeIds = res.newConfirmedSafeIds;
    loserIds = res.newConfirmedLoserIds;
    activeIds = res.nextActiveIds;
    if (res.outcome === 'gameOver') break;
  }
  return { perRound, finalSafeIds: safeIds, finalLoserIds: loserIds };
}

// EG(Elimination-extended) HARD FAILURE 목록 — 위 [범주1] HARD_FAILURE_TYPES 중 이 트라이얼
// 유형에 유효한 것만 재사용하고(FULL_COHORT_TIMING_SPREAD류 [범주2] network-stress quality는
// 애초에 이 함수가 계산하지 않는다 — §7 한계에 명시), CROSS_DEVICE_OUTCOME_MISMATCH를 새로
// 추가한다(여러 기기가 같은 라운드에 서로 다른 outcome을 계산 — REAL 파이프라인 데스크 자체의
// 새로운 결함 클래스, allDraw baseline에서는 "항상 같은 값"이라 절대 드러날 수 없었던 채널).
// WRPS-079 Round2(STOP-SHIP, HIGH 잔존 수정): READY_BRANCH_STATE_CLOBBER를 추가한다 — 위
// CROSS_DEVICE_OUTCOME_MISMATCH(FINISH_ROUND_SUBSTITUTE.outcome 기기간 비교)는 host가 유일한
// rooms/participants 확정 writer라 host 자신의 stale-generation ready 분기 커밋이 만든 오염을
// 전 기기가 "똑같이 틀리게" 받아버리면 검출하지 못한다(§STOP-SHIP 지적, 근본적으로 다른 결함
// 클래스) — beginReadyBranchClobberCheck/finishReadyBranchClobberCheck(위 참고)가 게이트 로직
// 자체에 기대지 않고 독립적으로 검출한다.
export const EG_HARD_FAILURE_TYPES = [
  'STALL', 'EXCEPTION', 'CLOCK_SYNC_NOT_SETTLED', 'PHANTOM_OR_CORRUPTED_OUTCOME',
  'ROUND_NOT_MONOTONIC', 'DOUBLE_COUNTDOWN_RENDER', 'STALE_ROW_REGRESSION',
  'CROSS_DEVICE_OUTCOME_MISMATCH', 'READY_BRANCH_STATE_CLOBBER',
];

export const DEFAULT_EG_TARGET_LOSER_COUNT = 1;

// ── EG 트라이얼 1회 실행 + 측정 ───────────────────────────────────────────────
// runMeasuredTrial과 동일한 REAL 파이프라인/글루를 재사용하되(중복 구현 없음), 종료 조건이
// "고정 라운드 수 완주"가 아니라 "REAL gameOver 도달"이고, choiceDriverFn으로 실제 승/패를
// 발생시켜 tooMany/tooFew/gameOver 분기까지 실집행으로 트리거한다.
export async function runEliminationTrial({
  participantCount, seed, targetLoserCount = DEFAULT_EG_TARGET_LOSER_COUNT,
  resolveElimination, judgePure, computePlayerStatuses, PLAYER_STATUS, maxLoserCountFor,
  resolveEliminationOracle = null, judgePureOracle = null,
  stepMs = 250, budgetMsPerRound = 20000, maxRounds = null, vi,
  combinedSourceOverride = null, realtimeDelayRegime = 'pessimistic',
  choiceSeed = null, choiceDriverFactory = null,
  deliveryOrderMode = 'monotonic', skewMsOverrideFn = null, clockRttOverrideFn = null,
  // §STOP-SHIP Phase0: 2.6초 REST 폴링 채널(위 startDevicePolling). 기본값(false)은 회귀 없음.
  pollingEnabled = false, pollIntervalMs = 2600,
  // H-1: 기본값(null/true)은 기존 측정치와 동일 경로 — §createDb/§makeFinishRoundLocalSubstitute.
  dbErrorInjectionFn = null, idempotencyCacheEnabled = true,
}) {
  // N이 클수록 "전원이 3가지 타입을 모두 낼" 확률이 급격히 올라가 allDraw가 자주 나온다(judgePure의
  // "selectedTypes.length===3이면 draw" 규칙 — 참가자가 많을수록 3종류가 다 나올 확률이 높아짐).
  // 그래서 결정적(승/패 발생) 라운드 자체가 드물어져 큰 N일수록 gameOver까지 훨씬 더 많은 라운드가
  // 필요하다(§EG Phase1/2 실측으로 확인, 아래 runEliminationTrial 문서 참고) — maxRounds를 N에
  // 비례해 넉넉히(§"STALL 정의는 엄격·관대하게" 원칙) 늘려야 진짜 STALL과 "그냥 아직 안 끝남"을
  // 혼동하지 않는다.
  const resolvedMaxRounds = maxRounds ?? Math.max(30, participantCount * 6);
  const resolvedChoiceSeed = choiceSeed ?? (seed * 2654435761 + 0x9E3779B9);
  // §STOP-SHIP Part D: choiceDriverFactory가 주어지면(예: createDecisiveChoiceDriver) 그것으로
  // 선택 드라이버를 만든다 — 기본값(null)은 기존 createMixedChoiceDriver(균등 3종 랜덤) 그대로라
  // 회귀 없음(EG §Phase0~WRPS-079 스윕 전부가 이 기본값을 계속 쓴다).
  const choiceDriverFn = (choiceDriverFactory || createMixedChoiceDriver)(resolvedChoiceSeed);
  const world = createTrialWorld({
    participantCount, seed, targetLoserCount,
    resolveElimination, judgePure, computePlayerStatuses, PLAYER_STATUS, maxLoserCountFor,
    combinedSourceOverride, realtimeDelayRegime, choiceDriverFn, deliveryOrderMode, skewMsOverrideFn,
    clockRttOverrideFn, pollingEnabled, pollIntervalMs, dbErrorInjectionFn, idempotencyCacheEnabled,
  });
  const host = world.devices[0];
  const realRandom = Math.random;
  // allDraw baseline과 동일 정책(§runMeasuredTrial 주석 참고): autoFillChoices()의 안전망까지
  // 결정론화한다. 이 스트림은 실제 라운드 선택(choiceDriverFn, 독립 rng)과는 무관하다 — 안전망이
  // 실제로 발동하면(제출이 창 안에 못 끝난 경우) randomRoundChoice()가 항상 "scissors"를 골라
  // 오라클의 ground-truth(roundChoicesByRound, choiceDriverFn이 명시적으로 제출한 값)와 어긋날 수
  // 있다 — 이 경우 그 참가자는 missingIds로 잡혀 오라클이 그 라운드부터 계산을 멈춘다(§7 한계로
  // 명시, 안전망 발동 자체가 드물다는 것은 allDraw baseline 4860 trial에서 이미 확인됨).
  Math.random = () => 0;
  let elapsed = 0;
  const budget = budgetMsPerRound * resolvedMaxRounds;
  try {
    // codex-critic CRITICAL-1: §runMeasuredTrial과 동일 — 예산은 REAL syncServerClock 계약에서
    // 유도한다(위 CLOCK_SYNC_SETTLE_BUDGET_MS 주석). 이 경로가 CEO 3-profile 매트릭스가 쓰는
    // 경로이고, 8000ms 매직넘버 때문에 Extreme 9/360이 CLOCK_SYNC_NOT_SETTLED로 오분류돼 출시
    // 게이트를 단독 차단하고 있었다.
    // ⚠️ STALL 안전망: settle 즉시 탈출이므로 정상 경로 소요시간 불변, 예산 초과는 여전히
    // CLOCK_SYNC_NOT_SETTLED 하드실패이고 남은 시간은 trial 총예산
    // (budgetMsPerRound × resolvedMaxRounds = 20000 × max(30, N×6) ≥ 600000ms)이 STALL로 잡는다.
    const clockSyncBudgetMs = CLOCK_SYNC_SETTLE_BUDGET_MS;
    let clockSyncElapsed = 0;
    let clockSyncSettled = false;
    while (clockSyncElapsed < clockSyncBudgetMs && !clockSyncSettled) {
      // eslint-disable-next-line no-await-in-loop
      await vi.advanceTimersByTimeAsync(stepMs);
      clockSyncElapsed += stepMs;
      elapsed += stepMs;
      clockSyncSettled = world.devices.every((d) => d.impl.getServerClockSynced());
    }
    world.__clockSyncSettled = clockSyncSettled;
    while (elapsed < budget) {
      tickTrialWorld(world, host, resolvedMaxRounds);
      if (isGameOverSettled(world)) break;
      // eslint-disable-next-line no-await-in-loop
      await vi.advanceTimersByTimeAsync(stepMs);
      elapsed += stepMs;
    }
  } finally {
    Math.random = realRandom;
    // §STOP-SHIP Phase0: 위 runMeasuredTrial과 동일한 이유로 트라이얼 종료 시 폴링 타이머를 정리한다.
    for (const d of world.devices) { try { d.stopPolling && d.stopPolling(); } catch (e) {} }
  }

  const completed = isGameOverSettled(world);
  const failureModes = [];
  if (!completed) {
    failureModes.push({ type: 'STALL', detail: world.devices.map((d) => `${d.id}:${d.impl.state.status}/${d.impl.state.round}`).join(' ') });
  }
  if (!world.__clockSyncSettled) {
    failureModes.push({ type: 'CLOCK_SYNC_NOT_SETTLED' });
  }
  for (const d of world.devices) {
    for (const e of d.telemetry.events) {
      if (typeof e.eventType === 'string' && e.eventType.endsWith('_THREW')) {
        failureModes.push({ type: 'EXCEPTION', device: d.id, detail: e.eventType + ': ' + e.message });
      }
      if (e.eventType === 'STALE_ROW_REGRESSION') {
        failureModes.push({ type: 'STALE_ROW_REGRESSION', device: d.id, detail: e.detail });
      }
      // WRPS-079 Round2(STOP-SHIP, HIGH 잔존 수정): ready 분기 commit 게이트가 실제로 뚫린 경우만
      // (위 finishReadyBranchClobberCheck 참고 — staleGeneration:true인데도 confirmedSafeIds/
      // LoserIds가 실제로 바뀐 경우) 여기서 하드 실패로 집계한다.
      if (e.eventType === 'READY_BRANCH_STATE_CLOBBER') {
        failureModes.push({ type: 'READY_BRANCH_STATE_CLOBBER', device: d.id, detail: e.detail });
      }
    }
  }
  for (const d of world.devices) {
    const countdownEvents = d.telemetry.events.filter((e) => e.kind === 'metric' && e.eventType === 'SYNC_RENDER' && e.phase === 'countdown');
    const seq = countdownEvents.map((e) => e.round);
    for (let i = 1; i < seq.length; i++) {
      if (seq[i] <= seq[i - 1]) failureModes.push({ type: 'ROUND_NOT_MONOTONIC', device: d.id, seq });
    }
    const byRound = {};
    for (const e of countdownEvents) { byRound[e.round] = (byRound[e.round] || 0) + 1; }
    for (const [round, count] of Object.entries(byRound)) {
      if (count > 1) failureModes.push({ type: 'DOUBLE_COUNTDOWN_RENDER', device: d.id, round: Number(round), count });
    }
  }

  // 라운드별로 이 트라이얼에 실제 참여한 모든 기기의 FINISH_ROUND_SUBSTITUTE 이벤트를 모은다
  // (host만이 아니라 참가자 기기도 포함 — 이게 CROSS_DEVICE_OUTCOME_MISMATCH 검출의 핵심: 실제
  // 앱에서도 각 기기가 로컬로 이 판정을 각자 실행하므로, 같은 라운드에 대해 서로 다른 결론에
  // 도달하면 그 자체로 화면 불일치/오판정 결함이다).
  const eventsByRoundByDevice = new Map();
  for (const d of world.devices) {
    for (const e of d.telemetry.events) {
      if (e.eventType !== 'FINISH_ROUND_SUBSTITUTE') continue;
      if (!eventsByRoundByDevice.has(e.round)) eventsByRoundByDevice.set(e.round, new Map());
      // 같은 기기가 같은 라운드를 재판정(defer 재시도 등)할 수 있으므로 마지막 값을 채택한다
      // (REAL 재판정도 idempotent하게 동일 round에 대해 최종적으로 하나의 값에 수렴해야 하므로,
      // "마지막 값"이 그 기기의 최종 확정이다).
      eventsByRoundByDevice.get(e.round).set(d.id, e);
    }
  }
  const outcomeCounts = {}; // round당 host(devices[0]) 관점으로 1회만 집계(중복 계상 방지)
  for (const [round, byDevice] of eventsByRoundByDevice.entries()) {
    const distinctOutcomes = new Set([...byDevice.values()].map((e) => e.outcome));
    if (distinctOutcomes.size > 1) {
      failureModes.push({
        type: 'CROSS_DEVICE_OUTCOME_MISMATCH', round,
        detail: [...byDevice.entries()].map(([id, e]) => `${id}:${e.outcome}`).join(' '),
      });
    }
    const hostEvent = byDevice.get(host.id);
    if (hostEvent) outcomeCounts[hostEvent.outcome] = (outcomeCounts[hostEvent.outcome] || 0) + 1;
  }

  // EG §Phase2 오라클 대조: host 관점의 라운드별 outcome/확정집합을, choiceDriverFn이 실제로
  // 제출한 그라운드 트루스로부터 독립 재계산한 기대값과 대조한다.
  const oracle = computeEliminationOracle({
    participantIds: world.devices.map((d) => d.id),
    roundChoicesByRound: world.roundChoicesByRound,
    targetLoserCount,
    resolveEliminationOracle: resolveEliminationOracle || resolveElimination,
    judgePureOracle: judgePureOracle || judgePure,
    maxRounds: resolvedMaxRounds,
  });
  for (const oracleRound of oracle.perRound) {
    if (oracleRound.oracleIncomplete) continue;
    const hostEvent = eventsByRoundByDevice.get(oracleRound.round) && eventsByRoundByDevice.get(oracleRound.round).get(host.id);
    if (!hostEvent) continue; // 이 라운드에 host 판정 자체가 없음 — 별도로 STALL/coverage가 잡음
    const actualSafe = [...hostEvent.newConfirmedSafeIds].sort();
    const actualLoser = [...hostEvent.newConfirmedLoserIds].sort();
    const mismatch = hostEvent.outcome !== oracleRound.outcome
      || JSON.stringify(actualSafe) !== JSON.stringify(oracleRound.newConfirmedSafeIds)
      || JSON.stringify(actualLoser) !== JSON.stringify(oracleRound.newConfirmedLoserIds);
    if (mismatch) {
      failureModes.push({
        type: 'PHANTOM_OR_CORRUPTED_OUTCOME', round: oracleRound.round,
        detail: 'oracle mismatch',
        expected: { outcome: oracleRound.outcome, safe: oracleRound.newConfirmedSafeIds, loser: oracleRound.newConfirmedLoserIds },
        actual: { outcome: hostEvent.outcome, safe: actualSafe, loser: actualLoser },
      });
    }
  }

  const hardFailureModes = failureModes.filter((f) => EG_HARD_FAILURE_TYPES.includes(f.type));
  const correctnessPass = completed && hardFailureModes.length === 0;
  const finalRound = Math.max(0, ...[...eventsByRoundByDevice.keys()]);

  return {
    participantCount, seed, choiceSeed: resolvedChoiceSeed, targetLoserCount, realtimeDelayRegime,
    completed, elapsed, finalRound,
    outcomeCounts, // 예: { allDraw: 2, tooMany: 1, tooFew: 1, gameOver: 1 }
    failureModes, hardFailureModes,
    oraclePerRound: oracle.perRound,
    correctnessPass, pass: correctnessPass,
    world,
  };
}
