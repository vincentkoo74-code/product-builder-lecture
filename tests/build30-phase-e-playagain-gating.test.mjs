import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

// Build30-R2 Phase E(WRPS-078) — CEO 최종 확정: "빠른 재게임" 신설 철회(전부 롤백), 기존 "한번더"
// (returnToLobbyAfterGame / canShowPlayAgainButton) 노출 규칙만 확정 + gameOver 참가자 준비화면
// 억제 확인.
//
// 1) 빠른 재게임(quickReplay/isReplayChainActive/canShowQuickReplayButton/completedGameOnce) —
//    전부 제거되었는지 소스 계약으로 확인.
// 2) "한번더" 버튼은 gameOver(caseType==="gameOver") 결과 렌더 시에만 노출되고, partial replay
//    (draw/tooMany/tooFew)에서는 canShowPlayAgainButton()이 무엇을 반환하든 절대 렌더되지 않는다
//    — 실제 renderRoundResult()를 4가지 caseType 모두로 실행해 구조적으로 증명한다(문자열 계약이
//    아니라 실제 실행).
// 3) gameOver(status='game_over') 참가자 라우팅에 준비화면(myReadyBtn) 경로가 없다 — status='ready'를
//    쓰는 3개 writer(nextRound/resetGameKeepRoom류/goToReadyScreen류) 모두 실제로 gameOver 상태를
//    벗어난 뒤에만 도달 가능함을 소스로 확인.

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

function extractBlock(startMarker, endMarker, includeEndFirstChar = false) {
  const start = html.indexOf(startMarker);
  if (start < 0) throw new Error(`start marker not found: ${startMarker}`);
  let end = html.indexOf(endMarker, start);
  if (end < 0) throw new Error(`end marker not found: ${endMarker}`);
  if (includeEndFirstChar) end += 1;
  return html.slice(start, end);
}

describe('Build30-R2 Phase E(WRPS-078) 롤백 완전성 — "빠른 재게임" 신설 코드 흔적 0', () => {
  it('quickReplay/isReplayChainActive/canShowQuickReplayButton/completedGameOnce/QUICK_REPLAY_STARTED 전부 제거되었다', () => {
    expect(html).not.toContain('function quickReplay(');
    expect(html).not.toContain('function isReplayChainActive(');
    expect(html).not.toContain('function canShowQuickReplayButton(');
    expect(html).not.toContain('completedGameOnce');
    expect(html).not.toContain('QUICK_REPLAY_STARTED');
    expect(html).not.toContain('window.quickReplay');
    expect(html).not.toContain('result.quickReplayBtn');
    expect(html).not.toContain('resultReadyBtn');
    expect(html).not.toContain('updateResultReadyButton');
  });

  it('WRPS-042 라운드1 강제시작 예외는 일반 정책(round<=1 하드블록) 그대로다 — 빠른재게임 전용 예외가 추가된 적 없다', () => {
    expect(html).toMatch(/if \(\(state\.round \|\| 1\) <= 1\) return; \/\/ WRPS-042: 라운드1 호스트 강제시작 부활 금지/);
    // WRPS-042 언급이 quickReplay/isReplayChainActive와 얽혀 있지 않다(교차 언급 없음).
    const wrps042Lines = html.split('\n').filter(l => l.includes('WRPS-042'));
    wrps042Lines.forEach(l => {
      expect(l).not.toMatch(/quickReplay|isReplayChainActive|canShowQuickReplayButton/);
    });
  });
});

// ── renderRoundResult() 실제 실행 — "한번더" 버튼 게이팅이 caseType 구조 자체에 있는지 증명 ──
const RENDER_ROUND_RESULT_SRC = extractBlock(
  'function renderRoundResult(caseType, roundLoserCount, remainingSlots) {',
  'async function autoStartDrawRematch() {'
);

function mockEl() {
  return { textContent: '', className: '', classList: { add() {}, remove() {}, contains: () => false, toggle() {} }, innerHTML: '', style: {}, disabled: false, appendChild() {} };
}

