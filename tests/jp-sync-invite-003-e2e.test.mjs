// JP-SYNC-INVITE-003 — 초대 진입 어댑터 end-to-end (플랫폼 중립, LIFF 없음)
//
// entryContext.inviteToken → openInviteEntry() → 권위 조회 → resolveInviteChallenge()
//                          → inviteIntentForState() → 화면/행동
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { webcrypto } from 'node:crypto';
import { computePlayerStatuses, PLAYER_STATUS } from '../src/game-logic.mjs';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const slice = (a, b) => html.slice(html.indexOf(a), html.indexOf(b, html.indexOf(a)));
const TOKEN_B = slice('    // ── CORE: 초대 토큰', '    // ── CORE: 초대 해석');
const RESOLVE_B = slice('    // ── CORE: 초대 해석', '    // ── JP 어댑터: 초대 진입');
const ADAPTER_B = slice('    // ── JP 어댑터: 초대 진입', '    // ── CORE: 방 시작 정책');
const POLICY_B = slice('    // ── CORE: 방 시작 정책', '    // Build23: "술래 선정이 완료됐는가"');
const codeOnly = (b) => b.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').map((l) => l.replace(/\/\/.*$/, '')).join('\n');

// ── 결정적 fake DB: rooms + participants, 오류 주입 가능 ────────────────────
function makeDb({ rooms = [], participants = [], failOn = null } = {}) {
  const R = rooms.map((r) => ({ ...r }));
  const P = participants.map((p) => ({ ...p }));
  const build = (table, op, patch) => {
    const f = [];
    let selected = false;
    const b = {
      eq(c, v) { f.push([c, v]); return b; },
      order() { return exec(); },
      single() { return exec(true); },
      select() { selected = true; return b; },
      then(res, rej) { return exec().then(res, rej); },
    };
    async function exec(single = false) {
      if (failOn === table) return { data: null, error: { code: '42703', message: 'column does not exist' } };
      const src = table === 'rooms' ? R : P;
      const hit = src.filter((r) => f.every(([c, v]) => r[c] === v));
      if (op === 'select') {
        if (single) return hit.length === 1 ? { data: { ...hit[0] }, error: null }
                                            : { data: null, error: { code: 'PGRST116', message: 'no rows' } };
        return { data: hit.map((r) => ({ ...r })), error: null };
      }
      hit.forEach((r) => Object.assign(r, patch));
      return { data: selected ? hit.map((r) => ({ id: r.id })) : null, error: null };
    }
    return b;
  };
  return {
    rooms: R, participants: P,
    from: (t) => ({ select: () => build(t, 'select'), update: (p) => build(t, 'update', p) }),
  };
}

function load() {
  const g = { crypto: webcrypto };
  const btoaImpl = (x) => Buffer.from(x, 'binary').toString('base64');
  // eslint-disable-next-line no-new-func
  return new Function('globalThis', 'btoa', 'Uint8Array', 'db',
    `${TOKEN_B}${RESOLVE_B}${ADAPTER_B}; return { generateInviteToken, isValidInviteTokenFormat,
       resolveInviteChallenge, openInviteEntry, inviteIntentForState, issueChallengeInviteToken };`
  )(g, btoaImpl, Uint8Array, null);
}
function loadPolicy(participants, marketConfig) {
  const state = { participants, confirmedSafeIds: [], confirmedLoserIds: [] };
  const pre = marketConfig ? `const MARKET_CONFIG = ${JSON.stringify(marketConfig)};\n` : '';
  // eslint-disable-next-line no-new-func
  return new Function('state', 'computePlayerStatuses', 'PLAYER_STATUS',
    `${pre}${POLICY_B}; return { areAllActivePlayersReady };`)(state, computePlayerStatuses, PLAYER_STATUS);
}

const M = load();
const JP = { market: 'JP', minParticipantsToStart: 2 };
const H = (over = {}) => ({ id: 'H', room_id: 'R1', is_host: true, is_ready: false, choice: null, created_at: '1', ...over });
const G = (id, over = {}) => ({ id, room_id: 'R1', is_host: false, is_ready: false, choice: null, created_at: '2', ...over });

describe('[003] 경계 — LINE SDK 없음', () => {
  it('어댑터 실행 코드가 LIFF/LINE 을 참조하지 않는다', () => {
    const c = codeOnly(ADAPTER_B);
    expect(c).not.toMatch(/liff/i);
    expect(c).not.toMatch(/\bLINE\b/);
    expect(c).not.toMatch(/shareTargetPicker/);
  });
  it('CORE 해석 로직에도 SDK 참조가 없다', () => {
    expect(codeOnly(RESOLVE_B)).not.toMatch(/liff|shareTargetPicker/i);
  });
});

