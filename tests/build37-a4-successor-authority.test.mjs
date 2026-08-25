import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

// ════════════════════════════════════════════════════════════════════════════
// A4 — host 이탈 후 남은 참가자 freeze: "progression authority 인수" 재현.
//
// ⚠️ HOST_SUCCESSION_RESET_SKIPPED(Build36)를 원인으로 가정하지 않는다. 그것은 리셋 차단이라는
//    정상 방어다. 여기서는 "successor가 host role을 얻은 뒤 실제로 진행을 이어갈 수 있는가"를
//    host-only 경로별로 REAL 소스에서 확인한다.
//
// 핵심 구분: host 게이트가
//   (a) per-call/per-tick 평가  → 역할이 중간에 바뀌어도 자동으로 인수된다
//   (b) setup-time 래치         → 라운드 시작 시점에 host가 아니었으면 영원히 시작되지 않는다
// (b)에 해당하는 경로는 승계자가 물려받지 못하고, 그 경로가 담당하던 진행이 멈춘다.
// ════════════════════════════════════════════════════════════════════════════

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
function extractBlock(a, b) {
  const s = html.indexOf(a); if (s < 0) throw new Error('start marker: ' + a);
  const e = html.indexOf(b, s); if (e < 0) throw new Error('end marker: ' + b);
  return html.slice(s, e);
}
const noop = () => {};

const BACKSTOP_SRC = extractBlock('function startHostJudgeBackstop() {', 'async function publishChoiceWindowEnd(choiceEndAt)');
const REARM_SRC = extractBlock('function rearmHostProgressionAuthority() {', 'function startHostJudgeBackstop() {');
// ⚠️ 'state.timer = setInterval' 은 백스톱에도 있어 첫 매치가 그쪽이다. 함수 범위로 먼저 자른다.
const BEGIN_ROUND_TIMER_SRC = extractBlock('function beginRoundTimer() {', 'function resyncChoiceTimerOnResume() {');
const ROUNDTIMER_SRC = BEGIN_ROUND_TIMER_SRC.slice(BEGIN_ROUND_TIMER_SRC.indexOf('state.timer = setInterval'));
const FETCH_ROLE_SRC = extractBlock('// 호스트 역할 전환 감지 (transferHostAndLeave / becomeNextHost)',
                                    '// 입장/퇴장 사운드: 참가자 ID diff');

describe('A4 — 단계 1: host transfer 직후 (authority 인수 지점)', () => {
  it('전제: fetchParticipants가 is_host를 보고 state.role을 host로 올린다', () => {
    expect(FETCH_ROLE_SRC).toContain('if (me.is_host && state.role !== "host") {');
    expect(FETCH_ROLE_SRC).toContain('state.role = "host";');
  });

  it('[RED-1] role 전환 시 진행 authority를 재무장하는 호출이 없다', () => {
    // 역할이 host로 바뀌는 그 자리에서, 이미 진행 중인 라운드의 host-only 경로를
    // 다시 세워주는 호출이 하나도 없다 → 인수가 "선언"에 그치고 "동작"으로 이어지지 않는다.
    const rearms = ['startHostJudgeBackstop', 'publishChoiceWindowEstimateIfHost',
                    'captureAndPublishChoiceWindowNow', 'hostJudgeRound', 'autoFillChoices'];
    const found = rearms.filter(fn => FETCH_ROLE_SRC.includes(fn));
    expect(found, `role 전환부에서 재무장 호출이 있어야 한다 (현재: ${found.join(',') || '없음'})`)
      .not.toEqual([]);
  });
});

