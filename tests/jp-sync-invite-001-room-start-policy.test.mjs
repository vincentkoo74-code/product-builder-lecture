// JP-SYNC-INVITE-001 §4 — 방 시작 정책 (CORE 추상화 + JP 설정)
//
// 근본 원인: areAllActivePlayersReady() 의 하한이 `> 0` 이라 host 혼자 준비해도
// 1인 자동 시작이 발화하고, status='playing' 이 되면서 isJoinLocked() 가
// 초대받은 친구의 입장을 막았다.
//
// 이 파일은 (a) CORE 에 시장 분기가 없고 (b) 기본값이 KR 동작을 그대로 유지하며
// (c) JP 설정이 2인 하한을 만든다는 것을 REAL 추출 소스로 검증한다.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { computePlayerStatuses, PLAYER_STATUS } from '../src/game-logic.mjs';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

function extract(startMarker, endMarker) {
  const a = html.indexOf(startMarker);
  const b = html.indexOf(endMarker, a + startMarker.length);
  if (a < 0 || b < 0) throw new Error(`extract failed: ${startMarker}`);
  return html.slice(a, b);
}

// getActivePlayers ~ areAllActivePlayersReady 를 포함하는 REAL 구간(정책 상수 포함).
const BLOCK = extract('    // ── CORE: 방 시작 정책', '    // Build23: "술래 선정이 완료됐는가"');

function load({ participants, marketConfig = undefined }) {
  const state = { participants, confirmedSafeIds: [], confirmedLoserIds: [] };
  const names = ['state', 'computePlayerStatuses', 'PLAYER_STATUS'];
  const vals = [state, computePlayerStatuses, PLAYER_STATUS];
  // MARKET_CONFIG 는 시장 레이어가 제공한다. 주지 않으면 CORE 는 기본값(1)로 떨어져야 한다.
  const prelude = marketConfig === undefined ? '' : `const MARKET_CONFIG = ${JSON.stringify(marketConfig)};\n`;
  // eslint-disable-next-line no-new-func
  return new Function(...names, `${prelude}${BLOCK}; return { areAllActivePlayersReady, getActivePlayers, ROOM_START_POLICY };`)(...vals);
}

const P = (id, ready, isHost = false) => ({ id, is_host: isHost, is_ready: ready, choice: null });

describe('[JP-SYNC-INVITE-001] CORE 에 시장 분기가 없다', () => {
  it('게임 로직(주석 제외)에 시장 분기가 없다', () => {
    // 주석에는 설명 목적의 예시가 들어갈 수 있으므로 **실행 코드만** 검사한다.
    const code = BLOCK.replace(/\/\*[\s\S]*?\*\//g, '').split('\n')
      .map((l) => l.replace(/\/\/.*$/, '')).join('\n');
    expect(code).not.toMatch(/market\s*===/);
    expect(code).not.toMatch(/'JP'|"JP"/);
    expect(code).not.toMatch(/'KR'|"KR"/);
    // 분기 대신 값만 읽어야 한다.
    expect(code).toMatch(/ROOM_START_POLICY\.minParticipantsToStart/);
  });

  it('CORE 는 값(minParticipantsToStart)만 읽는다', () => {
    expect(BLOCK).toMatch(/ROOM_START_POLICY\.minParticipantsToStart/);
  });
});

describe('[JP-SYNC-INVITE-001] 기본값 = 1 → KR 동작 불변', () => {
  it('MARKET_CONFIG 가 없으면 하한은 1 이다', () => {
    const m = load({ participants: [P('H', true, true)] });
    expect(m.ROOM_START_POLICY.minParticipantsToStart).toBe(1);
  });

  it('host 혼자 준비하면 시작 가능하다 (KR 기존 동작)', () => {
    const m = load({ participants: [P('H', true, true)] });
    expect(m.areAllActivePlayersReady()).toBe(true);
  });

  it('아무도 없으면 시작하지 않는다', () => {
    const m = load({ participants: [] });
    expect(m.areAllActivePlayersReady()).toBe(false);
  });

  it('2인 중 1명만 준비면 시작하지 않는다 (기존과 동일)', () => {
    const m = load({ participants: [P('H', true, true), P('G', false)] });
    expect(m.areAllActivePlayersReady()).toBe(false);
  });

  it('잘못된 설정값(0·음수·비숫자)은 1 로 떨어진다 — 시작 불가 상태를 만들지 않는다', () => {
    for (const bad of [0, -1, NaN, 'two', null]) {
      const m = load({ participants: [P('H', true, true)], marketConfig: { minParticipantsToStart: bad } });
      expect(m.ROOM_START_POLICY.minParticipantsToStart, String(bad)).toBe(1);
    }
  });
});

describe('[JP-SYNC-INVITE-001] JP 설정 = 2 → host 단독 시작 차단', () => {
  const JP = { market: 'JP', minParticipantsToStart: 2 };

  it('하한이 2 로 읽힌다', () => {
    const m = load({ participants: [P('H', true, true)], marketConfig: JP });
    expect(m.ROOM_START_POLICY.minParticipantsToStart).toBe(2);
  });

  it('host 혼자 준비해도 자동 시작이 발화하지 않는다 (초대 잠금 방지 — 이 슬라이스의 핵심)', () => {
    const m = load({ participants: [P('H', true, true)], marketConfig: JP });
    expect(m.areAllActivePlayersReady()).toBe(false);
  });

  it('친구가 합류해 둘 다 준비되면 시작 가능하다', () => {
    const m = load({ participants: [P('H', true, true), P('G', true)], marketConfig: JP });
    expect(m.areAllActivePlayersReady()).toBe(true);
  });

  it('친구가 합류했지만 아직 준비 전이면 시작하지 않는다', () => {
    const m = load({ participants: [P('H', true, true), P('G', false)], marketConfig: JP });
    expect(m.areAllActivePlayersReady()).toBe(false);
  });

  it('3인 이상에서도 전원 준비면 시작한다 (하한이지 상한이 아니다)', () => {
    const m = load({ participants: [P('H', true, true), P('G', true), P('X', true)], marketConfig: JP });
    expect(m.areAllActivePlayersReady()).toBe(true);
  });
});

describe('[JP-SYNC-INVITE-001] 실제 파일의 시장 레이어 설정', () => {
  it('JP 빌드는 MARKET_CONFIG.minParticipantsToStart = 2 를 설정한다', () => {
    expect(html).toMatch(/const MARKET_CONFIG\s*=\s*\{[\s\S]{0,200}minParticipantsToStart:\s*2/);
  });

  it('MARKET_CONFIG 는 CORE 블록 밖(시장 레이어)에 있다', () => {
    expect(BLOCK).not.toContain('MARKET_CONFIG =');
    expect(html.indexOf('const MARKET_CONFIG')).toBeLessThan(html.indexOf('const ROOM_START_POLICY'));
  });
});
