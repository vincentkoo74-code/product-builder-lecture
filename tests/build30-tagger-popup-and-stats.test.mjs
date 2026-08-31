import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

// Build30 Phase1(CEO 확정) — 게임 종료(gameOver=최종 술래 확정) 시에만 확정 술래 이름을 팝업으로
// 즉시 표시(호스트·참가자 모두). '한번더' 클릭 또는 화면 전환 시 즉시 제거. 게임 완료 시 술래 이름을
// 통계 스냅샷(saveLastCompletedGameResult)에 포함해 저장·표시(screenStats).
//
// 테스트 스타일: 실제 소스 추출 + new Function() 실행(hand-copy 로직 검증 금지) — 다른 build30 테스트와
// 동일한 계약.

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

function extractBlock(startMarker, endMarker) {
  const start = html.indexOf(startMarker);
  if (start < 0) throw new Error(`start marker not found: ${startMarker}`);
  const end = html.indexOf(endMarker, start);
  if (end < 0) throw new Error(`end marker not found: ${endMarker}`);
  return html.slice(start, end);
}

const TAGGER_POPUP_SRC = extractBlock(
  'function getConfirmedTaggerNames() {',
  'function showStatsPopup() {'
);
const GET_CONFIRMED_TAGGER_NAMES_SRC = extractBlock(
  'function getConfirmedTaggerNames() {',
  'function showTaggerPopup() {'
);
const SHOW_STATS_POPUP_SRC = extractBlock(
  'function showStatsPopup() {',
  'function closeStatsPopup() {'
);
const AUTO_SAVE_GAME_OVER_SRC = extractBlock(
  'function autoSaveGameOverResultOnce() {',
  'async function finishRoundLocal() {'
);
const FINISH_ROUND_LOCAL_SRC = extractBlock(
  'async function finishRoundLocal() {',
  'function finishRound() {'
);
const SAVE_LAST_COMPLETED_SRC = extractBlock(
  'async function saveLastCompletedGameResult(roomCode = state.roomCode) {',
  'function getLastCompletedGameResult() {'
);
const RENDER_STATS_SRC = extractBlock(
  'function renderStats() {',
  'async function recordMyAccountGameResult('
); // getWinRate 포함

function makeFakeElement(id) {
  const classes = new Set(['hidden']); // 기본 hidden (popup-overlay 초기 상태와 동일)
  return {
    id,
    _classes: classes,
    textContent: '',
    innerHTML: '',
    classList: {
      add: (c) => classes.add(c),
      remove: (c) => classes.delete(c),
      contains: (c) => classes.has(c),
    },
    // B45 즉시-확정 모델: showTaggerPopup 이 제목 요소를 popup.querySelector 로 찾는다(샌드박스는 DOM 미탑재 → null 로 충분, 가드됨).
    querySelector: () => null,
  };
}

function loadTaggerPopupFns({ state, tImpl }) {
  const elements = {
    taggerPopup: makeFakeElement('taggerPopup'),
    taggerPopupNames: makeFakeElement('taggerPopupNames'),
    taggerPopupMatchMsg: makeFakeElement('taggerPopupMatchMsg'),
  };
  const $ = (id) => elements[id] || null;
  const t = tImpl || ((key) => key);
  const window = {};
  const factory = new Function(
    'state', '$', 't', 'window',
    TAGGER_POPUP_SRC + '\n; return { getConfirmedTaggerNames, showTaggerPopup, hideTaggerPopup };'
  );
  const mod = factory(state, $, t, window);
  return { ...mod, elements };
}

function loadSaveLastCompletedGameResult({ state, db, getOnlineModeImpl, localStorageMap }) {
  const getOnlineMode = getOnlineModeImpl || (() => Boolean(db));
  const getPenaltyText = () => 'penalty-text';
  const getGameRound = () => state.gameRound || 1;
  const store = localStorageMap || new Map();
  const setScopedLocalStorageItem = (key, value) => store.set(key, value);
  const factory = new Function(
    'state', 'db', 'getOnlineMode', 'getPenaltyText', 'getGameRound', 'setScopedLocalStorageItem',
    SAVE_LAST_COMPLETED_SRC + '\n; return saveLastCompletedGameResult;'
  );
  const saveLastCompletedGameResult = factory(
    state, db, getOnlineMode, getPenaltyText, getGameRound, setScopedLocalStorageItem
  );
  return { saveLastCompletedGameResult, store };
}

