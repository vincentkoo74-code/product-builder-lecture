// Build45 게임룰 확정 모델(Vincent 확정 지시, 2026-08-31) — RED 먼저.
//
// 확정 규칙: 누적 패배(판 단위 술래 횟수)가 단판 1 / 삼세판 2 / 다섯판 3 에 **도달하는 즉시**
// 그 참가자는 "술래확정" — 개인 화면에 술래확정 렌더 + 이후 판에서 열외(대기). 먼저 도달한 순서대로
// 술래 슬롯을 채우며, 참가자가 많으면 술래 목표 숫자를 채울 때까지 판을 계속한다.
// 목표 인원 도달 순간: 전원 팝업 "최종술래 {닉네임}" + 승자 "축하합니다! 승리하셨습니다!" /
// 패자 "다음에 힘내세요!" + "벌칙 {…}". (종전 3/5회 별도 조기 잠금 규칙은 이 지시로 대체됨.)
// UI 1: 카드 좌상단 셀 = "삼세판 · 2판째" 한 줄(줄바꿈 금지). UI 2(2-A): 승/무/패 매치 누계 유지.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const html = readFileSync(join(ROOT, 'index.html'), 'utf8');

function fns() {
  const s = html.indexOf('// ── Build43 게임룰(매치) 순수 함수 시작');
  const e = html.indexOf('// ── Build43 게임룰(매치) 순수 함수 끝');
  expect(s, '순수 함수 블록').toBeGreaterThan(-1); expect(e).toBeGreaterThan(s);
  return new Function(html.slice(s, e) +
    '\nreturn { normalizeMatchRule, matchQualificationThreshold, matchEarlyLockThreshold, applyMatchGameResult, computeMatchDecision };')();
}
// 판 시뮬레이터: 확정(locked)된 참가자는 이후 판에서 절대 다시 술래가 되지 않는다(열외 계약).
function playGames({ rule, target, participants, games }) {
  const M = fns();
  let tally = {}, lockedIds = [], qualifiedIds = [], final = null, completions = 0; const lockLog = [];
  for (const losers of games) {
    const newLosers = [].concat(losers);
    for (const id of newLosers) expect(lockedIds, `열외된 ${id} 가 다시 술래가 됨`).not.toContain(id);
    tally = M.applyMatchGameResult(tally, newLosers);
    const d = M.computeMatchDecision({ rule, tally, lockedIds, qualifiedIds, targetTaggerCount: target, participantsCount: participants });
    for (const id of d.lockedIds) if (!lockedIds.includes(id)) lockLog.push(id);
    lockedIds = d.lockedIds; qualifiedIds = d.qualifiedIds;
    if (d.complete) { completions++; final = d.finalTaggerIds; break; }
  }
  return { tally, lockedIds, qualifiedIds, final, completions, lockLog };
}

