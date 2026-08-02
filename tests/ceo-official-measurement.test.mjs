import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  judgePure, resolveElimination, computePlayerStatuses, PLAYER_STATUS, maxLoserCountFor,
} from '../src/game-logic.mjs';
import {
  runEliminationTrial, createDecisiveChoiceDriver, createAlternatingSkewFn,
  getPhaseTrueTs, EG_HARD_FAILURE_TYPES, DEFAULT_EG_TARGET_LOSER_COUNT,
  makeClockRttOverrideFn, EXTRACTED_COMBINED_SOURCE,
} from './rc3-harness-support.mjs';

// ════════════════════════════════════════════════════════════════════════════
// CEO 개정 스펙(95%) 공식 측정 인프라 — STOP-SHIP.
//
// 이 파일은 기존 tests/rc3-harness-support.mjs / tests/rc3-multiparticipant-sim.test.mjs가
// 이미 실집행으로 확립한 REAL(index.html new Function 그대로 구동) 하니스를 그대로 재사용한다
// (새 REAL 추출 없음, index.html 무수정, 기존 하니스 파일도 무수정 — 전부 기존 export 조합만
// 사용). 이 파일이 새로 추가하는 것은 세 가지뿐이다:
//   1) CEO가 정의한 3개 profile(Normal/Degraded/Extreme)을 기존 export된 knob들
//      (realtimeDelayRegime/deliveryOrderMode/skewMsOverrideFn/pollingEnabled)의 조합으로 명시.
//   2) 기존 correctnessPass(§RC-3 taxonomy, [범주1] 지연-독립 correctness 게이트)보다 훨씬 좁고
//      엄격한 CEO PASS-unit 판정(computeCeoPassUnits) — 특히 Timing은 기존 PHASE_TOLERANCE_MS
//      (5000~5800ms)를 전혀 재사용하지 않고 CEO_PHASE_TIMING_LIMIT_MS=250ms라는 별도의, 훨씬
//      엄격한 상수로 독립 판정한다(§Phase0 보고에 이 구분을 명시).
//   3) §C-1 Release Gate 정책(computeReleaseGate) — profile별 역할(profileRole)에 따라
//      "무엇이 출시를 막는 게이트이고 무엇이 정보성 보고인가"를 명시적으로 분리한다.
//
// §Phase0 커버리지 정직 매핑(요약 — 전체 서술은 orchestrator 최종 보고 본문):
//   MODELED(REAL): Clock/Sync 전부, Timing(countdown/choiceStart/choiceEnd/result/ready 5-phase
//     전부, true-time 도메인), Progression(방생성~게임오버, 1게임 사이클 한정), Rules 중
//     draw/tooMany/tooFew/multi-tagger/winners-only-losers-only replay/confirmedIds보존/active
//     candidates 일관성(oracle 대조), Result 중 "전기기 판정일치"(CROSS_DEVICE_OUTCOME_MISMATCH).
//   PARTIAL: active candidates 일관성 — oracle이 resolveElimination "동일 함수"를 그라운드트루스
//     계산에도 쓰므로 파이프라인(입력이 실제 제출값과 일치하는가) 결함은 잡지만
//     resolveElimination 알고리즘 자체의 결함은 이 매트릭스가 아니라 engine-parity.test.mjs가
//     별도로 검증한다.
//   NOT_MODELED(정직 표기, 미모델): Audio 전부(playVoiceClip/SoundManager는 브라우저
//     AudioContext 의존 — env가 no-op 스텁으로 대체, §7 한계), Result 중 resultValueNull/
//     shadowMismatch(__engineV2ShadowCompare/ROUND_RESULT emit 경로 자체가 추출되지 않음 —
//     ENGINE_V2_SHADOW는 프로덕션에서도 기본 비활성), Progression 중 "재경기(gameOver 이후
//     2번째 게임)~세션 종료"(inviteForReplay/goToReadyScreen은 이 하니스에서 REAL 함수 추출이
//     아니라 알려진 payload 재현으로만 존재하는 좁은 표적 시나리오(runInviteForReplayReinvitingScenario
//     등)로만 커버 — 이 N×profile 스윕에는 포함하지 않음), Rules 중 Build23 하드블록/에러화면
//     (DOM 자체를 모델링하지 않음) 및 Build24/28/29 무회귀(별도 단위 테스트 파일
//     build24-sync-snapshot-stability.test.mjs / build28-round-judge-integrity.test.mjs /
//     build29-*.test.mjs가 커버 — 이 하니스 매트릭스 범위 밖, npm test 전체에는 포함됨),
//     Profile 다양성 항목 중 host변경/background·foreground/disconnect·reconnect(메인 스윕 루프가
//     host를 항상 devices[0] 고정으로 단순화하고 있고, 이 항목들을 주입하는 별도 knob이 없음).
//
// ── codex-critic P1 검증(CRITICAL 1 / HIGH 1 / MEDIUM 4) 수정 요약 ──────────────
//   [CRITICAL-1] NOT_SYNCED(하니스 clock sync 예산 초과)를 correctness 게이트에서 강등 →
//     informational. 대신 clockSync.settle(실측 settle 분포) + notSettledWithinHarnessBudget +
//     셀 단위 clockSyncSettle 집계를 반드시 보고한다. NO_VALID_SAMPLE/COUNTDOWN_SYNC_FAILED/
//     COUNTDOWN_START_WITHOUT_ANCHOR는 correctness 유지. (§Clock/Sync 블록 주석 참고)
//   [HIGH-1] 게이트 테스트의 조용한 합성 fallback 제거(합성 PASS 단언 삭제) + CEO_GATE_STRICT=1
//     strict 모드 추가(헤드라인 3개 강제 + 실측 overallReleasePass 강제). (§HIGH-1 블록)
//   [MEDIUM-1] 라운드별 cross-device countdown anchor 일치 검사(COUNTDOWN_ANCHOR_DIVERGED)를
//     correctness에 추가 — host republish로 인한 기기간 앵커 갈림이 timing에만 남던 검출력 손실 복구.
//   [MEDIUM-2] COUNTDOWN_STALE_GENERATION_ABORTED 면제 조건을 "더 최신 세대가 실제로 진행했다는
//     실증(유효 앵커 COUNTDOWN_START 또는 그 라운드 countdown SYNC_RENDER)"이 있을 때로 좁힘.
//   [MEDIUM-4] MISSING_PHASE_RENDER(특히 nextRound × outOfOrder)의 사전 판정 기준을 주석으로
//     명문화하고, 실패 detail에 missingDevices/renderedDevices/traces(렌더 시퀀스·stale 스킵·최종
//     status)를 실어 사후 분류가 가능하게 함.
//   [MEDIUM-5] Degraded/Extreme timing 게이트 제외 근거를 "천장 초과"에서 "잔차 분포"로 교체
//     (CLOCK_RESIDUAL_SPREAD_MC + simulateClockResidualSpread로 재현 가능, [M5-1]이 검증).
//   [LOW-3] 공허 단언 제거 → 열거 무결성/중복계상/EXCEPTION=0 실불변식으로 교체.
//   [LOW-5] timingGateReachable → clockCeilingWithinTimingLimit로 이름 정정(+분포 필드 동반).
// ════════════════════════════════════════════════════════════════════════════

// CEO Timing PASS-unit: 기존 PHASE_TOLERANCE_MS(설계 관용치, 5000~5800ms)와는 별도의, CEO가
// 이번에 지정한 훨씬 엄격한 값. 절대 index.html/하니스의 기존 tolerance를 이 값으로 바꾸지
// 않는다 — 이 값은 오직 이 새 측정 레이어에서만 쓰인다.
const CEO_PHASE_TIMING_LIMIT_MS = 250;
const CEO_TIMING_PHASES = ['countdownStart', 'choiceStart', 'choiceEnd', 'result', 'ready'];

// §C-1 Release Gate 임계값(CEO 확정): timing은 95%, correctness는 100%.
export const CEO_TIMING_GATE_RATE = 0.95;
export const CEO_CORRECTNESS_GATE_RATE = 1.0;

// §H-2: index.html:7400 `waitForValidCountdownStart(maxAttempts = 5, delayMs = 500)`의 실제
// 시그니처 기본값 — 재시도로 인한 누적 지연 기여를 추정할 때 이 값을 그대로 재사용한다
// (측정 레이어가 새 숫자를 발명하지 않음).
export const COUNTDOWN_RETRY_MAX_ATTEMPTS = 5;
export const COUNTDOWN_RETRY_DELAY_MS = 500;

function diffOf(arr) { return arr.length >= 2 ? Math.max(...arr) - Math.min(...arr) : null; }

// §M-4 진단 보조: 어떤 기기가 그 phase를 렌더했는지까지 남긴다(누락 진단에 필요한 최소 정보).
function idsWithTs(devices, tsByDevice) {
  return devices.filter((_, i) => tsByDevice[i] != null).map((d) => d.id);
}

function computeRoundPhaseCoverage(world, round) {
  const countdownTsAll = world.devices.map((d) => getPhaseTrueTs(d, 'countdown', round));
  const resultTsAll = world.devices.map((d) => getPhaseTrueTs(d, 'result', round));
  const countdownTs = countdownTsAll.filter((v) => v != null);
  const resultTs = resultTsAll.filter((v) => v != null);
  // ── §M-1 ready(nextRound) 인덱싱 정정(실측 근거) ──────────────────────────────
  // index.html:9802의 host write는 `{ round: state.round + 1, status: 'ready', penalty }`이고,
  // handleRoomUpdate는 :5832에서 state.round = room.round를 먼저 반영한 뒤 :6017에서
  // waitForPhaseRender("nextRound", readyScheduledAt, ...)를 호출한다 — 즉 nextRound SYNC_RENDER의
  // round 필드는 "새로 진입하는 라운드 번호"다. 따라서 라운드 r의 nextRound 이벤트는 r>=2에서만
  // 존재하고 r=1에는 아예 없다(그리고 "마지막 라운드로 진입하는 ready"는 분명히 존재한다).
  // 종전 코드는 isLastRound일 때 readyTs를 통째로 비워, 실제로 존재하는 마지막 라운드 진입 ready
  // 측정을 매 trial마다 1건씩 통째로 버리고 있었다(측정 누락 = false negative). r=1은 이벤트가
  // 없어 자연히 빈 배열이 되므로 별도 게이팅이 필요 없다.
  // §probe 실측(3 profile × 25 trial = 75 trial / 271 round, tests/zz-probe-cov 임시 프로브로 직접
  // 재현 후 삭제): r=1의 nextRound coverage는 항상 0, r>=2(마지막 라운드 포함)는 항상 전 기기.
  const readyTsAll = world.devices.map((d) => getPhaseTrueTs(d, 'nextRound', round));
  const readyTs = readyTsAll.filter((v) => v != null);
  // §probe 실측(개발 중 직접 재현, tests/ceo-official-measurement.test.mjs 개발 로그 참고): 하니스의
  // env.setInterval 관측 훅(위 rc3-harness-support.mjs createDevice 주석 — "beginRoundTimer()가
  // 등록하는 1초 tick"을 관측할 의도)은 사실 인덱스.html의 서로 다른 두 setInterval 호출부를
  // 구분하지 못한다: (1) beginRoundTimer()의 진짜 선택-타이머(choiceStart의 유일한 REAL 소스),
  // (2) startHostJudgeBackstop()의 무관한 "빠진 호스트 판정 백스톱" 타이머(이번 라운드
  // 비참가자(이미 확정 안전/술래)에게만 등록됨, index.html ~7629-7646). 비참가자 기기는
  // runCountdown()을 아예 호출하지 않고(countdown SYNC_RENDER 없음) 곧장
  // startHostJudgeBackstop()으로 빠지는데, 관측 훅은 그 backstop setInterval 등록도 "choiceStart"로
  // 오기록하고, 그 콜백의 첫 tick(1초 후, state.remainingSeconds가 이전 라운드의 잔여값을 그대로
  // 물려받아 흔히 이미 ≤0)을 "choiceEnd"로 오기록한다 — 실측(§probe): 이 오염된 기기의
  // choiceStart/choiceEnd 간격이 정상 5000ms가 아니라 단 1000ms였다. 그래서 choiceStart/choiceEnd
  // 비교는 "이 라운드에 실제로 runCountdown()을 거친(=countdown SYNC_RENDER가 있는) 기기"로만
  // 한정한다(하니스 원본 파일은 무수정 — 이 측정 레이어에서만 필터링).
  const activeDeviceIds = new Set(world.devices.filter((d) => getPhaseTrueTs(d, 'countdown', round) != null).map((d) => d.id));
  const choiceStartTs = world.devices.filter((d) => activeDeviceIds.has(d.id))
    .map((d) => d.rendered.choiceStartByRound[round] && d.rendered.choiceStartByRound[round].ts).filter((v) => v != null);
  const choiceEndTs = world.devices.filter((d) => activeDeviceIds.has(d.id))
    .map((d) => d.rendered.choiceEndByRound[round] && d.rendered.choiceEndByRound[round].ts).filter((v) => v != null);
  return {
    countdownStart: { diff: diffOf(countdownTs), coverage: countdownTs.length, deviceIds: idsWithTs(world.devices, countdownTsAll) },
    choiceStart: { diff: diffOf(choiceStartTs), coverage: choiceStartTs.length, deviceIds: null },
    choiceEnd: { diff: diffOf(choiceEndTs), coverage: choiceEndTs.length, deviceIds: null },
    result: { diff: diffOf(resultTs), coverage: resultTs.length, deviceIds: idsWithTs(world.devices, resultTsAll) },
    ready: { diff: diffOf(readyTs), coverage: readyTs.length, deviceIds: idsWithTs(world.devices, readyTsAll) },
  };
}

// ── §M-4 진단: 특정 기기가 "무엇을 봤는지"를 압축 재구성한다 ────────────────────
// MISSING_PHASE_RENDER가 발화했을 때 "REAL 결함인가 / 배달 모델 아티팩트인가"를 사후에 가르려면
// 최소한 (1) 그 기기가 실제로 렌더한 phase 시퀀스 (2) stale-row 스킵/self-heal 발생 여부
// (3) trial 종료 시점의 로컬 status/round 가 필요하다(아래 §M-4 판정 기준 주석 참고).
function describeDeviceRenderTrace(device) {
  const renders = [];
  let staleSkipped = 0;
  let staleSelfHeal = 0;
  let staleGenerationAborted = 0;
  for (const e of device.telemetry.events) {
    if (e.eventType === 'SYNC_RENDER') renders.push(`${e.phase}@${e.round}`);
    else if (e.eventType === 'STALE_ROOM_UPDATE_SKIPPED') staleSkipped++;
    else if (e.eventType === 'STALE_ROOM_UPDATE_SELF_HEAL') staleSelfHeal++;
    else if (e.eventType === 'HANDLE_ROOM_UPDATE_STALE_GENERATION_ABORTED') staleGenerationAborted++;
  }
  const st = (device.impl && device.impl.state) || {};
  return {
    device: device.id,
    renderSeq: renders,
    staleRowSkipped: staleSkipped,
    staleRowSelfHeal: staleSelfHeal,
    handleRoomUpdateStaleGenerationAborted: staleGenerationAborted,
    finalStatus: st.status != null ? st.status : null,
    finalRound: st.round != null ? st.round : null,
    finalGameRound: st.gameRound != null ? st.gameRound : null,
  };
}

// ════════════════════════════════════════════════════════════════════════════
// §측정 레이어 mutation 스위치(반공허성 증명 전용).
//
// 아래 각 플래그는 "이 파일이 이번에 고친 결함을 다시 원상복구했을 때 해당 테스트가 실제로
// 실패하는가"를 증명하기 위한 것이다. 기본값은 전부 false이고, 매트릭스 실행 경로(runCell)는
// 이 옵션을 절대 넘기지 않는다(아래 §반공허성 sanity 테스트가 그 사실 자체를 단언한다) —
// 게이트를 몰래 약화시키는 통로로 쓰이지 않도록 하기 위함.
// ════════════════════════════════════════════════════════════════════════════
export const CEO_MEASUREMENT_MUTATIONS = Object.freeze({
  // §H-2 되돌리기: INVALID_COUNTDOWN_SERVER_TS(재시도 "전" emit되는 시도 카운터)를 다시
  // permanent release-gate FAIL로 계상한다(수정 전 :127의 동작).
  transientCountdownRetryIsPermanent: false,
  // §H-2 되돌리기: participant 하드블록 신호(COUNTDOWN_SYNC_FAILED)를 무시한다.
  ignoreCountdownSyncFailed: false,
  // §H-2 되돌리기: COUNTDOWN_START인데 countdownStartServerTs가 falsy인 경우를 무시한다.
  ignoreNullCountdownAnchor: false,
  // §M-1 되돌리기: result 기대 커버리지를 다시 activeIds로 계산한다(수정 전 :163-168의 동작).
  resultExpectationUsesActiveIds: false,
  // §M-1 되돌리기: phase별 기대치 분리 자체를 없애고 전 phase에 activeIds를 쓴다.
  disablePerPhaseExpectation: false,
  // §CRITICAL-1 되돌리기: 하니스 예산(clockSyncBudgetMs) 미달을 다시 correctness FAIL로 계상한다
  // (수정 전 동작 — REAL에 존재하지 않는 데드라인을 게이트로 쓰던 아티팩트).
  notSyncedIsCorrectnessFailure: false,
  // §M-1(critic) 되돌리기: 라운드별 cross-device countdown anchor 일치 검사를 끈다.
  ignoreAnchorDivergence: false,
  // §M-2(critic) 되돌리기: COUNTDOWN_STALE_GENERATION_ABORTED 예외를 "무조건 면제"로 되돌린다
  // (수정 전 동작 — 더 최신 세대가 실제로 진행했다는 증거가 없어도 면제).
  staleAbortExemptionUnconditional: false,
  // §M-C(critic) 되돌리기: 트라이얼 "종료 시점"의 state.gameRound를 그 기기의 모든 라운드에
  // 일괄 fallback으로 적용한다(수정 전 동작 — multi-game에서 게임1 라운드 r과 게임2 라운드 r이
  // 같은 roundKey로 병합돼 COUNTDOWN_ANCHOR_DIVERGED가 100% false positive로 발화한다).
  blanketFallbackGameNo: false,
});

function resolveMutations(mutations) {
  return { ...CEO_MEASUREMENT_MUTATIONS, ...(mutations || {}) };
}

// ── §M-1: phase별 기대 커버리지(단일 진실 소스) ───────────────────────────────
// ⚠️ 종전 주석은 "result도 runCountdownThenShowGame() 경로라서 확정된 참가자는 남기지 않는다"고
// 적고 있었으나 이는 사실이 아니다. REAL 호출부는 전 소스에 정확히 2곳이고 둘 다
// handleRoomUpdate 안이다:
//   index.html:5895  await waitForPhaseRender("result",    resultScheduledAt, ...)
//   index.html:6017  await waitForPhaseRender("nextRound", readyScheduledAt,  ...)
// :5895는 `if (state.status === "result" || state.status === "game_over")` 분기 최상단이며,
// iAmSafe/iAmConfirmedLoser 라우팅(:5913)은 그보다 "뒤"에 있다 — 즉 이미 확정된 안전/술래 기기도
// result SYNC_RENDER를 반드시 남긴다. :6017(ready)도 마찬가지로 참가 여부와 무관하다.
// 반면 countdown은 runCountdownThenShowGame 경로라 isCurrentRoundParticipant() 라우팅으로 확정
// 참가자가 대기화면에 머물러 emit하지 않는다 — countdown만 activeIds 기준이 맞다.
// §probe 실측(3 profile × 25 trial = 75 trial / 271 round): countdown coverage == oracle
// activeIds.length(불일치 0건), result coverage == 전 기기 수(부족 0건, 마지막 라운드 포함),
// nextRound coverage == 전 기기 수(r>=2, 부족 0건) / r=1은 0건.
// ════════════════════════════════════════════════════════════════════════════
// §M-4(critic) MISSING_PHASE_RENDER 사전 판정 기준 — 특히 nextRound × outOfOrder.
//
// 위험: Degraded/Extreme은 deliveryOrderMode='outOfOrder'다. 어떤 기기가 result 행 다음에
// (ready 행을 건너뛰고) 곧장 다음 라운드 playing 행을 먼저 수신하면, handleRoomUpdate의
// ready 분기(index.html:6017 waitForPhaseRender("nextRound", ...))를 아예 통과하지 않아
// nextRound SYNC_RENDER가 결손될 수 있다 → MISSING_PHASE_RENDER → progression FAIL →
// correctness는 3 profile 전부 100% 요구이므로 즉시 출시 차단. timing과 달리 이 채널은
// Degraded/Extreme에서도 게이트에 그대로 걸리므로, "발화 = 무조건 REAL 결함"으로 읽으면 안 된다.
//
// 발화 시 아래 순서로 분류한다(코드 변경으로 미리 억제하지 않는다 — 은폐 금지, 대신 진단 필드로
// 사후 판별한다. 필요한 필드는 실패 detail의 missingDevices/renderedDevices/traces가 제공한다):
//   (1) [배달 모델 아티팩트] 누락 기기의 traces.renderSeq에 그 라운드의 ready만 없고 그 다음
//       라운드의 countdown/result는 정상적으로 있다 + staleRowSkipped>0 또는 그 기기가 ready 행
//       자체를 건너뛴 정황(outOfOrder 재정렬)이 있다. 이 경우 "행을 못 봤다"는 전송계층 모델의
//       산물이며, REAL Supabase realtime은 WebSocket(TCP) 순서보장 스트림이라 같은 방식으로
//       "행이 건너뛰어지는" 일이 발생하지 않는다(§Phase1 packet loss 근거 주석 참고).
//       ⚠️ 단, REAL에도 2.6초 폴링이라는 독립 경로가 있어 "행 하나를 통째로 건너뛴 스냅샷"은
//       실제로 관측 가능하다 — 그래서 이 분류는 "무해"가 아니라 "이 매트릭스로는 REAL 결함이라고
//       주장할 수 없음"이라는 뜻이며, 발화 건수는 반드시 보고한다.
//   (2) [REAL 결함] 누락 기기가 그 라운드의 ready 행을 실제로 처리했는데도(= 그 라운드 전후
//       렌더가 정상이고 staleRowSkipped==0, handleRoomUpdateStaleGenerationAborted>0 등 REAL
//       가드가 개입한 흔적이 있다) SYNC_RENDER가 없다. 이 경우는 REAL의 세대/스냅샷 가드가
//       정상 진행을 삼킨 것이므로 index.html 결함이다.
//   (3) [측정 레이어 결함] 기대치(expectedPhaseCoverageFor) 자체가 틀렸다 — 예: r=1처럼
//       구조적으로 이벤트가 없는 라운드. 이 경우 기대치 규칙을 고친다(코드 결함 아님).
// 세 분류 중 무엇인지 판별하지 못하면 "미분류"로 보고한다(추정으로 PASS 포장 금지).
// ════════════════════════════════════════════════════════════════════════════
export const PROGRESSION_COVERAGE_PHASES = ['countdownStart', 'result', 'nextRound'];

export function expectedPhaseCoverageFor(phase, ctx, mutations) {
  const mut = resolveMutations(mutations);
  const { round, activeCount, participatingDeviceCount } = ctx;
  const active = (activeCount == null) ? null : activeCount;
  if (mut.disablePerPhaseExpectation) {
    // phase별 분리 제거(mutation) = 수정 전 구조 그대로 재현한다: countdownStart/result에 동일한
    // activeIds 기대치를 쓰고, nextRound(ready)는 아예 검사하지 않는다(수정 전 :165 루프는
    // ['countdownStart', 'result'] 두 phase만 돌았다).
    if (phase === 'nextRound' || phase === 'ready') return null;
    return active;
  }
  switch (phase) {
    // runCountdownThenShowGame 경로 — 확정 안전/술래는 대기화면으로 라우팅되어 emit하지 않는다.
    case 'countdownStart':
    case 'choiceStart':
    case 'choiceEnd':
      return active;
    // handleRoomUpdate :5895 — 라우팅 "이전"이라 그 room/gameNo/round에 존재한 전 기기가 남긴다.
    case 'result':
      return mut.resultExpectationUsesActiveIds ? active : participatingDeviceCount;
    // handleRoomUpdate :6017 — 역시 전 기기. 단 round 필드가 "새로 진입하는 라운드"라 r=1엔 없다.
    case 'nextRound':
    case 'ready':
      return round <= 1 ? null : participatingDeviceCount;
    default:
      return null;
  }
}

export function expectationBasisFor(phase, mutations) {
  const mut = resolveMutations(mutations);
  if (mut.disablePerPhaseExpectation) return 'activeIds'; // (nextRound는 애초에 검사되지 않음)
  if (phase === 'result') return mut.resultExpectationUsesActiveIds ? 'activeIds' : 'participatingDevices';
  if (phase === 'nextRound' || phase === 'ready') return 'participatingDevices';
  return 'activeIds';
}

// ── §H-2: countdown anchor 판정(transient 재시도 vs permanent 실패 분리) ──────
// 확정된 REAL 동작(index.html:7400-7414 waitForValidCountdownStart):
//   while (!scheduledStartAt && attempt < maxAttempts) {
//     QA.emit(... 'INVALID_COUNTDOWN_SERVER_TS', round, attempt);   ← 루프 "선두" = 재시도 전
//     ... db.from('rooms').select('penalty') 로 복구 시도 ...
//     attempt++; if (!scheduledStartAt && attempt < maxAttempts) await sleep(delayMs);
//   }
// 즉 INVALID_COUNTDOWN_SERVER_TS는 "재시도를 시도했다"는 카운터이지 실패 신호가 아니다 —
// 1회차 db 재조회로 즉시 복구돼도 반드시 1건이 남는다. 이후 :7519-7533에서 실패가 확정되면
// host는 republishCountdownStartAsHost()로 항상 자가복구(truthy 반환)하고, participant만
// showCountdownSyncError() → COUNTDOWN_SYNC_FAILED emit + return false(하드블록)로 끝난다.
// 그리고 :7538의 COUNTDOWN_START는 countdownStartServerTs: scheduledStartAt과 함께 emit된다.
//
// 판정 단위(CEO 확정): device + roomCode + gameNo + round.
//   PASS  = 그 라운드에서 최종적으로 유효한 countdownStartServerTs(≠0)로 COUNTDOWN_START 발생.
//   FAIL  = 아래 permanent 4종 중 하나.
//
// ⚠️⚠️ §M-C(critic MEDIUM, 확정 결함) — gameNo 부재로 인한 multi-game 측정 차단 ⚠️⚠️
// 종전 주석은 "재경기(gameNo 증가)가 나중에 모델링되면 이 판정이 자동으로 올바르게 확장된다"고
// 적고 있었으나 이는 사실이 아니다(그 주장 자체가 이 결함의 원인이었다):
//   · index.html:7538의 COUNTDOWN_START emit(전 소스 유일 emit — grep으로 직접 확인)은
//       QA.emit('metric', { wrps:'WRPS-036', eventType:'COUNTDOWN_START', round: state.round,
//         countdownStartServerTs, countdownClientStartTs, offsetMs, countdownDriftMs, waitMs })
//     이며 gameNo 필드가 **없다**(roomCode도 없다). 즉 앵커 이벤트만으로는 그 앵커가 몇 번째
//     게임의 것인지 원리적으로 알 수 없다.
//   · 수정 전 코드는 이 결손을 "트라이얼 종료 시점의 state.gameRound"(= 마지막 게임 번호)로
//     메워 그 기기의 **모든 라운드에 일괄 적용**했다. 재경기가 모델링되면 게임1 라운드 r과
//     게임2 라운드 r이 같은 roundKey(`room|2|r`)로 병합되고, 두 게임의 앵커는 필연적으로 다르므로
//     COUNTDOWN_ANCHOR_DIVERGED가 **모든 재경기 trial에서 100% false positive**로 발화한다.
//     correctness 채널이라 곧바로 출시 차단이 된다.
// → 이번 P1의 정책(CEO 지시): 일괄 fallback을 제거하고, multi-game이 감지되면 조용히 틀린 판정을
//   내는 대신 **명시적으로 unsupported**로 선언한다(아래 resolveMeasurementGameScope). 공식 측정
//   범위는 single-game scope로 한정한다.
export function makeCountdownUnitKey({ device, roomCode, gameNo, round }) {
  return `${device}|${roomCode == null ? '' : roomCode}|${gameNo == null ? '' : gameNo}|${round}`;
}

export function makeCountdownRoundKey({ roomCode, gameNo, round }) {
  return `${roomCode == null ? '' : roomCode}|${gameNo == null ? '' : gameNo}|${round}`;
}

// ════════════════════════════════════════════════════════════════════════════
// §M-C: 공식 측정 scope 결정 — single-game만 지원, multi-game은 명시적 unsupported.
//
// 정책(CEO 확정):
//   1. COUNTDOWN_START에 gameNo가 없는 상태에서 fallback 값을 모든 round에 일괄 적용하지 않는다.
//   2. 이번 P1에서는 multi-game/replay measurement를 차단한다.
//   3. gameNo가 없거나(관측 불가) 여러 게임이 섞이면 fail-fast 또는 unsupported를 명시한다.
//   4. 공식 측정 대상은 single-game scope로 제한한다.
//
// 판정 근거(관측 가능한 gameNo 출처 — index.html 무수정 상태에서 존재하는 것만 사용):
//   · SYNC_RENDER(:5289/:5303/:7562 등)는 `gameNo: getGameRound()`를 싣는다 → 라운드별 실제 게임 번호.
//   · 그 외 다수의 WRPS-078 metric도 gameNo를 싣는다.
//   · device.impl.state.gameRound(트라이얼 종료 시점 상태) — 종전 fallback의 출처.
// 이 셋에서 관측된 gameNo 값들의 distinct 집합이
//   size 0  → GAME_NO_UNOBSERVED  (앵커에 gameNo가 없는데 다른 근거도 없다 = 추정 금지 → unsupported)
//   size 1  → SINGLE_GAME         (지원 범위. scopeGameNo는 그 유일 값)
//   size >1 → MULTI_GAME_UNSUPPORTED (측정 차단 — 병합 판정을 내리지 않는다)
// ⚠️ size>1 판정은 "device별"이 아니라 "trial 전체"로 본다: 한 기기라도 게임2에 진입했다면
// 그 trial의 roundKey 공간은 이미 두 게임이 섞여 있어 라운드 단위 cross-device 비교가 성립하지 않는다.
// ════════════════════════════════════════════════════════════════════════════
export const MEASUREMENT_GAME_SCOPE_POLICY = Object.freeze({
  officialScope: 'single_game',
  multiGameSupported: false,
  anchorEmitCarriesGameNo: false, // index.html:7538 — 전 소스 유일 COUNTDOWN_START emit에 gameNo 없음
  blockedInP1: 'multi_game_replay_measurement',
  productionMetricGap: 'COUNTDOWN_START(index.html:7538)에 gameNo(+roomCode) 필드 추가 필요 — 프로덕션 실행 코드 변경이라 이번 P1 범위 밖(별도 P2 이전 작업으로 보고).',
});