function loadRenderStats({ state, dataProvider, tImpl }) {
  const rows = [];
  const tbody = {
    innerHTML: '',
    appendChild: (tr) => rows.push(tr),
  };
  const elements = { statsTableBody: tbody };
  const $ = (id) => elements[id] || null;
  const document = {
    createElement: () => ({ innerHTML: '' }),
  };
  const t = tImpl || ((key) => key);
  const escapeHtml = (text) => String(text ?? '');
  const getStatsViewData = dataProvider;
  const factory = new Function(
    'state', '$', 'document', 't', 'escapeHtml', 'getStatsViewData',
    RENDER_STATS_SRC + '\n; return renderStats;'
  );
  const renderStats = factory(state, $, document, t, escapeHtml, getStatsViewData);
  return { renderStats, rows, tbody };
}

// Build30 Phase2(CEO 확정) — showStatsPopup에 "이번 게임" 확정 술래 표시. buildRoomStatsSummary
// 자체(누적 집계 정확성)는 room-lifecycle.test.mjs 등 다른 테스트로 이미 커버되므로, 여기서는 실제
// showStatsPopup 렌더 로직만 실제 소스로 검증하고 buildRoomStatsSummary는 주입 가능한 스텁으로
// 대체한다(loadRenderStats가 getStatsViewData를 dataProvider로 스텁하는 것과 동일한 기존 패턴).
function loadShowStatsPopup({ state, buildRoomStatsSummaryImpl, tImpl }) {
  const rows = [];
  const tbody = { innerHTML: '', appendChild: (tr) => rows.push(tr) };
  const elements = {
    statsPopupBody: tbody,
    statsPopupTaggerLine: makeFakeElement('statsPopupTaggerLine'),
    statsPopup: makeFakeElement('statsPopup'),
  };
  const $ = (id) => elements[id] || null;
  const t = tImpl || ((key, vars) => (vars ? `${key}:${JSON.stringify(vars)}` : key));
  const escapeHtml = (text) => String(text ?? '');
  const document = { createElement: () => ({ innerHTML: '', style: {} }) };
  const getWinRate = (p) => {
    const total = (p.wins || 0) + (p.losses || 0);
    return total === 0 ? 0 : Math.round(((p.wins || 0) / total) * 100);
  };
  const buildRoomStatsSummary = buildRoomStatsSummaryImpl;
  const factory = new Function(
    'state', '$', 't', 'escapeHtml', 'document', 'getWinRate', 'buildRoomStatsSummary',
    GET_CONFIRMED_TAGGER_NAMES_SRC + '\n' + SHOW_STATS_POPUP_SRC + '\n; return showStatsPopup;'
  );
  const showStatsPopup = factory(state, $, t, escapeHtml, document, getWinRate, buildRoomStatsSummary);
  return { showStatsPopup, elements, rows, tbody };
}

// Build30 Phase2(CEO 확정) — gameOver 확정 시 이번 게임 결과를 자동 저장하는 가드 함수 자체의 동작
// (게임당 1회, key = roomCode:gameRound)을 실제 소스로 검증한다.
function loadAutoSaveGameOverResultOnce({ state, saveLastCompletedGameResultImpl, getGameRoundImpl }) {
  const saveLastCompletedGameResult = saveLastCompletedGameResultImpl || (() => Promise.resolve(true));
  const getGameRound = getGameRoundImpl || (() => state.gameRound || 1);
  const factory = new Function(
    'state', 'getGameRound', 'saveLastCompletedGameResult',
    AUTO_SAVE_GAME_OVER_SRC + '\n; return autoSaveGameOverResultOnce;'
  );
  return factory(state, getGameRound, saveLastCompletedGameResult);
}

