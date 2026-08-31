// Build43 EARLY LOCK — 승인 계약(IMPLEMENTATION LOCK)의 결정적 RED 매트릭스 + 소스 계약.
//
// 핵심: qualification(2/3회)=확정 후보(active 유지), earlyLock(3/5회)=즉시 확정+다음 판부터 제외.
// 종료 = distinct(locked ∪ qualified) ≥ targetTaggerCount, 그 순간 host 만 matchFinalTaggerIds(정확히
// target 명, locked 우선 → qualified 순서, 동판 동률은 stable id 순) 확정. active pool = participants − locked.
// 판당 엔진 target(비단판) = locked.length + 1 (기존 confirmed-loser 제외 경로 재사용, 제2 메커니즘 금지).
// 한번더 = 새 매치(matchNo+1, 원장 전체 리셋, 방 설정 유지).
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
// 판 진행 시뮬레이터: 각 판의 "새 술래" 1명(비단판)씩 적용 — locked 는 절대 다시 지지 않는다(계약 4·11).
function playGames({ rule, target, participants, games }) {
  const M = fns();
  let tally = {}, lockedIds = [], qualifiedIds = [], final = null, completions = 0;
  for (const losers of games) {
    const newLosers = [].concat(losers);
    for (const id of newLosers) expect(lockedIds, `locked ${id} 가 다시 술래가 됨`).not.toContain(id);
    tally = M.applyMatchGameResult(tally, newLosers);
    const d = M.computeMatchDecision({ rule, tally, lockedIds, qualifiedIds, targetTaggerCount: target, participantsCount: participants });
    lockedIds = d.lockedIds; qualifiedIds = d.qualifiedIds;
    if (d.complete) { completions++; final = d.finalTaggerIds; break; }
  }
  return { tally, lockedIds, qualifiedIds, final, completions };
}

describe('EARLY LOCK — 결정적 매트릭스 (§20)', () => {
  it('[1·2] qualification 도달자는 active 유지 → 이후 EARLY LOCK 도달 가능 (삼세판·술래2)', () => {
    const M = fns();
    let tally = { a: 2, b: 1, c: 1 };
    let d = M.computeMatchDecision({ rule: 'best3', tally, lockedIds: [], qualifiedIds: [], targetTaggerCount: 2, participantsCount: 4 });
    expect(d.qualifiedIds).toEqual(['a']);           // 후보
    expect(d.lockedIds).toEqual([]);                 // 아직 제외 아님(§0-1)
    expect(d.complete).toBe(false);
    tally = M.applyMatchGameResult(tally, ['a']);    // a 가 3회째
    d = M.computeMatchDecision({ rule: 'best3', tally, lockedIds: d.lockedIds, qualifiedIds: d.qualifiedIds, targetTaggerCount: 2, participantsCount: 4 });
    expect(d.lockedIds).toEqual(['a']);              // EARLY LOCK
    expect(d.complete).toBe(false);
  });
  it('[§5] 삼세판·술래2: A=3 lock → B/C/D 계속 → B=2 → final=[A,B] 정확히 2명, 종료 1회', () => {
    const r = playGames({ rule: 'best3', target: 2, participants: 4, games: ['a','a','a','b','c','b'] });
    expect(r.lockedIds).toEqual(['a']); expect(r.final).toEqual(['a','b']); expect(r.completions).toBe(1);
  });
  it('[§10] 삼세판·술래3: A lock → B=2 → D=2 → final=[A,B,D] 종료', () => {
    const r = playGames({ rule: 'best3', target: 3, participants: 5, games: ['a','a','a','b','c','b','d','d'] });
    expect(r.lockedIds).toEqual(['a']); expect(r.final).toEqual(['a','b','d']);
  });
  it('[§6] 다섯판·술래2: A=5 lock(자격 3회 이후에도 active 였음) → B=3 → final=[A,B]', () => {
    const r = playGames({ rule: 'best5', target: 2, participants: 4, games: ['a','a','a','a','a','b','b','b'] });
    expect(r.lockedIds).toEqual(['a']); expect(r.final).toEqual(['a','b']);
  });
  it('[§20] 다섯판·술래3: A=5 lock → B=3 → D=3 → final=[A,B,D]', () => {
    const r = playGames({ rule: 'best5', target: 3, participants: 5, games: ['a','a','a','a','a','b','b','b','d','d','d'] });
    expect(r.final).toEqual(['a','b','d']);
  });
  it('[§8] 필요한 인원이 일반 기준을 먼저 충족하면 EARLY LOCK 없이 즉시 종료', () => {
    const r = playGames({ rule: 'best3', target: 2, participants: 4, games: ['a','b','a'] });
    expect(r.final).toBeNull(); // a=2 qualified 만으로는 미종료(target 2)
    const r2 = playGames({ rule: 'best3', target: 2, participants: 4, games: ['a','b','a','b'] });
    expect(r2.lockedIds).toEqual([]); expect(r2.final && r2.final.sort()).toEqual(['a','b']);
  });
  it('[5·7] overshoot: 동판 동시 자격(비상 전원확정)도 final 은 정확히 target 명, stable id 순 tie-break', () => {
    const M = fns();
    // a lock(2 자리 중 1) + 같은 판에서 b,c 가 동시에 2회 도달(비상 전원 확정) → 남은 1자리는 id 순으로 b
    let tally = { a: 3, b: 1, c: 1 };
    tally = M.applyMatchGameResult(tally, ['c', 'b']); // 입력 순서와 무관해야 한다
    const d = M.computeMatchDecision({ rule: 'best3', tally, lockedIds: ['a'], qualifiedIds: [], targetTaggerCount: 2, participantsCount: 4 });
    expect(d.complete).toBe(true);
    expect(d.finalTaggerIds).toEqual(['a', 'b']); // locked 우선 + 동률은 id 정렬
    expect(d.finalTaggerIds.length).toBe(2);
  });
  it('[16] 단판: 판당 확정 = 기존 동작(첫 판 target 명 확정 즉시 종료)', () => {
    const M = fns();
    const d = M.computeMatchDecision({ rule: 'single', tally: { a: 1, b: 1 }, lockedIds: [], qualifiedIds: [], targetTaggerCount: 2, participantsCount: 4 });
    expect(d.complete).toBe(true); expect(d.finalTaggerIds.sort()).toEqual(['a', 'b']);
  });
  it('[22] 최소 인원: 이탈로 active(=참가자−locked) < 2 면 무한 루프 없이 강제 종료(가능한 확정자 전원)', () => {
    const M = fns();
    const d = M.computeMatchDecision({ rule: 'best3', tally: { a: 3, b: 1 }, lockedIds: ['a'], qualifiedIds: [], targetTaggerCount: 2, participantsCount: 2 });
    expect(d.complete).toBe(true); expect(d.insufficientPlayers).toBe(true); expect(d.finalTaggerIds).toEqual(['a']);
  });
  it('[12] 종료 이후 재호출도 같은 final (추가 변이 없음, 멱등)', () => {
    const M = fns();
    const args = { rule: 'best3', tally: { a: 3, b: 2 }, lockedIds: ['a'], qualifiedIds: ['a', 'b'], targetTaggerCount: 2, participantsCount: 4 };
    const d1 = M.computeMatchDecision(args), d2 = M.computeMatchDecision(args);
    expect(d1.finalTaggerIds).toEqual(d2.finalTaggerIds); expect(d1.finalTaggerIds).toEqual(['a', 'b']);
  });
  it('임계값 테이블: qualification 1/2/3 · earlyLock 1/3/5', () => {
    const M = fns();
    expect([M.matchQualificationThreshold('single'), M.matchQualificationThreshold('best3'), M.matchQualificationThreshold('best5')]).toEqual([1, 2, 3]);
    expect([M.matchEarlyLockThreshold('single'), M.matchEarlyLockThreshold('best3'), M.matchEarlyLockThreshold('best5')]).toEqual([1, 3, 5]);
  });
});

