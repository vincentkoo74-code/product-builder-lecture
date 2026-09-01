import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

// Build30(WRPS-078) [Phase2] — 게임준비 버튼(myReadyBtn) 제거.
//
// 실기기 QA 문제3: showReadyScreen()이 role/round와 무관하게 myReadyBtn을 무조건 노출해,
// force-start(강제 시작, Build27/WRPS-074) 버튼과 동시에 떠 있어 어느 쪽을 눌러야 하는지
// 헷갈렸다. 수정: canShowForceStartReplayButton()이 true인 동안에는 myReadyBtn을 숨긴다.
//
// ⚠️ canShowForceStartReplayButton() 자체(9536 부근)는 무변경 — 호출만 한다.
// ⚠️ CEO 회귀조건: force-start와 myReadyBtn이 "같은 함수" 결과로만 분기해야 한다(별개 조건이면
// 양쪽 다 숨는 deadlock 가능) — 소스 계약으로 고정한다.
//
// 테스트 스타일: tests/build27-replay-force-start.test.mjs와 동일한 "실제 소스 추출 +
// new Function() 실행" 패턴.

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

function extractBlock(startMarker, endMarker, includeEndFirstChar = false) {
  const start = html.indexOf(startMarker);
  if (start < 0) throw new Error(`start marker not found: ${startMarker}`);
  let end = html.indexOf(endMarker, start);
  if (end < 0) throw new Error(`end marker not found: ${endMarker}`);
  if (includeEndFirstChar) end += 1;
  return html.slice(start, end);
}

const SHOW_READY_SRC = extractBlock(
  'function showReadyScreen() {',
  'function renderReadyList() {'
);

function mockEl(initialClasses = ['hidden']) {
  const classes = new Set(initialClasses);
  return {
    classList: {
      add: (c) => classes.add(c),
      remove: (c) => classes.delete(c),
      toggle: (c, force) => { if (force === undefined) { classes.has(c) ? classes.delete(c) : classes.add(c); } else if (force) classes.add(c); else classes.delete(c); },
      contains: (c) => classes.has(c),
    },
  };
}

function runShowReadyScreen({ state, canShowForceStartReplayButton }) {
  const els = { hostStartBtn: mockEl([]), myReadyBtn: mockEl(), editPenaltyBtn: mockEl(), readyPenaltyBox: mockEl() };
  const factory = new Function(
    'state', '$', 'showScreen', 'renderInlinePenaltyBox', 'renderReadyList', 'updateActionGridLayouts', 'updateGuides',
    'canShowForceStartReplayButton',
    SHOW_READY_SRC + '\n; return showReadyScreen;'
  );
  const showReadyScreen = factory(state, (id) => els[id], () => {}, () => {}, () => {}, () => {}, () => {}, canShowForceStartReplayButton);
  showReadyScreen();
  return els;
}