describe('확정 모델 — 결정적 매트릭스 (도달 즉시 술래확정·열외)', () => {
  it('임계값: 확정(=잠금) 기준이 단판1/삼세판2/다섯판3 — 별도 3/5 조기 잠금 없음', () => {
    const M = fns();
    expect([M.matchQualificationThreshold('single'), M.matchQualificationThreshold('best3'), M.matchQualificationThreshold('best5')]).toEqual([1, 2, 3]);
    expect([M.matchEarlyLockThreshold('single'), M.matchEarlyLockThreshold('best3'), M.matchEarlyLockThreshold('best5')]).toEqual([1, 2, 3]);
  });
  it('삼세판·술래1: 3판 안에 먼저 2패 → 그 즉시 술래확정·종료', () => {
    const r = playGames({ rule: 'best3', target: 1, participants: 3, games: ['a', 'b', 'a'] });
    expect(r.lockedIds).toEqual(['a']); expect(r.final).toEqual(['a']); expect(r.completions).toBe(1);
  });
  it('삼세판·술래2: a 가 2패 도달 즉시 확정·열외 → 남은 인원끼리 계속 → b 2패 → [a,b] 종료', () => {
    const M = fns();
    let tally = M.applyMatchGameResult({}, ['a']); tally = M.applyMatchGameResult(tally, ['a']);
    let d = M.computeMatchDecision({ rule: 'best3', tally, lockedIds: [], qualifiedIds: [], targetTaggerCount: 2, participantsCount: 4 });
    expect(d.lockedIds, '2패 도달 즉시 확정(열외)').toEqual(['a']);
    expect(d.complete).toBe(false);
    const r = playGames({ rule: 'best3', target: 2, participants: 4, games: ['a', 'a', 'b', 'c', 'b'] });
    expect(r.lockLog).toEqual(['a', 'b']); expect(r.final).toEqual(['a', 'b']); expect(r.completions).toBe(1);
  });
  it('다섯판·술래2: 3패 도달 즉시 확정 → 다음 도달자로 종료', () => {
    const r = playGames({ rule: 'best5', target: 2, participants: 4, games: ['a','a','a','b','c','b','b'] });
    expect(r.lockLog).toEqual(['a', 'b']); expect(r.final).toEqual(['a', 'b']);
  });
  it('참가자 多·술래3: 목표 인원 충족까지 지속 — 도달 순서대로 [a,b,d]', () => {
    const r = playGames({ rule: 'best3', target: 3, participants: 5, games: ['a','a','b','b','c','d','d'] });
    expect(r.lockLog).toEqual(['a', 'b', 'd']); expect(r.final).toEqual(['a', 'b', 'd']);
  });
  it('동판 동시 도달(비상 전원확정): 남은 슬롯만 id 순으로 — final 정확히 target 명', () => {
    const M = fns();
    let tally = { a: 2, b: 1, c: 1 };
    tally = M.applyMatchGameResult(tally, ['c', 'b']);
    const d = M.computeMatchDecision({ rule: 'best3', tally, lockedIds: ['a'], qualifiedIds: ['a'], targetTaggerCount: 2, participantsCount: 4 });
    expect(d.complete).toBe(true); expect(d.finalTaggerIds).toEqual(['a', 'b']); expect(d.finalTaggerIds.length).toBe(2);
  });
  it('단판: 첫 판 확정 = 기존 동작(target 명 동시 확정·종료)', () => {
    const M = fns();
    const d = M.computeMatchDecision({ rule: 'single', tally: { a: 1, b: 1 }, lockedIds: [], qualifiedIds: [], targetTaggerCount: 2, participantsCount: 4 });
    expect(d.complete).toBe(true); expect(d.finalTaggerIds.sort()).toEqual(['a', 'b']);
  });
  it('최소 인원: 이탈로 active(참가자−확정) < 2 → 무한 루프 없이 확보 인원으로 안전 종료', () => {
    const M = fns();
    const d = M.computeMatchDecision({ rule: 'best3', tally: { a: 2, b: 1 }, lockedIds: ['a'], qualifiedIds: ['a'], targetTaggerCount: 2, participantsCount: 2 });
    expect(d.complete).toBe(true); expect(d.insufficientPlayers).toBe(true); expect(d.finalTaggerIds).toEqual(['a']);
  });
  it('종료 후 재호출 멱등(추가 변이 없음)', () => {
    const M = fns();
    const args = { rule: 'best3', tally: { a: 2, b: 2 }, lockedIds: ['a', 'b'], qualifiedIds: ['a', 'b'], targetTaggerCount: 2, participantsCount: 4 };
    const d1 = M.computeMatchDecision(args), d2 = M.computeMatchDecision(args);
    expect(d1.finalTaggerIds).toEqual(d2.finalTaggerIds); expect(d1.finalTaggerIds).toEqual(['a', 'b']);
  });
});

