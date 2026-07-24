import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';

// Build30-R2 Phase A(WRPS-078, CRITICAL) — choice window(선택 시간) 앵커 수정.
//
// Round1 결함(codex-critic CRITICAL): choiceEndAt = countdownStartAt(카운트다운 "애니메이션 시작"
// 시각) + 5000으로 파생했다. 실제 선택화면(screenGame)은 그 애니메이션(준비+"가위바위보" 음성,
// ko 4050ms/ja 3400ms/en 2850ms)이 끝난 뒤에야 beginRoundTimer()에서 뜬다. 그래서 실제 선택
// 시간이 ko 950ms/ja 1600ms/en 2150ms로 파괴됐다 — 로케일별로 다르고 5초가 전혀 아니었다.
// Round1의 이 테스트 파일 자체도 "countdownStartAt과 동일 시각에 beginRoundTimer가 호출된다"는
// 비현실적 전제로 작성되어 이 결함을 잡지 못했다(CEO 지적).
//
// 수정: 앵커를 "카운트다운 시작"이 아니라 "host의 실제 선택화면 시작"(애니메이션 종료 직후,
// runCountdownThenShowGame이 beginRoundTimer를 부르는 바로 그 시점)으로 바꾼다. host가 그 순간
// serverNow()를 캡처해 choiceEndAt = 그 시각 + 5000을 room.penalty에 새 필드로 발행한다.
// participant는 이 절대 종료시각을 그대로 받아 remaining = ceil((choiceEndAt - serverNow())/1000)을
// 계산한다 — 자기 애니메이션이 언제 끝났는지와 무관하게 host가 정한 절대 시각 기준이므로, 애니메이션
// 늦은 기기는 선택시간이 짧아지지만 3대 종료시각은 항상 동일하다(CEO 요구).
//
// 이 테스트는 실제 호출 경로(runCountdownThenShowGame → captureAndPublishChoiceWindowNow →
// beginRoundTimer)를 host/ja참가자/en참가자 3개 "기기"로 재현해, 로케일별 애니메이션 길이가 달라도
// (a) 선택화면이 뜨는 순간 remaining이 5에 가깝고 (b) 3대 종료시각이 결국 동일함을 검증한다.

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

function extractBlock(startMarker, endMarker) {
  const start = html.indexOf(startMarker);
  if (start < 0) throw new Error(`start marker not found: ${startMarker}`);
  const end = html.indexOf(endMarker, start);
  if (end < 0) throw new Error(`end marker not found: ${endMarker}`);
  return html.slice(start, end);
}

// parsePenalty ~ getCountdownStartAt(getPenaltyText/getTargetLoserCount/getPenaltyGameRound/getGameRound 포함).
// ⚠️ 실제 serverNow()/syncServerClock() 정의(바로 다음 "서버 시각 동기화" 구간)는 의도적으로
// 제외한다 — 포함하면 함수 선언 호이스팅이 우리가 new Function에 주입하는 serverNow 파라미터를
// 덮어써(같은 스코프의 function serverNow(){} 선언이 파라미터 바인딩보다 우선), 테스트가 제어하는
// 가짜 시각이 아니라 실제 Date.now()를 쓰게 되는 버그가 실제로 재현됐다(최초 작성 시 발견).
const PENALTY_BLOCK_SRC = extractBlock(
  'function parsePenalty(raw) {',
  '// ── 서버 시각 동기화'
);
// buildPenaltyValue ~ getChoiceEndAt — 실제 소스(PHASE_RENDER_BUFFER_MS/getNextPhaseScheduledAt 포함,
// getNextCountdownStartAt은 여기서 안 쓰이므로 제외해 serverNow 재정의 위험을 없앤다).
const CHOICE_END_AT_BLOCK_SRC = extractBlock(
  'function buildPenaltyValue({',
  'function getVisiblePenaltyText() {'
);
// startHostJudgeBackstop ~ runCountdownThenShowGame(publishChoiceWindowEnd/captureAndPublishChoiceWindowNow/
// publishChoiceWindowEstimateIfHost 포함) — 실제 소스.
const RUNCOUNTDOWN_BLOCK_SRC = extractBlock(
  'function startHostJudgeBackstop() {',
  '// Phase 1: 호스트용 playing 화면 렌더'
);
// setRoundTimerText ~ resyncChoiceTimerOnResume(computeChoiceRemainingSeconds/beginRoundTimer 포함) — 실제 소스.
const TIMER_BLOCK_SRC = extractBlock(
  'function setRoundTimerText(v) {',
  'function stopRoundTimers() {'
);

