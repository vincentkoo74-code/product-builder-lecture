// Build47 — 3-결함 교정 계약 (Vincent SCOPE LOCK, 물리 QA 증거 기반)
// 증거: Drive RPS-KR-QA qa-report-build46-r2 (방 Y12R G1~9 — locked/qual 영구 [], complete=false)
//       + IMG_0117(판 패배 화면에 "술래 확정! (1/1명)") + IMG_0109(내부 재대결 '준비 대기' 정족수)
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const html = readFileSync(join(ROOT, 'index.html'), 'utf8');
const fns = () => {
  const s = html.indexOf('// ── Build43 게임룰(매치) 순수 함수 시작');
  const e = html.indexOf('// ── Build43 게임룰(매치) 순수 함수 끝');
  return new Function(html.slice(s, e) + '\nreturn { matchQualificationThreshold, applyMatchGameResult, computeMatchDecision };')();
};

// ── DEFECT 1 [테스트 C] — Y12R 재현·무한 매치 감지 회귀 ─────────────────────────
describe('D1 — Y12R 무한 매치 가드(누적은 판을 넘어 생존해야 한다)', () => {
  it('Y12R 물리 시퀀스(H,H,P,P,H,…)에서 G2에 반드시 H가 확정된다 — 9판 진행은 불법 상태', () => {
    const M = fns();
    const seq = ['h', 'h', 'p', 'p', 'h', 'h', 'p', 'h', 'p']; // Y12R 실측 패자 순서
    let tally = {}, locked = [], qualified = []; let completeAt = -1;
    const expected = {};
    for (let g = 0; g < seq.length; g++) {
      const loser = seq[g];
      expected[loser] = (expected[loser] || 0) + 1;
      tally = M.applyMatchGameResult(tally, locked.includes(loser) ? [] : [loser]);
      const d = M.computeMatchDecision({ rule: 'best3', tally, lockedIds: locked, qualifiedIds: qualified, targetTaggerCount: 1, participantsCount: 3 });
      locked = d.lockedIds; qualified = d.qualifiedIds;
      // 무한 매치 감지: 물리 누적이 임계를 넘었는데 qual/locked 이 비어 있으면 즉시 FAIL
      for (const [id, n] of Object.entries(expected)) {
        if (n >= 2) expect(d.lockedIds.includes(id), `G${g + 1}: ${id} 물리누적 ${n} 인데 미확정`).toBe(true);
      }
      if (d.complete) { completeAt = g + 1; break; }
    }
    expect(completeAt, 'MATCH_FINAL 은 G2 여야 한다').toBe(2);
  });
});

// ── DEFECT 1 — QA 계측 확장(진단 자족성) ────────────────────────────────────────
describe('D1 — MATCH_DECISION 계측이 권위 상태를 자족적으로 싣는다', () => {
  it('hostComposeMatchUpdate 의 QA 이벤트에 누적/원장/임계/신규확정 필드가 있다', () => {
    const s0 = html.indexOf('function hostComposeMatchUpdate');
    const seg = html.slice(s0, s0 + 3500);
    for (const f of ['cumulativeLossTally', 'matchTalliedGameNoPrev', 'configuredLossThreshold', 'requiredTaggerCount', 'newlyConfirmedTaggerIds']) {
      expect(seg, f).toContain(f);
    }
  });
});

