// Build43 게임룰(단판/삼세판/다섯판) — RED 먼저.
//
// 규칙(Vincent 사양):
//  단판   winsNeeded=1 : 한 판(게임)의 술래가 곧 최종술래.
//  삼세판 winsNeeded=2 : 먼저 2판에서 술래가 된 사람이 최종술래. 기본 3판, 미충족 시 충족까지 계속.
//  다섯판 winsNeeded=3 : 먼저 3판에서 술래가 된 사람이 최종술래. 기본 5판, 미충족 시 충족까지 계속.
//  최종 술래 명수 = 술래숫자(targetLoserCount): 그 수만큼 winsNeeded 에 도달해야 매치 종료.
//  매치 종료 시 최종술래 선언, 더 이상 '한번더' 없음.
// 판 = 술래 확정(gameOver)까지의 한 게임. 판정/실시간 로직 무변경 — 집계는 호스트 권위,
// rooms.penalty envelope(matchRule/matchTally/matchStats)로만 공유(스키마 무변경).
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const html = readFileSync(join(ROOT, 'index.html'), 'utf8');
const section = (id, nextId) => html.slice(html.indexOf(`id="${id}"`), html.indexOf(`id="${nextId}"`));

function extractMatchFns() {
  const s = html.indexOf('// ── Build43 게임룰(매치) 순수 함수 시작');
  const e = html.indexOf('// ── Build43 게임룰(매치) 순수 함수 끝');
  expect(s, '매치 순수 함수 블록 시작 마커').toBeGreaterThan(-1);
  expect(e, '매치 순수 함수 블록 끝 마커').toBeGreaterThan(s);
  return new Function(html.slice(s, e) +
    '\nreturn { normalizeMatchRule, matchWinsNeeded, matchRuleBaseGames, sanitizeMatchTally, applyMatchGameResult, computeMatchState };')();
}