describe('B43 필드 결함(호스트 QR 미생성·게임룰 고정) — parsePenalty 레거시 fallback 회귀', () => {
  function extractParse() {
    const s = html.indexOf('function parsePenalty(raw) {');
    const e = html.indexOf('// ── Build40 P0-1: 권위 있는 재대결 안내', s);
    expect(s).toBeGreaterThan(-1); expect(e).toBeGreaterThan(s);
    const toPositiveInt = (v, d) => { const n = parseInt(v, 10); return Number.isFinite(n) && n > 0 ? n : d; };
    const parseContinuationEnvelope = () => null;
    return new Function('toPositiveInt', 'parseContinuationEnvelope', html.slice(s, e) + '\nreturn parsePenalty;')(toPositiveInt, parseContinuationEnvelope);
  }
  it('빈 문자열/레거시 벌칙 문자열도 매치 필드가 완전한 형태로 돌아온다', () => {
    const parsePenalty = extractParse();
    for (const raw of ['', '커피 사기', null, undefined]) {
      const r = parsePenalty(raw);
      expect(r.matchTally, `${String(raw)} matchTally`).toEqual({});
      expect(r.matchLockedIds, `${String(raw)} lockedIds`).toEqual([]);
      expect(r.matchFinalTaggerIds, `${String(raw)} finalIds`).toEqual([]);
      expect(r.matchNo, `${String(raw)} matchNo`).toBe(1);
    }
  });
  it('isMatchRuleEditable 은 matchTally 부재에도 던지지 않는다(방어 가드)', () => {
    const s = html.indexOf('function isMatchRuleEditable()'); const body = html.slice(s, s + 500);
    expect(body).toContain('.matchTally || {}');
  });
});

describe('소스 계약 — 판당 목표·시드·델타·envelope·한번더 (유지)', () => {
  it('판당 엔진 목표 = 비단판이면 확정자+1, 설정 원본은 getConfiguredTaggerCount', () => {
    expect(html).toContain('function getConfiguredTaggerCount()');
    const s = html.indexOf('function getTargetLoserCount()'); const body = html.slice(s, s + 700);
    expect(body).toContain('getMatchLockedIds'); expect(body).toMatch(/\+\s*1/);
  });
  it('판 시작 시드 + __loser__ 마커 (열외 = 기존 confirmed-loser 경로)', () => {
    const s = html.indexOf('async function beginNewGameRound'); const body = html.slice(s, s + 9000);
    expect(body).toContain('getMatchLockedIds'); expect(body).toContain("'__loser__'"); expect(body).toContain('matchReset');
  });
  it('델타 집계 + gameNo 원장 멱등', () => {
    const s = html.indexOf('function hostComposeMatchUpdate'); const body = html.slice(s, s + 3000);
    expect(body).toContain('filter(id => id && !lockedPrev.includes(id))');
    expect(body).toContain('computeMatchDecision'); expect(body).toContain('matchTalliedGameNo');
  });
  it('envelope 신원(matchNo)·권위 읽기(참가자 독립 판정 금지)', () => {
    for (const k of ['matchNo: toPositiveInt(', 'matchLockedIds: Array.isArray(', 'matchFinalTaggerIds: Array.isArray(']) expect(html, k).toContain(k);
    expect(html).toContain('function getMatchEnvelope()');
    const s = html.indexOf('function getMatchState()'); const body = html.slice(s, html.indexOf('function isMatchComplete()'));
    expect(body).toContain('matchFinalTaggerIds'); expect(body).not.toContain('computeMatchDecision');
  });
});