export function resolveMeasurementGameScope(world, mutations) {
  const mut = resolveMutations(mutations);
  const observed = new Set();
  const byDevice = {};
  const sourceCounts = { eventGameNo: 0, finalStateGameRound: 0 };
  const finalStateGameRounds = {};
  for (const d of ((world && world.devices) || [])) {
    const perDevice = new Set();
    const st = (d.impl && d.impl.state) || {};
    if (st.gameRound != null) {
      perDevice.add(st.gameRound);
      finalStateGameRounds[d.id] = st.gameRound;
      sourceCounts.finalStateGameRound++;
    }
    for (const e of ((d.telemetry && d.telemetry.events) || [])) {
      if (e.gameNo == null) continue;
      perDevice.add(e.gameNo);
      sourceCounts.eventGameNo++;
    }
    byDevice[d.id] = [...perDevice].sort((a, b) => a - b);
    for (const v of perDevice) observed.add(v);
  }
  const gameNos = [...observed].sort((a, b) => a - b);
  const base = {
    gameNos, gameNoByDevice: byDevice, finalStateGameRounds, sourceCounts,
    officialScope: MEASUREMENT_GAME_SCOPE_POLICY.officialScope,
    anchorEmitCarriesGameNo: MEASUREMENT_GAME_SCOPE_POLICY.anchorEmitCarriesGameNo,
  };
  if (mut.blanketFallbackGameNo) {
    // mutation(수정 전 동작 재현): scope 검사를 하지 않고 기기별 종료 시점 gameRound를 일괄 적용.
    return { ...base, supported: true, reason: 'MUTATION_BLANKET_FALLBACK', scopeGameNo: null, blanketFallback: true };
  }
  if (gameNos.length === 0) {
    return {
      ...base, supported: false, reason: 'GAME_NO_UNOBSERVED', scopeGameNo: null, blanketFallback: false,
      detail: 'COUNTDOWN_START에 gameNo가 없고(index.html:7538) 다른 gameNo 근거도 관측되지 않았다 — 추정하지 않고 unsupported로 선언한다.',
    };
  }
  if (gameNos.length > 1) {
    return {
      ...base, supported: false, reason: 'MULTI_GAME_UNSUPPORTED', scopeGameNo: null, blanketFallback: false,
      detail: `multi-game(재경기) 관측: gameNo=${JSON.stringify(gameNos)}. COUNTDOWN_START에 gameNo가 없어 앵커를 게임별로 귀속시킬 수 없으므로 라운드 단위 앵커 판정을 수행하지 않는다(일괄 fallback 적용 금지 — 100% FP 경로).`,
    };
  }
  return { ...base, supported: true, reason: 'SINGLE_GAME', scopeGameNo: gameNos[0], blanketFallback: false };
}

// 진짜 fail-fast 경로(호출부가 "측정 불가"를 예외로 받고 싶을 때). 매트릭스 스윕은 trial 단위
// 리포트를 끊지 않기 위해 예외 대신 correctness FAIL(MULTI_GAME_MEASUREMENT_UNSUPPORTED)을 쓴다 —
// 둘 다 "조용히 잘못된 판정을 내지 않는다"는 동일 요구를 만족하며, 어느 쪽도 PASS가 될 수 없다.
export function assertSingleGameMeasurementScope(world) {
  const scope = resolveMeasurementGameScope(world);
  if (!scope.supported) {
    const err = new Error(`CEO_MEASUREMENT_UNSUPPORTED_SCOPE: ${scope.reason} — ${scope.detail}`);
    err.measurementScope = scope;
    throw err;
  }
  return scope;
}

export function computeCountdownAnchorUnits(world, mutations) {
  const mut = resolveMutations(mutations);
  // §M-C: 이 trial이 공식 측정 범위(single-game) 안에 있는가를 먼저 결정한다.
  const gameScope = resolveMeasurementGameScope(world, mut);
  const transientUnits = [];
  const permanentFailures = [];
  const retryAttemptHistogram = {};
  // §M-1(critic): (roomCode, gameNo, round) → device → 그 기기가 실제로 사용한 유효 anchor 집합.
  // host republishCountdownStartAsHost()(index.html:7418-7436)는 getNextCountdownStartAt()으로
  // "새" 앵커를 만들기 때문에, 이미 옛 앵커로 카운트다운을 시작한 기기와 앵커가 갈릴 수 있다.
  // 기기별 판정("나는 유효 앵커로 시작했는가")만으로는 이 divergence가 전부 PASS로 흡수된다.
  const anchorsByRoundKey = new Map();
  const noteAnchor = (key, deviceId, ts, round, roomCode, gameNo) => {
    if (!anchorsByRoundKey.has(key)) anchorsByRoundKey.set(key, { key, round, roomCode, gameNo, byDevice: new Map() });
    const entry = anchorsByRoundKey.get(key);
    if (!entry.byDevice.has(deviceId)) entry.byDevice.set(deviceId, []);
    entry.byDevice.get(deviceId).push(ts);
  };
  let invalidCountdownServerTsCount = 0;
  let countdownSyncFailedCount = 0;
  let republishCount = 0;
  let countdownStartCount = 0;
  let validAnchorCount = 0;

  for (const d of world.devices) {
    const state = (d.impl && d.impl.state) || {};
    const roomCode = state.roomCode != null ? state.roomCode : (d.roomStore && d.roomStore.id) || null;
    // ── §M-C: "트라이얼 종료 시점 state.gameRound를 모든 라운드에 일괄 적용"을 제거한다 ──────
    // 수정 전: `const fallbackGameNo = state.gameRound ?? null` 을 그 기기의 모든 round 유닛에
    // 그대로 박아 넣었다(그리고 아래 `if (u.gameNo == null) u.gameNo = e.gameNo`는 이미 non-null이라
    // 사실상 죽은 코드였다 — 이벤트가 싣고 온 진짜 gameNo조차 무시됐다).
    // 수정 후: single-game scope로 확인된 경우에만 그 유일 gameNo를 쓰고(그 값은 정의상 모든
    // 라운드에 대해 옳다), 확인되지 않으면 null로 두고 이벤트가 싣고 온 값만 채택한다(추정 금지).
    const scopeGameNo = gameScope.blanketFallback
      ? (state.gameRound != null ? state.gameRound : null) // mutation: 수정 전 일괄 fallback 재현
      : (gameScope.supported ? gameScope.scopeGameNo : null);
    // round → 이 기기의 그 라운드 countdown 관련 REAL 이벤트 묶음.
    const byRound = new Map();
    const touch = (round) => {
      if (!byRound.has(round)) {
        byRound.set(round, {
          round, gameNo: scopeGameNo, invalidAttempts: [], countdownStarts: [],
          syncFailed: 0, republished: 0, staleAbortedAtAnchorCheckpoint: false,
          staleAbortCheckpoints: [], countdownRenders: 0,
        });
      }
      return byRound.get(round);
    };
    for (const e of d.telemetry.events) {
      if (e.round == null) continue;
      if (e.eventType === 'INVALID_COUNTDOWN_SERVER_TS') {
        const u = touch(e.round);
        u.invalidAttempts.push(e.attempt);
        invalidCountdownServerTsCount++;
        const k = String(e.attempt);
        retryAttemptHistogram[k] = (retryAttemptHistogram[k] || 0) + 1;
      } else if (e.eventType === 'COUNTDOWN_START') {
        const u = touch(e.round);
        u.countdownStarts.push(e);
        countdownStartCount++;
        if (e.countdownStartServerTs) validAnchorCount++;
      } else if (e.eventType === 'COUNTDOWN_SYNC_FAILED') {
        touch(e.round).syncFailed++;
        countdownSyncFailedCount++;
      } else if (e.eventType === 'COUNTDOWN_SERVER_TS_REPUBLISHED') {
        touch(e.round).republished++;
        republishCount++;
      } else if (e.eventType === 'COUNTDOWN_STALE_GENERATION_ABORTED') {
        // index.html:7518 checkpoint 1/5 — waitForValidCountdownStart 반환 직후 세대가 이미
        // stale이면 COUNTDOWN_START 없이 조용히 중단한다("더 최신 세대가 대신 진행"이 설계 의도).
        // ⚠️ §M-2(critic): 이 이벤트 자체는 "중단했다"만 말할 뿐 "다른 세대가 실제로 진행했다"는
        // 증거가 아니다 — 아래 면제 조건에서 그 증거를 별도로 요구한다.
        const u = touch(e.round);
        if (e.checkpoint === 'waitForValidCountdownStart') u.staleAbortedAtAnchorCheckpoint = true;
        u.staleAbortCheckpoints.push(e.checkpoint);
      } else if (e.eventType === 'SYNC_RENDER' && e.phase === 'countdown') {
        // COUNTDOWN_START(:7538) → countdown SYNC_RENDER(:7561) 순서이므로, 이 라운드에 countdown
        // SYNC_RENDER가 있다는 것은 "어떤 세대가 실제로 앵커 단계를 통과해 진행했다"는 실증이다.
        touch(e.round).countdownRenders++;
      }
      if (e.gameNo != null && byRound.has(e.round)) {
        const u = byRound.get(e.round);
        if (u.gameNo == null) u.gameNo = e.gameNo;
      }
    }
    for (const u of byRound.values()) {
      const unitKey = makeCountdownUnitKey({ device: d.id, roomCode, gameNo: u.gameNo, round: u.round });
      const base = { unitKey, device: d.id, roomCode, gameNo: u.gameNo, round: u.round };
      const anchoredStarts = u.countdownStarts.filter((e) => !!e.countdownStartServerTs);
      const nullAnchoredStarts = u.countdownStarts.filter((e) => !e.countdownStartServerTs);
      // §M-C: scope가 single-game으로 확인된 경우에만 라운드 단위 앵커 비교 공간을 만든다.
      // multi-game/gameNo 미관측 상태에서 비교 공간을 만들면 서로 다른 게임의 앵커가 같은 roundKey로
      // 병합돼 반드시 divergence가 되므로(100% FP), 아예 만들지 않고 unsupported로 선언한다.
      if (gameScope.supported) {
        for (const e of anchoredStarts) {
          noteAnchor(makeCountdownRoundKey({ roomCode, gameNo: u.gameNo, round: u.round }),
            d.id, e.countdownStartServerTs, u.round, roomCode, u.gameNo);
        }
      }

      // ── permanent 1: participant 하드블록(에러 화면 + 진행 중단) ──
      if (u.syncFailed > 0 && !mut.ignoreCountdownSyncFailed) {
        permanentFailures.push({ ...base, type: 'COUNTDOWN_SYNC_FAILED', count: u.syncFailed });
      }
      // ── permanent 2: COUNTDOWN_START인데 앵커가 falsy(0/null) — 로컬 시계로 desync 진행 ──
      if (nullAnchoredStarts.length > 0 && !mut.ignoreNullCountdownAnchor) {
        permanentFailures.push({ ...base, type: 'COUNTDOWN_START_WITHOUT_ANCHOR', count: nullAnchoredStarts.length });
      }
      // ── permanent 3: 유효 anchor 없이 라운드가 끝남(COUNTDOWN_START 자체가 없음) ──
      // COUNTDOWN_START가 하나라도 있으면 그 판정은 permanent 2가 담당한다(이중 계상 금지 —
      // 그래야 ignoreNullCountdownAnchor mutation이 실제로 검출을 없애 반공허성이 증명된다).
      //
      // ── §M-2(critic HIGH→MEDIUM) stale-abort 면제 조건 좁히기 ────────────────
      // 수정 전: `!u.staleAbortedAtAnchorCheckpoint`만 요구 = "checkpoint 1에서 중단한 적이 있으면
      // 무조건 면제". 그런데 이 규칙이 발화하는 전제는 이미 `countdownStarts.length === 0`(=이
      // 기기의 어떤 세대도 COUNTDOWN_START를 내지 못함)이고, COUNTDOWN_START emit(index.html:7538)은
      // checkpoint 1(:7518) "뒤"·checkpoint 2(leadSleep, :7554) "앞"에 있다. 즉 이 상황은 정확히
      // "모든 세대가 checkpoint 1에서 죽었다"이며, 면제를 정당화하는 명제("더 최신 세대가 대신
      // 진행했다")가 성립하지 않는 경우다 — 면제 조건과 억제 대상이 어긋나 미탐 통로가 된다.
      // 수정 후: 면제하려면 "그 라운드에서 어떤 세대든 실제로 진행했다"는 실증을 요구한다.
      //   (a) 유효 앵커로 COUNTDOWN_START를 낸 세대가 있다(= 이 규칙 전제상 항상 false), 또는
      //   (b) 그 라운드의 countdown SYNC_RENDER가 존재한다(:7561 — 앵커 단계 통과의 실증).
      // 따라서 실무적으로 면제는 (b)로만 성립하며, "중단만 했고 진행 증거가 없는" 경우는 이제
      // 정상적으로 FAIL로 잡힌다(미탐 통로 폐쇄).
      const laterGenerationProceeded = anchoredStarts.length > 0 || u.countdownRenders > 0;
      const staleAbortExempt = mut.staleAbortExemptionUnconditional
        ? u.staleAbortedAtAnchorCheckpoint
        : (u.staleAbortedAtAnchorCheckpoint && laterGenerationProceeded);
      if (u.countdownStarts.length === 0 && u.syncFailed === 0
        && !staleAbortExempt && u.invalidAttempts.length > 0) {
        permanentFailures.push({
          ...base, type: 'ROUND_ENDED_WITHOUT_VALID_ANCHOR', attempts: u.invalidAttempts.length,
          staleAbortCheckpoints: [...u.staleAbortCheckpoints],
          countdownRenders: u.countdownRenders,
        });
      }
      // ── transient: 재시도 카운터(informational). 최종적으로 유효 앵커가 나왔으면 FAIL 아님 ──
      if (u.invalidAttempts.length > 0) {
        const attempts = u.invalidAttempts.length;
        // index.html:7412 `if (!scheduledStartAt && attempt < maxAttempts) await sleep(delayMs)` —
        // 마지막 시도 뒤에는 sleep이 없으므로 sleep 횟수 = attempts-1. (db 왕복 지연은 상한이
        // 없어 여기 포함하지 않는다 — 즉 이 값은 재시도 누적 지연의 "하한" 추정치다.)
        const estimatedRetrySleepMs = Math.max(0, attempts - 1) * COUNTDOWN_RETRY_DELAY_MS;
        transientUnits.push({
          ...base, attempts, attemptSeq: [...u.invalidAttempts], estimatedRetrySleepMs,
          recoveredWithValidAnchor: anchoredStarts.length > 0,
          recoveredByHostRepublish: u.republished > 0,
        });
        if (mut.transientCountdownRetryIsPermanent) {
          permanentFailures.push({ ...base, type: 'COUNTDOWN_SERVER_TS_ZERO', count: attempts });
        }
      }
    }
  }

  // ── §M-1(critic): 라운드별 cross-device anchor 일치 검사(permanent, correctness) ──────────
  // 같은 (roomCode, gameNo, round)에 대해 기기들이 서로 다른 countdownStartServerTs로 카운트다운을
  // 시작했다면, 그 라운드는 "기기마다 다른 시각에 시작"한 것이다. 이 신호는 전파지연과 무관한
  // [범주1] 신호다(값 자체가 서버가 발행한 앵커이고, 지연이 커도 같은 앵커를 받으면 같은 값이다) —
  // 그래서 timing이 아니라 correctness에 넣는 것이 정당하다. timing은 Degraded/Extreme에서
  // 게이트 제외라 이 divergence를 timing에만 맡기면 두 profile에서 검출력이 0이 된다.
  // 노출 경로(REAL): republishCountdownStartAsHost()(index.html:7418-7436)가
  // getNextCountdownStartAt()(=serverNow()+3600)으로 "새" 앵커를 발행하는데, 이미 옛 앵커로 시작한
  // 기기는 그 값을 되돌리지 않는다.
  // ⚠️ 같은 기기가 같은 라운드에 서로 다른 앵커를 2번 쓴 경우(자기 자신과의 divergence)도 포함한다 —
  // 그 기기 화면에서 카운트다운이 두 번 다른 기준으로 시작됐다는 뜻이므로 동일하게 결함이다.
  const anchorDivergences = [];
  for (const entry of anchorsByRoundKey.values()) {
    const distinct = new Set();
    const byDevice = {};
    for (const [deviceId, tsList] of entry.byDevice) {
      byDevice[deviceId] = [...tsList];
      for (const ts of tsList) distinct.add(ts);
    }
    if (distinct.size <= 1) continue;
    anchorDivergences.push({
      type: 'COUNTDOWN_ANCHOR_DIVERGED',
      roundKey: entry.key, roomCode: entry.roomCode, gameNo: entry.gameNo, round: entry.round,
      distinctAnchors: [...distinct].sort((a, b) => a - b),
      spreadMs: Math.max(...distinct) - Math.min(...distinct),
      anchorsByDevice: byDevice,
      deviceCount: entry.byDevice.size,
    });
  }
  if (!mut.ignoreAnchorDivergence) {
    for (const div of anchorDivergences) permanentFailures.push(div);
  }

  // ── §M-C: 측정 범위를 벗어난 trial은 "조용한 오판" 대신 명시적 unsupported로 종결한다 ────────
  // 이 실패는 correctness 채널(clockSync.failures)로 올라가므로 그 trial은 절대 PASS가 될 수 없고,
  // 동시에 COUNTDOWN_ANCHOR_DIVERGED 같은 gameNo 의존 판정은 위에서 아예 생성되지 않는다
  // (= 100% FP 경로 차단). 즉 "차단"과 "은폐"를 분리한다: 수치는 남기고 판정만 보류한다.
  if (!gameScope.supported) {
    permanentFailures.push({
      type: 'MULTI_GAME_MEASUREMENT_UNSUPPORTED',
      reason: gameScope.reason,
      gameNos: gameScope.gameNos,
      gameNoByDevice: gameScope.gameNoByDevice,
      detail: gameScope.detail,
      officialScope: MEASUREMENT_GAME_SCOPE_POLICY.officialScope,
      productionMetricGap: MEASUREMENT_GAME_SCOPE_POLICY.productionMetricGap,
    });
  }

  const estimatedRetrySleepMsTotal = transientUnits.reduce((a, u) => a + u.estimatedRetrySleepMs, 0);
  const estimatedRetrySleepMsMax = transientUnits.reduce((a, u) => Math.max(a, u.estimatedRetrySleepMs), 0);
  return {
    transient: {
      invalidCountdownServerTsCount,
      unitsWithRetry: transientUnits.length,
      retryAttemptHistogram,
      estimatedRetrySleepMsTotal,
      estimatedRetrySleepMsMax,
      republishCount,
      units: transientUnits,
      note: 'INVALID_COUNTDOWN_SERVER_TS는 index.html:7404에서 재시도 "전"에 emit되는 시도 카운터다 — 1회차에 즉시 복구돼도 1건 남는다. release-gate FAIL이 아니라 informational.',
    },
    permanentFailures,
    countdownStartCount,
    validAnchorCount,
    countdownSyncFailedCount,
    // §M-1(critic): 검출 여부(mutation)와 무관하게 "관측된 divergence"는 항상 리포트에 남긴다 —
    // 사후 집계로 "이론적 노출인가 실제 결함인가"를 판별할 수 있어야 하기 때문(은폐 금지).
    anchorDivergences,
    anchorRoundKeyCount: anchorsByRoundKey.size,
    // §M-C: 이 trial이 공식 측정 범위(single-game) 안이었는지, 아니면 어떤 이유로 차단됐는지.
    gameScope,
    anchorComparisonPerformed: gameScope.supported,
  };
}

// ── §CRITICAL-1: clock sync settle 실측(정보 보존 — NOT_SYNCED를 게이트에서 뺀 대신 필수 보고) ──
// 하니스 telemetry는 emit 시각을 `__t`(= 페이크타이머 전역 Date.now(), device skew 미포함)로
// 남긴다(rc3-harness-support.mjs createTelemetry). 그래서 하니스 파일을 수정하지 않고도
// "각 기기가 언제 clock sync를 끝냈는가"를 사후 재구성할 수 있다.
//   settleMs(device) = (마지막 성공 CLOCK_SYNC emit __t) - (그 trial의 첫 telemetry __t)
// ⚠️ 하한 추정치다: 기준점이 "trial 시작"이 아니라 "첫 telemetry emit"(= 첫 RPC 응답 시점,
// 최소 rttBase만큼 뒤)이라 실제 settle 지연보다 rtt 한 번만큼 작게 나온다. 과대보고가 아니라
// 과소보고 방향이므로 "예산이 충분했는가"를 판단하는 용도로는 보수적(안전)이다.
export function computeClockSyncSettleStats(world) {
  let t0 = null;
  for (const d of world.devices) {
    for (const e of d.telemetry.events) {
      if (typeof e.__t !== 'number') continue;
      if (t0 == null || e.__t < t0) t0 = e.__t;
    }
  }
  const perDevice = [];
  for (const d of world.devices) {
    let settledAt = null;
    for (const e of d.telemetry.events) {
      if (e.kind !== 'clocksync' || e.eventType !== 'CLOCK_SYNC') continue;
      if (!e.synced || !(e.samples > 0)) continue;
      if (typeof e.__t !== 'number') continue;
      if (settledAt == null || e.__t < settledAt) settledAt = e.__t;
    }
    perDevice.push({
      device: d.id,
      settleMs: (settledAt != null && t0 != null) ? settledAt - t0 : null,
    });
  }
  const measured = perDevice.map((p) => p.settleMs).filter((v) => v != null);
  return {
    baseTs: t0,
    perDevice,
    measuredDeviceCount: measured.length,
    unmeasuredDeviceCount: perDevice.length - measured.length,
    maxSettleMs: measured.length ? Math.max(...measured) : null,
    minSettleMs: measured.length ? Math.min(...measured) : null,
    note: 'settleMs는 "첫 telemetry emit" 기준 하한 추정치(첫 RPC의 rtt만큼 과소평가). 하니스 파일 무수정 원칙 하에 재구성한 값이다.',
  };
}

// ── §Phase0/§Phase2: CEO PASS-unit 판정(runEliminationTrial 결과 위에 얹는 후처리 — 판정 로직
// 자체를 다시 실행하지 않고, 이미 REAL 실행으로 쌓인 telemetry/world 상태만 재해석한다). ──
export function computeCeoPassUnits(trialResult, { mutations } = {}) {
  const mut = resolveMutations(mutations);
  const {
    world, participantCount, finalRound, hardFailureModes, completed, oraclePerRound,
  } = trialResult;
  const hf = (type) => hardFailureModes.some((f) => f.type === type);
  // §probe 실측(tests/ceo-official-measurement.test.mjs 개발 중 확인, 임시 probe로 직접 관찰):
  // confirmedSafeIds/LoserIds로 이미 확정된 참가자는 그 다음 라운드부터 showGameScreen()의
  // isCurrentRoundParticipant() 라우팅으로 screenWinnerWait/screenLoserWait로 빠져 더 이상
  // runCountdownThenShowGame()의 countdown/choice SYNC_RENDER를 남기지 않는다(설계상 정상 —
  // "결정된 참가자는 대기 화면"). 그래서 countdown/choice phase의 올바른 기대 커버리지는
  // oraclePerRound[r].activeIds(EG 오라클이 독립 재계산한 그라운드 트루스)의 크기다.
  // ⚠️ result/nextRound는 이 라우팅 "이전"인 handleRoomUpdate에서 렌더되므로 전 기기가 기대치다 —
  // 위 expectedPhaseCoverageFor 주석(§M-1, index.html:5895/:6017 호출 위치 근거) 참고.
  const activeCountByRound = new Map();
  for (const o of (oraclePerRound || [])) {
    if (!o.oracleIncomplete && Array.isArray(o.activeIds)) activeCountByRound.set(o.round, o.activeIds.length);
  }
  // "해당 room/gameNo/round에 존재한 전체 participating devices" — 이 하니스는 중도 입퇴장을
  // 모델링하지 않으므로(§Phase0) trial 내내 world.devices가 곧 그 집합이며 participantCount와 같다.
  const participatingDeviceCount = world.devices.length;

  // ── Clock/Sync ──
  // ════════════════════════════════════════════════════════════════════════
  // §CRITICAL-1(critic): NOT_SYNCED는 correctness 게이트에서 강등한다(informational).
  //
  // NOT_SYNCED의 출처는 REAL이 아니라 하니스다: rc3-harness-support.mjs의
  // `clockSyncBudgetMs`(고정 예산) 안에 "전 기기가 getServerClockSynced()==true"가 되지 못하면
  // world.__clockSyncSettled=false가 되고 CLOCK_SYNC_NOT_SETTLED 하드실패가 찍힌다.
  // REAL(index.html:4461-4542 syncServerClock)에는 이런 데드라인이 존재하지 않는다:
  //   · 샘플당 withTimeout(db.rpc('server_now'), 4000) × 5회, 실패 시 sleep(1500) 후 5회 재시도
  //     = 최악 ~41.5초까지 정상적으로 진행한다(실패가 아니라 느린 것뿐).
  //   · serverClockSynced는 순수 진단 플래그다 — index.html 어디에서도 게임 진행을 게이팅하지
  //     않으며, serverNow()는 offset 0 폴백으로 계속 동작한다.
  // 즉 "예산 안에 못 끝났다"는 REAL 사용자에게 어떤 관측 가능한 결함도 만들지 않는 하니스
  // 아티팩트이며, 이것을 correctness(100% 요구) 게이트에 넣으면 출시 판정이 하니스 예산 상수에
  // 좌우된다. → 판정에서 제외하고, 대신 아래 clockSyncSettle로 "얼마나 늦었는지"를 반드시 남긴다.
  //
  // ⚠️ 유지되는 것(REAL이 명시적으로 실패로 구분하는 상태만 correctness에 남긴다):
  //   · NO_VALID_SAMPLE(samples===0 / synced===false) — REAL이 CLOCK_SYNC_FAILED(:4538-4540)로
  //     구분하는 "10회 RPC 전부 실패" 상태.
  //   · COUNTDOWN_SYNC_FAILED(참가자 하드블록) / COUNTDOWN_START_WITHOUT_ANCHOR /
  //     ROUND_ENDED_WITHOUT_VALID_ANCHOR / COUNTDOWN_ANCHOR_DIVERGED(permanent 4종).
  // ════════════════════════════════════════════════════════════════════════
  const clockSyncFailures = [];
  const clockSyncInformational = [];
  if (!world.__clockSyncSettled) {
    const notSettled = {
      type: 'NOT_SYNCED',
      reason: 'HARNESS_CLOCK_SYNC_BUDGET_EXCEEDED',
      note: '하니스 고정 예산 초과. REAL syncServerClock에는 대응하는 데드라인이 없고 serverClockSynced는 진행을 게이팅하지 않는다 — correctness 판정 제외(informational).',
    };
    if (mut.notSyncedIsCorrectnessFailure) clockSyncFailures.push(notSettled);
    else clockSyncInformational.push(notSettled);
  }
  // §CRITICAL-1 정보 보존: 예산 초과 여부만이 아니라 "실측 settle 지연 분포"를 남긴다.
  const clockSyncSettle = computeClockSyncSettleStats(world);
  for (const d of world.devices) {
    const evs = d.telemetry.events.filter((e) => e.kind === 'clocksync' && e.eventType === 'CLOCK_SYNC');
    const last = evs[evs.length - 1];
    if (!last || !last.synced || !(last.samples > 0)) {
      clockSyncFailures.push({
        type: 'NO_VALID_SAMPLE', device: d.id,
        samples: last ? last.samples : null, synced: last ? !!last.synced : null,
        clockSyncEventCount: evs.length,
      });
    }
  }
  // §H-2: countdown anchor는 transient(재시도 카운터) / permanent(release-gate FAIL)로 분리한다.
  const countdownAnchor = computeCountdownAnchorUnits(world, mut);
  for (const f of countdownAnchor.permanentFailures) clockSyncFailures.push(f);
  let invalidTotal = countdownAnchor.transient.invalidCountdownServerTsCount;
  for (const d of world.devices) {
    for (const e of d.telemetry.events) {
      if (typeof e.eventType === 'string' && e.eventType !== 'INVALID_COUNTDOWN_SERVER_TS' && e.eventType.includes('INVALID')) invalidTotal++;
    }
  }
  const clockSync = {
    pass: clockSyncFailures.length === 0,
    synced: world.__clockSyncSettled,
    // 기존 필드명은 하위호환을 위해 유지하되 의미를 명시적으로 재정의한다:
    // countdownServerTsZero는 이제 "transient 재시도 시도 건수"이며 그 자체로는 FAIL이 아니다.
    countdownServerTsZero: countdownAnchor.transient.invalidCountdownServerTsCount,
    countdownSyncFailed: countdownAnchor.countdownSyncFailedCount,
    invalidTotal,
    // §H-2 재분류 필드(128건 같은 기존 수치를 permanent/transient로 다시 나눠볼 수 있는 통로).
    countdownTransient: countdownAnchor.transient,
    countdownPermanentFailures: countdownAnchor.permanentFailures,
    countdownStartCount: countdownAnchor.countdownStartCount,
    validAnchorCount: countdownAnchor.validAnchorCount,
    // §M-1(critic): 관측된 cross-device anchor divergence(판정 반영 여부와 무관하게 항상 노출).
    anchorDivergences: countdownAnchor.anchorDivergences,
    anchorRoundKeyCount: countdownAnchor.anchorRoundKeyCount,
    // §M-C: 측정 scope(single-game 한정) — unsupported면 앵커 비교 자체를 수행하지 않았다는 표시.
    gameScope: countdownAnchor.gameScope,
    anchorComparisonPerformed: countdownAnchor.anchorComparisonPerformed,
    // §CRITICAL-1: 게이트에서 뺀 대신 반드시 보고해야 하는 정보성 신호 2종.
    informational: clockSyncInformational,
    notSettledWithinHarnessBudget: !world.__clockSyncSettled,
    settle: clockSyncSettle,
    failures: clockSyncFailures,
  };

  // ── Timing(≤250ms, CEO 신규 상수) ──
  const timingViolations = [];
  const perRoundGaps = [];
  for (let r = 1; r <= finalRound; r++) {
    const cov = computeRoundPhaseCoverage(world, r);
    for (const phase of CEO_TIMING_PHASES) {
      const { diff } = cov[phase];
      if (diff == null) continue; // coverage<2 — timing 비교 불가(별도 progression 커버리지 체크가 처리)
      const diffMs = Math.round(diff);
      perRoundGaps.push({ round: r, phase, diffMs });
      if (diffMs > CEO_PHASE_TIMING_LIMIT_MS) timingViolations.push({ round: r, phase, diffMs });
    }
  }
  const worstGap = perRoundGaps.reduce((a, b) => (a == null || b.diffMs > a.diffMs ? b : a), null);
  const timing = { pass: timingViolations.length === 0, violations: timingViolations, worstGap, perRoundGaps };

  // ── §H-2 상관 리포트: transient 재시도가 timing 실패에 기여했는가 ──────────────
  // 재시도 sleep은 최대 (5-1)×500 = 2000ms이고 여기에 최대 5회의 db 왕복이 더해진다(index.html
  // :7398 주석의 "최대 2.5s"). 250ms timing 게이트 기준에서 이 지연은 그 기기 하나만 늦추므로
  // 곧바로 phase spread를 악화시킨다 — transient가 "FAIL은 아니지만 무해하지도 않다"는 증거를
  // 남기기 위해 라운드 단위로 겹침을 별도 집계한다(게이트 판정에는 반영하지 않음).
  const transientRounds = new Set(countdownAnchor.transient.units.map((u) => u.round));
  const timingViolationsInTransientRounds = timingViolations.filter((v) => transientRounds.has(v.round));
  const transientTimingCorrelation = {
    transientRounds: [...transientRounds].sort((a, b) => a - b),
    transientUnitCount: countdownAnchor.transient.units.length,
    timingViolationCount: timingViolations.length,
    timingViolationsInTransientRounds,
    estimatedRetrySleepMsMax: countdownAnchor.transient.estimatedRetrySleepMsMax,
    note: 'transient는 release-gate FAIL이 아니지만 재시도 지연(최대 sleep 2000ms + 최대 5회 db 왕복, index.html:7398 "최대 2.5s")이 250ms timing 게이트를 직접 악화시킬 수 있다 — 상관만 보고하고 판정에는 쓰지 않는다.',
  };

  // ── Progression(1게임 사이클: 방생성~참가~시작~선택~판정~partial replay~gameOver, 무정지) ──
  const progressionFailures = [];
  if (!completed) progressionFailures.push({ type: 'STALL_OR_INCOMPLETE' });
  if (hf('EXCEPTION')) progressionFailures.push({ type: 'EXCEPTION' });
  const missingRenderRounds = [];
  if (completed) {
    for (let r = 1; r <= finalRound; r++) {
      const cov = computeRoundPhaseCoverage(world, r);
      const ctx = {
        round: r,
        // 오라클 데이터가 없는 라운드(oracleIncomplete/범위 밖)는 activeIds 기반 phase만 판정 불가로
        // 스킵된다(과탐 방지) — result/nextRound는 오라클과 무관하게 판정할 수 있다.
        activeCount: activeCountByRound.has(r) ? activeCountByRound.get(r) : null,
        participatingDeviceCount,
      };
      for (const phase of PROGRESSION_COVERAGE_PHASES) {
        const expected = expectedPhaseCoverageFor(phase, ctx, mut);
        if (expected == null) continue;
        const covKey = phase === 'nextRound' ? 'ready' : phase;
        if (cov[covKey].coverage < expected) {
          // §M-4(critic): 이 채널이 발화했을 때 원인 분류에 필요한 최소 진단을 실패 detail에 싣는다
          // (아래 §M-4 판정 기준 주석 참고 — 어느 기기가 / 어느 라운드에 / 무엇을 렌더했는지).
          const rendered = cov[covKey].deviceIds;
          const missingDevices = rendered == null
            ? null
            : world.devices.filter((d) => !rendered.includes(d.id)).map((d) => d.id);
          missingRenderRounds.push({
            round: r, phase, coverage: cov[covKey].coverage, of: expected,
            expectationBasis: expectationBasisFor(phase, mut),
            missingDevices,
            renderedDevices: rendered,
            traces: missingDevices == null
              ? null
              : world.devices.filter((d) => missingDevices.includes(d.id)).map(describeDeviceRenderTrace),
          });
        }
      }
    }
  }
  if (missingRenderRounds.length) progressionFailures.push({ type: 'MISSING_PHASE_RENDER', detail: missingRenderRounds });
  const progression = {
    pass: progressionFailures.length === 0,
    completed, finalRound, failures: progressionFailures,
    // §Phase0 한계(정직 표기): gameOver 이후 재경기(2번째 게임 사이클)~세션 종료까지의 연속
    // 진행은 이 N×profile 스윕에 포함되지 않는다(별도 표적 시나리오만 존재).
    rematchLifecycleModeled: false,
  };

  // ── Rules(draw/tooMany/tooFew/multi-tagger/winners-losers replay/confirmedIds/active candidates) ──
  const rulesTypes = ['PHANTOM_OR_CORRUPTED_OUTCOME', 'ROUND_NOT_MONOTONIC', 'DOUBLE_COUNTDOWN_RENDER', 'STALE_ROW_REGRESSION', 'READY_BRANCH_STATE_CLOBBER'];
  const rulesFailures = hardFailureModes.filter((f) => rulesTypes.includes(f.type));
  const rules = {
    pass: rulesFailures.length === 0,
    failures: rulesFailures,
    outcomeCounts: trialResult.outcomeCounts,
    hardblockModeled: false, // Build23 하드블록/에러화면: DOM/화면 상태 자체를 모델링하지 않음
    build242829RegressionCoveredElsewhere: true, // 별도 단위 테스트 파일이 커버(이 매트릭스 범위 밖)
  };

  // ── Audio(미모델, pass/fail에 반영 안 함) ──
  const audio = {
    modeled: false,
    note: 'playVoiceClip/SoundManager는 브라우저 AudioContext 의존이라 Node 하니스에 추출되지 않음(env no-op 스텁). audioMissing/audioDuplicate/AbortError/이벤트ID 중복은 이 매트릭스로 측정 불가.',
  };

  // ── Result(resultValueNull/shadowMismatch=미모델, 전기기 판정일치=모델) ──
  const crossDeviceMismatch = hardFailureModes.filter((f) => f.type === 'CROSS_DEVICE_OUTCOME_MISMATCH');
  const result = {
    pass: crossDeviceMismatch.length === 0,
    crossDeviceOutcomeMismatch: crossDeviceMismatch,
    resultValueNullModeled: false, // __engineV2ShadowCompare 미추출 + ENGINE_V2_SHADOW 기본 비활성
    shadowMismatchModeled: false,
  };

  // §C-1: correctness(=timing을 제외한 전 범주)와 timing을 분리 노출한다 — Release Gate가
  // "timing은 Normal만, correctness는 3 profile 전부 100%"라는 서로 다른 정책을 적용하기 때문.
  const correctnessPass = clockSync.pass && progression.pass && rules.pass && result.pass;
  const ceoPass = correctnessPass && timing.pass; // audio는 제외(미모델)

  return {
    clockSync, timing, progression, rules, audio, result,
    correctnessPass, timingPass: timing.pass, ceoPass,
    transientTimingCorrelation,
    participantCount, participatingDeviceCount,
    // §M-C: 공식 측정 scope. supported=false면 이 trial은 "측정 불가"로 종결되며(=PASS 불가),
    // gameNo 의존 판정(COUNTDOWN_ANCHOR_DIVERGED)은 수행되지 않았다.
    measurementScope: {
      officialScope: MEASUREMENT_GAME_SCOPE_POLICY.officialScope,
      multiGameSupported: MEASUREMENT_GAME_SCOPE_POLICY.multiGameSupported,
      ...countdownAnchor.gameScope,
      anchorComparisonPerformed: countdownAnchor.anchorComparisonPerformed,
    },
  };
}

