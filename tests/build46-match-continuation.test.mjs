// Build46 — 매치 연속 진행 계약 (Vincent IMPLEMENTATION APPROVED 2026-09-01)
//
// 핵심 규칙: 호스트는 매치 시작을 1회만 누른다. 이후 판(GAME)들은 술래 확정 조건 충족까지
// 자동 진행 — 판 사이 호스트 재시작/대기실 왕복 금지. 미완료 판의 gameOver 는 최종형 UI
// (승리 확정·최종술래 팝업·벌칙·한번더) 금지, 이번 판 승/패·누적 패배·자동 진행 안내만.
// 전환 권위 = host 단일 + 기존 phaseScheduledAt/phaseKind 동기 기제 재사용(제2 권위 금지).
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const html = readFileSync(join(ROOT, 'index.html'), 'utf8');

function fns() {
  const s = html.indexOf('// ── Build43 게임룰(매치) 순수 함수 시작');
  const e = html.indexOf('// ── Build43 게임룰(매치) 순수 함수 끝');
  return new Function(html.slice(s, e) +
    '\nreturn { normalizeMatchRule, matchQualificationThreshold, applyMatchGameResult, computeMatchDecision };')();
}
const sliceFn = (name) => {
  const s = html.indexOf(`function ${name}`);
  if (s < 0) throw new Error(`function ${name} not found`);
  const e = html.indexOf('\n\t    function ', s + 10);
  const e2 = html.indexOf('\n    function ', s + 10);
  const end = Math.min(...[e, e2].filter(x => x > 0));
  return html.slice(s, end);
};

// ── [A] 판정 시나리오: 미완료 판은 최종 없음, 임계 도달 순간 정확히 1회 완료 ──────────
describe('Build46 §TEST 1-3 — 자동 연속 판정 시나리오', () => {
  function playMatch(rule, target, participants, gameLosers) {
    const M = fns();
    let tally = {}, lockedIds = [], qualifiedIds = [];
    const timeline = [];
    for (const losers of gameLosers) {
      tally = M.applyMatchGameResult(tally, losers.filter(id => !lockedIds.includes(id)));
      const d = M.computeMatchDecision({ rule, tally, lockedIds, qualifiedIds, targetTaggerCount: target, participantsCount: participants });
      lockedIds = d.lockedIds; qualifiedIds = d.qualifiedIds;
      timeline.push({ complete: d.complete, final: d.finalTaggerIds.slice(), locked: d.lockedIds.slice() });
    }
    return timeline;
  }
  it('[1] BEST3·3인·술래1: 판1 미완료(최종 없음) → 판2에서 2패 도달 → MATCH_FINAL 정확히 1회', () => {
    const tl = playMatch('best3', 1, 3, [['a'], ['a']]);
    expect(tl[0]).toMatchObject({ complete: false, final: [] });    // 판1: 최종형 상태 금지
    expect(tl[1]).toMatchObject({ complete: true, final: ['a'] });  // 2패 도달 즉시
    expect(tl.filter(x => x.complete).length).toBe(1);
  });
  it('[2] BEST5·술래1: 1·2패에서는 확정 없음, 3패에서만', () => {
    const tl = playMatch('best5', 1, 3, [['b'], ['b'], ['b']]);
    expect(tl[0].complete).toBe(false); expect(tl[0].final).toEqual([]);
    expect(tl[1].complete).toBe(false); expect(tl[1].final).toEqual([]);
    expect(tl[2]).toMatchObject({ complete: true, final: ['b'] });
  });
  it('[3] 술래2: 1번째 확정 후에도 매치 지속(locked만 증가), 2번째 확정 순간에만 종료', () => {
    const tl = playMatch('best3', 2, 4, [['a'], ['a'], ['b'], ['b']]);
    expect(tl[1]).toMatchObject({ complete: false, locked: ['a'], final: [] }); // a 확정돼도 계속
    expect(tl[2].complete).toBe(false);
    expect(tl[3]).toMatchObject({ complete: true, locked: ['a', 'b'], final: ['a', 'b'] });
  });
});