describe('Build30(WRPS-078) [Phase2] showReadyScreen — myReadyBtn / force-start 단일 소스 분기', () => {
  it('canShowForceStartReplayButton()===true면 myReadyBtn이 숨는다(force-start만 노출)', () => {
    const state = { role: 'host', round: 2, participants: [] };
    const els = runShowReadyScreen({ state, canShowForceStartReplayButton: () => true });
    expect(els.myReadyBtn.classList.contains('hidden')).toBe(true);
  });

  it('canShowForceStartReplayButton()===false면 myReadyBtn이 정상 노출된다', () => {
    const state = { role: 'participant', round: 3, participants: [] };
    const els = runShowReadyScreen({ state, canShowForceStartReplayButton: () => false });
    expect(els.myReadyBtn.classList.contains('hidden')).toBe(false);
  });

  it('round===1(첫 게임 준비화면)은 항상 myReadyBtn이 노출된다(회귀 없음) — round1에서 canShowForceStartReplayButton이 false를 반환하는 정상 조합', () => {
    const state = { role: 'host', round: 1, participants: [] };
    // round<=1에서는 실제 canShowForceStartReplayButton()도 항상 false이므로, 그 실제 계약을
    // 그대로 주입해 검증한다(round1 자연 노출 — 별도 조건을 추가하지 않았음을 실제 함수로 확인).
    const els = runShowReadyScreen({
      state,
      canShowForceStartReplayButton: (s = state) => s.role === 'host' && (s.round || 1) > 1,
    });
    expect(els.myReadyBtn.classList.contains('hidden')).toBe(false);
  });

  it('deadlock 없음: force-start가 보이지 않는데(false) myReadyBtn도 숨는 조합은 발생하지 않는다', () => {
    const state = { role: 'participant', round: 5, participants: [] };
    const els = runShowReadyScreen({ state, canShowForceStartReplayButton: () => false });
    expect(els.myReadyBtn.classList.contains('hidden')).toBe(false);
  });

  it('소스 계약: myReadyBtn 토글은 canShowForceStartReplayButton() 결과 그 자체를 인자로 쓴다(별개 조건 금지)', () => {
    expect(html).toMatch(/\$\("myReadyBtn"\)\.classList\.toggle\("hidden", \(typeof isInternalRematchReadyPhase === "function"\) \? isInternalRematchReadyPhase\(\) : canShowForceStartReplayButton\(\)\);/);
  });

  it('[Build47 D2 갱신] canShowForceStartReplayButton 은 정족수 조건 없이 host/ready/round>1/active>0', () => {
    const i0 = html.indexOf('function canShowForceStartReplayButton');
    const body = html.slice(i0, i0 + 420);
    expect(body).toContain('(state.round || 1) > 1');
    expect(body).toContain('getActivePlayers().length > 0');
    expect(body).not.toContain('areAllActivePlayersReady');
  });});

// Build30-R2 Phase D(WRPS-078, HIGH-B 재수정) — myReadyBtn 숨김이 realtime 재렌더 한 번에 원복되는
// 회귀. 결함: showReadyScreen()이 myReadyBtn에 hidden을 추가해도, renderReadyList()→
// updateMyReadyButton()(무변경 대상, 호출만)이 매번 btn.className = "..."로 통째 재대입해 hidden
// 토큰을 지워버린다 — realtime 갱신(fetchParticipants 폴링/handleRoomUpdate)이 renderReadyList()를
// 다시 부르는 순간 myReadyBtn이 재노출된다. Round1의 위 테스트들은 showReadyScreen()의 "최초 1회"
// 토글만 검증하는 no-op에 가까운 mock이라 이 재렌더 회귀를 잡지 못했다(CEO 지적) — 이 블록은
// renderReadyList()를 실제로 반복 호출해 재현한다.
const READY_LIST_SRC = extractBlock(
  'function renderReadyList() {',
  'function updateHostStartButton() {'
);

function runRenderReadyListRepeatedly({
  state, canShowForceStartReplayButton, times = 3,
  // D-a(Build30 Phase3 테스트갭): 기존엔 이 값이 함수 내부에 () => true로 고정돼 있어
  // updateMyReadyButton()의 "비참가자"(우선안전/확정 술래로 이번 라운드 미참여) 분기가 어떤
  // 테스트에서도 실제로 실행되지 않았다(정적 소스 계약 1개뿐, 실행 검증 없음) — 호출부가 주입할
  // 수 있게 파라미터화한다. 기본값은 기존 테스트와의 회귀 없는 호환을 위해 그대로 () => true.
  isCurrentRoundParticipant = () => true,
  isSafeParticipant = () => false,
} = {}) {
  const els = { readyParticipantList: { innerHTML: '', appendChild: () => {} }, myReadyBtn: mockEl([]) };
  const $ = (id) => els[id];
  const getParticipantBadge = () => '';
  const t = (key) => key;
  const escapeHtml = (s) => s;
  const setBtnText = (btn, text) => { btn.textContent = text; };
  const updateForceStartReplayButtons = () => {};
  const updateHostStartButton = () => {};
  const factory = new Function(
    'state', '$', 'getParticipantBadge', 't', 'escapeHtml', 'setBtnText', 'isCurrentRoundParticipant',
    'isSafeParticipant', 'canShowForceStartReplayButton', 'updateForceStartReplayButtons', 'updateHostStartButton',
    'document',
    READY_LIST_SRC + '\n; return { renderReadyList, updateMyReadyButton };'
  );
  const documentStub = { createElement: () => ({ className: '', innerHTML: '' }) };
  const mod = factory(
    state, $, getParticipantBadge, t, escapeHtml, setBtnText, isCurrentRoundParticipant,
    isSafeParticipant, canShowForceStartReplayButton, updateForceStartReplayButtons, updateHostStartButton, documentStub
  );
  for (let i = 0; i < times; i++) mod.renderReadyList();
  return els;
}