function runRenderRoundResult({ caseType, roundLoserCount = 0, remainingSlots = 0, state, canShowPlayAgainButtonImpl }) {
  const els = {};
  const $ = (id) => { if (!els[id]) els[id] = mockEl(); return els[id]; };
  const t = (key) => key;
  const getChoiceResult = () => '';
  const getChoiceBase = () => '';
  const isAutoChoice = () => false;
  const escapeHtml = (s) => s;
  const getTargetLoserCount = () => state.targetLoserCount || 1;
  const getActivePlayers = () => [];
  // Build30-R2 Phase2(WRPS-078): renderRoundResult()가 resultValue 게이트(RESULT_VALUE_UNRESOLVED/
  // RESULT_VALUE_FALLBACK_USED)를 위해 getGameRound()를 호출한다 — 이 테스트는 penalty 파싱
  // 소스를 주입하지 않으므로, 실제 getGameRound()와 동일한 최소 계약(state.gameRound 기반)만
  // 만족하는 스텁을 준다(다른 게터들과 동일한 패턴).
  const getGameRound = () => Math.max(1, state.gameRound || 1);
  const QA = { emit: () => {} };
  const canShowPlayAgainButton = canShowPlayAgainButtonImpl;
  const startGameOverCountdown = () => {};
  const renderRoundProgressCards = () => {};
  const updateActionGridLayouts = () => {};
  const setGuideText = () => {};
  const getPenaltyText = () => '';
  const documentStub = { createElement: () => ({ className: '', innerHTML: '' }) };
  const ROUND_CHOICES = ['scissors', 'rock', 'paper'];
  const currentLocale = 'ko';
  const factory = new Function(
    'state', '$', 't', 'getChoiceResult', 'getChoiceBase', 'isAutoChoice', 'escapeHtml',
    'getTargetLoserCount', 'getActivePlayers', 'QA', 'canShowPlayAgainButton', 'startGameOverCountdown',
    'renderRoundProgressCards', 'updateActionGridLayouts', 'setGuideText', 'getPenaltyText', 'document', 'ROUND_CHOICES', 'currentLocale',
    'getGameRound', 'isMatchComplete', 'getMatchState',
    RENDER_ROUND_RESULT_SRC + '\n; return renderRoundResult;'
  );
  const renderRoundResult = factory(
    state, $, t, getChoiceResult, getChoiceBase, isAutoChoice, escapeHtml,
    getTargetLoserCount, getActivePlayers, QA, canShowPlayAgainButton, startGameOverCountdown,
    renderRoundProgressCards, updateActionGridLayouts, setGuideText, getPenaltyText, documentStub, ROUND_CHOICES, currentLocale,
    getGameRound,
    // Build43: 매치 게이트 스텁 — 이 스위트는 매치 미종료(현행 동작) 경로를 검증한다.
    () => false, () => ({ finalTaggerIds: [], complete: false })
  );
  renderRoundResult(caseType, roundLoserCount, remainingSlots);
  return els;
}

function baseState(overrides = {}) {
  return {
    role: 'host', currentUserId: 'p1', targetLoserCount: 1,
    confirmedSafeIds: [], confirmedLoserIds: [],
    participants: [{ id: 'p1', is_host: true, lastResult: 'win', choice: 'rock' }],
    ...overrides,
  };
}

describe('Build30-R2 Phase E(WRPS-078) "한번더"(canShowPlayAgainButton) — 실제 renderRoundResult() 실행으로 게이팅 증명', () => {
  it('caseType==="gameOver" & canShowPlayAgainButton()===true → "한번더" 버튼 HTML이 실제로 렌더된다', () => {
    const els = runRenderRoundResult({ caseType: 'gameOver', state: baseState(), canShowPlayAgainButtonImpl: () => true });
    expect(els.finalResultBtns.innerHTML).toContain('window.returnToLobbyAfterGame()');
    expect(els.finalResultBtns.innerHTML).toContain('result.hostSettingsBtn');
  });

  it('caseType==="gameOver" & canShowPlayAgainButton()===false → "한번더" 버튼이 렌더되지 않는다', () => {
    const els = runRenderRoundResult({ caseType: 'gameOver', state: baseState(), canShowPlayAgainButtonImpl: () => false });
    expect(els.finalResultBtns.innerHTML).not.toContain('window.returnToLobbyAfterGame()');
  });

  it('caseType==="draw"(partial replay)는 canShowPlayAgainButton()이 true를 반환해도(방어적 극단값) "한번더" 버튼을 렌더하지 않는다 — finalBtns 자체를 건드리지 않는 구조', () => {
    const els = runRenderRoundResult({ caseType: 'draw', state: baseState(), canShowPlayAgainButtonImpl: () => true });
    expect(els.finalResultBtns.innerHTML).toBe(''); // draw 분기는 finalBtns.innerHTML을 아예 채우지 않음
  });

  it('caseType==="tooMany"(partial replay, 패자만 재경기)는 canShowPlayAgainButton()이 true여도 "한번더" 버튼을 렌더하지 않는다', () => {
    const els = runRenderRoundResult({ caseType: 'tooMany', roundLoserCount: 2, remainingSlots: 1, state: baseState(), canShowPlayAgainButtonImpl: () => true });
    expect(els.finalResultBtns.innerHTML).toBe('');
  });

  it('caseType==="tooFew"(partial replay, 승자만 재경기)는 canShowPlayAgainButton()이 true여도 "한번더" 버튼을 렌더하지 않는다', () => {
    const els = runRenderRoundResult({ caseType: 'tooFew', roundLoserCount: 0, remainingSlots: 1, state: baseState({ confirmedLoserIds: [] }), canShowPlayAgainButtonImpl: () => true });
    expect(els.finalResultBtns.innerHTML).toBe('');
  });

  it('소스 계약: canShowPlayAgainButton() = host+술래확정 + Build46 매치완료 게이트(한번더=새 매치 전용)', () => {
    expect(html).toMatch(/if \(!\(state\.role === "host" && isTaggerSelectionComplete\(\)\)\) return false;/);
    expect(html).toMatch(/typeof isMatchComplete === "function" && !isMatchComplete\(\)\) return false;/);
  });
});