describe('Build43 — 매치 규칙 순수 함수', () => {
  const M = () => extractMatchFns();
  it('normalizeMatchRule: 관용 파싱, 기본값 single(단판) — 구버전 envelope 하위 호환', () => {
    const { normalizeMatchRule } = M();
    expect(normalizeMatchRule('single')).toBe('single');
    expect(normalizeMatchRule('best3')).toBe('best3');
    expect(normalizeMatchRule('best5')).toBe('best5');
    for (const bad of [undefined, null, '', 'x', 3, {}, 'BEST3']) expect(normalizeMatchRule(bad)).toBe('single');
  });
  it('winsNeeded 1/2/3 · 기본 판수 1/3/5', () => {
    const { matchWinsNeeded, matchRuleBaseGames } = M();
    expect(matchWinsNeeded('single')).toBe(1); expect(matchWinsNeeded('best3')).toBe(2); expect(matchWinsNeeded('best5')).toBe(3);
    expect(matchRuleBaseGames('single')).toBe(1); expect(matchRuleBaseGames('best3')).toBe(3); expect(matchRuleBaseGames('best5')).toBe(5);
    expect(matchWinsNeeded('junk')).toBe(1);
  });
  it('sanitizeMatchTally: 양의 정수만, 이상값 무시', () => {
    const { sanitizeMatchTally } = M();
    expect(sanitizeMatchTally({ a: 2, b: '1', c: 0, d: -1, e: 'x', f: 1.9 })).toEqual({ a: 2, b: 1, f: 1 });
    expect(sanitizeMatchTally(null)).toEqual({}); expect(sanitizeMatchTally('nope')).toEqual({});
  });
  it('applyMatchGameResult: 그 판의 확정 술래들에게 +1 (원본 불변)', () => {
    const { applyMatchGameResult } = M();
    const prev = { a: 1 };
    expect(applyMatchGameResult(prev, ['a', 'b'])).toEqual({ a: 2, b: 1 });
    expect(prev).toEqual({ a: 1 });
    expect(applyMatchGameResult({}, [])).toEqual({});
  });
  it('단판: 첫 판 술래 = 최종술래, 매치 종료', () => {
    const { computeMatchState } = M();
    const s = computeMatchState({ rule: 'single', tally: { a: 1 }, targetLoserCount: 1 });
    expect(s.winsNeeded).toBe(1); expect(s.finalTaggerIds).toEqual(['a']); expect(s.complete).toBe(true);
  });
  it('삼세판: 2판 술래가 나올 때까지 미종료, 나오면 종료', () => {
    const { computeMatchState } = M();
    expect(computeMatchState({ rule: 'best3', tally: { a: 1, b: 1 }, targetLoserCount: 1 }).complete).toBe(false);
    expect(computeMatchState({ rule: 'best3', tally: { a: 1, b: 1, c: 1 }, targetLoserCount: 1 }).complete).toBe(false); // 기본 3판 소진돼도 계속
    const done = computeMatchState({ rule: 'best3', tally: { a: 2, b: 1 }, targetLoserCount: 1 });
    expect(done.complete).toBe(true); expect(done.finalTaggerIds).toEqual(['a']);
  });
  it('다섯판: 3판 술래 도달 시 즉시 종료(5판 이전 포함), 미도달이면 계속', () => {
    const { computeMatchState } = M();
    expect(computeMatchState({ rule: 'best5', tally: { a: 2, b: 2 }, targetLoserCount: 1 }).complete).toBe(false);
    const early = computeMatchState({ rule: 'best5', tally: { a: 3 }, targetLoserCount: 1 });
    expect(early.complete).toBe(true); expect(early.finalTaggerIds).toEqual(['a']);
    expect(computeMatchState({ rule: 'best5', tally: { a: 2, b: 2, c: 1 }, targetLoserCount: 1 }).complete).toBe(false);
  });
  it('술래숫자 N: winsNeeded 도달자가 N명 될 때까지 계속', () => {
    const { computeMatchState } = M();
    const one = computeMatchState({ rule: 'best3', tally: { a: 2, b: 1 }, targetLoserCount: 2 });
    expect(one.finalTaggerIds).toEqual(['a']); expect(one.complete).toBe(false);
    const two = computeMatchState({ rule: 'best3', tally: { a: 2, b: 2, c: 1 }, targetLoserCount: 2 });
    expect(two.finalTaggerIds.sort()).toEqual(['a', 'b']); expect(two.complete).toBe(true);
  });
});

