// JP-SYNC-INVITE-002 — 대기 / host 부재 / 초대 해석 (CORE, 플랫폼 중립)
//
// REAL 추출 소스로 계약을 고정한다. 기대 동작을 발명하지 않는다.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { webcrypto } from 'node:crypto';
import { computePlayerStatuses, PLAYER_STATUS } from '../src/game-logic.mjs';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const slice = (a, b) => html.slice(html.indexOf(a), html.indexOf(b, html.indexOf(a)));

const TOKEN_BLOCK = slice('    // ── CORE: 초대 토큰', '    // ── CORE: 초대 해석');
// JP-SYNC-INVITE-003 에서 두 블록 사이에 JP 어댑터가 들어왔다. 여기서 검증하는 것은
// **CORE 해석 로직**이므로 끝 마커를 어댑터 시작으로 좁힌다(범위 정정, 완화 아님).
const RESOLVE_BLOCK = slice('    // ── CORE: 초대 해석', '    // ── JP 어댑터: 초대 진입');
const POLICY_BLOCK = slice('    // ── CORE: 방 시작 정책', '    // Build23: "술래 선정이 완료됐는가"');
const codeOnly = (b) => b.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').map((l) => l.replace(/\/\/.*$/, '')).join('\n');

function loadInvite() {
  const g = { crypto: webcrypto };
  const btoaImpl = (b) => Buffer.from(b, 'binary').toString('base64');
  // eslint-disable-next-line no-new-func
  return new Function('globalThis', 'btoa', 'Uint8Array',
    `${TOKEN_BLOCK}${RESOLVE_BLOCK}; return { generateInviteToken, isValidInviteTokenFormat, resolveInviteChallenge, INVITE_JOINABLE_STATUSES };`
  )(g, btoaImpl, Uint8Array);
}
function loadPolicy({ participants, marketConfig }) {
  const state = { participants, confirmedSafeIds: [], confirmedLoserIds: [] };
  const prelude = marketConfig === undefined ? '' : `const MARKET_CONFIG = ${JSON.stringify(marketConfig)};\n`;
  // eslint-disable-next-line no-new-func
  return new Function('state', 'computePlayerStatuses', 'PLAYER_STATUS',
    `${prelude}${POLICY_BLOCK}; return { areAllActivePlayersReady };`
  )(state, computePlayerStatuses, PLAYER_STATUS);
}

const M = loadInvite();
const TOKEN = M.generateInviteToken();
const host = (id = 'H') => ({ id, is_host: true, is_ready: false, choice: null });
const guest = (id) => ({ id, is_host: false, is_ready: false, choice: null });
const room = (over = {}) => ({ id: 'R1', status: 'waiting', invite_token: TOKEN, ...over });
const JP = { market: 'JP', minParticipantsToStart: 2 };

describe('[002] 플랫폼 중립', () => {
  it('해석 로직이 LINE/LIFF/플랫폼 SDK 를 참조하지 않는다', () => {
    const c = codeOnly(RESOLVE_BLOCK);
    expect(c).not.toMatch(/liff/i);
    expect(c).not.toMatch(/\bLINE\b/);
    expect(c).not.toMatch(/market\s*===/);
  });
  it('해석 로직이 DB/네트워크를 직접 만지지 않는다 (권위 조회는 호출자 책임)', () => {
    const c = codeOnly(RESOLVE_BLOCK);
    expect(c).not.toMatch(/db\.from/);
    expect(c).not.toMatch(/await/);
  });
});

describe('[002] §12-1,2 host 단독 대기 — 혼자 시작하지 않는다', () => {
  it('JP: host 혼자 준비해도 자동 시작 조건이 성립하지 않는다', () => {
    const m = loadPolicy({ participants: [{ ...host(), is_ready: true }], marketConfig: JP });
    expect(m.areAllActivePlayersReady()).toBe(false);
  });
  it('host 단독 방은 여전히 입장 가능한 상태다 (waiting)', () => {
    expect(M.resolveInviteChallenge({ token: TOKEN, room: room(), participants: [host()], selfId: 'G' }))
      .toEqual({ state: 'VALID', roomCode: 'R1' });
  });
  it('host 가 ready 를 눌러 status 가 ready 여도 초대는 여전히 유효하다', () => {
    expect(M.resolveInviteChallenge({ token: TOKEN, room: room({ status: 'ready' }), participants: [{ ...host(), is_ready: true }], selfId: 'G' }).state)
      .toBe('VALID');
  });
});

describe('[002] §12-3,4,5 초대자 합류', () => {
  it('즉시 합류: VALID', () => {
    expect(M.resolveInviteChallenge({ token: TOKEN, room: room(), participants: [host()], selfId: 'G' }).state).toBe('VALID');
  });
  it('지연 합류: host 가 남아 있으면 여전히 VALID (시계 기반 만료를 두지 않는다)', () => {
    const old = room({ created_at: '2020-01-01T00:00:00Z' });
    expect(M.resolveInviteChallenge({ token: TOKEN, room: old, participants: [host()], selfId: 'G' }).state).toBe('VALID');
  });
  it('host 가 ready 시도한 뒤 합류해도 VALID', () => {
    expect(M.resolveInviteChallenge({ token: TOKEN, room: room({ status: 'ready' }), participants: [{ ...host(), is_ready: true }], selfId: 'G' }).state).toBe('VALID');
  });
  it('둘이 모이고 전원 준비하면 시작 조건이 성립한다', () => {
    const m = loadPolicy({ participants: [{ ...host(), is_ready: true }, { ...guest('G'), is_ready: true }], marketConfig: JP });
    expect(m.areAllActivePlayersReady()).toBe(true);
  });
});