// ── [B] matchNeedsNextGame — 자동 진행 판단 술어 ─────────────────────────────
describe('Build46 — matchNeedsNextGame', () => {
  function load({ rule, complete }) {
    const src = sliceFn('matchNeedsNextGame');
    return new Function('getMatchRule', 'isMatchComplete', src + '\nreturn matchNeedsNextGame;')(
      () => rule, () => complete);
  }
  it('single 은 항상 false / best3 미완료 true / best3 완료 false', () => {
    expect(load({ rule: 'single', complete: false })()).toBe(false);
    expect(load({ rule: 'best3', complete: false })()).toBe(true);
    expect(load({ rule: 'best3', complete: true })()).toBe(false);
    expect(load({ rule: 'best5', complete: false })()).toBe(true);
  });
});

// ── [C] scheduleMatchAutoNextGame — host 단일 권위·기존 동기 기제 재사용 ─────────
describe('Build46 §TEST 5 — 자동 판 전환(호스트 재시작 불필요)', () => {
  const src = () => sliceFn('scheduleMatchAutoNextGame');
  it('존재 + host 전용 가드 + matchNeedsNextGame 사용', () => {
    const s = src();
    expect(s).toContain('state.role !== "host"');
    expect(s).toContain('matchNeedsNextGame()');
  });
  it('타이머 멱등(중복 echo 안전) + 콜백 재검증(status/gameRound/미완료)', () => {
    const s = src();
    expect(s).toContain('clearTimeout(state.matchNextGameTimer)');
    expect(s).toMatch(/"result"[\s\S]{0,40}"game_over"/);
    expect(s).toContain('getGameRound() !== forGame');
  });
  it('전환은 beginNewGameRound({ status: "ready" — 대기실(lobby) 왕복 금지', () => {
    const s = src();
    expect(s).toContain('beginNewGameRound({ status: "ready"');
    expect(s).not.toContain('"lobby"');
    expect(s).toContain('match_next_game');
  });
  it('gameOver 5개 사이트(정상 3 + idempotent/echo 2) 전부에서 예약된다', () => {
    expect(html.split('scheduleMatchAutoNextGame(').length - 1).toBeGreaterThanOrEqual(6); // 정의 1 + 호출 5
    // finishRoundLocal 3곳은 autoSaveGameOverResultOnce() 인접 계약(Build30) 유지를 위해
    // popup → autoSave → schedule 순서 — 근접(400자 이내) 예약이면 계약 충족.
    const rx = /showTaggerPopup\(\);[\s\S]{0,400}?scheduleMatchAutoNextGame\(\);/g;
    expect((html.match(rx) || []).length).toBeGreaterThanOrEqual(5);
  });
});

// ── [D] showTaggerPopup — 미완료 판 억제(§UI: 최종술래 팝업 금지) ────────────────
describe('Build46 §UI — 미완료 판의 최종형 팝업 금지', () => {
  function makeEl() { const c = new Set(['hidden']); return { classList: { add: (x) => c.add(x), remove: (x) => c.delete(x), contains: (x) => c.has(x) }, textContent: '', querySelector: () => null, appendChild() {} }; }
  function run({ rule, complete, finalIds = [] }) {
    const els = { taggerPopup: makeEl(), taggerPopupNames: makeEl(), taggerPopupMatchMsg: makeEl() };
    const fn = new Function('$', 't', 'state', 'getMatchState', 'getConfirmedTaggerNames', 'getPenaltyText', 'getMatchRule', 'isMatchComplete', 'document', 'window',
      sliceFn('showTaggerPopup') + '\nreturn showTaggerPopup;')(
      (id) => els[id] || null, (k) => k, { participants: [{ id: 'a', name: 'A' }], currentUserId: 'h', nickname: 'H' },
      () => ({ complete, finalTaggerIds: finalIds }), () => ['A'], () => '벌칙',
      () => rule, () => complete, { createElement: () => makeEl() }, {});
    fn();
    return els.taggerPopup.classList.contains('hidden');
  }
  it('best3 미완료 → 팝업 표시 안 함(hidden 유지)', () => {
    expect(run({ rule: 'best3', complete: false })).toBe(true);
  });
  it('best3 완료 → 최종 팝업 표시 / single 은 종전 동작(표시)', () => {
    expect(run({ rule: 'best3', complete: true, finalIds: ['a'] })).toBe(false);
    expect(run({ rule: 'single', complete: true, finalIds: ['a'] })).toBe(false);
  });
});

