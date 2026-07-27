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
//     scheduleRematchAutoAdvance류, nextRound, isSafeParticipant/isConfirmedLoser/isCurrentRoundParticipant,
//     getPlayingEntryKey, syncConfirmedIdsFromParticipants, showScreen/hideAllScreens(가짜 DOM 위에서 실행).
//   하니스 대체(SUBSTITUTED, 정직하게 공개):
//     finishRoundLocal(460줄, DOM+음성+통계+idempotency 캐시 강결합) 전체는 추출하지 않는다.
//     RC-3 Phase1(codex-critic HIGH 충실성 수정) 이후: 판정 입력을 어느 소스에서 가져올지 가르는
//     핵심 분기(hasStoredResults 판정 + 미충족 시 judgeRound(raw) 폴백, index.html ~8036-8043)는
//     REAL 텍스트를 그대로(바이트 동일) 추출해 new Function으로 실행한다(hasStoredResultsCheckFactory
//     참고) — 더 이상 "항상 인코딩값을 신뢰"하지 않는다. hasStoredResults가 참이면 REAL
//     publishHostRoundResult가 이미 participant row에 인코딩해둔 값(getChoiceResult)을 읽고,
//     거짓이면 REAL judgeRound(judgePure 주입)로 raw base choice에서 재계산한다 — 이 갈림길
//     이후의 술래-소거 상태 전이(allDraw/tooMany/tooFew/gameOver) 자체는 여전히
//     src/game-logic.mjs의 resolveElimination()(REAL, engine-parity.test.mjs가 이미 교차검증한
//     단일 소스 판정 함수)에 위임한다 — 손으로 짠 tooMany/tooFew 판정이 아니다. finishRoundLocal의
//     나머지(DOM 렌더 분기/음성/SFX/통계 DB쓰기/idempotency 캐시/defer 재시도 스케줄러)는 여전히
//     하니스가 대체한다 — 그 부분은 렌더/부작용 표면이지 판정 로직이 아니라고 판단했기 때문이다.
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
  // 전체(460줄, DOM/음성/idempotency 캐시 강결합)는 여전히 추출하지 않지만, "무엇을 신뢰하고
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
export function createRoomStore(roomId = 'ROOM-SIM') {
  return {
    id: roomId,
    row: { id: roomId, penalty: '', round: 1, status: 'waiting' },
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

// db.rpc('server_now') RTT 분포(RC-1 skew simulator와 동일 계열: rttBase + 비대칭 + jitter).
export function sampleClockRtt(rng, deviceIndex) {
  const rttBase = 120 + rng() * 380; // 120..500ms 기본 RTT
  const asymmetrySwing = (rng() - 0.5) * 0.6; // -0.3..0.3
  const upFrac = Math.min(0.95, Math.max(0.05, 0.5 + asymmetrySwing));
  const jitterMs = rng() * rttBase * 0.4;
  return { rttBase, upFrac, jitterMs };
}

function sampleSkewMs(rng) {
  // 기기 wall-clock skew: -3000..+3000ms 대칭 분포(실기기 시계 오차 현실적 범위).
  return Math.round((rng() - 0.5) * 6000);
}

// ── 가짜 db 팩토리: 하나의 roomStore를 여러 device가 공유한다. ────────────────
function createDb({ roomStore, deviceId, isHost, rng, clockRttFn, ackDelayFn, realtimeDelayRegime = 'pessimistic' }) {
  function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, Math.max(0, Math.round(ms))));
  }
  async function opRoomsUpdate(patch) {
    if (!isHost) {
      // 실제 앱도 host만 rooms.update를 호출한다 — 방어적으로 하니스 버그를 조기 발견.
      throw new Error('[rc3-harness] non-host device attempted rooms.update — harness bug');
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
    // 도착시각 이후로만 배달) 실제 단일 순서보장 채널을 충실히 재현한다.
    for (const sub of roomStore.subscribers) {
      const propDelay = sampleRealtimeDelayMs(rng, roomStore.subscribers.length, realtimeDelayRegime);
      const rawTargetAbsMs = Date.now() + propDelay;
      const prevAbsMs = roomStore.subscriberLastScheduledAbsMs.get(sub.deviceId) || -Infinity;
      const targetAbsMs = Math.max(rawTargetAbsMs, prevAbsMs + 1);
      roomStore.subscriberLastScheduledAbsMs.set(sub.deviceId, targetAbsMs);
      const waitMs = Math.max(0, targetAbsMs - Date.now());
      delay(waitMs).then(() => sub.onRoomRow({ ...snapshot }));
    }
    await delay(ackDelay);
    return { error: null };
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
  async function opParticipantsUpdateEq(patch, id) {
    await delay(ackDelayFn());
    const row = roomStore.participants.get(id);
    if (row) Object.assign(row, patch);
    return { error: null };
  }
  async function opParticipantsUpdateIn(patch, ids) {
    await delay(ackDelayFn());
    for (const id of ids) {
      const row = roomStore.participants.get(id);
      if (row) Object.assign(row, patch);
    }
    return { error: null };
  }
  function from(table) {
    if (table === 'rooms') {
      return {
        update: (patch) => ({ eq: () => opRoomsUpdate(patch) }),
        select: () => ({ eq: () => ({ single: () => opRoomsSelectSingle() }) }),
      };
    }
    if (table === 'participants') {
      return {
        update: (patch) => ({
          eq: (_col, id) => opParticipantsUpdateEq(patch, id),
          in: (_col, ids) => opParticipantsUpdateIn(patch, ids),
        }),
        select: () => ({
          eq: () => ({ order: () => opParticipantsSelect(), single: () => opParticipantsSelect() }),
        }),
      };
    }
    throw new Error(`[rc3-harness] unsupported table: ${table}`);
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
// 실제 finishRoundLocal(460줄, DOM/음성/통계/idempotency 캐시 강결합)은 여전히 추출하지 않는다.
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
function makeFinishRoundLocalSubstitute({
  stateRef, resolveElimination, getChoiceBase, getChoiceResult, isNonPlayingChoice,
  hasConfirmedRoundResult, syncConfirmedIdsFromParticipants, judgeRound,
  getTargetLoserCount, showScreen, telemetry, onOutcome,
}) {
  return async function finishRoundLocalSubstitute() {
    const state = stateRef();
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
    try { showScreen('screenRoundResult'); } catch (e) {}
    try { telemetry.emit('metric', { wrps: 'RC3-HARNESS', eventType: 'FINISH_ROUND_SUBSTITUTE', outcome: res.outcome, round: state.round }); } catch (e) {}
    if (onOutcome) onOutcome(res);
    return res;
  };
}

// ── device(= 앱 인스턴스 1개) 생성 ───────────────────────────────────────────
export function createDevice({ id, isHost, roomStore, rng, participantCount, resolveElimination, judgePure, computePlayerStatuses, PLAYER_STATUS, maxLoserCountFor, targetLoserCount = 1, combinedSourceOverride = null, realtimeDelayRegime = 'pessimistic' }) {
  const dom = createFakeDom();
  const telemetry = createTelemetry();
  const skewMs = isHost ? 0 : sampleSkewMs(rng); // host도 skew를 가질 수 있으나 대조군 단순화를 위해 0 고정(보고서에 명시)
  const clockRtt = sampleClockRtt(rng, id);
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
    onOutcome: (res) => {
      rendered.resultByRound[impl.state.round] = { ...(rendered.resultByRound[impl.state.round] || {}), outcome: res.outcome, ts: RealDate.now() };
    },
  });

  return { id, isHost, impl, dom, telemetry, rendered, roomStore, skewMs, clockRtt, env };
}

// ── 트라이얼 세계 구성 + 라운드 진행 드라이버 ─────────────────────────────────
// 이 함수들은 "하니스 조율 접합부"다(README 상단 경계 선언 참고) — index.html에서 추출한 REAL
// 함수를 어떤 순서로 호출하는지에 대한 글루 코드이며, 판정/스케줄링 수치 자체는 전부 위 REAL 함수
// 호출 결과를 그대로 쓴다. 3곳만 하니스가 대신한다: ①1라운드 시작 트리거 ②참가자 선택 제출
// 트리거(실제 UI 클릭 대신) ③"전원 ready 렌더 완료" 감지 후 다음 라운드 시작 트리거(실제 UI의
// markReady 버튼 클릭 체인 대신, host의 실제 startGame()을 직접 호출).
export function createTrialWorld({ participantCount, seed, targetLoserCount = 1, resolveElimination, judgePure, computePlayerStatuses, PLAYER_STATUS, maxLoserCountFor, combinedSourceOverride = null, realtimeDelayRegime = 'pessimistic' }) {
  const rng = mulberry32(seed);
  const roomStore = createRoomStore(`ROOM-${seed}-${participantCount}`);
  const devices = [];
  for (let i = 0; i < participantCount; i++) {
    const id = `p${i}`;
    const isHost = i === 0;
    const device = createDevice({
      id, isHost, roomStore, rng, participantCount, resolveElimination, judgePure,
      computePlayerStatuses, PLAYER_STATUS, maxLoserCountFor, targetLoserCount, combinedSourceOverride,
      realtimeDelayRegime,
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

  for (const d of devices) {
    roomStore.subscribers.push({
      deviceId: d.id,
      onRoomRow: async (row) => {
        try {
          await d.impl.handleRoomUpdate(row);
        } catch (e) {
          d.telemetry.emit('metric', { wrps: 'RC3-HARNESS', eventType: 'HANDLE_ROOM_UPDATE_THREW', message: String(e && e.message || e) });
          return;
        }
        // 접합부 ②: 이번 라운드 참가자면 자기 선택을 즉시 제출한다(실제 UI 클릭 생략).
        if (d.impl.state.status === 'playing' && d.impl.isCurrentRoundParticipant()) {
          const round = d.impl.state.round;
          if (submittedChoiceRound.get(d.id) !== round) {
            submittedChoiceRound.set(d.id, round);
            try { await d.impl.updateParticipantChoice('scissors'); } catch (e) {}
          }
        }
        // 접합부 ③(스케줄링만): result 상태가 되면 REAL scheduleRematchAutoAdvance를 호출한다
        // (host가 아니면 REAL 함수 내부에서 즉시 no-op — 안전).
        if (d.impl.state.status === 'result') {
          try { d.impl.scheduleRematchAutoAdvance(); } catch (e) {}
        }
      },
    });
  }

  return { devices, roomStore, rng, submittedChoiceRound, readyTriggeredForRound, clockSyncPromises };
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

// ── HARD FAILURE 분류(codex-critic C) ────────────────────────────────────────
// "성공률에서 감점"되는 실결함만 포함한다. graceful late-render(설계상 허용된 늦은 렌더)는
// 포함하지 않는다 — TOLERANCE_EXCEEDED(전체 기기 기준, 정보용으로만 보존)와
// ON_TIME_CONCURRENCY_EXCEEDED(on-time 코호트 기준, 별도 게이트)는 모두 HARD FAILURE가 아니다.
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
  for (let r = 2; r <= targetRounds + 1; r++) {
    if (world.readyTriggeredForRound.has(r)) continue;
    if (allDevicesRenderedReadyFor(world, r)) {
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

// ── 트라이얼 1회 실행 + 측정(성공률 집계의 단일 진입점) ───────────────────────
export async function runMeasuredTrial({
  participantCount, seed, targetRounds = DEFAULT_TARGET_ROUNDS, targetLoserCount,
  resolveElimination, judgePure, computePlayerStatuses, PLAYER_STATUS, maxLoserCountFor,
  stepMs = 250, budgetMsPerRound = 40000, choiceBase = 'scissors', vi, combinedSourceOverride = null,
  realtimeDelayRegime = 'pessimistic',
}) {
  const world = createTrialWorld({
    participantCount, seed, targetLoserCount: targetLoserCount ?? Math.max(1, Math.floor(participantCount / 2)),
    resolveElimination, judgePure, computePlayerStatuses, PLAYER_STATUS, maxLoserCountFor, combinedSourceOverride,
    realtimeDelayRegime,
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
    // 접합부 ⓪ 대기: 전원 syncServerClock() settle(성공/실패 무관, 최초 1회 시도 완료)까지 시간을
    // 흘려보낸다 — 이래야 serverNow()가 실제로 skew를 보정한 뒤 라운드1이 시작된다(위 createTrialWorld
    // 주석 참고). 예산 안에서 settle 안 되면(이론상 발생하지 않음 — syncServerClock은 항상 resolve)
    // 그냥 진행한다.
    const clockSyncBudgetMs = 8000;
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
  }

  const completed = allDevicesRenderedResultFor(world, targetRounds);
  const failureModes = [];

  if (!completed) {
    failureModes.push({ type: 'STALL', detail: world.devices.map((d) => `${d.id}:${d.impl.state.status}/${d.impl.state.round}`).join(' ') });
  }
  if (!world.__clockSyncSettled) {
    failureModes.push({ type: 'CLOCK_SYNC_NOT_SETTLED' });
  }

  // 에러 텔레메트리(핸들러 예외/불의의 throw) 수집.
  for (const d of world.devices) {
    for (const e of d.telemetry.events) {
      if (typeof e.eventType === 'string' && e.eventType.endsWith('_THREW')) {
        failureModes.push({ type: 'EXCEPTION', device: d.id, detail: e.eventType + ': ' + e.message });
      }
    }
  }

  // phase별 최대 격차(라운드마다) — 완료된 라운드만 계산(완료 못한 라운드는 STALL로 이미 기록됨).
  //
  // RC-3 Phase2(codex-critic C 지표 정교화): 이 하니스는 설계가 의도적으로 허용하는
  // "늦게 받은 참가자의 graceful late-render"를 실결함과 섞지 않는다. 그래서 격차를 두 갈래로
  // 나눠 계산한다.
  //   (1) FULL_COHORT_TIMING_SPREAD(정보용, HARD FAILURE 아님, 성공률 감점 없음): 참여 전원
  //       기준 최대격차 — 늦게 도착한 참가자까지 포함하므로 tolerance 초과가 "설계상 허용된
  //       late-render"때문인지 "진짜 스케줄링 결함"때문인지 이 값만으로는 구분되지 않는다.
  //       이전 버전(§2 이전)의 TOLERANCE_EXCEEDED와 동일 계산이며, mutation 테스트가 실제
  //       스케줄링 결함을 여전히 검출할 수 있도록(§4 참고) 보존한다.
  //   (2) ON_TIME_CONCURRENCY_EXCEEDED(품질 게이트, HARD FAILURE 아니지만 별도 pass/fail):
  //       REAL waitForPhaseRender가 직접 계산한 lateRenderMs(위 LATE_RENDER_THRESHOLD_MS)로
  //       "on-time" 판정된 기기끼리만 최대격차를 계산한다 — CEO의 "동시 렌더" 요구는 이
  //       코호트에 대한 것이다. countdown/result/ready 3개 phase만 REAL lateRenderMs를 갖고
  //       (choiceStart/choiceEnd는 countdown의 late 여부를 상속, 위 getPhaseLateRenderMs 참고).
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
      ready: (r < targetRounds) ? diff(readyTs) : null,
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

    // on-time 코호트 격차(품질 게이트) + late-render 집계(정보용, REAL lateRenderMs 기반).
    // countdown/result/ready 3개 phase만 REAL 계측이 있다(§2 위 주석) — choiceStart/choiceEnd는
    // countdown의 on-time 판정을 상속하되 별도 SYNC_RENDER가 없으므로 late-render 집계 모수에는
    // 넣지 않는다(이중 계상 방지, §7에 기록).
    for (const phase of ['countdown', 'result', 'nextRound']) {
      if (phase === 'nextRound' && r >= targetRounds) continue; // ready는 마지막 라운드엔 없음(기존 로직과 동일 범위)
      const onTimeTrue = [];
      for (const d of world.devices) {
        const lateMs = getPhaseLateRenderMs(d, phase, r);
        if (lateMs == null) continue; // 렌더 자체가 없음 — MISSING_*_RENDER가 이미 별도로 잡음
        lateRenderTally.total += 1;
        const late = lateMs > LATE_RENDER_THRESHOLD_MS;
        if (late) lateRenderTally.late += 1;
        else onTimeTrue.push(getPhaseTrueTs(d, phase, r));
      }
      const onTimeDiff = diff(onTimeTrue.filter((v) => v != null));
      const reportPhase = phase === 'nextRound' ? 'ready' : (phase === 'countdown' ? 'countdownStart' : phase);
      onTimeConcurrency[`${reportPhase}:${r}`] = { onTimeCount: onTimeTrue.length, diffMs: onTimeDiff };
      if (onTimeTrue.length >= 2 && onTimeDiff != null && onTimeDiff > PHASE_TOLERANCE_MS[reportPhase]) {
        failureModes.push({ type: 'ON_TIME_CONCURRENCY_EXCEEDED', phase: reportPhase, round: r, diffMs: Math.round(onTimeDiff), onTimeCount: onTimeTrue.length });
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
  const lateRenderRatio = lateRenderTally.total > 0 ? lateRenderTally.late / lateRenderTally.total : null;

  return {
    participantCount, seed, realtimeDelayRegime, completed, elapsed, perRoundMaxDiff, outcomeCounts,
    onTimeConcurrency, lateRenderStats: { ...lateRenderTally, ratio: lateRenderRatio },
    failureModes, hardFailureModes,
    onTimeConcurrencyViolations, onTimeConcurrencyPass: onTimeConcurrencyViolations.length === 0,
    // RC-3 Phase2 정의: trial 성공 = HARD FAILURE 0 AND 5라운드 정상 완주. graceful late-render/
    // on-time 동시성은 여기서 감점하지 않는다(별도 onTimeConcurrencyPass/lateRenderStats로 보고).
    pass: completed && hardFailureModes.length === 0,
    world,
  };
}