function toPositiveInt(value, fallback = 0) {
  const n = parseInt(value, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function makeDom() {
  const els = {};
  const $ = (id) => {
    if (!els[id]) els[id] = { textContent: '', className: '', style: {} };
    return els[id];
  };
  return { els, $ };
}

// 실제 소스를 new Function으로 실행 — hand-copy 로직 검증 금지.
function buildEnv({
  state,
  serverNowFn,
  getOnlineModeFn = () => true,
  dbUpdateImpl = () => ({ error: null }),
  isCurrentRoundParticipantFn = () => true,
  isSafeParticipantFn = () => false,
  isConfirmedLoserFn = () => false,
  screenActive = { screenGame: true },
} = {}) {
  const { els, $ } = makeDom();
  const calls = {
    showScreen: [], showLoserWaitScreen: 0, startHostJudgeBackstop: 0,
    stopRoundTimers: 0, autoFillChoices: 0, updateSelectedCount: 0, updateHostSelectedCount: 0,
    dbUpdate: [], qaMetrics: [],
  };
  const db = {
    from(table) {
      return {
        update(payload) {
          return {
            eq(col, val) {
              calls.dbUpdate.push({ table, payload, col, val });
              return Promise.resolve(dbUpdateImpl(payload));
            }
          };
        }
      };
    }
  };
  const QA = { emit: (kind, payload) => { calls.qaMetrics.push({ kind, payload }); } };
  const factory = new Function(
    'state', '$', 'serverNow', 'toPositiveInt', 'clampLoserCount', 't', 'db', 'QA',
    'getOnlineMode', 'isCurrentRoundParticipant', 'isSafeParticipant', 'isConfirmedLoser',
    'showScreen', 'showLoserWaitScreen', 'runCountdown', 'stopRoundTimers', 'autoFillChoices',
    'updateSelectedCount', 'updateHostSelectedCount', 'isScreenActive',
    PENALTY_BLOCK_SRC + '\n' + CHOICE_END_AT_BLOCK_SRC + '\n' + RUNCOUNTDOWN_BLOCK_SRC + '\n' + TIMER_BLOCK_SRC +
    '\nreturn { getChoiceEndAt, buildPenaltyValue, getGameRound, getCountdownStartAt, ' +
    'runCountdownThenShowGame, beginRoundTimer, resyncChoiceTimerOnResume, ' +
    'computeChoiceRemainingSeconds, captureAndPublishChoiceWindowNow, ' +
    'publishChoiceWindowEstimateIfHost, publishChoiceWindowEnd };'
  );
  const mod = factory(
    state, $, serverNowFn,
    toPositiveInt,
    (v) => Math.max(1, parseInt(v, 10) || 1),
    (key) => key,
    db, QA,
    getOnlineModeFn,
    isCurrentRoundParticipantFn, isSafeParticipantFn, isConfirmedLoserFn,
    (id) => { calls.showScreen.push(id); },
    () => { calls.showLoserWaitScreen++; },
    state.__runCountdown || (async () => true),
    () => { calls.stopRoundTimers++; state.timer = null; },
    () => { calls.autoFillChoices++; },
    () => { calls.updateSelectedCount++; },
    () => { calls.updateHostSelectedCount++; },
    (id) => Boolean(screenActive[id])
  );
  return { mod, els, calls, $, state };
}

describe('Build30-R2 Phase A(WRPS-078) parsePenalty/buildPenaltyValue — choiceEndAt round-trip', () => {
  it('choiceEndAt > 0이면 JSON에 실려 다시 파싱된다', () => {
    const state = { penalty: '', targetLoserCount: 1, gameRound: 1 };
    const { mod } = buildEnv({ state, serverNowFn: () => 0 });
    const penalty = mod.buildPenaltyValue({ gameRound: 2, choiceEndAt: 123456 });
    expect(mod.getChoiceEndAt(penalty)).toBe(123456);
    expect(JSON.parse(penalty).choiceEndAt).toBe(123456);
  });

  it('choiceEndAt이 0/미지정이면 필드 자체가 생략된다(countdownStartAt과 동일한 인코딩 규칙)', () => {
    const state = { penalty: '', targetLoserCount: 1, gameRound: 1 };
    const { mod } = buildEnv({ state, serverNowFn: () => 0 });
    const penalty = mod.buildPenaltyValue({ gameRound: 1 });
    expect(JSON.parse(penalty).choiceEndAt).toBeUndefined();
    expect(mod.getChoiceEndAt(penalty)).toBe(0);
  });

  it('getChoiceEndAt(raw undefined)은 state.penalty에 인코딩된 값과 로컬 state.choiceEndAt 중 더 큰 값을 쓴다(host 낙관적 로컬값이 echo 전에도 유효)', () => {
    const state = { penalty: '{"text":"","loserCount":1,"gameRound":1}', choiceEndAt: 999000 };
    const { mod } = buildEnv({ state, serverNowFn: () => 0 });
    expect(mod.getChoiceEndAt()).toBe(999000); // room.penalty엔 아직 없지만 로컬 낙관값 사용
  });
});

describe('Build30-R2 Phase A(WRPS-078) — 실제 호출 경로 재현: runCountdownThenShowGame → captureAndPublishChoiceWindowNow → beginRoundTimer', () => {
  // 로케일별 실제 애니메이션 소요(runCountdown()의 COUNTDOWN_TIMING과 동일한 값 — 아래 계약 테스트로 드리프트 방지)
  const ANIM_MS = { en: 2850, ja: 3400, ko: 4050 };

  it('CRITICAL 회귀 검증: 로케일이 서로 달라 애니메이션 종료 시각이 제각각이어도(en 먼저, ja, host/ko 마지막), 각 기기가 자기 선택화면을 띄우는 "바로 그 순간" remaining은 5초에 가깝다(1~3초로 줄어들지 않는다) — Round1 결함(countdownStartAt 앵커)의 정확한 재현', async () => {
    const T0 = 1_000_000;
    let currentNow = T0;
    const serverNowFn = () => currentNow;

    // en/ja 참가자는 각자 로케일 애니메이션이 끝나는 시점에 자기 beginRoundTimer를 부른다.
    // host(ko)가 가장 늦게(4050ms) 끝난다 — 실기기에서 실제로 벌어지는 순서.
    const makeParticipant = (localeMs, role) => {
      const state = {
        role, roomCode: 'ROOM1', gameRound: 1, round: 1, penalty: '',
        participants: [], confirmedSafeIds: [], confirmedLoserIds: [],
        __runCountdown: async () => { currentNow = T0 + localeMs; return true; },
      };
      return buildEnv({ state, serverNowFn });
    };

    const en = makeParticipant(ANIM_MS.en, 'participant');
    const ja = makeParticipant(ANIM_MS.ja, 'participant');
    const host = makeParticipant(ANIM_MS.ko, 'host');

    // 실제 시간 흐름 순서대로: en이 가장 먼저 자기 화면을 띄운다(아직 host가 choiceEndAt을 발행 못함).
    await en.mod.runCountdownThenShowGame();
    expect(en.calls.showScreen).toContain('screenGame');
    // host가 아직 발행 전이므로 로컬 5초 폴백 — 이 폴백 자체가 회귀는 아니다(실 propagation 지연은
    // 물리적으로 피할 수 없음). 핵심 회귀 방지 포인트는 아래 host(ko) 검증이다.
    expect(en.mod.getChoiceEndAt()).toBe(0);
    expect(en.calls.dbUpdate.length).toBe(0); // participant는 절대 발행하지 않는다

    await ja.mod.runCountdownThenShowGame();
    expect(ja.calls.dbUpdate.length).toBe(0);

    // host(ko)가 마지막으로 자기 애니메이션을 마치고 실제로 선택화면을 띄운다 — 바로 이 순간이
    // Round1 결함의 핵심 검증 지점이다.
    await host.mod.runCountdownThenShowGame();
    expect(host.calls.showScreen).toContain('screenGame');
    expect(host.calls.dbUpdate.length).toBe(1); // host만 choiceEndAt을 발행한다
    const publishedPenalty = host.calls.dbUpdate[0].payload.penalty;
    const publishedChoiceEndAt = JSON.parse(publishedPenalty).choiceEndAt;
    expect(publishedChoiceEndAt).toBe(T0 + ANIM_MS.ko + 5000); // 실제 화면 전환 시각 + 5000

    // Round1 결함 재현 대조: 만약 옛 파생식(countdownStartAt + 5000)이었다면 여기서
    // choiceEndAt = T0 + 5000 이었을 것이고, host의 실제 화면 전환 시각(T0+4050) 기준 remaining은
    // ceil((T0+5000 - (T0+4050))/1000) = 1초였다(정확히 보고된 "ko 1초" 결함과 일치).
    const legacyBrokenChoiceEndAt = T0 + 5000;
    const legacyBrokenRemaining = Math.max(0, Math.ceil((legacyBrokenChoiceEndAt - (T0 + ANIM_MS.ko)) / 1000));
    expect(legacyBrokenRemaining).toBe(1); // 옛 결함 재현(대조군) — 수정 후에는 아래 값과 달라야 함

    // 실제(수정 후) host의 화면 전환 순간 remaining — 이 값이 5여야 CRITICAL 결함이 해소된 것이다.
    // (buildEnv는 매 runCountdownThenShowGame 호출마다 새 mod를 만들므로, host의 상태를 다시 조회한다)
    // beginRoundTimer가 이미 이 시점 state.remainingSeconds를 세팅했다 — 이를 별도로 노출하기 위해
    // host 쪽 state 객체를 직접 참조한다.
    expect(host.state.remainingSeconds).toBe(5);
    expect(host.state.remainingSeconds).not.toBe(legacyBrokenRemaining);

    // en/ja가 host의 발행 결과를 realtime으로 수신했다고 시뮬레이션(handleRoomUpdate가 하는
    // state.penalty = room.penalty 대입과 동일) — 그 다음 tick(재계산)부터 정확한 절대 종료시각을
    // 반영해야 한다(closure에 캡처된 옛 값이 아니라 매번 getChoiceEndAt()을 새로 읽는 설계 검증).
    en.state.penalty = publishedPenalty;
    ja.state.penalty = publishedPenalty;
    expect(en.mod.computeChoiceRemainingSeconds()).toBe(
      Math.max(0, Math.ceil((publishedChoiceEndAt - currentNow) / 1000))
    );
    expect(ja.mod.computeChoiceRemainingSeconds()).toBe(
      Math.max(0, Math.ceil((publishedChoiceEndAt - currentNow) / 1000))
    );

    // 3대 종료시각 동일 검증: choiceEndAt(절대시각) 그 순간에 세 기기 모두 remaining<=0이 된다.
    currentNow = publishedChoiceEndAt;
    expect(host.mod.computeChoiceRemainingSeconds()).toBeLessThanOrEqual(0);
    expect(en.mod.computeChoiceRemainingSeconds()).toBeLessThanOrEqual(0);
    expect(ja.mod.computeChoiceRemainingSeconds()).toBeLessThanOrEqual(0);
  });

  it('host가 자기 선택화면을 실제로 띄우는 순간(caputre 시점) 발행하는 choiceEndAt은 정확히 그 순간 + 5000이다(단일 기기, 회귀 방지 단위 테스트)', async () => {
    const T0 = 5_000_000;
    let currentNow = T0;
    const serverNowFn = () => currentNow;
    const state = {
      role: 'host', roomCode: 'R2', gameRound: 1, round: 1, penalty: '',
      participants: [], confirmedSafeIds: [], confirmedLoserIds: [],
      __runCountdown: async () => { currentNow = T0 + 2137; return true; }, // 임의의 실측 지연
    };
    const { mod, calls } = buildEnv({ state, serverNowFn });
    await mod.runCountdownThenShowGame();
    expect(calls.dbUpdate[0].payload.penalty).toBeDefined();
    const parsed = JSON.parse(calls.dbUpdate[0].payload.penalty);
    expect(parsed.choiceEndAt).toBe(T0 + 2137 + 5000);
    expect(state.remainingSeconds).toBe(5);
  });

  it('participant는 절대 room.penalty를 쓰지 않는다(captureAndPublishChoiceWindowNow가 host 전용임을 실제 호출로 검증)', async () => {
    const state = {
      role: 'participant', roomCode: 'R3', gameRound: 1, round: 1, penalty: '',
      participants: [], confirmedSafeIds: [], confirmedLoserIds: [],
      __runCountdown: async () => true,
    };
    const { mod, calls } = buildEnv({ state, serverNowFn: () => 1000 });
    await mod.runCountdownThenShowGame();
    expect(calls.dbUpdate.length).toBe(0);
  });

  it('host가 이번 라운드 비참가자(이미 safe/loser 확정)라 자기 애니메이션을 실행하지 않는 경우에도, 아직 플레이 중인 다른 참가자를 위해 choiceEndAt을 안전 추정치(countdownStartAt + 최대 애니메이션 + 5000)로 발행한다', async () => {
    const T0 = 8_000_000;
    const state = {
      role: 'host', roomCode: 'R4', gameRound: 1, round: 1, penalty: '',
      countdownStartAt: T0,
      participants: [], confirmedSafeIds: ['host-1'], confirmedLoserIds: [],
      __runCountdown: async () => true,
    };
    const { mod, calls } = buildEnv({
      state, serverNowFn: () => T0 + 100,
      isCurrentRoundParticipantFn: () => false,
      isSafeParticipantFn: () => true,
    });
    await mod.runCountdownThenShowGame();
    expect(calls.showScreen).toContain('screenWinnerWait');
    expect(calls.dbUpdate.length).toBe(1);
    const parsed = JSON.parse(calls.dbUpdate[0].payload.penalty);
    expect(parsed.choiceEndAt).toBe(T0 + 4050 + 5000); // COUNTDOWN_ANIM_MAX_MS(4050, ko 기준) + CHOICE_WINDOW_MS
  });

  it('host가 비참가자이고 countdownStartAt조차 없으면(오프라인/미시작) 추정 발행도 하지 않는다', async () => {
    const state = {
      role: 'host', roomCode: 'R5', gameRound: 1, round: 1, penalty: '',
      countdownStartAt: 0,
      participants: [], confirmedSafeIds: [], confirmedLoserIds: ['host-1'],
      __runCountdown: async () => true,
    };
    const { mod, calls } = buildEnv({
      state, serverNowFn: () => 1000,
      isCurrentRoundParticipantFn: () => false,
      isConfirmedLoserFn: () => true,
    });
    await mod.runCountdownThenShowGame();
    expect(calls.showLoserWaitScreen).toBe(1);
    expect(calls.dbUpdate.length).toBe(0);
  });

  it('countdownOk===false(하드블록)면 choiceEndAt을 전혀 캡처/발행하지 않는다(기존 하드블록 동작 무회귀)', async () => {
    const state = {
      role: 'host', roomCode: 'R6', gameRound: 1, round: 1, penalty: '',
      participants: [], confirmedSafeIds: [], confirmedLoserIds: [],
      __runCountdown: async () => false,
    };
    const { mod, calls } = buildEnv({ state, serverNowFn: () => 1000 });
    await mod.runCountdownThenShowGame();
    expect(calls.showScreen.length).toBe(0);
    expect(calls.dbUpdate.length).toBe(0);
    expect(state.gameStarting).toBe(false);
  });

  it('DB 발행이 에러를 반환하면(vendored supabase는 reject하지 않음) throw로 승격해 QA metric을 남기고, 이 기기 자신의 진행은 막지 않는다', async () => {
    const T0 = 3_000_000;
    let currentNow = T0;
    const state = {
      role: 'host', roomCode: 'R7', gameRound: 1, round: 1, penalty: '',
      participants: [], confirmedSafeIds: [], confirmedLoserIds: [],
      __runCountdown: async () => { currentNow = T0 + 500; return true; },
    };
    const { mod, calls } = buildEnv({
      state, serverNowFn: () => currentNow,
      dbUpdateImpl: () => ({ error: { message: 'network down' } }),
    });
    await mod.runCountdownThenShowGame();
    // 마이크로태스크 큐를 비워 fire-and-forget publish의 catch 블록이 실행되게 한다.
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    expect(state.remainingSeconds).toBe(5); // 로컬 진행은 막히지 않음
    expect(calls.qaMetrics.some(m => m.payload?.eventType === 'CHOICE_END_PUBLISH_FAILED')).toBe(true);
  });
});

// Build30 Phase2(검증 MEDIUM A-2) — cross-locale 선택시간 단축 수정.
//
// 결함: captureAndPublishChoiceWindowNow()는 host의 serverNow()를 그대로 choiceEndAt 앵커로
// 썼다 — host가 빠른 로케일(en 2850ms)이고 participant가 느린 로케일(ko 4050ms)이면, host가
// 자기 애니메이션을 마치고 캡처하는 시각 자체가 ko participant의 실제 화면 전환 시각보다 이르다.
// 그 결과 ko participant가 실제로 선택화면을 보는 순간 남은 시간이 5초 미만(최악 ~3.8초)이 된다
// (Round2 테스트가 host=ko만 커버해 이 케이스를 못 잡았다 — 이번에 host=en(빠른 로케일) 케이스 추가).
//
// 수정: choiceEndAt = Math.max(serverNow(), countdownStartAt + COUNTDOWN_ANIM_MAX_MS) + CHOICE_WINDOW_MS
// — 모든 로케일 중 가장 느린 애니메이션 소요를 하한으로 둬 로케일 무관 모든 참가자에게 최소 5초를
// 보장한다. host가 이미 가장 느린 로케일이면 serverNow()가 하한 이상이라 무영향(기존과 동일).
describe('Build30 Phase2(WRPS-078 A-2) captureAndPublishChoiceWindowNow — cross-locale 하한 보장', () => {
  const ANIM_MS = { en: 2850, ja: 3400, ko: 4050 };

  it('host=en(빠른 로케일) + participant=ko(느린 로케일): ko participant가 실제로 자기 선택화면을 보는 순간 remaining이 5초 보장된다(수정 전 최악 ~3.8초→ceil 4초였던 결함 재현 및 해소 확인)', async () => {
    const T0 = 2_000_000;
    let currentNow = T0;
    const serverNowFn = () => currentNow;

    // 카운트다운은 모든 기기가 같은 절대 시각(T0)에 시작한다(공유 countdownStartAt) — 실제 앱과 동일.
    const host = (() => {
      const state = {
        role: 'host', roomCode: 'ROOMX', gameRound: 1, round: 1, penalty: '',
        countdownStartAt: T0,
        participants: [], confirmedSafeIds: [], confirmedLoserIds: [],
        __runCountdown: async () => { currentNow = T0 + ANIM_MS.en; return true; }, // host는 en(가장 빠름)
      };
      return buildEnv({ state, serverNowFn });
    })();
    const participantKo = (() => {
      const state = {
        role: 'participant', roomCode: 'ROOMX', gameRound: 1, round: 1, penalty: '',
        countdownStartAt: T0,
        participants: [], confirmedSafeIds: [], confirmedLoserIds: [],
      };
      return buildEnv({ state, serverNowFn });
    })();

    // host(en)가 가장 먼저 자기 애니메이션을 마치고 선택화면을 띄우며 choiceEndAt을 캡처/발행한다.
    await host.mod.runCountdownThenShowGame();
    expect(host.calls.dbUpdate.length).toBe(1);
    const publishedPenalty = host.calls.dbUpdate[0].payload.penalty;
    const publishedChoiceEndAt = JSON.parse(publishedPenalty).choiceEndAt;
    // 하한 적용 확인: countdownStartAt(T0) + COUNTDOWN_ANIM_MAX_MS(4050, ko 기준) + 5000.
    // host의 실제 serverNow()(T0+2850)보다 이 하한이 더 크므로 하한이 채택되어야 한다.
    expect(publishedChoiceEndAt).toBe(T0 + 4050 + 5000);
    expect(publishedChoiceEndAt).not.toBe(T0 + ANIM_MS.en + 5000); // 수정 전(버그) 값이 아님을 명시적으로 확인

    // host의 발행 결과가 realtime으로 ko participant에 전파됐다고 시뮬레이션.
    participantKo.state.penalty = publishedPenalty;

    // ko participant는 자기 로케일 애니메이션(4050ms)을 마친 뒤에야 실제로 선택화면을 본다.
    currentNow = T0 + ANIM_MS.ko;
    const remainingAtScreenShow = participantKo.mod.computeChoiceRemainingSeconds();
    expect(remainingAtScreenShow).toBe(5); // CEO 요구: 로케일 무관 최소 5초 보장
    expect(remainingAtScreenShow).toBeGreaterThanOrEqual(5);

    // 대조군: 수정 전 옛 파생식(host serverNow() 그대로, 하한 없음)이었다면 어떤 값이었을지 확인 —
    // 실측 보고("최악 ~3.8초→ceil 4초")와 일치해야 회귀 재현이 정확함을 보증한다.
    const legacyBrokenChoiceEndAt = T0 + ANIM_MS.en + 5000;
    const legacyBrokenRemaining = Math.max(0, Math.ceil((legacyBrokenChoiceEndAt - (T0 + ANIM_MS.ko)) / 1000));
    expect(legacyBrokenRemaining).toBe(4); // 수정 전 결함 재현(대조군)
    expect(remainingAtScreenShow).not.toBe(legacyBrokenRemaining);
  });

  it('host=ko(가장 느린 로케일)이면 serverNow()가 이미 하한 이상이라 하한이 발동하지 않는다(무영향, 기존과 동일한 캡처 값)', async () => {
    const T0 = 4_000_000;
    let currentNow = T0;
    const serverNowFn = () => currentNow;
    const state = {
      role: 'host', roomCode: 'ROOMY', gameRound: 1, round: 1, penalty: '',
      countdownStartAt: T0,
      participants: [], confirmedSafeIds: [], confirmedLoserIds: [],
      __runCountdown: async () => { currentNow = T0 + ANIM_MS.ko; return true; }, // host 자신이 ko(가장 느림)
    };
    const { mod, calls } = buildEnv({ state, serverNowFn });
    await mod.runCountdownThenShowGame();
    const parsed = JSON.parse(calls.dbUpdate[0].payload.penalty);
    // Math.max(serverNow()=T0+4050, countdownStartAt+4050=T0+4050) === T0+4050 — 하한과 동일하므로
    // serverNow() 그대로 쓴 것과 결과가 같다(무영향 확인).
    expect(parsed.choiceEndAt).toBe(T0 + ANIM_MS.ko + 5000);
  });

  it('countdownStartAt이 없으면(오프라인/미동기화) 하한 계산을 생략하고 기존과 동일하게 serverNow()만 앵커로 쓴다(회귀 없음)', async () => {
    const T0 = 6_000_000;
    let currentNow = T0;
    const state = {
      role: 'host', roomCode: 'ROOMZ', gameRound: 1, round: 1, penalty: '',
      // countdownStartAt 의도적으로 미설정(0) — 기존(Round1/Round2) 테스트들과 동일 전제.
      participants: [], confirmedSafeIds: [], confirmedLoserIds: [],
      __runCountdown: async () => { currentNow = T0 + 777; return true; },
    };
    const { mod, calls } = buildEnv({ state, serverNowFn: () => currentNow });
    await mod.runCountdownThenShowGame();
    const parsed = JSON.parse(calls.dbUpdate[0].payload.penalty);
    expect(parsed.choiceEndAt).toBe(T0 + 777 + 5000); // 하한 없이 기존 동작 그대로
  });
});

describe('Build30-R2 Phase A(WRPS-078) beginRoundTimer/resyncChoiceTimerOnResume — 매 tick 살아있는 재조회(closure 고정 금지)', () => {
  it('(a) 매 tick이 getChoiceEndAt()을 새로 호출한다 — 로컬 감산 누적이 아니라 매번 다시 계산되므로 serverNow가 크게 점프해도(백그라운드 흉내) 정확한 남은 시간을 반영한다', async () => {
    vi.useFakeTimers();
    try {
      const now0 = 1_000_000;
      let currentNow = now0;
      const serverNowFn = () => currentNow;
      const state = {
        role: 'host', gameRound: 1, round: 1, participants: [], confirmedSafeIds: [], confirmedLoserIds: [],
        penalty: '', choiceEndAt: now0 + 5000,
      };
      const { mod, calls } = buildEnv({ state, serverNowFn });
      mod.beginRoundTimer();
      expect(state.remainingSeconds).toBe(5);

      currentNow = now0 + 4200;
      await vi.advanceTimersByTimeAsync(1000);
      expect(state.remainingSeconds).toBe(1);
      expect(calls.autoFillChoices).toBe(0);

      currentNow = now0 + 5200;
      await vi.advanceTimersByTimeAsync(1000);
      expect(state.remainingSeconds).toBeLessThanOrEqual(0);
      expect(calls.autoFillChoices).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('(b) choiceEndAt이 없으면(오프라인) 기존과 동일하게 로컬 1초 감산으로 폴백한다(회귀 없음)', async () => {
    vi.useFakeTimers();
    try {
      const state = {
        role: 'host', gameRound: 1, round: 1, participants: [], confirmedSafeIds: [], confirmedLoserIds: [],
        penalty: '', choiceEndAt: 0,
      };
      const { mod, calls } = buildEnv({ state, serverNowFn: () => Date.now() });
      mod.beginRoundTimer();
      expect(state.remainingSeconds).toBe(5);
      await vi.advanceTimersByTimeAsync(1000);
      expect(state.remainingSeconds).toBe(4);
      await vi.advanceTimersByTimeAsync(4000);
      expect(state.remainingSeconds).toBeLessThanOrEqual(0);
      expect(calls.autoFillChoices).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('(c) 한 tick 사이에 handleRoomUpdate로 더 정확한 choiceEndAt이 갱신되면(예: host 발행이 늦게 도착) 다음 tick부터 즉시 반영된다 — closure 고정이었다면 절대 반영되지 않았을 것', async () => {
    vi.useFakeTimers();
    try {
      const now0 = 9_000_000;
      let currentNow = now0;
      const serverNowFn = () => currentNow;
      // 처음엔 choiceEndAt이 없어(아직 host 발행 전) 로컬 5초 폴백으로 시작한다.
      const state = {
        role: 'participant', gameRound: 1, round: 1, participants: [], confirmedSafeIds: [], confirmedLoserIds: [],
        penalty: '', choiceEndAt: 0,
      };
      const { mod } = buildEnv({ state, serverNowFn });
      mod.beginRoundTimer();
      expect(state.remainingSeconds).toBe(5); // 로컬 폴백

      // 1틱 뒤 host의 choiceEndAt이 room.penalty로 도착했다고 가정(실제로는 5초보다 남은 시간이 더 김)
      currentNow = now0 + 1000;
      state.penalty = JSON.stringify({ text: '', loserCount: 1, gameRound: 1, choiceEndAt: now0 + 8000 });
      await vi.advanceTimersByTimeAsync(1000);
      // 이제 정확한 값(now0+8000 기준)으로 재계산되어야 한다 — 폴백의 "4"가 아니라.
      expect(state.remainingSeconds).toBe(Math.ceil((now0 + 8000 - currentNow) / 1000));
      expect(state.remainingSeconds).not.toBe(4);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('Build30-R2 Phase A(WRPS-078) resyncChoiceTimerOnResume — background 복귀 시 즉시 보정(로컬 5초 재시작 금지)', () => {
  it('(a) status===playing + choiceEndAt 있음 + 화면이 choice 화면이면, 다음 tick을 기다리지 않고 즉시 예정시각 기준으로 보정한다', () => {
    const now0 = 2_000_000;
    let currentNow = now0;
    const serverNowFn = () => currentNow;
    const state = { status: 'playing', choiceEndAt: now0 + 5000, penalty: '', remainingSeconds: 5, role: 'participant', gameRound: 1, round: 1 };
    const { mod, els } = buildEnv({ state, serverNowFn, screenActive: { screenGame: true } });
    currentNow = now0 + 8400;
    mod.resyncChoiceTimerOnResume();
    expect(state.remainingSeconds).toBeLessThanOrEqual(0);
    expect(els.timerText.textContent).toBeLessThanOrEqual(0);
  });

  it('(b) 남은 시간이 아직 있으면(예: 2초) 그 실제 값으로 보정되고, "로컬 5초"로 리셋되지 않는다', () => {
    const now0 = 3_000_000;
    let currentNow = now0;
    const serverNowFn = () => currentNow;
    const state = { status: 'playing', choiceEndAt: now0 + 5000, penalty: '', remainingSeconds: 5, role: 'host', gameRound: 1, round: 1, timer: 'fake-handle' };
    const { mod, calls } = buildEnv({ state, serverNowFn, screenActive: { screenGame: true } });
    currentNow = now0 + 3100;
    mod.resyncChoiceTimerOnResume();
    expect(state.remainingSeconds).toBe(2);
    expect(state.remainingSeconds).not.toBe(5);
    expect(calls.stopRoundTimers).toBe(0);
  });

  it('(c) status가 playing이 아니거나 choice 화면이 아니면 아무 것도 하지 않는다(다른 화면으로 이미 전환된 경우 오염 방지)', () => {
    const state = { status: 'result', choiceEndAt: 1000, penalty: '', remainingSeconds: 5, role: 'host', gameRound: 1, round: 1 };
    const { mod } = buildEnv({ state, serverNowFn: () => 999999, screenActive: { screenGame: true } });
    mod.resyncChoiceTimerOnResume();
    expect(state.remainingSeconds).toBe(5);

    const state2 = { status: 'playing', choiceEndAt: 1000, penalty: '', remainingSeconds: 5, role: 'host', gameRound: 1, round: 1 };
    const { mod: mod2 } = buildEnv({ state: state2, serverNowFn: () => 999999, screenActive: { screenGame: false, screenHostPlaying: false } });
    mod2.resyncChoiceTimerOnResume();
    expect(state2.remainingSeconds).toBe(5);
  });
});

describe('Build30-R2 Phase A(WRPS-078) 소스 계약 — visibilitychange 훅/무변경 대상/로케일 상수 드리프트 방지', () => {
  it('visibilitychange 리스너가 resyncChoiceTimerOnResume()을 동기적으로(비동기 resyncRoomOnResume보다 먼저) 호출한다', () => {
    expect(html).toMatch(/if \(!document\.hidden\) \{[\s\S]{0,220}resyncChoiceTimerOnResume\(\);[\s\S]{0,50}resyncRoomOnResume\(\);/);
  });
  it('countdown lead(3600ms)/PHASE_RENDER_BUFFER_MS(900) 등 기존 서버시각 동기화 상수는 무변경이다', () => {
    expect(html).toContain('function getNextCountdownStartAt(delayMs = 3600) {');
    expect(html).toContain('const PHASE_RENDER_BUFFER_MS = 900;');
  });
  it('판정 알고리즘/Build23 guard 소스 계약은 무변경이다', () => {
    expect(html).toContain('function judgeRound(');
    expect(html).toContain('function resolveElimination(');
    expect(html).toContain('function isTaggerSelectionComplete() {');
  });
  it('COUNTDOWN_ANIM_MAX_MS(4050)는 runCountdown()의 실제 COUNTDOWN_TIMING.ko 합과 일치한다(드리프트 시 테스트가 이 계약에서 잡아낸다)', () => {
    expect(html).toContain('const COUNTDOWN_ANIM_MAX_MS = 4050;');
    expect(html).toMatch(/ko: \{ readySleepMs: 1250, rpsSleepMs: 2800 \}/);
    expect(1250 + 2800).toBe(4050);
  });
});