describe('A4 — 단계 2~3: 현재 round 완료 / result 확정 (host-only 경로 게이트 성질)', () => {
  it('[GREEN] 백스톱 진입 게이트는 의도된 것이다 — 참가자에게 세우면 선택 타이머가 죽는다', () => {
    // Phase A에서는 이 게이트 자체를 결함으로 단언했으나 그건 틀렸다.
    // state.timer는 beginRoundTimer(선택 카운트다운)와 같은 슬롯이고 백스톱은 진입 시
    // stopRoundTimers()를 부른다 — 참가자에게 세우면 그 사람의 선택 카운트다운이 죽는다.
    // 결함은 게이트가 아니라 "승계 후 아무도 다시 부르지 않는다"였다. 게이트는 유지한다.
    const head = BACKSTOP_SRC.slice(0, BACKSTOP_SRC.indexOf('setInterval'));
    expect(head.length, '진입부 추출 실패').toBeGreaterThan(20);
    expect(head).toContain('if (state.role !== "host"');
    expect(head).toContain('stopRoundTimers();');
    // 그리고 재무장 쪽이 그 위험을 실제로 막고 있어야 한다.
    expect(REARM_SRC, '이미 도는 라운드 타이머를 덮어쓰지 않아야 한다').toContain('if (!hadRoundTimer) startHostJudgeBackstop();');
  });

  it('[대조군] beginRoundTimer의 autoFillChoices 게이트는 per-tick이라 인수된다', () => {
    // 같은 종류의 host-only 동작이라도 tick 안에서 평가하면 역할 전환이 자동 반영된다.
    // 이것이 (a)의 예시이며, 백스톱도 이 성질로 맞춰야 한다는 근거다.
    expect(ROUNDTIMER_SRC).toContain('if (state.role === "host") autoFillChoices();');
  });

  it('[RED-3→GREEN] 승계 후 재무장이 실제로 백스톱을 세운다 (REAL 실행)', () => {
    // ⚠️ Phase A의 이 테스트는 충족 불가능하게 써져 있었다: participant에서 0을 요구한 뒤
    //    `state.role='host'` 대입만 하고 곧바로 >0을 요구했다 — 그 사이에 실행되는 코드가
    //    없으므로 어떤 구현으로도 둘 다 만족할 수 없다. 실제 계약은 "승계를 관측한 지점이
    //    재무장을 호출하면 백스톱이 선다"이므로, 그 호출을 REAL 소스로 실행해 확인한다.
    const calls = { intervals: 0, published: 0, stopped: 0 };
    const state = { role: 'participant', status: 'playing', roomCode: 'BYZ7', round: 3,
                    gameRound: 5, timer: null };
    const factory = new Function('state', 'getOnlineMode', 'stopRoundTimers', 'serverNow',
      'getCountdownStartAt', 'autoFillChoices', 'setInterval', 'QA',
      'publishChoiceWindowEstimateIfHost', 'getGameRound',
      REARM_SRC + '\n' + BACKSTOP_SRC +
      '\nreturn { startHostJudgeBackstop, rearmHostProgressionAuthority };');
    const mod = factory(state, () => true,
      () => { calls.stopped++; state.timer = null; }, () => 5000, () => 1000, noop,
      (fn, ms) => { calls.intervals++; return 1; }, { emit: noop },
      () => { calls.published++; }, () => state.gameRound);

    mod.startHostJudgeBackstop();                      // 라운드 시작: 아직 participant
    expect(calls.intervals, '참가자일 때는 백스톱이 없는 게 정상').toBe(0);

    state.role = 'host';                               // 승계 발생 (fetchParticipants가 하는 일)
    mod.rearmHostProgressionAuthority();               // 그 지점이 호출하는 재무장
    expect(calls.intervals, '승계 후 판정 백스톱이 세워져야 한다').toBe(1);
    expect(calls.published, '승계 후 choice window도 다시 발행해야 한다').toBe(1);
  });

  it('[GREEN] 이번 라운드 플레이어(타이머 보유)에게는 백스톱을 덮어씌우지 않는다', () => {
    // 회귀 방지: 여기서 백스톱을 세우면 stopRoundTimers()가 선택 카운트다운을 죽인다.
    const calls = { intervals: 0, published: 0 };
    const state = { role: 'host', status: 'playing', roomCode: 'BYZ7', round: 3,
                    gameRound: 5, timer: 42 };     // 이미 beginRoundTimer가 돌고 있다
    const factory = new Function('state', 'getOnlineMode', 'stopRoundTimers', 'serverNow',
      'getCountdownStartAt', 'autoFillChoices', 'setInterval', 'QA',
      'publishChoiceWindowEstimateIfHost', 'getGameRound',
      REARM_SRC + '\n' + BACKSTOP_SRC +
      '\nreturn { rearmHostProgressionAuthority };');
    const mod = factory(state, () => true, () => { state.timer = null; }, () => 5000,
      () => 1000, noop, (fn, ms) => { calls.intervals++; return 1; }, { emit: noop },
      () => { calls.published++; }, () => state.gameRound);
    mod.rearmHostProgressionAuthority();
    expect(calls.intervals, '기존 라운드 타이머를 덮어썼다').toBe(0);
    expect(state.timer, '선택 카운트다운이 죽었다').toBe(42);
    expect(calls.published, 'choice window 발행은 그래도 해야 한다').toBe(1);
  });

  it('[GREEN] 진행 중인 라운드가 없으면 아무 것도 세우지 않는다', () => {
    const calls = { intervals: 0, published: 0 };
    const state = { role: 'host', status: 'ready', roomCode: 'BYZ7', round: 3, gameRound: 5, timer: null };
    const factory = new Function('state', 'getOnlineMode', 'stopRoundTimers', 'serverNow',
      'getCountdownStartAt', 'autoFillChoices', 'setInterval', 'QA',
      'publishChoiceWindowEstimateIfHost', 'getGameRound',
      REARM_SRC + '\n' + BACKSTOP_SRC + '\nreturn { rearmHostProgressionAuthority };');
    const mod = factory(state, () => true, noop, () => 5000, () => 1000, noop,
      () => { calls.intervals++; return 1; }, { emit: noop },
      () => { calls.published++; }, () => state.gameRound);
    mod.rearmHostProgressionAuthority();
    expect(calls.intervals).toBe(0);
    expect(calls.published).toBe(0);
  });
});