// ── gameOver 상태 참가자 준비화면(myReadyBtn) 억제 — status='ready' writer 3곳이 모두 완주 후에만 도달 ──
describe('Build30-R2 Phase E(WRPS-078) gameOver 참가자 준비화면 억제 — status="ready" writer 검증(코드 근거)', () => {
  it('nextRound()는 target 술래 충족(gameOver) 시 status를 "ready"로 절대 쓰지 않고 즉시 결과화면으로 반환한다', () => {
    // Build30 Phase1: showScreen 이후 showTaggerPopup() 호출(확정 gameOver 팝업)이 추가되어
    // showScreen과 return 사이 거리가 늘었다 — status="ready"를 절대 쓰지 않는다는 계약 자체는
    // 그대로이므로 그 구간만 유연하게 허용한다.
    // WRPS-083 2B(계약 갱신): nextRound 진입부에 destroyed 공통 가드가 한 줄 추가됐다.
    // Phase E의 원 계약("gameOver 시 status='ready'를 절대 쓰지 않고 즉시 반환")은 그대로다 —
    // 가드는 그 앞에서 종료된 방의 write를 막을 뿐 gameOver 분기 자체를 바꾸지 않는다.
    expect(html).toMatch(/async function nextRound\(\) \{\s*\n\s*if \(isRoomClosingOrDestroyed\(\)\) return;[^\n]*\n\s*if \(state\.advancingRound\) return;[\s\S]{0,50}const safeIds = state\.confirmedSafeIds \|\| \[\];\s*\n\s*const loserIds = state\.confirmedLoserIds \|\| \[\];\s*\n\s*if \(loserIds\.length >= getTargetLoserCount\(\) \|\| state\.status === "game_over" \|\| \(\(typeof isCurrentGameTallied === "function"\) && isCurrentGameTallied\(\)\)\) \{\s*\n\s*showToast\(t\("voice\.gameOver"\)\);\s*\n\s*renderRoundResult\("gameOver", 0, 0\);\s*\n\s*showScreen\("screenRoundResult"\);[\s\S]{0,340}return;\s*\n\s*\}/);
  });

  it('status="ready" penalty 전이는 nextRound/C-2/goToReady 3곳이며 모두 exact penalty CAS를 쓴다', () => {
    const directWrites = (html.match(/status: 'ready'/g) || []).length;
    // WRPS-083 2A(계약 갱신): C-2(ACTIVE=0 · WAITING>0 · 술래 미달)는 방이 영구 정지하는 상태라
    // 같은 round를 ready로 다시 여는 두 번째 직접 writer가 필요하다. Phase E의 원 계약("전체 리셋은
    // beginNewGameRound 헬퍼로만")은 그대로다 — 이 writer도 round를 증가시키지 않고, 8조건
    // (host/ACTIVE=0/WAITING>0/술래 미달/!roomClosing/!gameStarting/!advancingRound/2회 연속 관측)을
    // 모두 만족할 때만 발화한다(tests/waiting-state-stage2a.test.mjs가 실제 실행으로 검증).
    expect(directWrites).toBe(3);
    expect(html).toMatch(/updateRoomPenaltyCas\(\s*\{\s*status: 'ready', penalty: readyPenalty \}/);
    expect(html).toContain("updateRoomPenaltyCas({ penalty: penaltyValue, status: 'ready' }");
    // gameOver(C-1)에서는 이 writer가 발화하지 않는다는 한정자가 소스에 그대로 있어야 한다.
    expect(html).toContain('confirmedLoserCount < targetLoserCount');
  });

  it('resetGameKeepRoom()(호스트 일괄리셋)은 반드시 blockPlayAgainIfPartialReplay() 하드블록을 통과한 뒤에만 status="ready"로 전환한다(partial replay 중에는 이 경로 자체가 차단됨)', () => {
    expect(html).toMatch(/async function resetGameKeepRoom\(\) \{\s*\n[\s\S]{0,200}if \(blockPlayAgainIfPartialReplay\(\)\) return;\s*\n\s*await beginNewGameRound\(\{\s*\n\s*status: "ready",/);
  });
});