// ── DEFECT 2 [테스트 E] — 내부 재대결에서 참가자 READY 제거 ─────────────────────
describe('D2 — 내부 재대결(round>1): 참가자 준비 제거·호스트 강제시작 단독', () => {
  it('강제시작 노출은 준비 정족수와 무관하다(allReady 조건 제거)', () => {
    const s0 = html.indexOf('function canShowForceStartReplayButton');
    const seg = html.slice(s0, s0 + 500);
    expect(seg).not.toContain('areAllActivePlayersReady');
    expect(seg).toContain('(state.round || 1) > 1');
  });
  it('round>1 준비 화면에서 myReadyBtn 은 전 참가자에게 숨김(단일 진실 소스 헬퍼)', () => {
    expect(html).toContain('function isInternalRematchReadyPhase()');
    const uses = html.split('isInternalRematchReadyPhase()').length - 1;
    expect(uses, '정의+토글 3곳 이상').toBeGreaterThanOrEqual(4);
    expect(html).not.toMatch(/myReadyBtn"\)\.classList\.toggle\("hidden", canShowForceStartReplayButton\(\)\)/);
  });
  it('초기 매치 시작(round 1)의 게임 준비는 유지된다', () => {
    const s0 = html.indexOf('function isInternalRematchReadyPhase');
    const seg = html.slice(s0, s0 + 400);
    expect(seg).toMatch(/round \|\| 1\) > 1/);
  });
  it('참가자 준비 액션은 내부 재대결에서 no-op(버튼 잔상/우회 호출 방어)', () => {
    const i = html.indexOf('function markReady');
    const seg = html.slice(i, i + 700);
    expect(seg).toContain('isInternalRematchReadyPhase()');
    expect(seg).toContain('READY_TAP_IGNORED_REMATCH');
  });
  it('호스트 가이드: 내부 재대결에서는 준비-대기 문구가 아니라 강제시작 안내', () => {
    for (const k of ['"guide.host.forceStartRematch"']) expect(html.split(k).length - 1, k).toBeGreaterThanOrEqual(3);
  });
});

// ── DEFECT 3 [테스트 F] — 3-상태 결과 의미론 ───────────────────────────────────
describe('D3 — 확정 문구는 실제 확정 전이에서만', () => {
  it('[STATE A] 비단판 매치의 gameOver 패자 경로에 titleLoserConfirmedCount 가 없다(단판 전용)', () => {
    // 근거: IMG_0117 — 판 패배 화면에 "술래 확정! (1/1명)" 노출. midMatch 평가와 무관하게
    // 비단판에서는 이 카피 경로 자체가 불가능해야 한다(§UI SOURCE OF TRUTH).
    const s = html.indexOf('} else if (myResult === "lose" || iAmConfirmedLoser) {');
    const seg = html.slice(s, s + 3800);
    expect(seg).toMatch(/getMatchRule\(\) === "single"[\s\S]{0,400}titleLoserConfirmedCount/);
    expect(seg).toMatch(/titleGameLose/);
  });
  it('[STATE B] 술래 확정 카피는 전이당 1회 — 이후 렌더/에코는 대기 카피', () => {
    expect(html).toContain('taggerConfirmShownKeys');
    const s = html.indexOf('} else if (myResult === "lose" || iAmConfirmedLoser) {');
    const seg = html.slice(s, s + 3800);
    expect(seg).toContain('result.titleTaggerWaiting');
  });
  it('[STATE B] 대기 카피 i18n ×3', () => {
    expect(html.split('"result.titleTaggerWaiting"').length - 1).toBeGreaterThanOrEqual(3);
    expect(html).toContain('"result.titleTaggerWaiting": "술래 대기 중"');
  });
  it('[기능] 확정 1회성: 같은 (matchNo, id) 로는 두 번 확정 카피가 나오지 않는다', () => {
    const s0 = html.indexOf('function shouldShowTaggerConfirmOnce');
    expect(s0).toBeGreaterThan(-1);
    const end = html.indexOf('\n    function ', s0 + 10);
    const src = html.slice(s0, end);
    const state = { taggerConfirmShownKeys: {} };
    const fn = new Function('state', src + '\nreturn shouldShowTaggerConfirmOnce;')(state);
    expect(fn(1, 'me')).toBe(true);   // 최초 전이 → 확정 카피
    expect(fn(1, 'me')).toBe(false);  // 에코/재렌더 → 대기 카피
    expect(fn(2, 'me')).toBe(true);   // 새 매치는 다시 1회
  });
});