describe('EARLY LOCK — 소스 계약', () => {
  it('[3·판당 target] getTargetLoserCount = 비단판이면 locked+1(판당 신규 1명), 설정 원본은 getConfiguredTaggerCount 로 분리', () => {
    expect(html).toContain('function getConfiguredTaggerCount()');
    const s = html.indexOf('function getTargetLoserCount()'); const body = html.slice(s, s + 700);
    expect(body).toContain('getMatchLockedIds'); expect(body).toMatch(/\+\s*1/);
    // 설정 동기화/클램프/표시 지점은 원본 설정을 쓴다(판당 유효값으로 설정이 오염되지 않는다)
    // typeof 폴백 포함 형태(레거시 샌드박스 단독 추출 대비) — 실경로는 getConfiguredTaggerCount.
    expect(html).toContain('state.targetLoserCount = (typeof getConfiguredTaggerCount === "function") ? getConfiguredTaggerCount() : getTargetLoserCount();');
  });
  it('[3] 판 시작 시드: beginNewGameRound 가 confirmedLoserIds 를 matchLockedIds 로 시드하고 locked 행에 __loser__ 마커를 쓴다', () => {
    const s = html.indexOf('async function beginNewGameRound'); const body = html.slice(s, s + 9000);
    expect(body).toContain('getMatchLockedIds'); expect(body).toContain("'__loser__'");
  });
  it('[4] tally 델타: hostComposeMatchUpdate 가 시드된 locked 를 다시 세지 않는다', () => {
    const s = html.indexOf('function hostComposeMatchUpdate'); const body = html.slice(s, s + 3000);
    expect(body).toContain("filter(id => id && !lockedPrev.includes(id))"); // 시드 locked 제외 델타
    expect(body).toContain('computeMatchDecision');
    expect(body).toContain('matchTalliedGameNo');
  });
  it('[envelope] matchNo/matchLockedIds/matchFinalTaggerIds/matchQualifiedIds 관용 파싱 + matchNo 신원 가드', () => {
    for (const k of ['matchNo: toPositiveInt(', 'matchLockedIds: Array.isArray(', 'matchFinalTaggerIds: Array.isArray(', 'matchQualifiedIds: Array.isArray(']) expect(html, k).toContain(k);
    expect(html).toContain('function getMatchEnvelope()');
    const s = html.indexOf('function getMatchEnvelope()'); const body = html.slice(s, s + 1200);
    expect(body).toMatch(/stale/);
  });
  it('[16·21] 참가자는 독립 판정하지 않는다: getMatchState 는 envelope 의 matchFinalTaggerIds 만 읽는다', () => {
    const s = html.indexOf('function getMatchState()'); const body = html.slice(s, html.indexOf('function isMatchComplete()'));
    expect(body).toContain('matchFinalTaggerIds');
    expect(body).not.toContain('computeMatchDecision');
  });
  it('[한번더] 매치 종료 후 한번더 = 새 매치: matchNo+1 + 원장 리셋(설정 유지), canShowPlayAgainButton 은 매치 게이트 없이 원형', () => {
    expect(html).toMatch(/function canShowPlayAgainButton\(\) \{[^}]*return state\.role === "host" && isTaggerSelectionComplete\(\);/s);
    const s = html.indexOf('async function beginNewGameRound'); const body = html.slice(s, s + 9000);
    expect(body).toContain('matchReset');
    const b = html.indexOf('function buildPenaltyValue'); const bb = html.slice(b, b + 4000);
    expect(bb).toContain('matchReset'); expect(bb).toMatch(/matchNo/);
  });
});