describe('[003] §9-1,2 도전 생성 + 토큰 영속', () => {
  it('방 생성 후 토큰이 발급·영속되고 조회 키가 된다', async () => {
    const db = makeDb({ rooms: [{ id: 'R1', status: 'waiting', invite_token: null }], participants: [H()] });
    const r = await M.issueChallengeInviteToken('R1', db);
    expect(r.ok).toBe(true);
    expect(M.isValidInviteTokenFormat(r.token)).toBe(true);
    expect(db.rooms[0].invite_token).toBe(r.token);
  });
  it('새 도전은 항상 새 토큰을 받는다', async () => {
    const db = makeDb({ rooms: [{ id: 'R1', status: 'waiting' }, { id: 'R2', status: 'waiting' }], participants: [H()] });
    const a = await M.issueChallengeInviteToken('R1', db);
    const b = await M.issueChallengeInviteToken('R2', db);
    expect(a.token).not.toBe(b.token);
  });
  it('스키마 미배포면 조용히 성공한 척하지 않는다 (프로덕션 의존성 격리)', async () => {
    const db = makeDb({ rooms: [{ id: 'R1' }], failOn: 'rooms' });
    const r = await M.issueChallengeInviteToken('R1', db);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('schema_unavailable');
  });
  it('0행 write 를 성공으로 취급하지 않는다', async () => {
    const db = makeDb({ rooms: [{ id: 'OTHER' }] });
    const r = await M.issueChallengeInviteToken('R1', db);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('zero_row');
  });
});

describe('[003] §9-3,4 host 단독 대기', () => {
  it('host 혼자 준비해도 시작 조건이 성립하지 않는다', () => {
    expect(loadPolicy([H({ is_ready: true })], JP).areAllActivePlayersReady()).toBe(false);
  });
  it('host 단독 방은 초대 진입이 VALID 다 (계속 입장 가능)', async () => {
    const db = makeDb({ rooms: [{ id: 'R1', status: 'waiting', invite_token: 'T'.repeat(22) }], participants: [H()] });
    const r = await M.openInviteEntry({ inviteToken: 'T'.repeat(22), selfId: 'G', dbRef: db });
    expect(r.state).toBe('VALID');
    expect(r.intent.action).toBe('join');
  });
});

describe('[003] §9-5~9 초대 열기 경로', () => {
  const T = 'T'.repeat(22);
  const mk = (over = {}, parts = [H()]) =>
    makeDb({ rooms: [{ id: 'R1', status: 'waiting', invite_token: T, ...over }], participants: parts });

  it('즉시 열기 → VALID/join', async () => {
    expect((await M.openInviteEntry({ inviteToken: T, selfId: 'G', dbRef: mk() })).intent.action).toBe('join');
  });
  it('지연 열기(오래된 방)도 host 가 있으면 VALID — 시계 만료 없음', async () => {
    const r = await M.openInviteEntry({ inviteToken: T, selfId: 'G', dbRef: mk({ created_at: '2020-01-01' }) });
    expect(r.state).toBe('VALID');
  });
  it('host 가 ready 시도한 뒤 열어도 VALID', async () => {
    const r = await M.openInviteEntry({ inviteToken: T, selfId: 'G', dbRef: mk({ status: 'ready' }, [H({ is_ready: true })]) });
    expect(r.state).toBe('VALID');
  });
  it('같은 사람이 다시 열면 ALREADY_JOINED → resume (멱등)', async () => {
    const r = await M.openInviteEntry({ inviteToken: T, selfId: 'G', dbRef: mk({}, [H(), G('G')]) });
    expect(r.state).toBe('ALREADY_JOINED');
    expect(r.intent.action).toBe('resume');
  });
  it('정원이 차면 ROOM_FULL → 전용 화면', async () => {
    const many = [H(), ...Array.from({ length: 19 }, (_, i) => G(`g${i}`))];
    const r = await M.openInviteEntry({ inviteToken: T, selfId: 'NEW', dbRef: mk({}, many) });
    expect(r.state).toBe('ROOM_FULL');
    expect(r.intent.screen).toBe('screenInviteUnavailable');
    expect(r.intent.titleKey).toBe('invite.roomFull.title');
  });
});