describe('A4 — 단계 4~5: next round 진입 / 새 countdown (host-only write 소유자)', () => {
  it('[RED-4→GREEN] choice window 발행 권한도 승계자에게 인수된다', () => {
    // captureAndPublishChoiceWindowNow / publishChoiceWindowEstimateIfHost 는
    // runCountdownThenShowGame 안에서 한 번만 호출된다 — 그 시점에 host가 아니었다면
    // 이번 라운드의 choiceEndAt은 아무도 발행하지 않는다(승계자도 발행하지 않는다).
    const runSrc = extractBlock('async function runCountdownThenShowGame() {',
                                '// Phase 1: 호스트용 playing 화면 렌더');
    expect(runSrc).toContain('captureAndPublishChoiceWindowNow();');
    expect(runSrc).toContain('publishChoiceWindowEstimateIfHost();');
    // 이 두 호출은 라운드당 1회뿐이다 — 그 시점에 host가 아니었던 승계자를 위해
    // 역할 전환 지점이 재무장을 거쳐 다시 발행해야 한다. 문자열이 아니라 사슬로 확인한다.
    expect(FETCH_ROLE_SRC, '역할 전환 지점이 재무장을 호출해야 한다')
      .toContain('rearmHostProgressionAuthority();');
    expect(REARM_SRC, '재무장이 choice window를 다시 발행해야 한다')
      .toContain('publishChoiceWindowEstimateIfHost();');
  });

  it('[대조군] nextRound 자체에는 host 게이트가 없다 (다음 라운드 진입은 막히지 않는다)', () => {
    const nextSrc = extractBlock('async function nextRound() {', 'async function endGame()');
    const head = nextSrc.slice(0, 400);
    expect(/if \(state\.role !== "host"\) return;/.test(head),
      'nextRound 진입부에 host 게이트가 없어야 한다').toBe(false);
  });

  it('[대조군] Build36 리셋 차단은 정상 방어이며 authority와 무관하다', () => {
    // HOST_SUCCESSION_RESET_SKIPPED는 "리셋하지 않는다"만 의미한다.
    // 그 분기 안에서 진행 authority를 세우는 동작은 없고, 그것이 A4의 원인도 아니다.
    expect(FETCH_ROLE_SRC).toContain('skipResetForHostSuccession');
    // 재무장은 리셋 차단과 **별개 관심사**다. 리셋 차단 분기 안에서 authority를 세우지 않는다 —
    // 재무장은 역할 전환을 관측한 그 자리에서만 일어난다.
    expect(FETCH_ROLE_SRC.includes('startHostJudgeBackstop'),
      '백스톱은 재무장 헬퍼 안에서만 세운다(리셋 분기와 분리)').toBe(false);
  });
});