// ── §Phase1: Profile 3종(근거 파라미터) ──────────────────────────────────────
// 기존 export된 knob만 조합(신규 harness 코드 없음, 회귀 위험 최소화):
//   realtimeDelayRegime: sampleRealtimeDelayMs의 optimistic/moderate/pessimistic 분포(§rc3-harness
//     -support.mjs 정의부 그대로) — Normal=optimistic(body 50~350ms, tail 900~2000ms),
//     Degraded=moderate(body 120~800ms, tail 2200~4500ms), Extreme=pessimistic(body
//     200~1400ms, tail 4000~9000ms).
//   deliveryOrderMode: Normal=monotonic(단일 순서보장 realtime, §충실성 기본), Degraded/
//     Extreme=outOfOrder(폴링-realtime 이중경로 재정렬 스트레스, §STOP-SHIP Part A/§Phase2).
//   skewMsOverrideFn: 기기 wall-clock skew 폭 — Normal은 좁고 대칭(저지터/소skew 가정,
//     ±300ms급 실기기 NTP 동기화 오차), Degraded는 절반은 +방향 절반은 -방향으로 이분화한
//     중간 폭(중skew, ±600~2100ms대, "비대칭" 요구 충족), Extreme은 기존
//     createAlternatingSkewFn(5000)(±3500~5000ms대, RC-3 §Part B가 이미 실집행 검증한 값 재사용).
//   packet loss 근거 강도(낮음, §7 명시): Supabase realtime은 WebSocket(TCP) 위의 순서보장
//     스트림이라 애플리케이션 레이어에서 "패킷이 조용히 사라지는" 손실은 발생하지 않는다(연결이
//     끊기면 재연결/재구독이 필요하고, 그 disconnect/reconnect 경로 자체는 이 하니스가 추출하지
//     않음, §Phase0 미모델 표기). 그래서 Degraded/Extreme의 "제한적 loss"는 sampleRealtimeDelayMs의
//     tail 분기(느린 재시도/지연으로 도착하는 것과 동등한 효과)로 근사한다 — 공학적 가정이며
//     실측 대체물이 아니다.
//   host변경/입장순서랜덤/background·foreground/disconnect·reconnect는 메인 스윕 루프
//     (createTrialWorld/runEliminationTrial)가 host=devices[0] 고정, 참가 순서 고정 구조라
//     이 3개 profile 매트릭스에는 주입되지 않는다(§Phase0 미모델, 별도 표적 시나리오만 존재).
// ── §STOP-SHIP §Step1(clockRtt 정직화, critic 지적): 기존 sampleClockRtt(rng, deviceIndex)는
// profile/realtimeDelayRegime과 무관하게 항상 120~500ms 기본 RTT + jitterFrac=0.4 고정분포였다 —
// Degraded/Extreme profile이 realtime 전파 지연(sampleRealtimeDelayMs)은 늘리면서도 "clock sync
// RPC(db.rpc('server_now')) 자체의 RTT"는 Normal과 동일하게 낮게 유지했다는 뜻이라, 그 두 profile의
// serverClockOffsetMs 추정 오차(및 그로 인한 phaseScheduledAt 평가 오차)를 과소측정하고 있었다.
// makeClockRttOverrideFn(위 §Step1, rc3-harness-support.mjs)으로 profile별 RTT 분포를 명시한다.
//   근거: clock sync RPC는 Supabase의 단일 요청-응답(postgres RPC)이지 postgres_changes 팬아웃
//   브로드캐스트가 아니므로, sampleRealtimeDelayMs의 tail값(예: pessimistic 4000~9000ms)을 그대로
//   가져오는 것은 과도하다(별도 채널, §rc3-harness-support.mjs §Part A/B 주석 참고) — 그러나 "같은
//   열화된 네트워크 조건"이 있다면 RPC RTT도 body 구간은 함께 늘어나는 것이 공학적으로 합리적이다.
//   그래서 각 profile의 realtimeDelayRegime "body" 상한(REALTIME_DELAY_REGIMES.bodyHi)을 clockRtt
//   기본 RTT 상한의 앵커로 재사용한다(새 숫자를 발명하지 않고 이미 이 파일이 쓰는 근거 있는 값에
//   맞춤): optimistic bodyHi=350 → Normal, moderate bodyHi=800 → Degraded, pessimistic
//   bodyHi=1400 → Extreme. 하한은 기존 sampleClockRtt 하한(120ms)을 그대로 유지해 Normal이
//   기존값보다 낮게 측정되는 일이 없게 한다(과소측정 방지가 목적이지 새로운 낙관 편향을 만드는 게
//   아니다). jitterFrac은 기존 0.4를 그대로 쓰되 Degraded/Extreme은 열화된 네트워크의 변동성이 더
//   크다는 가정으로 소폭(0.5/0.6) 키운다 — 이 값들도 실측이 아니라 공학적 가정임을 명시(§7).

// ── §C-1: profile별 clock 잔차 "천장"(구조적 상한) ────────────────────────────
// 하니스는 기기별 RTT 비대칭 upFrac을 trial 내내 고정한다(rc3-harness-support.mjs:691
// `clockRttFn: () => clockRtt` — createDevice가 기기당 1회만 샘플링한 {rttBase, upFrac, jitterMs}를
// 매 rpc 호출에 그대로 돌려준다). rpc('server_now')는 serverMs = trueAtCallStart + rtt*upFrac을
// 돌려주므로(:451), 왕복 대칭을 가정하는 어떤 오프셋 추정기(min-RTT 포함)도 rtt*(upFrac-0.5)라는
// 계통 편향을 제거할 수 없다 — 샘플을 아무리 많이 모아도 사라지지 않는다.
// asymmetrySwing ∈ [-0.3, +0.3](:309)이므로 기기 1대의 잔차 한계는 0.3*rttBase, 두 기기가 서로
// 반대 방향이면 최대 spread = 2*0.3*rttBase_max = 0.6*rttBaseMax.
// jitterMs는 호출마다 부호가 바뀌는 무작위 성분이라 min-RTT 선택으로 완화되는 방향이므로 이
// "구조적 천장"에는 포함하지 않는다(포함하면 천장이 과대평가된다).
// ⚠️ 이 값은 "이론적 상한"이지 실제 분포의 기대값이 아니다 — 실제 성공률은 이 천장 아래에서
// rttBase/upFrac 분포와 N(기기 수, 최댓값 통계)에 따라 결정된다.
export function computeClockSpreadCeilingMs({ rttBaseMax, asymmetrySwingHalfWidth = 0.3 }) {
  return Math.round(2 * asymmetrySwingHalfWidth * rttBaseMax);
}

// ════════════════════════════════════════════════════════════════════════════
// §M-5(critic): "천장 > 250ms ⇒ 95% 도달 불가"는 논증으로 불충분하다 — 분포 논증으로 교체.
//
// 종전 근거: "clockSpreadCeilingMs(480/840)가 250ms를 넘으므로 도달 불가". 이건 성립하지 않는다.
// 상한이 250을 넘는다는 것은 "250을 넘는 실현값이 가능하다"일 뿐, 그 확률이 5%를 넘는다는 뜻이
// 아니다(상한을 넘는 사건이 0.1%면 95% 게이트는 여전히 달성 가능하다). 게다가 이 "천장"은 엄밀한
// 상한도 아니다: rtt = max(1, round(rttBase + jitter))이므로 jitter가 양수로 몰린 샘플만 5개
// 뽑히면 min-RTT조차 rttBase를 넘을 수 있어 실현 spread가 0.6*rttBaseMax를 초과할 수 있다
// (아래 MC에서 Normal max=213ms > 천장 210ms로 실제 관측된다).
//
// 올바른 근거는 잔차 분포다. 모델(하니스 코드에서 직접 유도, 새 가정 없음):
//   rttBase ~ U(rttBaseMin, rttBaseMax), upFrac = clamp(0.5 + U(-0.3,0.3)), jitterMs = U(0,1)*rttBase*jitterFrac
//     → 기기당 1회만 샘플링되어 trial 내내 고정(rc3-harness-support.mjs createDevice / clockRttFn)
//   rpc: rtt_i = max(1, round(rttBase + U(-jitterMs, jitterMs))), serverMs = round(t0_true + rtt_i*upFrac)
//   client(index.html:4482): offset_i = round(serverMs - t0_dev - rtt_i/2)
//     → serverNow() = trueNow + rtt_sel*(upFrac - 0.5)   [device skew는 완전히 상쇄된다]
//   min-RTT 선택(index.html selectClockSyncOffset) + corroboration 실패 시 median 폴백.
//   기기 간 렌더 spread의 clock 성분 = max_i(residual_i) - min_i(residual_i).
// 이 분포를 아래 simulateClockResidualSpread()가 그대로 재현한다(결정론적 mulberry32).
//
// 실행 결과(N을 3..20 균등 혼합, 200,000 trial, seed 20260801 / 재현: 아래 [M5-1] 테스트):
//   | profile  | 천장(참고) | p50 | p95 | p99 | max | P(>250ms) |
//   | Normal   | 210      | 113 | 155 | 170 | 207 |   0.0%    |
//   | Degraded | 480      | 230 | 336 | 375 | 473 |  38.7%    |
//   | Extreme  | 840      | 378 | 571 | 643 | 829 |  82.8%    |
// (codex-critic 독립 MC: 114/155/198/0.0%, 231/336/447/39.3%, 381/571/775/81.8% — 동일 결론.)
//
// 결론(변경 없음): Normal은 clock 잔차만으로는 250ms 게이트를 절대 깨지 않는다(P=0.0%) →
// Normal의 timing 미달은 "코드/스케줄링 문제"로 읽어야 하며 게이트에 포함한다.
// Degraded는 trial의 38.7%, Extreme은 82.8%가 clock 잔차만으로 이미 250ms를 초과한다. 게다가
// 한 trial에는 라운드×5 phase의 다수 비교가 있어 "trial 전체 PASS"가 되려면 그 전부가 250ms
// 이하여야 하므로, trial 단위 실패율은 위 단일 비교 확률보다 크게 높아진다. index.html을 어떻게
// 고쳐도(전파지연 0, 완벽한 스케줄링을 가정해도) 두 profile의 timing 95%는 달성할 수 없다 →
// 게이트에서 제외하되 수치는 그대로 보고한다.
// ════════════════════════════════════════════════════════════════════════════
export const CLOCK_RESIDUAL_SPREAD_MC = Object.freeze({
  model: 'residual_i = rtt_sel_i * (upFrac_i - 0.5); spread = max_i - min_i (device skew cancels)',
  trials: 200000,
  seed: 20260801,
  nMix: '3..20 uniform',
  byProfile: Object.freeze({
    Normal: Object.freeze({ p50: 113, p95: 155, p99: 170, max: 207, pOver250: 0.0 }),
    Degraded: Object.freeze({ p50: 230, p95: 336, p99: 375, max: 473, pOver250: 38.7 }),
    Extreme: Object.freeze({ p50: 378, p95: 571, p99: 643, max: 829, pOver250: 82.8 }),
  }),
  criticIndependentRun: Object.freeze({
    Normal: Object.freeze({ p50: 114, p95: 155, max: 198, pOver250: 0.0 }),
    Degraded: Object.freeze({ p50: 231, p95: 336, max: 447, pOver250: 39.3 }),
    Extreme: Object.freeze({ p50: 381, p95: 571, max: 775, pOver250: 81.8 }),
  }),
});