describe('UI 확정 지시 1·3 — 카드 셀·개인 술래확정·최종 팝업', () => {
  it('[1] 카드 좌상단 셀 = "게임룰 · N판째" (progress.round 대신), 한 줄 고정', () => {
    const s = html.indexOf('<div class="game-progress-round">');
    const cell = html.slice(s, s + 160);
    expect(cell).toContain('matchRuleLabel'); expect(cell).toContain('progress.matchGameNo');
    // §3 표: 단판은 룰 라벨("단판")만 — 비단판에서만 " · {n}판째" 를 붙이는 조건부여야 한다.
    expect(cell).toContain('info.matchRuleIsSingle ? ""');
    expect(html).toContain('matchRuleIsSingle: (((typeof getMatchRule === "function") ? getMatchRule() : "single") === "single")');
    expect(cell).not.toContain('progress.round"');
    // 한 줄 계약: 셀 nowrap + 상단 행 줄바꿈 금지
    expect(html).toMatch(/\.game-progress-round\{[^}]*white-space:nowrap/);
    expect(html).toMatch(/\.game-progress-top\{[^}]*flex-wrap:nowrap/);
    for (const k of ['"progress.matchGameNo"']) expect(html.split(k).length - 1, k).toBeGreaterThanOrEqual(3);
  });
  it('[3-개인] 임계 도달자의 판 결과 화면에 "술래확정" 렌더 + 열외 안내', () => {
    for (const k of ['"result.capTaggerLocked"', '"result.titleTaggerLocked"', '"result.msgTaggerLocked"']) expect(html.split(k).length - 1, k).toBeGreaterThanOrEqual(3);
    const s = html.indexOf('function renderRoundResult('); const body = html.slice(s, s + 26000);
    expect(body).toContain('result.titleTaggerLocked');
    expect(body).toMatch(/matchLockedIds|getMatchLockedIds/);
  });
  it('[3-팝업] 목표 인원 도달 시 전원 팝업: "최종술래 {닉네임}" + 승자/패자 문구 + 벌칙', () => {
    expect(html).toContain('id="taggerPopupMatchMsg"');
    const s = html.indexOf('function showTaggerPopup()'); const body = html.slice(s, s + 2500);
    expect(body).toContain('popup.matchFinalTitle'); expect(body).toContain('popup.matchFinalWin'); expect(body).toContain('popup.matchFinalLose'); expect(body).toContain('popup.matchFinalPenalty');
    // 확정 한국어 카피(지시 원문)
    expect(html).toContain('"popup.matchFinalTitle": "최종술래 {names}"');
    expect(html).toContain('"popup.matchFinalWin": "축하합니다! 승리하셨습니다!"');
    expect(html).toContain('"popup.matchFinalLose": "다음에 힘내세요!"');
    expect(html).toContain('"popup.matchFinalPenalty": "벌칙 {penalty}"');
    for (const k of ['"popup.matchFinalTitle"', '"popup.matchFinalWin"', '"popup.matchFinalLose"', '"popup.matchFinalPenalty"']) expect(html.split(k).length - 1, k).toBeGreaterThanOrEqual(3);
  });
  it('[2-B] 카드 전적은 매치 누계 경로(getMatchCumulativeStats)를 유지한다', () => {
    const s = html.indexOf('function getRoundProgressData'); const body = html.slice(s, html.indexOf('function renderRoundProgressCards'));
    expect(body).toContain('getMatchCumulativeStats');
  });
});