describe('[002] §12-6,7 host 부재', () => {
  it('host 가 명시적으로 나가 행이 삭제되면 HOST_GONE', () => {
    expect(M.resolveInviteChallenge({ token: TOKEN, room: room(), participants: [], selfId: 'G' }))
      .toEqual({ state: 'HOST_GONE', roomCode: 'R1' });
  });
  it('host 아닌 참가자만 남아도 HOST_GONE', () => {
    expect(M.resolveInviteChallenge({ token: TOKEN, room: room(), participants: [guest('X')], selfId: 'G' }).state).toBe('HOST_GONE');
  });
  it('HOST_GONE 은 일반 오류가 아니라 전용 상태다', () => {
    const r = M.resolveInviteChallenge({ token: TOKEN, room: room(), participants: [], selfId: 'G' });
    expect(r.state).not.toBe('INVALID_TOKEN');
    expect(r.roomCode).toBe('R1');
  });
});

describe('[002] §12-8,9,10 무효 / 중복 / 정원', () => {
  it('형식이 틀린 토큰은 조회 전에 INVALID_TOKEN', () => {
    for (const t of ['', 'ABCD', 'x'.repeat(23), null, undefined, 42]) {
      expect(M.resolveInviteChallenge({ token: t, room: room(), participants: [host()], selfId: 'G' }).state).toBe('INVALID_TOKEN');
    }
  });
  it('매칭되는 방이 없으면 INVALID_TOKEN', () => {
    expect(M.resolveInviteChallenge({ token: TOKEN, room: null, participants: [], selfId: 'G' }).state).toBe('INVALID_TOKEN');
  });
  it('회수된 토큰(NULL)은 매칭 실패로 INVALID_TOKEN', () => {
    expect(M.resolveInviteChallenge({ token: TOKEN, room: room({ invite_token: null }), participants: [host()], selfId: 'G' }).state).toBe('INVALID_TOKEN');
  });
  it('다른 방의 토큰으로는 들어갈 수 없다', () => {
    const other = M.generateInviteToken();
    expect(M.resolveInviteChallenge({ token: other, room: room(), participants: [host()], selfId: 'G' }).state).toBe('INVALID_TOKEN');
  });
  it('같은 사람이 링크를 다시 열면 ALREADY_JOINED (멱등)', () => {
    const r = M.resolveInviteChallenge({ token: TOKEN, room: room(), participants: [host(), guest('G')], selfId: 'G' });
    expect(r).toEqual({ state: 'ALREADY_JOINED', roomCode: 'R1' });
  });
  it('다른 사람이 같은 링크를 열면 정상 VALID', () => {
    expect(M.resolveInviteChallenge({ token: TOKEN, room: room(), participants: [host(), guest('G')], selfId: 'G2' }).state).toBe('VALID');
  });
  it('정원이 차면 ROOM_FULL', () => {
    const many = [host(), ...Array.from({ length: 19 }, (_, i) => guest(`g${i}`))];
    expect(M.resolveInviteChallenge({ token: TOKEN, room: room(), participants: many, selfId: 'NEW' }).state).toBe('ROOM_FULL');
  });
  it('이미 참가자면 정원이 차 있어도 재입장할 수 있다 (순서: ALREADY_JOINED 우선)', () => {
    const many = [host(), ...Array.from({ length: 19 }, (_, i) => guest(`g${i}`))];
    expect(M.resolveInviteChallenge({ token: TOKEN, room: room(), participants: many, selfId: 'g0' }).state).toBe('ALREADY_JOINED');
  });
});

describe('[002] §9 오래된 방이 자동으로 유효한 도전을 뜻하지 않는다', () => {
  it('진행 중/종료 상태는 UNAVAILABLE', () => {
    for (const st of ['playing', 'result', 'stats', 'game_over', 'destroyed']) {
      const r = M.resolveInviteChallenge({ token: TOKEN, room: room({ status: st }), participants: [host()], selfId: 'G' });
      expect(r.state, st).toBe('UNAVAILABLE');
      expect(r.status, st).toBe(st);
    }
  });
  it('입장 가능한 상태 집합이 명시돼 있다', () => {
    expect(M.INVITE_JOINABLE_STATUSES).toEqual(['waiting', 'lobby', 'ready']);
  });
  it('host 행이 남아 있어도 상태가 아니면 입장 불가 — 행 존재만으로 유효하지 않다', () => {
    expect(M.resolveInviteChallenge({ token: TOKEN, room: room({ status: 'playing' }), participants: [host()], selfId: 'G' }).state).toBe('UNAVAILABLE');
  });
});

describe('[002] §7 host-gone 복구 UI 문자열 (i18n 아키텍처 준수)', () => {
  const keys = ['invite.hostGone.title', 'invite.hostGone.desc', 'invite.unavailable.title',
    'invite.invalid.title', 'invite.roomFull.title', 'invite.action.newChallenge',
    'invite.action.home', 'invite.waiting.title'];
  it('모든 키가 ko/ja/en 3개 로케일에 존재한다', () => {
    for (const k of keys) {
      expect((html.match(new RegExp(`"${k.replace(/\./g, '\\.')}"`, 'g')) || []).length, k).toBe(3);
    }
  });
  it('일본어 host-gone 문구가 지정된 개념과 일치한다', () => {
    expect(html).toContain('"invite.hostGone.title": "相手はもう待っていません"');
  });
  it('복구 행동이 최소 2가지 제공된다 (토스트 하나로 끝내지 않는다)', () => {
    expect(html).toMatch(/"invite\.action\.newChallenge"/);
    expect(html).toMatch(/"invite\.action\.home"/);
  });
});