describe('Build30-R2 Phase D(WRPS-078) updateMyReadyButton — className 재대입 이후에도 hidden이 유지된다(매 렌더 재적용)', () => {
  it('force-start가 노출 중(canShowForceStartReplayButton===true)이면, renderReadyList()가 반복(realtime 재렌더 시뮬레이션) 호출돼도 myReadyBtn이 계속 숨겨져 있다', () => {
    // 최초 hidden 상태로 시작(showReadyScreen이 이미 숨긴 상태를 재현)한 뒤, realtime 갱신을
    // 흉내내 renderReadyList()를 여러 번 호출한다 — Round1 회귀는 바로 이 두 번째 호출부터
    // className 재대입으로 hidden이 지워졌었다.
    const state = { role: 'host', round: 2, status: 'ready', participants: [{ id: 'me', is_ready: false }], currentUserId: 'me' };
    const els = runRenderReadyListRepeatedly({ state, canShowForceStartReplayButton: () => true, times: 3 });
    expect(els.myReadyBtn.classList.contains('hidden')).toBe(true);
  });

  it('round1(canShowForceStartReplayButton===false)에서는 반복 렌더돼도 myReadyBtn이 정상 노출된 채로 유지된다(무회귀)', () => {
    const state = { role: 'host', round: 1, status: 'ready', participants: [{ id: 'me', is_ready: false }], currentUserId: 'me' };
    const els = runRenderReadyListRepeatedly({ state, canShowForceStartReplayButton: () => false, times: 3 });
    expect(els.myReadyBtn.classList.contains('hidden')).toBe(false);
  });

  it('force-start 조건이 렌더 도중 true→false로 바뀌면(예: 마지막 참가자가 준비 완료) 다음 렌더에서 다시 노출된다(단일 소스 실시간 반영)', () => {
    const state = { role: 'host', round: 2, status: 'ready', participants: [{ id: 'me', is_ready: false }], currentUserId: 'me' };
    let forceStartActive = true;
    const els = runRenderReadyListRepeatedly({ state, canShowForceStartReplayButton: () => forceStartActive, times: 1 });
    expect(els.myReadyBtn.classList.contains('hidden')).toBe(true);
    forceStartActive = false;
    // 실제 앱과 동일하게 renderReadyList()가 다시 호출되는 상황을 재현.
    const els2 = runRenderReadyListRepeatedly({ state, canShowForceStartReplayButton: () => forceStartActive, times: 1 });
    expect(els2.myReadyBtn.classList.contains('hidden')).toBe(false);
  });

  it('소스 계약: updateMyReadyButton의 두 분기(비참가자/참가자) 모두 className 재대입 뒤에 canShowForceStartReplayButton()로 hidden을 재적용한다', () => {
    expect(html).toMatch(/btn\.className = "btn-light btn-full";\s*\n\s*\/\/ Build30-R2 Phase D[\s\S]{0,120}btn\.classList\.toggle\("hidden", \(typeof isInternalRematchReadyPhase === "function"\) \? isInternalRematchReadyPhase\(\) : canShowForceStartReplayButton\(\)\);\s*\n\s*return;/);
    expect(html).toMatch(/btn\.className = "btn-primary btn-full";\s*\n\s*\}[\s\S]{0,700}btn\.classList\.toggle\("hidden", \(typeof isInternalRematchReadyPhase === "function"\) \? isInternalRematchReadyPhase\(\) : canShowForceStartReplayButton\(\)\);\s*\n\s*\}/);
  });

  // Build30 Phase3(테스트갭 D-a): 위 3개 재렌더 테스트는 전부 isCurrentRoundParticipant()가 함수
  // 내부에 () => true로 고정돼 있어 updateMyReadyButton()의 "비참가자"(우선안전/확정 술래라 이번
  // 라운드 미참여) 분기를 한 번도 실제로 실행하지 않았다 — 직전 "소스 계약" 테스트가 정적 regex로만
  // 그 분기의 존재를 확인했을 뿐, 실행 결과(behavioral)는 검증하지 않았다. 아래는 그 공백을 메운다.
  it('[D-a] 비참가자(우선안전) 분기: force-start가 노출 중이면 반복 재렌더(realtime 시뮬레이션)돼도 myReadyBtn이 계속 숨겨진 채 안전 대기 문구를 유지한다', () => {
    const state = { role: 'participant', round: 2, status: 'ready', participants: [{ id: 'me', is_ready: true }], currentUserId: 'me' };
    const els = runRenderReadyListRepeatedly({
      state, canShowForceStartReplayButton: () => true, times: 3,
      isCurrentRoundParticipant: () => false, // 이번 라운드 미참여(우선안전/확정 술래)
      isSafeParticipant: () => true,
    });
    expect(els.myReadyBtn.classList.contains('hidden')).toBe(true);
    expect(els.myReadyBtn.textContent).toBe('ready.safeFirst');
    expect(els.myReadyBtn.disabled).toBe(true);
    expect(els.myReadyBtn.className).toBe('btn-light btn-full');
  });

  it('[D-a] 비참가자(확정 술래, 우선안전 아님) 분기: 안전 문구가 아니라 "다음 게임 대기" 문구를 쓴다(isSafeParticipant()===false 갈림 확인)', () => {
    const state = { role: 'participant', round: 2, status: 'ready', participants: [{ id: 'me', is_ready: true }], currentUserId: 'me' };
    const els = runRenderReadyListRepeatedly({
      state, canShowForceStartReplayButton: () => false, times: 1,
      isCurrentRoundParticipant: () => false,
      isSafeParticipant: () => false,
    });
    expect(els.myReadyBtn.textContent).toBe('ready.waitingNextGame');
    expect(els.myReadyBtn.disabled).toBe(true);
  });

  it('[D-a] 비참가자 분기도 force-start===false면(단일 소스 동일) 반복 재렌더돼도 정상 노출을 유지한다(참가자 분기와 동일한 계약)', () => {
    const state = { role: 'participant', round: 2, status: 'ready', participants: [{ id: 'me', is_ready: true }], currentUserId: 'me' };
    const els = runRenderReadyListRepeatedly({
      state, canShowForceStartReplayButton: () => false, times: 3,
      isCurrentRoundParticipant: () => false,
      isSafeParticipant: () => true,
    });
    expect(els.myReadyBtn.classList.contains('hidden')).toBe(false);
  });

  it('[D-a] 참가자→비참가자로 라운드 중 전환되어도(예: 우선안전 확정 직후) 다음 재렌더에서 동일한 단일 소스 hidden 계약이 그대로 적용된다', () => {
    const state = { role: 'participant', round: 2, status: 'ready', participants: [{ id: 'me', is_ready: false }], currentUserId: 'me' };
    const participating = runRenderReadyListRepeatedly({
      state, canShowForceStartReplayButton: () => true, times: 1,
      isCurrentRoundParticipant: () => true,
    });
    expect(participating.myReadyBtn.classList.contains('hidden')).toBe(true);
    // 우선안전 확정으로 비참가자가 된 뒤 realtime 재렌더.
    const becameSafe = runRenderReadyListRepeatedly({
      state, canShowForceStartReplayButton: () => true, times: 1,
      isCurrentRoundParticipant: () => false, isSafeParticipant: () => true,
    });
    expect(becameSafe.myReadyBtn.classList.contains('hidden')).toBe(true); // force-start 노출 중엔 계속 숨김
    expect(becameSafe.myReadyBtn.textContent).toBe('ready.safeFirst');
  });
});