describe('Build43 — envelope/집계 소스 계약 (스키마 무변경, 호스트 권위)', () => {
  it('parsePenalty 가 matchRule/matchTally/matchStats/matchTalliedGameNo 를 관용 파싱한다', () => {
    // passthrough + 사용처 정규화(레거시 샌드박스 독립성) — parse 가 필드를 실어 나르는지와
    // buildPenaltyValue 인라인 규칙 사본이 MATCH_RULES(3키)와 일치하는지를 함께 고정한다.
    for (const k of ['matchRule: raw.matchRule', 'matchTally: (raw.matchTally', 'matchTalliedGameNo: toPositiveInt(']) expect(html, k).toContain(k);
    expect(html).toContain('(mrRaw === "best3" || mrRaw === "best5") ? mrRaw : "single"');
    expect(html).toMatch(/const MATCH_RULES = \{ single:.*best3:.*best5:/);
  });
  it('buildPenaltyValue 가 매치 필드를 carry-forward 한다(0/빈 값 생략 규칙 유지)', () => {
    const s = html.indexOf('function buildPenaltyValue'); const body = html.slice(s, html.indexOf('function getNextPhaseScheduledAt'));
    expect(body).toContain('matchRule'); expect(body).toContain('matchTally');
  });
  it('호스트 FINAL 발행 시에만 tally +1, gameNo 원장으로 멱등(재시도 중복 집계 금지)', () => {
    const s = html.indexOf('function hostComposeMatchUpdate'); expect(s, 'hostComposeMatchUpdate 없음').toBeGreaterThan(-1);
    const body = html.slice(s, s + 2200);
    expect(body).toContain('!== "FINAL"'); // FINAL 이 아니면 조기 반환(= FINAL 에서만 집계) expect(body).toContain('matchTalliedGameNo'); expect(body).toContain('applyMatchGameResult');
    // updateRoomStatusScheduled 가 이 함수를 태운다
    expect(html).toContain('(typeof hostComposeMatchUpdate === "function") ? hostComposeMatchUpdate(continuation) : null');
  });
  it('한번더 게이트: host+술래확정 유지 + Build46 매치완료 게이트(미완료 판은 자동 진행)', () => {
    const s = html.indexOf('function canShowPlayAgainButton'); const body = html.slice(s, s + 700);
    expect(body).toContain('if (!(state.role === "host" && isTaggerSelectionComplete())) return false;');
    expect(body).toContain('!isMatchComplete()) return false;');
  });
  it('게임룰은 매치 시작 전(1판째 시작 전)에만 편집 가능하다', () => {
    const s = html.indexOf('function isMatchRuleEditable'); expect(s).toBeGreaterThan(-1);
    const body = html.slice(s, s + 500);
    expect(body).toContain('isLoserCountEditable'); expect(body).toMatch(/getGameRound\(\)\s*<=\s*1|gameRound\s*<=\s*1/);
  });
});

describe('Build43 — UI수정룰2: 호스트 설정 박스 안 게임 룰 선택', () => {
  it('hostRoom·lobby 술래숫자 박스에 게임 룰 select 가 함께 있다', () => {
    const host = section('screenHostRoom', 'screenJoin'), lobby = section('screenLobby', 'screenReady');
    for (const [s, id] of [[host, 'matchRuleSelect'], [lobby, 'lobbyMatchRuleSelect']]) {
      expect(s, id).toContain(`id="${id}"`);
      expect(s).toContain('window.onMatchRuleChange(this.value)');
    }
    const box = host.slice(host.indexOf('id="loserCountBox"'), host.indexOf('</div>\n      </div>\n      <div class="c-foot">'));
    expect(box, '같은 박스 안에 있어야 한다').toContain('id="matchRuleSelect"');
  });
  it('i18n 3개 로케일에 게임 룰 키가 있다', () => {
    for (const k of ['"hostRoom.matchRule"', '"matchRule.single"', '"matchRule.best3"', '"matchRule.best5"', '"result.capMatchFinal"', '"result.titleMatchFinalLoser"', '"result.titleMatchFinalWin"']) {
      const n = html.split(k).length - 1;
      expect(n, `${k} 로케일 수(≥3)`).toBeGreaterThanOrEqual(3);
    }
  });
  it('onMatchRuleChange / updateMatchRuleDropdown 이 존재하고 온라인이면 envelope 에 기록한다', () => {
    expect(html).toContain('function onMatchRuleChange'); expect(html).toContain('function updateMatchRuleDropdown');
    const s = html.indexOf('async function onMatchRuleChange'); const body = html.slice(s, s + 800);
    expect(body).toContain('buildPenaltyValue'); expect(body).toContain("update({ penalty: state.penalty })");
  });
});

describe('Build43 — UI수정룰1: 전적 카드 = 매치 진행전적', () => {
  it('getRoundProgressData 가 매치 누적(판 누계 + 현재 판 진행분)을 렌더 소스로 쓴다', () => {
    const s = html.indexOf('function getRoundProgressData'); const body = html.slice(s, html.indexOf('function renderRoundProgressCards'));
    expect(body).toContain('getMatchCumulativeStats');
  });
  it('매치 종료 gameOver 렌더: 최종술래 선언 텍스트 분기가 있다', () => {
    expect(html).toContain('result.capMatchFinal'); expect(html).toContain('result.titleMatchFinalLoser'); expect(html).toContain('result.msgMatchFinalWin');
  });
});