describe('[003] §9-10,11 host 명시적 퇴장', () => {
  const T = 'T'.repeat(22);
  it('host 가 나가 행이 사라지면 HOST_GONE 전용 화면', async () => {
    const db = makeDb({ rooms: [{ id: 'R1', status: 'waiting', invite_token: T }], participants: [] });
    const r = await M.openInviteEntry({ inviteToken: T, selfId: 'G', dbRef: db });
    expect(r.state).toBe('HOST_GONE');
    expect(r.intent).toMatchObject({
      action: 'blocked', screen: 'screenInviteUnavailable',
      titleKey: 'invite.hostGone.title', descKey: 'invite.hostGone.desc',
    });
  });
  it('죽은 도전이 조용히 되살아나지 않는다', async () => {
    const db = makeDb({ rooms: [{ id: 'R1', status: 'waiting', invite_token: T }], participants: [G('X')] });
    expect((await M.openInviteEntry({ inviteToken: T, selfId: 'G', dbRef: db })).state).toBe('HOST_GONE');
  });
});

describe('[003] §9-12,13 무효 / 이용 불가', () => {
  it('형식 오류 토큰은 조회조차 하지 않는다', async () => {
    for (const t of ['', 'ABCD', null, 42]) {
      const r = await M.openInviteEntry({ inviteToken: t, selfId: 'G', dbRef: makeDb() });
      expect(r.state).toBe('INVALID_TOKEN');
    }
  });
  it('매칭 방 없음 → INVALID_TOKEN', async () => {
    const r = await M.openInviteEntry({ inviteToken: 'Z'.repeat(22), selfId: 'G', dbRef: makeDb({ rooms: [] }) });
    expect(r.state).toBe('INVALID_TOKEN');
  });
  it('DB 오류(스키마 미배포 포함)를 VALID 로 흘려보내지 않는다', async () => {
    const r = await M.openInviteEntry({ inviteToken: 'T'.repeat(22), selfId: 'G', dbRef: makeDb({ failOn: 'rooms' }) });
    expect(r.state).toBe('INVALID_TOKEN');
    expect(r.lookupFailed).toBe(true);
  });
  it('participants 조회 실패도 흡수한다', async () => {
    const T = 'T'.repeat(22);
    const db = makeDb({ rooms: [{ id: 'R1', status: 'waiting', invite_token: T }], failOn: 'participants' });
    const r = await M.openInviteEntry({ inviteToken: T, selfId: 'G', dbRef: db });
    expect(r.state).toBe('INVALID_TOKEN');
    expect(r.lookupFailed).toBe(true);
  });
  it('진행 중 방은 UNAVAILABLE (HOST_GONE 과 내부적으로 구분된다)', async () => {
    const T = 'T'.repeat(22);
    const db = makeDb({ rooms: [{ id: 'R1', status: 'playing', invite_token: T }], participants: [H()] });
    const r = await M.openInviteEntry({ inviteToken: T, selfId: 'G', dbRef: db });
    expect(r.state).toBe('UNAVAILABLE');
    expect(r.intent.titleKey).toBe('invite.unavailable.title');
  });
  it('원시 DB 문구가 UI 의도에 새어나오지 않는다', async () => {
    const r = await M.openInviteEntry({ inviteToken: 'T'.repeat(22), selfId: 'G', dbRef: makeDb({ failOn: 'rooms' }) });
    expect(JSON.stringify(r.intent)).not.toMatch(/column does not exist|42703|PGRST/);
  });
});

describe('[003] §9-14,15 두 명이 모이면 시작', () => {
  it('둘 다 준비되면 시작 조건 성립 (카운트다운은 이때만)', () => {
    expect(loadPolicy([H({ is_ready: true }), G('G', { is_ready: true })], JP).areAllActivePlayersReady()).toBe(true);
  });
  it('한 명만 준비면 성립하지 않는다', () => {
    expect(loadPolicy([H({ is_ready: true }), G('G')], JP).areAllActivePlayersReady()).toBe(false);
  });
});

describe('[003] §6 UI 문구가 host 온라인을 단정하지 않는다', () => {
  it('일본어 대기 문구가 "친구가 온라인" 류를 주장하지 않는다', () => {
    const ja = html.slice(html.indexOf('"invite.waiting.title"'), html.indexOf('"invite.waiting.title"') + 400);
    expect(html).not.toMatch(/友だちがオンライン/);
    expect(html).not.toMatch(/相手がオンライン/);
    expect(ja).toBeTruthy();
  });
  it('host-gone 문구가 지정 개념과 일치한다', () => {
    expect(html).toContain('"invite.hostGone.title": "相手はもう待っていません"');
  });
});
