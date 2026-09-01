// JP-I18N-JOIN-DEFAULT — JP 세션에 한국어 기본 표시명이 노출되지 않아야 한다.
//
// 결함: 초대로 합류할 때 닉네임이 없으면 공용 상수 "참가자"(한국어)가 그대로 쓰였다.
// Tokyo Realtime 검증 중 실제 참가자 행에서 관측했다.
// 수정 범위: **시장 계층만.** 공용 기본값과 KR 경로는 건드리지 않는다.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const slice = (a, b) => html.slice(html.indexOf(a), html.indexOf(b, html.indexOf(a)));
const NICK_B = slice('    // 기본 표시명은 시장 계층이 정한다', '    async function joinFromQrCode');

// loadNickname 은 이 슬라이스 밖의 함수라 주입한다(추출 실행 관례).
function load(marketConfig, { fieldValue = '', saved = '' } = {}) {
  // eslint-disable-next-line no-new-func
  return new Function('MARKET_CONFIG', '$', 'loadNickname',
    `${NICK_B}; return { getDefaultJoinNickname, getInlineJoinNickname };`
  )(marketConfig, () => ({ value: fieldValue }), () => saved);
}

describe('[JP-I18N] 초대 합류 기본 표시명', () => {
  it('JP 시장에서는 일본어 기본값을 쓴다 (한국어 노출 없음)', () => {
    const m = load({ market: 'JP', minParticipantsToStart: 2, defaultJoinNickname: 'ゲスト' });
    expect(m.getDefaultJoinNickname()).toBe('ゲスト');
    expect(m.getInlineJoinNickname()).toBe('ゲスト');
    expect(m.getInlineJoinNickname()).not.toContain('참가자');
  });

  it('실제 JP MARKET_CONFIG 가 일본어 기본값을 선언한다', () => {
    const cfg = slice('    const MARKET_CONFIG = {', '\n    };');
    expect(cfg).toContain("market: 'JP'");
    expect(cfg).toContain("defaultJoinNickname: 'ゲスト'");
  });

  it('키가 없는 시장(KR 등)은 기존 공용 기본값을 그대로 쓴다 — KR 동작 무변경', () => {
    for (const cfg of [{ market: 'KR' }, {}, undefined, null]) {
      const m = load(cfg);
      expect(m.getDefaultJoinNickname(), JSON.stringify(cfg)).toBe('참가자');
    }
  });

  it('빈 문자열/비문자열 설정은 무시하고 공용 기본값으로 떨어진다', () => {
    for (const bad of ['', '   ', 123, {}, []]) {
      expect(load({ market: 'JP', defaultJoinNickname: bad }).getDefaultJoinNickname()).toBe('참가자');
    }
  });

  it('입력된 닉네임이 있으면 기본값을 쓰지 않는다', () => {
    const m = load({ market: 'JP', defaultJoinNickname: 'ゲスト' }, { fieldValue: '  たろう  ' });
    expect(m.getInlineJoinNickname()).toBe('たろう');
  });

  it('저장된 닉네임이 기본값보다 우선한다', () => {
    const m = load({ market: 'JP', defaultJoinNickname: 'ゲスト' }, { saved: 'さくら' });
    expect(m.getInlineJoinNickname()).toBe('さくら');
  });
});