describe('Build30 Phase1 — getConfirmedTaggerNames(확정 술래 이름 조회)', () => {
  it('participant.name으로 확정 술래 이름을 조회한다(복수 술래 전원 나열)', () => {
    const state = {
      confirmedLoserIds: ['p2', 'p3'],
      participants: [
        { id: 'p1', name: 'Alice' },
        { id: 'p2', name: 'Bob' },
        { id: 'p3', name: 'Carol' },
      ],
      currentUserId: 'p1',
    };
    const { getConfirmedTaggerNames } = loadTaggerPopupFns({ state });
    expect(getConfirmedTaggerNames()).toEqual(['Bob', 'Carol']);
  });

  it('participant 행에 이름이 없으면(누락) 폴백(익명 문자열)을 사용한다', () => {
    const state = {
      confirmedLoserIds: ['p2'],
      participants: [{ id: 'p1', name: 'Alice' }, { id: 'p2', name: '' }],
      currentUserId: 'p1',
    };
    const { getConfirmedTaggerNames } = loadTaggerPopupFns({
      state, tImpl: (key) => (key === 'common.anonymous' ? '익명' : key),
    });
    expect(getConfirmedTaggerNames()).toEqual(['익명']);
  });

  it('내 참가자 행 자체가 없어도(재연결 등) 내 nickname으로 폴백한다', () => {
    const state = {
      confirmedLoserIds: ['me'],
      participants: [{ id: 'other', name: 'Other' }],
      currentUserId: 'me',
      nickname: 'MyNick',
    };
    const { getConfirmedTaggerNames } = loadTaggerPopupFns({ state });
    expect(getConfirmedTaggerNames()).toEqual(['MyNick']);
  });

  it('확정 술래가 없으면 빈 배열을 반환한다', () => {
    const state = { confirmedLoserIds: [], participants: [{ id: 'p1', name: 'Alice' }] };
    const { getConfirmedTaggerNames } = loadTaggerPopupFns({ state });
    expect(getConfirmedTaggerNames()).toEqual([]);
  });
});

describe('Build30 Phase1 — showTaggerPopup/hideTaggerPopup(표시/제거)', () => {
  it('showTaggerPopup()은 확정 술래 이름을 채우고 hidden 클래스를 제거한다(표시)', () => {
    const state = {
      confirmedLoserIds: ['p1'],
      participants: [{ id: 'p1', name: 'Alice' }],
    };
    const { showTaggerPopup, elements } = loadTaggerPopupFns({ state });
    expect(elements.taggerPopup.classList.contains('hidden')).toBe(true);
    showTaggerPopup();
    expect(elements.taggerPopup.classList.contains('hidden')).toBe(false);
    expect(elements.taggerPopupNames.textContent).toBe('Alice');
  });

  it('복수 술래는 쉼표로 나열해 표시한다', () => {
    const state = {
      confirmedLoserIds: ['p1', 'p2'],
      participants: [{ id: 'p1', name: 'Alice' }, { id: 'p2', name: 'Bob' }],
    };
    const { showTaggerPopup, elements } = loadTaggerPopupFns({ state });
    showTaggerPopup();
    expect(elements.taggerPopupNames.textContent).toBe('Alice, Bob');
  });

  it('확정 술래가 없으면(방어적) 표시하지 않는다', () => {
    const state = { confirmedLoserIds: [], participants: [] };
    const { showTaggerPopup, elements } = loadTaggerPopupFns({ state });
    showTaggerPopup();
    expect(elements.taggerPopup.classList.contains('hidden')).toBe(true);
  });

  it('hideTaggerPopup()은 hidden 클래스를 다시 추가한다(제거)', () => {
    const state = { confirmedLoserIds: ['p1'], participants: [{ id: 'p1', name: 'Alice' }] };
    const { showTaggerPopup, hideTaggerPopup, elements } = loadTaggerPopupFns({ state });
    showTaggerPopup();
    expect(elements.taggerPopup.classList.contains('hidden')).toBe(false);
    hideTaggerPopup();
    expect(elements.taggerPopup.classList.contains('hidden')).toBe(true);
  });

  it('taggerPopup 엘리먼트가 없으면(방어적) 조용히 아무것도 하지 않는다', () => {
    const state = { confirmedLoserIds: ['p1'], participants: [{ id: 'p1', name: 'Alice' }] };
    const factory = new Function(
      'state', '$', 't', 'window',
      TAGGER_POPUP_SRC + '\n; return { showTaggerPopup, hideTaggerPopup };'
    );
    const mod = factory(state, () => null, (k) => k, {});
    expect(() => mod.showTaggerPopup()).not.toThrow();
    expect(() => mod.hideTaggerPopup()).not.toThrow();
  });
});

