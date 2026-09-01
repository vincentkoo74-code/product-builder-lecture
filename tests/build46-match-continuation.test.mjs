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
  const ends = ['\n\t    function ', '\n    function ', '\n\t    async function ', '\n    async function ']
    .map(m => html.indexOf(m, s + 10)).filter(x => x > 0);
  return html.slice(s, Math.min(...ends));
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
  it('[NO-TOUCH] 전환 = playing+countdownStartAt 직행 — lobby/ready 왕복 금지', () => {
    const s = src();
    expect(s).toContain('beginNewGameRound({ status: "playing"');
    expect(s).not.toContain('"lobby"');
    expect(s).not.toContain('status: "ready"');
    expect(s).toContain('match_next_game');
    expect(s).toContain('enterPlayingStateFromRoomUpdate()'); // host 로컬 카운트다운 즉시 진입(startGame 동일 계열)
  });
  it('[NO-TOUCH] 준비 정족수·수동 입력이 경로에 없다 — 참가자 준비/호스트 재시작/강제시작 0회', () => {
    // 추출은 다음 함수의 선행 주석까지 포함하므로, 부정 단언은 함수 본문(첫 닫는 중괄호)으로 한정한다.
    const s = src().slice(0, src().indexOf('\n    }\n') + 6);
    expect(s).toContain('setTimeout');                   // 본문 슬라이스 자기검증
    expect(s).not.toContain('areAllActivePlayersReady'); // READY 정족수 비관여
    expect(s).not.toContain('is_ready');                 // 준비 플래그 대기 없음
    expect(s).not.toContain('orceStart');                // 강제 시작 비관여
    // beginNewGameRound(playing)는 countdownStartAt 을 서버시각으로 생성한다(동기 카운트다운)
    expect(sliceFn('beginNewGameRound').slice(0, 4000)).toContain('status === "playing" ? getNextCountdownStartAt() : 0');
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
  it('beginNewGameRound: 동기 전환 기제 2종(ready=phase 스케줄, playing=countdownStartAt) + locked 시드', () => {
    const s = sliceFn('beginNewGameRound').slice(0, 4000);
    expect(s).toContain('status === "ready" ? getNextPhaseScheduledAt() : 0');
    expect(s).toContain('status === "playing" ? getNextCountdownStartAt() : 0');
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

// ═══ STAGE 2 RECOVERY (승인 계약): GAME 종결 목표 ≠ MATCH 술래 목표 — 소급 오염 금지 ═══
describe('RECOVERY — 게임 종결 목표의 불변성(판 시작 시드 유도)', () => {
  function loadTargets({ participants, rule, configured }) {
    const src = sliceFn('getRequiredMatchTaggerCount') + '\n' + sliceFn('getGameResolutionTarget') + '\n' + sliceFn('getTargetLoserCount');
    return new Function('state', 'getMatchRule', 'getConfiguredTaggerCount',
      src + '\nreturn { getRequiredMatchTaggerCount, getGameResolutionTarget, getTargetLoserCount };')(
      { participants, targetLoserCount: configured }, () => rule, () => configured);
  }
  const P = (id, choice) => ({ id, name: id, choice });
  it('[불변] 게임 목표 = 시드(__loser__ 행) + 1 — envelope locked 성장과 무관', () => {
    // G2 시작: 시드 0 (아직 아무도 잠기지 않음) → 목표 1. 판정 후 locked 가 [B] 로 자라도
    // 시드 행은 판 중 불변이므로 목표는 1 그대로 — 에코 재평가가 판을 되살릴 수 없다.
    const t = loadTargets({ participants: [P('h', 'rock|win'), P('a', 'rock|win'), P('b', 'scissors|lose')], rule: 'best3', configured: 2 });
    expect(t.getGameResolutionTarget()).toBe(1);
    expect(t.getTargetLoserCount()).toBe(1);
    expect(t.getRequiredMatchTaggerCount()).toBe(2); // MATCH 목표는 별개(설정값)
  });
  it('[불변] 다음 판(시드 1)에서는 목표 2 — 시드 수만이 판 목표를 정한다', () => {
    const t = loadTargets({ participants: [P('h', null), P('a', null), P('b', '__loser__')], rule: 'best3', configured: 2 });
    expect(t.getGameResolutionTarget()).toBe(2);
  });
  it('[불변] 단판은 종전대로 설정값', () => {
    const t = loadTargets({ participants: [P('h', null), P('a', null)], rule: 'single', configured: 2 });
    expect(t.getGameResolutionTarget()).toBe(2);
  });
  it('[소스] getTargetLoserCount 는 더 이상 matchLockedIds 를 참조하지 않는다(오염원 제거)', () => {
    const s = sliceFn('getTargetLoserCount');
    expect(s).not.toContain('getMatchLockedIds');
  });
});

describe('RECOVERY — 원장 최종성 가드(집계된 판은 영구 종결)', () => {
  function loadTallied({ rule, talliedGameNo, gameRound }) {
    const src = sliceFn('isCurrentGameTallied');
    return new Function('getMatchRule', 'getMatchEnvelope', 'getGameRound', 'toPositiveInt',
      src + '\nreturn isCurrentGameTallied;')(
      () => rule, () => ({ stale: false, talliedGameNo }), () => gameRound,
      (v, f = 0) => { const n = parseInt(v, 10); return Number.isFinite(n) && n > 0 ? n : f; });
  }
  it('talliedGameNo === 현재 판 → true / 다른 판·단판 → false', () => {
    expect(loadTallied({ rule: 'best3', talliedGameNo: 2, gameRound: 2 })()).toBe(true);
    expect(loadTallied({ rule: 'best3', talliedGameNo: 1, gameRound: 2 })()).toBe(false);
    expect(loadTallied({ rule: 'single', talliedGameNo: 2, gameRound: 2 })()).toBe(false);
  });
  it('[소스] nextRound gameOver 가드에 최종성 단락이 있다', () => {
    expect(html).toMatch(/loserIds\.length >= getTargetLoserCount\(\) \|\| state\.status === "game_over" \|\| \(\(typeof isCurrentGameTallied === "function"\) && isCurrentGameTallied\(\)\)/);
  });
  it('[소스] scheduleRematchAutoAdvance 콜백도 집계된 판에서는 재대결을 열지 않는다', () => {
    const s = sliceFn('scheduleRematchAutoAdvance');
    expect(s).toContain('isCurrentGameTallied');
  });
});

describe('RECOVERY — §5 정본 재현(tagger=2, G2 에코): 판정 결정론', () => {
  it('G2 확정 직후 locked=[B] 로 자라도: 판은 종결 유지(목표 불변) + 매치는 미완료(계속)', () => {
    const M = fns();
    // G2 판정 완료 상태: 시드 0, confirmed=[b], tally b:2 → locked [b]
    const d = M.computeMatchDecision({ rule: 'best3', tally: { b: 2 }, lockedIds: [], qualifiedIds: [], targetTaggerCount: 2, participantsCount: 3 });
    expect(d.lockedIds).toEqual(['b']);
    expect(d.complete).toBe(false); // required 2 — 매치는 계속(G3), G2 재개는 불가(위 불변+가드)
    expect(d.finalTaggerIds).toEqual([]);
    // G3(시드 [b]) 이후 h 2패 도달 → 그때만 완료
    const d2 = M.computeMatchDecision({ rule: 'best3', tally: { b: 2, h: 2 }, lockedIds: ['b'], qualifiedIds: ['b'], targetTaggerCount: 2, participantsCount: 3 });
    expect(d2.complete).toBe(true);
    expect(d2.finalTaggerIds.sort()).toEqual(['b', 'h']);
  });
  it('[§8] best3/best5 × tagger1/2 매트릭스 — required 는 매치 길이만 바꾼다', () => {
    const M = fns();
    for (const [rule, th] of [['best3', 2], ['best5', 3]]) {
      for (const req of [1, 2]) {
        let tally = {}, locked = [], qualified = [];
        let completions = 0;
        const order = ['b', 'h'];
        for (let gi = 0; gi < th * req; gi++) {
          const loser = order[Math.floor(gi / th)];
          tally = M.applyMatchGameResult(tally, locked.includes(loser) ? [] : [loser]);
          const d = M.computeMatchDecision({ rule, tally, lockedIds: locked, qualifiedIds: qualified, targetTaggerCount: req, participantsCount: 3 });
          locked = d.lockedIds; qualified = d.qualifiedIds;
          if (d.complete) completions++;
        }
        expect(completions, rule + ' req' + req).toBe(1);
        expect(locked.length, rule + ' req' + req).toBe(req);
      }
    }
  });
});

// ═══ FIELD RACE #3 (2026-09-01): 선택창 publisher 의 stale penalty 가 FINAL 원장을 덮음 ═══
// 재현: run-alt.json G2 — publishChoiceWindowEnd 의 in-flight 쓰기가 FINAL(tally 병합·tGNo·continuation)
// 직후 착지 → DB·host 로컬 모두 pre-FINAL 구본으로 롤백 → 그 판 원장 증발 → 누적 불가·무한 매치(필드 증상).
describe('FIELD RACE #3 — playing-phase penalty writer 의 조건부 쓰기', () => {
  it('[소스] publishChoiceWindowEnd: status=playing 조건부 + 적용 행 확인 후에만 로컬 반영', () => {
    const s = sliceFn('publishChoiceWindowEnd');
    expect(s).toContain(".eq('status', 'playing')");
    expect(s).toContain(".select('id')");
    expect(s).toMatch(/__rows\.length[\s\S]{0,160}state\.penalty = penalty/);
    // 로컬 반영은 정확히 1곳(적용 확인 분기 안)만 — 무조건 반영 라인이 남아있으면 2곳 이상이 된다.
    expect(s.split('state.penalty = penalty;').length - 1).toBe(1);
  });
  it('[기능] 판이 이미 result 로 넘어간 뒤 도착한 publish 는 no-op — 로컬 penalty 미오염', async () => {
    const src = sliceFn('publishChoiceWindowEnd');
    function makeDb(rows) {
      return { from: () => ({ update: () => ({ eq: () => ({ eq: () => ({ select: async () => ({ data: rows, error: null }) }) }) }) }) };
    }
    async function run(rows) {
      const state = { role: 'host', roomCode: 'R', penalty: 'FINAL-ENVELOPE', round: 1 };
      const asyncSrc = src.startsWith('async') ? src : 'async ' + src; // sliceFn 이 async 접두를 잘라냄
      const fn = new Function('state', 'getOnlineMode', 'db', 'getCountdownStartAt', 'buildPenaltyValue', 'getGameRound', 'QA', 'console',
        asyncSrc + '\nreturn publishChoiceWindowEnd;')(
        state, () => true, makeDb(rows), () => 0, () => 'STALE-SNAPSHOT', () => 2, { emit() {} }, { warn() {} });
      await fn(12345);
      return state.penalty;
    }
    expect(await run([])).toBe('FINAL-ENVELOPE');        // 0행 적용(레이스 패배) → 로컬 보존
    expect(await run([{ id: 'R' }])).toBe('STALE-SNAPSHOT'); // 정상 적용 시에만 로컬 반영
  });
  it('[소스] 카운트다운 republish(동류 playing-phase writer)도 status=playing 조건부', () => {
    const i = html.indexOf('COUNTDOWN_SERVER_TS_REPUBLISHED');
    const seg = html.slice(i - 1200, i);
    expect(seg).toContain(".eq('status', 'playing')");
  });
});

// ═══ Vincent UI 지시(2026-09-01): 내기록 화면의 "계정삭제" 메뉴 삭제 ═══
describe('내기록 — 계정삭제 메뉴 삭제', () => {
  it('accountStatsPopup 에 계정삭제 버튼이 없다(닫기 버튼은 유지)', () => {
    const s = html.indexOf('id="accountStatsPopup"');
    const seg = html.slice(s, html.indexOf('</div>\n    </div>', s) + 20);
    expect(seg).not.toContain('deleteAccountWithConfirm');
    expect(seg).not.toContain('account.deleteBtn');
    expect(seg).toContain('closeAccountStatsPopup');
  });
});