// 재현용 결정론 RNG(하니스 mulberry32와 동일 계열 — 이 측정 레이어 전용 사본, 하니스 무수정).
export function mulberry32ForMc(a) {
  return function next() {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// 위 모델을 그대로 구현한 재현 스크립트(테스트 [M5-1]이 실제로 호출해 표를 재생성한다).
export function simulateClockResidualSpread({ rttBaseMin, rttBaseMax, jitterFrac, trials = 200000, seed = 20260801, nMin = 3, nMax = 20 }) {
  const rnd = mulberry32ForMc(seed);
  const devResidual = () => {
    const rttBase = rttBaseMin + rnd() * (rttBaseMax - rttBaseMin);
    const upFrac = Math.min(0.95, Math.max(0.05, 0.5 + (rnd() - 0.5) * 0.6));
    const jitterMs = rnd() * rttBase * jitterFrac;
    let best = null;
    const samples = [];
    for (let k = 0; k < 5; k++) {
      const rtt = Math.max(1, Math.round(rttBase + (rnd() - 0.5) * 2 * jitterMs));
      const off = Math.round(rtt * (upFrac - 0.5));
      samples.push({ rtt, off });
      if (!best || rtt < best.rtt) best = { rtt, off };
    }
    // index.html selectClockSyncOffset: min-RTT 채택, median과 크게 어긋나면 median 폴백.
    const sorted = samples.slice().sort((a, b) => a.off - b.off);
    const med = sorted[Math.floor(sorted.length / 2)];
    return Math.abs(best.off - med.off) > (best.rtt / 2 + med.rtt / 2) ? med.off : best.off;
  };
  const spreads = [];
  for (let t = 0; t < trials; t++) {
    const n = nMin + Math.floor(rnd() * (nMax - nMin + 1));
    let lo = Infinity; let hi = -Infinity;
    for (let i = 0; i < n; i++) {
      const r = devResidual();
      if (r < lo) lo = r;
      if (r > hi) hi = r;
    }
    spreads.push(hi - lo);
  }
  spreads.sort((a, b) => a - b);
  const q = (p) => Math.round(spreads[Math.min(spreads.length - 1, Math.floor(p * spreads.length))]);
  return {
    p50: q(0.5), p95: q(0.95), p99: q(0.99),
    max: Math.round(spreads[spreads.length - 1]),
    pOver250: Number((spreads.filter((s) => s > 250).length / spreads.length * 100).toFixed(1)),
    trials,
  };
}

// §C-1 CEO 확정 정책: profile별 역할.
//   release_gate  = 출시를 막는 게이트(timing 95% + correctness 100%).
//   informational = timing은 게이트 제외(보고 필수), correctness는 여전히 100% 요구.
//   stress        = 동상. 다만 "정상 조건이 아님"을 이름으로 분명히 한다.
export const PROFILE_ROLES = Object.freeze({
  Normal: 'release_gate',
  Degraded: 'informational',
  Extreme: 'stress',
});

export const PROFILES = {
  Normal: {
    label: 'Normal',
    profileRole: PROFILE_ROLES.Normal,
    realtimeDelayRegime: 'optimistic',
    deliveryOrderMode: 'monotonic',
    pollingEnabled: true,
    skewMsOverrideFn: ({ isHost, rng }) => (isHost ? 0 : Math.round((rng() - 0.5) * 600)), // ±300ms 대칭
    // 저RTT: 기존 sampleClockRtt 하한(120ms)~optimistic bodyHi(350ms) — 기존값보다 좁고 낮음.
    clockRttBaseMin: 120, // §M-5 MC 재현 파라미터(아래 clockRttOverrideFn 인자와 반드시 동일)
    clockRttBaseMax: 350,
    clockRttJitterFrac: 0.4,
    clockRttOverrideFn: makeClockRttOverrideFn({ rttBaseMin: 120, rttBaseMax: 350, jitterFrac: 0.4 }),
  },
  Degraded: {
    label: 'Degraded',
    profileRole: PROFILE_ROLES.Degraded,
    realtimeDelayRegime: 'moderate',
    deliveryOrderMode: 'outOfOrder',
    pollingEnabled: true,
    skewMsOverrideFn: ({ index, isHost, rng }) => {
      if (isHost) return 0;
      const sign = index % 2 === 0 ? 1 : -1;
      return Math.round(sign * (600 + rng() * 1500)); // ±600~2100ms, 이분화(비대칭)
    },
    // 높은 RTT/지터: moderate bodyHi(800ms)까지 — 기존 고정분포(120~500ms) 대비 상한 60% 상향.
    clockRttBaseMin: 120,
    clockRttBaseMax: 800,
    clockRttJitterFrac: 0.5,
    clockRttOverrideFn: makeClockRttOverrideFn({ rttBaseMin: 120, rttBaseMax: 800, jitterFrac: 0.5 }),
  },
  Extreme: {
    label: 'Extreme',
    profileRole: PROFILE_ROLES.Extreme,
    realtimeDelayRegime: 'pessimistic',
    deliveryOrderMode: 'outOfOrder',
    pollingEnabled: true,
    skewMsOverrideFn: createAlternatingSkewFn(5000), // ±3500~5000ms대(RC-3 §Part B 재사용)
    // 가장 높은 RTT/지터: pessimistic bodyHi(1400ms)까지 — 기존 고정분포 대비 상한 2.8배.
    clockRttBaseMin: 120,
    clockRttBaseMax: 1400,
    clockRttJitterFrac: 0.6,
    clockRttOverrideFn: makeClockRttOverrideFn({ rttBaseMin: 120, rttBaseMax: 1400, jitterFrac: 0.6 }),
  },
};

for (const p of Object.values(PROFILES)) {
  p.clockSpreadCeilingMs = computeClockSpreadCeilingMs({ rttBaseMax: p.clockRttBaseMax });
}

// ── §C-1: Release Gate 판정 ──────────────────────────────────────────────────
// CEO 확정 정책표:
//   | Profile  | profileRole   | timing 95%          | correctness |
//   | Normal   | release_gate  | 게이트 포함          | 100% 요구    |
//   | Degraded | informational | 게이트 제외(보고 필수) | 100% 요구    |
//   | Extreme  | stress        | 게이트 제외(보고 필수) | 100% 요구    |
// 근거(§M-5 critic 지적 반영 — "천장 초과" 논증이 아니라 "잔차 분포" 논증):
// 위 CLOCK_RESIDUAL_SPREAD_MC / simulateClockResidualSpread 참고. clock 잔차만으로(전파지연 0,
// 완벽한 스케줄링을 가정해도) 단일 phase 비교가 250ms를 넘을 확률은 Normal 0.0% / Degraded
// 38.7% / Extreme 82.8%다. trial 전체 PASS는 라운드×5 phase 비교 전부가 250ms 이하일 것을
// 요구하므로 trial 단위 실패율은 이보다 더 높다 — 즉 Degraded/Extreme의 timing 95%는 index.html을
// 어떻게 고쳐도 도달 불가이며(모델 한계이지 코드 결함이 아니다), Normal은 반대로 clock 잔차가
// 게이트를 깰 수 없으므로 미달이면 코드/스케줄링 문제다. 그러나 correctness(clockSync
// permanent/progression/rules/result)는 지연과 무관한 [범주1] 신호이므로 세 profile 전부
// 100%를 요구한다 — Degraded/Extreme의 correctness 실패는 여전히 전체 FAIL이다.
// ⚠️ Degraded/Extreme의 timing 수치는 삭제/완화/PASS 포장 없이 그대로 보고서에 남긴다.
export const RELEASE_GATE_MUTATIONS = Object.freeze({
  // Degraded/Extreme timing까지 다시 95% 게이트에 포함(정책 변경 전 동작).
  timingGateAllProfiles: false,
  // release_gate가 아닌 profile의 correctness를 무시(금지된 완화 — mutation 증명용).
  ignoreNonReleaseGateCorrectness: false,
  // profileRole 출력을 제거(보고 누락 — mutation 증명용).
  omitProfileRole: false,
});

export function computeReleaseGate(profileStats, { mutations } = {}) {
  const mut = { ...RELEASE_GATE_MUTATIONS, ...(mutations || {}) };
  const perProfile = profileStats.map((s) => {
    const profileRole = s.profileRole || PROFILE_ROLES[s.profile] || 'informational';
    const trials = s.trials;
    const timingSuccessRate = trials ? s.timingPass / trials : null;
    const correctnessSuccessRate = trials ? s.correctnessPass / trials : null;
    const overallSuccessRate = trials && s.ceoPass != null ? s.ceoPass / trials : null;
    const timingGateApplied = mut.timingGateAllProfiles ? true : profileRole === 'release_gate';
    const timingGatePass = !timingGateApplied || (timingSuccessRate != null && timingSuccessRate >= CEO_TIMING_GATE_RATE);
    const correctnessGateApplied = mut.ignoreNonReleaseGateCorrectness ? profileRole === 'release_gate' : true;
    const correctnessGatePass = !correctnessGateApplied || (correctnessSuccessRate != null && correctnessSuccessRate >= CEO_CORRECTNESS_GATE_RATE);
    const row = {
      profile: s.profile,
      trials,
      timingPass: s.timingPass,
      correctnessPass: s.correctnessPass,
      ceoPass: s.ceoPass,
      timingSuccessRate,
      correctnessSuccessRate,
      overallSuccessRate,
      timingGateApplied,
      timingGatePass,
      correctnessGateApplied,
      correctnessGatePass,
      clockSpreadCeilingMs: s.clockSpreadCeilingMs != null
        ? s.clockSpreadCeilingMs
        : (PROFILES[s.profile] ? PROFILES[s.profile].clockSpreadCeilingMs : null),
      // §LOW-5(critic): 종전 이름 timingGateReachable은 "게이트 달성 가능"으로 오독된다. 이 값이
      // 실제로 말하는 것은 "clock 잔차의 구조적 상한만으로는 250ms 게이트를 깰 수 없다"이며,
      // 그 반대(false)라고 해서 곧바로 "달성 불가"가 증명되는 것도 아니다(=§M-5의 지적. 달성
      // 불가의 근거는 아래 clockResidualPOver250 분포다). 이름을 사실에 맞게 정정한다.
      clockCeilingWithinTimingLimit: null,
      // §M-5: 분포 근거를 행 자체에 실어 "왜 미달인지"가 리포트에서 자립하게 한다.
      clockResidualPOver250: (CLOCK_RESIDUAL_SPREAD_MC.byProfile[s.profile] || {}).pOver250 != null
        ? CLOCK_RESIDUAL_SPREAD_MC.byProfile[s.profile].pOver250 : null,
      clockResidualP95Ms: (CLOCK_RESIDUAL_SPREAD_MC.byProfile[s.profile] || {}).p95 != null
        ? CLOCK_RESIDUAL_SPREAD_MC.byProfile[s.profile].p95 : null,
    };
    row.clockCeilingWithinTimingLimit = row.clockSpreadCeilingMs == null
      ? null
      : row.clockSpreadCeilingMs <= CEO_PHASE_TIMING_LIMIT_MS;
    if (!mut.omitProfileRole) row.profileRole = profileRole;
    return row;
  });
  const gateFailures = [];
  for (const row of perProfile) {
    if (!row.timingGatePass) gateFailures.push({ profile: row.profile, gate: 'timing', rate: row.timingSuccessRate, required: CEO_TIMING_GATE_RATE });
    if (!row.correctnessGatePass) gateFailures.push({ profile: row.profile, gate: 'correctness', rate: row.correctnessSuccessRate, required: CEO_CORRECTNESS_GATE_RATE });
  }
  return {
    overallReleasePass: gateFailures.length === 0,
    timingGatePass: perProfile.every((r) => r.timingGatePass),
    correctnessGatePass: perProfile.every((r) => r.correctnessGatePass),
    perProfile,
    gateFailures,
    policy: {
      timingLimitMs: CEO_PHASE_TIMING_LIMIT_MS,
      timingGateRate: CEO_TIMING_GATE_RATE,
      correctnessGateRate: CEO_CORRECTNESS_GATE_RATE,
      timingGateProfiles: perProfile.filter((r) => r.timingGateApplied).map((r) => r.profile),
      correctnessGateProfiles: perProfile.filter((r) => r.correctnessGateApplied).map((r) => r.profile),
      note: 'Degraded/Extreme의 timing 게이트 제외 근거는 "천장 초과"가 아니라 clock 잔차 분포다(P(단일 비교>250ms) = Normal 0.0% / Degraded 38.7% / Extreme 82.8%, CLOCK_RESIDUAL_SPREAD_MC — simulateClockResidualSpread로 재현 가능). 수치는 완화·삭제 없이 그대로 보고한다. correctness는 3 profile 전부 100% 요구.',
      clockResidualDistribution: CLOCK_RESIDUAL_SPREAD_MC,
      // §CRITICAL-1: NOT_SYNCED(하니스 clock sync 예산 초과)는 correctness 게이트에서 제외되고
      // informational로만 보고된다 — 정책 자체를 리포트에 명시해 은폐/망각을 막는다.
      notSyncedPolicy: 'informational_only(harness budget artifact; REAL syncServerClock has no such deadline and serverClockSynced does not gate progression)',
    },
  };
}

// ════════════════════════════════════════════════════════════════════════════
// §HIGH-1(critic): 게이트 테스트의 "조용한 합성 fallback" 제거 + strict 모드.
//
// 수정 전 결함: 헤드라인 3개 it 중 하나라도 throw/timeout하면 HEADLINE_PROFILE_STATS.length!==3이
// 되어 실측 판정을 건너뛰고 "합성 입력으로 만든 overallReleasePass===true"를 단언했다. 즉
// 측정이 무너질수록 게이트 테스트는 오히려 확실히 GREEN이 되는 구조였고(가짜 안전), 실측 경로에도
// `typeof gate.overallReleasePass === 'boolean'`뿐이라 CI 강제력이 0이었다.
//
// 수정 후:
//   · fallback은 "정책 불변식만" 검증한다(policyInvariantsOnly). overallReleasePass에 대한
//     단언을 하지 않는다 — 합성 입력의 PASS는 릴리즈에 대해 아무것도 증명하지 않기 때문.
//   · CEO_GATE_STRICT=1(환경변수)에서는 (a) 헤드라인 3개 집계가 반드시 존재해야 하고
//     (b) 실측 overallReleasePass가 반드시 true여야 한다 → 이 모드가 실제 릴리즈 판정 실행이다.
//   · 기본(비strict) 모드는 종전 "결함이면 열거만" 원칙을 유지한다(측정기가 붉게 죽으면 수치
//     보고 자체가 끊기므로). 두 모드의 차이는 아래 evaluateReleaseGateAssertion 하나에 모인다.
// ════════════════════════════════════════════════════════════════════════════
// ════════════════════════════════════════════════════════════════════════════
// §M-B(critic MEDIUM): 미발화 detector 분류 — "검증된 커버리지"와 "detector는 있으나 스윕
// 미도달"을 리포트에서 반드시 구분한다.
//
// 핵심 원칙(CEO 지시): **구조적으로 발화 불가능한 검사를 coverage PASS로 집계하지 않는다.**
// 아래 registry가 detector 1건당 3개 상태 필드를 코드로 출력한다:
//   · reachableFromSweep   — 현재 3-profile × N=3..20 × 20 trial 스윕에서 발화 가능한가(실측 기반).
//   · detectorTested       — 합성 입력으로 detector 로직 자체가 검증됐는가(어느 테스트가 하는지 명시).
//   · releaseGateEligible  — 이 detector의 발화가 release gate 판정(correctness/timing)에 반영되는가.
// 분류(CEO 지정 4종):
//   'sweep_scenario_addable' — 실제 sweep scenario 추가 가능(추가 방법을 sweepScenarioProposal에 명시)
//   'detector_only'          — detector 로직만 합성으로 검증, 스윕 재현 경로 없음
//   'sweep_uncovered'        — 스윕이 도달하지 못함(추가 방법도 현재 미정)
//   'not_in_release_gate'    — release gate 비포함(정보성)
//
// ⚠️ 판독 규칙: reachableFromSweep=false인 항목은 스윕 결과가 0건이어도 "PASS(무결함 실증)"가
// 아니라 "미도달(증거 없음)"이다. 이것을 커버리지 PASS로 세는 순간 리포트가 거짓말이 된다.
// ════════════════════════════════════════════════════════════════════════════
export const DETECTOR_COVERAGE_CLASSES = Object.freeze([
  'sweep_scenario_addable', 'detector_only', 'sweep_uncovered', 'not_in_release_gate',
]);

export const DETECTOR_COVERAGE_REGISTRY = Object.freeze({
  COUNTDOWN_ANCHOR_DIVERGED: Object.freeze({
    detector: 'COUNTDOWN_ANCHOR_DIVERGED',
    channel: 'correctness/clockSync',
    classification: 'sweep_scenario_addable',
    reachableFromSweep: false,
    detectorTested: true,
    releaseGateEligible: true,
    evidence: 'critic 실측: republishCount = 0/360(3 profile 전부). 재측정(2026-08-02, 본 파일 전량 실행)에서도 '
      + '전 셀 republishCount 합계 = 0. 유일한 노출 경로인 '
      + 'republishCountdownStartAsHost()(index.html:7418-7436)가 스윕에서 한 번도 호출되지 않는다 — '
      + '호출 전제(getCountdownStartAt()이 falsy → waitForValidCountdownStart 5회 소진)가 성립하지 않기 때문.',
    detectorTests: ['[AD-1]', '[AD-2]', '[AD-3]', '[AD-4]', '[AD-5]', '[AD-M1]'],
    sweepScenarioProposal: 'combinedSourceOverride(runCell이 이미 지원하는 주입 통로)로 추출 소스의 '
      + 'getCountdownStartAt()을 "지정한 (round, deviceIndex)에서 1회 0을 반환"하도록 변형한 profile 셀을 '
      + '추가한다. host에서 발생시키면 republishCountdownStartAsHost()가 getNextCountdownStartAt()으로 '
      + '새 앵커를 발행하고, 이미 옛 앵커로 시작한 participant와 값이 갈려 divergence가 실제로 발화한다. '
      + '(index.html 무수정 — 주입은 추출 소스 문자열 변형이며 기존 §Step2 sizing 실험이 쓰는 것과 같은 통로다.) '
      + '⚠️ 이번 P1에서는 구현하지 않는다(스윕 셀 추가 = 매트릭스 수치 정의 변경이라 CEO 승인 대상).',
  }),
  ROUND_ENDED_WITHOUT_VALID_ANCHOR: Object.freeze({
    detector: 'ROUND_ENDED_WITHOUT_VALID_ANCHOR',
    channel: 'correctness/clockSync',
    classification: 'detector_only',
    reachableFromSweep: false,
    detectorTested: true,
    releaseGateEligible: true,
    evidence: 'critic 실측: retryAttemptHistogram={"0":13} — 재시도가 발생한 건 전부 attempt 0(1회차 '
      + 'db 재조회)에서 즉시 복구됐다. 재측정(2026-08-02, 헤드라인 3 profile + escalation 셀 합산)에서도 '
      + 'histogram의 키는 "0" 하나뿐이었다(합계 51건, attempt≥1 = 0건). 이 규칙의 전제는 "그 기기의 어떤 '
      + '세대도 COUNTDOWN_START를 내지 못한다"인데, 스윕에서는 1회차 복구가 100%라 전제 자체가 성립하지 않는다.',
    detectorTests: ['[H2-보강]', '[M2-1](a)'],
    sweepScenarioProposal: null,
    whyNotSweepAddable: '발화하려면 (1) 5회 재시도 전부 실패 + (2) host가 아니어서 republish 자가복구도 없고 '
      + '(3) 그런데 COUNTDOWN_SYNC_FAILED도 남기지 않은 채 (4) checkpoint 1에서 세대 stale로 중단, 이 4개가 '
      + '동시에 성립해야 한다. (2)+(3)의 동시 성립은 stale-generation abort가 showCountdownSyncError보다 '
      + '먼저 끼어드는 좁은 레이스 창에서만 가능하며, 현재 하니스에는 그 창을 결정론적으로 벌릴 knob이 없다 '
      + '— 스윕 셀 추가가 아니라 별도 표적 시나리오(rc3-harness-support.mjs 확장, 다른 에이전트 소관)가 필요하다.',
  }),
  STALE_ABORT_EXEMPTION_NARROWED: Object.freeze({
    detector: 'STALE_ABORT_EXEMPTION_NARROWED', // §M-2 축소 면제 규칙(ROUND_ENDED_WITHOUT_VALID_ANCHOR의 서브룰)
    channel: 'correctness/clockSync(rule modifier)',
    classification: 'detector_only',
    reachableFromSweep: false,
    detectorTested: true,
    releaseGateEligible: true,
    evidence: '이 면제 규칙은 ROUND_ENDED_WITHOUT_VALID_ANCHOR 규칙 "안"에서만 평가된다. 위 항목이 스윕에서 '
      + '전제 미성립으로 도달 불가이므로 이 서브룰도 도달 자체가 불가능하다(critic 실측 확인).',
    detectorTests: ['[M2-1](a)', '[M2-1](b)', '[M2-M1]'],
    sweepScenarioProposal: null,
    whyNotSweepAddable: '상위 규칙(ROUND_ENDED_WITHOUT_VALID_ANCHOR)이 도달 가능해진 뒤에야 의미가 있다 — 종속 항목.',
  }),
  CLOCK_SYNC_NOT_SETTLED: Object.freeze({
    detector: 'CLOCK_SYNC_NOT_SETTLED', // = computeCeoPassUnits의 NOT_SYNCED(informational)
    channel: 'informational(clockSync.informational)',
    classification: 'not_in_release_gate',
    reachableFromSweep: false,
    detectorTested: true,
    releaseGateEligible: false,
    evidence: '하니스 rpc의 구조적 지연 상한(critic 실측 11,200ms) < clock sync 예산 '
      + 'CLOCK_SYNC_SETTLE_BUDGET_MS(45,000ms = REAL_CLOCK_SYNC_WORST_CASE_MS 41,500 + slack 3,500). '
      + '예산이 상한의 4배라 스윕에서 예산 초과가 구조적으로 발생할 수 없다. 게다가 §CRITICAL-1에서 이 신호는 '
      + 'correctness 게이트에서 강등돼 informational로만 보고된다(REAL syncServerClock에는 대응 데드라인이 없다).',
    detectorTests: ['[H2-5](a)', '[C0-1]', '[C0-M1]'],
    sweepScenarioProposal: null,
    whyNotSweepAddable: '예산은 REAL 계약(index.html:4461-4542)에서 유도된 값이라 낮출 수 없고, 하니스 rpc 상한을 '
      + '45초 위로 올리는 것은 REAL에 근거가 없는 인위적 조작이다 — 발화시키는 것 자체가 부정직한 측정이 된다. '
      + '게이트 비포함 항목이므로 미도달이 리스크가 아니다(정보성 분포는 clockSyncSettle로 상시 보고 중).',
  }),
});

// 스윕 실측 관측 건수(observed)와 registry를 대조해 "검증된 커버리지"와 "미도달"을 분리 집계한다.
// ⚠️ observed[k] > 0인데 registry가 reachableFromSweep=false라고 주장하면 그것은 registry가 낡았다는
// 뜻이므로 contradictions로 올린다(=테스트가 RED). 반대로 reachableFromSweep=true인데 0건이면
// "회귀 또는 과장된 주장"이므로 역시 contradictions다. 이 두 방향 모두 잡아야 registry가 장식이 아니다.
export function computeDetectorCoverageReport(observedCounts = {}, registry = DETECTOR_COVERAGE_REGISTRY) {
  const verifiedBySweep = [];
  const sweepUncovered = [];
  const detectorOnly = [];
  const notInReleaseGate = [];
  const untested = [];
  const contradictions = [];
  for (const entry of Object.values(registry)) {
    const observed = observedCounts[entry.detector] != null ? observedCounts[entry.detector] : 0;
    if (observed > 0 && !entry.reachableFromSweep) {
      contradictions.push({ detector: entry.detector, type: 'OBSERVED_BUT_MARKED_UNREACHABLE', observed });
    }
    if (observed === 0 && entry.reachableFromSweep) {
      contradictions.push({ detector: entry.detector, type: 'CLAIMED_REACHABLE_BUT_NEVER_OBSERVED', observed });
    }
    if (!DETECTOR_COVERAGE_CLASSES.includes(entry.classification)) {
      contradictions.push({ detector: entry.detector, type: 'UNKNOWN_CLASSIFICATION', classification: entry.classification });
    }
    if (!entry.detectorTested) untested.push(entry.detector);
    // 커버리지 집계: 스윕에서 실제로 발화한(=실행 경로가 실증된) 것만 "검증된 커버리지"다.
    if (observed > 0) verifiedBySweep.push({ detector: entry.detector, observed });
    else sweepUncovered.push({ detector: entry.detector, classification: entry.classification, reason: entry.evidence });
    if (entry.classification === 'detector_only') detectorOnly.push(entry.detector);
    if (!entry.releaseGateEligible) notInReleaseGate.push(entry.detector);
  }
  return {
    // "검증된 커버리지" = 스윕에서 실제로 발화가 관측된 detector만. 미발화는 절대 여기 들어오지 않는다.
    verifiedBySweep,
    // "detector는 존재하나 스윕 미도달" — coverage PASS로 집계하지 않는다(CEO 지시).
    sweepUncovered,
    detectorOnly,
    notInReleaseGate,
    untested,
    contradictions,
    counts: {
      total: Object.keys(registry).length,
      verifiedBySweep: verifiedBySweep.length,
      sweepUncovered: sweepUncovered.length,
      releaseGateEligible: Object.values(registry).filter((e) => e.releaseGateEligible).length,
    },
    note: 'reachableFromSweep=false 항목의 "0건"은 무결함 실증이 아니라 증거 부재다 — coverage PASS로 집계하지 않는다.',
  };
}

// ════════════════════════════════════════════════════════════════════════════
// §M-A / §M-A′(critic MEDIUM → CEO 지시): 공식 release-gate 실행 경로.
//
// 종전 상태: package.json의 scripts는 `"test": "vitest run"` 뿐이고 .github/workflows 어디에도
// npm test를 도는 job이 없었다. 즉 CEO_GATE_STRICT=1을 세팅하는 곳이 저장소에 **한 군데도 없어**
// strict 게이트가 inert했다(설계안만 있고 배선 없음).
//
// §M-A′에서 배선이 실제로 들어갔다:
//   · package.json  "test:release-gate" / "gate:release" → node scripts/run-release-gate.mjs
//   · scripts/run-release-gate.mjs — CEO_GATE_STRICT를 **환경에서 읽지 않고 내부에서 '1'로 강제**한다.
//     환경변수가 없어도(또는 0이어도) permissive로 빠지지 않는다. 게이트 진입점이 strict를 스스로 보장한다.
//   · .github/workflows/release-gate.yml — npm ci → npm test → npm run test:syntax → npm run test:release-gate
// 기본 `npm test`(비strict)는 종전대로 report-only이며, 그 사실을 formatGateBypassBanner가 출력한다.
//
// exit code 근거: vitest는 실패한 test가 하나라도 있으면 프로세스 종료코드 1로 끝난다
// (`vitest run` = CI 모드, watch 없음). 아래 releaseGateTestBody의 마지막 단언
// `expect(verdict.violations).toEqual([])`이 strict 모드에서 위반을 그대로 throw하므로
//   Normal timing < 95%  → gateFailures 1건 → RELEASE_GATE_FAILED → 단언 실패 → exit 1
//   correctness < 100%   → gateFailures(profile별) → 동일 → exit 1
//   헤드라인 집계 결손    → HEADLINE_STATS_INCOMPLETE → 동일 → exit 1
// 이 세 경로가 computeGateExitCode()로 순수하게 재현되고 아래 [GX-*] 테스트가 그것을 단언한다.
// 추가로 러너는 exit 0이어도 strict 판정 마커가 출력에 없으면 1로 강등한다(빈 실행 우회 차단).
// ════════════════════════════════════════════════════════════════════════════
export const GATE_EXECUTION_PLAN = Object.freeze({
  // package.json "scripts"에 실제로 배선된 항목(§M-A′에서 적용 완료).
  // 키 이름은 종전 설계안 그대로 유지한다(과거 보고와의 대조 가능성 보존).
  proposedScripts: Object.freeze({
    'gate:release': 'node scripts/run-release-gate.mjs',
    'gate:release:raw': 'CEO_GATE_STRICT=1 vitest run tests/ceo-official-measurement.test.mjs',
  }),
  // 저장소에 실제로 존재해야 하는 스크립트(tests/release-gate-wiring.test.mjs의 [GX-7]이 package.json 실물과 대조한다).
  requiredScripts: Object.freeze({
    'test:release-gate': 'node scripts/run-release-gate.mjs',
    'gate:release': 'node scripts/run-release-gate.mjs',
  }),
  // 크로스플랫폼 근거: `CEO_GATE_STRICT=1 vitest ...` 인라인 env 문법은 POSIX 셸 전용이라
  // Windows cmd에서 깨진다. 그래서 채택한 진입점은 node 러너(process.env 설정 후 vitest spawn,
  // child exit code 그대로 전파)이고 raw 형태는 참고용으로만 남긴다.
  runnerContract: Object.freeze({
    path: 'scripts/run-release-gate.mjs',
    behavior: 'process.env.CEO_GATE_STRICT="1"를 무조건 강제(환경 입력 무시) 후 vitest run <measurement file> '
      + '자식 프로세스 spawn, 자식 exit code를 그대로 process.exit()로 전파(비정상 종료 시그널은 1로 정규화). '
      + 'exit 0이더라도 자식 출력에 strict 판정 마커가 없으면 1로 강등한다(fail-closed).',
    exitCodes: Object.freeze({ 0: 'release gate PASS', 1: 'gate 위반 또는 측정 결손(=출시 차단)' }),
    strictIsForced: true,
    bypassSwitches: Object.freeze([]),
  }),
  // strict 모드에서 non-zero exit가 되어야 하는 조건(CEO 확정).
  strictFailConditions: Object.freeze([
    'Normal(profileRole=release_gate) timing successRate < 0.95',
    '임의 profile의 correctness successRate < 1.0',
    '헤드라인 3 profile 실측 집계 결손(throw/timeout/-t 필터)',
  ]),
  // CI 배선(tests/release-gate-wiring.test.mjs의 [GX-9]가 워크플로 실물과 대조한다).
  ciContract: Object.freeze({
    workflow: 'release-gate.yml',
    steps: Object.freeze(['npm ci', 'npm test', 'npm run test:syntax', 'npm run test:release-gate']),
    triggers: Object.freeze(['pull_request', 'workflow_dispatch', 'push:tags']),
    expectedStatusToday: 'FAIL — Normal timing 실측 74.72% < 95%. threshold를 낮춰 green을 만드는 것은 금지.',
  }),
  // 현재 저장소 사실(설계 판단 근거). tests/release-gate-wiring.test.mjs의 [GX-7]/[GX-9]가
  // 실물과 대조하므로 거짓이면 RED가 된다(이 상수 자체는 파일을 읽지 않는 순수 데이터다).
  currentRepoFacts: Object.freeze({
    npmTestScript: 'vitest run',
    ceoGateStrictSetAnywhere: true,
    ciWorkflowsRunningNpmTest: Object.freeze(['release-gate.yml']),
    existingWorkflows: Object.freeze(['production-smoke.yml', 'release-gate.yml', 'supabase-deploy.yml']),
    nameCollisionWarning: 'scripts/release-gate.mjs가 이미 존재한다(QA_STATUS 기반 버그카운트 게이트, 별개 관심사). '
      + '새 러너는 scripts/run-release-gate.mjs로 이름을 분리했다.',
  }),
});

// 저장소가 실제로 게이트를 어떻게 배선하고 있는지(또는 안 하고 있는지) 순수 함수로 분석한다.
// 목적: "gate:release라는 이름만 있고 실제로는 strict를 켜지 않는" 가짜 게이트가 생기는 것을 막는다.
// §M-A′: 게이트로 보이는 스크립트 이름 규약. `gate:*`뿐 아니라 CEO가 지정한
// `test:release-gate`도 반드시 strict 검사를 받아야 한다(이름만 게이트인 스크립트 차단).
export const GATE_SCRIPT_NAME_RE = /^gate:|release[-:]gate/;

export function analyzeGateWiring({ pkgScripts = {}, workflowTexts = {} }) {
  const entries = Object.entries(pkgScripts).filter(([, v]) => typeof v === 'string');
  const isStrictCmd = (cmd) => /CEO_GATE_STRICT\s*=\s*1/.test(cmd) || /run-release-gate/.test(cmd);
  const gateScripts = entries.filter(([k]) => GATE_SCRIPT_NAME_RE.test(k));
  const strictScripts = entries.filter(([, v]) => isStrictCmd(v)).map(([k]) => k);
  const workflowsRunningTest = Object.entries(workflowTexts)
    .filter(([, t]) => /npm\s+(run\s+)?test|npx?\s+vitest|vitest\s+run/.test(t)).map(([f]) => f);
  const workflowsSettingStrict = Object.entries(workflowTexts)
    .filter(([, t]) => /CEO_GATE_STRICT/.test(t)).map(([f]) => f);
  // "게이트 스크립트를 실제로 호출하는" 워크플로 — CEO_GATE_STRICT 문자열이 주석에만 있는
  // 경우와 구분해야 배선 보고가 거짓이 되지 않는다.
  const gateScriptNames = gateScripts.map(([k]) => k);
  const workflowsRunningGateScript = Object.entries(workflowTexts)
    .filter(([, t]) => gateScriptNames.some((n) => new RegExp(`npm\\s+run\\s+${n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(t)))
    .map(([f]) => f);
  const violations = [];
  for (const [name, cmd] of gateScripts) {
    if (!isStrictCmd(cmd)) violations.push({ type: 'GATE_SCRIPT_WITHOUT_STRICT', name, cmd });
  }
  return {
    gateScripts: gateScriptNames,
    strictScripts,
    workflowsRunningTest,
    workflowsSettingStrict,
    workflowsRunningGateScript,
    strictWiredAnywhere: strictScripts.length > 0 || workflowsSettingStrict.length > 0,
    violations,
  };
}

// strict 실행의 프로세스 종료코드를 순수 함수로 재현한다(실제 exit는 vitest가 수행).
export function computeGateExitCode(verdict) {
  return (verdict && Array.isArray(verdict.violations) && verdict.violations.length === 0) ? 0 : 1;
}

// `npm test`(비strict)에서 "게이트 미실행"을 눈에 띄게 만드는 배너(§M-A 선택지 (b) 구현분).
export function formatGateBypassBanner(gate) {
  const measured = !!gate;
  const overall = measured ? gate.overallReleasePass : null;
  return [
    '════════════════════════════════════════════════════════════════════',
    '[CEO-RELEASE-GATE][GATE-NOT-ENFORCED] CEO_GATE_STRICT!=1 — 이 실행은 릴리즈 판정이 아니다.',
    `  현재 실측 overallReleasePass = ${overall}  (측정 집계 ${measured ? '있음' : '없음'})`,
    '  이 실행이 GREEN이어도 출시 가능 판정이 아니다. 공식 판정은 `npm run gate:release`(strict)뿐이다.',
    '════════════════════════════════════════════════════════════════════',
  ].join('\n');
}

export const CEO_GATE_STRICT_ENV = 'CEO_GATE_STRICT';

export function isGateStrictMode(env) {
  const e = env || (typeof process !== 'undefined' ? process.env : {}) || {};
  return e[CEO_GATE_STRICT_ENV] === '1';
}

// 순수 함수(테스트 가능): strict 여부와 헤드라인 집계/게이트 결과를 받아 "무엇을 단언해야 하는가"를
// 결정한다. violations가 비어있지 않으면 호출부가 반드시 실패시켜야 한다.
export function evaluateReleaseGateAssertion({ headlineStats, gate, strict }) {
  const violations = [];
  const measured = Array.isArray(headlineStats) && headlineStats.length === 3;
  if (strict && !measured) {
    violations.push({
      type: 'HEADLINE_STATS_INCOMPLETE',
      got: Array.isArray(headlineStats) ? headlineStats.length : null,
      required: 3,
      detail: 'strict 모드(릴리즈 판정)에서는 3 profile 실측 집계가 전부 있어야 한다 — 헤드라인 it이 throw/timeout/필터로 빠지면 게이트를 통과시키지 않는다.',
    });
  }
  if (strict && measured) {
    if (!gate || gate.overallReleasePass !== true) {
      violations.push({
        type: 'RELEASE_GATE_FAILED',
        gateFailures: gate ? gate.gateFailures : null,
        detail: 'strict 모드에서는 실측 overallReleasePass가 true여야 한다.',
      });
    }
  }
  return {
    mode: strict ? 'strict' : 'report_only',
    measured,
    // 실측이 없으면 정책 불변식만 검증한다(합성 입력의 PASS를 단언하지 않는다).
    policyInvariantsOnly: !measured,
    violations,
  };
}

const PROFILE_SEED_OFFSET = { Normal: 0, Degraded: 4_000_000, Extreme: 8_000_000 };

function seedFor(profileName, n, s) {
  // 결정론적, 기존 헤드라인 관례(n*8100000+s)와 겹치지 않도록 profile별 오프셋을 더한다.
  return PROFILE_SEED_OFFSET[profileName] + n * 97_000 + s;
}

// ── §Phase2: 실행 — 매트릭스 1셀(참가자수 n × profile) 실행 + 집계 ──────────────
// combinedSourceOverride(선택): §Step2 sizing 실험에서 PHASE_RENDER_BUFFER_MS/자가복구 유무를
// 변형(mutate)한 소스를 주입하기 위한 통로 — 기본값(null)은 EXTRACTED_COMBINED_SOURCE(index.html
// 무수정) 그대로라 §Phase2 헤드라인/escalation 위 두 describe에는 회귀 없음.
// ⚠️ measurementMutations는 매트릭스 실행에는 절대 넘기지 않는다(기본값 null) — 아래 §반공허성
// sanity 테스트가 runCell 소스에 그 사실이 남아있는지까지 확인한다.
async function runCell({ profileName, n, trials, targetLoserCount = 2, seedStart = 0, combinedSourceOverride = null }) {
  const profile = PROFILES[profileName];
  const rows = [];
  for (let s = seedStart; s < seedStart + trials; s++) {
    const seed = seedFor(profileName, n, s);
    // eslint-disable-next-line no-await-in-loop
    const trialResult = await runEliminationTrial({
      participantCount: n, seed, targetLoserCount,
      resolveElimination, judgePure, computePlayerStatuses, PLAYER_STATUS, maxLoserCountFor, vi,
      choiceDriverFactory: createDecisiveChoiceDriver,
      realtimeDelayRegime: profile.realtimeDelayRegime,
      deliveryOrderMode: profile.deliveryOrderMode,
      skewMsOverrideFn: profile.skewMsOverrideFn,
      clockRttOverrideFn: profile.clockRttOverrideFn,
      pollingEnabled: profile.pollingEnabled,
      combinedSourceOverride,
    });
    const ceo = computeCeoPassUnits(trialResult);
    rows.push({ seed, n, profile: profileName, ceoPass: ceo.ceoPass, ceo });
  }
  return rows;
}

// export 이유(§LOW-3): 헤드라인 it이 요약 위에 거는 "열거 무결성" 불변식이 공허하지 않다는 것을
// 아래 [L3-1]이 직접 검증할 수 있어야 하기 때문(합성 rows로 요약기를 그대로 호출한다).
export function summarizeCell(rows) {
  const pass = rows.filter((r) => r.ceoPass).length;
  const fail = rows.length - pass;
  const timingPass = rows.filter((r) => r.ceo.timing.pass).length;
  const correctnessPass = rows.filter((r) => r.ceo.correctnessPass).length;
  const worstGap = rows.reduce((acc, r) => {
    const g = r.ceo.timing.worstGap;
    if (!g) return acc;
    return (!acc || g.diffMs > acc.diffMs) ? g : acc;
  }, null);
  const categoryFailCounts = {};
  for (const r of rows) {
    for (const cat of ['clockSync', 'timing', 'progression', 'rules', 'result']) {
      if (!r.ceo[cat].pass) categoryFailCounts[cat] = (categoryFailCounts[cat] || 0) + 1;
    }
  }
  // §H-2 transient 집계(informational — FAIL이 아니므로 categoryFailCounts와 분리해 보고).
  const transient = rows.reduce((acc, r) => {
    const t = r.ceo.clockSync.countdownTransient;
    acc.invalidCountdownServerTsCount += t.invalidCountdownServerTsCount;
    acc.unitsWithRetry += t.unitsWithRetry;
    acc.trialsWithTransient += t.unitsWithRetry > 0 ? 1 : 0;
    acc.estimatedRetrySleepMsMax = Math.max(acc.estimatedRetrySleepMsMax, t.estimatedRetrySleepMsMax);
    acc.republishCount += t.republishCount;
    for (const [k, v] of Object.entries(t.retryAttemptHistogram)) acc.retryAttemptHistogram[k] = (acc.retryAttemptHistogram[k] || 0) + v;
    acc.timingViolationsInTransientRounds += r.ceo.transientTimingCorrelation.timingViolationsInTransientRounds.length;
    return acc;
  }, { invalidCountdownServerTsCount: 0, unitsWithRetry: 0, trialsWithTransient: 0, estimatedRetrySleepMsMax: 0, republishCount: 0, retryAttemptHistogram: {}, timingViolationsInTransientRounds: 0 });
  // §H-2 permanent 집계(release-gate FAIL 대상).
  const permanentCountdownFailures = {};
  for (const r of rows) {
    for (const f of r.ceo.clockSync.countdownPermanentFailures) {
      permanentCountdownFailures[f.type] = (permanentCountdownFailures[f.type] || 0) + 1;
    }
  }
  // §M-1 진단: 어떤 phase가 timing/coverage를 깨뜨리는가.
  const timingViolationsByPhase = {};
  for (const r of rows) {
    for (const v of r.ceo.timing.violations) timingViolationsByPhase[v.phase] = (timingViolationsByPhase[v.phase] || 0) + 1;
  }
  const missingRenderByPhase = {};
  for (const r of rows) {
    for (const f of r.ceo.progression.failures) {
      if (f.type !== 'MISSING_PHASE_RENDER') continue;
      for (const d of f.detail) missingRenderByPhase[d.phase] = (missingRenderByPhase[d.phase] || 0) + 1;
    }
  }
  const failures = rows.filter((r) => !r.ceoPass).map((r) => ({
    seed: r.seed,
    failedCategories: ['clockSync', 'timing', 'progression', 'rules', 'result'].filter((c) => !r.ceo[c].pass),
    clockSync: r.ceo.clockSync.pass ? undefined : r.ceo.clockSync.failures,
    timing: r.ceo.timing.pass ? undefined : r.ceo.timing.violations,
    progression: r.ceo.progression.pass ? undefined : r.ceo.progression.failures,
    rules: r.ceo.rules.pass ? undefined : r.ceo.rules.failures,
    result: r.ceo.result.pass ? undefined : r.ceo.result.crossDeviceOutcomeMismatch,
  }));
  const allGaps = rows.flatMap((r) => r.ceo.timing.perRoundGaps.map((g) => g.diffMs)).sort((a, b) => a - b);
  const pct = (p) => (allGaps.length ? allGaps[Math.min(allGaps.length - 1, Math.floor(p * allGaps.length))] : null);
  // §CRITICAL-1 정보 보존: NOT_SYNCED를 게이트에서 뺀 대신, 발생 건수와 실측 settle 분포를 반드시
  // 셀 단위로 보고한다(삭제·은폐 금지). 이 값이 커지면 하니스 예산이 부족하다는 신호다.
  const settleSamples = [];
  let notSyncedTrials = 0;
  let noValidSampleTrials = 0;
  for (const r of rows) {
    if (r.ceo.clockSync.notSettledWithinHarnessBudget) notSyncedTrials++;
    if (r.ceo.clockSync.failures.some((f) => f.type === 'NO_VALID_SAMPLE')) noValidSampleTrials++;
    const m = r.ceo.clockSync.settle.maxSettleMs;
    if (m != null) settleSamples.push(m);
  }
  settleSamples.sort((a, b) => a - b);
  const sq = (p) => (settleSamples.length ? settleSamples[Math.min(settleSamples.length - 1, Math.floor(p * settleSamples.length))] : null);
  // §M-1(critic) 사후 집계: cross-device anchor divergence 실측 건수(0이면 이론적 노출, >0이면
  // 실제 결함 신호 — 어느 쪽인지 반드시 보고서에 밝힌다).
  let anchorDivergenceTrials = 0;
  let anchorDivergenceRounds = 0;
  let anchorDivergenceMaxSpreadMs = 0;
  // 반공허성 증거: "divergence 0건"이 "비교 대상 자체가 0건"이어서 나온 값이 아님을 보이기 위해
  // 실제로 비교된 (roomCode,gameNo,round) 키 수와 유효 앵커 수를 함께 보고한다.
  let anchorRoundKeyTotal = 0;
  let validAnchorTotal = 0;
  const anchorDivergenceSamples = [];
  for (const r of rows) {
    anchorRoundKeyTotal += r.ceo.clockSync.anchorRoundKeyCount || 0;
    validAnchorTotal += r.ceo.clockSync.validAnchorCount || 0;
    const divs = r.ceo.clockSync.anchorDivergences || [];
    if (divs.length) {
      anchorDivergenceTrials++;
      anchorDivergenceRounds += divs.length;
      for (const d of divs) {
        anchorDivergenceMaxSpreadMs = Math.max(anchorDivergenceMaxSpreadMs, d.spreadMs);
        if (anchorDivergenceSamples.length < 3) anchorDivergenceSamples.push({ seed: r.seed, ...d });
      }
    }
  }
  // ── §M-B: detector별 "스윕에서 실제로 발화한 건수" 실측 집계 ────────────────────────
  // 이 값이 0이면 그 detector는 "검증된 커버리지"가 아니라 "미도달"로 분류된다
  // (computeDetectorCoverageReport). 0을 PASS로 포장하지 않기 위해 반드시 실측을 남긴다.
  const detectorObservations = {
    COUNTDOWN_ANCHOR_DIVERGED: 0,
    ROUND_ENDED_WITHOUT_VALID_ANCHOR: 0,
    STALE_ABORT_EXEMPTION_NARROWED: 0,
    CLOCK_SYNC_NOT_SETTLED: 0,
    MULTI_GAME_MEASUREMENT_UNSUPPORTED: 0,
  };
  for (const r of rows) {
    for (const f of r.ceo.clockSync.countdownPermanentFailures) {
      if (f.type === 'COUNTDOWN_ANCHOR_DIVERGED') detectorObservations.COUNTDOWN_ANCHOR_DIVERGED++;
      if (f.type === 'MULTI_GAME_MEASUREMENT_UNSUPPORTED') detectorObservations.MULTI_GAME_MEASUREMENT_UNSUPPORTED++;
      if (f.type === 'ROUND_ENDED_WITHOUT_VALID_ANCHOR') {
        detectorObservations.ROUND_ENDED_WITHOUT_VALID_ANCHOR++;
        // §M-2 축소 면제 규칙이 "실제로 결과를 바꾼" 건수 = stale-abort가 있었는데도 면제되지 않고
        // FAIL로 잡힌 유닛(수정 전이었다면 무조건 면제로 사라졌을 건). 이게 0이면 그 규칙은 미도달이다.
        if ((f.staleAbortCheckpoints || []).includes('waitForValidCountdownStart')) {
          detectorObservations.STALE_ABORT_EXEMPTION_NARROWED++;
        }
      }
    }
    if (r.ceo.clockSync.notSettledWithinHarnessBudget) detectorObservations.CLOCK_SYNC_NOT_SETTLED++;
  }
  // §LOW-3 대체 불변식용: EXCEPTION/STALL은 "측정 자체가 무효"라는 뜻이므로 별도 계상한다.
  let exceptionTrials = 0;
  let stallTrials = 0;
  for (const r of rows) {
    if (r.ceo.progression.failures.some((f) => f.type === 'EXCEPTION')) exceptionTrials++;
    if (r.ceo.progression.failures.some((f) => f.type === 'STALL_OR_INCOMPLETE')) stallTrials++;
  }
  return {
    trials: rows.length, pass, fail, successRate: rows.length ? pass / rows.length : null,
    timingPass, correctnessPass,
    timingSuccessRate: rows.length ? timingPass / rows.length : null,
    correctnessSuccessRate: rows.length ? correctnessPass / rows.length : null,
    worstGap, categoryFailCounts, failures,
    transient, permanentCountdownFailures, timingViolationsByPhase, missingRenderByPhase,
    timingPercentiles: { p50: pct(0.5), p95: pct(0.95), p99: pct(0.99), worst: allGaps.length ? allGaps[allGaps.length - 1] : null, sampleSize: allGaps.length },
    clockSyncSettle: {
      notSyncedTrials,                    // 하니스 예산 초과 trial 수(informational, 게이트 제외)
      noValidSampleTrials,                // REAL CLOCK_SYNC_FAILED 상당(correctness FAIL 대상)
      settleMsP50: sq(0.5), settleMsP95: sq(0.95),
      settleMsMax: settleSamples.length ? settleSamples[settleSamples.length - 1] : null,
      sampleSize: settleSamples.length,
    },
    anchorDivergence: {
      trials: anchorDivergenceTrials, rounds: anchorDivergenceRounds,
      maxSpreadMs: anchorDivergenceMaxSpreadMs, samples: anchorDivergenceSamples,
      comparedRoundKeys: anchorRoundKeyTotal, validAnchors: validAnchorTotal,
    },
    exceptionTrials, stallTrials,
    // §M-B: detector 발화 실측(0 = 미도달, coverage PASS 아님).
    detectorObservations,
    // §M-C: 이 셀에서 공식 측정 범위(single-game)를 벗어난 trial 수 + 사유 분포.
    measurementScope: rows.reduce((acc, r) => {
      const sc = r.ceo.measurementScope || {};
      if (sc.supported === false) {
        acc.unsupportedTrials++;
        acc.reasons[sc.reason] = (acc.reasons[sc.reason] || 0) + 1;
      } else {
        acc.singleGameTrials++;
      }
      if (sc.anchorComparisonPerformed) acc.anchorComparisonTrials++;
      return acc;
    }, { singleGameTrials: 0, unsupportedTrials: 0, anchorComparisonTrials: 0, reasons: {} }),
  };
}

const NS = Array.from({ length: 18 }, (_, i) => i + 3); // 3..20
const BASELINE_TRIALS = 20; // CEO 지시 최소치("각≥20회")

describe('CEO 공식 측정: §Phase0 sanity(EG_HARD_FAILURE_TYPES 재사용 확인 — 새 하드실패 타입 발명 없음)', () => {
  it('rules PASS-unit이 참조하는 실패 타입은 전부 EG_HARD_FAILURE_TYPES(기존, 재검증된 목록)의 부분집합이다', () => {
    const rulesTypes = ['PHANTOM_OR_CORRUPTED_OUTCOME', 'ROUND_NOT_MONOTONIC', 'DOUBLE_COUNTDOWN_RENDER', 'STALE_ROW_REGRESSION', 'READY_BRANCH_STATE_CLOBBER'];
    for (const t of rulesTypes) expect(EG_HARD_FAILURE_TYPES.includes(t)).toBe(true);
    expect(EG_HARD_FAILURE_TYPES.includes('CROSS_DEVICE_OUTCOME_MISMATCH')).toBe(true);
  });

  it('측정 레이어 mutation 스위치는 기본값이 전부 false이고 매트릭스 실행 경로는 그것을 넘기지 않는다', () => {
    for (const v of Object.values(CEO_MEASUREMENT_MUTATIONS)) expect(v).toBe(false);
    for (const v of Object.values(RELEASE_GATE_MUTATIONS)) expect(v).toBe(false);
    // runCell은 computeCeoPassUnits를 옵션 없이 호출해야 한다(게이트 우회 통로 차단).
    expect(runCell.toString()).toContain('computeCeoPassUnits(trialResult)');
    expect(runCell.toString()).not.toContain('mutations');
  });

  it('§C-1 clock 천장은 profile별 rttBaseMax의 0.6배(=2×0.3 비대칭 반폭)로 계산된다', () => {
    expect(PROFILES.Normal.clockSpreadCeilingMs).toBe(210);
    expect(PROFILES.Degraded.clockSpreadCeilingMs).toBe(480);
    expect(PROFILES.Extreme.clockSpreadCeilingMs).toBe(840);
    // Normal만 250ms 게이트 아래 — 나머지는 구조적으로 도달 불가.
    expect(PROFILES.Normal.clockSpreadCeilingMs).toBeLessThanOrEqual(CEO_PHASE_TIMING_LIMIT_MS);
    expect(PROFILES.Degraded.clockSpreadCeilingMs).toBeGreaterThan(CEO_PHASE_TIMING_LIMIT_MS);
    expect(PROFILES.Extreme.clockSpreadCeilingMs).toBeGreaterThan(CEO_PHASE_TIMING_LIMIT_MS);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// §H-2 유닛 테스트: transient / permanent countdown failure 분리.
// 합성 trialResult(실제 REAL telemetry 이벤트 스키마 그대로)로 결정적으로 검증한다 —
// 전체 매트릭스(1회 ~63초)를 매번 돌리지 않기 위함.
// ════════════════════════════════════════════════════════════════════════════
function mkClockSyncOk() { return { kind: 'clocksync', eventType: 'CLOCK_SYNC', synced: true, samples: 3 }; }
function mkCountdownStart(round, countdownStartServerTs) {
  return { kind: 'metric', wrps: 'WRPS-036', eventType: 'COUNTDOWN_START', round, countdownStartServerTs, waitMs: 100 };
}
function mkInvalidTs(round, attempt) {
  return { kind: 'metric', wrps: 'WRPS-036-B22', eventType: 'INVALID_COUNTDOWN_SERVER_TS', round, attempt };
}
function mkSyncFailed(round) {
  return { kind: 'metric', wrps: 'WRPS-036-B22', eventType: 'COUNTDOWN_SYNC_FAILED', round };
}
function mkRepublished(round) {
  return { kind: 'metric', wrps: 'WRPS-036-B22', eventType: 'COUNTDOWN_SERVER_TS_REPUBLISHED', round, countdownStartAt: 1234 };
}
function mkSyncRender(phase, round, clientRenderedTs, gameNo = 1) {
  return { kind: 'metric', wrps: 'WRPS-SYNC-B19', eventType: 'SYNC_RENDER', phase, round, gameNo, clientRenderedTs, serverScheduledTs: clientRenderedTs, clientReceivedTs: clientRenderedTs, lateRenderMs: 0 };
}
function mkDevice(id, events, { skewMs = 0, roomCode = 'ROOM-SIM', gameNo = 1 } = {}) {
  return {
    id, skewMs, telemetry: { events },
    rendered: { choiceStartByRound: {}, choiceEndByRound: {} },
    impl: { state: { roomCode, gameRound: gameNo } },
  };
}
function mkTrial({
  devices, finalRound = 1, oraclePerRound = null, completed = true,
  clockSyncSettled = true, hardFailureModes = [],
}) {
  return {
    world: { devices, __clockSyncSettled: clockSyncSettled },
    participantCount: devices.length,
    finalRound, completed, hardFailureModes, outcomeCounts: {},
    oraclePerRound: oraclePerRound || [{ round: 1, outcome: 'gameOver', activeIds: devices.map((d) => d.id) }],
  };
}
// 라운드 1회짜리 "정상" trial: 전 기기가 active이고 countdown/result 렌더가 모두 있다.
function mkHealthyTrial(countdownEventsByDevice, { deviceCount = 2 } = {}) {
  const devices = [];
  for (let i = 0; i < deviceCount; i++) {
    const id = `p${i}`;
    const extra = countdownEventsByDevice[id] || [mkCountdownStart(1, 1_000_000)];
    devices.push(mkDevice(id, [
      mkClockSyncOk(),
      ...extra,
      mkSyncRender('countdown', 1, 1_000_000 + i * 10),
      mkSyncRender('result', 1, 1_005_000 + i * 10),
    ]));
  }
  return mkTrial({ devices, finalRound: 1 });
}

describe('§H-2: countdown anchor transient(재시도) vs permanent(하드실패) 분리', () => {
  it('[H2-1] attempt 1회 후 즉시 복구(유효 앵커) → Clock/Sync PASS(transient 1건은 기록만)', () => {
    const trial = mkHealthyTrial({ p1: [mkInvalidTs(1, 0), mkCountdownStart(1, 1_000_000)] });
    const ceo = computeCeoPassUnits(trial);
    expect(ceo.clockSync.pass).toBe(true);
    expect(ceo.clockSync.countdownPermanentFailures).toEqual([]);
    expect(ceo.clockSync.countdownTransient.invalidCountdownServerTsCount).toBe(1);
    expect(ceo.clockSync.countdownTransient.unitsWithRetry).toBe(1);
    expect(ceo.clockSync.countdownTransient.units[0].recoveredWithValidAnchor).toBe(true);
    expect(ceo.clockSync.countdownTransient.units[0].estimatedRetrySleepMs).toBe(0);
    expect(ceo.ceoPass).toBe(true);
  });

  it('[H2-2] attempt 5회 소진 후 host republish 성공 → PASS이고 transient count는 5로 유지된다', () => {
    const trial = mkHealthyTrial({
      p0: [
        mkInvalidTs(1, 0), mkInvalidTs(1, 1), mkInvalidTs(1, 2), mkInvalidTs(1, 3), mkInvalidTs(1, 4),
        mkRepublished(1), mkCountdownStart(1, 1_000_000),
      ],
    });
    const ceo = computeCeoPassUnits(trial);
    expect(ceo.clockSync.pass).toBe(true);
    expect(ceo.clockSync.countdownTransient.invalidCountdownServerTsCount).toBe(5);
    expect(ceo.clockSync.countdownTransient.units[0].attempts).toBe(5);
    expect(ceo.clockSync.countdownTransient.units[0].recoveredByHostRepublish).toBe(true);
    // 재시도 sleep 추정치: (5-1)×500 = 2000ms(마지막 시도 뒤에는 sleep 없음, index.html:7412).
    expect(ceo.clockSync.countdownTransient.estimatedRetrySleepMsMax).toBe(2000);
    expect(ceo.clockSync.countdownTransient.retryAttemptHistogram).toEqual({ 0: 1, 1: 1, 2: 1, 3: 1, 4: 1 });
  });

  it('[H2-3] participant COUNTDOWN_SYNC_FAILED(하드블록) → permanent FAIL', () => {
    const trial = mkHealthyTrial({
      p1: [mkInvalidTs(1, 0), mkInvalidTs(1, 1), mkInvalidTs(1, 2), mkInvalidTs(1, 3), mkInvalidTs(1, 4), mkSyncFailed(1)],
    });
    const ceo = computeCeoPassUnits(trial);
    expect(ceo.clockSync.pass).toBe(false);
    const types = ceo.clockSync.countdownPermanentFailures.map((f) => f.type);
    expect(types).toContain('COUNTDOWN_SYNC_FAILED');
    expect(ceo.ceoPass).toBe(false);
    // 판정 단위 키가 device+roomCode+gameNo+round 구조인지 확인.
    expect(ceo.clockSync.countdownPermanentFailures[0].unitKey).toBe('p1|ROOM-SIM|1|1');
  });

  it('[H2-4] COUNTDOWN_START인데 countdownStartServerTs가 null/0 → permanent FAIL', () => {
    const nullTs = computeCeoPassUnits(mkHealthyTrial({ p1: [mkCountdownStart(1, null)] }));
    expect(nullTs.clockSync.pass).toBe(false);
    expect(nullTs.clockSync.countdownPermanentFailures.map((f) => f.type)).toContain('COUNTDOWN_START_WITHOUT_ANCHOR');
    const zeroTs = computeCeoPassUnits(mkHealthyTrial({ p1: [mkCountdownStart(1, 0)] }));
    expect(zeroTs.clockSync.pass).toBe(false);
    expect(zeroTs.clockSync.countdownPermanentFailures.map((f) => f.type)).toContain('COUNTDOWN_START_WITHOUT_ANCHOR');
  });

  it('[H2-5] 유효 샘플 0(REAL CLOCK_SYNC_FAILED 상당)이면 permanent FAIL — NOT_SYNCED(하니스 예산)는 제외', () => {
    // (a) world.__clockSyncSettled === false → §CRITICAL-1: correctness FAIL이 아니라 informational.
    const notSynced = mkHealthyTrial({});
    notSynced.world.__clockSyncSettled = false;
    const a = computeCeoPassUnits(notSynced);
    expect(a.clockSync.pass).toBe(true); // 하니스 예산 초과는 REAL 결함이 아니다
    expect(a.clockSync.failures.map((f) => f.type)).not.toContain('NOT_SYNCED');
    expect(a.clockSync.informational.map((f) => f.type)).toContain('NOT_SYNCED');
    expect(a.clockSync.notSettledWithinHarnessBudget).toBe(true);
    expect(a.correctnessPass).toBe(true);

    // (b) synced:false
    const dev = mkDevice('p0', [{ kind: 'clocksync', eventType: 'CLOCK_SYNC', synced: false, samples: 3 }, mkCountdownStart(1, 1_000_000), mkSyncRender('countdown', 1, 1), mkSyncRender('result', 1, 2)]);
    const dev2 = mkDevice('p1', [mkClockSyncOk(), mkCountdownStart(1, 1_000_000), mkSyncRender('countdown', 1, 1), mkSyncRender('result', 1, 2)]);
    const b = computeCeoPassUnits(mkTrial({ devices: [dev, dev2] }));
    expect(b.clockSync.pass).toBe(false);
    expect(b.clockSync.failures.map((f) => f.type)).toContain('NO_VALID_SAMPLE');

    // (c) samples:0
    const dev3 = mkDevice('p0', [{ kind: 'clocksync', eventType: 'CLOCK_SYNC', synced: true, samples: 0 }, mkCountdownStart(1, 1_000_000), mkSyncRender('countdown', 1, 1), mkSyncRender('result', 1, 2)]);
    const c = computeCeoPassUnits(mkTrial({ devices: [dev3, dev2] }));
    expect(c.clockSync.pass).toBe(false);
    expect(c.clockSync.failures.map((f) => f.type)).toContain('NO_VALID_SAMPLE');
  });

  it('[H2-6] transient retry 0/1/5회 모두, 최종 유효 앵커가 있으면 PASS', () => {
    const cases = [
      { retries: 0, extra: [] },
      { retries: 1, extra: [mkInvalidTs(1, 0)] },
      { retries: 5, extra: [mkInvalidTs(1, 0), mkInvalidTs(1, 1), mkInvalidTs(1, 2), mkInvalidTs(1, 3), mkInvalidTs(1, 4)] },
    ];
    for (const { retries, extra } of cases) {
      const ceo = computeCeoPassUnits(mkHealthyTrial({ p1: [...extra, mkCountdownStart(1, 1_000_000)] }));
      expect(ceo.clockSync.pass).toBe(true);
      expect(ceo.clockSync.countdownTransient.invalidCountdownServerTsCount).toBe(retries);
      expect(ceo.clockSync.countdownPermanentFailures).toEqual([]);
    }
  });

  it('[H2-보강] 유효 anchor 없이 라운드가 끝나면(COUNTDOWN_START 자체 없음) permanent FAIL', () => {
    // 재시도만 하고 COUNTDOWN_START가 끝내 없음 → FAIL
    const noAnchor = computeCeoPassUnits(mkHealthyTrial({ p1: [mkInvalidTs(1, 0), mkInvalidTs(1, 1)] }));
    expect(noAnchor.clockSync.countdownPermanentFailures.map((f) => f.type)).toContain('ROUND_ENDED_WITHOUT_VALID_ANCHOR');
  });

  it('[M2-1] stale-abort 면제는 "더 최신 세대가 실제로 진행했다"는 실증이 있을 때만 성립한다', () => {
    // (a) checkpoint 1에서 중단만 했고 그 라운드에 countdown 렌더/유효 앵커가 전혀 없다 →
    //     면제를 정당화하는 명제("더 최신 세대가 대신 진행")가 성립하지 않으므로 FAIL이어야 한다.
    //     ⚠️ mkHealthyTrial은 기본으로 countdown SYNC_RENDER를 넣으므로 여기서는 직접 구성한다.
    const abortedNoEvidence = mkTrial({
      devices: [
        mkDevice('p0', [mkClockSyncOk(), mkCountdownStart(1, 1_000_000), mkSyncRender('countdown', 1, 1_000_000), mkSyncRender('result', 1, 1_005_000)]),
        mkDevice('p1', [
          mkClockSyncOk(), mkInvalidTs(1, 0),
          { kind: 'metric', wrps: 'WRPS-078', eventType: 'COUNTDOWN_STALE_GENERATION_ABORTED', round: 1, checkpoint: 'waitForValidCountdownStart' },
          mkSyncRender('result', 1, 1_005_010),
        ]),
      ],
      finalRound: 1,
      oraclePerRound: [{ round: 1, outcome: 'gameOver', activeIds: ['p0'] }],
    });
    const a = computeCeoPassUnits(abortedNoEvidence);
    const aTypes = a.clockSync.countdownPermanentFailures.map((f) => f.type);
    expect(aTypes).toContain('ROUND_ENDED_WITHOUT_VALID_ANCHOR');
    expect(a.clockSync.pass).toBe(false);
    // 진단 필드가 실려야 한다(무엇을 근거로 FAIL인지 사후 재구성 가능해야 함).
    const f = a.clockSync.countdownPermanentFailures.find((x) => x.type === 'ROUND_ENDED_WITHOUT_VALID_ANCHOR');
    expect(f.staleAbortCheckpoints).toEqual(['waitForValidCountdownStart']);
    expect(f.countdownRenders).toBe(0);

    // (b) 같은 중단이지만 그 라운드의 countdown SYNC_RENDER가 존재한다(= 어떤 세대가 실제로
    //     앵커 단계를 통과해 진행했다는 실증) → 면제 성립, FAIL 아님.
    const abortedWithEvidence = computeCeoPassUnits(mkHealthyTrial({
      p1: [
        mkInvalidTs(1, 0),
        { kind: 'metric', wrps: 'WRPS-078', eventType: 'COUNTDOWN_STALE_GENERATION_ABORTED', round: 1, checkpoint: 'waitForValidCountdownStart' },
      ],
    }));
    expect(abortedWithEvidence.clockSync.countdownPermanentFailures).toEqual([]);
    expect(abortedWithEvidence.clockSync.pass).toBe(true);
  });

  it('[H2-상관] transient가 발생한 라운드의 timing 위반은 별도로 상관 리포트된다', () => {
    // p1이 2000ms 재시도 지연 후 렌더 → countdown spread 2000ms(250ms 게이트 초과).
    const devices = [
      mkDevice('p0', [mkClockSyncOk(), mkCountdownStart(1, 1_000_000), mkSyncRender('countdown', 1, 1_000_000), mkSyncRender('result', 1, 1_005_000)]),
      mkDevice('p1', [
        mkClockSyncOk(), mkInvalidTs(1, 0), mkInvalidTs(1, 1), mkInvalidTs(1, 2), mkInvalidTs(1, 3), mkInvalidTs(1, 4),
        mkCountdownStart(1, 1_000_000), mkSyncRender('countdown', 1, 1_002_000), mkSyncRender('result', 1, 1_005_000),
      ]),
    ];
    const ceo = computeCeoPassUnits(mkTrial({ devices }));
    expect(ceo.clockSync.pass).toBe(true); // transient는 FAIL이 아니다
    expect(ceo.timing.pass).toBe(false); // 그러나 timing은 실제로 깨졌다
    expect(ceo.transientTimingCorrelation.transientRounds).toEqual([1]);
    expect(ceo.transientTimingCorrelation.timingViolationsInTransientRounds.length).toBeGreaterThan(0);
    expect(ceo.transientTimingCorrelation.estimatedRetrySleepMsMax).toBe(2000);
  });
});

describe('§H-2 mutation(반공허성): 수정을 되돌리면 해당 테스트가 실제로 깨진다', () => {
  const M = { mutations: { transientCountdownRetryIsPermanent: true } };

  it('[H2-M1] INVALID_COUNTDOWN_SERVER_TS를 다시 permanent FAIL로 되돌리면 H2-1/H2-2/H2-6이 실패한다', () => {
    // H2-1 상당
    const t1 = computeCeoPassUnits(mkHealthyTrial({ p1: [mkInvalidTs(1, 0), mkCountdownStart(1, 1_000_000)] }), M);
    expect(t1.clockSync.pass).toBe(false);
    expect(t1.clockSync.countdownPermanentFailures.map((f) => f.type)).toContain('COUNTDOWN_SERVER_TS_ZERO');
    // H2-2 상당
    const t2 = computeCeoPassUnits(mkHealthyTrial({
      p0: [mkInvalidTs(1, 0), mkInvalidTs(1, 1), mkInvalidTs(1, 2), mkInvalidTs(1, 3), mkInvalidTs(1, 4), mkRepublished(1), mkCountdownStart(1, 1_000_000)],
    }), M);
    expect(t2.clockSync.pass).toBe(false);
    // H2-6 상당(retry 1회/5회 둘 다 FAIL로 뒤집힌다 — retry 0회만 그대로 PASS)
    expect(computeCeoPassUnits(mkHealthyTrial({ p1: [mkInvalidTs(1, 0), mkCountdownStart(1, 1_000_000)] }), M).clockSync.pass).toBe(false);
    expect(computeCeoPassUnits(mkHealthyTrial({}), M).clockSync.pass).toBe(true);
  });

  it('[H2-M2] COUNTDOWN_SYNC_FAILED를 무시하면 H2-3이 실패한다(검출 소실)', () => {
    const trial = mkHealthyTrial({
      p1: [mkInvalidTs(1, 0), mkInvalidTs(1, 1), mkInvalidTs(1, 2), mkInvalidTs(1, 3), mkInvalidTs(1, 4), mkSyncFailed(1)],
    });
    expect(computeCeoPassUnits(trial).clockSync.pass).toBe(false); // 수정본은 검출
    const mutated = computeCeoPassUnits(trial, { mutations: { ignoreCountdownSyncFailed: true } });
    expect(mutated.clockSync.pass).toBe(true); // mutation은 놓친다
    expect(mutated.clockSync.countdownPermanentFailures.map((f) => f.type)).not.toContain('COUNTDOWN_SYNC_FAILED');
  });

  it('[H2-M3] null countdownStartServerTs를 무시하면 H2-4가 실패한다(검출 소실)', () => {
    const trial = mkHealthyTrial({ p1: [mkCountdownStart(1, null)] });
    expect(computeCeoPassUnits(trial).clockSync.pass).toBe(false); // 수정본은 검출
    const mutated = computeCeoPassUnits(trial, { mutations: { ignoreNullCountdownAnchor: true } });
    expect(mutated.clockSync.pass).toBe(true); // mutation은 놓친다
  });

  it('[M2-M1] stale-abort 면제를 다시 "무조건"으로 되돌리면 M2-1(a)이 실패한다(미탐 통로 부활)', () => {
    const trial = mkTrial({
      devices: [
        mkDevice('p0', [mkClockSyncOk(), mkCountdownStart(1, 1_000_000), mkSyncRender('countdown', 1, 1_000_000), mkSyncRender('result', 1, 1_005_000)]),
        mkDevice('p1', [
          mkClockSyncOk(), mkInvalidTs(1, 0),
          { kind: 'metric', wrps: 'WRPS-078', eventType: 'COUNTDOWN_STALE_GENERATION_ABORTED', round: 1, checkpoint: 'waitForValidCountdownStart' },
          mkSyncRender('result', 1, 1_005_010),
        ]),
      ],
      finalRound: 1,
      oraclePerRound: [{ round: 1, outcome: 'gameOver', activeIds: ['p0'] }],
    });
    expect(computeCeoPassUnits(trial).clockSync.pass).toBe(false); // 수정본은 검출
    const mutated = computeCeoPassUnits(trial, { mutations: { staleAbortExemptionUnconditional: true } });
    expect(mutated.clockSync.pass).toBe(true); // 수정 전(무조건 면제)은 놓친다
    expect(mutated.clockSync.countdownPermanentFailures).toEqual([]);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// §CRITICAL-1 유닛 테스트: NOT_SYNCED(하니스 clock sync 예산 초과) 강등 + 정보 보존.
// ════════════════════════════════════════════════════════════════════════════
describe('§CRITICAL-1: NOT_SYNCED는 correctness 게이트가 아니라 informational이다', () => {
  it('[C0-1] NOT_SYNCED만 있는 trial은 correctness PASS이고, 그 사실이 리포트에 남는다', () => {
    const trial = mkHealthyTrial({});
    trial.world.__clockSyncSettled = false;
    const ceo = computeCeoPassUnits(trial);
    expect(ceo.correctnessPass).toBe(true);
    expect(ceo.clockSync.pass).toBe(true);
    expect(ceo.clockSync.notSettledWithinHarnessBudget).toBe(true);
    const info = ceo.clockSync.informational.find((f) => f.type === 'NOT_SYNCED');
    expect(info).toBeTruthy();
    expect(info.reason).toBe('HARNESS_CLOCK_SYNC_BUDGET_EXCEEDED');
  });

  it('[C0-2] NO_VALID_SAMPLE(REAL CLOCK_SYNC_FAILED 상당)은 correctness에 그대로 남는다', () => {
    const dev = mkDevice('p0', [{ kind: 'clocksync', eventType: 'CLOCK_SYNC', synced: false, samples: 0 }, mkCountdownStart(1, 1_000_000), mkSyncRender('countdown', 1, 1), mkSyncRender('result', 1, 2)]);
    const dev2 = mkDevice('p1', [mkClockSyncOk(), mkCountdownStart(1, 1_000_000), mkSyncRender('countdown', 1, 1), mkSyncRender('result', 1, 2)]);
    const trial = mkTrial({ devices: [dev, dev2] });
    trial.world.__clockSyncSettled = false; // 예산 초과가 동시에 있어도
    const ceo = computeCeoPassUnits(trial);
    expect(ceo.clockSync.pass).toBe(false); // NO_VALID_SAMPLE 때문에 FAIL
    expect(ceo.clockSync.failures.map((f) => f.type)).toEqual(['NO_VALID_SAMPLE']);
    expect(ceo.correctnessPass).toBe(false);
  });

  it('[C0-3] 하드블록/앵커 permanent 실패는 NOT_SYNCED 강등과 무관하게 correctness FAIL을 유지한다', () => {
    const syncFailed = computeCeoPassUnits(mkHealthyTrial({ p1: [mkSyncFailed(1), mkCountdownStart(1, 1_000_000)] }));
    expect(syncFailed.clockSync.pass).toBe(false);
    const noAnchor = computeCeoPassUnits(mkHealthyTrial({ p1: [mkCountdownStart(1, 0)] }));
    expect(noAnchor.clockSync.pass).toBe(false);
  });

  it('[C0-4] settle 실측 분포가 telemetry __t로 재구성되어 보고된다(정보 삭제 금지)', () => {
    // 하니스 telemetry는 emit마다 __t(= Date.now())를 붙인다 — 그 스키마를 그대로 흉내낸 합성 입력.
    const d0 = mkDevice('p0', [
      { ...mkClockSyncOk(), __t: 1000 },
      { ...mkCountdownStart(1, 1_000_000), __t: 1200 },
      { ...mkSyncRender('countdown', 1, 1_000_000), __t: 1300 },
      { ...mkSyncRender('result', 1, 1_005_000), __t: 1400 },
    ]);
    const d1 = mkDevice('p1', [
      { ...mkClockSyncOk(), __t: 4500 }, // 3500ms 늦게 settle
      { ...mkCountdownStart(1, 1_000_000), __t: 4600 },
      { ...mkSyncRender('countdown', 1, 1_000_010), __t: 4700 },
      { ...mkSyncRender('result', 1, 1_005_010), __t: 4800 },
    ]);
    const ceo = computeCeoPassUnits(mkTrial({ devices: [d0, d1] }));
    expect(ceo.clockSync.settle.baseTs).toBe(1000);
    expect(ceo.clockSync.settle.maxSettleMs).toBe(3500);
    expect(ceo.clockSync.settle.minSettleMs).toBe(0);
    expect(ceo.clockSync.settle.measuredDeviceCount).toBe(2);
  });
});

describe('§CRITICAL-1 mutation(반공허성): NOT_SYNCED를 다시 게이트로 되돌리면 C0-1이 깨진다', () => {
  it('[C0-M1] notSyncedIsCorrectnessFailure=true면 하니스 예산 초과만으로 correctness FAIL이 된다(수정 전 동작)', () => {
    const trial = mkHealthyTrial({});
    trial.world.__clockSyncSettled = false;
    expect(computeCeoPassUnits(trial).correctnessPass).toBe(true); // 수정본
    const mutated = computeCeoPassUnits(trial, { mutations: { notSyncedIsCorrectnessFailure: true } });
    expect(mutated.correctnessPass).toBe(false); // 수정 전 = 하니스 아티팩트가 출시를 막는다
    expect(mutated.clockSync.failures.map((f) => f.type)).toContain('NOT_SYNCED');
    expect(mutated.clockSync.informational).toEqual([]);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// §M-1(critic) 유닛 테스트: 라운드별 cross-device countdown anchor 일치.
// ════════════════════════════════════════════════════════════════════════════
describe('§M-1(critic): COUNTDOWN_ANCHOR_DIVERGED(기기간 앵커 불일치)', () => {
  it('[AD-1] 같은 라운드에 서로 다른 앵커로 시작하면 permanent FAIL(correctness)', () => {
    // host republish로 앵커가 1_000_000 → 1_003_600으로 갈린 상황.
    const devices = [
      mkDevice('p0', [mkClockSyncOk(), mkCountdownStart(1, 1_000_000), mkSyncRender('countdown', 1, 1_000_000), mkSyncRender('result', 1, 1_005_000)]),
      mkDevice('p1', [mkClockSyncOk(), mkRepublished(1), mkCountdownStart(1, 1_003_600), mkSyncRender('countdown', 1, 1_000_100), mkSyncRender('result', 1, 1_005_100)]),
    ];
    const ceo = computeCeoPassUnits(mkTrial({ devices }));
    expect(ceo.clockSync.pass).toBe(false);
    const f = ceo.clockSync.countdownPermanentFailures.find((x) => x.type === 'COUNTDOWN_ANCHOR_DIVERGED');
    expect(f).toBeTruthy();
    expect(f.round).toBe(1);
    expect(f.distinctAnchors).toEqual([1_000_000, 1_003_600]);
    expect(f.spreadMs).toBe(3600);
    expect(f.anchorsByDevice).toEqual({ p0: [1_000_000], p1: [1_003_600] });
    expect(ceo.correctnessPass).toBe(false);
  });

  it('[AD-2] 전 기기가 같은 앵커면 PASS(과탐 없음)', () => {
    const ceo = computeCeoPassUnits(mkHealthyTrial({}, { deviceCount: 4 }));
    expect(ceo.clockSync.anchorDivergences).toEqual([]);
    expect(ceo.clockSync.pass).toBe(true);
  });

  it('[AD-3] 라운드가 다르면 앵커가 달라도 정상(라운드별로만 비교한다)', () => {
    const devices = ['p0', 'p1'].map((id, i) => mkDevice(id, [
      mkClockSyncOk(),
      mkCountdownStart(1, 1_000_000), mkSyncRender('countdown', 1, 1_000_000 + i), mkSyncRender('result', 1, 1_005_000 + i),
      mkSyncRender('nextRound', 2, 1_006_000 + i),
      mkCountdownStart(2, 1_007_000), mkSyncRender('countdown', 2, 1_007_000 + i), mkSyncRender('result', 2, 1_008_000 + i),
    ]));
    const ceo = computeCeoPassUnits(mkTrial({
      devices, finalRound: 2,
      oraclePerRound: [{ round: 1, outcome: 'allDraw', activeIds: ['p0', 'p1'] }, { round: 2, outcome: 'gameOver', activeIds: ['p0', 'p1'] }],
    }));
    expect(ceo.clockSync.anchorDivergences).toEqual([]);
    expect(ceo.clockSync.pass).toBe(true);
  });

  it('[AD-4] 같은 기기가 한 라운드에 서로 다른 앵커를 두 번 쓴 경우도 divergence로 잡힌다', () => {
    const ceo = computeCeoPassUnits(mkHealthyTrial({
      p1: [mkCountdownStart(1, 1_000_000), mkCountdownStart(1, 1_002_000)],
    }));
    const f = ceo.clockSync.countdownPermanentFailures.find((x) => x.type === 'COUNTDOWN_ANCHOR_DIVERGED');
    expect(f).toBeTruthy();
    expect(f.anchorsByDevice.p1).toEqual([1_000_000, 1_002_000]);
  });

  it('[AD-5] 검출을 꺼도 관측 자체는 항상 리포트에 남는다(은폐 금지)', () => {
    const devices = [
      mkDevice('p0', [mkClockSyncOk(), mkCountdownStart(1, 1_000_000), mkSyncRender('countdown', 1, 1_000_000), mkSyncRender('result', 1, 1_005_000)]),
      mkDevice('p1', [mkClockSyncOk(), mkCountdownStart(1, 1_003_600), mkSyncRender('countdown', 1, 1_000_100), mkSyncRender('result', 1, 1_005_100)]),
    ];
    const mutated = computeCeoPassUnits(mkTrial({ devices }), { mutations: { ignoreAnchorDivergence: true } });
    expect(mutated.clockSync.anchorDivergences.length).toBe(1); // 관측은 남고
    expect(mutated.clockSync.countdownPermanentFailures).toEqual([]); // 판정만 빠진다
  });
});

// ════════════════════════════════════════════════════════════════════════════
// §LOW-3 유닛 테스트: 헤드라인 it의 "공허 단언"을 실불변식으로 교체한 것이 실제로 의미가 있는가.
// ════════════════════════════════════════════════════════════════════════════
describe('§LOW-3: 헤드라인 불변식은 공허하지 않다(요약기가 실패를 삼키면 잡힌다)', () => {
  function mkRows() {
    const ok = mkHealthyTrial({});
    const bad = mkHealthyTrial({ p1: [mkSyncFailed(1), mkCountdownStart(1, 1_000_000)] });
    return [
      { seed: 1, n: 2, profile: 'Normal', ceoPass: computeCeoPassUnits(ok).ceoPass, ceo: computeCeoPassUnits(ok) },
      { seed: 2, n: 2, profile: 'Normal', ceoPass: computeCeoPassUnits(bad).ceoPass, ceo: computeCeoPassUnits(bad) },
    ];
  }

  it('[L3-1] 정상 요약은 fail 수와 열거된 실패 목록 길이가 일치한다', () => {
    const s = summarizeCell(mkRows());
    expect(s.trials).toBe(2);
    expect(s.fail).toBe(1);
    expect(s.failures.length).toBe(s.fail); // 헤드라인 it이 거는 실불변식과 동일
    expect(s.exceptionTrials).toBe(0);
  });

  it('[L3-M1] mutation: 실패 목록을 삼킨 요약은 새 불변식에 걸리지만, 종전 공허 단언은 그대로 통과한다', () => {
    const s = summarizeCell(mkRows());
    const doctored = { ...s, failures: [] }; // "수치는 나쁜데 목록은 비어있는" 은폐 시나리오
    // 종전 단언(§LOW-3 이전): 항상 참 → 은폐를 전혀 잡지 못한다.
    expect((doctored.categoryFailCounts.progression || 0) >= 0).toBe(true);
    // 교체한 실불변식: 즉시 위반을 검출한다.
    expect(doctored.failures.length).not.toBe(doctored.fail);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// §M-C 유닛 테스트: gameNo 누락 → multi-game 측정 차단(fail-fast/unsupported).
//
// 합성으로 "재경기(gameRound 2)"를 만들어, 수정 전 일괄 fallback이 실제로 100% FP를 만들고
// 수정 후에는 명시적 unsupported로 종결되는지 직접 실증한다.
// ⚠️ index.html:7538 COUNTDOWN_START emit에는 gameNo가 없으므로(전 소스 유일 emit, grep 확인)
// 아래 mkCountdownStart도 gameNo를 싣지 않는다 — REAL 스키마 그대로다. gameNo를 싣는 것은
// SYNC_RENDER(:7562 등)뿐이며, 그것이 유일한 게임 귀속 근거다.
// ════════════════════════════════════════════════════════════════════════════
function mkMultiGameTrial({ finalGameRound = 2 } = {}) {
  // 게임1 라운드1 앵커 = 1_000_000, 게임2 라운드1 앵커 = 2_000_000(재경기라 반드시 다른 값).
  const devices = ['p0', 'p1'].map((id, i) => ({
    id, skewMs: 0,
    telemetry: {
      events: [
        mkClockSyncOk(),
        mkCountdownStart(1, 1_000_000), // ← gameNo 없음(REAL 스키마)
        mkSyncRender('countdown', 1, 1_000_000 + i, 1),
        mkSyncRender('result', 1, 1_005_000 + i, 1),
        // ── 재경기(gameNo 2) ──
        mkCountdownStart(1, 2_000_000), // ← 같은 round 1인데 다른 게임. gameNo 없음.
        mkSyncRender('countdown', 1, 2_000_000 + i, 2),
        mkSyncRender('result', 1, 2_005_000 + i, 2),
      ],
    },
    rendered: { choiceStartByRound: {}, choiceEndByRound: {} },
    impl: { state: { roomCode: 'ROOM-SIM', gameRound: finalGameRound } },
  }));
  return mkTrial({ devices, finalRound: 1 });
}

describe('§M-C(critic): gameNo 누락 — multi-game 측정 차단(single-game scope 한정)', () => {
  it('[MC-1] 단일 게임 trial은 SINGLE_GAME scope로 확인되고 앵커 비교가 정상 수행된다', () => {
    const ceo = computeCeoPassUnits(mkHealthyTrial({}, { deviceCount: 3 }));
    expect(ceo.measurementScope.supported).toBe(true);
    expect(ceo.measurementScope.reason).toBe('SINGLE_GAME');
    expect(ceo.measurementScope.scopeGameNo).toBe(1);
    expect(ceo.measurementScope.gameNos).toEqual([1]);
    expect(ceo.measurementScope.anchorComparisonPerformed).toBe(true);
    expect(ceo.clockSync.pass).toBe(true);
    // unitKey의 gameNo 성분은 "종료 시점 fallback"이 아니라 확인된 scope 값이다.
    expect(makeCountdownUnitKey({ device: 'p1', roomCode: 'ROOM-SIM', gameNo: ceo.measurementScope.scopeGameNo, round: 1 }))
      .toBe('p1|ROOM-SIM|1|1');
  });

  it('[MC-2] multi-game(재경기) trial은 unsupported로 종결되고 절대 PASS가 되지 않는다', () => {
    const ceo = computeCeoPassUnits(mkMultiGameTrial());
    expect(ceo.measurementScope.supported).toBe(false);
    expect(ceo.measurementScope.reason).toBe('MULTI_GAME_UNSUPPORTED');
    expect(ceo.measurementScope.gameNos).toEqual([1, 2]);
    expect(ceo.measurementScope.anchorComparisonPerformed).toBe(false);
    const f = ceo.clockSync.countdownPermanentFailures.find((x) => x.type === 'MULTI_GAME_MEASUREMENT_UNSUPPORTED');
    expect(f).toBeTruthy();
    expect(f.reason).toBe('MULTI_GAME_UNSUPPORTED');
    expect(f.officialScope).toBe('single_game');
    // 조용한 오판 금지: correctness FAIL이므로 이 trial은 어떤 경우에도 PASS로 집계되지 않는다.
    expect(ceo.correctnessPass).toBe(false);
    expect(ceo.ceoPass).toBe(false);
  });

  it('[MC-3] multi-game에서 gameNo 의존 판정(COUNTDOWN_ANCHOR_DIVERGED)은 아예 생성되지 않는다(FP 차단)', () => {
    const ceo = computeCeoPassUnits(mkMultiGameTrial());
    expect(ceo.clockSync.anchorDivergences).toEqual([]);
    expect(ceo.clockSync.anchorRoundKeyCount).toBe(0);
    expect(ceo.clockSync.countdownPermanentFailures.map((x) => x.type)).not.toContain('COUNTDOWN_ANCHOR_DIVERGED');
  });

  it('[MC-4] fail-fast API는 multi-game에서 예외를 던진다(호출부가 예외를 원할 때의 경로)', () => {
    expect(() => assertSingleGameMeasurementScope(mkMultiGameTrial().world))
      .toThrow(/CEO_MEASUREMENT_UNSUPPORTED_SCOPE: MULTI_GAME_UNSUPPORTED/);
    // single-game이면 통과하고 scope를 돌려준다.
    const scope = assertSingleGameMeasurementScope(mkHealthyTrial({}).world);
    expect(scope.scopeGameNo).toBe(1);
  });

  it('[MC-5] gameNo 근거가 전혀 없으면 추정하지 않고 GAME_NO_UNOBSERVED로 unsupported 선언한다', () => {
    // COUNTDOWN_START만 있고(gameNo 없음) SYNC_RENDER도 state.gameRound도 없는 기기.
    const devices = ['p0', 'p1'].map((id) => ({
      id, skewMs: 0,
      telemetry: { events: [mkClockSyncOk(), mkCountdownStart(1, 1_000_000)] },
      rendered: { choiceStartByRound: {}, choiceEndByRound: {} },
      impl: { state: { roomCode: 'ROOM-SIM' } }, // gameRound 없음
    }));
    const scope = resolveMeasurementGameScope({ devices });
    expect(scope.supported).toBe(false);
    expect(scope.reason).toBe('GAME_NO_UNOBSERVED');
    expect(scope.scopeGameNo).toBe(null);
  });

  it('[MC-6] 기기 하나만 재경기에 진입해도 trial 전체가 unsupported다(부분 병합 금지)', () => {
    const trial = mkMultiGameTrial();
    // p1은 게임2 이벤트를 보지 못했고 상태도 게임1에 머물러 있다 → gameNos = [1,2] (trial 전체 기준).
    trial.world.devices[1].telemetry.events = trial.world.devices[1].telemetry.events.slice(0, 4);
    trial.world.devices[1].impl.state.gameRound = 1;
    const scope = resolveMeasurementGameScope(trial.world);
    expect(scope.supported).toBe(false);
    expect(scope.gameNoByDevice.p0).toEqual([1, 2]);
    expect(scope.gameNoByDevice.p1).toEqual([1]);
  });

  it('[MC-7] 정책 상수가 리포트에 그대로 노출된다(프로덕션 gameNo 결손을 문서 아닌 코드로 남긴다)', () => {
    expect(MEASUREMENT_GAME_SCOPE_POLICY.officialScope).toBe('single_game');
    expect(MEASUREMENT_GAME_SCOPE_POLICY.multiGameSupported).toBe(false);
    expect(MEASUREMENT_GAME_SCOPE_POLICY.anchorEmitCarriesGameNo).toBe(false);
    expect(MEASUREMENT_GAME_SCOPE_POLICY.productionMetricGap).toContain('index.html:7538');
  });
});

describe('§M-C mutation(반공허성): 일괄 fallback을 되살리면 재경기가 100% FP가 된다', () => {
  it('[MC-M1] blanketFallbackGameNo=true(수정 전)면 게임1/게임2 라운드1이 병합돼 COUNTDOWN_ANCHOR_DIVERGED FP가 발화한다', () => {
    const trial = mkMultiGameTrial();
    // 수정본: unsupported로 종결하고 divergence를 만들지 않는다.
    const fixed = computeCeoPassUnits(trial);
    expect(fixed.clockSync.anchorDivergences).toEqual([]);
    expect(fixed.clockSync.countdownPermanentFailures.map((f) => f.type)).toEqual(['MULTI_GAME_MEASUREMENT_UNSUPPORTED']);

    // 수정 전(mutation): 종료 시점 gameRound=2를 모든 라운드에 일괄 적용 → roundKey 'ROOM-SIM|2|1'로
    // 두 게임의 앵커가 병합 → 반드시 다른 값 → 100% false positive.
    const mutated = computeCeoPassUnits(trial, { mutations: { blanketFallbackGameNo: true } });
    const fp = mutated.clockSync.countdownPermanentFailures.find((f) => f.type === 'COUNTDOWN_ANCHOR_DIVERGED');
    expect(fp).toBeTruthy();
    expect(fp.roundKey).toBe('ROOM-SIM|2|1'); // ← 게임2 번호가 게임1 라운드에도 박힌 증거
    expect(fp.distinctAnchors).toEqual([1_000_000, 2_000_000]);
    expect(fp.spreadMs).toBe(1_000_000);
    expect(mutated.correctnessPass).toBe(false);
    // 그리고 mutation에서는 unsupported 선언 자체가 사라진다(= 조용한 오판).
    expect(mutated.clockSync.countdownPermanentFailures.map((f) => f.type)).not.toContain('MULTI_GAME_MEASUREMENT_UNSUPPORTED');
  });

  it('[MC-M2] mutation이 재경기 trial "전부"에서 FP를 만든다(100% FP 주장의 실증)', () => {
    // 앵커 값/기기 수/최종 gameRound를 바꿔가며 10개 재경기 trial을 만들어도 전부 FP다.
    let fpCount = 0;
    for (let k = 0; k < 10; k++) {
      const trial = mkMultiGameTrial({ finalGameRound: 2 + (k % 3) });
      const mutated = computeCeoPassUnits(trial, { mutations: { blanketFallbackGameNo: true } });
      if (mutated.clockSync.countdownPermanentFailures.some((f) => f.type === 'COUNTDOWN_ANCHOR_DIVERGED')) fpCount++;
    }
    expect(fpCount).toBe(10);
    // 수정본은 같은 10건에서 FP 0건(대신 전부 unsupported로 명시 종결).
    let fixedFp = 0;
    let unsupported = 0;
    for (let k = 0; k < 10; k++) {
      const ceo = computeCeoPassUnits(mkMultiGameTrial({ finalGameRound: 2 + (k % 3) }));
      if (ceo.clockSync.countdownPermanentFailures.some((f) => f.type === 'COUNTDOWN_ANCHOR_DIVERGED')) fixedFp++;
      if (ceo.measurementScope.supported === false) unsupported++;
    }
    expect(fixedFp).toBe(0);
    expect(unsupported).toBe(10);
  });

  it('[MC-M3] single-game 경로는 mutation 유무와 무관하게 동일하다(회귀 없음 확인)', () => {
    const trial = mkHealthyTrial({ p1: [mkInvalidTs(1, 0), mkCountdownStart(1, 1_000_000)] });
    const fixed = computeCeoPassUnits(trial);
    const mutated = computeCeoPassUnits(trial, { mutations: { blanketFallbackGameNo: true } });
    expect(fixed.clockSync.pass).toBe(mutated.clockSync.pass);
    expect(fixed.clockSync.countdownTransient.units[0].unitKey).toBe(mutated.clockSync.countdownTransient.units[0].unitKey);
    expect(fixed.clockSync.countdownTransient.units[0].unitKey).toBe('p1|ROOM-SIM|1|1');
  });
});

describe('§M-1(critic) mutation(반공허성): divergence 검사를 끄면 AD-1이 깨진다', () => {
  it('[AD-M1] ignoreAnchorDivergence=true면 기기간 앵커 불일치를 놓친다', () => {
    const devices = [
      mkDevice('p0', [mkClockSyncOk(), mkCountdownStart(1, 1_000_000), mkSyncRender('countdown', 1, 1_000_000), mkSyncRender('result', 1, 1_005_000)]),
      mkDevice('p1', [mkClockSyncOk(), mkCountdownStart(1, 1_003_600), mkSyncRender('countdown', 1, 1_000_100), mkSyncRender('result', 1, 1_005_100)]),
    ];
    const trial = mkTrial({ devices });
    expect(computeCeoPassUnits(trial).clockSync.pass).toBe(false); // 수정본은 검출
    expect(computeCeoPassUnits(trial, { mutations: { ignoreAnchorDivergence: true } }).clockSync.pass).toBe(true);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// §M-1 유닛 테스트: phase별 expectation 분리.
// ════════════════════════════════════════════════════════════════════════════
// active 2 + confirmed 1(safe 또는 loser) 구성의 1라운드 trial.
//   - countdown SYNC_RENDER: active 2대만 (REAL isCurrentRoundParticipant 라우팅)
//   - result   SYNC_RENDER: 전 기기 (REAL index.html:5895 — 라우팅 이전)
function mkMixedRoundTrial({ activeIds, confirmedIds, omit = {}, includeReadyRound2 = false }) {
  const allIds = [...activeIds, ...confirmedIds];
  const devices = allIds.map((id, i) => {
    const events = [mkClockSyncOk(), mkCountdownStart(1, 1_000_000)];
    if (activeIds.includes(id) && !(omit.countdown || []).includes(id)) events.push(mkSyncRender('countdown', 1, 1_000_000 + i));
    if (!(omit.result || []).includes(id)) events.push(mkSyncRender('result', 1, 1_005_000 + i));
    if (includeReadyRound2) {
      if (!(omit.nextRound || []).includes(id)) events.push(mkSyncRender('nextRound', 2, 1_006_000 + i));
      events.push(mkSyncRender('countdown', 2, 1_007_000 + i));
      events.push(mkSyncRender('result', 2, 1_008_000 + i));
      events.push(mkCountdownStart(2, 1_007_000));
    }
    return mkDevice(id, events);
  });
  const oraclePerRound = [{ round: 1, outcome: 'tooMany', activeIds: [...activeIds] }];
  if (includeReadyRound2) oraclePerRound.push({ round: 2, outcome: 'gameOver', activeIds: [...allIds] });
  return mkTrial({ devices, finalRound: includeReadyRound2 ? 2 : 1, oraclePerRound });
}

describe('§M-1: phase별 기대 커버리지 분리(countdown=activeIds / result·nextRound=전 기기)', () => {
  it('[M1-1] active 2 + confirmedSafe 1 → countdown 기대치는 2(활성만)', () => {
    const expected = expectedPhaseCoverageFor('countdownStart', { round: 1, activeCount: 2, participatingDeviceCount: 3 });
    expect(expected).toBe(2);
    expect(expectationBasisFor('countdownStart')).toBe('activeIds');
  });

  it('[M1-2] 동일 라운드의 result 기대치는 3(확정 안전 포함 전 기기)', () => {
    const expected = expectedPhaseCoverageFor('result', { round: 1, activeCount: 2, participatingDeviceCount: 3 });
    expect(expected).toBe(3);
    expect(expectationBasisFor('result')).toBe('participatingDevices');
  });

  it('[M1-3] confirmedLoser가 포함돼도 result 기대치는 전 기기 수다', () => {
    const trial = mkMixedRoundTrial({ activeIds: ['p0', 'p1'], confirmedIds: ['p2', 'p3'] });
    const ceo = computeCeoPassUnits(trial);
    expect(ceo.participatingDeviceCount).toBe(4);
    expect(expectedPhaseCoverageFor('result', { round: 1, activeCount: 2, participatingDeviceCount: 4 })).toBe(4);
    expect(ceo.progression.pass).toBe(true); // 전 기기가 result를 렌더했으므로 정상
  });

  it('[M1-4] result 렌더가 1기기 누락되면 progression FAIL', () => {
    const trial = mkMixedRoundTrial({ activeIds: ['p0', 'p1'], confirmedIds: ['p2'], omit: { result: ['p2'] } });
    const ceo = computeCeoPassUnits(trial);
    expect(ceo.progression.pass).toBe(false);
    const f = ceo.progression.failures.find((x) => x.type === 'MISSING_PHASE_RENDER');
    expect(f).toBeTruthy();
    expect(f.detail.length).toBe(1);
    expect(f.detail[0]).toMatchObject({ round: 1, phase: 'result', coverage: 2, of: 3, expectationBasis: 'participatingDevices' });
    // §M-4(critic): 발화 시 원인 분류에 필요한 진단이 함께 실려야 한다.
    expect(f.detail[0].missingDevices).toEqual(['p2']);
    expect(f.detail[0].renderedDevices).toEqual(['p0', 'p1']);
    expect(f.detail[0].traces.map((t) => t.device)).toEqual(['p2']);
    // p2는 확정 참가자라 countdown을 렌더하지 않고, 이 시나리오에서는 result도 누락됐다 → 빈 시퀀스.
    expect(f.detail[0].traces[0].renderSeq).toEqual([]);
    expect(ceo.ceoPass).toBe(false);
  });

  it('[M1-5] countdown에서 확정 참가자가 렌더하지 않는 것은 정상(PASS)', () => {
    const trial = mkMixedRoundTrial({ activeIds: ['p0', 'p1'], confirmedIds: ['p2', 'p3', 'p4'] });
    const ceo = computeCeoPassUnits(trial);
    expect(ceo.progression.pass).toBe(true);
    expect(ceo.progression.failures).toEqual([]);
  });

  it('[M1-6] nextRound(ready) 기대치는 별도 규칙 — r=1은 판정 불가(null), r>=2는 전 기기(activeIds 아님)', () => {
    expect(expectedPhaseCoverageFor('nextRound', { round: 1, activeCount: 2, participatingDeviceCount: 5 })).toBe(null);
    expect(expectedPhaseCoverageFor('nextRound', { round: 2, activeCount: 2, participatingDeviceCount: 5 })).toBe(5);
    expect(expectedPhaseCoverageFor('nextRound', { round: 7, activeCount: 1, participatingDeviceCount: 5 })).toBe(5);
    expect(expectationBasisFor('nextRound')).toBe('participatingDevices');
    // 실제 trial: r=2 ready를 1기기가 놓치면 FAIL
    const ok = computeCeoPassUnits(mkMixedRoundTrial({ activeIds: ['p0', 'p1'], confirmedIds: ['p2'], includeReadyRound2: true }));
    expect(ok.progression.pass).toBe(true);
    const bad = computeCeoPassUnits(mkMixedRoundTrial({ activeIds: ['p0', 'p1'], confirmedIds: ['p2'], includeReadyRound2: true, omit: { nextRound: ['p2'] } }));
    expect(bad.progression.pass).toBe(false);
    const detail = bad.progression.failures.find((x) => x.type === 'MISSING_PHASE_RENDER').detail;
    expect(detail.length).toBe(1);
    expect(detail[0]).toMatchObject({ round: 2, phase: 'nextRound', coverage: 2, of: 3, expectationBasis: 'participatingDevices' });
    expect(detail[0].missingDevices).toEqual(['p2']);
  });

  it('[M1-보강] ready(nextRound) timing 측정은 마지막 라운드에서도 배제되지 않는다(종전 isLastRound 누락 정정)', () => {
    // r=2가 마지막 라운드인데 두 기기의 ready 렌더가 900ms 벌어져 있다 → timing 위반으로 잡혀야 한다.
    const devices = ['p0', 'p1'].map((id, i) => mkDevice(id, [
      mkClockSyncOk(), mkCountdownStart(1, 1_000_000), mkCountdownStart(2, 1_007_000),
      mkSyncRender('countdown', 1, 1_000_000 + i), mkSyncRender('result', 1, 1_005_000 + i),
      mkSyncRender('nextRound', 2, 1_006_000 + i * 900),
      mkSyncRender('countdown', 2, 1_007_000 + i), mkSyncRender('result', 2, 1_008_000 + i),
    ]));
    const trial = mkTrial({
      devices, finalRound: 2,
      oraclePerRound: [{ round: 1, outcome: 'allDraw', activeIds: ['p0', 'p1'] }, { round: 2, outcome: 'gameOver', activeIds: ['p0', 'p1'] }],
    });
    const ceo = computeCeoPassUnits(trial);
    const readyViolation = ceo.timing.violations.find((v) => v.phase === 'ready' && v.round === 2);
    expect(readyViolation).toBeTruthy();
    expect(readyViolation.diffMs).toBe(900);
  });
});

describe('§M-1 mutation(반공허성): 수정을 되돌리면 해당 테스트가 실제로 깨진다', () => {
  it('[M1-M1] result 기대치를 다시 activeIds로 되돌리면 M1-4가 실패한다(누락을 못 잡는다)', () => {
    const trial = mkMixedRoundTrial({ activeIds: ['p0', 'p1'], confirmedIds: ['p2'], omit: { result: ['p2'] } });
    expect(computeCeoPassUnits(trial).progression.pass).toBe(false); // 수정본은 검출
    const mutated = computeCeoPassUnits(trial, { mutations: { resultExpectationUsesActiveIds: true } });
    expect(mutated.progression.pass).toBe(true); // mutation은 놓친다(=수정 전 마스킹 재현)
    expect(expectedPhaseCoverageFor('result', { round: 1, activeCount: 2, participatingDeviceCount: 3 }, { resultExpectationUsesActiveIds: true })).toBe(2);
  });

  it('[M1-M2] phase별 분리 자체를 제거하면 M1-4/M1-6이 실패한다', () => {
    const resultMissing = mkMixedRoundTrial({ activeIds: ['p0', 'p1'], confirmedIds: ['p2'], omit: { result: ['p2'] } });
    expect(computeCeoPassUnits(resultMissing, { mutations: { disablePerPhaseExpectation: true } }).progression.pass).toBe(true);
    const readyMissing = mkMixedRoundTrial({ activeIds: ['p0', 'p1'], confirmedIds: ['p2'], includeReadyRound2: true, omit: { nextRound: ['p2'] } });
    expect(computeCeoPassUnits(readyMissing).progression.pass).toBe(false);
    expect(computeCeoPassUnits(readyMissing, { mutations: { disablePerPhaseExpectation: true } }).progression.pass).toBe(true);
    // 분리를 제거하면 result가 activeIds로 되돌아가고 nextRound는 아예 검사되지 않는다(수정 전 구조).
    expect(expectedPhaseCoverageFor('result', { round: 1, activeCount: 2, participatingDeviceCount: 9 }, { disablePerPhaseExpectation: true })).toBe(2);
    expect(expectedPhaseCoverageFor('nextRound', { round: 3, activeCount: 2, participatingDeviceCount: 9 }, { disablePerPhaseExpectation: true })).toBe(null);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// §C-1 유닛 테스트: Release Gate profile 정책.
// ════════════════════════════════════════════════════════════════════════════
function mkStats({ normal = {}, degraded = {}, extreme = {} } = {}) {
  const d = (o, def) => ({ trials: 1000, timingPass: def.timingPass, correctnessPass: 1000, ceoPass: def.timingPass, ...o });
  return [
    { profile: 'Normal', ...d(normal, { timingPass: 1000 }) },
    { profile: 'Degraded', ...d(degraded, { timingPass: 1000 }) },
    { profile: 'Extreme', ...d(extreme, { timingPass: 1000 }) },
  ];
}

describe('§C-1: Release Gate profile 정책(timing=Normal만, correctness=3 profile 전부 100%)', () => {
  it('[C1-1] Normal timing 94.9% → overall FAIL', () => {
    const gate = computeReleaseGate(mkStats({ normal: { timingPass: 949 } }));
    expect(gate.overallReleasePass).toBe(false);
    expect(gate.gateFailures).toEqual([{ profile: 'Normal', gate: 'timing', rate: 0.949, required: 0.95 }]);
  });

  it('[C1-2] Normal timing 정확히 95% → timing gate PASS', () => {
    const gate = computeReleaseGate(mkStats({ normal: { timingPass: 950 } }));
    const normal = gate.perProfile.find((r) => r.profile === 'Normal');
    expect(normal.timingGateApplied).toBe(true);
    expect(normal.timingGatePass).toBe(true);
    expect(gate.overallReleasePass).toBe(true);
  });

  it('[C1-3] Degraded timing 10%여도 Normal이 통과하면 overall timing은 PASS', () => {
    const gate = computeReleaseGate(mkStats({ normal: { timingPass: 970 }, degraded: { timingPass: 100 }, extreme: { timingPass: 33 } }));
    const deg = gate.perProfile.find((r) => r.profile === 'Degraded');
    expect(deg.timingGateApplied).toBe(false);
    expect(deg.timingSuccessRate).toBe(0.1); // 수치는 그대로 보고된다(완화/삭제 아님)
    expect(gate.timingGatePass).toBe(true);
    expect(gate.overallReleasePass).toBe(true);
  });

  it('[C1-4] Degraded correctness 실패 → overall FAIL', () => {
    const gate = computeReleaseGate(mkStats({ degraded: { correctnessPass: 999 } }));
    expect(gate.overallReleasePass).toBe(false);
    expect(gate.gateFailures.some((f) => f.profile === 'Degraded' && f.gate === 'correctness')).toBe(true);
  });

  it('[C1-5] Extreme correctness 실패 → overall FAIL', () => {
    const gate = computeReleaseGate(mkStats({ extreme: { correctnessPass: 999 } }));
    expect(gate.overallReleasePass).toBe(false);
    expect(gate.gateFailures.some((f) => f.profile === 'Extreme' && f.gate === 'correctness')).toBe(true);
  });

  it('[C1-6] profileRole 출력이 정확하다(release_gate / informational / stress)', () => {
    const gate = computeReleaseGate(mkStats());
    expect(gate.perProfile.map((r) => [r.profile, r.profileRole])).toEqual([
      ['Normal', 'release_gate'], ['Degraded', 'informational'], ['Extreme', 'stress'],
    ]);
    expect(PROFILES.Normal.profileRole).toBe('release_gate');
    expect(PROFILES.Degraded.profileRole).toBe('informational');
    expect(PROFILES.Extreme.profileRole).toBe('stress');
    expect(gate.policy.timingGateProfiles).toEqual(['Normal']);
    expect(gate.policy.correctnessGateProfiles).toEqual(['Normal', 'Degraded', 'Extreme']);
  });

  it('[C1-7] Degraded/Extreme 수치가 보고서에서 누락되지 않는다(삭제·완화·PASS 포장 금지)', () => {
    const gate = computeReleaseGate(mkStats({ normal: { timingPass: 970 }, degraded: { timingPass: 46, trials: 360, correctnessPass: 360, ceoPass: 46 }, extreme: { timingPass: 12, trials: 360, correctnessPass: 360, ceoPass: 12 } }));
    expect(gate.perProfile.length).toBe(3);
    const deg = gate.perProfile.find((r) => r.profile === 'Degraded');
    const ext = gate.perProfile.find((r) => r.profile === 'Extreme');
    for (const row of [deg, ext]) {
      expect(row.trials).toBeGreaterThan(0);
      expect(row.timingPass).not.toBeUndefined();
      expect(row.timingSuccessRate).not.toBeNull();
      expect(row.correctnessSuccessRate).not.toBeNull();
      expect(row.clockSpreadCeilingMs).toBeGreaterThan(CEO_PHASE_TIMING_LIMIT_MS);
      // §LOW-5: 이름 정정 — "게이트 달성 가능"이 아니라 "clock 잔차 천장이 게이트 한도 이내인가".
      expect(row.clockCeilingWithinTimingLimit).toBe(false);
      // §M-5: 진짜 근거(분포)가 행에 함께 실린다.
      expect(row.clockResidualPOver250).toBeGreaterThan(5);
    }
    expect(deg.timingSuccessRate).toBeCloseTo(46 / 360, 6);
    expect(ext.timingSuccessRate).toBeCloseTo(12 / 360, 6);
    // Normal은 천장이 250ms 아래이고 잔차 분포상 게이트를 깰 수 없다(= 미달이면 코드 문제).
    const nrm = gate.perProfile.find((r) => r.profile === 'Normal');
    expect(nrm.clockCeilingWithinTimingLimit).toBe(true);
    expect(nrm.clockResidualPOver250).toBe(0);
    // 종전 오독 유발 필드명은 제거됐다(§LOW-5).
    expect('timingGateReachable' in nrm).toBe(false);
  });

  it('[M5-1] Degraded/Extreme 게이트 제외 근거는 "천장 초과"가 아니라 잔차 분포다(재현 가능)', () => {
    // §M-5(critic): 상한이 250ms를 넘는다는 사실만으로는 5% 초과가 증명되지 않는다. 아래 MC가
    // 실제 분포를 재현하고, 그 결과가 문서화된 상수(CLOCK_RESIDUAL_SPREAD_MC)와 일치함을 단언한다.
    const trials = 20000; // 테스트 실행시간 고려(문서 상수는 200k) — 백분위는 충분히 안정적이다.
    const out = {};
    for (const name of ['Normal', 'Degraded', 'Extreme']) {
      const p = PROFILES[name];
      out[name] = simulateClockResidualSpread({
        rttBaseMin: p.clockRttBaseMin, rttBaseMax: p.clockRttBaseMax,
        jitterFrac: p.clockRttJitterFrac, trials, seed: CLOCK_RESIDUAL_SPREAD_MC.seed,
      });
    }
    // eslint-disable-next-line no-console
    console.log('[CEO-CLOCK-RESIDUAL-MC]', JSON.stringify(out));
    // (1) Normal은 clock 잔차만으로는 250ms 게이트를 깰 수 없다 → Normal timing 미달 = 코드 문제.
    expect(out.Normal.pOver250).toBe(0);
    // (2) Degraded/Extreme은 5%(=95% 게이트 여유)를 압도적으로 초과한다 → 게이트 제외가 정당.
    expect(out.Degraded.pOver250).toBeGreaterThan(30);
    expect(out.Extreme.pOver250).toBeGreaterThan(75);
    // (3) 문서화된 상수와 재현값이 일치한다(상수가 낡으면 즉시 RED).
    for (const name of ['Normal', 'Degraded', 'Extreme']) {
      const doc = CLOCK_RESIDUAL_SPREAD_MC.byProfile[name];
      expect(Math.abs(out[name].p50 - doc.p50)).toBeLessThanOrEqual(6);
      expect(Math.abs(out[name].p95 - doc.p95)).toBeLessThanOrEqual(12);
      expect(Math.abs(out[name].pOver250 - doc.pOver250)).toBeLessThanOrEqual(3);
    }
    // (4) "천장"은 엄밀한 상한이 아니다 — jitter 때문에 실현값이 천장을 넘을 수 있다(종전 논증의
    //     결함을 상수로 박제한다: Normal 천장 210ms인데 200k MC max는 207~213ms).
    expect(CLOCK_RESIDUAL_SPREAD_MC.byProfile.Normal.max).toBeGreaterThan(190);
    expect(PROFILES.Normal.clockSpreadCeilingMs).toBe(210);
  });

  it('[M5-2] MC 재현 함수는 결정론적이다(같은 seed → 같은 결과, 다른 seed → 결론 동일)', () => {
    const args = { rttBaseMin: 120, rttBaseMax: 800, jitterFrac: 0.5, trials: 5000 };
    const a = simulateClockResidualSpread({ ...args, seed: 42 });
    const b = simulateClockResidualSpread({ ...args, seed: 42 });
    expect(a).toEqual(b);
    const c = simulateClockResidualSpread({ ...args, seed: 43 });
    expect(c.pOver250).toBeGreaterThan(30); // 결론(게이트 제외 정당성)은 seed에 의존하지 않는다
  });
});

describe('§C-1 mutation(반공허성): 정책을 되돌리면 해당 테스트가 실제로 깨진다', () => {
  it('[C1-M1] Degraded timing을 다시 overall 95% 게이트에 포함하면 C1-3이 실패한다', () => {
    const stats = mkStats({ normal: { timingPass: 970 }, degraded: { timingPass: 100 }, extreme: { timingPass: 33 } });
    expect(computeReleaseGate(stats).overallReleasePass).toBe(true); // 정책 적용본
    const mutated = computeReleaseGate(stats, { mutations: { timingGateAllProfiles: true } });
    expect(mutated.overallReleasePass).toBe(false);
    expect(mutated.timingGatePass).toBe(false);
  });

  it('[C1-M2] release_gate가 아닌 profile의 correctness를 무시하면 C1-4/C1-5가 실패한다', () => {
    const degStats = mkStats({ degraded: { correctnessPass: 999 } });
    expect(computeReleaseGate(degStats).overallReleasePass).toBe(false);
    expect(computeReleaseGate(degStats, { mutations: { ignoreNonReleaseGateCorrectness: true } }).overallReleasePass).toBe(true);
    const extStats = mkStats({ extreme: { correctnessPass: 999 } });
    expect(computeReleaseGate(extStats).overallReleasePass).toBe(false);
    expect(computeReleaseGate(extStats, { mutations: { ignoreNonReleaseGateCorrectness: true } }).overallReleasePass).toBe(true);
  });

  it('[C1-M3] profileRole 출력을 제거하면 C1-6이 실패한다', () => {
    const gate = computeReleaseGate(mkStats(), { mutations: { omitProfileRole: true } });
    expect(gate.perProfile.every((r) => r.profileRole === undefined)).toBe(true);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// §HIGH-1 유닛 테스트: strict 모드가 실제로 작동하는가(= 게이트가 CI 강제력을 갖는가).
// ════════════════════════════════════════════════════════════════════════════
describe('§HIGH-1: 게이트 테스트의 합성 fallback 제거 + CEO_GATE_STRICT 강제 모드', () => {
  const okGate = computeReleaseGate([
    { profile: 'Normal', trials: 100, timingPass: 100, correctnessPass: 100, ceoPass: 100 },
    { profile: 'Degraded', trials: 100, timingPass: 10, correctnessPass: 100, ceoPass: 10 },
    { profile: 'Extreme', trials: 100, timingPass: 2, correctnessPass: 100, ceoPass: 2 },
  ]);
  const badGate = computeReleaseGate([
    { profile: 'Normal', trials: 100, timingPass: 74, correctnessPass: 90, ceoPass: 70 },
    { profile: 'Degraded', trials: 100, timingPass: 10, correctnessPass: 100, ceoPass: 10 },
    { profile: 'Extreme', trials: 100, timingPass: 2, correctnessPass: 100, ceoPass: 2 },
  ]);
  const three = [{ profile: 'Normal' }, { profile: 'Degraded' }, { profile: 'Extreme' }];

  it('[G-1] 헤드라인 집계가 결손이면 strict 모드는 반드시 위반을 보고한다(조용한 통과 금지)', () => {
    const v = evaluateReleaseGateAssertion({ headlineStats: [], gate: null, strict: true });
    expect(v.violations.map((x) => x.type)).toEqual(['HEADLINE_STATS_INCOMPLETE']);
    expect(v.violations[0].got).toBe(0);
    expect(v.measured).toBe(false);
  });

  it('[G-2] 헤드라인 1~2개만 있어도(=일부 it이 throw/timeout) strict는 통과시키지 않는다', () => {
    for (const stats of [[{ profile: 'Normal' }], [{ profile: 'Normal' }, { profile: 'Degraded' }]]) {
      const v = evaluateReleaseGateAssertion({ headlineStats: stats, gate: null, strict: true });
      expect(v.violations.length).toBe(1);
      expect(v.violations[0].type).toBe('HEADLINE_STATS_INCOMPLETE');
    }
  });

  it('[G-3] 비strict(기본)에서는 결손이 위반이 아니고 "정책 불변식만" 검증 대상이 된다', () => {
    const v = evaluateReleaseGateAssertion({ headlineStats: [], gate: null, strict: false });
    expect(v.violations).toEqual([]);
    expect(v.policyInvariantsOnly).toBe(true);
    expect(v.mode).toBe('report_only');
  });

  it('[G-4] strict 모드는 실측 게이트 실패를 반드시 위반으로 올린다(현재 STOP-SHIP 상태 재현)', () => {
    expect(badGate.overallReleasePass).toBe(false);
    const v = evaluateReleaseGateAssertion({ headlineStats: three, gate: badGate, strict: true });
    expect(v.violations.map((x) => x.type)).toEqual(['RELEASE_GATE_FAILED']);
    expect(v.violations[0].gateFailures.length).toBeGreaterThan(0);
    // 비strict에서는 같은 실패가 "열거만"으로 남는다(측정 리포트가 끊기지 않도록).
    expect(evaluateReleaseGateAssertion({ headlineStats: three, gate: badGate, strict: false }).violations).toEqual([]);
  });

  it('[G-5] strict 모드라도 실측이 전부 통과하면 위반이 없다(게이트가 항상 RED인 것은 아니다)', () => {
    expect(okGate.overallReleasePass).toBe(true);
    const v = evaluateReleaseGateAssertion({ headlineStats: three, gate: okGate, strict: true });
    expect(v.violations).toEqual([]);
    expect(v.mode).toBe('strict');
    expect(v.policyInvariantsOnly).toBe(false);
  });

  it('[G-6] strict 모드는 CEO_GATE_STRICT=1 환경변수로만 켜진다', () => {
    expect(isGateStrictMode({})).toBe(false);
    expect(isGateStrictMode({ CEO_GATE_STRICT: '0' })).toBe(false);
    expect(isGateStrictMode({ CEO_GATE_STRICT: 'true' })).toBe(false);
    expect(isGateStrictMode({ CEO_GATE_STRICT: '1' })).toBe(true);
  });

  it('[G-M1] mutation: 합성 fallback의 overallReleasePass 단언을 되살리면 "측정 결손"이 GREEN이 된다', () => {
    // 수정 전 구조 재현: 헤드라인이 하나도 없어도 합성 입력의 PASS만 보고 통과시킨다.
    const legacyFallback = computeReleaseGate([
      { profile: 'Normal', trials: 1, timingPass: 1, correctnessPass: 1, ceoPass: 1 },
      { profile: 'Degraded', trials: 1, timingPass: 0, correctnessPass: 1, ceoPass: 0 },
      { profile: 'Extreme', trials: 1, timingPass: 0, correctnessPass: 1, ceoPass: 0 },
    ]);
    expect(legacyFallback.overallReleasePass).toBe(true); // ← 수정 전에는 이걸 단언했다(가짜 안전)
    // 수정본에서는 같은 상황(실측 0건)이 strict에서 반드시 위반이다.
    expect(evaluateReleaseGateAssertion({ headlineStats: [], gate: legacyFallback, strict: true }).violations.length).toBe(1);
    // 그리고 게이트 테스트 본문에 합성 PASS 단언이 남아있지 않은지 소스로 확인한다(회귀 차단).
    const src = releaseGateTestBody.toString();
    expect(src).not.toContain('overallReleasePass).toBe(true)');
    expect(src).toContain('verdict.violations');
  });
});

// ════════════════════════════════════════════════════════════════════════════
// §M-B 유닛 테스트: 미발화 detector 분류가 리포트에서 커버리지 PASS로 둔갑하지 않는가.
// ════════════════════════════════════════════════════════════════════════════
describe('§M-B(critic): 미발화 detector 4종 분류 + 3개 상태 필드', () => {
  const REQUIRED = ['COUNTDOWN_ANCHOR_DIVERGED', 'ROUND_ENDED_WITHOUT_VALID_ANCHOR', 'STALE_ABORT_EXEMPTION_NARROWED', 'CLOCK_SYNC_NOT_SETTLED'];

  it('[MB-1] 4종 전부가 registry에 있고 3개 상태 필드 + 분류가 코드로 출력된다', () => {
    expect(Object.keys(DETECTOR_COVERAGE_REGISTRY).sort()).toEqual([...REQUIRED].sort());
    for (const key of REQUIRED) {
      const e = DETECTOR_COVERAGE_REGISTRY[key];
      expect(DETECTOR_COVERAGE_CLASSES).toContain(e.classification);
      expect(typeof e.reachableFromSweep).toBe('boolean');
      expect(typeof e.detectorTested).toBe('boolean');
      expect(typeof e.releaseGateEligible).toBe('boolean');
      expect(e.evidence.length).toBeGreaterThan(40); // 근거 문자열이 비어있지 않아야 한다
      expect(e.detectorTests.length).toBeGreaterThan(0);
    }
  });

  it('[MB-2] critic 실측대로 4종 전부 reachableFromSweep=false, 그러나 detectorTested=true다', () => {
    for (const key of REQUIRED) {
      expect(DETECTOR_COVERAGE_REGISTRY[key].reachableFromSweep).toBe(false);
      expect(DETECTOR_COVERAGE_REGISTRY[key].detectorTested).toBe(true);
    }
    // 분류 확정값(보고서 표와 1:1 대응).
    expect(DETECTOR_COVERAGE_REGISTRY.COUNTDOWN_ANCHOR_DIVERGED.classification).toBe('sweep_scenario_addable');
    expect(DETECTOR_COVERAGE_REGISTRY.ROUND_ENDED_WITHOUT_VALID_ANCHOR.classification).toBe('detector_only');
    expect(DETECTOR_COVERAGE_REGISTRY.STALE_ABORT_EXEMPTION_NARROWED.classification).toBe('detector_only');
    expect(DETECTOR_COVERAGE_REGISTRY.CLOCK_SYNC_NOT_SETTLED.classification).toBe('not_in_release_gate');
    // sweep_scenario_addable로 분류한 항목만 구체적 추가 방법을 반드시 갖는다.
    expect(DETECTOR_COVERAGE_REGISTRY.COUNTDOWN_ANCHOR_DIVERGED.sweepScenarioProposal).toContain('combinedSourceOverride');
    for (const key of ['ROUND_ENDED_WITHOUT_VALID_ANCHOR', 'STALE_ABORT_EXEMPTION_NARROWED', 'CLOCK_SYNC_NOT_SETTLED']) {
      expect(DETECTOR_COVERAGE_REGISTRY[key].sweepScenarioProposal).toBe(null);
      expect(DETECTOR_COVERAGE_REGISTRY[key].whyNotSweepAddable.length).toBeGreaterThan(40);
    }
  });

  it('[MB-3] release gate 포함 여부: CLOCK_SYNC_NOT_SETTLED만 비포함(§CRITICAL-1 강등과 일치)', () => {
    expect(DETECTOR_COVERAGE_REGISTRY.CLOCK_SYNC_NOT_SETTLED.releaseGateEligible).toBe(false);
    for (const key of ['COUNTDOWN_ANCHOR_DIVERGED', 'ROUND_ENDED_WITHOUT_VALID_ANCHOR', 'STALE_ABORT_EXEMPTION_NARROWED']) {
      expect(DETECTOR_COVERAGE_REGISTRY[key].releaseGateEligible).toBe(true);
    }
    // 실제 판정 코드와의 일치 검증(선언과 동작이 어긋나면 registry가 거짓말이 된다):
    // NOT_SYNCED만 있는 trial은 correctness PASS여야 한다(=게이트 비포함).
    const notSynced = mkHealthyTrial({});
    notSynced.world.__clockSyncSettled = false;
    expect(computeCeoPassUnits(notSynced).correctnessPass).toBe(true);
  });

  it('[MB-4] 미발화(0건) detector는 "검증된 커버리지"가 아니라 "미도달"로 집계된다', () => {
    const report = computeDetectorCoverageReport({}); // 스윕 실측 전부 0건
    expect(report.verifiedBySweep).toEqual([]);
    expect(report.counts.verifiedBySweep).toBe(0);
    expect(report.sweepUncovered.map((x) => x.detector).sort()).toEqual([...REQUIRED].sort());
    expect(report.contradictions).toEqual([]);
    expect(report.untested).toEqual([]);
    expect(report.notInReleaseGate).toEqual(['CLOCK_SYNC_NOT_SETTLED']);
    expect(report.detectorOnly.sort()).toEqual(['ROUND_ENDED_WITHOUT_VALID_ANCHOR', 'STALE_ABORT_EXEMPTION_NARROWED']);
  });

  it('[MB-5] 실제로 발화하면 그때 비로소 "검증된 커버리지"로 올라간다', () => {
    const report = computeDetectorCoverageReport({ COUNTDOWN_ANCHOR_DIVERGED: 7 });
    expect(report.verifiedBySweep).toEqual([{ detector: 'COUNTDOWN_ANCHOR_DIVERGED', observed: 7 }]);
    // 다만 registry가 unreachable이라고 주장하고 있으므로 모순으로 잡혀 registry 갱신을 강제한다.
    expect(report.contradictions).toEqual([{ detector: 'COUNTDOWN_ANCHOR_DIVERGED', type: 'OBSERVED_BUT_MARKED_UNREACHABLE', observed: 7 }]);
  });

  it('[MB-M1] mutation: reachableFromSweep을 거짓으로 true라고 주장하면 즉시 모순으로 잡힌다(공허 방지)', () => {
    const liar = {
      ...DETECTOR_COVERAGE_REGISTRY,
      CLOCK_SYNC_NOT_SETTLED: { ...DETECTOR_COVERAGE_REGISTRY.CLOCK_SYNC_NOT_SETTLED, reachableFromSweep: true },
    };
    const report = computeDetectorCoverageReport({}, liar);
    expect(report.contradictions).toEqual([{ detector: 'CLOCK_SYNC_NOT_SETTLED', type: 'CLAIMED_REACHABLE_BUT_NEVER_OBSERVED', observed: 0 }]);
    // 그리고 거짓 주장을 해도 미발화 항목이 verifiedBySweep으로 올라가지는 않는다(집계 기준은 실측).
    expect(report.verifiedBySweep).toEqual([]);
  });

  it('[MB-M2] mutation: 분류 라벨을 임의 문자열로 바꾸면 UNKNOWN_CLASSIFICATION으로 잡힌다', () => {
    const bogus = {
      ...DETECTOR_COVERAGE_REGISTRY,
      ROUND_ENDED_WITHOUT_VALID_ANCHOR: { ...DETECTOR_COVERAGE_REGISTRY.ROUND_ENDED_WITHOUT_VALID_ANCHOR, classification: 'covered_lol' },
    };
    const report = computeDetectorCoverageReport({}, bogus);
    expect(report.contradictions.some((c) => c.type === 'UNKNOWN_CLASSIFICATION')).toBe(true);
  });

  it('[MB-6] summarizeCell이 detector 발화 실측을 셀 단위로 남긴다(0을 PASS로 포장하지 않기 위한 원자료)', () => {
    const ok = computeCeoPassUnits(mkHealthyTrial({}));
    const diverged = computeCeoPassUnits(mkTrial({
      devices: [
        mkDevice('p0', [mkClockSyncOk(), mkCountdownStart(1, 1_000_000), mkSyncRender('countdown', 1, 1_000_000), mkSyncRender('result', 1, 1_005_000)]),
        mkDevice('p1', [mkClockSyncOk(), mkCountdownStart(1, 1_003_600), mkSyncRender('countdown', 1, 1_000_100), mkSyncRender('result', 1, 1_005_100)]),
      ],
    }));
    const s = summarizeCell([
      { seed: 1, n: 2, profile: 'Normal', ceoPass: ok.ceoPass, ceo: ok },
      { seed: 2, n: 2, profile: 'Normal', ceoPass: diverged.ceoPass, ceo: diverged },
    ]);
    expect(s.detectorObservations.COUNTDOWN_ANCHOR_DIVERGED).toBe(1);
    expect(s.detectorObservations.ROUND_ENDED_WITHOUT_VALID_ANCHOR).toBe(0);
    expect(s.detectorObservations.CLOCK_SYNC_NOT_SETTLED).toBe(0);
    expect(s.measurementScope).toMatchObject({ singleGameTrials: 2, unsupportedTrials: 0, anchorComparisonTrials: 2 });
  });

  it('[MB-7] STALE_ABORT_EXEMPTION_NARROWED 관측 카운터는 그 규칙이 실제로 결과를 바꾼 건만 센다', () => {
    // [M2-1](a)와 동일 구성: stale-abort가 있는데 진행 실증이 없어 FAIL로 잡히는 유닛.
    const narrowed = computeCeoPassUnits(mkTrial({
      devices: [
        mkDevice('p0', [mkClockSyncOk(), mkCountdownStart(1, 1_000_000), mkSyncRender('countdown', 1, 1_000_000), mkSyncRender('result', 1, 1_005_000)]),
        mkDevice('p1', [
          mkClockSyncOk(), mkInvalidTs(1, 0),
          { kind: 'metric', wrps: 'WRPS-078', eventType: 'COUNTDOWN_STALE_GENERATION_ABORTED', round: 1, checkpoint: 'waitForValidCountdownStart' },
          mkSyncRender('result', 1, 1_005_010),
        ]),
      ],
      finalRound: 1,
      oraclePerRound: [{ round: 1, outcome: 'gameOver', activeIds: ['p0'] }],
    }));
    const s = summarizeCell([{ seed: 1, n: 2, profile: 'Normal', ceoPass: narrowed.ceoPass, ceo: narrowed }]);
    expect(s.detectorObservations.ROUND_ENDED_WITHOUT_VALID_ANCHOR).toBe(1);
    expect(s.detectorObservations.STALE_ABORT_EXEMPTION_NARROWED).toBe(1);
    // 반면 stale-abort 없이 순수 앵커 결손으로 FAIL한 건은 서브룰 카운터를 올리지 않는다.
    const plain = computeCeoPassUnits(mkHealthyTrial({ p1: [mkInvalidTs(1, 0), mkInvalidTs(1, 1)] }));
    const s2 = summarizeCell([{ seed: 2, n: 2, profile: 'Normal', ceoPass: plain.ceoPass, ceo: plain }]);
    expect(s2.detectorObservations.ROUND_ENDED_WITHOUT_VALID_ANCHOR).toBe(1);
    expect(s2.detectorObservations.STALE_ABORT_EXEMPTION_NARROWED).toBe(0);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// §M-A 유닛 테스트: 공식 release-gate 실행 경로 + exit code 근거.
// ════════════════════════════════════════════════════════════════════════════
describe('§M-A(critic): release-gate 실행 경로 설계 + strict exit code', () => {
  const three = [{ profile: 'Normal' }, { profile: 'Degraded' }, { profile: 'Extreme' }];
  const gateOf = (o) => computeReleaseGate([
    { profile: 'Normal', trials: 360, timingPass: 360, correctnessPass: 360, ceoPass: 360, ...(o.Normal || {}) },
    { profile: 'Degraded', trials: 360, timingPass: 41, correctnessPass: 360, ceoPass: 41, ...(o.Degraded || {}) },
    { profile: 'Extreme', trials: 360, timingPass: 8, correctnessPass: 360, ceoPass: 8, ...(o.Extreme || {}) },
  ]);
  const exitCodeFor = ({ headlineStats = three, gate, strict = true }) =>
    computeGateExitCode(evaluateReleaseGateAssertion({ headlineStats, gate, strict }));

  it('[GX-1] exit code는 violations 유무로만 결정된다(0=PASS, 1=차단)', () => {
    expect(computeGateExitCode({ violations: [] })).toBe(0);
    expect(computeGateExitCode({ violations: [{ type: 'RELEASE_GATE_FAILED' }] })).toBe(1);
    expect(computeGateExitCode(null)).toBe(1); // 판정 자체가 없으면 통과시키지 않는다
  });

  it('[GX-2] CEO 요구 1: Normal timing < 95%면 strict에서 non-zero exit', () => {
    // 341/360 = 94.72% (< 95%)
    const belowGate = gateOf({ Normal: { timingPass: 341, ceoPass: 341 } });
    expect(belowGate.gateFailures).toEqual([{ profile: 'Normal', gate: 'timing', rate: 341 / 360, required: 0.95 }]);
    expect(exitCodeFor({ gate: belowGate })).toBe(1);
    // 342/360 = 95.0% → 경계 통과(0)
    const atGate = gateOf({ Normal: { timingPass: 342, ceoPass: 342 } });
    expect(atGate.perProfile[0].timingSuccessRate).toBeGreaterThanOrEqual(CEO_TIMING_GATE_RATE);
    expect(exitCodeFor({ gate: atGate })).toBe(0);
    // 현재 STOP-SHIP 실측(Normal 269/360 = 74.7%)도 당연히 차단된다.
    expect(exitCodeFor({ gate: gateOf({ Normal: { timingPass: 269, ceoPass: 269 } }) })).toBe(1);
  });

  it('[GX-3] CEO 요구 2: 어느 profile이든 correctness < 100%면 strict에서 non-zero exit', () => {
    for (const p of ['Normal', 'Degraded', 'Extreme']) {
      const g = gateOf({ [p]: { correctnessPass: 359 } }); // 359/360
      expect(g.gateFailures.some((f) => f.profile === p && f.gate === 'correctness')).toBe(true);
      expect(exitCodeFor({ gate: g })).toBe(1);
    }
    // 전 profile correctness 100% + Normal timing 100%면 통과.
    expect(exitCodeFor({ gate: gateOf({}) })).toBe(0);
  });

  it('[GX-4] CEO 요구 3: 측정 결손(-t 필터/throw/timeout)도 strict에서 non-zero exit', () => {
    expect(exitCodeFor({ headlineStats: [], gate: null })).toBe(1);
    expect(exitCodeFor({ headlineStats: [{ profile: 'Normal' }], gate: null })).toBe(1);
    expect(exitCodeFor({ headlineStats: three, gate: gateOf({}) })).toBe(0);
  });

  it('[GX-5] 비strict(=npm test)에서는 같은 실패가 exit 0이 된다 — 이것이 "우회" 문제의 실체다', () => {
    const bad = gateOf({ Normal: { timingPass: 269, ceoPass: 269 } });
    expect(bad.overallReleasePass).toBe(false);
    expect(exitCodeFor({ gate: bad, strict: false })).toBe(0); // ← report-only 경로
    expect(exitCodeFor({ gate: bad, strict: true })).toBe(1);  // ← 공식 판정 경로(npm run test:release-gate)
  });

  it('[GX-6] 실행 경로 계약이 코드에 박혀 있다', () => {
    expect(GATE_EXECUTION_PLAN.proposedScripts['gate:release']).toBe('node scripts/run-release-gate.mjs');
    expect(GATE_EXECUTION_PLAN.proposedScripts['gate:release:raw']).toContain('CEO_GATE_STRICT=1');
    expect(GATE_EXECUTION_PLAN.proposedScripts['gate:release:raw']).toContain('tests/ceo-official-measurement.test.mjs');
    expect(GATE_EXECUTION_PLAN.runnerContract.exitCodes[1]).toContain('출시 차단');
    expect(GATE_EXECUTION_PLAN.strictFailConditions.length).toBe(3);
    // §M-A′: 우회 스위치는 계약상 존재하지 않는다.
    expect(GATE_EXECUTION_PLAN.runnerContract.strictIsForced).toBe(true);
    expect(GATE_EXECUTION_PLAN.runnerContract.bypassSwitches).toEqual([]);
  });

  // ⚠️ [GX-7]/[GX-9]/[GX-10]/[GX-11]은 tests/release-gate-wiring.test.mjs로 이동했다.
  //    이유: 그 4건은 저장소 산출물(package.json 게이트 스크립트 / .github/workflows/release-gate.yml /
  //    scripts/run-release-gate.mjs)을 **파일로 읽는다**. 이 파일(측정 베이스라인 커밋)에 두면
  //    배선 커밋보다 앞선 커밋에서 ENOENT/AssertionError로 단독 RED가 되어 `git bisect`와
  //    per-commit CI가 무력화된다(forward reference). 단언은 하나도 약화하지 않고 그대로 옮겼다.
  //    아래 [GX-M1]/[GX-M2]는 파일을 읽지 않는 순수 mutation이므로 여기 남는다.

  it('[GX-M1] mutation: strict를 켜지 않는 게이트 스크립트는 이름 규약 전체에서 위반으로 잡힌다', () => {
    for (const name of ['gate:release', 'test:release-gate']) {
      const fake = analyzeGateWiring({ pkgScripts: { [name]: 'vitest run tests/ceo-official-measurement.test.mjs' } });
      expect(fake.violations).toEqual([{ type: 'GATE_SCRIPT_WITHOUT_STRICT', name, cmd: 'vitest run tests/ceo-official-measurement.test.mjs' }]);
      expect(fake.strictWiredAnywhere).toBe(false);
    }
    // 실제 배선 그대로면 위반 없음 + strict 배선 인식.
    const real = analyzeGateWiring({ pkgScripts: GATE_EXECUTION_PLAN.requiredScripts });
    expect(real.violations).toEqual([]);
    expect(real.strictWiredAnywhere).toBe(true);
    expect(real.gateScripts.sort()).toEqual(['gate:release', 'test:release-gate']);
  });

  it('[GX-M2] mutation: 게이트 스텝을 호출하지 않는 워크플로는 workflowsRunningGateScript에 안 잡힌다', () => {
    const decorative = analyzeGateWiring({
      pkgScripts: GATE_EXECUTION_PLAN.requiredScripts,
      // CEO_GATE_STRICT를 주석으로만 언급하고 실제로는 npm test만 도는 워크플로.
      workflowTexts: { 'fake.yml': '# CEO_GATE_STRICT 어쩌구\nsteps:\n  - run: npm test\n' },
    });
    expect(decorative.workflowsRunningTest).toEqual(['fake.yml']);
    expect(decorative.workflowsSettingStrict).toEqual(['fake.yml']); // 문자열만 있는 가짜 신호
    expect(decorative.workflowsRunningGateScript).toEqual([]);       // ← 실제 호출은 없다
  });

  it('[GX-8] 비strict 실행은 "게이트 미실행"을 명시적으로 출력한다(선택지 (b) 구현분)', () => {
    const banner = formatGateBypassBanner(gateOf({ Normal: { timingPass: 269, ceoPass: 269 } }));
    expect(banner).toContain('GATE-NOT-ENFORCED');
    expect(banner).toContain('overallReleasePass = false');
    expect(banner).toContain('npm run gate:release');
    // 측정이 아예 없을 때도 조용히 넘어가지 않는다.
    expect(formatGateBypassBanner(null)).toContain('측정 집계 없음');
    // 그리고 게이트 본문이 실제로 이 배너를 부른다(장식 방지).
    expect(releaseGateTestBody.toString()).toContain('formatGateBypassBanner');
  });
});

// ════════════════════════════════════════════════════════════════════════════
// §M-A′ CEO 확정 게이트 계약 — 5개 fixture를 하나씩 명시적으로 고정한다.
// (GX-2/GX-3이 이미 유사 범위를 덮지만, CEO가 지정한 정확한 수치로 따로 못박는다.
//  나중에 임계값을 만지면 여기가 가장 먼저 붉어져야 한다.)
// ════════════════════════════════════════════════════════════════════════════
describe('§M-A′: 릴리즈 게이트 계약 fixture (CEO 지정 5건)', () => {
  const three = [{ profile: 'Normal' }, { profile: 'Degraded' }, { profile: 'Extreme' }];
  // trials=1000으로 두면 94.9% / 95.0%를 정수 카운트로 정확히 표현할 수 있다.
  const gateOf = (o) => computeReleaseGate([
    { profile: 'Normal', trials: 1000, timingPass: 1000, correctnessPass: 1000, ceoPass: 1000, ...(o.Normal || {}) },
    { profile: 'Degraded', trials: 1000, timingPass: 1000, correctnessPass: 1000, ceoPass: 1000, ...(o.Degraded || {}) },
    { profile: 'Extreme', trials: 1000, timingPass: 1000, correctnessPass: 1000, ceoPass: 1000, ...(o.Extreme || {}) },
  ]);
  const exitOf = (gate) => computeGateExitCode(evaluateReleaseGateAssertion({ headlineStats: three, gate, strict: true }));

  it('[GC-1] Normal timing 94.9% → exit 1', () => {
    const g = gateOf({ Normal: { timingPass: 949, ceoPass: 949 } });
    expect(g.perProfile[0].timingSuccessRate).toBeCloseTo(0.949, 10);
    expect(g.perProfile[0].timingGatePass).toBe(false);
    expect(g.overallReleasePass).toBe(false);
    expect(g.gateFailures).toEqual([{ profile: 'Normal', gate: 'timing', rate: 0.949, required: 0.95 }]);
    expect(exitOf(g)).toBe(1);
  });

  it('[GC-2] Normal timing 95.0% → timing gate PASS (exit 0)', () => {
    const g = gateOf({ Normal: { timingPass: 950, ceoPass: 950 } });
    expect(g.perProfile[0].timingSuccessRate).toBeCloseTo(0.95, 10);
    expect(g.perProfile[0].timingGatePass).toBe(true);
    expect(g.gateFailures).toEqual([]);
    expect(g.overallReleasePass).toBe(true);
    expect(exitOf(g)).toBe(0);
    // ⚠️ 경계는 >= 0.95다. 이 단언이 완화되면(예: 0.949 통과) 릴리즈 기준이 무너진다.
    expect(CEO_TIMING_GATE_RATE).toBe(0.95);
  });

  it('[GC-3] Degraded timing 10% → overall timing 판정에 영향 없음(수치는 그대로 보고)', () => {
    const g = gateOf({ Degraded: { timingPass: 100, ceoPass: 100 } });
    const deg = g.perProfile.find((r) => r.profile === 'Degraded');
    expect(deg.profileRole).toBe('informational');
    expect(deg.timingSuccessRate).toBeCloseTo(0.10, 10);
    expect(deg.timingGateApplied).toBe(false);   // 게이트 대상 아님
    expect(deg.timingGatePass).toBe(true);       // 따라서 실패로 집계되지 않음
    expect(g.policy.timingGateProfiles).toEqual(['Normal']);
    expect(g.gateFailures).toEqual([]);
    expect(g.overallReleasePass).toBe(true);
    expect(exitOf(g)).toBe(0);
    // 삭제/완화 금지: 수치 자체는 리포트에 그대로 남아 있어야 한다.
    expect(deg.timingPass).toBe(100);
    expect(deg.trials).toBe(1000);
    // Extreme(stress)도 동일하게 timing 게이트 밖이다.
    const g2 = gateOf({ Extreme: { timingPass: 22, ceoPass: 22 } });
    expect(g2.perProfile.find((r) => r.profile === 'Extreme').timingGateApplied).toBe(false);
    expect(exitOf(g2)).toBe(0);
  });

  it('[GC-4] Degraded correctness 실패 → exit 1 (correctness는 3 profile 전부 100% 요구)', () => {
    const g = gateOf({ Degraded: { correctnessPass: 999 } });
    const deg = g.perProfile.find((r) => r.profile === 'Degraded');
    expect(deg.correctnessGateApplied).toBe(true);
    expect(deg.correctnessGatePass).toBe(false);
    expect(g.gateFailures).toEqual([{ profile: 'Degraded', gate: 'correctness', rate: 0.999, required: 1 }]);
    expect(g.overallReleasePass).toBe(false);
    expect(exitOf(g)).toBe(1);
  });

  it('[GC-5] Extreme correctness 실패 → exit 1', () => {
    const g = gateOf({ Extreme: { correctnessPass: 999 } });
    const ext = g.perProfile.find((r) => r.profile === 'Extreme');
    expect(ext.profileRole).toBe('stress');
    expect(ext.correctnessGateApplied).toBe(true);
    expect(ext.correctnessGatePass).toBe(false);
    expect(g.gateFailures).toEqual([{ profile: 'Extreme', gate: 'correctness', rate: 0.999, required: 1 }]);
    expect(exitOf(g)).toBe(1);
  });

  it('[GC-M1] mutation: correctness 게이트를 release_gate profile로만 좁히면 GC-4/GC-5가 통과해버린다', () => {
    // 금지된 완화(ignoreNonReleaseGateCorrectness=true)를 켜면 Degraded/Extreme correctness 실패가
    // 사라진다 — 즉 GC-4/GC-5는 공허하지 않다.
    const mutated = computeReleaseGate([
      { profile: 'Normal', trials: 1000, timingPass: 1000, correctnessPass: 1000, ceoPass: 1000 },
      { profile: 'Degraded', trials: 1000, timingPass: 1000, correctnessPass: 999, ceoPass: 999 },
      { profile: 'Extreme', trials: 1000, timingPass: 1000, correctnessPass: 999, ceoPass: 999 },
    ], { mutations: { ignoreNonReleaseGateCorrectness: true } });
    expect(mutated.gateFailures).toEqual([]);
    expect(mutated.overallReleasePass).toBe(true);
    expect(exitOf(mutated)).toBe(0);
    // 완화 없이는 두 건 모두 잡힌다.
    const honest = gateOf({ Degraded: { correctnessPass: 999 }, Extreme: { correctnessPass: 999 } });
    expect(honest.gateFailures.length).toBe(2);
    expect(exitOf(honest)).toBe(1);
  });

  it('[GC-M2] mutation: timing 게이트를 3 profile 전부에 걸면 GC-3이 뒤집힌다', () => {
    const mutated = computeReleaseGate([
      { profile: 'Normal', trials: 1000, timingPass: 1000, correctnessPass: 1000, ceoPass: 1000 },
      { profile: 'Degraded', trials: 1000, timingPass: 100, correctnessPass: 1000, ceoPass: 100 },
      { profile: 'Extreme', trials: 1000, timingPass: 1000, correctnessPass: 1000, ceoPass: 1000 },
    ], { mutations: { timingGateAllProfiles: true } });
    expect(mutated.gateFailures.map((f) => `${f.profile}:${f.gate}`)).toEqual(['Degraded:timing']);
    expect(exitOf(mutated)).toBe(1);
  });

  it('[GC-6] 현재 실측(Normal 74.72%)은 strict에서 반드시 차단된다', () => {
    // 실측: Normal timing 269/360 = 74.72%, correctness 360/360.
    const g = computeReleaseGate([
      { profile: 'Normal', trials: 360, timingPass: 269, correctnessPass: 360, ceoPass: 269 },
      { profile: 'Degraded', trials: 360, timingPass: 41, correctnessPass: 360, ceoPass: 41 },
      { profile: 'Extreme', trials: 360, timingPass: 8, correctnessPass: 360, ceoPass: 8 },
    ]);
    expect(Number((g.perProfile[0].timingSuccessRate * 100).toFixed(2))).toBe(74.72);
    expect(g.gateFailures.length).toBe(1);
    expect(g.gateFailures[0]).toMatchObject({ profile: 'Normal', gate: 'timing', required: 0.95 });
    expect(exitOf(g)).toBe(1);
  });
});

// profile별 헤드라인 셀의 누적 집계 — 마지막 §C-1 Release Gate 판정 테스트가 이걸 읽는다.
// (profile별 it을 하나로 합치지 않는 이유: 각 it의 beforeEach가 vi.useFakeTimers()를 새로
// 걸어 profile마다 페이크타이머 세션이 분리돼 있고, 그 경계가 바뀌면 측정 수치 자체가
// Before/After 대조에서 설명 불가 drift를 만들 수 있다 — 경계를 그대로 보존한다.)
const HEADLINE_PROFILE_STATS = [];

describe('CEO 공식 측정 §Phase2: N=3..20 × Profile{Normal,Degraded,Extreme} × 20회 베이스라인', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date(1_800_000_000_000)); });
  afterEach(() => { vi.useRealTimers(); });

  for (const profileName of Object.keys(PROFILES)) {
    const profile = PROFILES[profileName];
    // eslint-disable-next-line no-loop-func
    it(`[헤드라인, profile=${profileName}, role=${profile.profileRole}] N=3..20(18개) × ${BASELINE_TRIALS} trial: CEO PASS-unit(clockSync/timing≤250ms/progression/rules/result) 카테고리별 성공률 + 실패 전수`, async () => {
      const summary = [];
      for (const n of NS) {
        // eslint-disable-next-line no-await-in-loop
        const rows = await runCell({ profileName, n, trials: BASELINE_TRIALS });
        summary.push({ n, ...summarizeCell(rows) });
      }
      // eslint-disable-next-line no-console
      console.log(`[CEO-MATRIX][profile=${profileName}][role=${profile.profileRole}][clockCeiling=${profile.clockSpreadCeilingMs}ms] N별 successRate + categoryFailCounts:`, JSON.stringify(
        summary.map((s) => ({
          n: s.n, trials: s.trials, pass: s.pass, fail: s.fail,
          successRate: Number(s.successRate.toFixed(4)), meetsGate95: s.successRate >= CEO_TIMING_GATE_RATE,
          timingSuccessRate: Number(s.timingSuccessRate.toFixed(4)),
          correctnessSuccessRate: Number(s.correctnessSuccessRate.toFixed(4)),
          categoryFailCounts: s.categoryFailCounts,
          timingViolationsByPhase: s.timingViolationsByPhase,
          missingRenderByPhase: s.missingRenderByPhase,
          countdownTransient: s.transient, countdownPermanent: s.permanentCountdownFailures,
          worstGap: s.worstGap, timingPercentiles: s.timingPercentiles,
          // §CRITICAL-1: NOT_SYNCED를 게이트에서 뺀 대신 반드시 남기는 실측치.
          clockSyncSettle: s.clockSyncSettle,
          // §M-1(critic): cross-device anchor divergence 실측 건수(0=이론적 노출 / >0=결함 신호).
          anchorDivergence: s.anchorDivergence.samples.length
            ? s.anchorDivergence
            : { trials: 0, rounds: 0, maxSpreadMs: 0, comparedRoundKeys: s.anchorDivergence.comparedRoundKeys, validAnchors: s.anchorDivergence.validAnchors },
          exceptionTrials: s.exceptionTrials, stallTrials: s.stallTrials,
          // §M-B: detector 발화 실측(0 = 미도달 → coverage PASS로 집계 금지).
          detectorObservations: s.detectorObservations,
          // §M-C: single-game scope 준수 여부(unsupportedTrials>0이면 공식 측정 대상 밖).
          measurementScope: s.measurementScope,
        })), null, 2,
      ));
      // §M-1(critic): divergence가 실제로 관측되면 표본을 그대로 인쇄한다(사후 분류 근거).
      for (const s of summary) {
        if (s.anchorDivergence.trials > 0) {
          // eslint-disable-next-line no-console
          console.log(`[CEO-MATRIX][profile=${profileName}][ANCHOR-DIVERGENCE] N=${s.n} trials=${s.anchorDivergence.trials} rounds=${s.anchorDivergence.rounds}:`, JSON.stringify(s.anchorDivergence.samples, null, 2));
        }
      }
      for (const s of summary) {
        if (s.fail > 0) {
          // eslint-disable-next-line no-console
          console.log(`[CEO-MATRIX][profile=${profileName}] N=${s.n} 실패 전수(${s.fail}/${s.trials}):`, JSON.stringify(s.failures, null, 2));
        }
      }
      const agg = summary.reduce((a, s) => {
        const next = {
          trials: a.trials + s.trials, ceoPass: a.ceoPass + s.pass,
          timingPass: a.timingPass + s.timingPass, correctnessPass: a.correctnessPass + s.correctnessPass,
          detectorObservations: { ...a.detectorObservations },
          unsupportedScopeTrials: a.unsupportedScopeTrials + s.measurementScope.unsupportedTrials,
        };
        for (const [k, v] of Object.entries(s.detectorObservations)) {
          next.detectorObservations[k] = (next.detectorObservations[k] || 0) + v;
        }
        return next;
      }, { trials: 0, ceoPass: 0, timingPass: 0, correctnessPass: 0, detectorObservations: {}, unsupportedScopeTrials: 0 });
      HEADLINE_PROFILE_STATS.push({
        profile: profileName, profileRole: profile.profileRole,
        clockSpreadCeilingMs: profile.clockSpreadCeilingMs, ...agg,
      });
      // §LOW-3(critic): 종전 `expect(progression||0).toBeGreaterThanOrEqual(0)`은 항상 참인 완전
      // 공허 단언이었다 — 삭제하고 실제 불변식으로 교체한다.
      //   (1) 열거 무결성: 실패로 계상된 trial 수와 실제로 인쇄되는 실패 목록 길이가 같아야 한다
      //       (요약기가 실패를 삼키면 "수치는 나쁜데 목록은 비어있는" 은폐가 가능해진다).
      //   (2) 카테고리 실패 수는 trial 수를 넘을 수 없다(중복 계상 방지).
      //   (3) EXCEPTION은 "측정 자체가 무효"라는 뜻이므로 0이어야 한다(하니스/REAL throw 게이트).
      // CEO PASS-unit 성공률 자체는 여전히 하드 assert하지 않는다("결함이면 열거만" 지시 준수).
      for (const s of summary) {
        expect(s.failures.length).toBe(s.fail);
        for (const [, v] of Object.entries(s.categoryFailCounts)) expect(v).toBeLessThanOrEqual(s.trials);
        expect(s.exceptionTrials).toBe(0);
        // §M-C: 공식 측정은 single-game scope 한정이다. 스윕 셀에 multi-game trial이 섞이면
        // 그 셀의 앵커 판정은 정의되지 않으므로(측정 무효) 즉시 드러나야 한다.
        expect(s.measurementScope.unsupportedTrials).toBe(0);
        expect(s.measurementScope.singleGameTrials).toBe(s.trials);
      }
      expect(summary.length).toBe(18);
    }, 600000);
  }

  it('[§C-1 Release Gate] 3 profile 수치 전부 보고 + profileRole 기반 최종 판정(strict 모드에서 CI 강제)', releaseGateTestBody);
});

// §HIGH-1: 게이트 판정 본문을 이름 있는 함수로 분리한다 — [G-M1]이 이 소스를 직접 검사해
// "합성 입력의 overallReleasePass를 단언하는" 가짜 안전 구조가 되살아나지 않았음을 확인한다.
function releaseGateTestBody() {
  {
    // 위 3개 헤드라인 it이 모두 실행된 뒤에만 실측 판정이 가능하다(같은 파일, 선언 순서대로 순차
    // 실행). §HIGH-1: 헤드라인이 빠진 실행에서는 "정책 불변식만" 검증하고(policyInvariantsOnly)
    // 합성 입력의 overallReleasePass는 절대 단언하지 않는다 — 그 PASS는 릴리즈에 대해 아무것도
    // 증명하지 않으며, 종전 구조에서는 헤드라인이 throw할수록 게이트가 확실히 GREEN이 됐다.
    const strict = isGateStrictMode();
    const measured = HEADLINE_PROFILE_STATS.length === 3;
    const gate = measured ? computeReleaseGate(HEADLINE_PROFILE_STATS) : null;
    const verdict = evaluateReleaseGateAssertion({ headlineStats: HEADLINE_PROFILE_STATS, gate, strict });

    if (!measured) {
      // eslint-disable-next-line no-console
      console.log(`[CEO-RELEASE-GATE] 헤드라인 집계 ${HEADLINE_PROFILE_STATS.length}/3 — 실측 게이트 판정 불가(-t 필터 실행 등). mode=${verdict.mode}, 정책 불변식만 검증한다.`);
      // strict 모드라면 여기서 반드시 실패해야 한다(measurement 결손을 통과시키지 않는다).
      expect(verdict.violations).toEqual([]);
      const policyProbe = computeReleaseGate([
        { profile: 'Normal', trials: 1, timingPass: 1, correctnessPass: 1, ceoPass: 1 },
        { profile: 'Degraded', trials: 1, timingPass: 0, correctnessPass: 1, ceoPass: 0 },
        { profile: 'Extreme', trials: 1, timingPass: 0, correctnessPass: 1, ceoPass: 0 },
      ]);
      expect(verdict.policyInvariantsOnly).toBe(true);
      expect(policyProbe.perProfile.map((r) => r.profileRole)).toEqual(['release_gate', 'informational', 'stress']);
      expect(policyProbe.policy.timingGateProfiles).toEqual(['Normal']);
      expect(policyProbe.policy.correctnessGateProfiles).toEqual(['Normal', 'Degraded', 'Extreme']);
      // ⚠️ 여기서 policyProbe.overallReleasePass를 단언하지 않는다(§HIGH-1의 핵심 수정).
      return;
    }
    // eslint-disable-next-line no-console
    console.log('[CEO-RELEASE-GATE]', JSON.stringify({ mode: verdict.mode, ...gate }, null, 2));
    // ── §M-B: detector 커버리지 정직 리포트(검증된 커버리지 vs 미도달을 분리 인쇄) ──────────
    const observed = HEADLINE_PROFILE_STATS.reduce((acc, s) => {
      for (const [k, v] of Object.entries(s.detectorObservations || {})) acc[k] = (acc[k] || 0) + v;
      return acc;
    }, {});
    const coverage = computeDetectorCoverageReport(observed);
    // eslint-disable-next-line no-console
    console.log('[CEO-DETECTOR-COVERAGE]', JSON.stringify({
      observed, ...coverage,
      registry: Object.values(DETECTOR_COVERAGE_REGISTRY).map((e) => ({
        detector: e.detector, classification: e.classification,
        reachableFromSweep: e.reachableFromSweep, detectorTested: e.detectorTested,
        releaseGateEligible: e.releaseGateEligible,
      })),
    }, null, 2));
    // registry가 실측과 어긋나면(발화했는데 unreachable이라고 주장 / reachable이라 주장했는데 0건)
    // 그건 리포트가 거짓말을 하고 있다는 뜻이므로 즉시 RED.
    expect(coverage.contradictions).toEqual([]);
    // 미발화 detector는 절대 "검증된 커버리지"에 들어가면 안 된다(CEO 지시).
    for (const item of coverage.sweepUncovered) expect(observed[item.detector] || 0).toBe(0);
    // ── §M-C: 공식 측정 scope 보고(single-game 한정) ─────────────────────────────
    const unsupportedScopeTotal = HEADLINE_PROFILE_STATS.reduce((a, s) => a + (s.unsupportedScopeTrials || 0), 0);
    // eslint-disable-next-line no-console
    console.log('[CEO-MEASUREMENT-SCOPE]', JSON.stringify({
      ...MEASUREMENT_GAME_SCOPE_POLICY, unsupportedScopeTrials: unsupportedScopeTotal,
    }, null, 2));
    expect(unsupportedScopeTotal).toBe(0);
    // ── §M-A: 비strict 실행에서 "게이트 미실행"을 눈에 띄게 만든다(선택지 (b) 구현분) ─────────
    if (!strict) {
      // eslint-disable-next-line no-console
      console.log(formatGateBypassBanner(gate));
      // eslint-disable-next-line no-console
      console.log('[CEO-RELEASE-GATE][EXEC-PLAN]', JSON.stringify(GATE_EXECUTION_PLAN, null, 2));
    }
    // 기본(비strict): "결함이면 열거만" — overallReleasePass는 하드 assert하지 않는다(측정기가
    // 붉게 죽으면 수치 보고 자체가 끊긴다). 구조 무결성만 단언한다.
    expect(gate.perProfile.length).toBe(3);
    expect(gate.perProfile.map((r) => r.profile)).toEqual(['Normal', 'Degraded', 'Extreme']);
    expect(gate.perProfile.map((r) => r.profileRole)).toEqual(['release_gate', 'informational', 'stress']);
    expect(gate.policy.timingGateProfiles).toEqual(['Normal']);
    expect(gate.policy.correctnessGateProfiles).toEqual(['Normal', 'Degraded', 'Extreme']);
    expect(typeof gate.overallReleasePass).toBe('boolean');
    // Degraded/Extreme 수치가 리포트에서 사라지지 않았는지 구조적으로 확인(삭제 금지 정책).
    for (const name of ['Degraded', 'Extreme']) {
      const row = gate.perProfile.find((r) => r.profile === name);
      expect(row.trials).toBeGreaterThan(0);
      expect(row.timingSuccessRate).not.toBeNull();
      expect(row.correctnessSuccessRate).not.toBeNull();
    }
    // strict 모드(CEO_GATE_STRICT=1 = 실제 릴리즈 판정 실행)에서는 실측 게이트가 CI를 막는다.
    if (strict) {
      // eslint-disable-next-line no-console
      console.log(`[CEO-RELEASE-GATE][STRICT] exitCode(예정)=${computeGateExitCode(verdict)} violations=${verdict.violations.length}`);
      if (verdict.violations.length) {
        // eslint-disable-next-line no-console
        console.log('[CEO-RELEASE-GATE][STRICT] 위반:', JSON.stringify(verdict.violations, null, 2));
      }
    }
    expect(verdict.violations).toEqual([]);
  }
}

// ── §Phase2 escalation: 베이스라인(20회)에서 95% 게이트 경계(17~19/20, 즉 85~95%) 위에 걸린
// 셀만 표적 확대(20→100, 기존 20회 seed는 그대로 보존하고 seed 80개를 추가해 누적 100). 이미
// 명백히 게이트를 크게 벗어난 셀(예: Degraded/Extreme 대부분 — 0~50%)은 표본을 늘려도 결론이
// 바뀌지 않으므로 확대하지 않는다(§CEO 지시 "결함이면 열거만" — 명백한 실패를 굳이 200회까지
// 다시 확인하는 것은 근거 낭비). Normal profile N=4(90%,18/20)/N=5(95%,19/20 — 게이트 바로 위
// 경계)/N=9(90%,18/20)만 해당.
describe('CEO 공식 측정 §Phase2 escalation: profile=Normal 경계 N=4,5,9 → 100회로 확대', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date(1_800_000_000_000)); });
  afterEach(() => { vi.useRealTimers(); });

  it('[경계 확대] N=4,5,9(profile=Normal): 베이스라인 20회 + 추가 80회 = 100회 누적 successRate', async () => {
    const targets = [4, 5, 9];
    const summary = [];
    for (const n of targets) {
      // eslint-disable-next-line no-await-in-loop
      const baseline = await runCell({ profileName: 'Normal', n, trials: BASELINE_TRIALS, seedStart: 0 });
      // eslint-disable-next-line no-await-in-loop
      const extra = await runCell({ profileName: 'Normal', n, trials: 80, seedStart: BASELINE_TRIALS });
      const rows = [...baseline, ...extra];
      summary.push({ n, ...summarizeCell(rows) });
    }
    // eslint-disable-next-line no-console
    console.log('[CEO-MATRIX][escalation, profile=Normal, 100회] N별 successRate:', JSON.stringify(
      summary.map((s) => ({
        n: s.n, trials: s.trials, pass: s.pass, fail: s.fail,
        successRate: Number(s.successRate.toFixed(4)), meetsGate95: s.successRate >= CEO_TIMING_GATE_RATE,
        timingSuccessRate: Number(s.timingSuccessRate.toFixed(4)),
        correctnessSuccessRate: Number(s.correctnessSuccessRate.toFixed(4)),
        categoryFailCounts: s.categoryFailCounts, timingViolationsByPhase: s.timingViolationsByPhase,
        countdownTransient: s.transient, countdownPermanent: s.permanentCountdownFailures,
        timingPercentiles: s.timingPercentiles,
        clockSyncSettle: s.clockSyncSettle,
        anchorDivergence: { trials: s.anchorDivergence.trials, rounds: s.anchorDivergence.rounds, maxSpreadMs: s.anchorDivergence.maxSpreadMs, comparedRoundKeys: s.anchorDivergence.comparedRoundKeys, validAnchors: s.anchorDivergence.validAnchors },
        exceptionTrials: s.exceptionTrials, stallTrials: s.stallTrials,
      })), null, 2,
    ));
    expect(summary.length).toBe(3);
  }, 600000);
});