// ── [E] 한번더 게이트 — 매치 완료 시 "새 매치" 전용 ────────────────────────────
describe('Build46 §UI — 한번더는 매치 완료 후에만(새 매치)', () => {
  function canShow({ rule, complete }) {
    return new Function('state', 'isTaggerSelectionComplete', 'getMatchRule', 'isMatchComplete',
      sliceFn('canShowPlayAgainButton') + '\nreturn canShowPlayAgainButton;')(
      { role: 'host' }, () => true, () => rule, () => complete)();
  }
  it('best3 미완료 → false(자동 진행이므로 버튼 금지) / 완료 → true', () => {
    expect(canShow({ rule: 'best3', complete: false })).toBe(false);
    expect(canShow({ rule: 'best3', complete: true })).toBe(true);
  });
  it('single 은 게이트 우회(오프라인 단판 회귀 방지) — 종전 동작 유지', () => {
    expect(canShow({ rule: 'single', complete: false })).toBe(true);
  });
});

// ── [F] 결과 화면 미완료 분기 — 허용/금지 콘텐츠 ──────────────────────────────
describe('Build46 §UI — 미완료 판 결과 화면 계약', () => {
  const seg = () => { const s = html.indexOf('} else if (myResult === "lose" || iAmConfirmedLoser) {'); return html.slice(s - 2400, s + 3600); };
  it('gameOver 렌더에 midMatch 분기(matchNeedsNextGame)가 있다', () => {
    expect(seg()).toContain('matchNeedsNextGame');
  });
  it('미완료 판: 이번 판 승/패 + 누적 패배 + 자동 진행 안내 키 사용', () => {
    const s = seg();
    expect(s).toContain('result.titleGameLose');
    expect(s).toContain('result.msgGameLoseCumulative');
    expect(s).toContain('result.titleGameWin');
    expect(s).toContain('result.midMatchNotice');
  });
  it('미완료 판: 벌칙 박스·터미널 버튼(한번더/승률/나가기 행) 미노출', () => {
    const s = html.slice(html.indexOf('function renderRoundResult'), html.indexOf('function renderRoundResult') + 26000);
    expect(s).toMatch(/midMatch[\s\S]{0,700}penaltyBox\.classList\.add\("hidden"\)/);
    expect(s).toMatch(/if \(!__midMatch\) \{[\s\S]{0,900}canShowPlayAgainButton\(\)/);
  });
  it('i18n 4키 × 3로케일', () => {
    for (const k of ['"result.titleGameWin"', '"result.titleGameLose"', '"result.msgGameLoseCumulative"', '"result.midMatchNotice"'])
      expect(html.split(k).length - 1, k).toBeGreaterThanOrEqual(3);
    expect(html).toContain('"result.midMatchNotice": "잠시 후 다음 판이 자동으로 시작됩니다."');
  });
});

// ── [G/H] 시드·동기 전환·재접속 — 기존 기제 재사용 핀(제2 권위 금지) ─────────────
describe('Build46 §TEST 4/6 — WAITING 비차단·locked 시드·동기 전환 재사용', () => {
  it('beginNewGameRound: ready 전환은 기존 phaseScheduledAt/phaseKind="ready" 동기 기제 사용', () => {
    const s = sliceFn('beginNewGameRound').slice(0, 4000);
    expect(s).toContain('status === "ready" ? getNextPhaseScheduledAt() : 0');
    expect(s).toContain('seededLockedIds');
  });
  it('참가자 재접속/수신 경로는 phaseKind==="ready" 스케줄을 소비한다(기존 기제)', () => {
    expect(html).toContain('phaseKind === "ready"');
    expect(html.split('getMatchLockedIds(').length - 1).toBeGreaterThanOrEqual(3);
  });
});

// ── Vincent 추가 지시(2026-09-01): 홈 → "바로전 게임결과" 화면의 "같은 방에서 다시하기" 메뉴 삭제 ──
describe('Build46 — 바로전 게임결과: 같은 방에서 다시하기 삭제', () => {
  it('screenStats 에 statsReplayBtn/inviteForReplay 버튼이 없다(처음으로만 유지)', () => {
    const s = html.indexOf('id="screenStats"');
    const seg = html.slice(s, html.indexOf('</section>', s));
    expect(seg).not.toContain('statsReplayBtn');
    expect(seg).not.toContain('inviteForReplay');
    expect(seg).toContain('common.home');
  });
});