describe('Build30 Phase1 — 호출부 배선 계약(실제 런타임 동작 재현: 확정 gameOver에서만 팝업)', () => {
  it('finishRoundLocal의 3개 확정 gameOver 분기 전부(정확히 3곳으로 스코프 한정) showScreen("screenRoundResult") *이후* showTaggerPopup()을 호출한다', () => {
    // (1) 빈 슬롯 전원 안전 확정 gameOver, (2) 잔존 활성자 전원 강제 술래 확정 gameOver,
    // (3) roundLosers.length===remainingSlots 정상 gameOver — 3곳 모두 동일 순서로 배선되어야 한다.
    // MEDIUM 수정(codex-critic): html 전체에 대해 >=3으로만 검사하면 nextRound()의 이미-확정
    // gameOver 재진입 분기(별도 테스트로 이미 커버됨, 아래)까지 우연히 이 패턴에 매칭되어 총
    // 매칭 수가 4가 된다 — 그 결과 finishRoundLocal 내부 3곳 중 1곳이 실수로 삭제돼도(3곳 -> 2곳
    // + nextRound 1곳 = 3곳으로 여전히 >=3 통과) 이 테스트가 회귀를 잡아내지 못했다. finishRoundLocal
    // 함수 본문만으로 스코프를 좁혀 정확히 3곳을 요구한다. 주석 줄 수가 분기마다 달라(1~2줄)
    // showScreen과 showTaggerPopup 사이를 (?:[^\n]*\n)+? (1줄 이상)로 허용한다 — 이전 [^\n]*\n
    // (정확히 1줄)로는 분기 1(주석 2줄)을 놓쳐 실제로는 2곳만 매칭되는 latent 버그가 있었다.
    const finishRoundLocalSrc = extractBlock(
      'async function finishRoundLocal() {',
      'function finishRound() {'
    );
    const pattern = /renderRoundResult\("gameOver",[^)]*\);\s*\n\s*showScreen\("screenRoundResult"\);\s*\n(?:[^\n]*\n)+?\s*showTaggerPopup\(\);/g;
    const matches = finishRoundLocalSrc.match(pattern) || [];
    expect(matches.length).toBe(3);
  });

  it('idempotent 재렌더(중복 echo) 경로도 gameOver일 때만 showTaggerPopup()을 호출한다', () => {
    expect(html).toMatch(/if \(prev\.outcome === "gameOver"\) \{\s*\n\s*showScreen\("screenRoundResult"\);\s*\n[^\n]*\n\s*showTaggerPopup\(\);/);
  });

  it('nextRound()의 이미-확정된 gameOver 재진입 가드도 동일하게 표시한다', () => {
    expect(html).toMatch(/renderRoundResult\("gameOver", 0, 0\);\s*\n\s*showScreen\("screenRoundResult"\);\s*\n[^\n]*\n\s*showTaggerPopup\(\);/);
  });

  it('renderTentativeRoundResult(잠정 렌더)는 어떤 caseType이든 showTaggerPopup/hideTaggerPopup을 전혀 참조하지 않는다(잠정에서는 팝업 금지)', () => {
    const src = extractBlock('function renderTentativeRoundResult() {', 'async function finishRoundLocal() {');
    expect(src).not.toContain('showTaggerPopup');
    expect(src).not.toContain('hideTaggerPopup');
  });

  it('renderRoundResult(caseType별 draw/tooMany/tooFew 렌더 함수) 본문은 showTaggerPopup을 직접 호출하지 않는다(호출부에서만 gameOver 확정 시 명시적으로 호출)', () => {
    const src = extractBlock('function renderRoundResult(caseType, roundLoserCount, remainingSlots) {', '// 참가자 결과 목록');
    expect(src).not.toContain('showTaggerPopup');
  });

  it('showScreen(id)은 어떤 화면으로 전환하든 진입부에서 hideTaggerPopup()을 호출한다(다음 화면을 가리지 않도록)', () => {
    expect(html).toMatch(/function showScreen\(id\) \{\s*\n\s*hideAllScreens\(\);\s*\n(?:[^\n]*\n)*?\s*hideTaggerPopup\(\);\s*\n\s*const screen = \$\(id\);/);
  });

  it('returnToLobbyAfterGame()(호스트 한번더 클릭)은 role 가드보다 먼저 hideTaggerPopup()을 호출한다(클릭 즉시 제거)', () => {
    expect(html).toMatch(/async function returnToLobbyAfterGame\(\) \{\s*\n(?:[^\n]*\n)*?\s*hideTaggerPopup\(\);\s*\n\s*if \(state\.role !== "host"\) return;/);
  });
});

describe('Build30 Phase1 — saveLastCompletedGameResult에 isTagger 필드 추가(게임기록 술래 저장)', () => {
  it('오프라인(로컬 state)에서 confirmedLoserIds에 속한 참가자만 isTagger:true로 저장한다', async () => {
    const state = {
      roomCode: 'ROOM1',
      gameRound: 2,
      round: 1,
      confirmedLoserIds: ['p2'],
      participants: [
        { id: 'p1', name: 'Alice', is_host: true, wins: 2, losses: 0, draws: 0, penalties: 0 },
        { id: 'p2', name: 'Bob', is_host: false, wins: 0, losses: 2, draws: 0, penalties: 2 },
      ],
    };
    const { saveLastCompletedGameResult, store } = loadSaveLastCompletedGameResult({
      state, db: null, getOnlineModeImpl: () => false,
    });
    const ok = await saveLastCompletedGameResult('ROOM1');
    expect(ok).toBe(true);
    const saved = JSON.parse(store.get('rpsLastCompletedGame'));
    const byId = Object.fromEntries(saved.totals.map(p => [p.id, p]));
    expect(byId.p1.isTagger).toBe(false);
    expect(byId.p2.isTagger).toBe(true);
  });

  it('온라인(DB 권위 데이터)로 재조회해도 client state.confirmedLoserIds를 기준으로 isTagger를 부착한다', async () => {
    const state = {
      roomCode: 'ROOM2',
      gameRound: 1,
      round: 3,
      confirmedLoserIds: ['dbP2'],
      participants: [], // 로컬 참가자 없음(재연결 시나리오) — DB 재조회 결과로 대체됨
    };
    const dbRows = [
      { id: 'dbP1', name: 'Host', is_host: true, wins: 3, losses: 0, draws: 0, penalties: 0 },
      { id: 'dbP2', name: 'Guest', is_host: false, wins: 0, losses: 3, draws: 0, penalties: 3 },
    ];
    const db = {
      from: () => ({ select: () => ({ eq: () => Promise.resolve({ data: dbRows }) }) }),
    };
    const { saveLastCompletedGameResult, store } = loadSaveLastCompletedGameResult({
      state, db, getOnlineModeImpl: () => true,
    });
    const ok = await saveLastCompletedGameResult('ROOM2');
    expect(ok).toBe(true);
    const saved = JSON.parse(store.get('rpsLastCompletedGame'));
    const byId = Object.fromEntries(saved.totals.map(p => [p.id, p]));
    expect(byId.dbP1.isTagger).toBe(false);
    expect(byId.dbP2.isTagger).toBe(true);
  });

  it('기존 필드(wins/losses/draws/penalties/is_host)와 중복 집계 방지 필터는 그대로 유지된다(술래 필드만 추가)', async () => {
    const state = {
      roomCode: 'ROOM3',
      gameRound: 1,
      round: 1,
      confirmedLoserIds: ['p1'],
      participants: [
        { id: 'p1', name: 'Alice', is_host: true, wins: 0, losses: 1, draws: 0, penalties: 1 },
        { id: 'p2', name: 'NoActivity', is_host: false, wins: 0, losses: 0, draws: 0, penalties: 0 }, // 필터로 제외돼야 함
      ],
    };
    const { saveLastCompletedGameResult, store } = loadSaveLastCompletedGameResult({
      state, db: null, getOnlineModeImpl: () => false,
    });
    await saveLastCompletedGameResult('ROOM3');
    const saved = JSON.parse(store.get('rpsLastCompletedGame'));
    expect(saved.totals.map(p => p.id)).toEqual(['p1']); // 활동 없는 p2는 여전히 제외
    expect(saved.totals[0]).toMatchObject({ wins: 0, losses: 1, draws: 0, penalties: 1, is_host: true, isTagger: true });
  });
});

// Build30 HIGH(codex-critic 재현) — autoSave가 fire-and-forget(void)로 호출되므로, 아래 DB fetch가
// await 중일 때 사용자가 Home/한번더로 이동해 discardInProgressRoomSession/resetRoomLocalState/
// beginNewGameRound가 state.confirmedLoserIds를 비우면, 늦게 resolve된 select가 빈 confirmedLoserIds로
// isTagger를 계산해 술래 미기록이 재현되었다(검증자가 50ms fetch + 5ms 중간 clear로 isTagger:false
// 실제 재현). 수정: confirmedLoserIdSet 캡처를 함수 서두(DB fetch 이전)로 hoist해 호출 시점 값을
// 동기적으로 고정한다.
describe('Build30 HIGH 레이스 수정 — saveLastCompletedGameResult는 호출 시점에 confirmedLoserIds를 동기 캡처한다(hoist)', () => {
  it('DB fetch가 진행되는 동안(await) confirmedLoserIds가 비워져도 저장된 isTagger는 호출 시점 값을 유지한다(레이스 재현: 50ms fetch + 5ms 중간 clear)', async () => {
    const state = {
      roomCode: 'ROOMRACE',
      gameRound: 1,
      round: 1,
      confirmedLoserIds: ['p2'],
      participants: [],
    };
    const dbRows = [
      { id: 'p1', name: 'Alice', is_host: true, wins: 2, losses: 0, draws: 0, penalties: 0 },
      { id: 'p2', name: 'Bob', is_host: false, wins: 0, losses: 2, draws: 0, penalties: 2 },
    ];
    const db = {
      from: () => ({
        select: () => ({
          eq: () => new Promise((resolve) => setTimeout(() => resolve({ data: dbRows }), 50)),
        }),
      }),
    };
    const { saveLastCompletedGameResult, store } = loadSaveLastCompletedGameResult({
      state, db, getOnlineModeImpl: () => true,
    });
    const savePromise = saveLastCompletedGameResult('ROOMRACE');
    // fetch가 아직 진행 중(50ms 중 5ms 시점)일 때 사용자가 Home/한번더로 이동한 상황을 재현:
    // discardInProgressRoomSession/resetRoomLocalState/beginNewGameRound가 confirmedLoserIds를 비운다.
    setTimeout(() => { state.confirmedLoserIds = []; }, 5);
    const ok = await savePromise;
    expect(ok).toBe(true);
    const saved = JSON.parse(store.get('rpsLastCompletedGame'));
    const byId = Object.fromEntries(saved.totals.map(p => [p.id, p]));
    // hoist 이전(회귀) 코드라면 fetch 완료 시점엔 confirmedLoserIds가 이미 비어 있어 false가 된다.
    expect(byId.p2.isTagger).toBe(true);
    expect(byId.p1.isTagger).toBe(false);
  });
});

describe('Build30 Phase1 — renderStats에 술래 배지 표시(게임기록화면)', () => {
  it('isTagger:true인 행에만 술래 태그가 이름 뒤에 붙는다', () => {
    const state = { roomCode: 'ROOM1' };
    const data = {
      totals: [
        { id: 'p1', name: 'Alice', is_host: false, wins: 0, losses: 1, draws: 0, penalties: 1, isTagger: true },
        { id: 'p2', name: 'Bob', is_host: false, wins: 1, losses: 0, draws: 0, penalties: 0, isTagger: false },
      ],
    };
    const { renderStats, rows } = loadRenderStats({
      state, dataProvider: () => data,
      tImpl: (key) => (key === 'stats.taggerTag' ? '🎯 술래' : key),
    });
    renderStats();
    const aliceRow = rows.find(tr => tr.innerHTML.includes('Alice'));
    const bobRow = rows.find(tr => tr.innerHTML.includes('Bob'));
    expect(aliceRow.innerHTML).toContain('🎯 술래');
    expect(bobRow.innerHTML).not.toContain('🎯 술래');
  });

  it('isTagger 필드가 아예 없는(구 데이터/누적 집계) 행은 배지 없이 기존과 동일하게 렌더된다(회귀 없음)', () => {
    const state = { roomCode: 'ROOM1' };
    const data = { totals: [{ id: 'p1', name: 'Alice', is_host: false, wins: 1, losses: 0, draws: 0, penalties: 0 }] };
    const { renderStats, rows } = loadRenderStats({ state, dataProvider: () => data });
    renderStats();
    expect(rows[0].innerHTML).not.toContain('stats.taggerTag');
    expect(rows[0].innerHTML).not.toContain('tag lose');
  });

  it('기록이 없으면(빈 데이터) 기존과 동일하게 empty 메시지를 표시한다(회귀 없음)', () => {
    const state = { roomCode: 'ROOM1' };
    const { renderStats, tbody } = loadRenderStats({ state, dataProvider: () => null });
    renderStats();
    expect(tbody.innerHTML).toContain('stats.empty');
  });
});

// Build30 Phase2(CEO 확정) — codex-critic VERDICT-P1 CRITICAL 재수정: 정상 gameOver 완주 후
// "게임 승률 보기"(showStatsPopup) 팝업에 이번 게임 확정 술래를 명확히 표시한다. buildRoomStatsSummary
// (방 누적 통계)에는 술래 필드가 없으므로 state.confirmedLoserIds로 별도 판정한다.
describe('Build30 Phase2 — showStatsPopup에 "이번 게임" 확정 술래 표시(게임 승률 팝업)', () => {
  it('confirmedLoserIds가 있으면 상단 요약 줄을 채우고 hidden을 해제하며, 해당 참가자 행에만 술래 배지를 붙인다', () => {
    const state = {
      roomCode: 'ROOM1',
      confirmedLoserIds: ['p2'],
      participants: [
        { id: 'p1', name: 'Alice' },
        { id: 'p2', name: 'Bob' },
      ],
    };
    const summary = {
      totals: [
        { id: 'p1', name: 'Alice', is_host: true, wins: 2, losses: 0, draws: 0 },
        { id: 'p2', name: 'Bob', is_host: false, wins: 0, losses: 2, draws: 0 },
      ],
    };
    const tImpl = (key, vars) => {
      if (key === 'popup.statsCurrentTagger') return `이번 게임 술래: ${vars.names}`;
      if (key === 'stats.taggerTag') return '🎯 술래';
      return key;
    };
    const { showStatsPopup, elements, rows } = loadShowStatsPopup({
      state, buildRoomStatsSummaryImpl: () => summary, tImpl,
    });
    expect(elements.statsPopupTaggerLine.classList.contains('hidden')).toBe(true); // 초기 hidden
    showStatsPopup();
    expect(elements.statsPopupTaggerLine.classList.contains('hidden')).toBe(false);
    expect(elements.statsPopupTaggerLine.textContent).toBe('이번 게임 술래: Bob');
    const aliceRow = rows.find(tr => tr.innerHTML.includes('Alice'));
    const bobRow = rows.find(tr => tr.innerHTML.includes('Bob'));
    expect(bobRow.innerHTML).toContain('🎯 술래');
    expect(aliceRow.innerHTML).not.toContain('🎯 술래');
    expect(elements.statsPopup.classList.contains('hidden')).toBe(false);
  });

  it('confirmedLoserIds가 비어있으면(팝업이 gameOver 이외 맥락에서 열린 경우 방어적) 술래 줄을 숨기고 어떤 행에도 배지를 붙이지 않는다', () => {
    const state = {
      roomCode: 'ROOM1',
      confirmedLoserIds: [],
      participants: [{ id: 'p1', name: 'Alice' }],
    };
    const summary = { totals: [{ id: 'p1', name: 'Alice', is_host: false, wins: 1, losses: 0, draws: 0 }] };
    const { showStatsPopup, elements, rows } = loadShowStatsPopup({
      state, buildRoomStatsSummaryImpl: () => summary,
    });
    showStatsPopup();
    expect(elements.statsPopupTaggerLine.classList.contains('hidden')).toBe(true);
    expect(elements.statsPopupTaggerLine.textContent).toBe('');
    expect(rows[0].innerHTML).not.toContain('tag lose');
  });

  it('기록이 없으면(빈 집계) 기존과 동일하게 empty 메시지를 표시한다(회귀 없음)', () => {
    const state = { roomCode: 'ROOM1', confirmedLoserIds: [], participants: [] };
    const { showStatsPopup, tbody } = loadShowStatsPopup({
      state, buildRoomStatsSummaryImpl: () => ({ totals: [] }),
    });
    showStatsPopup();
    expect(tbody.innerHTML).toContain('stats.empty');
  });

  it('statsPopupTaggerLine 엘리먼트가 없어도(방어적) throw하지 않는다', () => {
    const state = { roomCode: 'ROOM1', confirmedLoserIds: ['p1'], participants: [{ id: 'p1', name: 'Alice' }] };
    const { showStatsPopup, elements } = loadShowStatsPopup({
      state, buildRoomStatsSummaryImpl: () => ({ totals: [{ id: 'p1', name: 'Alice', is_host: false, wins: 0, losses: 1, draws: 0 }] }),
    });
    delete elements.statsPopupTaggerLine;
    expect(() => showStatsPopup()).not.toThrow();
  });
});

// Build30 Phase2(CEO 확정) — gameOver 확정 시점(discardInProgressRoomSession/goHome보다 훨씬 이전,
// confirmedLoserIds가 아직 살아있는 시점)에 이번 게임 결과(술래 포함)를 자동 저장한다.
describe('Build30 Phase2 — gameOver 확정 시 자동 저장(autoSaveGameOverResultOnce)', () => {
  it('finishRoundLocal의 3개 직접 확정 gameOver 분기 전부 showTaggerPopup() 직후 autoSaveGameOverResultOnce()를 호출한다(정확히 3곳)', () => {
    const pattern = /showTaggerPopup\(\);\s*\n(?:[^\n]*\n)?\s*autoSaveGameOverResultOnce\(\);/g;
    const matches = FINISH_ROUND_LOCAL_SRC.match(pattern) || [];
    expect(matches.length).toBe(3);
  });

  it('idempotent 재렌더(TAGGER_REPLAY_IDEMPOTENT) 분기는 autoSaveGameOverResultOnce()를 호출하지 않는다(이미 저장된 게임의 재표시일 뿐, 새 확정 아님)', () => {
    const idempotentBranch = html.slice(
      html.indexOf('if (prev.outcome === "gameOver") {'),
      html.indexOf('} else {', html.indexOf('if (prev.outcome === "gameOver") {'))
    );
    expect(idempotentBranch).toContain('showTaggerPopup();');
    expect(idempotentBranch).not.toContain('autoSaveGameOverResultOnce');
  });

  it('nextRound()의 이미-확정 gameOver 재진입 가드는 autoSaveGameOverResultOnce()를 호출하지 않는다(새 확정 아님)', () => {
    const nextRoundSrc = extractBlock('async function nextRound() {', 'async function endGame() {');
    expect(nextRoundSrc).toContain('showTaggerPopup();');
    expect(nextRoundSrc).not.toContain('autoSaveGameOverResultOnce');
  });

  it('같은 게임(회차)에서 여러 번 호출돼도 saveLastCompletedGameResult는 1회만 실행된다(게임당 1회 가드)', () => {
    const state = { roomCode: 'ROOM1', gameRound: 3, autoSavedGameResultKey: null };
    let callCount = 0;
    const saveLastCompletedGameResultImpl = (roomCode) => { callCount++; return Promise.resolve(true); };
    const autoSaveGameOverResultOnce = loadAutoSaveGameOverResultOnce({ state, saveLastCompletedGameResultImpl });
    autoSaveGameOverResultOnce();
    autoSaveGameOverResultOnce();
    autoSaveGameOverResultOnce();
    expect(callCount).toBe(1);
  });

  it('gameRound가 바뀌면(새 게임) 다시 1회 저장을 허용한다(게임당 1회이지 영구 1회가 아님)', () => {
    const state = { roomCode: 'ROOM1', gameRound: 1, autoSavedGameResultKey: null };
    let callCount = 0;
    const saveLastCompletedGameResultImpl = () => { callCount++; return Promise.resolve(true); };
    const autoSaveGameOverResultOnce = loadAutoSaveGameOverResultOnce({ state, saveLastCompletedGameResultImpl });
    autoSaveGameOverResultOnce();
    state.gameRound = 2; // 다음 게임 회차
    autoSaveGameOverResultOnce();
    expect(callCount).toBe(2);
  });

  it('roomCode로 saveLastCompletedGameResult를 호출한다(자동 저장 대상 방 명시)', () => {
    const state = { roomCode: 'ROOM42', gameRound: 1, autoSavedGameResultKey: null };
    let capturedRoomCode = null;
    const saveLastCompletedGameResultImpl = (roomCode) => { capturedRoomCode = roomCode; return Promise.resolve(true); };
    const autoSaveGameOverResultOnce = loadAutoSaveGameOverResultOnce({ state, saveLastCompletedGameResultImpl });
    autoSaveGameOverResultOnce();
    expect(capturedRoomCode).toBe('ROOM42');
  });
});