// ── Vincent 판정 렌더 지시(2026-09-01): 진행 중 게임 카드 전적은 "승/패만", 집계는 손내기별이 아니라
//    "판의 최종 결과만"(예: 3인·술래1 → 그 판 = 패1·승2). 삼세판/다섯판은 판별 최종 결과의 누적.
describe('판-최종 승/패 집계 (Vincent 2026-09-01)', () => {
  function loadHostCompose({ envelope, participants, target = 1 }) {
    const M = fns();
    const s0 = html.indexOf('function hostComposeMatchUpdate');
    const s1 = html.indexOf('\n\t    function ', s0 + 10);
    const src = html.slice(s0, s1);
    const state = { participants };
    const toPositiveInt = (v, f = 0) => { const n = parseInt(v, 10); return Number.isFinite(n) && n > 0 ? n : f; };
    const factory = new Function('state', 'getMatchEnvelope', 'getConfiguredTaggerCount', 'QA', 'qaRoundCtx', 'toPositiveInt', 'applyMatchGameResult', 'computeMatchDecision',
      src + '\nreturn hostComposeMatchUpdate;');
    return factory(state, () => envelope, () => target, { emit() {} }, undefined, toPositiveInt, M.applyMatchGameResult, M.computeMatchDecision);
  }
  const P = (id) => ({ id, name: id, wins: 5, draws: 2, losses: 3 }); // 손내기 카운터는 무시되어야 한다(정크 주입)
  const baseEnv = (over) => Object.assign({ stale: false, matchNo: 1, rule: 'best3', tally: {}, stats: {}, lockedIds: [], qualifiedIds: [], finalTaggerIds: [], talliedGameNo: 0, statsGameNo: 0 }, over);

  it('판1 확정 [a] → a=패1, h/b=승1 (손내기 wins/draws/losses 는 무시, d=0)', () => {
    const f = loadHostCompose({ envelope: baseEnv(), participants: [P('h'), P('a'), P('b')], target: 1 });
    const u = f({ mode: 'FINAL', gameNo: 1, confirmedLoserIds: ['a'] });
    expect(u.matchStats.a).toMatchObject({ w: 0, l: 1 });
    expect(u.matchStats.h).toMatchObject({ w: 1, l: 0 });
    expect(u.matchStats.b).toMatchObject({ w: 1, l: 0 });
    expect(Number(u.matchStats.a.d || 0)).toBe(0);
  });
  it('판2 확정 [h] → 누적: h=1승1패, a=1승1패, b=2승', () => {
    const prev = { a: { w: 0, d: 0, l: 1 }, h: { w: 1, d: 0, l: 0 }, b: { w: 1, d: 0, l: 0 } };
    const f = loadHostCompose({ envelope: baseEnv({ tally: { a: 1 }, stats: prev, talliedGameNo: 1 }), participants: [P('h'), P('a'), P('b')], target: 1 });
    const u = f({ mode: 'FINAL', gameNo: 2, confirmedLoserIds: ['h'] });
    expect(u.matchStats.h).toMatchObject({ w: 1, l: 1 });
    expect(u.matchStats.a).toMatchObject({ w: 1, l: 1 });
    expect(u.matchStats.b).toMatchObject({ w: 2, l: 0 });
  });
  it('확정(locked) 참가자의 전적은 동결 — 시드된 패자 마커는 승/패 어느 쪽도 늘리지 않는다', () => {
    const prev = { a: { w: 0, d: 0, l: 2 }, h: { w: 1, d: 0, l: 1 }, b: { w: 2, d: 0, l: 0 } };
    const f = loadHostCompose({ envelope: baseEnv({ tally: { a: 2, h: 1 }, stats: prev, lockedIds: ['a'], qualifiedIds: ['a'], talliedGameNo: 2 }), participants: [P('h'), P('a'), P('b')], target: 2 });
    const u = f({ mode: 'FINAL', gameNo: 3, confirmedLoserIds: ['a', 'h'] }); // a 는 시드 마커
    expect(u.matchStats.a).toMatchObject({ w: 0, l: 2 }); // 동결
    expect(u.matchStats.h).toMatchObject({ w: 1, l: 2 });
    expect(u.matchStats.b).toMatchObject({ w: 3, l: 0 });
  });
  it('[소스] 집계는 손내기 카운터 합산(p.wins/p.draws/p.losses)을 쓰지 않는다', () => {
    const s0 = html.indexOf('function hostComposeMatchUpdate');
    const seg = html.slice(s0, html.indexOf('\n\t    function ', s0 + 10));
    expect(seg).not.toContain('Number(p.wins || 0)');
    expect(seg).not.toContain('Number(p.draws || 0)');
  });
  it('[UI] 카드 전적은 승/패만 — 무 셀·붉은 술래칩 없음, 그리드 2열 (Vincent 2026-09-01 삭제 지시)', () => {
    const s = html.indexOf('<div class="game-progress-stats">');
    const seg = html.slice(s, html.indexOf('game-progress-lock', s));
    expect(seg).toContain('progress.safe');
    expect(seg).toContain('progress.loser');
    expect(seg).not.toContain('progress.draw');
    expect(seg).not.toContain('progress.targetLoserCount'); // 검정 카드 안 붉은 "술래 N명" 박스 삭제
    expect(seg).not.toContain('game-progress-stat loser');
    expect(html).toMatch(/\.game-progress-stats\{[^}]*grid-template-columns:repeat\(2,/);
    // 준비 화면 상단의 별도 술래 칩([data-tagger-chip])은 유지된다
    expect(html).toContain('data-tagger-chip');
  });
  it('[UI] 카드 전적은 판 완료 시에만 갱신 — 진행 중 손내기 live 카운터 미합산', () => {
    const s = html.indexOf('function getMatchCumulativeStats');
    const seg = html.slice(s, html.indexOf('\n\t    function ', s + 10));
    expect(seg).not.toContain('getPlayerRoundStats');
  });
});
